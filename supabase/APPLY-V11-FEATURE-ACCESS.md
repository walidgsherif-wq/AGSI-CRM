# v1.1 — Per-user feature access

You can now restrict individual features (insights, maps, ecosystem,
reports, pipeline, tasks) per team member, on top of their role —
without inventing new roles. Managed from **Admin → Users → Manage
access**.

## How it works

- Each feature has a **role default** that mirrors exactly how access
  worked before this change. Applying the migration changes nothing
  until you set an override.
- For any non-admin user you can set a feature to **Allow** or **Deny**,
  overriding their role default. **Default** reverts to the role
  baseline.
- **Admins always have access to everything** and can't be restricted
  (prevents lockout). To limit an admin, change their role first.
- Restrictions are enforced at three layers: the sidebar hides the
  link, the page 404s if reached by URL, and the database (RLS) blocks
  the underlying data. Every change is written to `audit_events`.

## Step 1 — Apply migration `0047_feature_access.sql`

Creates the `features` registry (seeded), the `feature_access`
overrides table, the `has_feature()` helper, two audit-logged
set/clear functions, and re-points the relevant RLS SELECT policies
through `has_feature()`.

1. https://github.com/walidgsherif-wq/AGSI-CRM/blob/claude/v11-feature-access/supabase/migrations/0047_feature_access.sql
2. Click **Raw** → select all → copy.
3. Supabase SQL Editor → **New query** → paste → **Run**.
4. Expect: `Success. No rows returned.`

## Step 2 — Merge + auto-promote

Vercel auto-promotes from `main`.

## Step 3 — Try it

1. Sidebar → **Admin → Users**. Each non-admin row now has a
   **Manage access** link.
2. Pick a `bd_head` or `leadership` user → **Manage access**.
3. Set **Insights** to **Deny** → Save is immediate.
4. Log in as that user (or use the dev role switcher locally): the
   **Insights** link is gone from the sidebar, visiting `/insights`
   directly 404s, and the dashboard's market widgets are empty
   because the database blocks the rows.
5. Flip it back to **Default** → access returns instantly.

The six gateable features and their role defaults:

| Feature | Default visible to | DB-enforced |
|---|---|---|
| Market insights | all roles | yes (market_snapshots) |
| Insight maps | admin, leadership, bd_head | route + nav |
| Ecosystem awareness | admin, leadership, bd_head | yes (ecosystem tables) |
| Leadership reports | admin, leadership, bd_head | yes (leadership_reports) |
| Pipeline | admin, bd_head, bd_manager | route + nav |
| Tasks | admin, bd_head, bd_manager | yes (tasks) |

> **Maps + Pipeline** have no dedicated tables — they're views over
> companies/projects, which the spec keeps readable by everyone. So an
> override hides the curated view and 404s the page, but does not
> revoke the raw company/project access those users already have via
> /companies and /projects. Everything else gets true DB-level lockout.

## Verify in SQL Editor

```sql
-- See current overrides
SELECT fa.user_id, p.full_name, fa.feature_key, fa.allowed, fa.updated_at
  FROM feature_access fa
  JOIN profiles p ON p.id = fa.user_id
 ORDER BY fa.updated_at DESC;

-- Audit trail of access changes
SELECT actor_id, entity_id AS target_user, before_json, after_json, occurred_at
  FROM audit_events
 WHERE event_type = 'feature_access_change'
 ORDER BY occurred_at DESC
 LIMIT 20;
```

## Reply to me

- **"v1.1 feature access verified"** → I move to the next item
  (inbound email attachments).
- A specific glitch — paste what you see, especially which feature +
  role combination behaved unexpectedly.
