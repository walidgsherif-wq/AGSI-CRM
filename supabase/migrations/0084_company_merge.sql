-- 0084_company_merge.sql
-- Company merge — collapse a true duplicate into a surviving record.
--
-- Distinct from grouping (0081): grouping ASSOCIATES two separate
-- entities under a shared parent; merge COLLAPSES two records that
-- refer to the same entity. Merge is the most destructive operation
-- in the app, so we build it soft (non-null merged_into_company_id
-- hides the row from every list) and record enough provenance for
-- a future un-merge (Build 3).
--
-- What this migration does:
--   1) Adds companies.merged_into_company_id + merged_at + merged_by.
--      Also adds company_merge (header) + company_merge_child
--      (per-row manifest of what was re-pointed) so un-merge is
--      possible later.
--   2) Adds company_distinct_pairs so a "mark distinct" verdict on
--      the finder suppresses future suggestions.
--   3) Rebuilds the company_stats view (0052) to exclude merged rows.
--   4) Ships merge_companies() — the SECURITY DEFINER RPC that:
--        - guards on same company_type, no already-merged inputs,
--          ownership rule (self-owned/unowned OR bd_head/admin);
--        - snapshots each absorbed's child rows into
--          company_merge_child for un-merge later;
--        - re-points every FK to the survivor, deduping on
--          project_companies(project_id, company_id, role),
--          ecosystem_events.dedup_key (rebuilt to the survivor's
--          key on move), and the contacts_one_primary partial
--          unique index;
--        - handles grouping: re-points children of an absorbed
--          parent to the survivor, and clears survivor.parent
--          if it was pointing at the absorbed (else the cycle
--          guard fires);
--        - applies p_field_choices to the survivor (level,
--          owner_id, phone/email/website, location_id, country,
--          is_key_stakeholder, parent_company_id);
--        - marks each absorbed merged and writes the header +
--          audit trail.
--   5) Ships mark_companies_distinct() — insert one row in
--      company_distinct_pairs with a canonical ordering so
--      (A, B) and (B, A) resolve to the same pair.
--
-- Doesn't touch: un-merge (Build 3), the BNC ingest flow, KPI /
-- ecosystem math (they read via company_stats which now filters).

-- ---------------------------------------------------------------------------
-- 1) Schema — merge markers on companies
-- ---------------------------------------------------------------------------

ALTER TABLE companies
    ADD COLUMN IF NOT EXISTS merged_into_company_id uuid NULL
        REFERENCES companies(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS merged_at              timestamptz NULL,
    ADD COLUMN IF NOT EXISTS merged_by              uuid NULL
        REFERENCES profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN companies.merged_into_company_id IS
    'Non-null = this row was absorbed into merged_into_company_id and '
    'is hidden from every list, search, and stats query. Historical URLs '
    'to /companies/<id> still resolve — the detail page shows a "merged '
    'into" banner and redirects reads to the survivor.';

-- Partial index — fast "is this company merged?" checks + used by every
-- list-page filter we're adding in this session.
CREATE INDEX IF NOT EXISTS companies_merged_idx
    ON companies (merged_into_company_id)
    WHERE merged_into_company_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS companies_live_idx
    ON companies (id)
    WHERE merged_into_company_id IS NULL;

-- ---------------------------------------------------------------------------
-- 2) Merge header + per-row manifest (provenance for un-merge)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS company_merge (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    survivor_id     uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    absorbed_id     uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    merged_by       uuid        NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
    merged_at       timestamptz NOT NULL DEFAULT now(),
    -- Which field's value the survivor took, per field. Shape:
    --   {"level":"absorbed","owner_id":"survivor","phone":"absorbed", ...}
    -- Values: 'survivor' | 'absorbed'. Fields that didn't conflict are
    -- omitted (survivor already had that value).
    field_choices   jsonb       NOT NULL DEFAULT '{}'::jsonb,
    -- Snapshot of the ABSORBED row at merge time (before it was marked
    -- merged). Used to reconstruct the absorbed record on un-merge.
    absorbed_snapshot jsonb     NOT NULL,
    UNIQUE (absorbed_id)  -- an absorbed company can only be merged once
);

