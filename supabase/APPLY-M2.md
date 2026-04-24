# M2 — Apply the schema to your Supabase database

You'll do this once, using Supabase's web SQL Editor. ~5 minutes total.

## Step 1 — Enable two extensions (one-time, 30 seconds)

The app uses scheduled jobs (like the nightly KPI rebuild) which need two
built-in Postgres extensions. Enable them before running the SQL.

1. Open your Supabase project dashboard
2. Left sidebar → **Database** → **Extensions**
3. Search for **`pg_cron`** → flip the toggle **ON** (confirms via popup)
4. Search for **`pg_net`** → flip the toggle **ON**

You should see both in the "Enabled" list.

> If you can't find one of them, don't worry — the migration is written to
> skip cron registration if `pg_cron` is missing. It will apply cleanly
> either way. You can enable them later and re-run just the cron block.

## Step 2 — Open the SQL Editor

1. Left sidebar → **SQL Editor**
2. Click **"New query"** (top-right area)

## Step 3 — Paste and run

1. Open `supabase/apply-all.sql` in GitHub (or download from this branch)
2. Copy the **entire file** (it's ~2,200 lines — use Ctrl/Cmd + A to select all)
3. Paste into the SQL Editor
4. Click **"Run"** (bottom-right) or press Ctrl/Cmd + Enter
5. Wait 10-30 seconds. You should see **"Success. No rows returned"** or a
   similar success message

## If something fails

Copy the error message exactly and send it to me. Common ones:

- `extension "pg_cron" does not exist` — skipped Step 1. Go back and enable it.
- `permission denied to create extension` — normal on Supabase free tier for
  one or two extensions. Tell me which one and I'll work around it.
- `type "role_t" already exists` — you already ran the script once. Send the
  error and I'll tell you how to reset.

## When it works

Reply with "**done**" and I:

1. Verify from the app side by running a read query against a seeded table
2. Write the milestone-2 Playwright test that proves Row-Level Security is
   working (the right role sees the right rows, the wrong role sees nothing)
3. Commit + push M2 as complete and move to M3 (auth + invite flow)

## What the SQL does (for reference, no action required)

- Creates 4 extensions (pgcrypto, pg_trgm, citext, pg_cron, pg_net)
- Creates 20+ enum types (roles, levels, stages, etc.)
- Creates 22 tables with all the columns, indexes, and check constraints
  from the architecture docs
- Turns on Row-Level Security on every table
- Installs the four-role access policies from `03-rls-matrix.md`
- Installs the `change_company_level()` function and its guard trigger (so
  nobody can silently edit level without a history record)
- Installs the leadership-feedback column-mask trigger
- Registers 7 scheduled jobs (or skips if pg_cron is missing)
- Loads the seed: 12 playbook targets, 6 stagnation rules, 15 UAE cities,
  11 ecosystem point scales, 19 app_settings keys
