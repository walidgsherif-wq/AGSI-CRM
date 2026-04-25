import { test, expect } from '@playwright/test';

// M5 surface tests. The full upload + processing round-trip is verified
// against the live Vercel + Supabase deploy with a real .xlsx file (see
// supabase/APPLY-M5.md). CI just checks the role gates and page renders.

test.describe('M5 BNC uploads', () => {
  test('admin sees /admin/uploads with the upload form', async ({ context, page }) => {
    await context.addCookies([
      { name: 'agsi_dev_role', value: 'admin', url: 'http://localhost:3000' },
    ]);
    await page.goto('/admin/uploads');
    await expect(page.getByRole('heading', { name: 'BNC Uploads' })).toBeVisible();
    await expect(page.getByLabel('XLSX file')).toBeVisible();
    await expect(page.getByLabel('File date', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Upload + process' })).toBeVisible();
  });

  test('admin sees /admin/companies/merge with status tabs', async ({ context, page }) => {
    await context.addCookies([
      { name: 'agsi_dev_role', value: 'admin', url: 'http://localhost:3000' },
    ]);
    await page.goto('/admin/companies/merge');
    await expect(page.getByRole('heading', { name: 'Match queue' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'pending' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'merged' })).toBeVisible();
  });

  test('bd_manager hitting /admin/uploads is 404', async ({ context, page }) => {
    await context.addCookies([
      { name: 'agsi_dev_role', value: 'bd_manager', url: 'http://localhost:3000' },
    ]);
    const response = await page.goto('/admin/uploads');
    expect(response?.status()).toBe(404);
  });

  test('leadership hitting /admin/companies/merge is 404', async ({ context, page }) => {
    await context.addCookies([
      { name: 'agsi_dev_role', value: 'leadership', url: 'http://localhost:3000' },
    ]);
    const response = await page.goto('/admin/companies/merge');
    expect(response?.status()).toBe(404);
  });
});
