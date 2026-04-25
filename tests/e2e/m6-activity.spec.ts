import { test, expect } from '@playwright/test';

// M6 surface tests. Real CRUD flows are verified manually against the live
// Supabase deploy after seed-demo.sql has been applied.

test.describe('M6 activity log', () => {
  test('global /tasks page renders for admin', async ({ context, page }) => {
    await context.addCookies([
      { name: 'agsi_dev_role', value: 'admin', url: 'http://localhost:3000' },
    ]);
    await page.goto('/tasks');
    await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'My tasks' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Whole team' })).toBeVisible();
  });

  test('leadership cannot reach /tasks (404)', async ({ context, page }) => {
    await context.addCookies([
      { name: 'agsi_dev_role', value: 'leadership', url: 'http://localhost:3000' },
    ]);
    const response = await page.goto('/tasks');
    expect(response?.status()).toBe(404);
  });
});
