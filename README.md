# AGSI CRM

Internal CRM for Arabian Gulf Steel Industries (AGSI) Business Development.
Built to the v2.3 architecture pack in `architecture/` — read that first.

## Milestone status

| # | Milestone | Status |
|---|-----------|--------|
| — | Architecture pack (§17) + §16 decisions | ✅ done |
| 1 | Foundation shell (Next.js + Tailwind + shadcn-style UI + AGSI theme + role-adaptive sidebar) | ✅ done |
| 2 | Schema + RLS + seed | ✅ done |
| 3 | Auth + invite flow | ⏳ next |
| 4 | Companies + projects CRUD | ⏳ |
| 5 | BNC upload pipeline | ⏳ |
| 6 | Engagements / tasks / notes / documents | ⏳ |
| 7 | Level movement + Kanban | ⏳ |
| 8 | KPI engine + composition + BEI | ⏳ |
| 9 | Performance review | ⏳ |
| 10 | Ecosystem Awareness engine | ⏳ |
| 11 | Heat maps | ⏳ |
| 12 | Leadership reports | ⏳ |
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

## What's explicitly deferred

- **Real auth** — M3 (Supabase magic-link, admin-invite gated).
- **Real data** — M2 schema + M4 CRUD.
- **Email notifications** — deferred to v1.1 per §16 D-3. In-app only for v1.
- **WhatsApp channel** — v1.1 per prompt §1.
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
