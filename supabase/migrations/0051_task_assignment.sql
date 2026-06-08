-- 0051_task_assignment.sql
-- v1.1 (FX-014b) — head-of-BD task allocation.
--
-- The tasks table from 0008 conflates "who's responsible" (owner_id)
-- with "who handed it over" — they were the same person until now.
-- This migration:
--   1. Adds tasks.assigned_by_id so the UI can render "assigned by …"
--      and the audit trail records the delegator.
--   2. Adds notification_type 'task_assigned' so the existing
--      notifications inbox can carry the alert with no new system.
--   3. Tightens tasks INSERT RLS so bd_manager can only create tasks
--      where owner_id = themselves; admin/bd_head can create tasks
--      with any owner_id (i.e. assign). UPDATE RLS from 0022 already
--      blocks bd_manager from re-assigning (WITH CHECK pins
--      owner_id to auth.uid()), so no UPDATE change needed.
--   4. SECURITY DEFINER helper send_task_assigned_notification that
--      writes the notification — notifications RLS forbids direct
--      INSERT by users, so every notification fires through a
--      definer-side fn (mirrors the stagnation pattern in 0014).

-- =====================================================================
-- 1) tasks.assigned_by_id
-- =====================================================================

ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS assigned_by_id uuid
        REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS tasks_assigned_by_idx
    ON tasks (assigned_by_id) WHERE assigned_by_id IS NOT NULL;

COMMENT ON COLUMN tasks.assigned_by_id IS
    'When admin/bd_head assigns a task to another member, the assigner profile id. NULL when self-assigned (owner_id = assigner). Drives the "assigned by …" label on /tasks and the company Tasks tab.';

-- =====================================================================
-- 2) notification_type enum — task_assigned
-- =====================================================================
--
-- IF NOT EXISTS so re-runs are safe. plpgsql function bodies are
-- lazy-parsed so the CREATE FUNCTION below can reference the new
-- value within the same migration without the "unsafe use of new
-- enum value" trap.

ALTER TYPE notification_type_t ADD VALUE IF NOT EXISTS 'task_assigned';

-- =====================================================================
-- 3) Tighter INSERT RLS on tasks
-- =====================================================================

DROP POLICY IF EXISTS tasks_insert_ops          ON tasks;
DROP POLICY IF EXISTS tasks_insert_admin_head   ON tasks;
DROP POLICY IF EXISTS tasks_insert_manager_self ON tasks;

-- admin / bd_head can insert with any owner_id (i.e. assign).
CREATE POLICY tasks_insert_admin_head
    ON tasks FOR INSERT
    WITH CHECK (auth_role() IN ('admin','bd_head'));

-- bd_manager can only self-assign. UI hides the selector for managers
-- (defense in depth) but this is the data-layer block.
CREATE POLICY tasks_insert_manager_self
    ON tasks FOR INSERT
    WITH CHECK (auth_role() = 'bd_manager' AND owner_id = auth.uid());

-- =====================================================================
-- 4) send_task_assigned_notification — SECURITY DEFINER
-- =====================================================================

CREATE OR REPLACE FUNCTION send_task_assigned_notification(
    p_task_id      uuid,
    p_recipient_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_task          tasks%ROWTYPE;
    v_assigner_name text;
    v_company_name  text;
BEGIN
    IF auth.uid() IS NULL OR auth_role() NOT IN ('admin','bd_head') THEN
        RAISE EXCEPTION 'Only admin/bd_head can send task-assignment notifications.';
    END IF;

    SELECT * INTO v_task FROM tasks WHERE id = p_task_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Task % not found.', p_task_id;
    END IF;

    -- No-op if the assigner is also the assignee (self-assignment).
    IF p_recipient_id = auth.uid() THEN
        RETURN;
    END IF;

    SELECT full_name INTO v_assigner_name FROM profiles WHERE id = auth.uid();
    IF v_task.company_id IS NOT NULL THEN
        SELECT canonical_name INTO v_company_name FROM companies WHERE id = v_task.company_id;
    END IF;

    INSERT INTO notifications (
        recipient_id, notification_type, subject, body, link_url,
        related_task_id, related_company_id
    ) VALUES (
        p_recipient_id,
        'task_assigned'::notification_type_t,
        'Task assigned: ' || v_task.title,
        'Assigned by ' || COALESCE(v_assigner_name, 'Admin')
            || COALESCE(' for ' || v_company_name, ''),
        CASE WHEN v_task.company_id IS NOT NULL
             THEN '/companies/' || v_task.company_id || '/tasks'
             ELSE '/tasks'
        END,
        v_task.id,
        v_task.company_id
    );
END;
$$;

GRANT EXECUTE ON FUNCTION send_task_assigned_notification(uuid, uuid) TO authenticated;
