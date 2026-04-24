-- seed.sql
-- §17.4 — seed script. Idempotent: safe to re-run.
-- Values sourced from prompt §8 and the playbook references cited there.
-- Apply after all 0001..0023 migrations.
-- FY is derived from current calendar year (Asia/Dubai tz).

DO $$
DECLARE v_fy int;
BEGIN
    v_fy := EXTRACT(YEAR FROM now() AT TIME ZONE 'Asia/Dubai')::int;
    PERFORM set_config('seed.fy', v_fy::text, false);
END$$;

-- =====================================================================
-- 1) app_settings
-- =====================================================================

INSERT INTO app_settings (key, value_json) VALUES
    ('fiscal_year_start_month',               '{"month": 1}'::jsonb),                                      -- §16 Q1: Jan–Dec confirmed
    ('working_week',                          '{"days": ["Mon","Tue","Wed","Thu","Fri"], "weekend": ["Sat","Sun"]}'::jsonb),  -- §16 Q2: Mon–Fri
    ('kpi_universe_sizes',                    '{"developers": 110, "consultants": 360, "main_contractors": 300, "enabling_contractors": 19, "total": 789}'::jsonb),
    -- §16 Q3: email deferred; in-app is the only active channel for v1
    ('notification_channels_enabled',         '{"in_app": true, "email": false, "whatsapp": false}'::jsonb),
    ('dormancy_policy',                       '{"consecutive_missed_uploads": 2}'::jsonb),
    ('composition_warning_thresholds',        '{"headline_pct": 80, "composition_pct": 60}'::jsonb),
    ('composition_drift_min_quarter_pct',     '{"pct": 30}'::jsonb),
    ('composition_drift_min_sample_size',     '{"n": 5}'::jsonb),
    ('composition_drift_ratio_threshold',     '{"ratio": 0.70}'::jsonb),
    ('composition_drift_cooldown_days',       '{"days": 14}'::jsonb),
    ('ecosystem_decay_window_days',           '{"days": 90}'::jsonb),
    ('ecosystem_inactive_company_multiplier', '{"mult": 0.5}'::jsonb),
    ('ecosystem_dedup_window_days',           '{"days": 7}'::jsonb),
    ('bei_weightings',                        '{"A": 45, "B": 20, "C": 20, "D": 15}'::jsonb),
    ('engagement_freshness_thresholds',       '{"hot_days": 14, "warm_days": 45, "cooling_days": 90}'::jsonb),
    -- §16 Q4: BNC-stale admin reminder enabled; fires when no BNC upload in N days
    ('bnc_stale_reminder',                    '{"enabled": true, "threshold_days": 45}'::jsonb),
    -- §16 Q5: document retention / auto-archive.
    -- Single default for v1. Admin can override per doc_type later; sweep keeps
    -- rows, flips is_archived=true, hides from default UI, retains storage blob.
    ('document_retention',                    '{"enabled": true, "archive_after_years": 7, "by_doc_type": {}}'::jsonb),
    -- §16 Q6: L4 MOU approval workflow — single-admin tick for v1, dual-approver deferred
    ('l4_mou_workflow',                       '{"mode": "single_admin_tick"}'::jsonb),
    -- §16 Q8: ownership-transfer credit policy — new owner receives the credit history
    ('ownership_transfer_credit_policy',      '{"mode": "new_owner", "scope": "all_history"}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json;

-- =====================================================================
-- 2) stagnation_rules (§8 item 2 from prompt; playbook §4, §8.2)
-- =====================================================================

INSERT INTO stagnation_rules (level, max_days_in_level, warn_at_pct, escalate_at_pct, escalation_role) VALUES
    ('L0', 10, 80,  100, 'bd_head'),
    ('L1', 30, 50,  100, 'bd_head'),   -- warn at day 15 (50% of 30), escalate at day 30
    ('L2', 30, 33,  100, 'bd_head'),   -- warn at day 10 (~33% of 30), escalate at day 30
    ('L3', 45, 80,  100, 'bd_head'),
    ('L4', 60, 80,  100, 'admin'),
    ('L5', 10, 80,  100, 'admin')
ON CONFLICT (level) DO UPDATE SET
    max_days_in_level = EXCLUDED.max_days_in_level,
    warn_at_pct       = EXCLUDED.warn_at_pct,
    escalate_at_pct   = EXCLUDED.escalate_at_pct,
    escalation_role   = EXCLUDED.escalation_role;

-- =====================================================================
-- 3) playbook_targets (§3.8 canonical metric codes)
--    Per-BDM annual targets. Quarterly distribution: equal split except
--    where the playbook explicitly stages them; we default to equal thirds
--    and let admin adjust via /admin/targets.
-- =====================================================================

INSERT INTO playbook_targets
    (driver, metric_code, metric_label, is_composition_of,
     q1_target, q2_target, q3_target, q4_target, annual_target,
     fiscal_year, weighting_pct)
