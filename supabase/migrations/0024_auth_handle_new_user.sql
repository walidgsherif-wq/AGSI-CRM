-- 0024_auth_handle_new_user.sql
-- M3 — auto-create a profile row whenever Supabase creates an auth.users row.
-- First user whose email matches app_settings.initial_admin_email gets
-- role='admin'. Everyone else gets role='bd_manager' (admin promotes).
--
-- This is the only profile-write path outside of explicit admin actions.
-- RLS on profiles blocks direct INSERTs from the client anyway.

-- Remember the initial admin email so the trigger can check it.
INSERT INTO app_settings (key, value_json) VALUES
    ('initial_admin_email', to_jsonb('walid.g.sherif@gmail.com'::text))
ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json;

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_initial_admin text;
    v_role          role_t;
    v_full_name     text;
BEGIN
    SELECT value_json #>> '{}'
      INTO v_initial_admin
      FROM app_settings
     WHERE key = 'initial_admin_email';

    IF v_initial_admin IS NOT NULL AND lower(NEW.email) = lower(v_initial_admin) THEN
        v_role := 'admin';
    ELSE
        v_role := 'bd_manager';
    END IF;

    -- Best-effort name from auth metadata; fallback to email's local part
    v_full_name := COALESCE(
        NEW.raw_user_meta_data ->> 'full_name',
        NEW.raw_user_meta_data ->> 'name',
        split_part(NEW.email, '@', 1)
    );

    INSERT INTO profiles (id, full_name, email, role, is_active)
    VALUES (NEW.id, v_full_name, NEW.email, v_role, true)
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();
