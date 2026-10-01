import { expect, type Page } from '@playwright/test';
import type { ResultPayload } from '../src/api';

/** The 16 fields of the results contract (src/api.ts ResultPayload). */
export const PAYLOAD_KEYS = [
  'v', 'sessionId', 'traffic', 'mode', 'lang', 'device', 'ageBand', 'outcome', 'referReasons',
  'startStrength', 'workingDistanceCm', 'nearPointCm', 'nearPointBeyondReach', 'calibrated', 'tryOn',
  'existingReaders',
].sort();

/** The API is not served by `vite preview`: answer it here and keep every posted result. */
export async function mockApi(page: Page): Promise<{ posts: ResultPayload[]; hits: string[] }> {
  const posts: ResultPayload[] = [];
  const hits: string[] = [];
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request();
    hits.push(`${req.method()} ${new URL(req.url()).pathname}`);
    if (req.method() === 'POST' && req.url().endsWith('/api/v1/results')) posts.push(req.postDataJSON());
    await route.fulfill({ status: 202, json: { ok: true } });
  });
  return { posts, hits };
}

/** Answers every safety question; `yes` lists the legends (regex) to answer Yes to. */
export async function answerSafety(page: Page, yes: RegExp[] = []): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name: 'First, a few safety questions' })).toBeVisible();
  const groups = page.getByRole('group');
  await expect(groups).toHaveCount(6);
  for (const g of await groups.all()) {
    const legend = (await g.locator('legend').textContent()) ?? '';
    const answer = yes.some((r) => r.test(legend)) ? 'Yes' : 'No';
    await g.getByRole('radio', { name: answer }).check();
  }
}

/** Five answers on the small-print screen (correctness doesn't matter for these tests). */
export async function answerArrows(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name: 'Which way does the E point?' })).toBeVisible();
  for (let n = 1; n <= 5; n++) {
    await expect(page.locator('#count')).toHaveText(`${n} of 5`);
    await page.getByRole('button', { name: ['Up', 'Left', 'Right', 'Down'][n % 4], exact: true }).click();
  }
}

/** Demo mode: move the bottom slider and wait until the live read-out shows it. */
export async function setDemoDistance(page: Page, cm: number): Promise<void> {
  await page.locator('#demo-range').fill(String(cm));
  await expect(page.locator('#demo-value')).toHaveText(`${cm} cm`);
  const live = page.locator('[data-live]');
  if (await live.count()) await expect(live).toHaveText(`${cm} cm`);
}
