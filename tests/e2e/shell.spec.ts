import { test, expect } from '@playwright/test';

// M1 smoke: verify the shell loads and the sidebar adapts to each role via
// the dev-role cookie. Full auth-driven role tests land in M2.

test.describe('M1 shell', () => {
  test('root redirects to dashboard', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('admin sees every sidebar item including Admin', async ({ context, page }) => {
    await context.addCookies([
      { name: 'agsi_dev_role', value: 'admin', url: 'http://localhost:3000' },
    ]);
    await page.goto('/dashboard');
    for (const label of [
      'Dashboard',
      'Pipeline',
      'Companies',
      'Projects',
      'Tasks',
      'Insights',
      'Maps',
      'Reports',
      'Settings',
      'Admin',
    ]) {
      await expect(page.getByRole('link', { name: label })).toBeVisible();
    }
  });

  test('bd_manager cannot see Admin, Reports, or Maps items', async ({ context, page }) => {
    await context.addCookies([
      { name: 'agsi_dev_role', value: 'bd_manager', url: 'http://localhost:3000' },
    ]);
    await page.goto('/dashboard');
    await expect(page.getByRole('link', { name: 'Admin' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Reports' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Maps' })).toHaveCount(0);
  });

  test('bd_manager hitting /admin/users is 404', async ({ context, page }) => {
    await context.addCookies([
      { name: 'agsi_dev_role', value: 'bd_manager', url: 'http://localhost:3000' },
    ]);
    const response = await page.goto('/admin/users');
    expect(response?.status()).toBe(404);
  });

  test('leadership cannot see Pipeline or Tasks items', async ({ context, page }) => {
    await context.addCookies([
      { name: 'agsi_dev_role', value: 'leadership', url: 'http://localhost:3000' },
    ]);
    await page.goto('/dashboard');
    await expect(page.getByRole('link', { name: 'Pipeline' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Tasks' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Reports' })).toBeVisible();
  });
});
