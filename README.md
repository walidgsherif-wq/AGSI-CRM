# AGSI CRM

Internal CRM for Arabian Gulf Steel Industries (AGSI) Business Development.
Built to the v2.3 architecture pack in `architecture/` — read that first.

## Milestone status

| # | Milestone | Status |
|---|-----------|--------|
| — | Architecture pack (§17) + §16 decisions | ✅ done |
| 1 | Foundation shell (Next.js + Tailwind + shadcn-style UI + AGSI theme + role-adaptive sidebar) | ✅ done |
| 2 | Schema + RLS + seed | ✅ done |
| 3 | Auth + invite flow | ✅ done |
| 4 | Companies + projects CRUD | ✅ done |
| 5 | BNC upload pipeline | ✅ done |
| 6 | Engagements / tasks / notes / documents | ✅ done |
| 7 | Level movement + Kanban | ✅ done |
| 8 | KPI engine + composition + BEI | ✅ done |
| 9 | Performance review + single-step level rule + inbound email + engagement drawer | ✅ done |
| 10 | Ecosystem Awareness engine | ✅ done |
| 11 | Heat maps | ✅ done |
| 12 | Leadership reports | ⏳ next |
| 13 | Stagnation engine + notifications | ⏳ |
| 14 | Insights module | ⏳ |
| 15 | Reports archive + audit log | ⏳ |
| 16 | Polish pass | ⏳ |

## What's in milestone 1

- **Next.js 14 App Router** with TypeScript, strict mode, typed routes.
- **Tailwind CSS** with the AGSI brand tokens from §15 (`tailwind.config.ts`).
- **Shadcn-style UI primitives**: `Button`, `Card`, `Badge` under
  `src/components/ui/`.
- **Role-adaptive Sidebar** (`src/components/domain/Sidebar.tsx`) that
  filters nav items per the §7.1 matrix for all four roles.
- **Dev-only role switcher** — a dropdown in the sidebar footer (only
  rendered when `NODE_ENV !== 'production'`) that sets an `agsi_dev_role`
  cookie so you can preview Admin / Leadership / BD Head / BD Manager
  without auth (auth lands in M3).
- **Route groups** `(auth)` and `(app)` with full placeholder pages for
  every sidebar item (Pipeline, Companies, Projects, Tasks, Insights, three
  heat-map sub-pages, Reports, Settings, Admin + 7 admin sub-pages).
- **RLS-style route guards** — `requireRole()` on pages restricted at the
  §7.1 layer (e.g. `/admin/*`, `/insights/maps/*`, `/pipeline`, `/tasks`,
  `/reports`). Hitting a blocked route returns 404 rather than leaking
  existence.
- **Supabase client stubs** — server + browser factories wired, ready for
  M2 to plug in.
- **Playwright smoke suite** (`tests/e2e/shell.spec.ts`) covering:
  - Root redirects to dashboard
  - Admin sees every sidebar item
  - BD Manager cannot see Admin / Reports / Maps
  - BD Manager hitting `/admin/users` → 404
  - Leadership cannot see Pipeline / Tasks but sees Reports

## What's in milestone 11

Three heat maps under `/insights/maps/*`, all gated to admin /
leadership / bd_head (bd_manager → 404 per §17 risk register R-3,
preventing reverse-engineering of ecosystem data they shouldn&apos;t see):

- **Geographic** (`/insights/maps/geographic`) — stylised UAE SVG with
  city dots positioned via lat/lon. Dot size scales with stakeholder
  count; colour = dominant company type at that city. Filters: type,
  L-level (incl. L3+), active-projects status. Side panel ranks
  cities with per-type micro-breakdown and syncs hover with the map.
- **Level distribution** (`/insights/maps/level-distribution`) — one
  tile per stakeholder in the AGSI universe. Tile colour = current
  L-level (§15 palette). Click a tile → `/companies/[id]`. Highlight
  modes: all / L3+ / key stakeholders. Summary bar shows §3.16 Block A
  counts at each level vs the type-narrowed denominator.
