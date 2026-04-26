# M6 — Engagements / tasks / notes / documents

The M6 code adds the activity log: per-company tabs for engagements,
tasks, notes, and documents, plus a global `/tasks` page across the
whole pipeline.

Two short user-side steps to enable it.

## Step 1 — Create the `documents` Storage bucket

Same flow as the `bnc-uploads` bucket from M5.

1. Supabase dashboard → **Storage** → **New bucket**
2. Bucket name: `documents` (exact, case-sensitive)
3. Public bucket: **OFF**
4. File size limit: `25` MB
5. Allowed MIME types: leave blank (any file type)
6. Save

## Step 2 — Apply migrations `0026` + `0027`

**`0026_documents_bucket_rls.sql`** adds storage RLS policies so ops roles
(admin / bd_head / bd_manager) can upload + read documents, and leadership
can read but not write.

**`0027_task_reminders.sql`** adds the per-task reminder feature: a
`task_reminders` table, a `process_task_reminders()` dispatcher function,
and a pg_cron schedule that fires every 15 minutes to insert `task_due`
notifications for any reminder whose `reminder_at <= now()`.

For each migration:

1. Open the Raw GitHub link
2. Copy
3. Supabase SQL Editor → New query → paste → Run

Migration links:

- https://github.com/walidgsherif-wq/agsi-crm/blob/claude/resume-agsi-crm-build-TQ28J/supabase/migrations/0026_documents_bucket_rls.sql
- https://github.com/walidgsherif-wq/agsi-crm/blob/claude/resume-agsi-crm-build-TQ28J/supabase/migrations/0027_task_reminders.sql

Expect: `Success. No rows returned.`

**Reminder cron requirements**: 0027 will print a NOTICE if pg_cron is not
enabled. If you didn't enable pg_cron during M2 setup, do so now in
**Supabase Dashboard → Database → Extensions** and re-run 0027 to register
the schedule. Without pg_cron, reminders are stored but never fire.

## Step 3 — Smoke test

Vercel auto-deploys from the push (~1 min). Then:

1. Open any company at https://agsi-crm.vercel.app/companies (e.g. Emaar Properties)
2. You should see four new tabs in the header: **Engagements, Tasks, Notes, Documents**
3. **Engagements tab** — click "+ Log engagement", pick a type (Meeting), today's date, write a summary, optionally pick a linked project, Save. The entry appears in the log below.
4. **Tasks tab** — click "+ New task", fill title, owner defaults to you, pick priority + due date, Create. Task appears with a status dropdown — change it to "In progress" or "Done" in place.
5. **Notes tab** — type into the textarea, optionally tick Pin, Add. The note appears with author + timestamp. Pin toggle moves it to the top.
6. **Documents tab** — click "+ Upload document", pick any small PDF/Word file, fill title + type (e.g. MOU — Developer), optionally signed date, Upload. After ~2s the row appears with a Download button.
7. **Global /tasks page** — open https://agsi-crm.vercel.app/tasks. Toggle "My tasks" / "Whole team", filter by status. The task you just created appears.

## What's deferred (intentionally)

- **Per-project tabs** — tasks/engagements/notes/docs can already be linked
  to a project via the optional dropdown on the company-tab forms; per-project
  tabs land later if BD asks for them.
- **Task notifications** + due-date alerts → M13 (notifications/cron).
- **Document expiry warnings** + retention sweep UI → M13/M16.
- **Engagement-driven level changes** (the `triggered_level_change_id` field
  on engagements) → M7 when the level-change UI lands.
- **@mentions / threading on notes** → polish.
- **Document version history** → polish.

## Troubleshooting

- **"Bucket not found"** when uploading a document — Step 1 wasn't done.
- **"new row violates row-level security policy"** on storage upload —
  Step 2 wasn't run. Apply the migration.
- **Download button shows "Could not generate download link"** — the user
  doesn't have read access to the bucket; double-check RLS policies are in
  place per Step 2.
- **`auth_role()` errors** — base RLS migration `0022_rls_policies.sql`
  wasn't applied. Re-check M2 setup.

## Reply to me

- **"M6 verified"** — I close it out (flip README, mark M7 next).
- A specific bug — paste the steps + error and I'll fix.
