-- 0004_companies.sql
-- Canonical stakeholder master. Prompt §3.2.
-- Single-owner enforced at data level (owner_id uniqueness not enforced — a
-- profile owns many companies; a company has at most one owner, enforced by
-- column NOT being a link table).
-- current_level is the CACHED value of the latest level_history row; writes
-- go through change_company_level() only (trigger in 0021).

CREATE TABLE companies (
    id                          uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_name              text            NOT NULL,
    aliases                     text[]          NOT NULL DEFAULT ARRAY[]::text[],
    company_type                company_type_t  NOT NULL,
    country                     text            NOT NULL DEFAULT 'United Arab Emirates',
    city                        text            NULL,
    phone                       text            NULL,
    email                       text            NULL,
    website                     text            NULL,
    key_contact_name            text            NULL,
    key_contact_role            text            NULL,
    key_contact_email           text            NULL,
    key_contact_phone           text            NULL,
    notes_internal              text            NULL,
    -- derived flag. Explicit enum casts on the literals so PG15 treats the
    -- expression as IMMUTABLE (required for GENERATED ALWAYS AS STORED).
    is_in_kpi_universe          boolean         NOT NULL
        GENERATED ALWAYS AS (
            company_type = 'developer'::company_type_t
            OR company_type = 'design_consultant'::company_type_t
            OR company_type = 'main_contractor'::company_type_t
        ) STORED,
    current_level               level_t         NOT NULL DEFAULT 'L0',
    level_changed_at            timestamptz     NULL,
    has_active_projects         boolean         NOT NULL DEFAULT false,
    last_seen_in_upload_id      uuid            NULL, -- FK added in 0012 after bnc_uploads exists
    last_seen_in_upload_at      timestamptz     NULL,
    owner_id                    uuid            NULL REFERENCES profiles(id) ON DELETE SET NULL,
    owner_assigned_at           timestamptz     NULL,
    source                      company_source_t NOT NULL DEFAULT 'manual',
    is_active                   boolean         NOT NULL DEFAULT true,
    is_key_stakeholder          boolean         NOT NULL DEFAULT false,
    created_at                  timestamptz     NOT NULL DEFAULT now(),
    updated_at                  timestamptz     NOT NULL DEFAULT now(),
    CONSTRAINT companies_canonical_name_not_blank
        CHECK (length(trim(canonical_name)) > 0)
);

COMMENT ON COLUMN companies.is_in_kpi_universe IS
    'Auto-derived: developers + design_consultants + main_contractors count toward Drivers A/B/C.';
COMMENT ON COLUMN companies.current_level IS
    'Cached from latest level_history row. Direct writes rejected — use change_company_level().';
COMMENT ON COLUMN companies.is_key_stakeholder IS
    'Admin-marked. Surfaces prominently in leadership reports (§3.17).';

-- Unique canonical name (case-insensitive) to prevent accidental duplicates
-- from manual-entry flow. BNC pipeline uses fuzzy match before insert, so this
-- only fires on same-string duplicates.
CREATE UNIQUE INDEX companies_canonical_name_ci_uq
    ON companies (lower(canonical_name));

-- Fuzzy-match index for BNC resolver (§4.3)
CREATE INDEX companies_canonical_name_trgm
    ON companies USING gin (canonical_name gin_trgm_ops);

-- The polymorphic array_to_string(anyarray, text) is marked STABLE by
-- Postgres 15 on the Supabase platform, which disqualifies it from use in
-- an index expression. Wrap it in a concretely-typed IMMUTABLE function
-- so the GIN trgm index on aliases can be built. text[] → text conversion
-- has no hidden time-zone / locale dependency so this is truthfully
-- IMMUTABLE.
CREATE OR REPLACE FUNCTION agsi_aliases_to_text(a text[])
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$ SELECT coalesce(array_to_string(a, ' '), '') $$;

CREATE INDEX companies_aliases_trgm
    ON companies USING gin (agsi_aliases_to_text(aliases) gin_trgm_ops);

CREATE INDEX companies_owner_id_idx    ON companies (owner_id) WHERE is_active = true;
CREATE INDEX companies_current_level_idx ON companies (current_level) WHERE is_active = true;
CREATE INDEX companies_company_type_idx ON companies (company_type);
CREATE INDEX companies_has_active_projects_idx ON companies (has_active_projects) WHERE has_active_projects = true;
CREATE INDEX companies_is_key_stakeholder_idx ON companies (is_key_stakeholder) WHERE is_key_stakeholder = true;

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
