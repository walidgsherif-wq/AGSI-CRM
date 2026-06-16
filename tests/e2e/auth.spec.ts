import { test, expect } from '@playwright/test';

// M3 auth surface tests. The full magic-link round-trip (email click →
// /auth/callback → /dashboard with profile loaded) requires a real Supabase
// project and inbox; that path was verified manually against the Vercel
// deploy. CI covers the deterministic surfaces below.

test.describe('M3 auth', () => {
  test('/login renders the sign-in form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Sign in with email link instead' }),
    ).toBeVisible();
  });

  test('/login surfaces the ?error= query param', async ({ page }) => {
    await page.goto('/login?error=profile_missing');
    await expect(page.getByText('profile_missing')).toBeVisible();
  });

  test('magic-link fallback toggles open and gates submit on email', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign in with email link instead' }).click();
    const button = page.getByRole('button', { name: 'Send sign-in link' });
    await expect(button).toBeDisabled();
    await page.getByLabel('Email address').fill('walid.g.sherif@gmail.com');
    await expect(button).toBeEnabled();
  });
});
