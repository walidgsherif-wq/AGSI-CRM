-- 0011_kpi_actuals.sql
-- Nightly rollup output. Prompt §3.9.
-- user_id NULL => team rollup row. Deduped at the company level.

CREATE TABLE kpi_actuals_daily (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_date   date        NOT NULL,
    user_id         uuid        NULL REFERENCES profiles(id) ON DELETE CASCADE,
    metric_code     text        NOT NULL,
    fiscal_year     int         NOT NULL,
    fiscal_quarter  int         NOT NULL CHECK (fiscal_quarter BETWEEN 1 AND 4),
    actual_value    numeric     NOT NULL DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT now(),
    -- NULL user_id collapses into a distinct unique row for team; the partial
    -- indexes below give the effect of UNIQUE(snapshot_date, user_id, metric_code)
    -- with NULL treated as equal to NULL.
    CONSTRAINT kpi_actuals_daily_unique_per_user
        EXCLUDE USING btree
        (snapshot_date WITH =, user_id WITH =, metric_code WITH =)
        WHERE (user_id IS NOT NULL)
);

-- Team rows (user_id IS NULL) need a separate uniqueness constraint because
-- NULL != NULL in btree constraints by default.
CREATE UNIQUE INDEX kpi_actuals_team_uq
    ON kpi_actuals_daily (snapshot_date, metric_code)
    WHERE user_id IS NULL;

CREATE INDEX kpi_actuals_user_period_idx
    ON kpi_actuals_daily (user_id, fiscal_year, fiscal_quarter, metric_code);

CREATE INDEX kpi_actuals_snapshot_idx
    ON kpi_actuals_daily (snapshot_date);

ALTER TABLE kpi_actuals_daily ENABLE ROW LEVEL SECURITY;
