-- 0063_invited_users.sql
-- H8 · invited→profile linkage fix (lazy provisioning).
--
-- The previous flow (PR #60) pre-created an auth.users row plus a
-- profile keyed to that row's UUID when an admin invited someone.
-- That worked for magic-link sign-in but breaks under Google OAuth:
-- Supabase does NOT auto-link a new OAuth identity to a pre-existing
-- auth.users row matched only by email, so the invited user's
-- sign-in either errored out ("user already registered") or minted
-- a brand-new auth.users row with a different id — orphaning the
-- pre-provisioned profile and triggering the get-user.ts
-- profile_missing path even though they were "invited".
--
-- Lazy provisioning kills the dependency on identity-link behaviour
-- entirely:
--
--   1. inviteUser writes to invited_users (this table) — no auth.users
--      insert, no profile insert, no UUID pre-allocation.
--   2. The teammate signs in with Google. Supabase creates a fresh
--      auth.users row with a Google identity row attached. No
--      collision.
--   3. /auth/callback checks for a profile by the OAuth user-id; if
--      missing, it consults invited_users by email and provisions
--      the profile on the spot with the OAuth user-id, then deletes
--      the invited_users row.
--
-- citext PRIMARY KEY mirrors profiles.email (also citext per 0003) so
-- the email lookup in the callback is case-insensitive without any
-- per-callsite lower()/ilike() ceremony.

-- citext is already enabled by 0001_extensions.sql; this line is a
-- safety belt in case 0063 is re-applied in isolation.
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE invited_users (
    email       citext      PRIMARY KEY,
    role        role_t      NOT NULL,
    full_name   text        NOT NULL,
    invited_by  uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    invited_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE invited_users IS
    'Pending Google-OAuth invites — keyed by email. Row is deleted by '
    '/auth/callback when the invitee first signs in and a profile is '
    'created with their real OAuth user-id.';

-- Service-role only. The inviteUser server action uses the service-
-- role client (adminClient()) to write; the /auth/callback handler
-- uses the SSR cookie-session client, which means it would not be
-- able to read invited_users under RLS — so the callback has to be
-- elevated. We do that by adding a SECURITY DEFINER lookup function
-- the callback can call instead of granting authenticated SELECT.
ALTER TABLE invited_users ENABLE ROW LEVEL SECURITY;

-- No RLS policies — both reads and writes require service-role or
-- the SECURITY DEFINER claim_invited_profile() function below.

-- =====================================================================
-- claim_invited_profile(p_email, p_user_id)
-- =====================================================================
-- Called by /auth/callback on first sign-in when the OAuth user has
-- no profile row yet. Atomically:
--   1. Looks up invited_users by email (citext, case-insensitive).
--   2. If a match exists, INSERTs profiles with id = p_user_id and
--      role / full_name / invited_by / invited_at copied from the
--      invite row.
--   3. Deletes the invited_users row.
--   4. Returns the inserted profile row.
--
-- Returns NULL if no matching invite (caller falls back to the
-- existing profile_missing redirect).
--
-- ON CONFLICT (id) DO NOTHING handles the double-tab race: if two
-- tabs both complete OAuth and both call this fn, the second one
-- silently no-ops on the profile insert. The invited_users row is
-- still gone after the first call so the second returns NULL — the
-- caller then re-checks profiles by id and finds the row created by
-- the first call. That re-check happens naturally in the callback.

CREATE OR REPLACE FUNCTION claim_invited_profile(
    p_email   citext,
    p_user_id uuid
) RETURNS profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_invite  invited_users%ROWTYPE;
    v_profile profiles%ROWTYPE;
BEGIN
    SELECT * INTO v_invite FROM invited_users WHERE email = p_email;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    INSERT INTO profiles (id, email, full_name, role, is_active, invited_by, invited_at)
    VALUES (
        p_user_id,
        p_email,
        v_invite.full_name,
        v_invite.role,
        true,
        v_invite.invited_by,
        v_invite.invited_at
    )
    ON CONFLICT (id) DO NOTHING;

    DELETE FROM invited_users WHERE email = p_email;

    SELECT * INTO v_profile FROM profiles WHERE id = p_user_id;
    RETURN v_profile;
END;
$$;

GRANT EXECUTE ON FUNCTION claim_invited_profile(citext, uuid) TO authenticated;
