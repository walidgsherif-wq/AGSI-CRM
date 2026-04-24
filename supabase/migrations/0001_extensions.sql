-- 0001_extensions.sql
-- Postgres extensions needed across the schema.
-- pgcrypto: gen_random_uuid() for all PKs
-- pg_trgm:  fuzzy similarity() for BNC company resolver (§4.3)
-- citext:   case-insensitive unique on profiles.email
-- pg_cron:  scheduled Edge Function invocation (nightly rebuild, weekly drift, etc)

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_cron;
