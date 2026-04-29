# M10 — Ecosystem awareness engine

This is **PR 1 of 2** for milestone 10. It wires the ecosystem awareness
event firing + rebuild engine. The leadership-facing UI (charts, the
`/insights/ecosystem` page) lands in PR 2.

## Step 1 — Apply migration `0034_ecosystem_event_triggers.sql`

Adds:

- **AFTER INSERT triggers** on `level_history`, `engagements`, `documents`
  that call the existing `insert_ecosystem_event()` to score new rows in
  real time.
- `rebuild_ecosystem_awareness()` SECURITY DEFINER function — recomputes
  the row in `ecosystem_awareness_current` for `current_date`. Runs on
  demand (admin button) and from the existing `ecosystem-rebuild` cron
  registration in `0021_functions_triggers.sql` (22:15 UTC nightly, if
  pg_cron is enabled on your Supabase project).
- `backfill_ecosystem_events()` SECURITY DEFINER function — replays
  existing rows into the ledger. Idempotent.

To apply:

1. https://github.com/walidgsherif-wq/AGSI-CRM/blob/claude/m10-ecosystem-engine/supabase/migrations/0034_ecosystem_event_triggers.sql
2. Click **Raw** → select all → copy.
3. Supabase dashboard → **SQL Editor** → **New query** → paste → **Run**.
4. Expect: `Success. No rows returned.`

## Step 2 — Merge PR + promote to production

1. Merge the PR on GitHub.
2. Vercel → Deployments → top row (the merge commit) → ⋯ → **Promote to
   Production**. Wait for green.

## Step 3 — Backfill historical events + first rebuild

After promotion, sign in to production as admin and:

1. Open **Admin → Ecosystem**.
2. Click **Run backfill**. This replays:
   - All `level_history` rows where `is_forward AND is_credited`.
   - All `engagements` of type call / meeting / email / site_visit /
     workshop / document_sent / spec_inclusion.
   - All `documents` of type announcement / site_banner_approval /
     case_study (excluding archived).
   The function is idempotent — re-running is safe and won't
   double-count. After the backfill it automatically calls
   `rebuild_ecosystem_awareness()` so a snapshot exists.
3. The page reloads showing the latest snapshot. Lifetime + active
   scores should reflect your existing data.

## Step 4 — Verify in SQL Editor

```sql
-- How many ecosystem events did the backfill produce?
SELECT event_category, event_subtype, COUNT(*) AS n, SUM(points) AS pts
  FROM ecosystem_events
 WHERE is_void = false
 GROUP BY event_category, event_subtype
 ORDER BY pts DESC;

-- Latest snapshot
SELECT snapshot_date, lifetime_score, active_score,
       theoretical_max, lifetime_pct, active_pct
  FROM ecosystem_awareness_current
 ORDER BY snapshot_date DESC
 LIMIT 1;

-- The theoretical_max should be 78,900 (= 789-stakeholder universe × 100,
-- per §3.16). If it differs, check kpi_universe_sizes in app_settings.
```

## What the engine does going forward

- **Real-time:** any new engagement / document / level move automatically
  inserts a matching `ecosystem_events` row via the AFTER INSERT triggers.
  No app code changes needed in those flows.
- **Soft delete cascade:** the existing triggers on engagements and
  documents (from `0021_functions_triggers.sql`) flip ecosystem events to
  `is_void = true` when the source row is deleted. Audit trail intact.
- **Snapshot freshness:** the `ecosystem_awareness_current` row gets
  rebuilt nightly via cron (22:15 UTC). Admin can also click **Rebuild now**
  any time on `/admin/ecosystem-rebuild`. Real-time inserts don't
  recompute the snapshot — that's intentional (the snapshot is for the
  dashboard panel, which doesn't need millisecond freshness).

## Reply to me

- **"engine green — backfill produced X events, lifetime score Y"** → I
  ship PR 2 (the leadership `/insights/ecosystem` UI + heat map test).
- A specific error from any of the SQL Editor queries — paste it and I'll
  diagnose.
