-- 0069_guard_companies_is_key_stakeholder.sql
-- Defence-in-depth · close the bd_manager self-promotion hole on
-- companies.is_key_stakeholder.
--
-- The matrix doc (architecture/03-rls-matrix.md) and the column
-- comment on 0004 both say is_key_stakeholder is "admin-marked", but
-- the row-level RLS lets any owner — including bd_manager — flip it
-- as part of a normal UPDATE on companies they own. A self-promoted
-- "Key" stakeholder then surfaces in leadership reports.
--
-- This BEFORE UPDATE trigger restricts WRITES of this column to
-- admin / bd_head only. Field stays open to anyone with read access.
-- Mirrors the 0065 pattern for profiles.role:
--   - column unchanged → early return (most updates take this branch)
--   - auth.uid() IS NULL → service-role / SECURITY DEFINER trusted
--   - caller_role IN ('admin','bd_head') → allowed
--   - otherwise raise.
--
-- Idempotent: CREATE OR REPLACE FUNCTION + DROP/CREATE TRIGGER.

CREATE OR REPLACE FUNCTION public.guard_companies_is_key_stakeholder()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    caller_role text;
BEGIN
    -- flag unchanged → nothing to guard (covers ~every update from
    -- the company form which only ever touches address/contact fields)
    IF NEW.is_key_stakeholder IS NOT DISTINCT FROM OLD.is_key_stakeholder THEN
        RETURN NEW;
    END IF;

    -- service-role / elevated context. Anon sessions are blocked from
    -- updating companies by RLS already, so a null subject only ever
    -- means trusted server-side code (e.g. future admin RPC).
    IF auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT role::text INTO caller_role
      FROM public.profiles
     WHERE id = auth.uid();

    -- admin / bd_head may flip the flag
    IF caller_role IN ('admin','bd_head') THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Only admin or BD head can change is_key_stakeholder.';
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_companies_is_key_stakeholder ON public.companies;
CREATE TRIGGER trg_guard_companies_is_key_stakeholder
    BEFORE UPDATE ON public.companies
    FOR EACH ROW EXECUTE FUNCTION public.guard_companies_is_key_stakeholder();

COMMENT ON FUNCTION public.guard_companies_is_key_stakeholder() IS
    'Defence-in-depth column guard. bd_manager owning a company can edit '
    'every other field, but is_key_stakeholder is restricted to admin / '
    'bd_head. Service-role context (auth.uid() IS NULL) is trusted. '
    'Mirror of 0065 profile-role guard.';
