# §16 Decisions Log

This document captures the user's resolution of the §16 open questions from
the v2.3 architecture prompt, with the downstream implementation impact of
each answer. Every decision links to the files that were changed as a result.

Review protocol: if any answer is wrong, correct it here first — then the
affected migration / seed / doc is re-edited to match, and the
milestone-build plan adjusts accordingly.

---

## D-1 — Fiscal year: **Jan–Dec**

Confirms the default. Calendar year == fiscal year.

**Impact:**
- `app_settings.fiscal_year_start_month = {"month": 1}` (seeded).
- `fiscal_year_of(ts)` and `fiscal_quarter_of(ts)` helpers in
  `0021_functions_triggers.sql` resolve correctly without adjustment.
- Quarter boundaries: Q1 Jan–Mar, Q2 Apr–Jun, Q3 Jul–Sep, Q4 Oct–Dec (Asia/Dubai).
- No migration changes required.

---

## D-2 — UAE working week: **Mon–Fri** (weekend Sat–Sun)

Reflects the Jan-2022 UAE government switch from Sun–Thu to Mon–Fri. Matters
for notification scheduling (weekend suppression) and stagnation timers
(day-counting can optionally skip weekends if we want business-days, but v1
uses calendar days for simplicity and predictability).

**Impact:**
- `app_settings.working_week` seeded with days + weekend arrays.
- **Cron jobs already land on weekdays.** Checked: composition warning and
  drift both run Monday; daily jobs run every day at 06:00/02:00 Dubai time.
  No weekend-only fires, so no schedule changes needed.
- **Email digest**: moot — email is disabled for v1 (D-3).
- **Stagnation day-counting**: uses calendar days, not business days. Future
  enhancement (v1.1) can read `working_week` to switch to business-day
  counting if leadership requests it.
- **Report generation UI**: period pickers default to Mon as start-of-week.

---

## D-3 — Email sender domain: **deferred; in-app only for v1**

The user prefers notifications to surface inside the CRM (the notification
bell + notifications feed on the dashboard) rather than set up email
infrastructure at launch.

**Impact:**
- `app_settings.notification_channels_enabled = {"in_app": true, "email": false, "whatsapp": false}` (seeded).
- Email-digest Edge Function and its cron entry **removed** from
  `0021_functions_triggers.sql`. Stub function directory may still exist so
  it can be wired back when email domain is ready.
- Resend dependency and `RESEND_API_KEY` env var downgraded to "optional
  for v1, required for v1.1" in the file tree `.env.example`.
- Notification strategy pattern (in `supabase/functions/_shared/channels/`)
  ships with only `InAppChannel` wired into the dispatcher. `EmailChannel`
  and `WhatsAppChannel` exist as interfaces but are no-ops.
- **Urgent-event fallback path** (§6.2 originally called for immediate email
  on `stagnation_breach` and `upload_failed`) — converted to an in-app
  push plus a persistent banner on the admin dashboard until acknowledged.
- **UI surface list** for notifications in v1:
  1. Notification bell icon (top-right header, Realtime-wired)
  2. `/dashboard` widget: unread notifications list
  3. `/settings/notifications` preferences page (only in-app toggle functional)
  4. Persistent admin banner for `stagnation_breach` and `upload_failed`
     until marked-read.

**Why this is fine:** every user logs into the CRM daily anyway; the
notification bell surfaces everything in real time via Supabase Realtime
on the `notifications` table. The CRM effectively becomes a first-party
inbox. When SPF/DKIM is set up in v1.1, flipping
`notification_channels_enabled.email` to `true` enables email without any
code change.

---

## D-4 — BNC 45+ day admin reminder: **enabled**

When the last `bnc_uploads` row is older than 45 days, all admins get an
in-app reminder weekly until a fresh upload arrives.

**Impact:**
- New cron job `bnc-stale-reminder-weekly` in
  `0021_functions_triggers.sql` — runs Monday 08:00 Asia/Dubai.
