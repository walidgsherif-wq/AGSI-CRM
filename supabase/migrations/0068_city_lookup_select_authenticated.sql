-- 0068_city_lookup_select_authenticated.sql
-- Widen city_lookup SELECT so bd_manager can populate the Country →
-- Emirate dropdown introduced by 41b86db. Read-only.
--
-- Background: city_lookup is public reference data — UAE emirate
-- names + coordinates. There is no per-row ownership and nothing
-- confidential in it; the original "blocked to bd_manager" SELECT
-- policy was written when only the heat-map (admin/leadership/
-- bd_head) read this table. Adding the form-side reader (bd_manager
-- on companies they own) broke that assumption — the dropdown
-- currently renders empty under their session.
--
-- Change: replace the single SELECT policy of record with an
-- "any authenticated user" rule. Anonymous still denied because
-- auth.uid() is null off-session. Write policy unchanged — admins
-- remain the only role that can add or edit lookup rows.
--
-- Step 0 confirmed:
--   - city_lookup_select_non_manager (0022:413) is the only SELECT
--     policy on city_lookup; bd_manager is the only excluded role.
--   - Columns are id, city_name, emirate, latitude, longitude,
--     country, is_active, created_at — nothing role-sensitive.
--
-- Idempotent: DROP IF EXISTS + CREATE.

DROP POLICY IF EXISTS city_lookup_select_non_manager ON city_lookup;
DROP POLICY IF EXISTS city_lookup_select_authenticated ON city_lookup;

CREATE POLICY city_lookup_select_authenticated
    ON city_lookup FOR SELECT
    USING (auth.uid() IS NOT NULL);

-- city_lookup_write_admin (0022:417) intentionally NOT touched —
-- writes remain admin-only.
