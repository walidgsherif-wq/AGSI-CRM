# M8 — KPI engine + composition + BEI

The M8 code adds the rollup engine that converts your activity log into
per-BDM scorecards, the BEI gauge, and the admin Targets editor.

## Step 1 — Apply migration `0030_rebuild_kpi_actuals.sql`

Adds:
- `rebuild_kpi_actuals(p_target_date)` — aggregates level_history (Driver
  A/B), engagements (Driver C), and documents (Driver D) into the
  `kpi_actuals_daily` snapshot for the given date, then refreshes
  `bei_current_view`.
- `bei_for_caller` view — security_invoker wrapper around the matview so
  RLS gates BEI access correctly.

1. Open https://github.com/walidgsherif-wq/agsi-crm/blob/claude/resume-agsi-crm-build-TQ28J/supabase/migrations/0030_rebuild_kpi_actuals.sql
2. Click **Raw** → select all → copy
3. Supabase SQL Editor → **New query** → paste → **Run**
4. Expect: `Success. No rows returned.`

## Step 2 — Run the first rebuild

Vercel auto-deploys the new code (~1 min). Then:

1. Open https://agsi-crm.vercel.app/dashboard
2. As **admin**, click "Rebuild KPI now" (top-right of the dashboard).
3. The page reloads with the freshly computed snapshot date and KPI
   tiles populated.

## Step 3 — Smoke test

1. **Dashboard as admin** — should show four cards (Driver A/B/C/D), each
   with a metric × Q × actual × target table. RAG variant per metric:
   red <50%, amber <75%, blue <95%, green ≥95%. Empty actuals are fine
   (means nothing's logged yet for that metric).
2. **Dashboard as bd_manager** (use dev-role switcher) — same four
   cards but scoped to the user's own actuals. The BEI card appears at
   the top with Driver A/B/C/D pills + an overall BEI tier badge.
3. **Dashboard as bd_head** — same as bd_manager (sees own + BEI tile).
4. **Dashboard as leadership** — sees the team rollup row (no BEI gauge,
   no per-member breakdown — that's M9 performance review).
5. **Targets editor** — open `/admin/targets`. Pick a member from the
   pill row. Each driver shows its metrics with Q1–Q4 inputs. Edit any
   row → Save → "override" badge appears on the dashboard for that
   member. Reset to playbook clears the override.
6. **Verify the rollup logic** — log a new engagement of type
   `consultant_approval`, then click "Rebuild KPI now". Driver C row
   should increment by 1.

## What's deferred (intentionally)

- **Nightly cron Edge Function** — the rollup runs manually for now via
  the admin button. The pg_cron schedule registered in 0021 (`0 22 * * *`
  UTC = 02:00 Asia/Dubai) targets a `kpi-rebuild-nightly` Edge Function
  that we haven't deployed yet. Add it as a polish task (~1 hr — small
  Deno wrapper that calls `rebuild_kpi_actuals()`).
- **Composition drift evaluator** — the `composition_drift_log` table +
  `composition-drift-weekly` cron scheduling is in place from M2; the
  dispatcher Edge Function comes with M13 (notifications).
- **Performance review surface** — multi-quarter drill-down per BDM, as a
  dedicated page. Lands in M9.
- **Per-FY drill-down** — the dashboard shows current FY only. Past
  quarters survive in `kpi_actuals_daily` (snapshot history) but the UI
  doesn't expose them yet.

## Reply to me

- **"M8 verified"** — I close it out (flip README, mark M9 next).
- A specific bug — paste the error and I'll fix.
