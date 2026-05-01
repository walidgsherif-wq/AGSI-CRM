# v1.1 — Admin Settings UI

The placeholder at `/admin/settings` is now a full editor for every
tunable in `app_settings`, plus inline editors for `stagnation_rules`
and `ecosystem_point_scale`. Every save writes to `audit_events`.

## Step 1 — Apply migration `0045_admin_settings_audit.sql`

This adds three SECURITY DEFINER fns that update the source-of-truth
tables and write the matching `audit_events` row in one transaction:

- `update_app_setting_with_audit(text, jsonb)`
- `update_stagnation_rule_with_audit(level_t, int, int, int, stagnation_escalation_role_t, boolean)`
- `update_ecosystem_point_with_audit(text, text, numeric)`

Each gates on `auth_role() = 'admin'`.

1. https://github.com/walidgsherif-wq/AGSI-CRM/blob/claude/v11-admin-settings/supabase/migrations/0045_admin_settings_audit.sql
2. Click **Raw** → select all → copy.
3. Supabase SQL Editor → **New query** → paste → **Run**.
4. Expect: `Success. No rows returned.`

## Step 2 — Merge + auto-promote

Vercel auto-promotes `main` to production.

## Step 3 — Try it

Sidebar → **Admin → Settings**. You should see:

1. **Fiscal year** — start month dropdown (default Jan per §16 D-1).
2. **KPI universe sizes** — developer / consultant / MC / EC counts;
   total auto-recomputes.
3. **BEI weightings** — A / B / C / D; Save disabled until they sum
   to 100.
4. **Composition warning + drift** — end-of-quarter thresholds plus
   the four drift-eval knobs (§3.12 / §3.12b).
5. **Ecosystem awareness tuning** — decay window, inactive multiplier,
   dedup window. Linked back to **Backfill all snapshots** so changes
   propagate to the historical timeline.
6. **Rebar economics** — consumption window %, share of value, fallback
   AED/tonne. Linked back to **Admin → Rebar prices**.
7. **Stagnation rules** — per-row inline editor (max days, warn %,
   escalate %, escalation role, active).
8. **Ecosystem point scale** — per-row override of seed defaults;
   shows **override** badge when current ≠ default.
9. **Notification channels** (read-only) — in-app on, email + WhatsApp
   marked deferred per §16 D-3.

Toggle a value, click **Save**. Then visit **Admin → Audit log**:

```sql
SELECT actor_id, event_type, entity_type, before_json, after_json, occurred_at
  FROM audit_events
 WHERE event_type IN ('app_setting_change',
                      'stagnation_rule_change',
                      'ecosystem_point_change')
 ORDER BY occurred_at DESC
 LIMIT 20;
```

You should see one row per save, with the prior + new value snapshots.

## Reply to me

- **"v1.1 admin settings verified"** → I move to next item (BNC pipeline
  auto-runs market snapshot on upload).
- A specific glitch — paste what you see.
