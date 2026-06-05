# v1.1 — BNC ingest: derive AED from USD at the dirham peg

BNC's mid-2026 export format dropped the `Value AED` column and now
publishes `Value(USD)` only. The §4.4 market snapshot sums
`projects.value_aed`, so every metric on `/insights` collapses to zero
for new uploads — the 2026-06-05 snapshot is the live evidence.

The UAE dirham is hard-pegged to USD at **3.6725** (locked since
1997 — never floats), so this is a one-liner: derive AED from USD at
ingest. The result is identical to what BNC used to publish.

This PR is **2 steps**: redeploy the Edge Function, then run a one-shot
backfill SQL to fix the projects already in the database from the
2026-06-05 upload.

## Step 1 — Redeploy `bnc-upload-process`

Same flow as v1.1 auto-snapshot (PR #24):

1. Supabase Dashboard → **Edge Functions → bnc-upload-process → Code** tab.
2. Open the raw file:
   https://raw.githubusercontent.com/walidgsherif-wq/AGSI-CRM/main/supabase/functions/bnc-upload-process/index.ts
3. Select all → copy → paste into the editor → **Deploy**.

## Step 2 — Backfill the already-ingested rows

The 2026-06-05 upload's 2698 projects landed with `value_aed = NULL`
because the old code ran on them. Run this once in the **SQL Editor**:

```sql
-- Backfill: any project with USD but missing AED → derive at the peg.
UPDATE projects
   SET value_aed = value_usd * 3.6725
 WHERE value_aed IS NULL
   AND value_usd IS NOT NULL;
```

Expect a row count of roughly 2698 (or more if older uploads also had
USD-only rows). Idempotent — running it twice is harmless.

## Step 3 — Regenerate the 2026-06-05 snapshot

1. Open `/admin/uploads` → click the 2026-06-05 upload.
2. Hit **Regenerate snapshot**.
3. Open `/insights` → snapshot dropdown → 2026-06-05. The pipeline
   trend should now show non-zero AED across the three lines.

## Verify

```sql
SELECT dimension_key,
       (metric_value_json->>'count')::int        AS project_count,
       (metric_value_json->>'value_aed')::numeric AS total_aed
  FROM market_snapshots
 WHERE snapshot_date = '2026-06-05'
   AND metric_code   = 'projects_by_stage'
 ORDER BY total_aed DESC NULLS LAST;
```

All four stages (`concept`, `design`, `tender`, `under_construction`)
should now have non-zero `total_aed`.

## Reply

- **"insights working"** → I'll move to the next item.
- If anything's still off, paste the new snapshot row and I'll dig.
