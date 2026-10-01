// Real camera path: MediaPipe Face Landmarker (WASM + model served by vite preview) on Chrome's fake
// webcam, which plays MediaPipe's test portrait (see playwright.config.ts and e2e/fake-camera.ts).
// No calibration is stored, so distances use the uncalibrated 70° field-of-view assumption.

import { expect, test } from '@playwright/test';
import { answerArrows, answerSafety, mockApi, PAYLOAD_KEYS } from './helpers';

test.describe.configure({ timeout: 120_000 });

test('lab: live distance and iris width from the fake camera', async ({ page }) => {
  await page.goto('/lab.html?dev');
  await page.getByRole('button', { name: 'Start camera' }).click();

  const live = page.locator('#live');
  await expect(live).toHaveText(/^\d+(\.\d)? cm$/, { timeout: 45_000 });
  await expect(page.locator('#iris')).toHaveText(/^0\.\d{5}$/);
  await expect(page.locator('#vsize')).toHaveText(/^\d+×\d+$/);

  // Let a few frames settle, then record what the camera path measured.
  await page.waitForTimeout(1_000);
  const cm = parseFloat((await live.textContent())!);
  const iris = parseFloat((await page.locator('#iris').textContent())!);
  const fps = await page.locator('#fps').textContent();
  const vsize = await page.locator('#vsize').textContent();
  console.log(`[fake camera] lab: distance ${cm} cm (uncalibrated), iris ${iris} of frame width, video ${vsize}, ${fps} fps`);
  expect(Number.isFinite(cm)).toBe(true);
  expect(cm).toBeGreaterThanOrEqual(10);
  expect(cm).toBeLessThanOrEqual(200);
  expect(iris).toBeGreaterThan(0);
});

test('test flow with the camera: still image gives steady readings through to the result', async ({ page }) => {
  const { posts } = await mockApi(page);
  await page.goto('/test.html?dev');

  await page.getByRole('button', { name: 'Start with camera' }).click();
  await answerSafety(page);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'How old are you?' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Turn on your camera' })).toBeVisible();
  await page.getByRole('button', { name: 'Allow camera' }).click();

  // Fresh browser profile → no stored calibration → card step, then camera step. Skip both.
  await expect(page.getByRole('heading', { level: 1, name: 'Match a card to the screen' })).toBeVisible({ timeout: 45_000 });
  await page.getByRole('button', { name: 'I don’t have a card' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Hold the screen 30 cm from your eyes' })).toBeVisible();
  await expect(page.locator('[data-live]')).toHaveText(/^\d+ cm$/, { timeout: 15_000 });
  await page.getByRole('button', { name: 'Skip (less accurate)' }).click();

  // Working distance: a still image is perfectly steady.
  await expect(page.getByRole('heading', { level: 1, name: /Hold your phone where/ })).toBeVisible();
  const got = page.getByText(/^Got it: you read at about \d+ cm\.$/);
  await expect(got).toBeVisible({ timeout: 20_000 });
  const measuredCm = Number((await got.textContent())!.match(/(\d+) cm/)![1]);
  console.log(`[fake camera] test flow: working distance ${measuredCm} cm (uncalibrated)`);
  expect(measuredCm).toBeGreaterThanOrEqual(10);
  expect(measuredCm).toBeLessThanOrEqual(200);
  await page.getByRole('button', { name: 'Continue' }).click();

  await answerArrows(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Is this E sharp?' })).toBeVisible();
  await page.getByRole('button', { name: 'Blurry' }).click();
  await page.getByRole('button', { name: 'Now it’s sharp' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Your result' })).toBeVisible();
  await expect(page.locator('.result-card')).toBeVisible();
  await expect(page.locator('.result-card')).not.toBeEmpty();

  await expect.poll(() => posts.length).toBe(1);
  const p = posts[0];
  console.log(`[fake camera] posted: outcome ${p.outcome}, strength ${p.startStrength}, working ${p.workingDistanceCm} cm, near point ${p.nearPointCm} cm`);
  expect(Object.keys(p).sort()).toEqual(PAYLOAD_KEYS);
  expect(p).toMatchObject({
    v: 1,
    traffic: 'dev',
    mode: 'camera',
    device: 'desktop',
    ageBand: '50-54',
    workingDistanceCm: measuredCm,
    nearPointBeyondReach: false,
    calibrated: { screen: false, camera: false },
  });
  expect(p.nearPointCm).toBeGreaterThanOrEqual(10);
});
