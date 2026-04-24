-- 0019_leadership_reports.sql
-- Frozen snapshot reports. Prompt §3.17 + §5.6.
-- Reports are immutable once finalised. Leadership can only write the
-- feedback text field (enforced by trigger in 0021).

CREATE TABLE leadership_reports (
    id                        uuid                        PRIMARY KEY DEFAULT gen_random_uuid(),
    report_type               leadership_report_type_t    NOT NULL,
    period_label              text                        NOT NULL,
    period_start              date                        NOT NULL,
    period_end                date                        NOT NULL,
    fiscal_year               int                         NOT NULL,
    fiscal_quarter            int                         NULL CHECK (fiscal_quarter IS NULL OR fiscal_quarter BETWEEN 1 AND 4),
    generated_by              uuid                        NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
    generated_at              timestamptz                 NOT NULL DEFAULT now(),
    status                    leadership_report_status_t  NOT NULL DEFAULT 'draft',
    finalised_at              timestamptz                 NULL,
    finalised_by              uuid                        NULL REFERENCES profiles(id) ON DELETE SET NULL,
    payload_json              jsonb                       NOT NULL DEFAULT '{}'::jsonb,
    executive_summary         text                        NULL,
    leadership_feedback_text  text                        NULL,
    leadership_feedback_by    uuid                        NULL REFERENCES profiles(id) ON DELETE SET NULL,
    leadership_feedback_at    timestamptz                 NULL,
    pdf_storage_path          text                        NULL,
    created_at                timestamptz                 NOT NULL DEFAULT now(),
    updated_at                timestamptz                 NOT NULL DEFAULT now(),
    CONSTRAINT leadership_reports_period_ordered
        CHECK (period_end >= period_start),
    CONSTRAINT leadership_reports_quarterly_needs_q
        CHECK (report_type <> 'quarterly_strategic' OR fiscal_quarter IS NOT NULL)
);

COMMENT ON TABLE leadership_reports IS
    'Frozen, point-in-time reports. No DELETE — archived status instead. Leadership may update only feedback columns (trigger-enforced).';

CREATE INDEX leadership_reports_status_idx ON leadership_reports (status, period_end DESC);
CREATE INDEX leadership_reports_type_idx   ON leadership_reports (report_type, fiscal_year, fiscal_quarter);

ALTER TABLE leadership_reports ENABLE ROW LEVEL SECURITY;

-- Denormalised per-stakeholder snapshot ------------------------------------

CREATE TABLE leadership_report_stakeholders (
    id                              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id                       uuid            NOT NULL REFERENCES leadership_reports(id) ON DELETE CASCADE,
    company_id                      uuid            NULL REFERENCES companies(id) ON DELETE SET NULL,
    company_name_at_time            text            NOT NULL,
    company_type_at_time            company_type_t  NOT NULL,
    level_at_time                   level_t         NOT NULL,
    owner_at_time                   uuid            NULL REFERENCES profiles(id) ON DELETE SET NULL,
    owner_name_at_time              text            NULL,
    last_engagement_at_time         date            NULL,
    active_projects_count_at_time   int             NOT NULL DEFAULT 0,
    lifetime_ecosystem_points       numeric         NOT NULL DEFAULT 0,
    active_ecosystem_points         numeric         NOT NULL DEFAULT 0,
    is_key_stakeholder              boolean         NOT NULL DEFAULT false,
    moved_this_period               boolean         NOT NULL DEFAULT false,
    flagged_stagnating              boolean         NOT NULL DEFAULT false,
    narrative                       text            NULL,  -- admin-editable in draft stage
    created_at                      timestamptz     NOT NULL DEFAULT now()
);

CREATE INDEX leadership_report_stakeholders_report_idx
    ON leadership_report_stakeholders (report_id);
CREATE INDEX leadership_report_stakeholders_key_idx
    ON leadership_report_stakeholders (report_id)
    WHERE is_key_stakeholder = true;

ALTER TABLE leadership_report_stakeholders ENABLE ROW LEVEL SECURITY;
