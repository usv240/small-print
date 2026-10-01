import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { TABLE_NAME, doc } from '../db';
import { error, json, readJsonBody, type Response } from '../http';
import { emitMetrics, errorName, log } from '../log';
import { ConflictError, saveResult, type Send } from '../store';
import { validateResult } from '../validate';

const send: Send = (command) => doc.send(command as never) as ReturnType<Send>;

/** POST /api/v1/results: store one anonymous screening result and update the aggregates. */
export async function handler(event: APIGatewayProxyEventV2): Promise<Response> {
  const body = readJsonBody(event);
  if (!body.ok) {
    log.warn('result rejected', { status: body.status, reason: 'body' });
    return error(body.status, body.error);
  }

  const result = validateResult(body.value);
  if (!result.ok) {
    // Log the field path only; the request body itself is never logged.
    log.warn('result rejected', { status: 400, reason: 'validation', field: result.field });
    return error(400, result.error);
  }

  const r = result.value;
  try {
    const saved = await saveResult(r, { send, table: TABLE_NAME });
    log.info('result saved', { saved, traffic: r.traffic, mode: r.mode, outcome: r.outcome, lang: r.lang, device: r.device });
    if (saved === 'created') {
      emitMetrics('SmallPrint', { Traffic: r.traffic }, { Screenings: { value: 1, unit: 'Count' } });
      return json(201, { ok: true });
    }
    return json(200, { ok: true, updated: true });
  } catch (err) {
    if (err instanceof ConflictError) {
      log.warn('result conflict', { traffic: r.traffic });
      return error(409, 'too many concurrent updates for this session, please retry');
    }
    log.error('result save failed', { error: errorName(err) });
    return error(500, 'internal error');
  }
}
