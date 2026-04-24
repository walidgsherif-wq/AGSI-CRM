-- 0015_composition_drift.sql
-- Composition-drift audit log. Prompt §3.12b + §5.3b.
-- Every evaluation writes a row (fired=true OR fired=false) so the
-- performance-review surface has a complete history.

CREATE TABLE composition_drift_log (
    id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    metric_pair        text        NOT NULL CHECK (metric_pair IN ('developer_ratio','consultant_ratio')),
    fiscal_year        int         NOT NULL,
    fiscal_quarter     int         NOT NULL CHECK (fiscal_quarter BETWEEN 1 AND 4),
    evaluated_at       timestamptz NOT NULL DEFAULT now(),
    movements_sampled  int         NOT NULL,
    actual_ratio       numeric     NOT NULL,
    target_ratio       numeric     NOT NULL,
    drift_pct          numeric     NOT NULL,
    fired              boolean     NOT NULL,
    notification_id    uuid        NULL REFERENCES notifications(id) ON DELETE SET NULL,
    cooldown_until     timestamptz NULL,
    created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX composition_drift_user_period_idx
    ON composition_drift_log (user_id, fiscal_year, fiscal_quarter);

CREATE INDEX composition_drift_cooldown_idx
    ON composition_drift_log (user_id, metric_pair, cooldown_until DESC)
    WHERE fired = true;

ALTER TABLE composition_drift_log ENABLE ROW LEVEL SECURITY;