- New Edge Function `supabase/functions/bnc-stale-reminder/` (scaffolded at
  milestone 5). Logic:
  ```sql
  IF (SELECT max(file_date) FROM bnc_uploads) < now() - interval '45 days'
     AND (SELECT (value_json->>'enabled')::boolean FROM app_settings WHERE key='bnc_stale_reminder') = true
  THEN enqueue 'bnc_stale_reminder' to all admin profiles
  END IF
  ```
- New notification type `bnc_stale_reminder` added to `notification_type_t`
  enum in `0002_enums.sql`.
- Threshold configurable via `app_settings.bnc_stale_reminder.threshold_days`.

---

## D-5 — Document retention: **7-year auto-archive**

Auto-archive (not delete) after seven years. UI hides archived documents by
default; admin can toggle "Show archived" to restore.

**Impact:**
- `documents` table gains `is_archived`, `archived_at`, `archived_reason`
  columns (updated in `0009_documents.sql`).
- New cron job `document-retention-sweep-monthly` runs on the 1st of each
  month at 02:30 Asia/Dubai.
- Sweep logic:
  ```sql
  UPDATE documents
     SET is_archived = true,
         archived_at = now(),
         archived_reason = 'retention_sweep'
   WHERE is_archived = false
     AND signed_date IS NOT NULL
     AND signed_date < (now() - make_interval(years => 7));
  ```
- New notification type `document_archived` so admins get a weekly summary
  when archives occur.
- Admin can override retention window per doc_type via
  `app_settings.document_retention.by_doc_type` (e.g. MOUs = 10 years).
- Storage blobs retained — only the `is_archived` flag flips. Full delete
  is a separate destructive operation requiring explicit admin action.
- Restore: admin clicks "Unarchive" on a document to flip the flag back;
  audit event recorded.

---

## D-6 — L4 MOU workflow: **single-admin tick**

No dual-approver for v1. An admin (or BD Head) ticks the MOU as signed
and that single action is authoritative.

**Impact:**
- `app_settings.l4_mou_workflow = {"mode": "single_admin_tick"}`.
- The L3 → L4 level change via `change_company_level()` runs the same path
  as any other forward move; no special approval gate.
- MOU upload via `/companies/{id}/documents` + a mandatory
  `doc_type IN ('mou_developer','mou_consultant','mou_contractor','tripartite')`
  and `signed_date NOT NULL` is required before the level transition is
  allowed in the UI (client-side validation, not DB-enforced — keeps the
  ledger permissive for manual backfills).
- **v1.1 upgrade path:** switching to dual-approver means adding a new
  table `level_change_approvals` and gating `change_company_level()` on a
  second-admin signature. Schema-light change.

---

## D-7 — `INITIAL_ADMIN_EMAIL`: **`walid.g.sherif@gmail.com`**

**Note:** this is a personal Gmail address rather than an `@agsi.ae`
corporate address. Acceptable for v1 bootstrapping, but strongly recommend
switching to a corporate address before production rollout so admin
access is tied to the organisation's identity provider and SSO policies.

**Impact:**
- `.env.example` ships with `INITIAL_ADMIN_EMAIL=` blank.
- Milestone 3 deploy checklist includes: populate
  `INITIAL_ADMIN_EMAIL` before running the first `supabase db push`.
- After first deploy, the one-shot admin bootstrap script:
  1. Calls `auth.admin.inviteUserByEmail(INITIAL_ADMIN_EMAIL)` via the
     Supabase Admin API (service role).
  2. On first sign-in, a trigger inserts the `profiles` row with
     `role='admin'`.
  3. The admin can then invite additional users from `/admin/users`.

**Action required:** user to provide the actual email address (e.g.
`walid@agsi.ae`) so it can be templated into the deploy secret.

---

## D-8 — Ownership force-reassignment credit: **new-owner, scope = all_history**

On admin force-reassignment, `level_history.owner_at_time` is updated to the
new owner for **every row** of that company. KPI numbers re-attribute
retroactively. A per-transfer toggle exposes the prior-owner fallback for
edge cases (e.g. legitimate mid-year onboarding where the new owner did not
do the historical work).

**Impact:**
- `app_settings.ownership_transfer_credit_policy = {"mode": "new_owner", "scope": "all_history"}`.
- `/admin/companies/reassign` UI shows a pre-checked "Transfer credit
  history to new owner" checkbox (default on per policy). Admin can uncheck
  per-transfer to fall back to prior-owner preservation.
