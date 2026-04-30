# M12 — Leadership viewer + finalise + feedback

This is **PR 2 of 3** for milestone 12. PR 1 (#9) shipped the engine +
admin draft flow. This PR adds the read-side surfaces and the
`draft → finalised → leadership-feedback` loop. PR 3 will add PDF
export and close M12.

## Step 1 — Apply migration `0037_finalise_leadership_report.sql`

Adds:
- `leadership_report_finalised` value to the `notification_type_t` enum.
- `finalise_leadership_report(p_report_id uuid)` SECURITY DEFINER fn —
  flips draft → finalised, stamps `finalised_at` + `finalised_by`, fans
  out a `notifications` row to every active leadership user.
- `archive_leadership_report(p_report_id uuid)` SECURITY DEFINER fn —
  flips finalised → archived. No DELETE path (audit-of-record per §3.17).

Both functions are admin-only and reject any other role at the function
level (RLS already blocks direct writes to `leadership_reports.status`
for non-admins).

To apply:

1. https://github.com/walidgsherif-wq/AGSI-CRM/blob/claude/m12-reports-leadership/supabase/migrations/0037_finalise_leadership_report.sql
2. Click **Raw** → select all → copy.
3. Supabase SQL Editor → **New query** → paste → **Run**.
4. Expect: `Success. No rows returned.`

> **Note:** because `ALTER TYPE … ADD VALUE` runs in its own implicit
> commit, if your SQL Editor session has any open transaction the
> statement will fail. Just open a fresh query tab and you're fine.

## Step 2 — Merge PR + auto-promote

Vercel auto-promotes since the production branch is now `main`.

## Step 3 — End-to-end flow

1. **As admin**, open the existing draft from PR 1 (or generate a fresh
   one from `/admin/reports/new`).
2. On the edit page, scroll to the **Finalise** card → click **Finalise &
   Send to Leadership** → confirm. The report header should now show
   the green **Finalised** badge.
3. Verify the notification fan-out in SQL Editor:
   ```sql
   SELECT recipient_id, subject, link_url, created_at
     FROM notifications
    WHERE notification_type = 'leadership_report_finalised'
    ORDER BY created_at DESC LIMIT 5;
   ```
   You should see one row per active leadership user.
4. **Switch dev role to leadership** (or sign in as a leadership user)
   → sidebar → Reports → **Open archive →** on the *Leadership reports
   archive* card. The just-finalised report shows up under "Awaiting
   feedback".
5. Open the report. Scroll to **Your feedback** → write a sentence →
   **Save feedback**. The page reloads showing it as saved.
6. **Switch dev role back to admin** → reopen the same report viewer
   (`/reports/leadership/<id>`) → confirm the feedback panel now reads
   "Leadership feedback" with the leadership user's name and timestamp.
   Admins cannot edit it (the trigger from migration 0021 blocks any
   write attempt at the database level).
7. Back on `/admin/reports/<id>/edit`, scroll to the **Archive** card →
   click **Archive report** → confirm. The report moves to the Archived
   bucket on `/admin/reports` and on `/reports/leadership`.

## What's deferred to PR 3

- **PDF export** via `@react-pdf/renderer` — server-side render at
  finalise time, stored to Supabase Storage, "Download PDF" button on
  the viewer.
- **README + architecture** updates marking M12 done, M13 next.
- **M12: close** commit.

## Reply to me

- **"M12 viewer + feedback verified"** → I ship PR 3 (PDF + close).
- A specific glitch in any of the steps above — paste what you see.
