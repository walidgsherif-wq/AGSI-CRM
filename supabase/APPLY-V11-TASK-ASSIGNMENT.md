# v1.1 (FX-014b) — Head-of-BD task allocation

Lets admin / bd_head **assign a task to another BD member**. The
assignee sees it on their Tasks page with an "assigned by …" line,
and a `task_assigned` in-app notification fires through the existing
inbox.

bd_manager cannot assign to others — selector hidden in the UI **and**
RLS refuses the insert.

This PR has one migration (`0051_task_assignment.sql`) because the
existing `tasks` table couldn't distinguish "who's responsible" from
"who handed it over" — flagged in the PR description so it's not a
silent schema change.

## Step 1 — Apply `0051_task_assignment.sql`

1. Open the raw file:
   https://raw.githubusercontent.com/walidgsherif-wq/AGSI-CRM/main/supabase/migrations/0051_task_assignment.sql
2. Select all → copy → paste into Supabase **SQL Editor** → **Run**.
3. Expect "Success. No rows returned."

The migration is idempotent (`IF NOT EXISTS` on the column / index /
enum value; `DROP POLICY IF EXISTS` before re-CREATE; `CREATE OR
REPLACE FUNCTION`). Re-running is safe.

## Step 2 — Try it

1. Open `/companies/<any company>/tasks` as **admin** or **bd_head**.
2. The form's "Owner" field now reads **"Assign to"** with a
   dropdown of BD members.
3. Pick a different member → Save.
4. As that member, open `/tasks` (Mine) or `/notifications` — the
   task appears with "assigned by …" and an in-app notification.

As a **bd_manager**:
- The "Assign to" field is hidden; the form just shows your own name.
- The data layer (RLS) refuses any insert with `owner_id != you`,
  even if you craft the request manually.

## Verify in SQL

```sql
-- The new column + RLS shape
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'tasks' AND column_name = 'assigned_by_id';

SELECT policyname FROM pg_policies
 WHERE tablename = 'tasks' AND policyname LIKE 'tasks_insert_%';
-- Expect: tasks_insert_admin_head, tasks_insert_manager_self

-- Latest assigned-by-other tasks
SELECT t.title, t.owner_id, owner.full_name AS owner_name,
       t.assigned_by_id, assigner.full_name AS assigner_name
  FROM tasks t
  LEFT JOIN profiles owner    ON owner.id    = t.owner_id
  LEFT JOIN profiles assigner ON assigner.id = t.assigned_by_id
 WHERE t.assigned_by_id IS NOT NULL
 ORDER BY t.created_at DESC
 LIMIT 5;

-- Recent task_assigned notifications
SELECT recipient_id, subject, body, created_at
  FROM notifications
 WHERE notification_type = 'task_assigned'
 ORDER BY created_at DESC LIMIT 5;
```

## Reply

- **"FX-014b verified"** → I move to the next item.
- If anything's off, paste the failing case and I'll dig.
