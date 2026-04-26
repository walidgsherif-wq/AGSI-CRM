import { test, expect } from '@playwright/test';

// M7 surface tests. Real change_company_level flows verified manually
// against the live Supabase deploy.

test.describe('M7 pipeline + level history', () => {
  test('admin sees the Pipeline page with all six L columns', async ({ context, page }) => {
    await context.addCookies([
      { name: 'agsi_dev_role', value: 'admin', url: 'http://localhost:3000' },
    ]);
    await page.goto('/pipeline');
    await expect(page.getByRole('heading', { name: 'Pipeline' })).toBeVisible();
    // The 6 LevelBadge labels render in their column headers
    for (const lvl of ['L0', 'L1', 'L2', 'L3', 'L4', 'L5']) {
      await expect(page.getByText(lvl, { exact: true }).first()).toBeVisible();
    }
  });

  test('leadership cannot reach /pipeline (404)', async ({ context, page }) => {
    await context.addCookies([
      { name: 'agsi_dev_role', value: 'leadership', url: 'http://localhost:3000' },
    ]);
    const response = await page.goto('/pipeline');
    expect(response?.status()).toBe(404);
  });
});
