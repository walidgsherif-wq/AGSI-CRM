-- 0002_enums.sql
-- Every enum used by the schema. Collected in one file so the catalogue is
-- reviewable in a single read. Ordering: identity → stakeholder → pipeline →
-- KPI → ops.

-- Identity ---------------------------------------------------------------

CREATE TYPE role_t AS ENUM ('admin', 'leadership', 'bd_head', 'bd_manager');

-- Stakeholder ------------------------------------------------------------

CREATE TYPE company_type_t AS ENUM (
    'developer',
    'design_consultant',
    'main_contractor',
    'mep_consultant',
    'mep_contractor',
    'authority',
    'other'
);

CREATE TYPE company_source_t AS ENUM ('bnc_upload', 'manual', 'merged');

CREATE TYPE level_t AS ENUM ('L0', 'L1', 'L2', 'L3', 'L4', 'L5');

-- Pipeline ---------------------------------------------------------------

CREATE TYPE project_stage_t AS ENUM (
    'concept',
    'design',
    'tender',
    'tender_submission',
    'tender_evaluation',
    'under_construction',
    'completed',
    'on_hold',
    'cancelled'
);

CREATE TYPE project_priority_t AS ENUM ('tier_1', 'tier_2', 'tier_3', 'watchlist');

CREATE TYPE project_company_role_t AS ENUM (
    'owner',
    'design_consultant',
    'main_contractor',
    'mep_consultant',
    'mep_contractor',
    'other'
);

-- Engagement / work ------------------------------------------------------

CREATE TYPE engagement_type_t AS ENUM (
    'call',
    'meeting',
    'email',
    'site_visit',
    'workshop',
    'document_sent',
    'mou_discussion',
    'tripartite_discussion',
    'spec_inclusion',
    'design_stage_intro',
    'consultant_approval',
    'other'
);

CREATE TYPE task_priority_t AS ENUM ('low', 'med', 'high', 'urgent');
CREATE TYPE task_status_t   AS ENUM ('open', 'in_progress', 'done', 'cancelled');
CREATE TYPE task_source_t   AS ENUM ('manual', 'stagnation_alert', 'system');

CREATE TYPE document_type_t AS ENUM (
    'mou_developer',
    'mou_consultant',
    'mou_contractor',
    'tripartite',
    'epd',
    'case_study',
    'site_banner_approval',
    'announcement',
    'spec_template',
    'other'
);

-- KPI --------------------------------------------------------------------

CREATE TYPE driver_t AS ENUM ('A', 'B', 'C', 'D');

CREATE TYPE target_override_t AS ENUM ('playbook_default', 'custom');

-- BNC pipeline -----------------------------------------------------------

CREATE TYPE bnc_upload_status_t AS ENUM ('pending', 'processing', 'completed', 'failed');

CREATE TYPE match_queue_status_t AS ENUM ('pending', 'approved', 'rejected', 'merged');

-- Ops --------------------------------------------------------------------

CREATE TYPE notification_type_t AS ENUM (
    'stagnation_warning',
    'stagnation_breach',
    'task_due',
    'task_overdue',
    'level_change',
    'upload_complete',
    'upload_failed',
    'unmatched_company',
    'composition_warning',
    'composition_drift',
    'mention'
);

CREATE TYPE stagnation_escalation_role_t AS ENUM ('bd_head', 'admin');

CREATE TYPE leadership_report_type_t AS ENUM ('monthly_snapshot', 'quarterly_strategic');
CREATE TYPE leadership_report_status_t AS ENUM ('draft', 'finalised', 'archived');
