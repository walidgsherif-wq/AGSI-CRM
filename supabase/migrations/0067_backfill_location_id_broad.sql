-- 0067_backfill_location_id_broad.sql
-- Broaden the 0066 backfill to reproduce the OLD map's match set so no
-- placed record regresses and sub-zone matches (Downtown Dubai,
-- Business Bay, JVC, DIFC, Jumeirah, Dubai Marina, Al Ain, Ruwais…)
-- place too.
--
-- Predicate parity with the old GeographicHeatMap:
--   pre-FK match    : LOWER(companies.city) = LOWER(city_lookup.city_name)
--                     over every city_lookup row with is_active = true
--                     (no emirate-only restriction, no country filter).
--   0066 backfill   : added the cl.city_name = cl.emirate and country
--                     filters — strictly narrower (7 emirate rows only).
--   0067 (this one) : drops both narrowing filters; matches against any
--                     active city_lookup row. btrim() added as a small
--                     safety belt for stray whitespace (the old map
--                     skipped it; broader, never narrower).
--
-- Tiebreaker — if a normalised city string somehow matches >1 active
-- city_lookup row (impossible against the current seed since city_name
-- is UNIQUE, but the schema lets a sub-zone be re-added under a
-- different case in the future), prefer the emirate-level row. This
-- keeps analysis aggregating up to the emirate when the data is
-- ambiguous — same behaviour as the old map's first-match semantics
-- but deterministic.
--
-- Fuzzy / alias matches (e.g. "Bus. Bay" → Business Bay, "Down Town
-- Dubai" → Downtown Dubai) are NOT attempted here. After running this,
-- the NOTICE output lists what's still unmatched; an alias map follows
-- next.
--
-- Idempotent: only updates rows where location_id IS NULL, so safe to
-- re-run.

-- ---------------------------------------------------------------------------
-- 1) Broad backfill, emirate-preferring tiebreak.
-- ---------------------------------------------------------------------------

WITH match AS (
    SELECT DISTINCT ON (c.id)
           c.id  AS company_id,
           cl.id AS location_id
      FROM companies   c
      JOIN city_lookup cl
        ON cl.is_active = true
       AND lower(btrim(cl.city_name)) = lower(btrim(c.city))
     WHERE c.is_active    = true
       AND c.location_id IS NULL
       AND c.city        IS NOT NULL
       AND btrim(c.city) <> ''
     ORDER BY c.id,
              -- emirate-level row wins over sub-zone when ambiguous
              (cl.city_name = cl.emirate) DESC,
              cl.city_name
)
UPDATE companies c
   SET location_id = m.location_id
  FROM match m
 WHERE c.id = m.company_id;

-- ---------------------------------------------------------------------------
-- 2) Diagnostic — placed / unplaced / top-50 unmatched. Read these off
--    the SQL editor's Messages panel; they drive the alias map next.
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

    RAISE NOTICE '[0067] companies placed (location_id NOT NULL): %', v_placed;
    RAISE NOTICE '[0067] companies unplaced (location_id IS NULL): %', v_unplaced;
    RAISE NOTICE '[0067] --- unplaced distinct city values (top 50 by count) ---';

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
        RAISE NOTICE '[0067]   % — %', v_rec.n, v_rec.city_val;
    END LOOP;
END
$$;
