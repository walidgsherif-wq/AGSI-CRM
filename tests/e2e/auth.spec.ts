import { test, expect } from '@playwright/test';

// M3 auth surface tests. The full OAuth round-trip (Google consent ->
// /auth/callback -> /dashboard with profile loaded) requires a real
// Supabase project; that path is verified manually against the Vercel
// deploy. CI covers the deterministic surfaces below.

test.describe('M3 auth', () => {
  test('/login renders the Google sign-in form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  });

  test('/login shows the profile-missing card for unregistered users', async ({ page }) => {
    await page.goto('/login?error=profile_missing');
    await expect(
      page.getByRole('heading', { name: 'Your user profile is not registered' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Back to sign in' })).toBeVisible();
  });
});
