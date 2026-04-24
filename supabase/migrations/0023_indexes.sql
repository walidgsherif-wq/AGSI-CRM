-- 0023_indexes.sql
-- Cross-table / composite indexes that don't fit naturally in the owning
-- migration. Mostly dashboard-performance and report-generation support.

-- Driver A rollup: count distinct companies per (owner_at_time, to_level, FY, FQ)
-- Already covered by level_history_owner_fy_idx; this adds a covering index
-- variant for the JOIN back to companies for names on the performance-review page.
CREATE INDEX level_history_owner_quarter_level_idx
    ON level_history (owner_at_time, fiscal_year, fiscal_quarter, to_level, company_id)
    WHERE is_forward = true AND is_credited = true;

-- Engagement-freshness heat map: last engagement per company
-- A partial sort index is cheaper than a full sort on every load.
CREATE INDEX engagements_company_latest_idx
    ON engagements (company_id, engagement_date DESC);

-- Key-stakeholder shortcut for leadership dashboards
CREATE INDEX companies_key_stakeholder_level_idx
    ON companies (current_level, canonical_name)
    WHERE is_key_stakeholder = true AND is_active = true;

-- Notifications: unread per recipient (hot path for the bell icon)
-- Already have notifications_recipient_unread_idx; add a type filter for the
-- /settings/notifications page.
CREATE INDEX notifications_recipient_type_idx
    ON notifications (recipient_id, notification_type, created_at DESC);

-- Market snapshots: "compare two snapshots" picker
CREATE INDEX market_snapshots_by_metric_date_idx
    ON market_snapshots (metric_code, snapshot_date DESC);

-- Ecosystem quarterly trend: fast aggregate per quarter
CREATE INDEX ecosystem_events_quarter_idx
    ON ecosystem_events (date_trunc('quarter', occurred_at), company_type_at_time)
    WHERE is_void = false;
