-- 0065_guard_profile_role_changes.sql
-- Defence-in-depth · close the privilege-escalation hole on profiles.role.
--
-- RLS is row-level and can't authoritatively guard a single column.
-- The existing profiles_update_self policy tries to pin role with a
-- WITH CHECK subquery (0022_rls_policies.sql:28-31) — fragile because
-- Postgres' visibility of the row mid-UPDATE is implementation-
-- dependent. This BEFORE UPDATE trigger is the authoritative guard.
--
-- Legitimate flows verified preserved:
--   1. Admin role-change via setUserRole() (users.ts:160) — runs as
--      service-role, so auth.uid() is NULL → trusted-bypass branch.
--   2. User editing own full_name — role unchanged → early return.
--   3. /auth/callback first-sign-in provisioning — INSERTs profiles
--      via claim_invited_profile() (SECURITY DEFINER). BEFORE UPDATE
--      triggers don't fire on INSERT.
--   4. Initial-admin bootstrap (handle_new_user, 0055) — INSERT only.
--
-- This is additive; no RLS policy is changed. Re-running drops and
-- recreates the trigger, so the migration is idempotent.

CREATE OR REPLACE FUNCTION public.guard_profile_role_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    caller_role text;
BEGIN
    -- role unchanged → nothing to guard
    IF NEW.role IS NOT DISTINCT FROM OLD.role THEN
        RETURN NEW;
    END IF;

    -- server-side / elevated context (service role: no JWT subject) is
    -- trusted. Anon sessions are already blocked from updating profiles
    -- by RLS, so a null subject only ever means service-role code
    -- (setUserRole). Do not widen this.
    IF auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT role::text INTO caller_role
      FROM public.profiles
     WHERE id = auth.uid();

    -- admins may change any role
    IF caller_role = 'admin' THEN
        RETURN NEW;
    END IF;

    -- a non-admin changing their OWN role → block (self-escalation)
    IF NEW.id = auth.uid() THEN
        RAISE EXCEPTION 'You cannot change your own role.';
    END IF;

    -- a non-admin granting the admin role to anyone → block
    IF NEW.role = 'admin' THEN
        RAISE EXCEPTION 'Only an admin can grant the admin role.';
    END IF;

    -- otherwise defer to existing RLS (e.g. a future bd_head reassigning
    -- a non-admin role)
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_profile_role_changes ON public.profiles;
CREATE TRIGGER trg_guard_profile_role_changes
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.guard_profile_role_changes();

COMMENT ON FUNCTION public.guard_profile_role_changes() IS
    'Defence-in-depth column-level guard on profiles.role. Blocks any non-admin from changing their own role or granting admin to others. Service-role (auth.uid() IS NULL) is trusted; legitimate admin role changes go via setUserRole() in src/server/actions/users.ts which uses the service-role client.';
