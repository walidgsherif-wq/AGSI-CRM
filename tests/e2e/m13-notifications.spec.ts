import { test, expect } from '@playwright/test';

// M13 notification UI surface tests. End-to-end fan-out + bell polling
// tied to real Realtime/RLS rows is verified manually against the
// deploy. CI covers role gating + page rendering.

test.describe('M13 notifications — surface gates', () => {
  test('admin sees /admin/notifications-eval', async ({ context, page }) => {
    await context.addCookies([
      { name: 'agsi_dev_role', value: 'admin', url: 'http://localhost:3000' },
    ]);
    await page.goto('/admin/notifications-eval');
    await expect(
      page.getByRole('heading', { name: 'Notifications eval' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Run stagnation eval' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Run composition warning' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Run composition drift' }),
    ).toBeVisible();
  });

  test('bd_head cannot reach /admin/notifications-eval (404)', async ({
    context,
    page,
  }) => {
    await context.addCookies([
      { name: 'agsi_dev_role', value: 'bd_head', url: 'http://localhost:3000' },
    ]);
    const response = await page.goto('/admin/notifications-eval');
    expect(response?.status()).toBe(404);
  });

  test('bd_manager sees /notifications inbox', async ({ context, page }) => {
    await context.addCookies([
      { name: 'agsi_dev_role', value: 'bd_manager', url: 'http://localhost:3000' },
    ]);
    await page.goto('/notifications');
    await expect(
      page.getByRole('heading', { name: 'Notifications' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mark all read' })).toBeVisible();
  });

  test('all roles see /settings/notifications', async ({ context, page }) => {
    await context.addCookies([
      { name: 'agsi_dev_role', value: 'leadership', url: 'http://localhost:3000' },
    ]);
    await page.goto('/settings/notifications');
    await expect(
      page.getByRole('heading', { name: 'Notifications' }).first(),
    ).toBeVisible();
    await expect(page.getByText('Notification catalogue')).toBeVisible();
  });
});
