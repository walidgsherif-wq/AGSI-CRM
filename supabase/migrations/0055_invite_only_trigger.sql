-- 0055_invite_only_trigger.sql
-- Auth simplification · invite-only · NO auto-promotion to bd_manager.
--
-- The old 0024 trigger created a profile row for every new auth.users
-- insert, defaulting role = 'bd_manager' when the email didn't match
-- the seeded initial admin. Combined with LoginForm.tsx's old
-- shouldCreateUser = true, that meant any email could obtain a
-- magic-link and land in the app with bd_manager access.
--
-- This migration drops the auto-promotion. The trigger now bootstraps
-- the initial admin only; every other invite is the responsibility of
-- src/server/actions/users.ts (inviteUser) which:
--   1. inviteUserByEmail() — creates auth.users + sends magic-link.
--   2. updateUserById() with app_metadata.role — admin-only metadata.
--   3. INSERT INTO profiles directly with the admin-chosen role.
--
-- Defence in depth: anyone whose auth.users row exists without a
-- matching profile is redirected to /login?error=profile_missing by
-- src/lib/auth/get-user.ts:55-57 — they can't reach any /(app) route.
--
-- Idempotent: CREATE OR REPLACE FUNCTION + DROP/CREATE TRIGGER.

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_initial_admin text;
BEGIN
    SELECT value_json #>> '{}'
      INTO v_initial_admin
      FROM app_settings
     WHERE key = 'initial_admin_email';

    -- Initial-admin bootstrap — the ONLY path that auto-creates a
    -- profile from auth.users. If the row matches the seeded initial
    -- admin email, mint their profile with role='admin'.
    IF v_initial_admin IS NOT NULL
       AND lower(NEW.email) = lower(v_initial_admin)
    THEN
        INSERT INTO profiles (id, full_name, email, role, is_active)
        VALUES (
            NEW.id,
            COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.email),
            NEW.email,
            'admin',
            true
        )
        ON CONFLICT (id) DO NOTHING;
    END IF;

    -- Everyone else: no auto-creation. The invite handler in
    -- src/server/actions/users.ts is the only path that creates a
    -- profile for a non-bootstrap user. Without a profile the
    -- session is unusable (get-user.ts bounces them to /login).
    RETURN NEW;
END;
$$;

-- Trigger itself doesn't need DROP/CREATE — it already points at the
-- updated function via SECURITY DEFINER. Re-declare for documentation
-- and to guarantee the binding survives a future Supabase migration.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();

COMMENT ON FUNCTION handle_new_user() IS
    'Invite-only signup gate. Bootstraps the initial admin from app_settings.initial_admin_email; every other auth.users insert is a no-op (no profile created). Profiles for invited users are created by src/server/actions/users.ts:inviteUser. Anyone with an orphan auth.users row is bounced by /lib/auth/get-user.ts.';
