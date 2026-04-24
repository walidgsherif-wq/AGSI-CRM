-- 0010_targets.sql
-- Playbook per-member targets + member-specific overrides.
-- Prompt §3.8. Driver A is the HEADLINE per-member target; B and C are
-- composition sub-targets INSIDE A, not additive.

CREATE TABLE playbook_targets (
    id              uuid      PRIMARY KEY DEFAULT gen_random_uuid(),
    driver          driver_t  NOT NULL,
    metric_code     text      NOT NULL,
    metric_label    text      NOT NULL,
    -- If non-null: this metric is a composition of another metric inside the
    -- same driver family (e.g. driver_b_dev_l3 is a composition of driver_a_l3).
    is_composition_of text    NULL,
    q1_target       numeric   NOT NULL DEFAULT 0,
    q2_target       numeric   NOT NULL DEFAULT 0,
    q3_target       numeric   NOT NULL DEFAULT 0,
    q4_target       numeric   NOT NULL DEFAULT 0,
    annual_target   numeric   NOT NULL DEFAULT 0,
    fiscal_year     int       NOT NULL,
    weighting_pct   numeric   NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (metric_code, fiscal_year)
);

COMMENT ON TABLE playbook_targets IS
    'Per-member locked targets from the playbook, per fiscal year. Team targets are derived (sum of members).';
COMMENT ON COLUMN playbook_targets.weighting_pct IS
    'Overall RAG weighting. A=45, B=20, C=20, D=15. Sum must equal 100 per FY (enforced by seed + app settings).';

CREATE INDEX playbook_targets_driver_idx ON playbook_targets (driver, fiscal_year);

ALTER TABLE playbook_targets ENABLE ROW LEVEL SECURITY;

-- Member overrides ---------------------------------------------------------

CREATE TABLE member_targets (
    id              uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid              NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    metric_code     text              NOT NULL,
    fiscal_year     int               NOT NULL,
    q1_target       numeric           NOT NULL DEFAULT 0,
    q2_target       numeric           NOT NULL DEFAULT 0,
    q3_target       numeric           NOT NULL DEFAULT 0,
    q4_target       numeric           NOT NULL DEFAULT 0,
    annual_target   numeric           NOT NULL DEFAULT 0,
    override_mode   target_override_t NOT NULL DEFAULT 'playbook_default',
    last_edited_by  uuid              NULL REFERENCES profiles(id) ON DELETE SET NULL,
    last_edited_at  timestamptz       NULL,
    created_at      timestamptz       NOT NULL DEFAULT now(),
    updated_at      timestamptz       NOT NULL DEFAULT now(),
    UNIQUE (user_id, metric_code, fiscal_year),
    CONSTRAINT member_targets_metric_fk
        FOREIGN KEY (metric_code, fiscal_year)
        REFERENCES playbook_targets (metric_code, fiscal_year)
        ON UPDATE CASCADE ON DELETE RESTRICT
);

COMMENT ON TABLE member_targets IS
    'Per-BDM target overrides. If no row for a (user, metric, FY), fallback is the playbook target.';

CREATE INDEX member_targets_user_fy_idx ON member_targets (user_id, fiscal_year);

ALTER TABLE member_targets ENABLE ROW LEVEL SECURITY;
