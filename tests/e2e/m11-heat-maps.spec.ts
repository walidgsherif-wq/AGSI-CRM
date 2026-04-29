import { test, expect } from '@playwright/test';

// M11 heat-map surface tests. Live data (city dot positions, level
// distribution counts, engagement freshness cells) requires seeded
// companies + city_lookup + engagements; verified manually against
// the deploy. CI covers route gating per §17 risk register R-3 —
// bd_manager must be fully blocked from /insights/maps.

test.describe('M11 heat maps — role gating', () => {
  for (const path of [
    '/insights/maps/geographic',
    '/insights/maps/level-distribution',
    '/insights/maps/engagement-freshness',
  ]) {
    test(`admin sees ${path}`, async ({ context, page }) => {
      await context.addCookies([
        { name: 'agsi_dev_role', value: 'admin', url: 'http://localhost:3000' },
      ]);
      await page.goto(path);
      await expect(page.getByRole('button', { name: 'Export PNG' })).toBeVisible();
    });

    test(`leadership sees ${path}`, async ({ context, page }) => {
      await context.addCookies([
        { name: 'agsi_dev_role', value: 'leadership', url: 'http://localhost:3000' },
      ]);
      await page.goto(path);
      await expect(page.getByRole('button', { name: 'Export PNG' })).toBeVisible();
    });

    test(`bd_head sees ${path}`, async ({ context, page }) => {
      await context.addCookies([
        { name: 'agsi_dev_role', value: 'bd_head', url: 'http://localhost:3000' },
      ]);
      await page.goto(path);
      await expect(page.getByRole('button', { name: 'Export PNG' })).toBeVisible();
    });

    test(`bd_manager cannot reach ${path} (404)`, async ({ context, page }) => {
      await context.addCookies([
        { name: 'agsi_dev_role', value: 'bd_manager', url: 'http://localhost:3000' },
      ]);
      const response = await page.goto(path);
      expect(response?.status()).toBe(404);
    });
  }
});
