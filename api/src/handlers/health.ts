import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { TABLE_NAME, doc, keys } from '../db';
import { json, type Response } from '../http';
import { errorName, log } from '../log';

/** GET /api/v1/health: 200 when DynamoDB answers a cheap GetItem, 503 otherwise (for the uptime check). */
export async function handler(): Promise<Response> {
  const time = new Date().toISOString();
  try {
    await doc.send(new GetCommand({ TableName: TABLE_NAME, Key: keys.health }), { abortSignal: AbortSignal.timeout(2000) });
    return json(200, { ok: true, time });
  } catch (err) {
    log.error('health check failed', { error: errorName(err) });
    return json(503, { ok: false, error: 'database unavailable', time });
  }
}
