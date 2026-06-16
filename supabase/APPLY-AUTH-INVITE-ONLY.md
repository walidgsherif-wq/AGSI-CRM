# Auth simplification — invite-only · magic-link · no self-signup

Three moving parts ship together: **login form**, **invite handler**, **profile trigger**. With the H1 read/write split landed, this closes the only remaining open door — the signup gate.

## What changes

| Layer | Before | After |
|---|---|---|
| `LoginForm.tsx` | `shouldCreateUser: true` (overrode `enable_signup=false`) | `shouldCreateUser: false`; unknown emails get a friendly "contact admin" message |
| `inviteUser()` server action | Role in `data` (user_metadata, user-editable). "Already exists" → silent success. | Role in `app_metadata` (admin-only). Already-exists → `generateLink({ type: 'magiclink' })` re-sends a fresh link. UI shows distinct "invited" vs "resent" messages. |
| `handle_new_user()` trigger | Any new `auth.users` → profile with default `role = bd_manager` | Bootstraps the **initial admin only**. Every other auth.users insert is a no-op (no profile created). |
| `supabase/config.toml` | `enable_signup = false` was already set ✓ | unchanged — the client now honours it |
| `get-user.ts` | Already bounces missing-profile sessions to `/login?error=profile_missing` ✓ | unchanged — defence-in-depth survives a stray `auth.users` row |

## Step 1 — Apply the migration

1. Raw: https://raw.githubusercontent.com/walidgsherif-wq/AGSI-CRM/main/supabase/migrations/0055_invite_only_trigger.sql
2. Paste into SQL Editor → Run. Expect "Success. No rows returned."
3. Idempotent (`CREATE OR REPLACE FUNCTION` + `DROP TRIGGER IF EXISTS`).

**Order note:** the Vercel deploy ships the code change automatically when the PR merges. You can apply the migration **before** or **after** the deploy; the new invite handler uses `UPSERT` on `profiles`, so a brief window where both old and new behaviour overlap won't break anything.

## Step 2 — Verify

### Existing users still sign in

Pick any of the 4 current users. Open `/login`, enter their email, click the link. Should sign in normally — **no behaviour change for the existing team**.

### Uninvited email gets the clean message

Open `/login` from incognito, enter `random@example.com`, submit. Expect:
- No magic-link email sent
- No `auth.users` row created
- Page shows: *"No AGSI account found for that email. Contact your administrator — access is invite-only."*

Verify the no-row claim via SQL Editor:

```sql
SELECT email, created_at FROM auth.users WHERE email = 'random@example.com';
-- Expect: 0 rows
```

### Invite flow — fresh user

In `/admin/users`, send an invite to a new email. Expect:
- Success message: *"Invite sent to <email>. They will receive an email shortly."*
- Verify via SQL:

```sql
SELECT u.email, u.raw_app_meta_data, p.role, p.invited_by, p.invited_at
  FROM auth.users u
  JOIN profiles p ON p.id = u.id
 WHERE u.email = '<the test email>';
-- Expect raw_app_meta_data to contain { role: '...', invited_by: '...', invited_at: '...' }
-- and the profile row to exist with the chosen role.
```

### Invite flow — already-registered user

Re-invite an existing teammate. Expect:
- Success message: *"<their name> already has an AGSI account (<role>). A fresh sign-in link was sent."*
- No duplicate `auth.users` row.

### Block the leak path

Try to sign in as an `auth.users` row with **no profile** (if any orphans exist from before this PR). The user is bounced to `/login?error=profile_missing` — they can authenticate but reach nothing past the login redirect.

## What this does NOT fix

**Email deliverability.** You're still on Supabase's default SMTP, which has ~3/hour rate limits and lands in spam on corporate Microsoft 365 filters. If invites continue to fail to arrive even though the SQL shows the user was created, that's a separate problem — solve it by configuring a custom SMTP provider (Resend / SES) in `[auth.smtp]` of `config.toml`, and verifying `agsi.ae` SPF + DKIM. I can ship that as a separate PR — say the word.

## Reply

- **"auth invite-only verified"** once the four checks above pass.
- Paste any failing SQL row or screenshot if not.
