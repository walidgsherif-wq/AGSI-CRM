# M12 — Leadership Reports engine + admin draft flow

This is **PR 1 of 3** for milestone 12. It wires the report-generation
engine (SQL aggregation function) and the admin-side draft → review flow
for monthly + quarterly reports. The leadership-facing viewer +
finalise + feedback flow lands in PR 2; PDF export + close in PR 3.

## Step 1 — Apply migration `0036_generate_leadership_report.sql`

Adds the `generate_leadership_report(p_report_id uuid)` SECURITY
DEFINER function. It aggregates KPIs, ecosystem awareness, heat-map
counts, pipeline movements, key-stakeholder snapshots, and the latest
market snapshot reference into the `payload_json` column of an existing
draft row, plus rewrites the denormalised
`leadership_report_stakeholders` rows.

To apply:

1. https://github.com/walidgsherif-wq/AGSI-CRM/blob/claude/m12-reports-engine/supabase/migrations/0036_generate_leadership_report.sql
2. Click **Raw** → select all → copy.
3. Supabase SQL Editor → **New query** → paste → **Run**.
4. Expect: `Success. No rows returned.`

## Step 2 — Merge PR + auto-promote

Vercel auto-promotes to production now that the production branch is
`main`. Wait for green.

## Step 3 — Generate your first draft report

1. Sign in as admin.
2. Sidebar → **Admin** → **Reports** tab. The hub shows three sections
   (Drafts / Finalised / Archived) — all empty for now.
3. Click **+ New report** (top right).
4. Form defaults to a **Quarterly strategic** report for the current
   quarter. Adjust the period dates if needed.
5. Click **Generate Draft**. Behind the scenes the server inserts the
   `leadership_reports` row, then calls
   `generate_leadership_report(id)`, then redirects you to
   `/admin/reports/[id]/edit`.
6. The edit page shows:
   - Status pill, type, period header.
   - Executive summary editor (free text, save with **Save summary**).
   - Executive headlines (frozen counts).
   - Pipeline movements during the period.
   - Stakeholder snapshot list — one row per touched-or-key company,
     each with an inline narrative input.
   - **Regenerate** button (top right) re-runs aggregation against
     current data, with a confirm prompt.

## Step 4 — Verify in SQL Editor

```sql
-- The latest draft and its payload size
SELECT id, period_label, status,
       jsonb_pretty(payload_json) AS payload
  FROM leadership_reports
 ORDER BY generated_at DESC
 LIMIT 1;

-- Denormalised stakeholders for that draft
SELECT company_name_at_time, level_at_time, is_key_stakeholder,
       moved_this_period, flagged_stagnating
  FROM leadership_report_stakeholders
 WHERE report_id = (
   SELECT id FROM leadership_reports
    ORDER BY generated_at DESC LIMIT 1
 )
 ORDER BY is_key_stakeholder DESC, company_name_at_time;
```

You should see a populated `payload_json` and one row per
key-or-touched company.

## Reply to me

- **"engine green — generated FYxxxx Q1 draft, headlines look right,
  N stakeholder rows"** → I ship PR 2 (finalise + leadership viewer +
  feedback flow).
- A specific glitch or empty payload section — paste what you see and
  I'll diagnose.
