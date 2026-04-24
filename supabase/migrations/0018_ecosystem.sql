-- 0018_ecosystem.sql
-- Ecosystem Awareness (leadership-only). Prompt §3.16 + §5.5.
-- Hybrid lifetime + active (90-day decay) model. RLS blocks bd_manager entirely.

CREATE TABLE ecosystem_point_scale (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    event_category      text        NOT NULL,
    event_subtype       text        NOT NULL,
    points_default      numeric     NOT NULL,
    points_current      numeric     NOT NULL,
    last_edited_by      uuid        NULL REFERENCES profiles(id) ON DELETE SET NULL,
    last_edited_at      timestamptz NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (event_category, event_subtype)
);

ALTER TABLE ecosystem_point_scale ENABLE ROW LEVEL SECURITY;

-- Event ledger -------------------------------------------------------------

CREATE TABLE ecosystem_events (
    id                      uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    occurred_at             timestamptz     NOT NULL,
    recorded_at             timestamptz     NOT NULL DEFAULT now(),
    company_id              uuid            NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    event_category          text            NOT NULL,
    event_subtype           text            NOT NULL,
    points                  numeric         NOT NULL,
    source_table            text            NOT NULL,
    source_id               uuid            NOT NULL,
    company_type_at_time    company_type_t  NOT NULL,
    company_level_at_time   level_t         NOT NULL,
    is_dormant_at_time      boolean         NOT NULL DEFAULT false,
    is_void                 boolean         NOT NULL DEFAULT false,  -- soft-delete when source deleted
    dedup_key               text            NOT NULL,
    created_at              timestamptz     NOT NULL DEFAULT now(),
    UNIQUE (dedup_key)
);

COMMENT ON COLUMN ecosystem_events.dedup_key IS
    'Composite key: (company_id, event_subtype, date_trunc(day, occurred_at)). Enforces 7-day dedup via app logic plus daily-level uniqueness here.';
COMMENT ON COLUMN ecosystem_events.is_void IS
    'Set true when the underlying source row is deleted. Row retained for audit; excluded from score aggregates.';

CREATE INDEX ecosystem_events_occurred_idx   ON ecosystem_events (occurred_at DESC) WHERE is_void = false;
CREATE INDEX ecosystem_events_company_idx    ON ecosystem_events (company_id, occurred_at DESC) WHERE is_void = false;
CREATE INDEX ecosystem_events_active_idx     ON ecosystem_events (occurred_at DESC) WHERE is_void = false;
CREATE INDEX ecosystem_events_category_idx   ON ecosystem_events (event_category, event_subtype) WHERE is_void = false;

ALTER TABLE ecosystem_events ENABLE ROW LEVEL SECURITY;

-- Rolled-up daily snapshot -------------------------------------------------

CREATE TABLE ecosystem_awareness_current (
    snapshot_date       date        PRIMARY KEY,
    lifetime_score      numeric     NOT NULL,
    active_score        numeric     NOT NULL,
    theoretical_max     numeric     NOT NULL,
    lifetime_pct        numeric     NOT NULL,
    active_pct          numeric     NOT NULL,
    by_company_type     jsonb       NOT NULL DEFAULT '{}'::jsonb,
    by_level            jsonb       NOT NULL DEFAULT '{}'::jsonb,
    by_city             jsonb       NOT NULL DEFAULT '{}'::jsonb,
    computed_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ecosystem_awareness_current_date_idx
    ON ecosystem_awareness_current (snapshot_date DESC);

ALTER TABLE ecosystem_awareness_current ENABLE ROW LEVEL SECURITY;
