# Custom SMTP via Resend

Replaces Supabase's default email sender (rate-limited, lands in spam on `@agsi.ae`/M365) with Resend. After this, the invite + magic-link emails will reliably hit corporate inboxes.

**Code change is small** — Supabase Auth handles the SMTP itself. The work is configuration:
1. Resend account + verified sending domain (5 min)
2. SMTP creds in the Supabase Cloud Dashboard (1 min)
3. (Optional) `RESEND_API_KEY` in Vercel env vars — only needed for future app-side email use, not for auth

## Step 1 — Resend account + API key

1. Go to https://resend.com → sign up.
2. **Domains** → **Add Domain** → enter `agsi.ae`.
3. Resend shows you 3 DNS records to add:
   - `SPF` (TXT)
   - `DKIM` (CNAME or TXT, 1–2 records)
   - `Return-Path` (CNAME)
4. **Add them in your DNS host** (wherever `agsi.ae` is registered — Cloudflare, GoDaddy, Microsoft 365 admin, etc.). DNS propagation usually takes 5–30 min.
5. Back in Resend, click **Verify** next to each record until all green.
6. **API Keys** → **Create API Key** → name it `agsi-crm-prod`, scope **Sending access** for `agsi.ae`. Copy the key — you only see it once.

## Step 2 — Configure Supabase Cloud Dashboard

1. Supabase Dashboard → your project → **Authentication** → **Emails** → **SMTP Settings**.
2. Toggle **Enable Custom SMTP** ON.
3. Fill in:

   | Field | Value |
   |---|---|
   | Sender email | `no-reply@agsi.ae` |
   | Sender name | `AGSI CRM` |
   | Host | `smtp.resend.com` |
   | Port | `465` |
   | Username | `resend` |
   | Password | *(paste your Resend API key)* |
   | Minimum interval | `1` (1 email/sec is plenty) |

4. **Save**.
5. (Optional but recommended) **Authentication → Emails → Email Templates** — customise the **Invite user** and **Magic Link** templates so they read in AGSI's voice and link to the right URL. Variables to keep: `{{ .ConfirmationURL }}`.

## Step 3 — (Optional) Vercel env var

Only needed if/when we send app-side emails (notifications, leadership-report-ready, etc.). Not needed for auth.

1. Vercel → project → **Settings** → **Environment Variables**.
2. Add `RESEND_API_KEY` = *(same value as in Supabase Dashboard)*. Scope: Production + Preview.
3. Redeploy.

## Step 4 — Verify it works

Easiest path:

1. Pick a teammate or a Gmail throwaway. **It must NOT already exist in `auth.users`** so the fresh-invite path fires. If it does, click **Delete** next to them on `/admin/users` first.
2. `/admin/users` → invite the email.
3. Within ~30 seconds the inbox gets a message from `no-reply@agsi.ae` with subject like *"You've been invited"*. Click the link → lands on the app, signs in.

If it doesn't arrive:

```sql
-- Did Supabase Auth actually receive the request?
SELECT email, created_at, raw_app_meta_data
  FROM auth.users
 WHERE email = 'THE_INVITED_EMAIL'
 ORDER BY created_at DESC LIMIT 1;
```

- If the row is there but the email isn't → check **Resend dashboard → Emails** for delivery / bounce events. Most common cause: DNS records not fully propagated yet (wait 30 min, click Verify again).
- If the row is missing → the invite handler failed before reaching Supabase. Check the UI error message under the form; paste it to me.

## What still uses default SMTP

After Step 2, nothing — every auth-side email Supabase sends (invite, magic link, password reset, email-change confirmation) goes through Resend.

## Cost

Resend is free up to 3,000 emails / month, then $20 / mo for 50K. For an internal CRM with ~10 users this stays free indefinitely.

## Roll-out

1. Do **Step 1** (Resend + DNS) — wait for green DNS in Resend.
2. Do **Step 2** (Supabase Dashboard) — instant.
3. Run **Step 4** to verify with a real test invite.
4. Merge this PR (mostly documents what you just did).

The code change is just `config.toml` (for local-dev parity) + this doc + an updated `.env.example` comment. No application code touched.

## Reply when verified

- **"resend live"** once the test invite arrives in an `@agsi.ae` inbox.
- Paste the Resend dashboard error or Supabase auth log if something's off.
