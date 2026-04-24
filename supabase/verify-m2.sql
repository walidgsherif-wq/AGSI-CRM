-- M2 verification queries.
-- Paste this into Supabase SQL Editor → Run.
-- You'll get four result sets. Every row should show 'OK' in the status column.

-- ──────────────────────────────────────────────────────────────────────
-- [1/4] Seed data counts
-- ──────────────────────────────────────────────────────────────────────
SELECT
  'Seed counts' AS section,
  table_name,
  expected,
  actual,
  CASE WHEN expected = actual THEN 'OK' ELSE 'FAIL' END AS status
FROM (
  VALUES
    ('playbook_targets',       12, (SELECT count(*)::int FROM playbook_targets)),
    ('stagnation_rules',        6, (SELECT count(*)::int FROM stagnation_rules)),
    ('ecosystem_point_scale',  15, (SELECT count(*)::int FROM ecosystem_point_scale)),
    ('city_lookup',            15, (SELECT count(*)::int FROM city_lookup)),
    ('app_settings',           19, (SELECT count(*)::int FROM app_settings))
) AS t(table_name, expected, actual);

-- ──────────────────────────────────────────────────────────────────────
-- [2/4] All 27 expected tables exist
-- ──────────────────────────────────────────────────────────────────────
SELECT
  'Tables exist' AS section,
  expected.tablename,
  CASE WHEN actual.tablename IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS status
FROM (
  VALUES
    ('profiles'), ('companies'), ('level_history'), ('projects'),
    ('project_companies'), ('engagements'), ('tasks'), ('notes'),
    ('documents'), ('playbook_targets'), ('member_targets'),
    ('kpi_actuals_daily'), ('bnc_uploads'), ('bnc_upload_rows'),
    ('company_match_queue'), ('market_snapshots'), ('stagnation_rules'),
    ('notifications'), ('composition_drift_log'), ('app_settings'),
    ('audit_events'), ('ecosystem_point_scale'), ('ecosystem_events'),
    ('ecosystem_awareness_current'), ('leadership_reports'),
    ('leadership_report_stakeholders'), ('city_lookup')
) AS expected(tablename)
LEFT JOIN pg_tables AS actual
       ON actual.schemaname = 'public'
      AND actual.tablename  = expected.tablename
ORDER BY expected.tablename;

-- ──────────────────────────────────────────────────────────────────────
-- [3/4] RLS enabled on every table
-- ──────────────────────────────────────────────────────────────────────
SELECT
  'RLS enabled' AS section,
  tablename,
  CASE WHEN rowsecurity THEN 'OK' ELSE 'FAIL (RLS OFF)' END AS status
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'profiles','companies','level_history','projects','project_companies',
    'engagements','tasks','notes','documents','playbook_targets',
    'member_targets','kpi_actuals_daily','bnc_uploads','bnc_upload_rows',
    'company_match_queue','market_snapshots','stagnation_rules',
    'notifications','composition_drift_log','app_settings','audit_events',
    'ecosystem_point_scale','ecosystem_events','ecosystem_awareness_current',
    'leadership_reports','leadership_report_stakeholders','city_lookup'
  )
ORDER BY tablename;

-- ──────────────────────────────────────────────────────────────────────
-- [4/4] Critical functions + trigger are installed
-- ──────────────────────────────────────────────────────────────────────
SELECT
  'Functions' AS section,
  expected.proname,
  CASE WHEN actual.proname IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS status
FROM (
  VALUES
    ('auth_role'),
    ('fiscal_year_of'),
    ('fiscal_quarter_of'),
    ('change_company_level'),
    ('enforce_level_write_guard'),
    ('enforce_level_history_per_fy_dedup'),
    ('enforce_leadership_feedback_only'),
    ('insert_ecosystem_event'),
    ('agsi_aliases_to_text')
) AS expected(proname)
LEFT JOIN pg_proc AS actual
       ON actual.proname = expected.proname
ORDER BY expected.proname;
