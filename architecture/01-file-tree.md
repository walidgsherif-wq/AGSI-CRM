# §17.1 — Repo File Tree (Next.js 14 App Router + Supabase)

Target tree after milestone 16. Directories that don't exist yet are listed
so the build can be approved against a fixed target. Paths that only appear
after a specific milestone are annotated `[M<n>]`.

```
AGSI-CRM/
├── README.md
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── next.config.mjs
├── tailwind.config.ts                           # AGSI brand tokens (§15)
├── postcss.config.js
├── .env.example                                 # SUPABASE_URL, SUPABASE_ANON_KEY, RESEND_API_KEY, INITIAL_ADMIN_EMAIL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SITE_URL
├── .eslintrc.json
├── .prettierrc
├── .nvmrc
├── .gitignore
│
├── architecture/                                # this pack (pre-code)
│   ├── 00-overview.md
│   ├── 01-file-tree.md
│   ├── 03-rls-matrix.md
│   ├── 05-bnc-upload-sequence.md
│   ├── 06-company-lifecycle-state.md
│   └── 07-risk-register.md
│
├── supabase/
│   ├── config.toml
│   ├── seed.sql                                 # §17.4
│   ├── migrations/                              # §17.2
│   │   ├── 0001_extensions.sql
│   │   ├── 0002_enums.sql
│   │   ├── 0003_profiles.sql
│   │   ├── 0004_companies.sql
│   │   ├── 0005_level_history.sql
│   │   ├── 0006_projects.sql
│   │   ├── 0007_project_companies.sql
│   │   ├── 0008_engagements_tasks_notes.sql
│   │   ├── 0009_documents.sql
│   │   ├── 0010_targets.sql
│   │   ├── 0011_kpi_actuals.sql
│   │   ├── 0012_bnc_uploads.sql
│   │   ├── 0013_market_snapshots.sql
│   │   ├── 0014_stagnation_notifications.sql
│   │   ├── 0015_composition_drift.sql
│   │   ├── 0016_app_settings_audit.sql
│   │   ├── 0017_bei_matview.sql
│   │   ├── 0018_ecosystem.sql
│   │   ├── 0019_leadership_reports.sql
│   │   ├── 0020_city_lookup.sql
│   │   ├── 0021_functions_triggers.sql
│   │   ├── 0022_rls_policies.sql
│   │   └── 0023_indexes.sql
│   └── functions/                               # Edge Functions [M5,M8,M10,M12,M13]
│       ├── bnc-upload-process/                  # [M5] §4
│       │   ├── index.ts
│       │   ├── parse.ts
│       │   ├── resolve-project.ts
│       │   ├── resolve-company.ts
│       │   ├── dormancy.ts
│       │   └── market-snapshot.ts
│       ├── kpi-rebuild-nightly/                 # [M8] §5.1
│       │   └── index.ts
│       ├── composition-warning-weekly/          # [M8] §5.3 (Mon 06:00)
│       │   └── index.ts
│       ├── composition-drift-weekly/            # [M8] §5.3b (Mon 07:00)
│       │   └── index.ts
│       ├── bei-recompute/                       # [M8] §5.4
│       │   └── index.ts
│       ├── ecosystem-rebuild/                   # [M10] §5.5
│       │   └── index.ts
│       ├── stagnation-daily/                    # [M13] §6.1
│       │   └── index.ts
│       ├── email-digest-daily/                  # [M13] §6.2 (07:00)
│       │   └── index.ts
│       ├── leadership-report-generate/          # [M12] §5.6
│       │   └── index.ts
│       └── _shared/                             # cross-function helpers
│           ├── supabase-admin.ts
│           ├── fiscal.ts                        # quarter/year helpers, FY=Jan-Dec
│           ├── channels/                        # notification strategy pattern (§6.2)
│           │   ├── index.ts                     # NotificationChannel interface
│           │   ├── in-app.ts
│           │   ├── email.ts                     # Resend
│           │   └── whatsapp.ts                  # [v1.1] stub in v1
│           └── text-normalise.ts                # company-name normalisation
│
├── public/
│   ├── agsi-logo.svg                            # §15
│   └── favicon.ico
│
├── src/
│   ├── middleware.ts                            # auth gate + role load
│   │
│   ├── app/
│   │   ├── layout.tsx                           # root; Inter font; theme provider
│   │   ├── globals.css
│   │   ├── page.tsx                             # redirects to /login or /dashboard
│   │   ├── error.tsx
│   │   ├── not-found.tsx
│   │   │
│   │   ├── (auth)/                              # unauthenticated
│   │   │   ├── layout.tsx                       # centred, logo top
│   │   │   ├── login/
│   │   │   │   └── page.tsx                     # magic-link only
│   │   │   ├── auth/
│   │   │   │   ├── callback/route.ts            # Supabase magic-link exchange
│   │   │   │   └── signout/route.ts
│   │   │   └── accept-invite/
│   │   │       └── page.tsx                     # first-login from admin invite
│   │   │
│   │   ├── (app)/                               # authenticated shell
│   │   │   ├── layout.tsx                       # sidebar + header; role-adaptive nav
│   │   │   │
│   │   │   ├── dashboard/
│   │   │   │   └── page.tsx                     # routes to role-specific dashboard
│   │   │   │
│   │   │   ├── pipeline/                        # [M7] Kanban L0..L5; blocked for leadership
│   │   │   │   ├── page.tsx
│   │   │   │   └── _components/
│   │   │   │       ├── KanbanBoard.tsx
│   │   │   │       ├── KanbanColumn.tsx
│   │   │   │       └── LevelChangeDialog.tsx
│   │   │   │
│   │   │   ├── companies/
│   │   │   │   ├── page.tsx                     # list + filters
│   │   │   │   ├── new/page.tsx                 # manual create
│   │   │   │   └── [id]/
│   │   │   │       ├── layout.tsx               # tab nav
│   │   │   │       ├── page.tsx                 # Overview
│   │   │   │       ├── projects/page.tsx
│   │   │   │       ├── engagements/page.tsx
│   │   │   │       ├── tasks/page.tsx
│   │   │   │       ├── notes/page.tsx
│   │   │   │       ├── documents/page.tsx
│   │   │   │       ├── level-history/page.tsx
│   │   │   │       └── ownership-timeline/page.tsx
│   │   │   │
│   │   │   ├── projects/
│   │   │   │   ├── page.tsx
│   │   │   │   └── [id]/page.tsx
│   │   │   │
│   │   │   ├── tasks/
│   │   │   │   └── page.tsx                     # blocked for leadership
│   │   │   │
│   │   │   ├── insights/                        # [M14]
│   │   │   │   ├── page.tsx                     # reads market_snapshots
│   │   │   │   ├── ecosystem/page.tsx           # [M10] §3.16 — leadership/admin/bd_head only; bd_manager 404
│   │   │   │   └── maps/                        # [M11] §7.5 — admin/leadership/bd_head only; bd_manager 404
│   │   │   │       ├── layout.tsx               # tab nav + requireRole
│   │   │   │       ├── geographic/page.tsx      # [M11] stylised UAE SVG with city dots
│   │   │   │       ├── level-distribution/page.tsx  # [M11] universe grid coloured by L-level
│   │   │   │       └── engagement-freshness/page.tsx # [M11] stakeholder × week heat matrix
│   │   │   │
│   │   │   ├── reports/                         # [M9 + M12 + M15]
│   │   │   │   ├── page.tsx                     # [M9] hub — perf review by member
│   │   │   │   ├── quarterly-scorecard/page.tsx # [M15] bd_head + admin
│   │   │   │   ├── performance-review/
│   │   │   │   │   └── [userId]/page.tsx        # [M9] BEI / actuals-vs-target / composition / freshness / level ledger
│   │   │   │   └── leadership/                  # [M12]
│   │   │   │       ├── page.tsx                 # archive
│   │   │   │       └── [id]/page.tsx            # viewer + feedback field
│   │   │   │
│   │   │   ├── settings/
│   │   │   │   └── notifications/page.tsx       # §6.3
│   │   │   │
│   │   │   └── admin/                           # admin-only; 403 otherwise
│   │   │       ├── layout.tsx
│   │   │       ├── users/page.tsx               # [M3]
│   │   │       ├── uploads/                     # [M5]
│   │   │       │   ├── page.tsx
│   │   │       │   └── [id]/page.tsx            # upload summary
│   │   │       ├── companies/
│   │   │       │   ├── merge/page.tsx           # [M5] match queue
│   │   │       │   └── reassign/page.tsx        # force-reassign ownership
│   │   │       ├── targets/page.tsx             # [M8]
│   │   │       ├── inbound-email/page.tsx       # [M9] postmark unmatched-queue + resolve
│   │   │       ├── level-requests/page.tsx      # [M7+] level-change approval queue
│   │   │       ├── ecosystem-rebuild/page.tsx   # [M10] manual rebuild + backfill
│   │   │       ├── reports/                     # [M12]
│   │   │       │   ├── page.tsx
│   │   │       │   ├── new/page.tsx
│   │   │       │   └── [id]/edit/page.tsx
│   │   │       ├── settings/page.tsx            # stagnation, notifs, FY, universe, thresholds, BEI weightings
│   │   │       └── audit/page.tsx               # audit log viewer
│   │   │
│   │   └── api/                                 # server actions preferred; API used for webhooks/exports
│   │       ├── bnc/upload/route.ts              # POST → storage + trigger function
│   │       ├── inbound-email/route.ts           # [M9] POST — Postmark/SES/SendGrid inbound webhook
│   │       ├── reports/leadership/[id]/pdf/route.tsx  # [M12] @react-pdf/renderer download
│   │       └── export/
│   │           ├── company/[id]/route.ts
│   │           └── user/[id]/route.ts
│   │
│   ├── components/
│   │   ├── ui/                                  # shadcn-generated (button, dialog, card, badge, sheet, ...)
│   │   └── domain/                              # §7.7 shared components
│   │       ├── LevelBadge.tsx
│   │       ├── LevelChangeDialog.tsx            # [M7+] adjacent-target picker + evidence upload
│   │       ├── EngagementDetailsSheet.tsx       # [M9] right-anchored drawer; read-only emails / editable manual
│   │       ├── EvidenceUploader.tsx             # [M7+] file upload for level-change evidence
│   │       ├── EcosystemPanel.tsx               # [M10] §3.16 leadership-only dashboard tile
│   │       ├── EcosystemTrendSpark.tsx          # [M10] recharts spark line for the panel
│   │       ├── HeatMapExportButton.tsx          # [M11] §7.5 PNG export via html-to-image
│   │       ├── OwnerAvatar.tsx
│   │       ├── StagnationIndicator.tsx
│   │       ├── KPITile.tsx
│   │       ├── CompositionBreakdown.tsx
│   │       ├── CompanyCard.tsx
│   │       ├── DataFreshnessBadge.tsx
│   │       ├── FrozenDataBadge.tsx
│   │       ├── ReportHeroCard.tsx
│   │       ├── HeatMapExportButton.tsx
│   │       ├── BEIGauge.tsx
│   │       ├── EcosystemPanel.tsx               # leadership/admin/bd_head only
│   │       ├── Sidebar.tsx                      # role-adaptive (§7.1)
│   │       └── NotificationBell.tsx             # Realtime-wired
│   │
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── server.ts                        # createServerClient
│   │   │   ├── client.ts                        # createBrowserClient
│   │   │   ├── admin.ts                         # service-role client (server-only)
│   │   │   └── types.ts                         # generated: supabase gen types
│   │   ├── auth/
│   │   │   ├── get-user.ts                      # session + profile load
│   │   │   └── require-role.ts                  # throws 403 for role mismatch
│   │   ├── fiscal.ts                            # quarter/year helpers (FY Jan-Dec default)
│   │   ├── kpi/
│   │   │   ├── compute.ts                       # per-BDM actuals (called by cron fn)
│   │   │   ├── rag.ts                           # thresholds
│   │   │   └── bei.ts
│   │   ├── ecosystem/
│   │   │   └── compute.ts
│   │   ├── bnc/
│   │   │   ├── normalise.ts                     # suffix stripping, whitespace collapse
│   │   │   ├── fuzzy-match.ts                   # pg_trgm via RPC
│   │   │   └── stage-map.ts                     # §4.2 mapping
│   │   ├── notifications/
│   │   │   ├── types.ts
│   │   │   └── send.ts                          # strategy-pattern entry
│   │   ├── reports/
│   │   │   └── payload.ts                       # builds payload_json (§5.6)
│   │   └── zod/                                 # zod schemas for every server action boundary
│   │       ├── company.ts
│   │       ├── engagement.ts
│   │       ├── task.ts
│   │       ├── target.ts
│   │       └── report.ts
│   │
│   ├── server/                                  # server-only modules
│   │   ├── actions/
│   │   │   ├── companies.ts
│   │   │   ├── engagements.ts
│   │   │   ├── tasks.ts
│   │   │   ├── level-change.ts                  # calls RPC change_company_level
│   │   │   ├── ownership-transfer.ts
│   │   │   ├── targets.ts
│   │   │   ├── reports-leadership.ts
│   │   │   └── bnc-upload.ts
│   │   └── pdf/
│   │       └── leadership-report.tsx            # React-PDF template
│   │
│   ├── styles/
│   │   └── tokens.ts                            # re-exports tailwind agsi palette
│   │
│   └── types/
│       ├── db.ts                                # generated from supabase
│       └── domain.ts                            # hand-written domain types
│
└── tests/
    ├── playwright.config.ts
    ├── e2e/
    │   ├── auth.spec.ts                         # [M3] magic link, role routing
    │   ├── rls-admin.spec.ts                    # [M2]
    │   ├── rls-leadership.spec.ts               # [M2,M12]
    │   ├── rls-bd-head.spec.ts                  # [M2]
    │   ├── rls-bd-manager.spec.ts               # [M2] especially ecosystem + reports block
    │   ├── bnc-upload.spec.ts                   # [M5] happy path + unmatched queue
    │   ├── level-change.spec.ts                 # [M7] transaction fn + history row
    │   ├── kpi-rollup.spec.ts                   # [M8]
    │   ├── composition-drift.spec.ts            # [M8] all four trigger conditions
    │   ├── bei-gauge.spec.ts                    # [M8]
    │   ├── ecosystem-bd-manager-blocked.spec.ts # [M10] RLS negative test
    │   ├── heat-maps-export.spec.ts             # [M11]
    │   ├── leadership-report-flow.spec.ts       # [M12] draft → finalise → feedback
    │   └── stagnation-fire.spec.ts              # [M13]
    └── fixtures/
        └── bnc-sample.xlsx                      # redacted sample upload
```

