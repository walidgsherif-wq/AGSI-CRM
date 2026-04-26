# M7 — Level movement + Kanban

The M7 code adds the `/pipeline` Kanban (six L0–L5 columns), a level
change dialog, the Level History tab on each company, and an Ownership
Timeline tab with the §16 D-8 transfer-with-credit-history flow.

## Step 1 — Apply migration `0028_transfer_ownership.sql`

Adds the `transfer_company_ownership(company_id, new_owner_id, transfer_credit)`
RPC. Admin-only. Updates `companies.owner_id`, optionally rewrites
`level_history.owner_at_time` for retroactive credit reattribution, and
inserts an audit + notifications.

1. Open https://github.com/walidgsherif-wq/agsi-crm/blob/claude/resume-agsi-crm-build-TQ28J/supabase/migrations/0028_transfer_ownership.sql
2. Click **Raw** → select all → copy
3. Supabase SQL Editor → **New query** → paste → **Run**
4. Expect: `Success. No rows returned.`

(`change_company_level()` was already created in 0021_functions_triggers.sql
during M2 — no new migration needed for level changes themselves.)

## Step 2 — Smoke test

Vercel auto-deploys from the push (~1 min). Then:

1. **Pipeline view** — open https://agsi-crm.vercel.app/pipeline. You
   should see six columns L0–L5 with your seeded companies distributed
   across them (Khansaheb at L0, Naboodah at L1, Aldar at L2, Emaar at L3,
   Dewan at L4, etc).
2. **Change level** — click "Change level →" on any card. Pick a target
   level, write an evidence note, optionally an evidence URL, Confirm.
   The card moves to the new column on refresh.
3. **Verify the ledger** — open the company → **Level history** tab. The
   move you just made appears at the top with from→to badges, your name,
   the FY/Q stamp, evidence note, and a "Credited" badge (forward moves
   default to credited; backward moves default to uncredited).
4. **Backward move** — try moving Emaar L3 → L2. The level history row
   appears with a "Backward" badge and uncredited status.
5. **Admin credit toggle** — as admin, on the Level history tab, click
   the "Credited" checkbox to toggle whether a row counts toward KPI.
6. **Ownership transfer** (admin only) — open any company → **Ownership**
   tab → "Transfer ownership". Pick a new owner from the dropdown. Decide
   whether to tick "Transfer credit history" (default on per §16 D-8).
   Confirm. The company's owner updates and (if credit was transferred)
   every row of level_history.owner_at_time gets rewritten.
7. **Audit trail** — same Ownership tab now shows a transfer-history table
   with the rows-reattributed count.

## What's deferred (intentionally)

- **Drag-and-drop on the Kanban** — for v1 we use a "Change level →"
  button that opens a modal. Drag-and-drop is polish (~3-4 hrs) and adds
  a dnd library dep; happy to add later if you want a lighter UX.
- **L4 MOU pre-check** (§16 D-6) — UI hint mentions it on the dialog but
  no enforcement yet. To enforce, the dialog would query the company's
  documents tab for any signed MOU before allowing L3→L4. Add as a polish
  pass when more L4 transitions happen in real use.
- **Per-engagement → triggered_level_change_id linkage** — engagements
  table has the field; future polish would let you mark "this engagement
  is what moved the level." Not critical for M7.
- **Bulk operations** (move N companies at once) — out of scope.

## Reply to me

- **"M7 verified"** — I close it out (flip README, mark M8 next).
- A specific bug — paste the steps + error and I'll fix.

M8 (KPI engine + composition + BEI) builds the scoring on top of this
ledger — it's where the rollups + dashboards finally come alive.
