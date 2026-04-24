-- 0013_market_snapshots.sql
-- Pre-computed market insights. Prompt §4.4.
-- Every row = one metric for a given snapshot_date. Insights queries filter
-- by snapshot_date (defaults to MAX(snapshot_date)).

CREATE TABLE market_snapshots (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    upload_id           uuid        NOT NULL REFERENCES bnc_uploads(id) ON DELETE CASCADE,
    snapshot_date       date        NOT NULL,
    metric_code         text        NOT NULL,
    dimension_key       text        NOT NULL DEFAULT '',
    metric_value        numeric     NULL,
    metric_value_json   jsonb       NULL,
    created_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE market_snapshots IS
    'One row per (snapshot_date, metric_code, dimension_key). Read by /insights.';

CREATE INDEX market_snapshots_lookup_idx
    ON market_snapshots (snapshot_date DESC, metric_code, dimension_key);

CREATE INDEX market_snapshots_upload_idx
    ON market_snapshots (upload_id);

ALTER TABLE market_snapshots ENABLE ROW LEVEL SECURITY;
