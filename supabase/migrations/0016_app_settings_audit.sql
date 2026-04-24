-- 0016_app_settings_audit.sql
-- Key-value config + immutable audit trail.

CREATE TABLE app_settings (
    key         text        PRIMARY KEY,
    value_json  jsonb       NOT NULL,
    updated_by  uuid        NULL REFERENCES profiles(id) ON DELETE SET NULL,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE app_settings IS
    'Runtime-tunable configuration. Seeded in seed.sql; edited by admin via /admin/settings.';

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- Audit --------------------------------------------------------------------

CREATE TABLE audit_events (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id     uuid        NULL REFERENCES profiles(id) ON DELETE SET NULL,
    event_type   text        NOT NULL,
    entity_type  text        NOT NULL,
    entity_id    uuid        NULL,
    before_json  jsonb       NULL,
    after_json   jsonb       NULL,
    occurred_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_events_actor_idx    ON audit_events (actor_id, occurred_at DESC);
CREATE INDEX audit_events_entity_idx   ON audit_events (entity_type, entity_id, occurred_at DESC);
CREATE INDEX audit_events_type_idx     ON audit_events (event_type, occurred_at DESC);

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
