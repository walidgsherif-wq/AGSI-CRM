# AGSI CRM — Pre-Build Architecture Pack

This directory is the **§17 first-output deliverable** from the v2.3 architecture prompt.
No application code exists yet. These documents must be reviewed and approved
before the milestone-1 build (Next.js shell + Supabase provisioning) begins.

## Contents (maps 1:1 to §17 items)

| § | Deliverable | Location |
|---|-------------|----------|
| 17.1 | Full file tree of the Next.js + Supabase repo | `01-file-tree.md` |
| 17.2 | Every migration file, numbered, top-to-bottom readable | `../supabase/migrations/0001..0032_*.sql` |
| 17.3 | RLS policy table: role × table × operation | `03-rls-matrix.md` |
| 17.4 | Seed script with all playbook values | `../supabase/seed.sql` |
| 17.5 | Mermaid sequence diagram — BNC upload pipeline | `05-bnc-upload-sequence.md` |
| 17.5b | Mermaid sequence diagram — inbound email pipeline (M9) | `09-inbound-email-sequence.md` |
| 17.6 | Mermaid state diagram — company L0→L5 with credit attribution | `06-company-lifecycle-state.md` |
| 17.7 | Top-10 risk register with mitigations | `07-risk-register.md` |
| §16  | Open-questions decisions log | `08-decisions-log.md` |

## Review protocol

1. Read `01-file-tree.md` and confirm the App Router layout matches expectation.
2. Read migrations in order `0001 → 0023`. Each file is designed to apply cleanly
   against the previous. No forward references.
3. Read `03-rls-matrix.md` side-by-side with `0022_rls_policies.sql` to verify the
   SQL implements the matrix exactly.
4. Read `../supabase/seed.sql` against §3.8, §6, §3.16 of the prompt.
5. Skim diagrams and risk register.

If anything is wrong, comment on the specific file / line. **Do not approve
en-bloc** — the prompt v2.3 explicitly says approve section by section.

## What is **not** in this pack

- No TypeScript, React, or Next.js code. That starts only at milestone 1 after
  approval.
- No tests. Playwright smoke tests land inside each milestone.
- No Edge Functions. BNC upload pipeline code is milestone 5.
- No seeded `auth.users` row. Initial admin is seeded in the first deploy via
  `INITIAL_ADMIN_EMAIL` env var (prompt §8 item 12) — this is a deploy-time
  operation, not a migration.

## Open items blocking milestone 3 (§16)

All eight §16 items resolved — see `08-decisions-log.md`. Milestone build
is in progress; see the repo root `README.md` for the milestone status
table.

## Post-pack additions

The pack was originally written for milestones 1-16. Two M9 expansions
are documented after the fact:

- **Inbound email tracking** (M9). Originally framed as v1.1 per §16 D-3
  (in-app notifications only). Brought forward as a passive capture
  channel — auto-BCC pattern with no behavioral change required of BD
  users beyond a Gmail/Outlook filter rule. See migration
  `0032_email_tracking.sql`, route `src/app/api/inbound-email/route.ts`,
  admin queue `src/app/(app)/admin/inbound-email/`, sequence diagram
  `09-inbound-email-sequence.md`, and operator guide
  `../supabase/APPLY-M9-EMAIL.md`.
- **Engagement details drawer** (M9). A right-anchored sheet that opens
  on row-click in `/companies/[id]/engagements`. Postmark-captured emails
  render read-only with a sanitized HTML body view; manual engagements
  are editable in-place. See
  `src/components/domain/EngagementDetailsSheet.tsx`. Required new deps:
  `@radix-ui/react-dialog`, `sanitize-html`.
- **Ecosystem awareness engine** (M10). Real-time event firing via
  AFTER INSERT triggers on `level_history` / `engagements` / `documents`,
  plus `rebuild_ecosystem_awareness()` and `backfill_ecosystem_events()`
  RPCs. Leadership UI at `/insights/ecosystem` with hero scores, trend
  chart, segmentation, top contributors, cooling accounts. Compact
  `EcosystemPanel` on `/dashboard` for admin/leadership/bd_head.
  Migrations `0034_ecosystem_event_triggers.sql` +
  `0035_ecosystem_summary_helpers.sql`. New dep: `recharts`.
- **Leadership reports** (M12). Frozen monthly / quarterly snapshots
  with feedback loop. Migration `0036_generate_leadership_report.sql`
  builds payload_json + denormalised stakeholder rows in one pass;
  `0037_finalise_leadership_report.sql` adds finalise + archive RPCs
  and the `leadership_report_finalised` notification value. Admin
  draft flow at `/admin/reports/*`, leadership viewer + archive at
  `/reports/leadership/*`, server-side PDF at
  `/api/reports/leadership/[id]/pdf` via `@react-pdf/renderer`.
  bd_manager fully blocked at every layer.
