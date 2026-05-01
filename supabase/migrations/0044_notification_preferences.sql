-- 0044_notification_preferences.sql
-- M16.2 — per-user, per-type notification opt-out toggles. Replaces
-- the static catalogue at /settings/notifications with functional
-- switches.
--
-- Default: in-app on, email/whatsapp off (the latter two channels
-- aren't wired in v1 per §16 D-3 anyway). When a user has no row
-- for a (notification_type), the bell + inbox treat them as opted-in
-- on in-app via COALESCE.
--
-- The eval functions (M13) and webhook handlers (M9, M12) still
-- INSERT into notifications regardless; preferences are honored at
-- read time so the audit trail of "what fired" stays complete.

CREATE TABLE notification_preferences (
    user_id            uuid                NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    notification_type  notification_type_t NOT NULL,
    in_app_enabled     boolean             NOT NULL DEFAULT true,
    email_enabled      boolean             NOT NULL DEFAULT false,
    whatsapp_enabled   boolean             NOT NULL DEFAULT false,
    updated_at         timestamptz         NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, notification_type)
);

CREATE INDEX notification_preferences_user_idx
    ON notification_preferences (user_id);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

-- Users can read + write only their own preferences.
CREATE POLICY notification_preferences_self
    ON notification_preferences FOR ALL
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());
