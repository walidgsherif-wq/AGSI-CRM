-- supabase/seed-demo.sql
-- Optional demo data for first-look review. Run AFTER the main migrations +
-- seed.sql AND after at least one admin profile exists (i.e. after first
-- sign-in by INITIAL_ADMIN_EMAIL).
--
-- Idempotent: re-running detects existing demo data and skips. To wipe, see
-- the DELETE block at the bottom (commented out by default).

DO $demo$
DECLARE
    v_admin_id      uuid;
    v_already_seeded boolean;
BEGIN
    -- Skip if already seeded
    SELECT EXISTS (SELECT 1 FROM companies WHERE canonical_name = 'Emaar Properties')
      INTO v_already_seeded;
    IF v_already_seeded THEN
        RAISE NOTICE 'Demo seed already applied. Skipping.';
        RETURN;
    END IF;

    -- Find the bootstrap admin
    SELECT id INTO v_admin_id
      FROM profiles
     WHERE email = (
        SELECT value_json #>> '{}' FROM app_settings WHERE key = 'initial_admin_email'
     )
     LIMIT 1;

    IF v_admin_id IS NULL THEN
        RAISE EXCEPTION 'No admin profile found. Sign in once as INITIAL_ADMIN_EMAIL before running this seed.';
    END IF;

    -- Companies ------------------------------------------------------------
    INSERT INTO companies (
        canonical_name, company_type, country, city, website,
        key_contact_name, key_contact_role, key_contact_email,
        current_level, owner_id, owner_assigned_at, source, is_key_stakeholder
    ) VALUES
    ('Emaar Properties',           'developer',         'United Arab Emirates', 'Dubai',
     'https://www.emaar.com',      'Ahmed Al Marri',  'Head of Procurement',
     'ahmed.almarri@emaar.example', 'L3', v_admin_id, now(), 'manual', true),

    ('Aldar Properties',           'developer',         'United Arab Emirates', 'Abu Dhabi',
     'https://www.aldar.com',      'Sara Al Hashimi', 'Procurement Manager',
     'sara.alhashimi@aldar.example', 'L2', v_admin_id, now(), 'manual', true),

    ('Dewan Architects',           'design_consultant', 'United Arab Emirates', 'Dubai',
     'https://www.dewan-architects.com', 'Layla Najjar',  'Principal Architect',
     'layla.najjar@dewan.example', 'L4', v_admin_id, now(), 'manual', false),

    ('Al Naboodah Construction',   'main_contractor',   'United Arab Emirates', 'Dubai',
     'https://www.al-naboodah.com', 'Omar Khalifa',   'BD Director',
     'omar.khalifa@naboodah.example', 'L1', v_admin_id, now(), 'manual', false),

    ('Khansaheb Civil Engineering','main_contractor',   'United Arab Emirates', 'Sharjah',
     'https://www.khansaheb.ae',   'Faisal Rahman',  'Estimating Manager',
     'faisal.rahman@khansaheb.example', 'L0', v_admin_id, now(), 'manual', false);

    -- Projects -------------------------------------------------------------
    INSERT INTO projects (
        name, project_type, stage, value_aed, city, location, sector,
        estimated_completion_date, completion_percentage, agsi_priority,
        agsi_internal_notes
    ) VALUES
    ('Dubai Hills Mall Phase 2',           'Retail',
     'under_construction', 1850000000, 'Dubai',     'Dubai Hills Estate', 'Retail',
     '2027-06-30', 35.0, 'tier_1',
     'Strategic Emaar pipeline — high-rise retail expansion. Push for spec inclusion in Q2.'),

    ('Saadiyat Cultural District Block C', 'Mixed-use',
     'design',             920000000, 'Abu Dhabi', 'Saadiyat Island',    'Mixed-use',
     '2028-12-31',  8.0, 'tier_2',
     'Cultural masterplan; Aldar developer + Dewan consultant. Watch for tender Q4.');

    -- project_companies links ---------------------------------------------
    INSERT INTO project_companies (project_id, company_id, role)
    SELECT p.id, c.id, link.r::project_company_role_t
      FROM (VALUES
        ('Dubai Hills Mall Phase 2',           'Emaar Properties',           'owner'),
        ('Dubai Hills Mall Phase 2',           'Dewan Architects',           'design_consultant'),
        ('Dubai Hills Mall Phase 2',           'Al Naboodah Construction',   'main_contractor'),
        ('Saadiyat Cultural District Block C', 'Aldar Properties',           'owner'),
        ('Saadiyat Cultural District Block C', 'Dewan Architects',           'design_consultant')
      ) AS link(project_name, company_name, r)
      JOIN projects  p ON p.name = link.project_name
      JOIN companies c ON lower(c.canonical_name) = lower(link.company_name);

    -- Mark companies that have at least one current project link -----------
    UPDATE companies c
       SET has_active_projects = true
     WHERE EXISTS (
        SELECT 1 FROM project_companies pc
         WHERE pc.company_id = c.id AND pc.is_current = true
     );

    RAISE NOTICE 'Demo seed applied: 5 companies, 2 projects, 5 project links.';
END
$demo$;

-- =====================================================================
-- WIPE BLOCK — uncomment to remove demo data.
-- =====================================================================
-- BEGIN;
--   DELETE FROM project_companies
--    WHERE project_id IN (SELECT id FROM projects WHERE name IN (
--      'Dubai Hills Mall Phase 2','Saadiyat Cultural District Block C'
--    ));
--   DELETE FROM projects WHERE name IN (
--     'Dubai Hills Mall Phase 2','Saadiyat Cultural District Block C'
--   );
--   DELETE FROM companies WHERE canonical_name IN (
--     'Emaar Properties','Aldar Properties','Dewan Architects',
--     'Al Naboodah Construction','Khansaheb Civil Engineering'
--   );
-- COMMIT;