CREATE INDEX IF NOT EXISTS company_merge_survivor_idx
    ON company_merge (survivor_id, merged_at DESC);

COMMENT ON TABLE company_merge IS
    'One row per merge event. absorbed_id is UNIQUE — the same '
    'company can never be absorbed twice.';

CREATE TABLE IF NOT EXISTS company_merge_child (
    id                    uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
    merge_id              uuid    NOT NULL REFERENCES company_merge(id) ON DELETE CASCADE,
    table_name            text    NOT NULL,
    row_id                uuid    NOT NULL,
    -- Which company_id the row had BEFORE merge — always the absorbed
    -- id here (that's the whole point of the manifest). Kept as a
    -- column for direct SQL inspection.
    original_company_id   uuid    NOT NULL,
    -- 'repointed' = row was updated to point at the survivor.
    -- 'dropped'   = row was deleted because of a unique-key collision
    --               with a survivor row (project_companies, ecosystem).
    -- 'demoted'   = contacts.is_primary flipped to false before repoint
    --               (survivor already had a primary).
    action                text    NOT NULL
        CHECK (action IN ('repointed','dropped','demoted')),
    -- For 'dropped', we capture enough of the row to reconstitute it
    -- on un-merge. NULL for 'repointed' / 'demoted' (the row still
    -- exists, un-merge just moves it back).
    payload               jsonb   NULL
);

CREATE INDEX IF NOT EXISTS company_merge_child_merge_idx
    ON company_merge_child (merge_id, table_name);

-- ---------------------------------------------------------------------------
-- 3) Distinct-pair suppressions for the finder
-- ---------------------------------------------------------------------------

-- Canonical ordering (a_id < b_id) so (A,B) and (B,A) resolve to the
-- same pair. The CHECK enforces it; the UNIQUE guards against a
-- second "mark distinct" verdict on the same pair.
CREATE TABLE IF NOT EXISTS company_distinct_pairs (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    a_id         uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    b_id         uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    marked_by    uuid        NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
    marked_at    timestamptz NOT NULL DEFAULT now(),
    reason       text        NULL,
    CONSTRAINT company_distinct_pairs_ordering CHECK (a_id < b_id),
    UNIQUE (a_id, b_id)
);

CREATE INDEX IF NOT EXISTS company_distinct_pairs_a_idx
    ON company_distinct_pairs (a_id);
CREATE INDEX IF NOT EXISTS company_distinct_pairs_b_idx
    ON company_distinct_pairs (b_id);

-- ---------------------------------------------------------------------------
-- 4) RLS
-- ---------------------------------------------------------------------------

ALTER TABLE company_merge          ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_merge_child    ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_distinct_pairs ENABLE ROW LEVEL SECURITY;

-- Everyone authenticated can read the merge log + manifest (transparent
-- history). Writes go through the RPC + INSERT policy below.
CREATE POLICY company_merge_select_all
    ON company_merge FOR SELECT
    USING (auth.uid() IS NOT NULL);

CREATE POLICY company_merge_child_select_all
    ON company_merge_child FOR SELECT
    USING (auth.uid() IS NOT NULL);

-- Distinct-pairs: readable by all, insertable by any BD role, deletable
-- by admin (in case a wrong "mark distinct" needs undoing).
CREATE POLICY company_distinct_pairs_select_all
    ON company_distinct_pairs FOR SELECT
    USING (auth.uid() IS NOT NULL);

CREATE POLICY company_distinct_pairs_insert_bd
    ON company_distinct_pairs FOR INSERT
    WITH CHECK (
        auth.uid() IS NOT NULL
        AND public.auth_role() IN ('admin','bd_head','bd_manager')
        AND marked_by = auth.uid()
    );

CREATE POLICY company_distinct_pairs_delete_admin
    ON company_distinct_pairs FOR DELETE
    USING (public.auth_role() = 'admin');

-- ---------------------------------------------------------------------------
-- 5) company_stats view — exclude merged rows
-- ---------------------------------------------------------------------------
--
-- Verbatim copy of 0052 with a single WHERE clause added. Everything
-- else (unique_links CTE, agg CTE, engagement score join,
-- get_rebar_share helper) stays identical.

