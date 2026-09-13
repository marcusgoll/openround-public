import { expect, test } from '@playwright/test';
test('public shell uses native input and an accessible closable sheet', async ({ page }) => {
  await page.goto('/?variant=c');
  await page.getByRole('button', { name: 'START ROUND', exact: true }).click();
  await page.getByRole('button', { name: /ADD GOLFERS FOR SCORING/ }).click();
  const input = page.getByRole('textbox', { name: 'Golfer name' });
  await input.fill('Public demo');
  await expect(input).toHaveValue('Public demo');
  await expect(page.locator('img[src*="Keyboard"], img[src*="Bezel"]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('public shell fits phone portrait and landscape', async ({ page }) => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/?variant=c');
    await expect(page.getByRole('button', { name: 'START ROUND', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('dialog focuses inside and restores the opener when closed', async ({ page }) => {
  await page.goto('/tests/public-shell-fixture.html');
  const opener = page.getByRole('button', { name: 'Open form' });
  await opener.click();
  await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
});

test('tabbing between equipment fields retains native keyboard focus', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'DEMO ROUND' }).click();
  await page.getByRole('button', { name: /current club Driver.*tee shot is not locked/i }).click();
  await page.getByTestId('view-full-bag-from-club').click();
  await page.getByRole('button', { name: 'Edit 7 Iron' }).click();
  await page.getByLabel('CLUB NAME', { exact: true }).focus();
  await page.keyboard.press('Tab');
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(page.getByLabel('BRAND', { exact: true })).toBeFocused();
});


test('dialog traps keyboard navigation and reaches its last action in landscape', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/tests/public-shell-fixture.html');
  await page.getByRole('button', { name: 'Open form' }).click();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Last action' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Last action' }).click();
  await expect(page.getByRole('button', { name: 'Last action' })).toBeInViewport();
});
