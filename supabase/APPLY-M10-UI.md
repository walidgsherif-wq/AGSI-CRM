# M10 — Ecosystem awareness UI + close

This is **PR 2 of 2** for milestone 10. The engine (event firing +
rebuild + backfill) shipped in PR #5. This PR adds the leadership-
visible UI plus a small migration with read-side helpers, and closes M10.

## Step 1 — Apply migration `0035_ecosystem_summary_helpers.sql`

Adds two SECURITY DEFINER functions used by `/insights/ecosystem`:

- `ecosystem_top_contributors(p_window_days, p_limit)` — companies that
  earned the most active-window points.
- `ecosystem_cooling_accounts(p_window_days, p_limit)` — companies with
  lifetime > 0 and zero active points.

Both explicitly raise on `bd_manager` invocation (defence in depth on
top of RLS).

To apply:

1. https://github.com/walidgsherif-wq/AGSI-CRM/blob/claude/m10-ecosystem-ui/supabase/migrations/0035_ecosystem_summary_helpers.sql
2. Click **Raw** → select all → copy.
3. Supabase SQL Editor → **New query** → paste → **Run**.
4. Expect: `Success. No rows returned.`

## Step 2 — Merge PR + promote to production

1. Merge the PR on GitHub.
2. Vercel → Deployments → top row (the merge commit) → ⋯ → **Promote to
   Production**. Wait for green.

## Step 3 — Verify in the browser

1. Sign in as **admin** at `https://agsi-crm.vercel.app`.
2. **Dashboard** — should now show the **Ecosystem awareness** card with
   active + lifetime numbers and a 30-day spark line.
3. Click **Open full view →** (or sidebar → Insights → Ecosystem).
   - Hero panel: lifetime + active scores + percentages.
   - Trend chart (recharts area, both series).
   - Segmentation card with **By type / By level / By city** tabs.
   - Top contributors table (10 rows max).
   - Cooling accounts table (10 rows max).
4. Switch dev role to **leadership** — same view, no admin chrome.
5. Switch dev role to **bd_manager** — `/insights/ecosystem` returns
   404; the dashboard shows no Ecosystem panel.

## Step 4 — Reply

- **"M10 verified — ecosystem panel showing on dashboard, /insights/ecosystem
  loads as admin / leadership / bd_head, bd_manager 404s"** → I close M10
  in main and we move to M11 (Heat Maps).
- A specific glitch — paste the URL and what you see, I'll fix.
