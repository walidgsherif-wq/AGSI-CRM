-- 0003_profiles.sql
-- User profiles. 1:1 with auth.users. Role gate at application boundary.

CREATE TABLE profiles (
    id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name   text        NOT NULL,
    email       citext      NOT NULL UNIQUE,
    role        role_t      NOT NULL DEFAULT 'bd_manager',
    phone_e164  text        NULL,
    is_active   boolean     NOT NULL DEFAULT true,
    invited_by  uuid        NULL REFERENCES profiles(id) ON DELETE SET NULL,
    invited_at  timestamptz NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT profiles_phone_e164_ck
        CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{6,14}$')
);

COMMENT ON TABLE profiles IS
    'Application-level identity. Supabase auth.users is auth only; this table is the profile of record.';

-- Row-level security (policies in 0022)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
