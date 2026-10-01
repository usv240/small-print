// Offline mode: after one visit the test works with no connection, and results wait in an outbox.
import { expect, test } from '@playwright/test';
import { answerArrows, answerSafety, setDemoDistance } from './helpers';

test.use({ serviceWorkers: 'allow' });

test('works offline after the first visit and sends queued results when back online', async ({ page, context }) => {
  await page.goto('/test.html?demo&dev');
  // Wait until the service worker controls the page and has pre-cached the camera model and runtime.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const cached = await page.evaluate(async () => {
    const urls = ['/test.html', '/models/face_landmarker.task', '/mediapipe/wasm/vision_wasm_internal.wasm'];
    return Promise.all(urls.map(async (u) => !!(await caches.match(u))));
  });
  expect(cached).toEqual([true, true, true]);

  // Go offline and run the whole test.
  await context.setOffline(true);
  await page.reload();
  await answerSafety(page);
  await page.getByRole('button', { name: 'Continue' }).click();
  await setDemoDistance(page, 38);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Got it: you read at about 38 cm.')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Continue' }).click();
  await answerArrows(page);
  await page.getByRole('button', { name: 'Blurry' }).click();
  await setDemoDistance(page, 60);
  await page.getByRole('button', { name: 'Now it’s sharp' }).click();
  await expect(page.locator('.power')).toBeVisible();

  const queued = () => page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('small-print.outbox.v1') ?? '{}')).length);
  expect(await queued()).toBe(1);

  // Back online: the outbox empties (the preview server has no API, so the 404 counts as delivered-and-rejected).
  await context.setOffline(false);
  await expect.poll(queued, { timeout: 15_000 }).toBe(0);
});
