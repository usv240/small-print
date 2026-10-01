import { describe, expect, it } from 'vitest';
import { readJsonBody } from '../src/http';

const headers = { 'content-type': 'application/json' };

describe('readJsonBody', () => {
  it('parses a JSON body', () => {
    expect(readJsonBody({ headers, body: '{"a":1}', isBase64Encoded: false })).toEqual({ ok: true, value: { a: 1 } });
  });

  it('accepts text/plain (sendBeacon) and base64 bodies', () => {
    const body = Buffer.from('{"a":1}').toString('base64');
    expect(readJsonBody({ headers: { 'content-type': 'text/plain;charset=UTF-8' }, body, isBase64Encoded: true }).ok).toBe(true);
  });

  it('rejects other content types with 415', () => {
    expect(readJsonBody({ headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'a=1', isBase64Encoded: false })).toMatchObject({ ok: false, status: 415 });
    expect(readJsonBody({ headers: {}, body: '{}', isBase64Encoded: false })).toMatchObject({ ok: false, status: 415 });
  });

  it('rejects a missing body and invalid JSON with 400', () => {
    expect(readJsonBody({ headers, body: undefined, isBase64Encoded: false })).toMatchObject({ ok: false, status: 400 });
    expect(readJsonBody({ headers, body: '{nope', isBase64Encoded: false })).toMatchObject({ ok: false, status: 400 });
  });

  it('rejects bodies over 4 KB with 413 (measured in bytes, not characters)', () => {
    expect(readJsonBody({ headers, body: `"${'a'.repeat(4094)}"`, isBase64Encoded: false }).ok).toBe(true);
    expect(readJsonBody({ headers, body: `"${'a'.repeat(4095)}"`, isBase64Encoded: false })).toMatchObject({ ok: false, status: 413 });
    expect(readJsonBody({ headers, body: `"${'é'.repeat(2100)}"`, isBase64Encoded: false })).toMatchObject({ ok: false, status: 413 });
  });
});
