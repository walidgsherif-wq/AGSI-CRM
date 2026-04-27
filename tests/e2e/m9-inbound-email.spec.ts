import { test, expect } from '@playwright/test';

// M9 inbound-email surface tests. End-to-end webhook flow (Postmark
// → /api/inbound-email → engagement created or queued in
// inbound_email_unmatched) is verified manually against the Vercel
// + Supabase + Postmark deploy. CI covers role gating on the admin
// review queue.

test.describe('M9 inbound email — admin queue', () => {
  test('admin sees /admin/inbound-email', async ({ context, page }) => {
    await context.addCookies([
      { name: 'agsi_dev_role', value: 'admin', url: 'http://localhost:3000' },
    ]);
    await page.goto('/admin/inbound-email');
    await expect(
      page.getByRole('heading', { name: 'Inbound emails', exact: true }),
    ).toBeVisible();
  });

  test('bd_head cannot reach /admin/inbound-email (404)', async ({ context, page }) => {
    await context.addCookies([
      { name: 'agsi_dev_role', value: 'bd_head', url: 'http://localhost:3000' },
    ]);
    const response = await page.goto('/admin/inbound-email');
    expect(response?.status()).toBe(404);
  });

  test('bd_manager cannot reach /admin/inbound-email (404)', async ({ context, page }) => {
    await context.addCookies([
      { name: 'agsi_dev_role', value: 'bd_manager', url: 'http://localhost:3000' },
    ]);
    const response = await page.goto('/admin/inbound-email');
    expect(response?.status()).toBe(404);
  });
});
