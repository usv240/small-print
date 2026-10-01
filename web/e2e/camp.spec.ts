// Camp mode: two people screened on one device in demo mode, then the summary and stock list.
import { expect, test, type Page } from '@playwright/test';
import { answerArrows, answerSafety, mockApi, setDemoDistance } from './helpers';

/** Safety (all No) → age 52 → reading distance 38 cm → small print → near point 60 cm → result (+2.00). */
async function screenOnePerson(page: Page): Promise<void> {
  await answerSafety(page);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: '+1' }).click();
  await page.getByRole('button', { name: '+1' }).click();
  await setDemoDistance(page, 38);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Got it: you read at about 38 cm.')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Continue' }).click();
  await answerArrows(page);
  await page.getByRole('button', { name: 'Blurry' }).click();
  await setDemoDistance(page, 60);
  await page.getByRole('button', { name: 'Now it’s sharp' }).click();
  await expect(page.locator('.power')).toHaveText('+2.00');
}

test('camp mode: tally two people and suggest stock', async ({ page }) => {
  const { posts } = await mockApi(page);
  await page.goto('/test.html?demo&dev&camp');
  await page.evaluate(() => localStorage.removeItem('small-print.camp.v1'));

  await screenOnePerson(page);
  await expect(page.getByText('Camp mode · people screened on this device: 1')).toBeVisible();
  await page.getByRole('button', { name: 'Next person' }).click();

  // The next person starts fresh at the safety questions, still in camp and demo mode, with a new anonymous session.
  await expect(page.getByRole('heading', { level: 1, name: 'First, a few safety questions' })).toBeVisible();
  await screenOnePerson(page);
  await expect(page.getByText('Camp mode · people screened on this device: 2')).toBeVisible();
  await page.getByRole('button', { name: 'Camp summary' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Camp summary' })).toBeVisible();
  await expect(page.locator('.stat').first()).toContainText('2');
  await expect(page.locator('table')).toContainText('+2.00');
  await expect(page.getByRole('heading', { name: 'Pairs to bring for the next 100 people' })).toBeVisible();
  // 2 of 2 people need +2.00 → 100 + 1 spare.
  await expect(page.locator('ul').last()).toContainText('+2.00: 101');

  const sessions = new Set(posts.map((p) => p.sessionId));
  expect(sessions.size).toBe(2);
});
