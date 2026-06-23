-- 0066_companies_location_fk.sql
-- Controlled location as single source of truth for the company form
-- and the Maps tab.
--
-- Scope: bounded — only touches city_lookup + companies, plus a
-- targeted exact-match backfill of the new FK from existing city
-- text. Nothing else changes.
--
-- Step 0 audit (recorded here for migration self-explanation):
--   - companies.city is the only geo column today (free text).
--   - FX-024 region filter on /companies does `city ilike '%val%'` —
--     stays on the legacy text column for now.
--   - GeographicHeatMap already reads city_lookup (created 0020) and
--     joins to companies.city by name. The "hardcoded list" the spec
--     referenced is actually the reference table — no fork needed.
--   - city_lookup is already seeded with all 7 UAE emirates (and a
--     few sub-zones) per supabase/seed.sql:143-159.
--
-- Decision: extend city_lookup (it's the existing single source) and
-- add a controlled companies.location_id FK that references it. The
-- existing companies.city stays as the optional "area / community"
-- detail field; the FK is the analysis primary.

-- ---------------------------------------------------------------------------
-- 1) city_lookup gains a country dimension so the form's Country →
--    Emirate cascade can filter on it. UAE is the default for every
--    existing row (seed.sql is UAE-only today).
-- ---------------------------------------------------------------------------

ALTER TABLE city_lookup
    ADD COLUMN IF NOT EXISTS country text NOT NULL
        DEFAULT 'United Arab Emirates';

CREATE INDEX IF NOT EXISTS city_lookup_country_idx
    ON city_lookup (country)
    WHERE is_active = true;

-- ---------------------------------------------------------------------------
-- 2) companies gains a controlled location FK. NULLable: existing rows
--    that don't match an emirate exactly will stay null and surface in
--    the map's "not placed" count (honestly) — admin can fix per-row.
--
--    ON DELETE SET NULL — never lose a company because a lookup row got
--    deactivated; surface it as unmatched instead.
-- ---------------------------------------------------------------------------

ALTER TABLE companies
    ADD COLUMN IF NOT EXISTS location_id uuid NULL
        REFERENCES city_lookup(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS companies_location_id_idx
    ON companies (location_id)
    WHERE is_active = true AND location_id IS NOT NULL;

COMMENT ON COLUMN companies.location_id IS
    'Controlled emirate-level location. Single source of truth for the '
    'Maps tab and the analysis "where is this stakeholder" answer. '
    'companies.city stays as an optional free-text area / community '
    'detail; analysis keys on location_id, not city.';

-- ---------------------------------------------------------------------------
-- 3) Safe backfill — exact canonical-emirate name match only.
--
--    Joins city_lookup rows that ARE the emirate (city_name = emirate)
--    and country = UAE, then matches by trim+lower against companies.city.
--    This places companies whose city is exactly 'Dubai', 'Abu Dhabi',
--    etc. Sub-zone names ('Downtown Dubai', 'Business Bay'…) are not
--    backfilled in this step — they need an alias map the admin will
--    supply next, separately. We do NOT guess.
-- ---------------------------------------------------------------------------

UPDATE companies c
   SET location_id = cl.id
  FROM city_lookup cl
 WHERE c.location_id IS NULL
   AND c.city IS NOT NULL
   AND cl.is_active = true
   AND cl.country = 'United Arab Emirates'
   AND cl.city_name = cl.emirate
   AND lower(btrim(c.city)) = lower(btrim(cl.city_name));

-- ---------------------------------------------------------------------------
-- 4) Diagnostic — emitted as NOTICEs so they show up in the SQL editor
--    output panel when this migration runs. Read them off and report
--    the unmatched values back to me; we'll wire an alias map next.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    v_placed   int;
    v_unplaced int;
    v_rec      record;
BEGIN
    SELECT count(*) INTO v_placed
      FROM companies
     WHERE is_active = true AND location_id IS NOT NULL;

    SELECT count(*) INTO v_unplaced
      FROM companies
     WHERE is_active = true AND location_id IS NULL;

    RAISE NOTICE '[0066] companies placed (location_id NOT NULL): %', v_placed;
    RAISE NOTICE '[0066] companies unplaced (location_id IS NULL): %', v_unplaced;
    RAISE NOTICE '[0066] --- unplaced distinct city values (top 50 by count) ---';

    FOR v_rec IN
        SELECT COALESCE(NULLIF(btrim(city), ''), '(null/blank)') AS city_val,
               count(*) AS n
          FROM companies
         WHERE is_active = true
           AND location_id IS NULL
         GROUP BY 1
         ORDER BY n DESC, city_val
         LIMIT 50
    LOOP
        RAISE NOTICE '[0066]   % — %', v_rec.n, v_rec.city_val;
    END LOOP;
END
$$;
