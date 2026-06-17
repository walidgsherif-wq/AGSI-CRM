# Google OAuth sign-in

Replaces the magic-link email path with Google sign-in. Removes the dependency on outbound email entirely — useful when the sending domain (`agsi.ae`) is owned by someone else and SPF/DKIM/Return-Path DNS cannot be configured.

**Auth model after this**
1. Admin provisions a teammate at `/admin/users` → enters their **Gmail / Google Workspace email** and role. No email is sent.
2. Teammate goes to `/login`, clicks **Continue with Google**, signs in with that exact email.
3. Supabase links the Google identity to the pre-created `auth.users` row (matched by email). On return, `get-user.ts` finds their profile and lets them through.
4. A stranger who clicks **Continue with Google** with an un-provisioned address can complete the OAuth handshake but has no `profiles` row — `get-user.ts` redirects them to `/login?error=profile_missing` and they see no app data.

**Code is already shipped** in this PR. The work is configuration:
1. Google Cloud Console — OAuth consent screen + Client ID (10 min)
2. Supabase Dashboard — paste Client ID/Secret (1 min)
3. Provision yourself + teammates at `/admin/users` (1 min)

## Step 1 — Get the Supabase redirect URI

You'll paste this into Google's "Authorized redirect URIs". The format is:

```
https://<project-ref>.supabase.co/auth/v1/callback
```

Where to find `<project-ref>`:
- Supabase Dashboard → your project → **Settings** → **API** → **Project URL**.
- The URL looks like `https://abcdefghijklmno.supabase.co`. Append `/auth/v1/callback`.

Copy this — you need it in Step 2.

## Step 2 — Google Cloud Console

1. Go to https://console.cloud.google.com → pick (or create) a project. Suggested name: **AGSI CRM**.
2. **APIs & Services → OAuth consent screen**.
   - User type: **Internal** if the AGSI Workspace owns the project (preferred — only `@agsi.ae` accounts can sign in, no Google verification needed). **External** otherwise (anyone with Google can complete OAuth, but our invite-only gate still blocks them at the profile layer).
   - App name: `AGSI CRM`
   - User support email: yours
   - Authorized domains: `agsi.ae` (and your Vercel domain, e.g. `vercel.app`)
   - Developer contact email: yours
   - Scopes: leave defaults (email, profile, openid)
   - Save.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
   - Application type: **Web application**
   - Name: `AGSI CRM web`
   - Authorized JavaScript origins: add both
     - `http://localhost:3000`
     - `https://<your-vercel-prod-domain>` (e.g. `https://agsi-crm.vercel.app` or your custom domain)
   - Authorized redirect URIs: paste the Supabase callback from Step 1
     - `https://<project-ref>.supabase.co/auth/v1/callback`
   - Create.
4. Google shows you **Client ID** and **Client Secret** in a modal. Copy both — the secret is shown once.

## Step 3 — Supabase Dashboard

1. Supabase Dashboard → your project → **Authentication → Providers → Google**.
2. Toggle **Enable Sign in with Google** ON.
3. Paste **Client ID** and **Client Secret** from Step 2.
4. Leave **Skip nonce check** OFF.
5. **Save**.
6. **Authentication → URL Configuration**:
   - **Site URL**: your production URL (e.g. `https://agsi-crm.vercel.app`)
   - **Redirect URLs**: add
     - `http://localhost:3000/auth/callback`
     - `https://<your-vercel-prod-domain>/auth/callback`
     - any preview-deploy patterns you use, e.g. `https://*.vercel.app/auth/callback`

## Step 4 — Provision teammates

1. Sign in at `/login` with **Continue with Google** using your initial-admin Google account. The `0055` migration's bootstrap trigger gives you the admin profile automatically. (If your initial-admin email differs from your Google account, set `INITIAL_ADMIN_EMAIL` to your Google address before first sign-in, or invite yourself from the admin who's already bootstrapped.)
2. Go to `/admin/users`.
3. For each teammate: enter **Full name**, their **Google email**, pick **Role**, click **Send invite**. You'll see *"<name> provisioned. Tell them to sign in at /login with Google using <email>."*
4. Forward them the URL + a one-liner: *"Click Continue with Google."*

## Step 5 — Verify it works

1. **You**: sign in at `/login` with Google. You land on `/dashboard` as admin.
2. **A teammate** (or a Google throwaway you've provisioned): they go to `/login`, click **Continue with Google**, sign in. They land on `/dashboard` at the role you assigned.
3. **A stranger** (un-provisioned Google account): they click **Continue with Google**, complete the handshake, and land back on `/login?error=profile_missing` with the friendly *"No AGSI account found"* message. They see no app data.

If the teammate gets `profile_missing`:
- The email they signed in with doesn't match what you provisioned. Compare exactly (case + dots in Gmail addresses are normalised by Supabase but other variations are not).
- Or the `0055` bootstrap trigger fired before `app_settings.initial_admin_email` was set. Check `auth.users` for their row, then either re-invite at the correct email or insert a profile manually.

```sql
-- Did Supabase actually create the auth.users row?
SELECT id, email, created_at
  FROM auth.users
 WHERE email = 'THE_EMAIL'
 ORDER BY created_at DESC LIMIT 1;

-- Is the profile there?
SELECT id, email, role, is_active
  FROM public.profiles
 WHERE email = 'THE_EMAIL';
```

## Local development

Local Supabase (started by `supabase start`) doesn't run the Dashboard OAuth flow — there's no Google handshake for `localhost:54321`. Use the magic-link fallback on the login form (the "Sign in with email link instead" link) for local dev. The magic-link path still works; it's just hidden by default.

Production / staging (Vercel + Supabase Cloud) use the full Google flow as configured above.

## What this replaces

Before: magic-link email via Supabase default SMTP → `@agsi.ae` recipients got it in spam, no way to fix without DNS (SPF/DKIM/Return-Path on `agsi.ae`).

After: zero outbound email for auth. Google does the identity work. The magic-link fallback stays available as a "break-glass" option for users without Google access (e.g. an admin testing role behaviour locally), and will work once SMTP is sorted.

## Cost

Free. Google OAuth has no per-sign-in cost. Supabase auth is free at our user count.

## Roll-out

1. Do **Step 2** (Google Cloud) — pause once Client ID/Secret are in hand.
2. Do **Step 3** (Supabase Dashboard) — instant.
3. Do **Step 4** to provision yourself + one other teammate.
4. Run **Step 5** to verify the three personas (you / teammate / stranger).
5. Merge this PR.
