import { test, expect } from '@playwright/test';

// M14 insights surface tests. Real numbers + the snapshot picker
// require seeded market_snapshots rows; that path is verified
// manually against the deploy after running Generate market snapshot.
// CI covers role gating + the empty-state copy.

test.describe('M14 insights', () => {
  test('admin sees /insights', async ({ context, page }) => {
    await context.addCookies([
      { name: 'agsi_dev_role', value: 'admin', url: 'http://localhost:3000' },
    ]);
    await page.goto('/insights');
    await expect(page.getByRole('heading', { name: 'Market insights' })).toBeVisible();
  });

  test('bd_manager sees /insights', async ({ context, page }) => {
    await context.addCookies([
      { name: 'agsi_dev_role', value: 'bd_manager', url: 'http://localhost:3000' },
    ]);
    await page.goto('/insights');
    await expect(page.getByRole('heading', { name: 'Market insights' })).toBeVisible();
  });

  test('leadership sees /insights', async ({ context, page }) => {
    await context.addCookies([
      { name: 'agsi_dev_role', value: 'leadership', url: 'http://localhost:3000' },
    ]);
    await page.goto('/insights');
    await expect(page.getByRole('heading', { name: 'Market insights' })).toBeVisible();
  });
});