- **Engagement freshness** (`/insights/maps/engagement-freshness`) —
  stakeholder × week matrix, last 26 weeks. Cells coloured per the
  §7.5.3 buckets: hot (≤14d), warm (15–45d), cooling (46–90d), cold
  (>90d / never). Cell colour reflects the freshness of the
  engagement that fell in that week relative to today. Filters: type,
  L-level, sort (by L-level / most-neglected), &ldquo;my accounts only.&rdquo;
  Side panel: Cooling &amp; Cold L3+ accounts ranked by days-since-touch.

All three support **PNG export** via the shared
`HeatMapExportButton` (html-to-image; pixelRatio 2; date-stamped
filename) so admins can drop snapshots into leadership reports.

E2E (`tests/e2e/m11-heat-maps.spec.ts`): admin / leadership / bd_head
see the Export button on each map; bd_manager hitting any of the three
URLs returns 404.

Deferred to M12 / v1.1: triangulation map (§7.5 footnote — defer until
ecosystem data warrants it).

## What's in milestone 10

- **Real-time event firing** (migration `0034_ecosystem_event_triggers.sql`) —
  AFTER INSERT triggers on `level_history`, `engagements`, `documents`
  automatically score qualifying rows by calling the existing
  `insert_ecosystem_event()` (from migration 0021). Per §3.16:
  - `level_history`: forward + credited transitions only (L0→L1=1pt,
    L1→L2=3, L2→L3=8, L3→L4=20, L4→L5=50).
  - `engagements`: call / meeting / email / site_visit / workshop = 1pt;
    document_sent = 2pt; spec_inclusion = 15pt.
  - `documents`: announcement = 10pt, site_banner_approval = 15pt,
    case_study = 10pt (non-archived only).
  - 7-day dedup, 0.5× multiplier on inactive companies (existing rules
    in `insert_ecosystem_event`).
  - Soft-delete cascade (existing): when source row is deleted,
    `is_void = true` flips on the matching ecosystem event.
- **`rebuild_ecosystem_awareness()`** — recomputes
  `ecosystem_awareness_current` for `current_date`. `theoretical_max =
  kpi_universe_sizes.total × 100` (= 78,900 per §3.16). Builds
  `by_company_type` / `by_level` / `by_city` jsonb breakdowns. Hooks into
  the existing `ecosystem-rebuild` pg_cron schedule (22:15 UTC nightly).
- **`backfill_ecosystem_events()`** — one-time replay of historical
  rows. Idempotent via `dedup_key UNIQUE`.
- **`ecosystem_top_contributors()` / `ecosystem_cooling_accounts()`**
  (migration `0035_ecosystem_summary_helpers.sql`) — read-side helper
  RPCs feeding the leadership panel. Both `SECURITY DEFINER` with
  explicit `bd_manager` block.
- **`/admin/ecosystem-rebuild`** — admin-only page with **Rebuild now**
  and **Run backfill** buttons + the latest snapshot stats.
- **`/insights/ecosystem`** — leadership / admin / bd_head page (§7.5
  visibility rules). `bd_manager` → 404. Renders:
  - Hero: lifetime + active scores against theoretical max with
    intellectually-honest *"5.3% of theoretical max"* framing per §3.16.
  - Trend chart (recharts area) — daily snapshot over 120 days, lifetime
    + active overlay.
  - Segmentation (recharts bar) with tabs for company type / L-level /
    city.
  - Top contributors (this 90-day window) and cooling accounts
    (lifetime > 0, active = 0) tables.
- **`EcosystemPanel.tsx`** — compact dashboard tile (admin / leadership /
  bd_head) with active vs lifetime stats and a 30-day spark line.
- **E2E tests** (`m10-ecosystem.spec.ts`) — `bd_manager` blocked from
  `/insights/ecosystem` and `/admin/ecosystem-rebuild`; other roles see
  the heading. Per the §17 risk register R-3 RLS-defence requirement.

Deferred to v1.1: per §3.16 "Top contributors / cooling" filters (by
quarter, by company type), PNG export of the trend chart for inclusion in
leadership reports (lands with M12 reports).

## What's in milestone 9

- **Performance review** (`/reports`, `/reports/performance-review/[userId]`) —
  per-BDM annual scorecard. Five sections per fiscal year:
  - BEI by quarter (tier badge + driver A/B/C/D pcts pulled from
    `bei_for_caller`).
  - Per-driver Q1-Q4 actuals vs target tables with RAG colouring.
  - Stakeholder composition by `company_type_at_time` per quarter.
  - Engagement freshness — engagements logged per quarter.
  - Level transitions ledger — full FY list of `level_history` rows where
    `owner_at_time = subject`.
