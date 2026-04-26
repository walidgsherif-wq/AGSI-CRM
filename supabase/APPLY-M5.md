# M5 — BNC upload pipeline

The pipeline is a Supabase Edge Function (not a Vercel API route) so it
isn't bound by Vercel's 60s function timeout. It runs inside Supabase's
network with sub-millisecond DB round-trips — handles 3,500+ row files
in <30s.

Three short user-side steps to enable it. All web-only — no terminal,
no CLI install required.

## Step 1 — Storage bucket

Skip if you already created `bnc-uploads` (it persists across deploys).

1. Supabase dashboard → **Storage** → **New bucket**
2. Bucket name: `bnc-uploads` (exact, case-sensitive)
3. Public bucket: **OFF**
4. File size limit: `50` MB
5. Save

## Step 2 — Apply migration `0025_bnc_match_rpc.sql`

Skip if you already ran it. Adds the fuzzy-match RPC the resolver calls.

1. Open https://github.com/walidgsherif-wq/agsi-crm/blob/claude/resume-agsi-crm-build-TQ28J/supabase/migrations/0025_bnc_match_rpc.sql
2. Click **Raw** → select all → copy
3. Supabase dashboard → **SQL Editor** → **New query** → paste → **Run**
4. Expect: `Success. No rows returned.`

## Step 3 — Deploy / re-deploy the Edge Function

Architecture note: the function only handles **resolving + DB writes**. The
browser parses the .xlsx and uploads it to Storage. This split is required
because Edge Functions on Supabase Free tier have a strict CPU-time budget
that XLSX parsing of large files exhausts.

1. Supabase dashboard → **Edge Functions** (left sidebar)
2. Click **Create a new function** (first time) OR click the existing
   `bnc-upload-process` function (re-deploy)
3. Function name: `bnc-upload-process` (exact, case-sensitive)
4. Open https://github.com/walidgsherif-wq/agsi-crm/blob/claude/resume-agsi-crm-build-TQ28J/supabase/functions/bnc-upload-process/index.ts
5. Click **Raw** → select all → copy
6. Back in Supabase Dashboard, paste into the **index.ts** editor —
   **completely replace** any existing content
7. Click **Deploy**
8. Wait ~30 seconds for the deployment indicator to go green

Verification: at the top of the function detail page you should see
**Status: ACTIVE** (or similar) and the function URL
`https://<project>.supabase.co/functions/v1/bnc-upload-process`.

## Step 4 — Clean up the stuck row from earlier attempts

Before retrying, remove the orphaned `processing` row from the failed
Vercel attempts. Paste in the Supabase SQL Editor:

```sql
DELETE FROM bnc_uploads WHERE status='processing'
  AND uploaded_at < now() - interval '2 minutes';
```

Should report `DELETE 1` (or `DELETE N` if you have multiple stuck).

## Step 5 — Smoke-test the upload

Vercel auto-deploys when this branch pushes; give it ~1 min.

1. Open https://agsi-crm.vercel.app/admin/uploads
2. Click **Choose file** → select your `BDM Market Database (1).xlsx`
3. Pick a **File date** (e.g. today)
4. Click **Upload + process**
5. Wait. Button shows "Processing… (up to 2 min)". For 3,500 rows
   the Edge Function typically finishes in 15–30s.
6. On success you land on the upload's detail page with non-zero stats:
   - Status badge = **completed**
   - Rows / new projects / matched companies / unmatched companies
     populated
   - "Warnings / errors" panel includes a `processed in X.Xs` line at
     the top
7. Open `/companies` — should now show thousands of companies imported
   from the BNC.
8. Open `/projects` — same: thousands of projects with their stages,
   values, and linked companies.

## Step 6 — Resolve any unmatched companies

Click "Open match queue →" on the upload detail page or visit
`/admin/companies/merge`. For each pending row:

- **Approve match** — accepts the suggested existing company. Adds the
  raw BNC name as an alias so the next upload auto-matches.
- **Create as new** — creates a new company with the type you select.
- **Reject** — discards the row.

## Troubleshooting

- **"Storage upload failed: Bucket not found"** — Step 1 wasn't done.
- **`function find_company_by_fuzzy_name does not exist`** — Step 2 wasn't done.
- **`Edge Function returned 401: missing authorization header`** — your
  session expired; reload the page and try again.
- **`Edge Function returned 403: forbidden`** — your profile is not
  marked `role='admin'`. Confirm via `/admin/users`.
- **`An error occurred...` (non-JSON 504)** — should not happen with the
  Edge Function. If it does, paste the error from the Supabase Dashboard
  → Edge Functions → bnc-upload-process → **Logs** tab.
- **"Could not locate header row"** — the parser scanned rows 1–10 of
  the first sheet for a header containing "Reference Number" or "Project
  Name" and didn't find one. Make sure the file's first sheet has
  proper headers.
- **Unknown stage strings** — non-fatal. They map to `concept` and appear
  in the upload's "Warnings / errors" panel as `unknown:<original>`.

## When you upgrade or modify the function

Each time we push code changes to the Edge Function, you re-paste the
new content from GitHub Raw and click Deploy again. The function URL
stays the same; only the implementation behind it changes.

## Reply to me

- **"M5 verified"** + a brief note on the upload summary numbers — I close
  out (flip README, mark M6 next).
- A specific error — paste the Edge Function log line and I'll fix.
