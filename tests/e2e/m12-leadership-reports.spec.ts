import { test, expect } from '@playwright/test';

// M12 leadership reports — surface tests. Live generation flow + payload
// rendering verified manually against the deploy. CI covers role gating
// per §3.17 + §7.4.
//
// Visibility rules:
//   - /admin/reports*           → admin only (admin layout requireRole)
//   - /reports/leadership       → admin + leadership + bd_head; bd_manager 404
//   - /reports/leadership/[id]  → same; viewer also blocks drafts for
//                                  non-admin roles (notFound at the page level)

test.describe('M12 leadership reports — role gating', () => {
  test('admin sees /admin/reports', async ({ context, page }) => {
    await context.addCookies([
      { name: 'agsi_dev_role', value: 'admin', url: 'http://localhost:3000' },
    ]);
    await page.goto('/admin/reports');
    await expect(
      page.getByRole('heading', { name: 'Leadership reports' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: '+ New report' })).toBeVisible();
  });

  test('bd_head cannot reach /admin/reports (404)', async ({ context, page }) => {
    await context.addCookies([
      { name: 'agsi_dev_role', value: 'bd_head', url: 'http://localhost:3000' },
    ]);
    const response = await page.goto('/admin/reports');
    expect(response?.status()).toBe(404);
  });

  test('leadership cannot reach /admin/reports/new (404)', async ({ context, page }) => {
    await context.addCookies([
      { name: 'agsi_dev_role', value: 'leadership', url: 'http://localhost:3000' },
    ]);
    const response = await page.goto('/admin/reports/new');
    expect(response?.status()).toBe(404);
  });

  test('leadership sees /reports/leadership archive', async ({ context, page }) => {
    await context.addCookies([
      { name: 'agsi_dev_role', value: 'leadership', url: 'http://localhost:3000' },
    ]);
    await page.goto('/reports/leadership');
    await expect(
      page.getByRole('heading', { name: 'Leadership reports' }),
    ).toBeVisible();
  });

  test('bd_head sees /reports/leadership archive', async ({ context, page }) => {
    await context.addCookies([
      { name: 'agsi_dev_role', value: 'bd_head', url: 'http://localhost:3000' },
    ]);
    await page.goto('/reports/leadership');
    await expect(
      page.getByRole('heading', { name: 'Leadership reports' }),
    ).toBeVisible();
  });

  test('bd_manager cannot reach /reports/leadership (404)', async ({ context, page }) => {
    await context.addCookies([
      { name: 'agsi_dev_role', value: 'bd_manager', url: 'http://localhost:3000' },
    ]);
    const response = await page.goto('/reports/leadership');
    expect(response?.status()).toBe(404);
  });

  test('bd_manager cannot reach a specific report URL (404)', async ({ context, page }) => {
    await context.addCookies([
      { name: 'agsi_dev_role', value: 'bd_manager', url: 'http://localhost:3000' },
    ]);
    const response = await page.goto(
      '/reports/leadership/00000000-0000-0000-0000-000000000000',
    );
    expect(response?.status()).toBe(404);
  });
});
