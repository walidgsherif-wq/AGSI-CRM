# M13 — Stagnation + composition notification engine

This is **PR 1 of 2** for milestone 13. It adds three SECURITY DEFINER
SQL functions that fire notifications, plus an admin trigger page to
run them on demand. The notification bell + read-side UI lands in PR 2.

The cron schedules in migration 0021 (`stagnation-daily`,
`composition-warning-weekly`, `composition-drift-weekly`) point at
Supabase Edge Functions that don&apos;t exist yet. v1 ships **manual
admin triggers**; thin Edge Function wrappers can be added later as a
follow-up.

## Step 1 — Apply migration `0038_stagnation_notification_engine.sql`

Adds:
- `eval_stagnation()` — for every active KPI-universe company with an
  owner, computes days-in-current-level. Fires `stagnation_warning` at
  `warn_at_pct%` and `stagnation_breach` at 100%. Deduped per company
  per level-entry. Recipients: owner; breach also fans out to every
  active user in the rule&apos;s `escalation_role`. Returns
  `(warnings_fired, breaches_fired)`.
- `eval_composition_warning()` — per-BDM. For each composition pair
  (driver_a_l3 → driver_b_dev_l3, etc.), if the BDM is at ≥ 80% of the
  headline target but < 60% of the composition target, fire
  `composition_warning` to BDM + every active BD Head + admin. Deduped
  per quarter per (user, composition_code). Returns `(fired)`.
- `eval_composition_drift()` — per-BDM mid-quarter check. Skips if
  quarter < 30% complete or sample < 5 L3+ moves. Computes actual ratio
  vs target ratio. Fires `composition_drift` when actual < 70% of
  target with 14-day cooldown via `composition_drift_log`. Writes a
  log row regardless (`fired=true` or `fired=false`) so the audit
  trail in performance review is complete. Returns `(fired)`.

To apply:

1. https://github.com/walidgsherif-wq/AGSI-CRM/blob/claude/m13-stagnation-engine/supabase/migrations/0038_stagnation_notification_engine.sql
2. Click **Raw** → select all → copy.
3. Supabase SQL Editor → New query → paste → **Run**.
4. Expect: `Success. No rows returned.`

## Step 2 — Merge + auto-promote

Vercel auto-promotes since production branch is `main`.

## Step 3 — Run each eval from the admin UI

Sign in as admin → **Admin → Notifications eval**. Three cards:

1. **Stagnation** → click **Run stagnation eval**. Returns warnings + breaches counts.
2. **Composition warning** → click **Run composition warning**.
3. **Composition drift** → click **Run composition drift**.

Above the cards is a "Last 24h fan-out" panel that breaks down all
notification rows created in the last 24 hours by type.

## Step 4 — Verify in SQL Editor

```sql
-- Recent stagnation rows
SELECT recipient_id, subject, related_company_id, created_at
  FROM notifications
 WHERE notification_type IN ('stagnation_warning', 'stagnation_breach')
   AND created_at > now() - interval '1 hour'
 ORDER BY created_at DESC LIMIT 20;

-- Composition firings
SELECT notification_type, COUNT(*) AS n
  FROM notifications
 WHERE notification_type IN ('composition_warning', 'composition_drift')
   AND created_at > now() - interval '1 hour'
 GROUP BY notification_type;

-- Drift audit (whether or not a fire happened)
SELECT user_id, metric_pair, movements_sampled, actual_ratio,
       target_ratio, drift_pct, fired, evaluated_at
  FROM composition_drift_log
 ORDER BY evaluated_at DESC LIMIT 10;
```

If your test DB has very little real data, expect zero firings for all
three — that's correct behaviour. The interesting verification is
whether a *positive* case fires:

- **Stagnation positive test**: pick a company where
  `current_level='L0'` and `level_changed_at` is more than 8 days ago
  (warn threshold = 10 × 80% = 8 days). The next eval should fire a
  warning. Or just `UPDATE companies SET level_changed_at = now() -
  interval '15 days' WHERE id = '<some-uuid>'` to force a breach.

## Reply to me

- **"engine green — N stagnation warnings, M breaches, K composition warnings, L drifts"** → I ship PR 2 (notification bell + /notifications page + /settings/notifications + close).
- A specific function-level error from any of the buttons or queries — paste it here.
