# M7 — Level movement + Kanban + approval workflow

The M7 code adds the `/pipeline` Kanban, an approval-gated level-change
flow with file evidence, the Level History tab, and an Ownership
Timeline tab with the §16 D-8 transfer-with-credit-history flow.

## Step 1 — Create the `evidence` Storage bucket

Used by the level-change request form to store screenshots / PDF
evidence. Same flow as the `bnc-uploads` and `documents` buckets.

1. Supabase dashboard → **Storage** → **New bucket**
2. Bucket name: `evidence` (exact, case-sensitive)
3. Public bucket: **OFF**
4. File size limit: `25` MB
5. Allowed MIME types: leave blank (we accept images, PDFs, .eml, .msg)
6. Save

## Step 2 — Apply migrations `0028` + `0029`

- **0028_transfer_ownership.sql** — `transfer_company_ownership()` RPC
  for the §16 D-8 ownership transfer with optional credit-history
  reattribution.
- **0029_level_change_requests.sql** — approval workflow. New
  `level_change_requests` table, `approve_level_change_request()` and
  `reject_level_change_request()` RPCs, RLS for the `evidence` bucket,
  and a trigger that auto-notifies all admins when a new pending request
  is created.

For each migration:

1. Open the Raw GitHub link → copy
2. Supabase SQL Editor → New query → paste → **Run**
3. Expect: `Success. No rows returned.`

Migration links:
- https://github.com/walidgsherif-wq/agsi-crm/blob/claude/resume-agsi-crm-build-TQ28J/supabase/migrations/0028_transfer_ownership.sql
- https://github.com/walidgsherif-wq/agsi-crm/blob/claude/resume-agsi-crm-build-TQ28J/supabase/migrations/0029_level_change_requests.sql

## Step 3 — Smoke test

Vercel auto-deploys from the push (~1 min). Then:

1. **Pipeline view** — open https://agsi-crm.vercel.app/pipeline. Six
   columns L0–L5 with your seeded companies bucketed by current level.
2. **As BD manager / BD head — request a level change.** Click
   "Request level change →" on any card. Pick a target level, write an
   evidence note (required), and add at least one file (drag & drop, file
   picker, or **paste a screenshot** with Ctrl/Cmd+V — handy for pasting
   email screenshots). Click "Submit for approval".
   - The card now shows an amber "1 pending review" badge.
   - All admins receive an in-app notification.
   - The card stays at its current level until an admin approves.
3. **As admin — review the queue.** Open `/admin/level-requests`
   (Admin → Level requests in the admin top-nav). You see the request
   with from→to badges, the requester, evidence note, and download
   buttons for each attached file. Optionally write a review note.
   Click **Approve** (or **Reject** with a required reason).
   - On approve: the level_history row is inserted with the **original
     requester** as `changed_by` so credit attribution stays correct,
     `companies.current_level` updates, the requester gets a
     notification.
   - On reject: status flips to rejected, requester gets a notification
     with your reason.
4. **As admin — direct change.** When admin clicks "Change level →"
   from Pipeline, the dialog says "Change level" (not "Request") and
   submits straight to `change_company_level()` (no approval queue).
   Useful for corrections.
5. **Verify the ledger** — open the company → **Level history** tab. The
   move appears with from→to badges, the requester's name, the FY/Q
   stamp, evidence note, and download buttons for each evidence file.
6. **Backward move** — admin can move L3 → L2 directly. The history row
   gets a "Backward" badge and is uncredited.
7. **Admin credit toggle** — on the Level history tab, click the
   "Credited" checkbox to flip whether a row counts toward KPI.
8. **Ownership transfer** — open any company → **Ownership** tab →
   "Transfer ownership". Pick a new owner. Decide whether to tick
   "Transfer credit history" (default on per §16 D-8). Confirm.
9. **Audit trail** — same Ownership tab now shows a transfer-history
   table with the rows-reattributed count.

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
