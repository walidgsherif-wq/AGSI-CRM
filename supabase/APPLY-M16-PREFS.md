# M16.2 — Notification preferences

One small migration so users can mute notification types from
`/settings/notifications`.

## Step 1 — Apply migration `0044_notification_preferences.sql`

1. https://github.com/walidgsherif-wq/AGSI-CRM/blob/claude/m16-polish-close/supabase/migrations/0044_notification_preferences.sql
2. Click **Raw** → select all → copy.
3. Supabase SQL Editor → **New query** → paste → **Run**.
4. Expect: `Success. No rows returned.`

## Step 2 — Merge + auto-promote

Vercel auto-promotes since `main` is the production branch.

## Step 3 — Try it

Sidebar → Settings → toggle the in-app switch off for any notification
type (e.g. *Stagnation warning*). The toggle saves immediately. The
next time the bell polls (within 60 seconds) or the inbox refreshes,
notifications of that type will be hidden from your view.

The notifications are still **inserted into the table** when they fire
— audit trail stays complete. The filter is on *read*, so toggling a
type back on instantly shows past notifications again.

## Verify in SQL Editor

```sql
SELECT user_id, notification_type, in_app_enabled, updated_at
  FROM notification_preferences
 ORDER BY updated_at DESC;
```

You should see one row per (user, type) pair you've toggled.

## Reply to me

- **"M16 verified"** → I close the milestone in main.
- A specific glitch — paste what you see.
