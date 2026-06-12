# H1-fix — RLS write-policy hardening

Reads stay transparent. Writes split into "additive logging" (open + attributed) and "structural mutation" (owner + bd_head + admin). bd_head DELETE widened to match UPDATE-all on engagements / tasks / notes.

## Step 1 — Apply the migration

1. Raw file: https://raw.githubusercontent.com/walidgsherif-wq/AGSI-CRM/main/supabase/migrations/0054_rls_writes_h1_fix.sql
2. Paste into Supabase **SQL Editor** → **Run**. Expect "Success. No rows returned."
3. Idempotent (`DROP POLICY IF EXISTS` everywhere); safe to re-run.

## Step 2 — Run the RLS tests

The test file is at `supabase/tests/rls_h1_fix.test.sql`. It exercises both directions of every assertion in the H1-fix spec:

| # | Assertion |
|---|---|
| T1 | bd_manager A cannot UPDATE a project linked only to B's company; **can** update one linked to A's own |
| T2 | bd_manager A cannot INSERT a `project_companies` row for B's company; **can** for A's own |
| T3 | bd_manager A **can** INSERT an engagement + note on B's company (coverage); attribution stamps to A |
| T4 | bd_manager A cannot UPDATE/DELETE B's engagement, note, or document; **can** INSERT a document on B's company |
| T5 | Anti-spoof — bd_manager A cannot insert with `created_by` / `author_id` / `uploaded_by` = B |
| T6 | bd_head **can** UPDATE and DELETE any engagement and any task |
| T8 | Regression — bd_manager **can** still SELECT all companies / engagements / tasks (reads unbroken) |

(T7 — leadership write block — is enforced by the `WITH CHECK auth_role() IN ('admin','bd_head','bd_manager')` and is captured by static review rather than runtime exercise.)

### Setup before running

You need **four test users in `profiles`** with roles `admin`, `bd_head`, `bd_manager`, `bd_manager` (call them A and B). Easiest path:

```sql
-- Create throwaway auth.users + profiles for the test.
-- Run as service-role.
INSERT INTO auth.users (id, email, raw_app_meta_data)
VALUES
    (gen_random_uuid(), 'rls_test_admin@example.test', '{}'::jsonb),
    (gen_random_uuid(), 'rls_test_head@example.test',  '{}'::jsonb),
    (gen_random_uuid(), 'rls_test_mgr_a@example.test', '{}'::jsonb),
    (gen_random_uuid(), 'rls_test_mgr_b@example.test', '{}'::jsonb);

INSERT INTO profiles (id, full_name, email, role)
SELECT id,
       'rls_test ' || split_part(email, '@', 1),
       email,
       CASE
           WHEN email = 'rls_test_admin@example.test' THEN 'admin'::role_t
           WHEN email = 'rls_test_head@example.test'  THEN 'bd_head'::role_t
           ELSE 'bd_manager'::role_t
       END
  FROM auth.users
 WHERE email LIKE 'rls_test_%';

-- Read back the IDs:
SELECT email, id FROM profiles WHERE email LIKE 'rls_test_%';
```

Paste the 4 IDs into the four `v_admin / v_bd_head / v_mgr_a / v_mgr_b` placeholders at the top of `supabase/tests/rls_h1_fix.test.sql`, then **Run** the whole file.

### Expected output

Either:
- ✅ A single `NOTICE: == rls_h1_fix tests passed ==` at the bottom.
- ❌ A specific `Test Tn failed: …` ERROR on the first failing assertion. The remaining tests do NOT run after a failure — that's normal DO-block semantics.

### Tear-down

The trailing comment in the test file lists the DELETE statements to clean up test rows. Run those as service-role after a successful pass.

## What changed

Five tables touched. **No SELECT policy modified.** No app code modified. Idempotent re-run.

- `projects` — UPDATE split into admin/head (all) + bd_manager (owns ≥1 linked company); DELETE widened to admin+bd_head; INSERT unchanged.
- `project_companies` — write split into admin/head (all) + bd_manager (only on owned company).
- `engagements` — INSERT anti-spoof on `created_by` for all roles; UPDATE/DELETE bd_head widened to all.
- `notes` — INSERT anti-spoof on `author_id`; UPDATE/DELETE bd_head widened to all.
- `documents` — INSERT anti-spoof on `uploaded_by`; UPDATE/DELETE bd_manager re-scoped to company.owner_id (not uploaded_by); bd_head widened to all DELETE.
- `tasks` — DELETE bd_head widened to all (INSERT/UPDATE unchanged from FX-014b).

## Reply when done

- **"H1 verified"** once the tests pass on your DB.
- Paste any failing test number + the error message if not.
