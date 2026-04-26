-- 0027_task_reminders.sql
-- M6 polish: per-task reminder scheduling.
-- Each task can have any of: at_due (09:00 Asia/Dubai on due_date),
-- 1d_before, 1w_before, 1m_before, or a custom timestamp. Reminders
-- fire by inserting rows into the existing notifications table; pg_cron
-- runs the dispatcher every 15 minutes.

CREATE TYPE reminder_kind_t AS ENUM (
    'at_due',
    '1d_before',
    '1w_before',
    '1m_before',
    'custom'
);

CREATE TABLE task_reminders (
    id              uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id         uuid              NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    reminder_kind   reminder_kind_t   NOT NULL,
    reminder_at     timestamptz       NOT NULL,
    sent_at         timestamptz       NULL,
    created_at      timestamptz       NOT NULL DEFAULT now(),
    UNIQUE (task_id, reminder_kind)
);

CREATE INDEX task_reminders_pending_idx
    ON task_reminders (reminder_at)
    WHERE sent_at IS NULL;
CREATE INDEX task_reminders_task_idx ON task_reminders (task_id);

ALTER TABLE task_reminders ENABLE ROW LEVEL SECURITY;

-- RLS: same shape as tasks (ops trio can read/write)
CREATE POLICY task_reminders_select_ops ON task_reminders
    FOR SELECT USING (auth_role() IN ('admin','bd_head','bd_manager'));
CREATE POLICY task_reminders_insert_ops ON task_reminders
    FOR INSERT WITH CHECK (auth_role() IN ('admin','bd_head','bd_manager'));
CREATE POLICY task_reminders_update_ops ON task_reminders
    FOR UPDATE USING (auth_role() IN ('admin','bd_head','bd_manager'));
CREATE POLICY task_reminders_delete_ops ON task_reminders
    FOR DELETE USING (auth_role() IN ('admin','bd_head','bd_manager'));

-- Dispatcher: SECURITY DEFINER so it can read tasks across all RLS rules
-- and INSERT into notifications regardless of caller. Returns the count of
-- reminders fired this tick.
CREATE OR REPLACE FUNCTION process_task_reminders()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count int := 0;
BEGIN
    WITH due_reminders AS (
        SELECT
            tr.id,
            tr.task_id,
            tr.reminder_kind,
            t.title,
            t.owner_id,
            t.due_date,
            t.company_id,
            c.canonical_name AS company_name
        FROM task_reminders tr
        JOIN tasks t ON t.id = tr.task_id
        LEFT JOIN companies c ON c.id = t.company_id
        WHERE tr.sent_at IS NULL
          AND tr.reminder_at <= now()
          AND t.status IN ('open', 'in_progress')
          AND t.owner_id IS NOT NULL
        ORDER BY tr.reminder_at ASC
        LIMIT 500
    ),
    inserted_notifs AS (
        INSERT INTO notifications (
            recipient_id, notification_type, subject, body, link_url, related_task_id
        )
        SELECT
            d.owner_id,
            'task_due'::notification_type_t,
            CASE d.reminder_kind
                WHEN 'at_due'    THEN 'Task due today: ' || d.title
                WHEN '1d_before' THEN 'Task due tomorrow: ' || d.title
                WHEN '1w_before' THEN 'Task due in 1 week: ' || d.title
                WHEN '1m_before' THEN 'Task due in 1 month: ' || d.title
                WHEN 'custom'    THEN 'Reminder: ' || d.title
            END,
            'Due ' || COALESCE(to_char(d.due_date, 'Mon DD, YYYY'), 'unset')
              || COALESCE(' · ' || d.company_name, ''),
            CASE
                WHEN d.company_id IS NOT NULL
                    THEN '/companies/' || d.company_id::text || '/tasks'
                ELSE '/tasks'
            END,
            d.task_id
        FROM due_reminders d
        RETURNING id
    ),
    marked AS (
        UPDATE task_reminders tr
        SET sent_at = now()
        WHERE tr.id IN (SELECT id FROM due_reminders)
        RETURNING 1
    )
    SELECT count(*) INTO v_count FROM marked;
    RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION process_task_reminders() TO authenticated;

COMMENT ON FUNCTION process_task_reminders() IS
    'Dispatcher for task_reminders. Scheduled every 15min via pg_cron. Fires task_due notifications and marks reminders sent_at.';

-- Schedule via pg_cron (guarded — extension may not be enabled on every env)
DO $cron$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'task-reminders-tick') THEN
            PERFORM cron.unschedule('task-reminders-tick');
        END IF;
        PERFORM cron.schedule(
            'task-reminders-tick',
            '*/15 * * * *',
            $sched$SELECT public.process_task_reminders();$sched$
        );
        RAISE NOTICE 'task-reminders-tick scheduled every 15 minutes';
    ELSE
        RAISE NOTICE 'pg_cron not installed — task reminders will not fire automatically. Enable in Dashboard → Database → Extensions, then re-run the cron block from this migration.';
    END IF;
END
$cron$;
