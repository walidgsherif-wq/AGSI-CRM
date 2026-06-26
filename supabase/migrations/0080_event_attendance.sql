-- 0080_event_attendance.sql
-- Lightweight team event-attendance log. One row per member per
-- event attended. Standalone — not linked to companies / pipeline /
-- KPI math.
--
-- Read model: transparent (every authenticated session sees every
-- row), because the value of the log is its share-with-the-team
-- semantics. Write model: each member logs their own attendance —
-- everyone, including admin and leadership, gets to record events
-- they attended. RLS does the gating.

CREATE TABLE event_attendance (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id   uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    event_name  text        NOT NULL,
    event_date  date        NOT NULL,
    event_type  text        NOT NULL
        CHECK (event_type IN ('conference','exhibition','networking','cpd','other')),
    website     text        NULL,
    value_note  text        NULL,
    feedback    text        NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NULL,
    CONSTRAINT event_attendance_name_not_blank
        CHECK (length(trim(event_name)) > 0)
);

COMMENT ON TABLE event_attendance IS
    'Per-member event-attendance log. Transparent reads; each member '
    'inserts their own rows. Admin can edit / delete any row for '
    'cleanup; otherwise only the row owner.';

CREATE INDEX event_attendance_member_idx
    ON event_attendance (member_id, event_date DESC);

CREATE INDEX event_attendance_date_idx
    ON event_attendance (event_date DESC);

-- Standard updated_at maintenance (mirrors 0021's per-table trigger
-- pattern — adding manually since the do-block in 0021 only covers
-- the original set of tables).
CREATE TRIGGER event_attendance_set_updated_at
    BEFORE UPDATE ON event_attendance
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE event_attendance ENABLE ROW LEVEL SECURITY;

-- SELECT: any authenticated user. Transparent shared log.
CREATE POLICY event_attendance_select_all
    ON event_attendance FOR SELECT
    USING (auth.uid() IS NOT NULL);

-- INSERT: any authenticated user; member_id MUST be the caller. No
-- impersonation. Admin/leadership logging their OWN events is fine —
-- this isn't a role gate, it's an identity gate.
CREATE POLICY event_attendance_insert_self
    ON event_attendance FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL AND member_id = auth.uid());

-- UPDATE: the row owner OR an admin (cleanup affordance). bd_head
-- intentionally NOT included — they aren't an editor for other
-- people's attendance.
CREATE POLICY event_attendance_update_self_or_admin
    ON event_attendance FOR UPDATE
    USING (member_id = auth.uid() OR auth_role() = 'admin')
    WITH CHECK (member_id = auth.uid() OR auth_role() = 'admin');

-- DELETE: same rule as UPDATE.
CREATE POLICY event_attendance_delete_self_or_admin
    ON event_attendance FOR DELETE
    USING (member_id = auth.uid() OR auth_role() = 'admin');
