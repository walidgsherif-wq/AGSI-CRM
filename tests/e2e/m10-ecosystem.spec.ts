import { test, expect } from '@playwright/test';

// M10 ecosystem awareness surface tests. Live numbers (lifetime/active
// scores, segmentation breakdowns, recharts SVGs) require seeded
// ecosystem_events; that path is verified manually against the deploy.
// CI covers role gating per the §3.16 RLS contract — bd_manager must
// be fully blocked at every entry point (R-3 risk register).

test.describe('M10 ecosystem awareness — role gating', () => {
  test('admin sees the /insights/ecosystem page', async ({ context, page }) => {
    await context.addCookies([
      { name: 'agsi_dev_role', value: 'admin', url: 'http://localhost:3000' },
    ]);
    await page.goto('/insights/ecosystem');
    await expect(
      page.getByRole('heading', { name: 'Ecosystem awareness' }).first(),
    ).toBeVisible();
  });

  test('leadership sees /insights/ecosystem', async ({ context, page }) => {
    await context.addCookies([
      { name: 'agsi_dev_role', value: 'leadership', url: 'http://localhost:3000' },
    ]);
    await page.goto('/insights/ecosystem');
    await expect(
      page.getByRole('heading', { name: 'Ecosystem awareness' }).first(),
    ).toBeVisible();
  });

  test('bd_head sees /insights/ecosystem', async ({ context, page }) => {
    await context.addCookies([
      { name: 'agsi_dev_role', value: 'bd_head', url: 'http://localhost:3000' },
    ]);
    await page.goto('/insights/ecosystem');
    await expect(
      page.getByRole('heading', { name: 'Ecosystem awareness' }).first(),
    ).toBeVisible();
  });

  test('bd_manager cannot reach /insights/ecosystem (404)', async ({ context, page }) => {
    await context.addCookies([
      { name: 'agsi_dev_role', value: 'bd_manager', url: 'http://localhost:3000' },
    ]);
    const response = await page.goto('/insights/ecosystem');
    expect(response?.status()).toBe(404);
  });

  test('bd_manager cannot reach /admin/ecosystem-rebuild (404)', async ({ context, page }) => {
    await context.addCookies([
      { name: 'agsi_dev_role', value: 'bd_manager', url: 'http://localhost:3000' },
    ]);
    const response = await page.goto('/admin/ecosystem-rebuild');
    expect(response?.status()).toBe(404);
  });

  test('leadership cannot reach /admin/ecosystem-rebuild (404)', async ({ context, page }) => {
    await context.addCookies([
      { name: 'agsi_dev_role', value: 'leadership', url: 'http://localhost:3000' },
    ]);
    const response = await page.goto('/admin/ecosystem-rebuild');
    expect(response?.status()).toBe(404);
  });
});
