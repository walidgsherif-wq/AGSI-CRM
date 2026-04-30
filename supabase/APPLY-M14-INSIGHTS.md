# M14 — Market insights

## Step 1 — Apply migration `0040_generate_market_snapshot.sql`

Adds `generate_market_snapshot(p_upload_id uuid)` SECURITY DEFINER fn.
Reads from `projects` + `project_companies` + `bnc_uploads` and writes
the §4.4 metric set into `market_snapshots`.

1. https://github.com/walidgsherif-wq/AGSI-CRM/blob/claude/m14-insights/supabase/migrations/0040_generate_market_snapshot.sql
2. Click **Raw** → select all → copy.
3. Supabase SQL Editor → New query → paste → **Run**.
4. Expect: `Success. No rows returned.`

## Step 2 — Merge + auto-promote

Vercel auto-promotes (production branch is `main`).

## Step 3 — Generate the first snapshot

1. Sign in as admin.
2. **Admin → BNC Uploads** → click into your most recent **completed**
   upload.
3. Scroll to the new **Market snapshot** card.
4. Click **Generate market snapshot**. Takes a few seconds. Status
   message confirms when done.

## Step 4 — Verify on `/insights`

Open **Insights** in the sidebar. You should see:

- Snapshot picker pre-selected to the file date you just generated.
- "Compare to" dropdown (no other snapshots yet).
- Stage funnel + projects-by-stage cards.
- Projects-by-city + by-sector cards.
- Top-20 developers / contractors / consultants.
- Awarded vs not-awarded.
- Completion pipeline (12 / 24 / 36 mo).
- Under-construction value averages.

Generate a second snapshot from a different upload (if you have one)
to test the "Compare to" diff badges.

## Verify in SQL Editor

```sql
SELECT metric_code, COUNT(*) AS rows, MIN(snapshot_date) AS sd
  FROM market_snapshots
 GROUP BY metric_code
 ORDER BY metric_code;
```

You should see one row per metric_code, with row counts matching the
groupings (e.g. ~7 for `projects_by_stage`, up to 20 for `top_developer`).

## Reply to me

- **"M14 verified — snapshot generated, /insights renders the cards"** → I move on to M15 (Reports archive + audit log viewer).
- A specific glitch — paste the screenshot or SQL output and I&apos;ll
  diagnose.
