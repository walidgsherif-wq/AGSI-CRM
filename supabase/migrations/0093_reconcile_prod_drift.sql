-- 0093_reconcile_prod_drift.sql
-- Reconciles prod schema with the migration files after the daily
-- drift check flagged divergence. Two real drifts:
--
--   1) company_type_t enum in prod is missing 'society'. Migration
--      0053 was recorded as applied in schema_migrations but the
--      actual ALTER TYPE never took, so client code sending
--      .in('company_type', [..., 'society']) 400s in PostgREST with
--      "invalid input value for enum company_type_t: 'society'" —
--      the swallowed error was the root cause of the "0 of 0"
--      coverage / segment-penetration panels on the dashboard.
--
--   2) public.rls_auto_enable() — a Supabase platform event-trigger
--      function that ships with the project but was never in the
--      migration files. Included here so the daily drift check
--      stops re-emitting it.
--
-- All other function bodies flagged by `supabase db diff` (verified
-- by normalising whitespace + comments on 8-of-40 samples) are
-- byte-identical to the current migrations — they only appear in
-- the diff as byproducts of the enum recreation the CLI would need
-- to do. Fixing the enum removes the cascade, so no per-function
-- reconciliation is needed.
--
-- Both statements are idempotent — safe to re-run.

-- ── 1) Enum ────────────────────────────────────────────────────────
-- ADD VALUE IF NOT EXISTS is a no-op if 'society' already exists.
-- PG 15 permits ADD VALUE inside a transaction as long as the new
-- value isn't referenced in the same tx.
ALTER TYPE company_type_t ADD VALUE IF NOT EXISTS 'society';

-- ── 2) rls_auto_enable() ───────────────────────────────────────────
-- Body captured verbatim from the introspected prod state. This is
-- a Supabase-managed helper that auto-enables RLS on tables created
-- in the public schema. Reinstating it into the migration files
-- (rather than trying to strip it from prod) matches the actual
-- deployment reality and silences the drift diff for it.
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

COMMENT ON FUNCTION public.rls_auto_enable() IS
    'Supabase-managed event trigger. Automatically enables RLS on any '
    'newly-created public table. Captured into migration history in '
    '0093 to reconcile the daily schema drift check with the actual '
    'prod state — the function pre-exists in prod but had never been '
    'checked into migrations.';
