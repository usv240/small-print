// Full test flow in demo mode (the slider stands in for the camera) on a phone-sized screen.
//
// Expected numbers (src/core/recommend.ts): age 52 → age table +2.00 at 40 cm → +2.13 at 38 cm.
// Near point 60 cm → amplitude 1000/600 − 0.25 = 1.42 D → from near point 2.63 − 0.71 = +1.92.
// Blend 0.6 × 1.92 + 0.4 × 2.13 = 2.01 → +2.00. Eye age (18.5 − 1.42) / 0.3 = 56.9 → 57.

import { expect, test } from '@playwright/test';
import { answerArrows, answerSafety, mockApi, PAYLOAD_KEYS, setDemoDistance } from './helpers';

test('demo flow: result, existing readers update, try-on verdict', async ({ page, isMobile }) => {
  const { posts } = await mockApi(page);
  await page.goto('/test.html?demo&dev');

  await answerSafety(page);
  await page.getByRole('button', { name: 'Continue' }).click();

  // Age: default 50, two taps on "+" → 52.
  await expect(page.getByRole('heading', { level: 1, name: 'How old are you?' })).toBeVisible();
  await expect(page.locator('#age')).toHaveText('50');
  await page.getByRole('button', { name: '+1' }).click();
  await page.getByRole('button', { name: '+1' }).click();
  await expect(page.locator('#age')).toHaveText('52');
  await setDemoDistance(page, 38);
  await page.getByRole('button', { name: 'Continue' }).click();

  // Working distance: needs ~2.5 s of steady readings before "Got it".
  await expect(page.getByRole('heading', { level: 1, name: /Hold your phone where/ })).toBeVisible();
  const use = page.getByRole('button', { name: 'Continue' });
  await expect(use).toBeDisabled();
  await expect(page.getByText('Got it: you read at about 38 cm.')).toBeVisible({ timeout: 8_000 });
  await expect(use).toBeEnabled();
  await use.click();

  await answerArrows(page);

  await expect(page.getByRole('heading', { level: 1, name: 'Is this E sharp?' })).toBeVisible();
  await page.getByRole('button', { name: 'Blurry' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Move the phone slowly away' })).toBeVisible();
  await setDemoDistance(page, 60);
  await page.getByRole('button', { name: 'Now it’s sharp' }).click();

  // Result.
  await expect(page.getByRole('heading', { level: 1, name: 'Your result' })).toBeVisible();
  await expect(page.locator('.result-card .power')).toHaveText('+2.00');
  await expect(page.locator('.result-card')).toContainText('At the shop, try +2.00 first.');
  await expect(page.locator('.eyeage')).toContainText('typical 57-year-old');

  await expect.poll(() => posts.length).toBe(1);
  const first = posts[0];
  expect(Object.keys(first).sort()).toEqual(PAYLOAD_KEYS);
  expect(first).toMatchObject({
    v: 1,
    traffic: 'dev',
    mode: 'demo',
    lang: 'en',
    device: isMobile ? 'phone' : 'desktop', // src/api.ts deviceType(): coarse pointer → phone
    ageBand: '50-54',
    outcome: 'readers',
    referReasons: [],
    startStrength: 2,
    workingDistanceCm: 38,
    nearPointCm: 60,
    nearPointBeyondReach: false,
    calibrated: { screen: false, camera: false },
    tryOn: [],
    existingReaders: null,
  });
  expect(first.sessionId).toMatch(/^[0-9a-f-]{36}$/);

  // "Do you already have reading glasses?" → +2.00 updates the same session.
  await page.getByRole('combobox').selectOption({ label: '+2.00' });
  await expect(page.locator('#existing-thanks')).toHaveText(/Thank you/);
  await expect.poll(() => posts.length).toBe(2);
  expect(posts[1]).toMatchObject({ existingReaders: 2, sessionId: first.sessionId, outcome: 'readers', startStrength: 2 });
  expect(Object.keys(posts[1]).sort()).toEqual(PAYLOAD_KEYS);

  // Try-on at the rack with +2.00: sharp from 25 cm to 60 cm puts the 38 cm reading distance
  // in the middle of the clear range (in dioptres), so the verdict is "good".
  await page.getByRole('button', { name: 'Check a pair in the shop' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Check a pair of reading glasses' })).toBeVisible();
  const chip = page.getByRole('button', { name: '+2.00', exact: true });
  await chip.click();
  await expect(chip).toHaveClass(/\bon\b/);
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Find a spot where the E is sharp' })).toBeVisible();
  await setDemoDistance(page, 40);
  await page.getByRole('button', { name: 'Sharp here' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Now bring it closer' })).toBeVisible();
  await setDemoDistance(page, 25);
  await page.getByRole('button', { name: 'Now it’s blurry' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Now move it away' })).toBeVisible();
  await setDemoDistance(page, 60);
  await page.getByRole('button', { name: 'Now it’s blurry' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Checking +2.00 glasses' })).toBeVisible();
  await expect(page.locator('.result-card.good')).toHaveText('Good fit. These +2.00 glasses suit your reading distance.');
  await expect(page.getByText('Sharp from 25 cm to 60 cm. You read at 38 cm.')).toBeVisible();

  await expect.poll(() => posts.length).toBe(3);
  expect(posts[2]).toMatchObject({ sessionId: first.sessionId, existingReaders: 2, tryOn: [{ strength: 2, verdict: 'good' }] });
  expect(Object.keys(posts[2]).sort()).toEqual(PAYLOAD_KEYS);
});

// APP BUG (src/app.ts tryOnNear): the try-on overwrites state.maxMm (`state.maxMm = state.distanceMm`), and
// "Done" calls result(), which recomputes the recommendation with that try-on reach. When the no-glasses
// near point was beyond reach, reachMm feeds the strength, so the result silently changes (+1.75 → +2.00),
// the "how we worked this out" text claims a distance the person never reported (70 cm instead of 50 cm),
// and a new POST overwrites startStrength for the same session. Fix: keep the no-glasses reach separate
// (e.g. state.nearReachMm frozen when the near point is marked) or reuse state.rec instead of recomputing.
test('result does not change after a try-on (near point beyond reach)', async ({ page }) => {
  const { posts } = await mockApi(page);
  await page.goto('/test.html?demo&dev');
  await answerSafety(page);
  await page.getByRole('button', { name: 'Continue' }).click();
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: '−1' }).click();
  await expect(page.locator('#age')).toHaveText('45');
  await setDemoDistance(page, 40);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Got it: you read at about 40 cm.')).toBeVisible({ timeout: 8_000 });
  await page.getByRole('button', { name: 'Continue' }).click();
  await answerArrows(page);
  await page.getByRole('button', { name: 'Blurry' }).click();
  await setDemoDistance(page, 50);
  await page.getByRole('button', { name: 'Still blurry at arm’s length' }).click();

  // Age 45 at 40 cm → +1.00; never sharp within 50 cm → at least +1.63 → +1.75.
  await expect(page.locator('.result-card .power')).toHaveText('+1.75');
  await expect(page.getByText('The E never got sharp within 50 cm')).toBeAttached();

  // Try-on with the suggested +1.50: sharp 25–70 cm.
  await page.getByRole('button', { name: 'Check a pair in the shop' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await setDemoDistance(page, 40);
  await page.getByRole('button', { name: 'Sharp here' }).click();
  await setDemoDistance(page, 25);
  await page.getByRole('button', { name: 'Now it’s blurry' }).click();
  await setDemoDistance(page, 70);
  await page.getByRole('button', { name: 'Now it’s blurry' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Your result' })).toBeVisible();
  await expect(page.locator('.result-card .power')).toHaveText('+1.75'); // actual: +2.00
  await expect(page.getByText('The E never got sharp within 50 cm')).toBeAttached(); // actual: "within 70 cm"
  await expect.poll(() => posts.length).toBe(3);
  expect(posts.map((p) => p.startStrength)).toEqual([1.75, 1.75, 1.75]); // actual: [1.75, 1.75, 2]
});
