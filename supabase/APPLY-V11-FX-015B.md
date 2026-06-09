# v1.1 (FX-015b) — Category-scoped, upsert-safe upload

Adds a **Phase 6** to the BNC upload Edge Function that clears
`has_active_projects = false` on companies absent from a file —
**scoped to only the categories the file covered**, with a typo guard
for queued matches, and a full audit trail.

No SQL migration. Edge Function redeploy only.

## What changed

- `supabase/functions/bnc-upload-process/index.ts` adds a Phase 6
  after the existing flush. It:
  1. Builds `protectedIds` = (matched + new) ∪ (queue-suggested ids
     created this upload).
  2. Reads the distinct `company_type` values among seen companies →
     the set of categories present.
  3. Pulls every company currently flagged `has_active_projects=true`
     in those categories, drops the protected set.
  4. Flips the rest to `has_active_projects=false` in chunks of 200
     (PostgREST URL limit).
  5. Writes one `audit_events` row per company:
     `event_type = 'company_active_projects_cleared'`,
     `before_json/after_json` showing the flag + reason + bnc upload
     id + the categories scope.
- Sanity stop: if zero project rows were processed (empty / broken
  file), Phase 6 is **skipped** entirely so a bad upload can't
  mass-deflate the dataset.

**Nothing else moves.** No `is_active` flip. No project deletions. No
sweep on categories the file didn't cover. No automated re-merge of
queued companies.

## Apply

1. Supabase Dashboard → **Edge Functions → bnc-upload-process →
   Code** tab.
2. Open the raw file in a new tab:
   https://raw.githubusercontent.com/walidgsherif-wq/AGSI-CRM/main/supabase/functions/bnc-upload-process/index.ts
3. Select-all → copy → paste over the editor → **Deploy**.

No SQL to run.

## Verify

After the next BNC upload, run in SQL Editor:

```sql
-- How many flips happened on the most recent upload?
SELECT
    a.entity_id,
    a.before_json ->> 'canonical_name'      AS company_name,
    a.after_json  ->> 'company_type'        AS category,
    a.after_json  ->> 'reason'              AS reason,
    a.occurred_at
  FROM audit_events a
 WHERE a.event_type = 'company_active_projects_cleared'
   AND a.after_json ->> 'bnc_upload_id' = (
       SELECT id::text FROM bnc_uploads ORDER BY uploaded_at DESC LIMIT 1
   )
 ORDER BY a.occurred_at
 LIMIT 50;

-- Sanity: companies in categories NOT covered by the upload should
-- never appear above. Categories actually covered are recorded in
-- after_json -> 'categories_in_upload'.
SELECT DISTINCT after_json -> 'categories_in_upload' AS categories_in_upload
  FROM audit_events
 WHERE event_type = 'company_active_projects_cleared'
   AND after_json ->> 'bnc_upload_id' = (
       SELECT id::text FROM bnc_uploads ORDER BY uploaded_at DESC LIMIT 1
   );
```

The processing summary on `/admin/uploads/<id>` will contain a new
line like:

> phase6 cleared has_active_projects on 47 developer/main_contractor
> companies absent from this upload in 0.4s

or the skip message if Phase 6 was bypassed.

## Reply

- **"phase6 verified"** once you've redeployed + uploaded a test
  file → I'll move on.
- If anything looks wrong, paste the relevant audit row or warning
  and I'll dig.
