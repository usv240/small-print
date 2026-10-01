import { BatchGetCommand } from '@aws-sdk/lib-dynamodb';
import { buildStats } from '../aggregates';
import { TRAFFIC, type Traffic } from '../contract';
import { TABLE_NAME, doc, keys } from '../db';
import { error, json, type Response } from '../http';
import { errorName, log } from '../log';

/** GET /api/v1/stats: public aggregate counters for every traffic type (cached 30 s at CloudFront). */
export async function handler(): Promise<Response> {
  try {
    const items: Partial<Record<Traffic, Record<string, unknown>>> = {};
    let pending: Record<string, unknown>[] = TRAFFIC.map((t) => keys.aggregate(t));
    for (let attempt = 0; pending.length > 0 && attempt < 3; attempt++) {
      const res = await doc.send(new BatchGetCommand({ RequestItems: { [TABLE_NAME]: { Keys: pending } } }));
      for (const item of res.Responses?.[TABLE_NAME] ?? []) {
        const traffic = String(item.pk).slice('AGG#'.length) as Traffic;
        if ((TRAFFIC as readonly string[]).includes(traffic)) items[traffic] = item;
      }
      pending = res.UnprocessedKeys?.[TABLE_NAME]?.Keys ?? [];
    }
    if (pending.length > 0) throw new Error('unprocessed keys');
    return json(200, buildStats(items, new Date().toISOString()), { 'cache-control': 'public, max-age=30' });
  } catch (err) {
    log.error('stats read failed', { error: errorName(err) });
    return error(503, 'stats unavailable');
  }
}