VALUES
    -- Driver A (headline)
    ('A','driver_a_l3','L3 stakeholders (all types)',                 NULL,
        9, 9, 9, 8, 35,   current_setting('seed.fy')::int, 45),
    ('A','driver_a_l4','L4 stakeholders (all types)',                 NULL,
        2, 2, 2, 2,  8,   current_setting('seed.fy')::int, 45),
    ('A','driver_a_l5','L5 stakeholders (all types)',                 NULL,
        1, 1, 1, 0,  3,   current_setting('seed.fy')::int, 45),
    -- Driver B (developer composition of A)
    ('B','driver_b_dev_l3','Developer L3 (of driver_a_l3)',           'driver_a_l3',
        5, 5, 5, 5, 20,   current_setting('seed.fy')::int, 20),
    ('B','driver_b_dev_l4','Developer L4 (of driver_a_l4)',           'driver_a_l4',
        2, 2, 1, 1,  6,   current_setting('seed.fy')::int, 20),
    ('B','driver_b_dev_l5','Developer L5 (of driver_a_l5)',           'driver_a_l5',
        1, 1, 1, 0,  3,   current_setting('seed.fy')::int, 20),
    -- Driver C (consultant influence)
    ('C','driver_c_consultant_approvals','Consultant approvals (L3)', 'driver_a_l3',
        3, 3, 2, 2, 10,   current_setting('seed.fy')::int, 20),
    ('C','driver_c_spec_template_inclusions','Spec template inclusions', NULL,
        1, 2, 1, 1,  5,   current_setting('seed.fy')::int, 20),
    ('C','driver_c_design_stage_projects','Design-stage projects intro', NULL,
        4, 4, 4, 3, 15,   current_setting('seed.fy')::int, 20),
    -- Driver D (visibility outputs)
    ('D','driver_d_announcements','Public announcements',             NULL,
        1, 2, 2, 1,  6,   current_setting('seed.fy')::int, 15),
    ('D','driver_d_site_banners','Site banners installed',            NULL,
        1, 1, 1, 1,  4,   current_setting('seed.fy')::int, 15),
    ('D','driver_d_case_studies','Case studies published',            NULL,
        1, 1, 1, 1,  4,   current_setting('seed.fy')::int, 15)
ON CONFLICT (metric_code, fiscal_year) DO UPDATE SET
    metric_label      = EXCLUDED.metric_label,
    is_composition_of = EXCLUDED.is_composition_of,
    q1_target         = EXCLUDED.q1_target,
    q2_target         = EXCLUDED.q2_target,
    q3_target         = EXCLUDED.q3_target,
    q4_target         = EXCLUDED.q4_target,
    annual_target     = EXCLUDED.annual_target,
    weighting_pct     = EXCLUDED.weighting_pct;

-- =====================================================================
-- 4) ecosystem_point_scale (§3.16)
-- =====================================================================

INSERT INTO ecosystem_point_scale (event_category, event_subtype, points_default, points_current) VALUES
    ('level_up',      'L0_to_L1',            1,  1),
    ('level_up',      'L1_to_L2',            3,  3),
    ('level_up',      'L2_to_L3',            8,  8),
    ('level_up',      'L3_to_L4',           20, 20),
    ('level_up',      'L4_to_L5',           50, 50),
    ('engagement',    'call',                1,  1),
    ('engagement',    'meeting',             1,  1),
    ('engagement',    'site_visit',          1,  1),
    ('engagement',    'workshop',            1,  1),
    ('engagement',    'email',               1,  1),
    ('engagement',    'document_sent',       2,  2),
    ('document',      'announcement',       10, 10),
    ('document',      'site_banner_approval',15, 15),
    ('document',      'case_study',         10, 10),
    ('spec_inclusion','spec_inclusion',     15, 15)
ON CONFLICT (event_category, event_subtype) DO UPDATE SET
    points_default = EXCLUDED.points_default;
-- Note: points_current is preserved on re-seed so admin tuning isn't clobbered.

-- =====================================================================
-- 5) city_lookup (§7.5.1) — seed UAE emirates + major cities + common zones.
--    Coordinates rounded; refine as real geo data arrives.
-- =====================================================================

INSERT INTO city_lookup (city_name, emirate, latitude, longitude) VALUES
    ('Abu Dhabi',        'Abu Dhabi',         24.453884, 54.377344),
    ('Al Ain',           'Abu Dhabi',         24.207536, 55.744660),
    ('Ruwais',           'Abu Dhabi',         24.087960, 52.725080),
    ('Dubai',            'Dubai',             25.204849, 55.270783),
    ('Downtown Dubai',   'Dubai',             25.195200, 55.274380),
    ('Business Bay',     'Dubai',             25.185280, 55.265850),
    ('Jumeirah',         'Dubai',             25.204600, 55.243000),
    ('Dubai Marina',     'Dubai',             25.080600, 55.140100),
    ('JVC',              'Dubai',             25.059200, 55.210000),
    ('DIFC',             'Dubai',             25.213200, 55.279500),
    ('Sharjah',          'Sharjah',           25.346255, 55.420937),
    ('Ajman',            'Ajman',             25.405216, 55.513641),
    ('Umm Al Quwain',    'Umm Al Quwain',     25.550000, 55.555000),
    ('Ras Al Khaimah',   'Ras Al Khaimah',    25.789295, 55.942478),
    ('Fujairah',         'Fujairah',          25.128484, 56.326330)
ON CONFLICT (city_name) DO NOTHING;

-- =====================================================================
-- 6) First admin — deferred
-- =====================================================================
--
-- The first admin is created at deploy time via the INITIAL_ADMIN_EMAIL env
-- var + a one-shot Supabase admin-invite script (not a migration). Here as
-- a reminder:
--   1. supabase auth users invite <INITIAL_ADMIN_EMAIL>
--   2. After the user signs in, UPSERT into profiles with role='admin'.
--
-- Seeding a hard-coded admin here would bypass the invite flow and leave a
-- dangling auth.users row across environments.
