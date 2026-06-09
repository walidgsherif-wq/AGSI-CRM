-- 0053_add_society_company_type.sql
-- v1.1 (FX-015a — immediate minimum) — adds 'society' to the
-- company_type_t enum so AGSI can tag professional bodies, industry
-- societies, and trade associations as a distinct stakeholder
-- category.
--
-- This is the minimum the spec asked for. The larger conversion of
-- company_type_t from a Postgres enum to a lookup table (which would
-- make every category admin-renameable / addable from /admin/settings
-- without a schema change) is deliberately NOT done here — that move
-- has downstream impact on every CHECK constraint, RLS expression
-- that compares against company_type, the BNC ingest classifier, and
-- migration ordering. Discuss + confirm before running.
--
-- ALTER TYPE … ADD VALUE IF NOT EXISTS is safe to re-run. The new
-- label is usable in subsequent statements (PG12+).
--
-- Relationship semantics: societies use the existing L0–L5 ladder
-- like every other stakeholder type. No new level semantics, no new
-- gating, no new triggers.

ALTER TYPE company_type_t ADD VALUE IF NOT EXISTS 'society';

COMMENT ON TYPE company_type_t IS
    'Stakeholder category. Driver classification mirrors the seven roles AGSI tracks; societies cover professional bodies, industry associations, and trade groups. Hardcoded enum — to make categories admin-configurable from /admin/settings, convert this type into a lookup table in a separate flagged migration.';
