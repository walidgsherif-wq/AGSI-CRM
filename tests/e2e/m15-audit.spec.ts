import { test, expect } from '@playwright/test';

// M15 audit log surface tests. Live row content + filter behavior is
// verified manually against the deploy. CI covers role gating + page
// rendering with empty state copy.

test.describe('M15 audit log — admin only', () => {
  test('admin sees /admin/audit', async ({ context, page }) => {
    await context.addCookies([
      { name: 'agsi_dev_role', value: 'admin', url: 'http://localhost:3000' },
    ]);
    await page.goto('/admin/audit');
    await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible();
    await expect(page.getByText('Filters')).toBeVisible();
    await expect(page.getByText('Events')).toBeVisible();
  });

  test('bd_head cannot reach /admin/audit (404)', async ({ context, page }) => {
    await context.addCookies([
      { name: 'agsi_dev_role', value: 'bd_head', url: 'http://localhost:3000' },
    ]);
    const response = await page.goto('/admin/audit');
    expect(response?.status()).toBe(404);
  });

  test('leadership cannot reach /admin/audit (404)', async ({ context, page }) => {
    await context.addCookies([
      { name: 'agsi_dev_role', value: 'leadership', url: 'http://localhost:3000' },
    ]);
    const response = await page.goto('/admin/audit');
    expect(response?.status()).toBe(404);
  });

  test('bd_manager cannot reach /admin/audit (404)', async ({ context, page }) => {
    await context.addCookies([
      { name: 'agsi_dev_role', value: 'bd_manager', url: 'http://localhost:3000' },
    ]);
    const response = await page.goto('/admin/audit');
    expect(response?.status()).toBe(404);
  });
});