- **Single-step level rule** (migration `0031_level_step_rule.sql`) — every
  level change is `±1` only. Enforced at three layers: a `CHECK` constraint
  on `level_change_requests`, the `change_company_level()` function, and
  the `approve_level_change_request()` function.
- **Kanban drag-and-drop** (`PipelineKanban.tsx`) — adjacent columns
  highlight on drag-over, dialog opens with target locked to the drop
  column. Native HTML5 dragstart/dragover/drop, no library.
- **Inbound email tracking** (migration `0032_email_tracking.sql`,
  `/api/inbound-email`, `/admin/inbound-email`) — Postmark Inbound webhook
  → matcher → `engagements` (type=email) + `engagement_emails`. Unmatched
  emails land in `inbound_email_unmatched` for admin review. AuthN via
  `INBOUND_EMAIL_SECRET` query-string token.
- **Engagement details drawer** (`src/components/domain/EngagementDetailsSheet.tsx`)
  — click any engagement row in `/companies/[id]/engagements` to slide a
  details sheet in from the right. Postmark-captured emails are read-only
  with a sanitized HTML body / plain-text toggle and an admin-only "Raw
  email data" section. Manual engagements are editable via the same drawer.
  Built on `@radix-ui/react-dialog`; HTML sanitised with `isomorphic-dompurify`.

## What's explicitly deferred

- **Email notifications** — deferred to v1.1 per §16 D-3. In-app only for v1.
- **WhatsApp channel** — v1.1 per prompt §1.
- **Email attachments** — captured-flag stored, file bytes deferred to v1.1.
- **AI features, mobile native, third-party CRM sync** — out of scope per §11.

## Running locally

```sh
# Node 22 (see .nvmrc). pnpm 10.
pnpm install

# Dev server
pnpm dev                 # http://localhost:3000 → redirects to /dashboard

# Typecheck / lint / build
pnpm typecheck
pnpm lint
pnpm build

# Playwright (first run installs browsers)
pnpm test:e2e:install
pnpm test:e2e
```

## Environment

Copy `.env.example` to `.env.local`. For M1 only
`NEXT_PUBLIC_DEV_ROLE_DEFAULT` actually matters — all other variables are
read by later milestones. Supabase URL + anon key become required at M2.

## Repo layout (milestone 1)

```
├── architecture/              # pre-build decision docs — read-first
├── supabase/
│   ├── migrations/            # 23 numbered SQL migrations (applied at M2)
│   ├── seed.sql               # playbook targets, stagnation rules, app_settings
│   └── config.toml            # local dev config + storage bucket definitions
├── src/
│   ├── app/                   # Next.js App Router
│   │   ├── (auth)/            # route group: login
│   │   ├── (app)/             # route group: authenticated shell
│   │   │   ├── dashboard/
│   │   │   ├── pipeline/
│   │   │   ├── companies/
│   │   │   ├── projects/
│   │   │   ├── tasks/
│   │   │   ├── insights/maps/{geographic,level-distribution,engagement-freshness}/
│   │   │   ├── reports/
│   │   │   ├── settings/notifications/
│   │   │   └── admin/{users,uploads,companies/merge,targets,reports,settings,audit}/
│   │   ├── layout.tsx
│   │   ├── page.tsx           # → /dashboard
│   │   └── not-found.tsx
│   ├── components/
│   │   ├── ui/                # Button, Card, Badge
│   │   └── domain/            # Sidebar, DevRoleSwitcher, LevelBadge
│   ├── lib/
│   │   ├── auth/              # getCurrentUser, requireRole, shared constants
│   │   ├── supabase/          # server + browser client factories
│   │   └── utils.ts           # cn() class merger
│   └── types/domain.ts        # Role, Level, CompanyType, Driver enums
├── tests/
│   ├── playwright.config.ts
│   └── e2e/shell.spec.ts
└── public/agsi-logo.svg
```

## Open questions (all §16 items resolved)

See `architecture/08-decisions-log.md`. Resolutions locked into seed +
schema + docs.
