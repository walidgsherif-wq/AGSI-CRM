-- 0005_level_history.sql
-- The immutable scoring ledger. Prompt §3.3 — "non-negotiable."
-- Every level change writes one row. is_forward + is_credited gate whether
-- the row counts toward Driver A/B/C.

CREATE TABLE level_history (
    id                      uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id              uuid         NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    from_level              level_t      NOT NULL,
    to_level                level_t      NOT NULL,
    changed_by              uuid         NULL REFERENCES profiles(id) ON DELETE SET NULL,
    owner_at_time           uuid         NULL REFERENCES profiles(id) ON DELETE SET NULL,
    company_type_at_time    company_type_t NOT NULL,
    changed_at              timestamptz  NOT NULL DEFAULT now(),
    fiscal_year             int          NOT NULL,
    fiscal_quarter          int          NOT NULL CHECK (fiscal_quarter BETWEEN 1 AND 4),
    evidence_note           text         NULL,
    evidence_file_url       text         NULL,
    is_forward              boolean      NOT NULL,
    is_credited             boolean      NOT NULL DEFAULT true,
    created_at              timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT level_history_not_same
        CHECK (from_level <> to_level)
);

COMMENT ON TABLE level_history IS
    'Immutable ledger. INSERT only via change_company_level(). is_credited may be toggled by admin only.';
COMMENT ON COLUMN level_history.owner_at_time IS
    'Snapshot of companies.owner_id at transition time. Scoring credit attributes here, never to current owner.';
COMMENT ON COLUMN level_history.company_type_at_time IS
    'Snapshot of companies.company_type at transition time. Driver B composition uses this.';

CREATE INDEX level_history_company_idx     ON level_history (company_id, changed_at DESC);
CREATE INDEX level_history_owner_fy_idx    ON level_history (owner_at_time, fiscal_year, fiscal_quarter)
    WHERE is_forward = true AND is_credited = true;
CREATE INDEX level_history_to_level_idx    ON level_history (to_level, fiscal_year, fiscal_quarter)
    WHERE is_forward = true AND is_credited = true;
CREATE INDEX level_history_type_idx        ON level_history (company_type_at_time, fiscal_year, fiscal_quarter)
    WHERE is_forward = true AND is_credited = true;

ALTER TABLE level_history ENABLE ROW LEVEL SECURITY;
