# AGSI-CRM — Feature Backlog & Ledger

**Purpose:** single source of truth for *what was specced* vs *what actually shipped*.
Verified against `main` — not memory. Repo is the ground truth for "done" (CI guarantees `main` == prod).

**How to keep it honest**
- New spec → add a row here as `Specced`.
- CC opens a PR → note the PR #.
- Merged to `main` + verified in code → `Shipped`.
- Requirement changed after build → `Superseded` (link the correction).
- Any time: ask for a "spec-vs-shipped audit" → fresh-clone `main`, grep each item, update statuses.

_Last audited: HEAD `fb11888`, 85 migrations._

---

## Shipped (verified on main)

| Feature | Artifact | Notes |
|---|---|---|
| CI pipeline + branch protection | `.github/workflows/ci.yml` | apply / verify / drift / smoke; `main` locked, both checks required |
| Migration ledger reconciled | schema_migrations | one-time repair done; pipeline now tracks all applies |
| Contacts: edit / soft-delete / single-primary | 0073 + `contacts.ts` | delete tucked into edit, low-key |
| Claim requires location + L2 completeness gate | 0077 | emirate at claim; L2+ needs location + work-email contact |
| "Needs details" + "pending level-up" badges | `LevelBadge` / `LevelChangeDialog` | directional, actionable for admin/bd_head |
| Notifications: source ref + dismiss + auto-resolve | 0082 | count reflects reality; quick approve/reject |
| Follow-up task from engagement | 0078 | tasks.engagement_id; linked, light pre-fill |
| Evidence storage bucket | 0079 | created as migration (was the "Bucket not found" bug) |
| Events log + planned/attended/verified lifecycle | 0080 + 0083 | future events + badge-photo proof |
| Grouping (holding companies) | 0081 | parent_company_id; request → admin approve; non-destructive |
| Merge (dedupe) | 0084 | soft-merge + child manifest + distinct-pairs; owner-gated |
| Coverage member-contribution (stacked bars) | `ContributionStackedBars.tsx` | View A of the member-contribution work |

## In flight / needs confirmation

| Feature | State | Next action |
|---|---|---|
| **Setup mode** | ⚠️ Superseded | 0085 shipped the *direct-set, no-approval* version. Correction sent to CC: **keep approval, relax the one-step rule only** (allow L0→L4 in one request, still admin-approved, still gated, still Driver-A-excluded). Verify on merge: `set_initial_level` removed; one-step rule re-tightens when setup mode OFF. |
| **Inbound email searchable picker** | ? Unconfirmed | Replace truncated dropdown with server-side type-to-search over all ~3,600 companies; exclude merged. Confirm the combobox landed (not just old code present). |

## Deferred (intentionally not built)

| Item | Why deferred |
|---|---|
| Merge Build 2 — BNC remembers merge/distinct decisions | Build after manual merge proven on real pairs |
| Merge Build 3 — un-merge (admin-only) | Provenance manifest exists (0084); expose reversal later |
| Coverage member radars (View B) + awareness-by-member | View A shipped; awareness needs engagement data to accrue |
| Per-emirate coverage radars / MoM trends | Blocked on location data + time history |
| Evidence → Documents tab linkage | Decide "live in Documents" vs "surfaced from request" |
| KPI view: split earned vs backfill Driver A | Small follow-up once setup-mode backfill is done |
| BD bonus framework into Playbook | Pending leadership discussion |
