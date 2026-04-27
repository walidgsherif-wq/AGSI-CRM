import { test, expect } from '@playwright/test';

// M9 surface tests. Real per-quarter drill-downs (BEI tiers, A/B/C/D
// actuals-vs-target, level transitions ledger) need seeded
// kpi_actuals + level_history rows; that path was verified manually
// against the live deploy. CI covers role gating + the hub.

test.describe('M9 reports + performance review', () => {
  test('admin sees the Reports hub', async ({ context, page }) => {
    await context.addCookies([
      { name: 'agsi_dev_role', value: 'admin', url: 'http://localhost:3000' },
    ]);
    await page.goto('/reports');
    await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible();
    await expect(page.getByText('Performance review by member')).toBeVisible();
  });

  test('leadership sees the Reports hub', async ({ context, page }) => {
    await context.addCookies([
      { name: 'agsi_dev_role', value: 'leadership', url: 'http://localhost:3000' },
    ]);
    await page.goto('/reports');
    await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible();
  });

  test('bd_manager cannot reach /reports (404)', async ({ context, page }) => {
    await context.addCookies([
      { name: 'agsi_dev_role', value: 'bd_manager', url: 'http://localhost:3000' },
    ]);
    const response = await page.goto('/reports');
    expect(response?.status()).toBe(404);
  });

  test('bd_manager cannot reach another user’s perf review (404)', async ({ context, page }) => {
    await context.addCookies([
      { name: 'agsi_dev_role', value: 'bd_manager', url: 'http://localhost:3000' },
    ]);
    // any UUID that isn't dev-bd_manager — gates on the role+id check
    // before the DB lookup runs.
    const response = await page.goto(
      '/reports/performance-review/00000000-0000-0000-0000-000000000000',
    );
    expect(response?.status()).toBe(404);
  });
});
