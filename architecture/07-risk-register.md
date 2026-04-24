# §17.7 — Risk Register (Top 10)

Scored on two axes: **L**ikelihood (1–5) and **I**mpact (1–5). Priority = L × I.
Mitigations listed are concrete and testable — if a mitigation cannot be
verified via migration, CI, or Playwright test, it doesn't belong here.

| # | Risk | L | I | P | Owner |
|---|------|---|---|---|-------|
| R-1 | BNC name-resolution false-positives merge distinct companies | 4 | 5 | 20 | Admin |
| R-2 | Level-history ledger bypassed by direct UPDATE on `companies.current_level` | 3 | 5 | 15 | Backend |
| R-3 | bd_manager discovers ecosystem data via RLS gap | 2 | 5 | 10 | Backend |
| R-4 | Mid-year ownership transfer double-credits or drops a credit | 3 | 4 | 12 | Backend |
| R-5 | BNC upload timeout on 3,500-row file | 3 | 3 | 9 | Backend |
| R-6 | Composition-drift scheduler false-positives during low-volume weeks | 4 | 2 | 8 | Product |
| R-7 | Leadership report `payload_json` drifts from schema as features evolve | 4 | 3 | 12 | Backend |
| R-8 | Magic-link email deliverability (SPF/DKIM not set for sender domain) | 4 | 3 | 12 | Ops |
| R-9 | BEI misinterpreted as committed compensation | 3 | 5 | 15 | Product |
| R-10 | §16 open questions unresolved by milestone 3 | 5 | 3 | 15 | PM |

---

## R-1 — BNC name-resolution false-positives

**What breaks:** "ABC Engineering LLC" and "ABC Engineering Consultants LLC"
fuzzy-match above 0.85 on `pg_trgm`. The second upload silently links the
consultant's projects to the contractor's company record. KPI credit is
attributed to the wrong stakeholder type → Driver B developer counts go wrong.

**Mitigation (in the plan):**
- Normalisation strips suffixes for **matching only**, keeping raw names in
  `raw_name_from_bnc`. This preserves evidence for later review.
- Two-tier threshold: ≥0.85 auto-link **but** always log an admin-review row
  (non-blocking); 0.75–0.85 goes to `company_match_queue` and blocks project-
  company linkage until resolved.
- `/admin/companies/merge` shows the exact character-diff between candidates.
- Playwright test: feed a crafted xlsx with a known-ambiguous pair, assert
  it lands in the queue, not auto-linked.

**Residual risk:** 0.85 threshold may still be too aggressive for short
names. First production quarter: monitor `company_match_queue.status='merged'`
rate; tune threshold in `app_settings` if > 2% auto-links need correction.

---

## R-2 — Level-history ledger bypassed

**What breaks:** A developer writes a server action that does
`UPDATE companies SET current_level = 'L4' WHERE id = :id` for convenience.
No history row → no KPI credit → BDM's dashboard shows wrong number → trust
in the system collapses.

**Mitigation:**
- BEFORE UPDATE trigger on `companies` rejects any write to `current_level`
  unless a session variable `app.level_change_via_fn` is set — set only by
  `change_company_level()`.
- Migration `0021_functions_triggers.sql` implements the trigger with an
  explicit `RAISE EXCEPTION` message that points developers at the function.
- Unit test in `rls-admin.spec.ts`: attempt direct UPDATE, assert error.

---

## R-3 — bd_manager discovers ecosystem data via RLS gap

**What breaks:** A PostgREST query or a view inadvertently exposes
`ecosystem_events` to bd_manager. The metric becomes gameable.

**Mitigation:**
- Three tables (`ecosystem_events`, `ecosystem_point_scale`,
  `ecosystem_awareness_current`) plus `city_lookup` and `leadership_reports`
  all deny SELECT to `bd_manager` at RLS.
- Test `ecosystem-bd-manager-blocked.spec.ts`: logs in as bd_manager, queries
  each table via the PostgREST endpoint, asserts 0 rows / 403 for every
  path — including joined views.
- **Defensive compile-time rule:** a lint rule in the Next.js codebase
  forbids importing `ecosystem/*` helpers inside any route under `(app)/`
  that isn't gated by a `requireRole(['admin','leadership','bd_head'])`.

---

## R-4 — Ownership transfer double-credits or drops credit

**What breaks:** BDM-A owns a company at L2. They log an engagement that
moves it to L3. Same day, admin transfers ownership to BDM-B. The nightly
rollup queries by current `owner_id` instead of `owner_at_time` → BDM-B gets
credit BDM-A earned.

