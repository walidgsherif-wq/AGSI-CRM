-- 0020_city_lookup.sql
-- Heat-map geography. Prompt §7.5.1.
-- Seeded with UAE emirates + major cities + common Dubai sub-zones in seed.sql.

CREATE TABLE city_lookup (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    city_name   text        NOT NULL UNIQUE,
    emirate     text        NOT NULL,
    latitude    numeric(9,6) NOT NULL,
    longitude   numeric(9,6) NOT NULL,
    is_active   boolean     NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX city_lookup_emirate_idx ON city_lookup (emirate) WHERE is_active = true;

ALTER TABLE city_lookup ENABLE ROW LEVEL SECURITY;
