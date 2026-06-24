-- 0075_profiles_work_email.sql
-- Adds profiles.work_email so the inbound-email resolver (Block 5)
-- can identify BD users by either their sign-in address (email) or
-- their corporate / Outlook address (work_email).
--
-- Why a separate column rather than a list of aliases: every BD user
-- has exactly one primary sign-in (Google OAuth, profiles.email) and
-- at most one work alias. Modelling it as a column keeps the resolver
-- query trivial (.in('work_email', addrs) vs a join), the cardinality
-- honest (no surprise nth-alias), and the UI obvious (one input).
--
-- citext mirrors profiles.email (0003) — case-insensitive equality,
-- which matches how email addresses behave in practice.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.

ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS work_email citext NULL;

COMMENT ON COLUMN profiles.work_email IS
    'Corporate / work email address for this BD user. Used by the '
    'inbound-email resolver alongside profiles.email to identify BD '
    'users in from/to/cc. NULL means the user only uses their primary '
    'email (e.g. Google sign-in address).';

-- Partial unique index — two users cannot share a work_email (the
-- resolver would otherwise silently pick one). NULL values are allowed
-- many times (partial WHERE clause excludes them entirely).
CREATE UNIQUE INDEX IF NOT EXISTS profiles_work_email_unique
    ON profiles (work_email)
    WHERE work_email IS NOT NULL;

-- Basic shape check so the column can't hold "alice" or "<empty>".
-- Mirrors the simple email regex used elsewhere — full RFC-5322
-- validation lives at the zod layer, not the DB.
ALTER TABLE profiles
    ADD CONSTRAINT profiles_work_email_shape
    CHECK (
        work_email IS NULL
        OR work_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    );
