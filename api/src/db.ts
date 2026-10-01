import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { Traffic } from './contract';

export const TABLE_NAME = process.env.TABLE_NAME ?? '';

// Created once per execution environment and reused across invocations.
// Short timeouts: the API sits behind a 30 s HTTP API limit and should fail fast.
export const doc = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    maxAttempts: 3,
    requestHandler: { connectionTimeout: 1000, requestTimeout: 3000 },
  }),
  { marshallOptions: { removeUndefinedValues: true } },
);

/**
 * Single-table key design (pk/sk):
 *   SESSION#<uuid> / RESULT   one anonymous screening result per session
 *   AGG#<traffic>  / STATS    running counters per traffic type (real, demo, judge, dev)
 *   HEALTH         / HEALTH   never written; read by the health check
 * IAM policies restrict each function to its key prefixes with dynamodb:LeadingKeys.
 */
export const keys = {
  session: (sessionId: string) => ({ pk: `SESSION#${sessionId}`, sk: 'RESULT' }),
  aggregate: (traffic: Traffic) => ({ pk: `AGG#${traffic}`, sk: 'STATS' }),
  health: { pk: 'HEALTH', sk: 'HEALTH' },
};