- New SECURITY DEFINER function `transfer_company_ownership()` (to be
  implemented in milestone 7):
  ```sql
  CREATE FUNCTION transfer_company_ownership(
    p_company_id   uuid,
    p_new_owner_id uuid,
    p_transfer_credit boolean DEFAULT true  -- honours the per-transfer toggle
  ) RETURNS int
  -- Returns: number of history rows re-attributed
  ```
  - Locks the company row.
  - If `p_transfer_credit` = true: `UPDATE level_history SET owner_at_time = p_new_owner_id WHERE company_id = p_company_id`.
  - Updates `companies.owner_id` and `companies.owner_assigned_at`.
  - Writes two `audit_events` rows (one per owner affected) with
    before/after ownership and the row-count transferred.
  - Marks affected `kpi_actuals_daily` rows for rebuild on the next nightly
    run (or triggers immediate rebuild via a flag row).
- **Two notifications fire**:
  1. To the prior owner: "N credits transferred to [new owner]; your
     quarter scoreboard will update on tomorrow's refresh."
  2. To the new owner: "You inherited N historical credits for [company]
     from [prior owner]."
- **Ecosystem Awareness is not affected** — ecosystem scoring is at the
  company level, not the BDM level.
- **BEI** will re-compute on the next nightly run because it reads from
  `kpi_actuals_daily` which sources from `level_history.owner_at_time`.

**Side effect to monitor:** if transfers happen frequently near
quarter-end, BDMs' numbers can visibly swing overnight. First production
quarter — watch how often admins use this feature and whether dashboards
need an "effective as of" freshness badge on KPI tiles.

---

## Files touched by this resolution

- `supabase/seed.sql` — 6 new `app_settings` rows, one modified
- `supabase/migrations/0002_enums.sql` — 3 new `notification_type_t` values
- `supabase/migrations/0009_documents.sql` — `is_archived`/`archived_at`/`archived_reason` columns + two indexes
- `supabase/migrations/0021_functions_triggers.sql` — email-digest cron removed, two new cron jobs added
- `architecture/06-company-lifecycle-state.md` — new-owner credit rule documented
- `architecture/07-risk-register.md` — R-10 status updated, 7 resolved + 1 open

## What unlocks which milestone

| Decision | Unlocks milestone |
|----------|-------------------|
| D-1 FY Jan–Dec | M8 (KPI engine) |
| D-2 Mon–Fri | M13 (notifications) |
| D-3 in-app only | M3, M13 |
| D-4 stale reminder | M5 (BNC pipeline), M13 |
| D-5 7y retention | M9 (documents) |
| D-6 single-admin L4 | M7 (level changes) |
| D-8 new-owner credit | M7 |
| **D-7 admin email** | **M3 — still blocked** |

All milestones 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16 can start
immediately. Milestone 3 (auth flow) starts once D-7 lands.

---

## Post-pack additions (M9 expansion)

These two items were not in the pack as scoped at §17 review time. Both
were brought into M9 mid-build by an explicit user decision; recorded
here so future pack reviewers can see why M9 differs from the original
"performance review only" framing.

| ID | Decision | Rationale |
|----|----------|-----------|
| D-9 | Inbound email tracking is part of M9, not v1.1 | Auto-BCC pattern is cheap to add now (one webhook + one matcher) and BD-side adoption is just a Gmail/Outlook filter rule. Better than waiting for v1.1 because every week without it is engagements not getting captured. Migration `0032_email_tracking.sql`, route `src/app/api/inbound-email/route.ts`, sequence diagram `09-inbound-email-sequence.md`. |
| D-10 | Engagement details drawer is part of M9 | Captured emails store `body_text`, `body_html`, full recipient list and raw provider payload, but the original engagements list only showed a one-line summary — the rich content was effectively write-only. The drawer turns that into read access. Same component is reused for editing manual engagements (the existing list had no edit affordance, only delete). New deps `@radix-ui/react-dialog` + `isomorphic-dompurify`. |
