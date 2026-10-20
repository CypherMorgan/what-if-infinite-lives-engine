import { test, expect } from '@playwright/test';

test('app loads and shows title', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.brand-mark')).toContainText('WHAT');
  await expect(page.locator('.brand-mark')).toContainText('IF?');
});

test('can open new universe modal', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /New/i }).first().click();
  await expect(page.getByText('New universe')).toBeVisible();
});
