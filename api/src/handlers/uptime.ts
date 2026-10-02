import { emitMetrics, errorName, log } from '../log';

// Scheduled every 5 minutes. Checks the public site and API through CloudFront (what users see)
// and publishes SmallPrint/Uptime (1 or 0) and SmallPrint/Latency (ms) per check via EMF.

const SITE_URL = process.env.SITE_URL ?? '';
const TIMEOUT_MS = 8000;

interface Check {
  name: 'site' | 'health' | 'stats';
  path: string;
  isUp: (status: number, contentType: string, body: string) => boolean;
}

function parseJson(body: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(body);
    return typeof v === 'object' && v !== null ? v : null;
  } catch {
    return null;
  }
}

const CHECKS: Check[] = [
  { name: 'site', path: '/', isUp: (s, ct) => s === 200 && ct.includes('text/html') },
  { name: 'health', path: '/api/v1/health', isUp: (s, _ct, b) => s === 200 && parseJson(b)?.ok === true },
  {
    name: 'stats',
    path: '/api/v1/stats',
    isUp: (s, _ct, b) => s === 200 && typeof parseJson(b)?.traffic === 'object',
  },
];

interface CheckResult {
  name: Check['name'] | 'app';
  up: boolean;
  status: number;
  latencyMs: number;
  error?: string;
}

async function run(check: Check): Promise<CheckResult> {
  const started = performance.now();
  try {
    const res = await fetch(new URL(check.path, SITE_URL), {
      headers: { 'user-agent': 'SmallPrint-Uptime/1.0' },
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await res.text();
    const latencyMs = Math.round(performance.now() - started);
    return { name: check.name, up: check.isUp(res.status, res.headers.get('content-type') ?? '', body), status: res.status, latencyMs };
  } catch (err) {
    return { name: check.name, up: false, status: 0, latencyMs: Math.round(performance.now() - started), error: errorName(err) };
  }
}

/** The camera app: test page, its WebAssembly runtime (must be served brotli-encoded) and the face model.
 *  A deploy that breaks any of these breaks the test even when / still loads. */
export async function appCheck(): Promise<CheckResult> {
  const started = performance.now();
  const req = (p: string, method: 'GET' | 'HEAD') =>
    fetch(new URL(p, SITE_URL), { method, headers: { 'user-agent': 'SmallPrint-Uptime/1.0' }, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
  try {
    const [page, wasm, model] = await Promise.all([
      req('/test.html', 'GET'),
      req('/mediapipe/wasm/vision_wasm_internal.wasm', 'HEAD'),
      req('/models/face_landmarker.task', 'HEAD'),
    ]);
    await page.text();
    const up =
      page.status === 200 && (page.headers.get('content-type') ?? '').includes('text/html') &&
      wasm.status === 200 && wasm.headers.get('content-encoding') === 'br' &&
      (wasm.headers.get('content-type') ?? '').includes('application/wasm') &&
      model.status === 200;
    const status = [page, wasm, model].find((r) => r.status !== 200)?.status ?? 200;
    return { name: 'app', up, status, latencyMs: Math.round(performance.now() - started) };
  } catch (err) {
    return { name: 'app', up: false, status: 0, latencyMs: Math.round(performance.now() - started), error: errorName(err) };
  }
}

export async function handler(): Promise<{ up: boolean; checks: CheckResult[] }> {
  const checks = await Promise.all([...CHECKS.map(run), appCheck()]);
  for (const c of checks) {
    emitMetrics(
      'SmallPrint',
      { Check: c.name },
      { Uptime: { value: c.up ? 1 : 0, unit: 'None' }, Latency: { value: c.latencyMs, unit: 'Milliseconds' } },
      { status: c.status },
    );
    if (!c.up) log.warn('uptime check failed', { check: c.name, status: c.status, error: c.error });
  }
  return { up: checks.every((c) => c.up), checks };
}