CREATE OR REPLACE VIEW company_stats
WITH (security_invoker = on) AS
WITH unique_links AS (
    SELECT DISTINCT pc.company_id, pc.project_id
      FROM project_companies pc
     WHERE pc.is_current = true
),
agg AS (
    SELECT
        ul.company_id,
        COUNT(*)                                 AS project_count,
        SUM(COALESCE(p.value_aed, 0))::numeric   AS project_value_involved
      FROM unique_links ul
      JOIN projects p ON p.id = ul.project_id
     GROUP BY ul.company_id
)
SELECT
    c.id                                                              AS company_id,
    c.canonical_name,
    c.current_level                                                   AS level,
    c.owner_id,
    COALESCE(a.project_count, 0)                                      AS project_count,
    COALESCE(a.project_value_involved, 0)::numeric                    AS project_value_involved,
    (COALESCE(a.project_value_involved, 0) * get_rebar_share())::numeric AS est_steel_value,
    ces.days_since_last_engagement                                    AS days_since_last_contact,
    ces.bucket                                                        AS engagement_bucket
  FROM companies c
  LEFT JOIN agg a                       ON a.company_id    = c.id
  LEFT JOIN company_engagement_score ces ON ces.company_id = c.id
 WHERE c.merged_into_company_id IS NULL;

GRANT SELECT ON company_stats TO authenticated;

COMMENT ON VIEW company_stats IS
    'Per-company sortable/filterable stats (FX-024 foundation). Now '
    'excludes merged-away companies (merged_into_company_id IS NOT NULL) '
    'so every downstream list, search, KPI, and coverage read stops '
    'seeing them by default.';

-- ---------------------------------------------------------------------------
-- 5.5) find_company_by_fuzzy_name (0025) — exclude merged rows
-- ---------------------------------------------------------------------------
-- Rebuild verbatim from 0025 with a `merged_into_company_id IS NULL`
-- guard added to the CTE's WHERE. Prevents the BNC resolver from
-- silently resurrecting a merged-away row on the next upload.