**Mitigation:**
- Scoring queries **only** reference `level_history.owner_at_time`. Never
  join to `companies.owner_id` for Driver A/B/C attribution. Enforced by
  code review checklist + grep-based CI check ("no `companies.owner_id` in
  files under `lib/kpi/`").
- `ownership-transfer.ts` server action writes an `audit_events` row with
  `event_type='ownership_transfer'` containing `before_owner`, `after_owner`,
  `transferred_at`.
- Playwright test: simulate transfer mid-quarter, assert prior credits stay
  with prior owner and new credits flow to new owner.

---

## R-5 — BNC upload timeout

**What breaks:** 3,500 rows × 6 role columns × 3 tokens average = ~63,000
company resolutions per upload. At 5ms per fuzzy match, that's 5 minutes of
SQL. Vercel / Edge Function timeout hits → `status='processing'` stuck.

**Mitigation:**
- Batch inserts of 500 (§13).
- `pg_trgm` index on `canonical_name || array_to_string(aliases, ' ')`.
- Edge Function has 150s default + can extend; if exceeded, the function
  writes checkpoint state into `bnc_uploads.error_log` and the next
  invocation resumes from the last resolved row.
- Nightly safety sweep rebuilds `companies.has_active_projects` even if an
  upload partially failed.

---

## R-6 — Composition-drift false-positives

**What breaks:** BDM logs 5 L3 movements in week 5, all main contractors by
coincidence of pipeline timing. Drift fires. BDM feels micromanaged and stops
trusting alerts.

**Mitigation:**
- Four gating conditions (§3.12b): 30% quarter complete, ≥5 movements, ratio
  threshold 0.70, 14-day cooldown. All tunable in `app_settings`.
- First-quarter review: admin reviews `composition_drift_log` to see how
  often `fired=true` led to a real course correction vs how often the BDM
  self-corrected before the warning. Adjust thresholds accordingly.
- Notification copy explicitly frames the alert as "you have N weeks to
  correct" not "you're failing."

---

## R-7 — `payload_json` schema drift

**What breaks:** A feature added in Q3 expects a new field in the leadership
report payload. Q1's report is opened; the viewer crashes because the field
is absent.

**Mitigation:**
- Every leadership report stores a `payload_schema_version` key in
  `payload_json`. Viewer has a switch that renders per version.
- Schema documented in `src/lib/reports/payload.ts` with a Zod schema; breaking
  changes bump the version integer.
- Frozen denormalisation in `leadership_report_stakeholders` means even if the
  payload schema breaks, the key stakeholder table continues to work.

---

## R-8 — Magic-link email deliverability

**What breaks:** Admin invites a new BDM. Email lands in Junk. BDM thinks the
system is broken. Admin re-sends from a different address. Inbox confusion.

**Mitigation:**
- §16 open question: confirm sender domain + SPF/DKIM. This is the first
  deploy-time checklist item.
- Use Resend's verified domains flow. DMARC policy `quarantine` at minimum.
- `/admin/users` shows "invite delivered" status via Resend's webhook, so
  the admin can resend programmatically if delivery fails.
- Fallback: the invite link is also displayed once in the admin UI so it can
  be copy-pasted via a direct channel (Teams/WhatsApp) if email fails.

---

## R-9 — BEI misinterpreted as promised pay

**What breaks:** A BDM sees "87% BEI" and reads it as "87% of my bonus is
locked in." Stakes a pay expectation on it. Company performance drops → pool
shrinks → they feel deceived.

**Mitigation:**
- Tooltip text on the gauge (§7.2 BD Manager view) includes the exact
  phrasing: *"Actual bonus is determined by company performance and approval
  at leadership discretion."*
- **No currency anywhere in the UI.** Enforced by code review — grep for
  `AED` / `$` / `dirham` in any file under `(app)/dashboard/` should return
  zero results.
- The gauge label uses conditional language ("would qualify for," "if
  awarded").
- HR briefing at rollout: BDMs informed in writing that BEI is a performance
  index, not a compensation quote.

---

## R-10 — §16 open questions unresolved

**What breaks:** Milestone 3 (auth + invite flow) cannot ship without the
initial admin email. Milestone 8 cannot ship without FY confirmation for
quarter boundaries. Milestone 13 cannot ship without the email sender domain.

**Mitigation:**
- After this pack is approved, convert §16 items into GitHub issues with
  labels `blocker:milestone-3`, `blocker:milestone-8`, `blocker:milestone-13`.
- The eight questions, captured here for traceability:

  1. Fiscal year: Jan–Dec assumed. Confirm. _[blocks M8]_
  2. UAE working week: Sun–Thu. Confirm for notification timing. _[blocks M13]_
  3. Email sender domain (SPF/DKIM setup required). _[blocks M3, M13]_
  4. "No BNC upload in 45+ days" admin reminder — want it? _[nice-to-have]_
  5. Document retention: auto-archive after X years? _[pre-launch]_
  6. L4 MOU: single-admin tick or dual-approver workflow? _[blocks M7]_
  7. Initial admin email (`INITIAL_ADMIN_EMAIL`). _[blocks M3]_
  8. Ownership force-reassignment credit-transfer default: prior-owner (rec) or new-owner? _[blocks M7]_

## Risks explicitly out of scope

Captured here to prevent revisiting them during the build:

- **Data residency** — Supabase region selection. Assumed EU/MEA region
  per AGSI standards; if the client requires UAE residency specifically,
  that's a deploy change, not a build change.
- **GDPR** — no EU data subjects expected. Local PDPL is the relevant
  regime; handled via audit log + right-to-export.
- **Mobile-first** — §11 excludes mobile native. Leadership dashboard is
  responsive (§9 milestone 16) but not native.
- **SLAs** — internal tool, no contractual uptime. Best effort.
