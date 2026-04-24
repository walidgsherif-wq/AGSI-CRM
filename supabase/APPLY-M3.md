# M3 — Apply the auth trigger

One short migration this time (≈40 lines). It adds a database trigger that
auto-creates a `profiles` row whenever someone signs in for the first time,
and sets your email to role=admin while everyone else defaults to role=
bd_manager.

## Step 1 — Paste the migration

1. Go to
   https://github.com/walidgsherif-wq/AGSI-CRM/blob/claude/agsi-crm-architecture-mQH3U/supabase/migrations/0024_auth_handle_new_user.sql
2. Click **Raw** → select all → copy
3. Supabase dashboard → **SQL Editor** → **New query** → paste → **Run**
4. Expect: **"Success. No rows returned"**

## Step 2 — Deploy the app

The app needs to be reachable at a URL so you can click the magic link in
your inbox and land on `/auth/callback`. Options:

### Easiest — one-click Vercel deploy

1. Go to https://vercel.com → Sign up with GitHub → **Import Project** →
   pick `walidgsherif-wq/AGSI-CRM`
2. Choose branch: `claude/agsi-crm-architecture-mQH3U`
3. Framework preset: **Next.js** (auto-detected)
4. Environment variables — add these three (copy-paste from your `.env.local`,
   or regenerate from Supabase dashboard):
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://lqvqhwvofsxbqhhbeyda.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = your publishable key
   - `SUPABASE_SERVICE_ROLE_KEY` = your secret key
   - `NEXT_PUBLIC_SITE_URL` = leave blank for now, set after the first deploy
5. Click **Deploy**. Vercel gives you a URL like `https://agsi-crm-abc123.vercel.app`
6. Copy that URL and edit the `NEXT_PUBLIC_SITE_URL` env var in Vercel →
   redeploy (or edit and it auto-redeploys)

### Tell Supabase where the app lives

Supabase needs to know which URLs it's allowed to redirect magic-link
emails to:

1. Supabase dashboard → **Authentication** → **URL Configuration**
2. **Site URL**: paste your Vercel URL
3. **Redirect URLs**: add `https://<your-vercel-url>/auth/callback`
4. Save

## Step 3 — Test the login

1. Open `https://<your-vercel-url>/` — it should redirect to `/login`
2. Enter **walid.g.sherif@gmail.com**
3. Click **"Send sign-in link"** — you should see a "Check your inbox" screen
4. Check your Gmail for a message from Supabase (subject: "Confirm your
   signup" or similar). It may take 30-60 seconds; check Spam if needed.
5. Click the link. You'll be redirected to `/dashboard`
6. Sidebar should show your name + "Admin" role + full admin navigation

## If something fails

Common issues:

- **No email arrives**: Supabase free tier sends 2 emails/hour max via their
  built-in mailer. If you've tested other projects recently you might be rate
  limited. Wait 30min or upgrade to pro.
- **Landed on /login with ?error=profile_missing**: The 0024 trigger didn't
  run. Re-run the migration from Step 1.
- **Landed on /login with ?error=...**: paste the URL to me, I'll diagnose.
- **500 error after clicking link**: probably a Vercel env var is missing.
  Double-check the three in Step 2 point 4.

## Reply to me

- **"logged in as admin"** — M3 done, onto M4
- Paste the specific error you see — I'll fix it