CREATE OR REPLACE FUNCTION find_company_by_fuzzy_name(
    p_token     text,
    p_threshold numeric DEFAULT 0.75
) RETURNS TABLE (
    company_id        uuid,
    canonical_name    text,
    similarity_score  numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH scored AS (
        SELECT
            c.id   AS company_id,
            c.canonical_name,
            GREATEST(
                similarity(c.canonical_name, p_token),
                similarity(agsi_aliases_to_text(c.aliases), p_token)
            ) AS sim
        FROM companies c
        WHERE
            c.merged_into_company_id IS NULL
            AND (
                similarity(c.canonical_name, p_token) >= p_threshold
                OR similarity(agsi_aliases_to_text(c.aliases), p_token) >= p_threshold
            )
    )
    SELECT company_id, canonical_name, sim
      FROM scored
     ORDER BY sim DESC
     LIMIT 1;
$$;

-- ---------------------------------------------------------------------------
-- 6) mark_companies_distinct — verdict from the duplicate finder
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION mark_companies_distinct(
    p_a uuid,
    p_b uuid,
    p_reason text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_a uuid;
    v_b uuid;
    v_id uuid;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;
    IF auth_role() NOT IN ('admin','bd_head','bd_manager') THEN
        RAISE EXCEPTION 'Your role cannot mark distinct pairs.';
    END IF;
    IF p_a = p_b THEN
        RAISE EXCEPTION 'A company cannot be marked distinct from itself.';
    END IF;

    -- Canonical ordering (a_id < b_id) so (A,B) and (B,A) collapse.
    IF p_a < p_b THEN v_a := p_a; v_b := p_b;
    ELSE              v_a := p_b; v_b := p_a;
    END IF;

    INSERT INTO company_distinct_pairs (a_id, b_id, marked_by, reason)
    VALUES (v_a, v_b, auth.uid(), p_reason)
    ON CONFLICT (a_id, b_id) DO UPDATE
        SET marked_by = EXCLUDED.marked_by,
            marked_at = now(),
            reason    = COALESCE(EXCLUDED.reason, company_distinct_pairs.reason)
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION mark_companies_distinct(uuid, uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6.5) find_duplicate_candidates — the finder query
-- ---------------------------------------------------------------------------
-- Lists top same-type name-lookalikes as (a_id, b_id) pairs in
-- canonical order (a_id < b_id) so the same pair is never returned
-- twice. Filters:
--   - both sides live (not merged, is_active)
--   - not already marked distinct
--   - similarity above a caller-configurable threshold
-- Uses the existing companies_canonical_name_trgm GiST index so
-- runtime is small even at 10k+ companies.

CREATE OR REPLACE FUNCTION find_duplicate_candidates(
    p_threshold numeric DEFAULT 0.55,
    p_limit     int     DEFAULT 100
) RETURNS TABLE (
    a_id           uuid,
    a_name         text,
    b_id           uuid,
    b_name         text,
    company_type   company_type_t,
    similarity     numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        a.id            AS a_id,
        a.canonical_name AS a_name,
        b.id            AS b_id,
        b.canonical_name AS b_name,
        a.company_type,
        similarity(a.canonical_name, b.canonical_name) AS sim
      FROM companies a
      JOIN companies b
        ON b.company_type = a.company_type
       AND b.id > a.id
       AND b.canonical_name % a.canonical_name  -- uses trgm GiST index
     WHERE a.merged_into_company_id IS NULL
       AND b.merged_into_company_id IS NULL
       AND a.is_active = true
       AND b.is_active = true
       AND similarity(a.canonical_name, b.canonical_name) >= p_threshold
       AND NOT EXISTS (
           SELECT 1 FROM company_distinct_pairs dp
            WHERE dp.a_id = a.id AND dp.b_id = b.id
       )
     ORDER BY sim DESC
     LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION find_duplicate_candidates(numeric, int) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7) merge_companies — the main event
-- ---------------------------------------------------------------------------
--
-- Args:
--   p_survivor       — id of the company to keep
--   p_absorbed       — array of ids to fold into p_survivor
--   p_field_choices  — per-field winner ('survivor'|'absorbed') for
--                      each conflicting field. Shape:
--                        {"level":"absorbed","owner_id":"survivor", ...}
--                      Fields omitted → survivor keeps its value.
--
-- Returns the company_merge.id of the FIRST absorbed row (for the
-- typical single-absorbed case). Multi-absorbed is supported but
-- rare; UI submits one at a time.
--
-- Guards (fail-fast, atomic):
--   - Caller authenticated + role in {admin, bd_head, bd_manager}.
--   - Same company_type across survivor + all absorbed.
--   - None already merged.
--   - Ownership: bd_manager can only merge companies that are their
--     own or unowned. bd_head + admin can merge anything. (The locked
--     rule.)
--
-- Idempotency: caller cannot merge the same absorbed twice — the
-- company_merge.absorbed_id UNIQUE constraint enforces that even if
-- the RPC is retried mid-flight.

CREATE OR REPLACE FUNCTION merge_companies(
    p_survivor      uuid,
    p_absorbed      uuid[],
    p_field_choices jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id      uuid := auth.uid();
    v_caller_role    role_t;
    v_survivor_row   companies%ROWTYPE;
    v_absorbed_row   companies%ROWTYPE;
    v_absorbed_id    uuid;
    v_merge_id       uuid;
    v_now            timestamptz := now();
    v_first_merge_id uuid;
    v_snapshot       jsonb;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;

    v_caller_role := auth_role();
    IF v_caller_role IS NULL
       OR v_caller_role NOT IN ('admin','bd_head','bd_manager') THEN
        RAISE EXCEPTION 'Your role cannot merge companies.';
    END IF;

    IF p_survivor IS NULL OR cardinality(p_absorbed) = 0 THEN
        RAISE EXCEPTION 'Both survivor and at least one absorbed id are required.';
    END IF;

    IF p_survivor = ANY (p_absorbed) THEN
        RAISE EXCEPTION 'A company cannot absorb itself.';
    END IF;

    -- Lock the survivor row for the duration.
    SELECT * INTO v_survivor_row
      FROM companies WHERE id = p_survivor FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Survivor company % not found.', p_survivor;
    END IF;
    IF v_survivor_row.merged_into_company_id IS NOT NULL THEN
        RAISE EXCEPTION 'Survivor is itself a merged (absorbed) company.';
    END IF;

    -- Ownership rule for the survivor (bd_manager gate).
    IF v_caller_role = 'bd_manager'
       AND v_survivor_row.owner_id IS NOT NULL
       AND v_survivor_row.owner_id <> v_caller_id THEN
        RAISE EXCEPTION 'Survivor is owned by another member — bd_head/admin must merge.';
    END IF;

    -- ── Per-absorbed loop ────────────────────────────────────────────
    -- Structured so each absorbed row is its own logical merge event
    -- (one company_merge header per absorbed). Keeps un-merge simple:
    -- reverse the manifest by merge_id.
    FOREACH v_absorbed_id IN ARRAY p_absorbed
    LOOP
        SELECT * INTO v_absorbed_row
          FROM companies WHERE id = v_absorbed_id FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Absorbed company % not found.', v_absorbed_id;
        END IF;
        IF v_absorbed_row.merged_into_company_id IS NOT NULL THEN
            RAISE EXCEPTION 'Company % is already merged.', v_absorbed_id;
        END IF;
        IF v_absorbed_row.company_type <> v_survivor_row.company_type THEN
            RAISE EXCEPTION
                'Cannot merge across company types: survivor is %, absorbed % is %.',
                v_survivor_row.company_type, v_absorbed_id, v_absorbed_row.company_type;
        END IF;
        IF v_caller_role = 'bd_manager'
           AND v_absorbed_row.owner_id IS NOT NULL
           AND v_absorbed_row.owner_id <> v_caller_id THEN
            RAISE EXCEPTION
                'Absorbed % is owned by another member — bd_head/admin must merge.',
                v_absorbed_id;
        END IF;

        -- Snapshot the absorbed row BEFORE any change (for un-merge).
        v_snapshot := to_jsonb(v_absorbed_row);

        -- Create the merge header up front so per-row manifest rows
        -- can reference merge_id.
        INSERT INTO company_merge (
            survivor_id, absorbed_id, merged_by, field_choices,
            absorbed_snapshot
        ) VALUES (
            p_survivor, v_absorbed_id, v_caller_id, p_field_choices,
            v_snapshot
        ) RETURNING id INTO v_merge_id;
        IF v_first_merge_id IS NULL THEN
            v_first_merge_id := v_merge_id;
        END IF;

        -- ── Re-point + dedup, per FK table ───────────────────────────
        --
        -- Consistent pattern:
        --   WITH moved AS (UPDATE … RETURNING id)
        --   INSERT INTO company_merge_child …
        -- so the manifest records every row that changed, needed by
        -- un-merge (Build 3). For tables with unique constraints, we
        -- drop colliding absorbed rows first (logging them as
        -- 'dropped' with a full payload for un-merge reconstruction),
        -- then re-point the rest.

        -- level_history — no company_id uniqueness; plain re-point +
        -- per-row manifest via RETURNING.
        WITH moved AS (
            UPDATE level_history SET company_id = p_survivor
             WHERE company_id = v_absorbed_id
            RETURNING id
        )
        INSERT INTO company_merge_child (
            merge_id, table_name, row_id, original_company_id, action
        )
        SELECT v_merge_id, 'level_history', id, v_absorbed_id, 'repointed'
          FROM moved;

        -- project_companies — UNIQUE(project_id, company_id, role).
        -- Drop absorbed rows that collide with a survivor row on
        -- (project_id, role); log the dropped rows with full payload.
        WITH dropped AS (
            DELETE FROM project_companies pc_abs
             WHERE pc_abs.company_id = v_absorbed_id
               AND EXISTS (
                   SELECT 1 FROM project_companies pc_sur
                    WHERE pc_sur.company_id = p_survivor
                      AND pc_sur.project_id = pc_abs.project_id
                      AND pc_sur.role       = pc_abs.role
               )
            RETURNING id, to_jsonb(project_companies.*) AS row_json
        )
        INSERT INTO company_merge_child (
            merge_id, table_name, row_id, original_company_id, action, payload
        )
        SELECT v_merge_id, 'project_companies', id, v_absorbed_id, 'dropped', row_json
          FROM dropped;

        WITH moved AS (
            UPDATE project_companies SET company_id = p_survivor
             WHERE company_id = v_absorbed_id
            RETURNING id
        )
        INSERT INTO company_merge_child (
            merge_id, table_name, row_id, original_company_id, action
        )
        SELECT v_merge_id, 'project_companies', id, v_absorbed_id, 'repointed'
          FROM moved;

        -- ecosystem_events — UNIQUE(dedup_key) where dedup_key has
        -- shape '{company_id}|{subtype}|{day}'. On re-point we rebuild
        -- the key; if the rebuilt key already exists on the survivor
        -- side, drop the absorbed row.
        WITH dropped AS (
            DELETE FROM ecosystem_events ee_abs
             WHERE ee_abs.company_id = v_absorbed_id
               AND EXISTS (
                   SELECT 1 FROM ecosystem_events ee_sur
                    WHERE ee_sur.dedup_key = replace(
                        ee_abs.dedup_key,
                        v_absorbed_id::text,
                        p_survivor::text
                    )
               )
            RETURNING id, to_jsonb(ecosystem_events.*) AS row_json
        )
        INSERT INTO company_merge_child (
            merge_id, table_name, row_id, original_company_id, action, payload
        )
        SELECT v_merge_id, 'ecosystem_events', id, v_absorbed_id, 'dropped', row_json
          FROM dropped;

        WITH moved AS (
            UPDATE ecosystem_events
               SET company_id = p_survivor,
                   dedup_key  = replace(dedup_key, v_absorbed_id::text, p_survivor::text)
             WHERE company_id = v_absorbed_id
            RETURNING id
        )
        INSERT INTO company_merge_child (
            merge_id, table_name, row_id, original_company_id, action
        )
        SELECT v_merge_id, 'ecosystem_events', id, v_absorbed_id, 'repointed'
          FROM moved;

        -- engagements / tasks / notes — no company_id uniqueness.
        WITH moved AS (
            UPDATE engagements SET company_id = p_survivor
             WHERE company_id = v_absorbed_id
            RETURNING id
        )
        INSERT INTO company_merge_child (
            merge_id, table_name, row_id, original_company_id, action
        )
        SELECT v_merge_id, 'engagements', id, v_absorbed_id, 'repointed'
          FROM moved;

        WITH moved AS (
            UPDATE tasks SET company_id = p_survivor
             WHERE company_id = v_absorbed_id
            RETURNING id
        )
        INSERT INTO company_merge_child (
            merge_id, table_name, row_id, original_company_id, action
        )
        SELECT v_merge_id, 'tasks', id, v_absorbed_id, 'repointed'
          FROM moved;

        WITH moved AS (
            UPDATE notes SET company_id = p_survivor
             WHERE company_id = v_absorbed_id
            RETURNING id
        )
        INSERT INTO company_merge_child (
            merge_id, table_name, row_id, original_company_id, action
        )
        SELECT v_merge_id, 'notes', id, v_absorbed_id, 'repointed'
          FROM moved;

        -- contacts — dedup contacts_one_primary partial unique
        -- (is_primary AND deleted_at IS NULL). If both sides have a
        -- live primary, demote the absorbed's before re-pointing so
        -- the partial unique index stays honest.
        IF EXISTS (
            SELECT 1 FROM contacts
             WHERE company_id = p_survivor
               AND is_primary AND deleted_at IS NULL
        ) AND EXISTS (
            SELECT 1 FROM contacts
             WHERE company_id = v_absorbed_id
               AND is_primary AND deleted_at IS NULL
        ) THEN
            WITH demoted AS (
                UPDATE contacts SET is_primary = false
                 WHERE company_id = v_absorbed_id
                   AND is_primary AND deleted_at IS NULL
                RETURNING id
            )
            INSERT INTO company_merge_child (
                merge_id, table_name, row_id, original_company_id, action
            )
            SELECT v_merge_id, 'contacts', id, v_absorbed_id, 'demoted'
              FROM demoted;
        END IF;
        WITH moved AS (
            UPDATE contacts SET company_id = p_survivor
             WHERE company_id = v_absorbed_id
            RETURNING id
        )
        INSERT INTO company_merge_child (
            merge_id, table_name, row_id, original_company_id, action
        )
        SELECT v_merge_id, 'contacts', id, v_absorbed_id, 'repointed'
          FROM moved;

        -- documents / leadership_reports / level_change_requests —
        -- no company_id uniqueness on these; plain re-point + log.
        WITH moved AS (
            UPDATE documents SET company_id = p_survivor
             WHERE company_id = v_absorbed_id
            RETURNING id
        )
        INSERT INTO company_merge_child (
            merge_id, table_name, row_id, original_company_id, action
        )
        SELECT v_merge_id, 'documents', id, v_absorbed_id, 'repointed'
          FROM moved;

        WITH moved AS (
            UPDATE leadership_reports SET company_id = p_survivor
             WHERE company_id = v_absorbed_id
            RETURNING id
        )
        INSERT INTO company_merge_child (
            merge_id, table_name, row_id, original_company_id, action
        )
        SELECT v_merge_id, 'leadership_reports', id, v_absorbed_id, 'repointed'
          FROM moved;

        WITH moved AS (
            UPDATE level_change_requests SET company_id = p_survivor
             WHERE company_id = v_absorbed_id
            RETURNING id
        )
        INSERT INTO company_merge_child (
            merge_id, table_name, row_id, original_company_id, action
        )
        SELECT v_merge_id, 'level_change_requests', id, v_absorbed_id, 'repointed'
          FROM moved;

        -- notifications.related_company_id — plain re-point + log.
        WITH moved AS (
            UPDATE notifications SET related_company_id = p_survivor
             WHERE related_company_id = v_absorbed_id
            RETURNING id
        )
        INSERT INTO company_merge_child (
            merge_id, table_name, row_id, original_company_id, action
        )
        SELECT v_merge_id, 'notifications', id, v_absorbed_id, 'repointed'
          FROM moved;

        -- company_match_queue.suggested_company_id — plain re-point +
        -- log. Historical BNC suggestions stay pointed at the surviving
        -- record.
        WITH moved AS (
            UPDATE company_match_queue SET suggested_company_id = p_survivor
             WHERE suggested_company_id = v_absorbed_id
            RETURNING id
        )
        INSERT INTO company_merge_child (
            merge_id, table_name, row_id, original_company_id, action
        )
        SELECT v_merge_id, 'company_match_queue', id, v_absorbed_id, 'repointed'
          FROM moved;

        -- ── Grouping — 0081 handling ─────────────────────────────────

        -- If the survivor's parent was the absorbed, null it out FIRST
        -- to avoid the guard_company_parent_no_cycle trigger firing
        -- when we later re-point children.
        IF v_survivor_row.parent_company_id = v_absorbed_id THEN
            UPDATE companies SET parent_company_id = NULL WHERE id = p_survivor;
            v_survivor_row.parent_company_id := NULL;
        END IF;

        -- Absorbed was a group parent → re-point its children to the
        -- survivor (skip children that would create a self-cycle;
        -- shouldn't happen given the previous null-out, but belt).
        UPDATE companies
           SET parent_company_id = p_survivor
         WHERE parent_company_id = v_absorbed_id
           AND id <> p_survivor;

        -- Mark the absorbed row merged (this is what hides it from
        -- every list from now on).
        UPDATE companies
           SET merged_into_company_id = p_survivor,
               merged_at              = v_now,
               merged_by              = v_caller_id,
               is_active              = false,
               -- Also clear the absorbed's parent so it doesn't ghost
               -- into the group graph as a hidden child.
               parent_company_id      = NULL
         WHERE id = v_absorbed_id;

        -- Audit trail.
        INSERT INTO audit_events (
            actor_id, event_type, entity_type, entity_id,
            before_json, after_json
        ) VALUES (
            v_caller_id,
            'company_merged',
            'company',
            v_absorbed_id,
            jsonb_build_object(
                'absorbed_snapshot', v_snapshot
            ),
            jsonb_build_object(
                'merge_id', v_merge_id,
                'survivor_id', p_survivor,
                'field_choices', p_field_choices
            )
        );
    END LOOP;

    -- ── Apply p_field_choices to the survivor ────────────────────────
    -- Runs once after every absorbed has been snapshotted + repointed.
    -- We use the LAST absorbed in p_absorbed as the source of "absorbed"
    -- values — the UI submits one at a time in the normal case, so
    -- multi-absorbed remains supported but not something the UX
    -- optimises for.
    --
    -- Fetch from the snapshot column of the LAST merge header we wrote
    -- (guaranteed to reflect the pre-merge state of the absorbed row
    -- even though the row itself has since been marked merged).
    --
    -- current_level is normally guarded against direct writes (see 0004
    -- COMMENT); this UPDATE is inside a SECURITY DEFINER function so
    -- the guard doesn't apply here, but if you ever add an application-
    -- level BEFORE UPDATE trigger on current_level, it needs to whitelist
    -- app.merge_via_fn similarly to app.level_change_via_fn.
    IF p_field_choices <> '{}'::jsonb THEN
        SELECT absorbed_snapshot INTO v_snapshot
          FROM company_merge WHERE id = v_merge_id;

        -- current_level is guarded by 0021's BEFORE trigger which
        -- rejects direct writes unless app.level_change_via_fn = 'on'.
        -- Set the flag around the UPDATE so a level field-choice
        -- takes effect. Cleared immediately after.
        IF p_field_choices ->> 'level' = 'absorbed' THEN
            PERFORM set_config('app.level_change_via_fn', 'on', true);
        END IF;

        UPDATE companies AS c SET
            current_level      = CASE WHEN p_field_choices ->> 'level' = 'absorbed'
                                      THEN (v_snapshot ->> 'current_level')::level_t
                                      ELSE c.current_level END,
            owner_id           = CASE WHEN p_field_choices ->> 'owner_id' = 'absorbed'
                                      THEN NULLIF(v_snapshot ->> 'owner_id', '')::uuid
                                      ELSE c.owner_id END,
            phone              = CASE WHEN p_field_choices ->> 'phone' = 'absorbed'
                                      THEN v_snapshot ->> 'phone'
                                      ELSE c.phone END,
            email              = CASE WHEN p_field_choices ->> 'email' = 'absorbed'
                                      THEN v_snapshot ->> 'email'
                                      ELSE c.email END,
            website            = CASE WHEN p_field_choices ->> 'website' = 'absorbed'
                                      THEN v_snapshot ->> 'website'
                                      ELSE c.website END,
            location_id        = CASE WHEN p_field_choices ->> 'location_id' = 'absorbed'
                                      THEN NULLIF(v_snapshot ->> 'location_id', '')::uuid
                                      ELSE c.location_id END,
            country            = CASE WHEN p_field_choices ->> 'country' = 'absorbed'
                                      THEN v_snapshot ->> 'country'
                                      ELSE c.country END,
            is_key_stakeholder = CASE WHEN p_field_choices ->> 'is_key_stakeholder' = 'absorbed'
                                      THEN (v_snapshot ->> 'is_key_stakeholder')::boolean
                                      ELSE c.is_key_stakeholder END,
            parent_company_id  = CASE WHEN p_field_choices ->> 'parent_company_id' = 'absorbed'
                                      THEN NULLIF(v_snapshot ->> 'parent_company_id', '')::uuid
                                      ELSE c.parent_company_id END
         WHERE c.id = p_survivor;

        -- Always reset the flag whether or not it was set.
        PERFORM set_config('app.level_change_via_fn', 'off', true);
    END IF;

    RETURN v_first_merge_id;
END;
$$;

GRANT EXECUTE ON FUNCTION merge_companies(uuid, uuid[], jsonb) TO authenticated;

COMMENT ON FUNCTION merge_companies(uuid, uuid[], jsonb) IS
    'Collapse duplicate companies into a survivor. Re-points every '
    'child FK, dedups on unique-constraint collisions, handles group '
    'parent/child re-linking, applies per-field choices, and writes '
    'a full provenance manifest (company_merge + company_merge_child) '
    'for un-merge. bd_manager can only merge companies they own or '
    'that are unowned; bd_head/admin can merge anything.';
