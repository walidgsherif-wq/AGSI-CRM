-- 0014_stagnation_notifications.sql
-- Stagnation thresholds and the notification inbox. Prompt §3.11 + §6.

CREATE TABLE stagnation_rules (
    id                  uuid                            PRIMARY KEY DEFAULT gen_random_uuid(),
    level               level_t                         NOT NULL UNIQUE,
    max_days_in_level   int                             NOT NULL CHECK (max_days_in_level > 0),
    warn_at_pct         int                             NOT NULL DEFAULT 80 CHECK (warn_at_pct BETWEEN 1 AND 100),
    escalate_at_pct     int                             NOT NULL DEFAULT 100 CHECK (escalate_at_pct BETWEEN 1 AND 200),
    escalation_role     stagnation_escalation_role_t    NOT NULL DEFAULT 'bd_head',
    is_active           boolean                         NOT NULL DEFAULT true,
    created_at          timestamptz                     NOT NULL DEFAULT now(),
    updated_at          timestamptz                     NOT NULL DEFAULT now(),
    CONSTRAINT stagnation_rules_escalate_gte_warn
        CHECK (escalate_at_pct >= warn_at_pct)
);

ALTER TABLE stagnation_rules ENABLE ROW LEVEL SECURITY;

-- Notifications inbox ------------------------------------------------------

CREATE TABLE notifications (
    id                      uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_id            uuid                NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    notification_type       notification_type_t NOT NULL,
    subject                 text                NOT NULL,
    body                    text                NOT NULL,
    link_url                text                NULL,
    channels                text[]              NOT NULL DEFAULT ARRAY['in_app']::text[],
    is_read                 boolean             NOT NULL DEFAULT false,
    sent_in_app_at          timestamptz         NULL,
    sent_email_at           timestamptz         NULL,
    sent_whatsapp_at        timestamptz         NULL,
    related_company_id      uuid                NULL REFERENCES companies(id) ON DELETE SET NULL,
    related_task_id         uuid                NULL REFERENCES tasks(id) ON DELETE SET NULL,
    created_at              timestamptz         NOT NULL DEFAULT now()
);

CREATE INDEX notifications_recipient_unread_idx
    ON notifications (recipient_id, created_at DESC)
    WHERE is_read = false;

CREATE INDEX notifications_recipient_idx
    ON notifications (recipient_id, created_at DESC);

CREATE INDEX notifications_type_idx
    ON notifications (notification_type, created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
