import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { MAX_BODY_BYTES } from './contract';

export type Response = APIGatewayProxyStructuredResultV2;

export function json(statusCode: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
    body: JSON.stringify(body),
  };
}

export function error(statusCode: number, message: string): Response {
  return json(statusCode, { ok: false, error: message });
}

// application/json is expected; text/plain is accepted so navigator.sendBeacon(url, string) works.
const ACCEPTED_TYPES = new Set(['application/json', 'text/plain']);

export type BodyResult = { ok: true; value: unknown } | { ok: false; status: number; error: string };

/** Reads a small JSON body (max 4 KB) from an HTTP API (payload v2) event. */
export function readJsonBody(event: Pick<APIGatewayProxyEventV2, 'headers' | 'body' | 'isBase64Encoded'>): BodyResult {
  const contentType = (event.headers?.['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (!ACCEPTED_TYPES.has(contentType)) {
    return { ok: false, status: 415, error: 'content-type must be application/json' };
  }
  if (event.body === undefined || event.body === null || event.body === '') {
    return { ok: false, status: 400, error: 'request body is required' };
  }
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : Buffer.from(event.body, 'utf8');
  if (raw.byteLength > MAX_BODY_BYTES) {
    return { ok: false, status: 413, error: `request body must be at most ${MAX_BODY_BYTES} bytes` };
  }
  try {
    return { ok: true, value: JSON.parse(raw.toString('utf8')) };
  } catch {
    return { ok: false, status: 400, error: 'request body is not valid JSON' };
  }
}
