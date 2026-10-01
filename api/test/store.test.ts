import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { describe, expect, it } from 'vitest';
import { createTransaction, resultItem, saveResult, updateTransaction, ConflictError, type Send } from '../src/store';
import { validResult } from './fixtures';

const TABLE = 'test-table';
const NOW = '2026-10-01T12:00:00.000Z';

function cancelled(...codes: string[]): Error {
  return Object.assign(new Error('Transaction cancelled'), {
    name: 'TransactionCanceledException',
    CancellationReasons: codes.map((Code) => ({ Code })),
  });
}

/** Scripted fake: each call pops the next response (a value to resolve, or an Error to throw). */
function scripted(responses: Array<object | Error>) {
  const calls: Array<GetCommand | TransactWriteCommand> = [];
  const send: Send = async (command) => {
    calls.push(command);
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return (next ?? {}) as { Item?: Record<string, unknown> };
  };
  return { send, calls };
}

const noSleep = async () => {};

describe('transactions', () => {
  it('create: conditional put plus one aggregate ADD', () => {
    const items = createTransaction(TABLE, validResult(), NOW);
    expect(items).toHaveLength(2);
    expect(items[0].Put?.ConditionExpression).toBe('attribute_not_exists(pk)');
    expect(items[0].Put?.Item).toMatchObject({ pk: 'SESSION#3f2c9a4e-8b1d-4c7a-9e2f-5a6b7c8d9e0f', sk: 'RESULT', rev: 1 });
    expect(items[1].Update?.Key).toEqual({ pk: 'AGG#dev', sk: 'STATS' });
    expect(items[1].Update?.UpdateExpression).toMatch(/^SET #updatedAt = :updatedAt ADD /);
    expect(Object.values(items[1].Update?.ExpressionAttributeNames ?? {})).toContain('screenings');
  });

  it('stored item has no network identifiers and includes server-side agreement', () => {
    const item = resultItem(validResult({ existingReaders: 1.5 }), NOW, NOW, 1);
    expect(item.agreement).toBe('exact');
    for (const key of Object.keys(item)) expect(key).not.toMatch(/ip|agent|header/i);
  });

  it('identical repeat: only the guarded put, no aggregate update', () => {
    const prev = resultItem(validResult(), NOW, NOW, 3);
    const items = updateTransaction(TABLE, prev, validResult(), '2026-10-01T12:05:00.000Z');
    expect(items).toHaveLength(1);
    expect(items[0].Put?.ConditionExpression).toBe('#rev = :rev');
    expect(items[0].Put?.ExpressionAttributeValues).toEqual({ ':rev': 3 });
    expect(items[0].Put?.Item).toMatchObject({ rev: 4, createdAt: NOW, updatedAt: '2026-10-01T12:05:00.000Z' });
  });
});

describe('saveResult', () => {
  it('returns created on the first write without reading first', async () => {
    const { send, calls } = scripted([{}]);
    await expect(saveResult(validResult(), { send, table: TABLE, now: NOW, sleep: noSleep })).resolves.toBe('created');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBeInstanceOf(TransactWriteCommand);
  });

  it('on a repeat, re-reads and applies a delta that does not count the screening again', async () => {
    const prev = resultItem(validResult({ outcome: 'readers' }), NOW, NOW, 1);
    const { send, calls } = scripted([cancelled('ConditionalCheckFailed', 'None'), { Item: prev }, {}]);
    const next = validResult({ outcome: 'no-readers' });
    await expect(saveResult(next, { send, table: TABLE, now: NOW, sleep: noSleep })).resolves.toBe('updated');
    expect(calls.map((c) => c.constructor.name)).toEqual(['TransactWriteCommand', 'GetCommand', 'TransactWriteCommand']);
    const update = (calls[2] as TransactWriteCommand).input.TransactItems?.[1]?.Update;
    const counters = Object.fromEntries(
      Object.entries(update?.ExpressionAttributeNames ?? {})
        .filter(([alias]) => alias.startsWith('#c'))
        .map(([alias, attr]) => [attr, update?.ExpressionAttributeValues?.[`:${alias.slice(1)}`]]),
    );
    expect(counters).toEqual({ 'outcome:readers': -1, 'outcome:no-readers': 1 });
  });

  it('retries transaction conflicts on the shared aggregate item', async () => {
    const { send, calls } = scripted([cancelled('None', 'TransactionConflict'), {}]);
    await expect(saveResult(validResult(), { send, table: TABLE, now: NOW, sleep: noSleep })).resolves.toBe('created');
    expect(calls).toHaveLength(2);
  });

  it('gives up with ConflictError after repeated conflicts', async () => {
    const conflicts = Array.from({ length: 5 }, () => cancelled('None', 'TransactionConflict'));
    const { send } = scripted(conflicts);
    await expect(saveResult(validResult(), { send, table: TABLE, now: NOW, sleep: noSleep })).rejects.toBeInstanceOf(ConflictError);
  });

  it('rethrows unexpected errors', async () => {
    const boom = Object.assign(new Error('nope'), { name: 'AccessDeniedException' });
    const { send } = scripted([boom]);
    await expect(saveResult(validResult(), { send, table: TABLE, now: NOW, sleep: noSleep })).rejects.toBe(boom);
  });
});
