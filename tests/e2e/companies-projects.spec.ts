import { test, expect } from '@playwright/test';

// M4 surface tests. Asserts the list / new / detail routes render and respect
// role gates. Uses the dev-role cookie path so these don't depend on a real
// Supabase session — the actual CRUD round-trip is exercised against the
// Vercel deploy after seed-demo.sql is applied.

test.describe('M4 companies + projects', () => {
  test('admin sees Companies list with "New company" button', async ({ context, page }) => {
    await context.addCookies([
      { name: 'agsi_dev_role', value: 'admin', url: 'http://localhost:3000' },
    ]);
    await page.goto('/companies');
    await expect(page.getByRole('heading', { name: 'Companies' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'New company' })).toBeVisible();
  });

  test('admin sees Projects list with "New project" button', async ({ context, page }) => {
    await context.addCookies([
      { name: 'agsi_dev_role', value: 'admin', url: 'http://localhost:3000' },
    ]);
    await page.goto('/projects');
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'New project' })).toBeVisible();
  });

  test('admin can open the new-company form', async ({ context, page }) => {
    await context.addCookies([
      { name: 'agsi_dev_role', value: 'admin', url: 'http://localhost:3000' },
    ]);
    await page.goto('/companies/new');
    await expect(page.getByRole('heading', { name: 'New company' })).toBeVisible();
    await expect(page.getByLabel('Canonical name', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create company' })).toBeVisible();
  });

  test('admin can open the new-project form', async ({ context, page }) => {
    await context.addCookies([
      { name: 'agsi_dev_role', value: 'admin', url: 'http://localhost:3000' },
    ]);
    await page.goto('/projects/new');
    await expect(page.getByRole('heading', { name: 'New project' })).toBeVisible();
    await expect(page.getByLabel('Project name', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create project' })).toBeVisible();
  });

  test('leadership cannot reach the new-company form (404)', async ({ context, page }) => {
    await context.addCookies([
      { name: 'agsi_dev_role', value: 'leadership', url: 'http://localhost:3000' },
    ]);
    const response = await page.goto('/companies/new');
    expect(response?.status()).toBe(404);
  });

  test('leadership cannot reach the new-project form (404)', async ({ context, page }) => {
    await context.addCookies([
      { name: 'agsi_dev_role', value: 'leadership', url: 'http://localhost:3000' },
    ]);
    const response = await page.goto('/projects/new');
    expect(response?.status()).toBe(404);
  });
});
