-- 0001_extensions.sql
-- Postgres extensions needed across the schema.
-- pgcrypto: gen_random_uuid() for all PKs
-- pg_trgm:  fuzzy similarity() for BNC company resolver (§4.3)
-- citext:   case-insensitive unique on profiles.email
-- pg_cron:  scheduled Edge Function invocation (nightly rebuild, weekly drift, etc)
-- pg_net:   HTTP client for cron jobs to invoke Edge Functions

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;

-- pg_cron and pg_net are Supabase-managed — they must be enabled via
-- Dashboard → Database → Extensions BEFORE this migration runs. If they are
-- missing, the cron schedules in 0021 are skipped (wrapped in a guard).
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
