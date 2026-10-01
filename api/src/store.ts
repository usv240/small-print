import { GetCommand, TransactWriteCommand, type TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb';
import { counterDeltas, type Counters } from './aggregates';
import { computeAgreement } from './agreement';
import type { ScreeningResult, Traffic } from './contract';
import { keys } from './db';

type TransactItem = NonNullable<TransactWriteCommandInput['TransactItems']>[number];

/** The stored result item: the validated result plus server-side fields. No IP, no user agent. */
export interface StoredResult extends ScreeningResult {
  pk: string;
  sk: string;
  type: 'result';
  agreement: string | null;
  createdAt: string;
  updatedAt: string;
  /** Optimistic-lock revision, incremented on every repeat POST for the session. */
  rev: number;
}

export type SaveOutcome = 'created' | 'updated';

export class ConflictError extends Error {
  override name = 'ConflictError';
}

// Minimal client surface so tests can pass a scripted fake.
export type Send = (command: GetCommand | TransactWriteCommand) => Promise<{ Item?: Record<string, unknown> }>;

export function resultItem(r: ScreeningResult, createdAt: string, updatedAt: string, rev: number): StoredResult {
  return {
    ...keys.session(r.sessionId),
    type: 'result',
    ...r,
    agreement: computeAgreement(r.startStrength, r.existingReaders),
    createdAt,
    updatedAt,
    rev,
  };
}

/** UpdateItem that ADDs counter deltas (creating the aggregate item on first use). */
export function aggregateUpdate(table: string, traffic: Traffic, counters: Counters, now: string): TransactItem {
  const names: Record<string, string> = { '#updatedAt': 'updatedAt' };
  const values: Record<string, unknown> = { ':updatedAt': now };
  const adds = Object.entries(counters).map(([attr, delta], i) => {
    names[`#c${i}`] = attr;
    values[`:c${i}`] = delta;
    return `#c${i} :c${i}`;
  });
  return {
    Update: {
      TableName: table,
      Key: keys.aggregate(traffic),
      UpdateExpression: `SET #updatedAt = :updatedAt ADD ${adds.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    },
  };
}

/** First write for a session: insert the item only if absent, and count it, in one transaction. */
export function createTransaction(table: string, r: ScreeningResult, now: string): TransactItem[] {
  const put: TransactItem = {
    Put: { TableName: table, Item: resultItem(r, now, now, 1), ConditionExpression: 'attribute_not_exists(pk)' },
  };
  const updates = [...counterDeltas(undefined, r)].map(([traffic, d]) => aggregateUpdate(table, traffic, d, now));
  return [put, ...updates];
}

/**
 * Repeat POST for a session: replace the item if nobody else changed it since we read it, and move
 * the counts from the old version to the new one. `screenings` nets to zero, so nothing double counts.
 */
export function updateTransaction(table: string, prev: StoredResult, r: ScreeningResult, now: string): TransactItem[] {
  const put: TransactItem = {
    Put: {
      TableName: table,
      Item: resultItem(r, prev.createdAt ?? now, now, (prev.rev ?? 0) + 1),
      ConditionExpression: typeof prev.rev === 'number' ? '#rev = :rev' : 'attribute_not_exists(#rev)',
      ExpressionAttributeNames: { '#rev': 'rev' },
      ...(typeof prev.rev === 'number' ? { ExpressionAttributeValues: { ':rev': prev.rev } } : {}),
    },
  };
  const updates = [...counterDeltas(prev, r)].map(([traffic, d]) => aggregateUpdate(table, traffic, d, now));
  return [put, ...updates];
}

function cancellationCodes(err: unknown): string[] | null {
  if (err instanceof Error && err.name === 'TransactionCanceledException') {
    const reasons = (err as { CancellationReasons?: Array<{ Code?: string }> }).CancellationReasons ?? [];
    return reasons.map((reason) => reason?.Code ?? 'None');
  }
  return null;
}

const MAX_ATTEMPTS = 5;
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Idempotent per sessionId. Tries the insert first (no read on the common path); if the session
 * already exists, re-reads it and applies the delta. Retries transaction conflicts on the shared
 * aggregate item with jittered backoff.
 */
export async function saveResult(
  r: ScreeningResult,
  opts: { send: Send; table: string; now?: string; sleep?: (ms: number) => Promise<void> },
): Promise<SaveOutcome> {
  const { send, table } = opts;
  const now = opts.now ?? new Date().toISOString();
  const sleep = opts.sleep ?? defaultSleep;
  let exists = false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let prev: StoredResult | undefined;
    if (exists) {
      const res = await send(new GetCommand({ TableName: table, Key: keys.session(r.sessionId), ConsistentRead: true }));
      prev = res.Item as StoredResult | undefined;
    }
    const items = prev ? updateTransaction(table, prev, r, now) : createTransaction(table, r, now);
    try {
      await send(new TransactWriteCommand({ TransactItems: items }));
      return prev ? 'updated' : 'created';
    } catch (err) {
      const codes = cancellationCodes(err);
      if (!codes) throw err;
      if (codes[0] === 'ConditionalCheckFailed') {
        // Created (or changed) by an earlier/concurrent request: re-read and apply a delta instead.
        exists = true;
        continue;
      }
      if (codes.includes('TransactionConflict')) {
        await sleep(Math.random() * 25 * 2 ** attempt);
        continue;
      }
      throw err;
    }
  }
  throw new ConflictError('too many concurrent updates');
}
