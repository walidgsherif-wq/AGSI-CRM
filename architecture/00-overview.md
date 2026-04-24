# AGSI CRM — Pre-Build Architecture Pack

This directory is the **§17 first-output deliverable** from the v2.3 architecture prompt.
No application code exists yet. These documents must be reviewed and approved
before the milestone-1 build (Next.js shell + Supabase provisioning) begins.

## Contents (maps 1:1 to §17 items)

| § | Deliverable | Location |
|---|-------------|----------|
| 17.1 | Full file tree of the Next.js + Supabase repo | `01-file-tree.md` |
| 17.2 | Every migration file, numbered, top-to-bottom readable | `../supabase/migrations/0001..0023_*.sql` |
| 17.3 | RLS policy table: role × table × operation | `03-rls-matrix.md` |
| 17.4 | Seed script with all playbook values | `../supabase/seed.sql` |
| 17.5 | Mermaid sequence diagram — BNC upload pipeline | `05-bnc-upload-sequence.md` |
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

Seven of the eight §16 items are resolved — see `08-decisions-log.md`. The
only remaining blocker for milestone 3 is **D-7**: the actual
`INITIAL_ADMIN_EMAIL` address. Every other milestone can proceed.
