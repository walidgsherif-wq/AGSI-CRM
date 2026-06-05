-- 0048_company_engagement_score.sql
-- v1.1 — per-company engagement intensity score.
--
-- Drives the pipeline kanban "glow" (Hot / Warm / Cooling / Cold) and
-- is reusable anywhere we want a glanceable "is this relationship
-- warm?" signal (company detail page, dashboard, etc.).
--
-- Score 0-10 = recency (0-6) + 90-day frequency (0-4):
--   Recency:    ≤14d → 6 (hot)
--               ≤45d → 4 (warm)
--               ≤90d → 2 (cooling)
--               else  → 0 (cold / never)
--   Frequency: ≥6 in last 90d → 4
--              3-5            → 3
--              1-2            → 1
--              0              → 0
--   Bucket: hot ≥8, warm 5-7, cooling 2-4, cold 0-1.
--
-- The 14/45/90 day breaks intentionally match the
-- /insights/maps/engagement-freshness heatmap and the leadership
-- report `engagement_freshness` rollup, so the pipeline glow agrees
-- with every other freshness view in the app.
--
-- View runs definer-side (default for views in PG15+), so scores are
-- consistent across roles regardless of per-row engagement RLS.

CREATE OR REPLACE VIEW company_engagement_score AS
WITH stats AS (
    SELECT
        e.company_id,
        MAX(e.engagement_date)                                AS last_engagement_at,
        COUNT(*) FILTER (
            WHERE e.engagement_date >= (current_date - INTERVAL '90 days')
        )::int                                                AS count_90d
      FROM engagements e
     GROUP BY e.company_id
),
scored AS (
    SELECT
        c.id                                                  AS company_id,
        s.last_engagement_at,
        COALESCE(s.count_90d, 0)                              AS count_90d,
        CASE
            WHEN s.last_engagement_at IS NULL                       THEN 0
            WHEN (current_date - s.last_engagement_at) <= 14        THEN 6
            WHEN (current_date - s.last_engagement_at) <= 45        THEN 4
            WHEN (current_date - s.last_engagement_at) <= 90        THEN 2
            ELSE 0
        END                                                   AS recency_component,
        CASE
            WHEN COALESCE(s.count_90d, 0) >= 6                THEN 4
            WHEN COALESCE(s.count_90d, 0) >= 3                THEN 3
            WHEN COALESCE(s.count_90d, 0) >= 1                THEN 1
            ELSE 0
        END                                                   AS frequency_component
      FROM companies c
      LEFT JOIN stats s ON s.company_id = c.id
)
SELECT
    company_id,
    last_engagement_at,
    count_90d,
    recency_component,
    frequency_component,
    LEAST(10, recency_component + frequency_component)        AS score,
    CASE
        WHEN LEAST(10, recency_component + frequency_component) >= 8 THEN 'hot'
        WHEN LEAST(10, recency_component + frequency_component) >= 5 THEN 'warm'
        WHEN LEAST(10, recency_component + frequency_component) >= 2 THEN 'cooling'
        ELSE 'cold'
    END                                                       AS bucket
  FROM scored;

GRANT SELECT ON company_engagement_score TO authenticated;

COMMENT ON VIEW company_engagement_score IS
    'Per-company engagement intensity 0-10 (recency 0-6 + 90-day frequency 0-4) plus hot/warm/cooling/cold bucket. Drives the pipeline kanban glow; reusable elsewhere.';
