// Safety screening: red flags stop the test (and nothing is sent); softer risks advise an exam but allow continuing.

import { expect, test } from '@playwright/test';
import { answerSafety, mockApi } from './helpers';

test('sudden change → stop screen, no result posted', async ({ page }) => {
  const { hits } = await mockApi(page);
  await page.goto('/test.html?demo&dev');

  const next = page.getByRole('button', { name: 'Continue' });
  await expect(next).toBeDisabled(); // every question must be answered first
  await answerSafety(page, [/changed suddenly/]);
  await expect(next).toBeEnabled();
  await next.click();

  await expect(page.getByRole('heading', { level: 1, name: 'Please see an eye-care professional' })).toBeVisible();
  await expect(page.getByText('Reading glasses will not fix it.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue' })).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(hits).toEqual([]);

  // "Back" returns to the questions with the answers kept.
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('group', { name: /changed suddenly/ }).getByRole('radio', { name: 'Yes' })).toBeChecked();
});

test('diabetes only → advise screen with "Continue anyway"', async ({ page }) => {
  const { hits } = await mockApi(page);
  await page.goto('/test.html?demo&dev');

  await answerSafety(page, [/diabetes/]);
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'An eye exam is a good idea' })).toBeVisible();
  const go = page.getByRole('button', { name: 'Continue anyway' });
  await expect(go).toBeVisible();
  await go.click();
  await expect(page.getByRole('heading', { level: 1, name: 'How old are you?' })).toBeVisible();
  expect(hits).toEqual([]);
});
