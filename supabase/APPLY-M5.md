# M5 — BNC upload pipeline

The M5 code is in: admin upload form, server-side XLSX parsing, project +
company resolver, match queue UI. Three short user-side steps to enable it
on your live Supabase + Vercel deploy.

## Step 1 — Create the storage bucket

The pipeline writes the original .xlsx to a private bucket so admins can
re-download / re-process later.

1. Supabase dashboard → **Storage** → **New bucket**
2. Name: `bnc-uploads`
3. Public: **off** (uncheck the public toggle)
4. File size limit: **50 MB**
5. Allowed MIME types: leave blank (or paste `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel`)
6. **Save**

## Step 2 — Apply migration `0025_bnc_match_rpc.sql`

Adds the fuzzy-match RPC the Stage C resolver calls, plus admin-only RLS
policies on the `bnc-uploads` bucket.

1. Open https://github.com/walidgsherif-wq/agsi-crm/blob/claude/resume-agsi-crm-build-TQ28J/supabase/migrations/0025_bnc_match_rpc.sql
2. Click **Raw** → select all → copy
3. Supabase dashboard → **SQL Editor** → **New query** → paste → **Run**
4. Expect: `Success. No rows returned.`

## Step 3 — Smoke-test the upload

Vercel auto-deploys when this branch pushes; give it ~1 minute.

1. Open https://agsi-crm.vercel.app/admin/uploads
2. Click **Choose file** → select your real BDM-Market-Database export
3. Pick a **File date** (the week the export represents — e.g. today)
4. Click **Upload + process**
5. Wait. The button shows "Processing… (up to 60s)". For ~500 rows this
   takes 20–40s; larger files may exceed the 60s Vercel limit and fail. If
   yours is larger, split the spreadsheet first or wait for the v1.1
   Edge Function migration.
6. On success, you land on the upload's detail page:
   - Status badge = **completed**
   - Stat tiles populate: rows / new projects / unmatched companies / etc.
   - If unmatched > 0, a "Match queue" card appears with a button to review.
7. Open `/companies` — you should see the BNC-imported companies appearing
   in the list (they'll have `source = 'bnc_upload'`, no owner, level L0).
8. Open `/projects` — same: imported projects with their stage, value, and
   linked-companies on the detail page.

## Step 4 — Resolve any unmatched companies

Click "Open match queue →" or visit `/admin/companies/merge`.

For each pending row:
- **Approve match** — accepts the suggested existing company. Adds the raw
  BNC name as an alias so the next upload auto-matches. (The current
  upload's project link is created on the next upload — for v1 simplicity.)
- **Create as new** — creates a new company with the type you select from
  the dropdown.
- **Reject** — discards the row. No DB-side mutation.

## What if the file is larger than ~500 rows?

Vercel's 60s API timeout is the bottleneck. Two options:
- **Split the file** — open in Excel, save the first 500 rows as
  `BDM-Market-Part1.xlsx`, the next 500 as `Part2.xlsx`, etc. Upload each
  separately. Each part gets its own `bnc_uploads` row in history.
- **Migrate to Edge Function** (v1.1 polish) — Supabase Edge Functions get
  150s on free tier and unlimited on paid. Same code, same logic, just
  longer ceiling. Defer to a polish milestone unless this becomes a daily
  blocker.

## Troubleshooting

- **"Storage upload failed: Bucket not found"** — Step 1 wasn't completed.
  Create the bucket and retry.
- **"new row violates row-level security policy"** on storage — Step 2 wasn't
  applied (or pg_cron blocked the storage policy block). Re-run migration
  0025; it's idempotent.
- **"Could not locate header row"** — the parser scanned the first 10 rows
  for a header containing "Reference Number" or "Project Name" and didn't
  find it. Make sure your headers are in row 1–10 of the first sheet.
- **Function timed out** — file too large. Split it.
- **Unknown stage strings** — non-fatal. They map to `concept` and appear in
  the upload's "Warnings / errors" panel as `unknown:<original>`.

## Reply to me

- **"M5 verified"** — I close it out (flip README, mark M6 next).
- A specific bug — paste the error from the upload's detail page (the
  "Warnings / errors" panel) and I'll fix.
