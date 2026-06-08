-- 0050_engagement_glow_days.sql
-- v1.1 (FX-001) — re-bucket company_engagement_score on days-since-
-- last-contact instead of the original 0-10 recency+frequency score.
--
-- Why: the score-based model rewarded both freshness AND 90-day
-- volume, conflating activity quantity with relationship health and
-- making the glow gameable (log filler engagements to push hot).
-- Pure recency is honest: one real touchpoint resets the glow, and
-- volume can't inflate it.
--
-- Thresholds (hardcoded for now, per-level overrides come later):
--   hot     ≤30 days
--   warm    ≤60 days
--   cooling ≤90 days
--   cold    >90 days OR no engagement on record
--
-- The /insights/maps/engagement-freshness heatmap computes its own
-- day distances directly from `engagements` and retains its 14/45/90
-- thresholds — it does not consume this view, so no map impact.
--
-- Column changes from 0048 (breaking for any consumer reading score /
-- count_90d / recency_component / frequency_component — only the
-- pipeline page reads this view today; updated in lockstep):
--   removed:  count_90d, recency_component, frequency_component, score
--   added:    days_since_last_engagement (int, NULL when never)
--   kept:     company_id, last_engagement_at, bucket

DROP VIEW IF EXISTS company_engagement_score;

CREATE VIEW company_engagement_score AS
WITH thresholds AS (
    SELECT
        30 AS hot_max_days,
        60 AS warm_max_days,
        90 AS cooling_max_days
),
stats AS (
    SELECT
        e.company_id,
        MAX(e.engagement_date) AS last_engagement_at
      FROM engagements e
     GROUP BY e.company_id
)
SELECT
    c.id                                                  AS company_id,
    s.last_engagement_at,
    CASE
        WHEN s.last_engagement_at IS NULL THEN NULL
        ELSE (current_date - s.last_engagement_at)::int
    END                                                   AS days_since_last_engagement,
    CASE
        WHEN s.last_engagement_at IS NULL                                  THEN 'cold'
        WHEN (current_date - s.last_engagement_at) <= t.hot_max_days       THEN 'hot'
        WHEN (current_date - s.last_engagement_at) <= t.warm_max_days      THEN 'warm'
        WHEN (current_date - s.last_engagement_at) <= t.cooling_max_days   THEN 'cooling'
        ELSE 'cold'
    END                                                   AS bucket
  FROM companies c
  LEFT JOIN stats s ON s.company_id = c.id
  CROSS JOIN thresholds t;

GRANT SELECT ON company_engagement_score TO authenticated;

COMMENT ON VIEW company_engagement_score IS
    'Per-company engagement freshness — days since last engagement + hot/warm/cooling/cold bucket. Pure-recency model (no volume term) so one real touchpoint resets the glow. Thresholds: hot ≤30d, warm ≤60d, cooling ≤90d, cold >90d or never.';
