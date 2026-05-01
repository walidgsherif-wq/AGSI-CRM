# v1.1 #2 — BNC auto-snapshot on upload

The `bnc-upload-process` Edge Function now calls
`generate_market_snapshot(p_upload_id)` automatically when an upload
finishes processing — no more manual click on /admin/uploads/[id] for
new uploads.

**No SQL migration needed** for this change. The hook lives entirely
in the Edge Function code + the Next.js UI.

## Step 1 — Redeploy `bnc-upload-process` Edge Function

The Edge Function file at `supabase/functions/bnc-upload-process/index.ts`
needs to be redeployed so the new auto-snapshot block runs in
production.

1. https://github.com/walidgsherif-wq/AGSI-CRM/blob/claude/v11-bnc-auto-snapshot/supabase/functions/bnc-upload-process/index.ts
2. Click **Raw** → select all → copy.
3. Supabase Dashboard → **Edge Functions** → `bnc-upload-process` →
   **Edit** → paste the entire file → **Deploy**.
4. Wait for "Deployed" confirmation.

## Step 2 — Merge + auto-promote

Vercel auto-promotes from `main`. The UI changes (badge + adaptive
button label) will go live with the merge.

## Step 3 — Try it

1. Sidebar → **Admin → Uploads** → **Upload BNC file**.
2. Upload a fresh weekly XLSX. (Tick "reprocess intentional" if the
   file_date matches an existing upload.)
3. Wait for processing to complete.
4. Open the upload detail page. Under **Market snapshot** you should see:
   - **Generated** green badge,
   - text reading "auto-generated for `<file_date>` when this upload completed",
   - a secondary-styled **Regenerate snapshot** button (idempotent).
5. Open `/insights` — the snapshot for that file_date should be live
   immediately (no extra click).

For legacy uploads that ran before this change, the card shows
**Missing** amber badge + a primary **Generate market snapshot**
button — same as before. Click once to backfill.

## Verify in SQL Editor

```sql
SELECT u.id, u.filename, u.file_date, u.status,
       count(ms.*) AS snapshot_metric_rows
  FROM bnc_uploads u
  LEFT JOIN market_snapshots ms ON ms.snapshot_date = u.file_date
 GROUP BY u.id
 ORDER BY u.uploaded_at DESC
 LIMIT 10;
```

The most recent upload should have a non-zero `snapshot_metric_rows`
without anyone clicking anything.

## Reply to me

- **"v1.1 BNC auto-snapshot verified"** → I move to v1.1 #3 (PDF
  persisted to Supabase Storage on finalise).
- A specific glitch — paste what you see (especially the response body
  from a fresh upload, which now includes `snapshot_generated: true`).
