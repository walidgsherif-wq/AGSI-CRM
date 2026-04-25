# M4 — Apply demo data + verify Companies/Projects CRUD

The M4 code is in (list, create, view, edit for both companies and projects).
Two short user-side steps to make `/companies` non-empty and confirm the
end-to-end flow works against your live Supabase + Vercel deploy.

## Step 1 — Apply the demo seed

Adds 5 companies, 2 projects, and 5 project–company links. Idempotent
(re-running is a no-op).

1. Open https://github.com/walidgsherif-wq/agsi-crm/blob/claude/resume-agsi-crm-build-TQ28J/supabase/seed-demo.sql
2. Click **Raw** → select all → copy
3. Supabase dashboard → **SQL Editor** → **New query** → paste → **Run**
4. Expect: `NOTICE: Demo seed applied: 5 companies, 2 projects, 5 project links.`

If you see `No admin profile found`, sign in once at
https://agsi-crm.vercel.app as `walid.g.sherif@gmail.com` first, then re-run
this seed (the seed needs your profile row to exist so it can stamp
`owner_id`).

## Step 2 — Smoke-test the UI

The Vercel deploy auto-redeployed when this branch pushed; give it ~1 min.
Then:

1. **Companies list**: https://agsi-crm.vercel.app/companies
   - Should show 5 rows (Emaar, Aldar, Dewan, Al Naboodah, Khansaheb).
   - Filters: try Type=Developer (2 rows), Level=L3 (1 row), search "dewan"
     (1 row).
2. **Company detail**: click "Emaar Properties"
   - Form prefilled, Level badge = L3, "Key" + "Active projects" badges.
   - "Linked projects" table shows Dubai Hills Mall Phase 2.
   - Save button visible (you're admin).
3. **Edit roundtrip**: change "City" to e.g. "Dubai (Downtown)" → Save.
   - "Saved." appears below the button.
   - Reload — value persists.
4. **Create**: `/companies/new` → fill name + type → Create.
   - You land on the new company's detail page.
   - List now shows 6 rows.
5. **Projects list**: https://agsi-crm.vercel.app/projects
   - Should show 2 rows.
6. **Project detail**: click "Dubai Hills Mall Phase 2"
   - Form prefilled with stage=under_construction, value 1,850,000,000 AED.
   - "Linked companies" shows Emaar (owner) + Dewan (design_consultant) +
     Naboodah (main_contractor).

## If something fails

- **`/companies` returns 500 or a blank table** — paste any browser console
  errors or the Vercel function log.
- **Save button does nothing** — likely an RLS or env-var issue. Open the
  browser dev tools network tab, click Save, and paste the failed request's
  response body.
- **Create succeeds but I land on /companies (not /companies/[id])** — means
  the redirect path is taking the search-params version. Tell me and I'll
  adjust.

## Reply to me

- **"M4 verified"** — I close out M4 (flip README, write any follow-up
  fixes if you noted UI nits), then start M5 (BNC upload pipeline).
- Any specific bug — paste the steps + the error and I'll fix.

## What's deferred to later milestones (intentionally)

- **Level changes** — `change_company_level()` exists in the DB; the M7 UI
  wraps it. For now, demo levels are static (set in the seed).
- **Engagements / tasks / notes / documents** — M6.
- **Per-project ownership transfer + level history pages** — M7.
- **Edit linkage between projects and companies** — M6.
- **Soft-delete / deactivate** — admin action, M16 polish.
