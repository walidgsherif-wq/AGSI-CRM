# Engagement delete — audit log

Single new migration. Adds a `delete_engagement_with_audit()` function
that snapshots the engagement (and any captured email) into
`audit_events` before removing it. The CRM's "Delete engagement" button
in the engagement drawer calls this function instead of running a raw
`DELETE`.

## Step 1 — Apply migration `0033_engagement_delete_audit.sql`

1. Open https://github.com/walidgsherif-wq/AGSI-CRM/blob/main/supabase/migrations/0033_engagement_delete_audit.sql
2. Click **Raw** → select all → copy.
3. Supabase dashboard → **SQL Editor** → **New query** → paste → **Run**.
4. Expect: `Success. No rows returned.`

## What the function does

- **Permission check**: leadership can never delete; admin can delete
  any engagement; bd_head and bd_manager can only delete engagements
  they created.
- **Snapshot**: full row from `engagements` + the joined
  `engagement_emails` row (if any) is serialised into
  `audit_events.before_json`.
- **Delete**: `DELETE FROM engagements WHERE id = ?`. The
  `engagement_emails` row goes with it via `ON DELETE CASCADE`.

## Verifying it worked

After applying:

1. Open any engagement → **Delete engagement** → confirm.
2. Run this in the Supabase SQL Editor:

   ```sql
   SELECT id, event_type, entity_id, before_json -> 'summary' AS summary,
          actor_id, occurred_at
     FROM audit_events
    WHERE event_type = 'engagement_delete'
    ORDER BY occurred_at DESC
    LIMIT 5;
   ```

   You should see one row per delete, with the deleted summary visible
   in the `summary` column.

## Reading audit rows in the app

The `/admin/audit` page is currently a placeholder (lands as part of
M15). For now, query `audit_events` directly via the SQL Editor.