## Notes

- **App Router route groups**: `(auth)` and `(app)` are route groups — they
  organise layouts without adding URL segments. `/login` stays at `/login`,
  `/dashboard` stays at `/dashboard`.
- **Server actions preferred over API routes** — API routes reserved for file
  uploads (multipart), PDF streaming, and data export endpoints.
- **Middleware** handles session + role on every `(app)/*` request. `admin/*`
  double-checks via `require-role('admin')` server-side — defence in depth.
- **Edge Functions** run on a schedule via `pg_cron` (configured in
  `0021_functions_triggers.sql`). Schedule strings:
  - `kpi-rebuild-nightly`: `0 22 * * *` UTC (02:00 Asia/Dubai)
  - `composition-warning-weekly`: `0 2 * * 1` UTC (06:00 Mon Asia/Dubai)
  - `composition-drift-weekly`: `0 3 * * 1` UTC (07:00 Mon Asia/Dubai)
  - `stagnation-daily`: `0 2 * * *` UTC (06:00 Asia/Dubai)
  - `email-digest-daily`: `0 3 * * *` UTC (07:00 Asia/Dubai)
  - `ecosystem-rebuild`: `15 22 * * *` UTC (nightly safety rebuild)
- **PDF generation**: React-PDF on a Node runtime Edge Function for
  `leadership-report-generate`; alternative Puppeteer path is not chosen
  here — lighter, deterministic, no headless-Chrome in the function image.
- **No `package-lock.json`**: pnpm assumed (`pnpm-lock.yaml`). Swap on request.
