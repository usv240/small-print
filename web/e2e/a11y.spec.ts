// Accessibility smoke checks (not a full audit).

import { expect, test, type Page } from '@playwright/test';
import { answerSafety, mockApi } from './helpers';

async function expectNamedButtons(page: Page): Promise<void> {
  const buttons = await page.getByRole('button').all();
  expect(buttons.length).toBeGreaterThan(0);
  for (const b of buttons) await expect(b).toHaveAccessibleName(/\S/);
}

test('welcome: one h1, named buttons, lang follows the language picker', async ({ page }) => {
  await mockApi(page);
  await page.goto('/test.html?dev');

  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Find your reading glasses strength');
  await expectNamedButtons(page);
  await expect(page.getByRole('combobox', { name: 'Language' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  await page.getByRole('combobox', { name: 'Language' }).selectOption('es');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('Find your reading glasses strength');
  await expectNamedButtons(page);

  // The choice is remembered on reload.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
});

test('safety and age screens: one h1 and named controls', async ({ page }) => {
  await mockApi(page);
  await page.goto('/test.html?demo&dev');

  await expect(page.locator('h1')).toHaveCount(1);
  for (const r of await page.getByRole('radio').all()) await expect(r).toHaveAccessibleName(/\S/);
  await answerSafety(page);
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.locator('h1')).toHaveCount(1);
  await expectNamedButtons(page);
  await expect(page.getByRole('slider', { name: 'How old are you?' })).toBeVisible();
});

// APP BUG (src/app.ts boot): the demo bar's label and note are translated once at boot, so after picking
// another language on the welcome screen, "Try without a camera" shows them in the old language until a
// reload. Arrow buttons on the small-print screen also have English-only aria-labels ("up", "left", …).
// Fix: move the demo-bar text sync into setLang()/enterDemo(), and use t() for the arrow labels.
test('demo bar follows a language switch made on the welcome screen', async ({ page }) => {
  await mockApi(page);
  await page.goto('/test.html?dev');
  await page.getByRole('combobox', { name: 'Language' }).selectOption('es');
  await page.locator('#demo').click();
  await expect(page.locator('#demo-label')).toHaveText('Distancia desde sus ojos'); // actual: "Distance from your eyes"
});
