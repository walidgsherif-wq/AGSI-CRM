-- 0106_tasks_select_scope_and_completion_rpc.sql
-- Two changes for the My Tasks / Assigned-By-Me / completion-loop
-- surfaces:
--
--   1) Tighten tasks_select_ops from "any BD-team member sees any
--      task" (0047) to owner-or-assigner (admins stay unrestricted).
--      A dashboard-level scope rule mustn't rest on client-side
--      filtering — the RLS is the ground truth.
--
--   2) send_task_completed_notification RPC — mirrors 0051's
--      send_task_assigned_notification. SECURITY DEFINER so the
--      write bypasses the notifications-INSERT-forbidden RLS the
--      same way every other notify fan-out does. Fires only when
--      a lead-assigned task (assigned_by_id set + differs from
--      owner) transitions to 'done'; the callsite in updateTask
--      wraps in try/catch so a failed notify never blocks the
--      status update.

-- ── 1) Tighten tasks SELECT RLS ──────────────────────────────────

DROP POLICY IF EXISTS tasks_select_ops ON tasks;

CREATE POLICY tasks_select_ops
    ON tasks FOR SELECT
    USING (
        -- Admins retain full-team visibility for oversight surfaces.
        auth_role() = 'admin'
        -- Everyone else sees a task only if they own it OR they
        -- assigned it (bd_head lead-view). bd_manager therefore
        -- sees ONLY their own tasks — no peers, no unowned rows.
        OR owner_id = auth.uid()
        OR assigned_by_id = auth.uid()
    );

COMMENT ON POLICY tasks_select_ops ON tasks IS
    'Owner-or-assigner scoping. Members see only tasks they own; '
    'admin/bd_head additionally see anything they assigned (the '
    'Assigned-By-Me view). Admins are unrestricted for oversight. '
    'Replaces the pre-0106 broad "any BD-team member sees any '
    'task" rule so client-side scoping is defence in depth, not '
    'the only gate.';

-- ── 2) send_task_completed_notification ──────────────────────────

CREATE OR REPLACE FUNCTION send_task_completed_notification(
    p_task_id      uuid,
    p_actor_id     uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_task          tasks%ROWTYPE;
    v_completer     text;
    v_company_name  text;
    v_link          text;
BEGIN
    SELECT * INTO v_task FROM tasks WHERE id = p_task_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Task % not found.', p_task_id;
    END IF;

    -- No notification when the task wasn't lead-assigned. Also no
    -- self-loop: a lead who completes their own assigned task
    -- shouldn't get a notification about their own action.
    IF v_task.assigned_by_id IS NULL
       OR v_task.assigned_by_id = v_task.owner_id
       OR v_task.assigned_by_id = p_actor_id
    THEN
        RETURN;
    END IF;

    SELECT full_name INTO v_completer FROM profiles WHERE id = p_actor_id;
    IF v_task.company_id IS NOT NULL THEN
        SELECT canonical_name INTO v_company_name
          FROM companies WHERE id = v_task.company_id;
    END IF;

    v_link := CASE
        WHEN v_task.company_id IS NOT NULL
            THEN format('/companies/%s/tasks', v_task.company_id)
        ELSE '/tasks'
    END;

    INSERT INTO notifications (
        recipient_id, notification_type, subject, body, link_url,
        related_task_id, related_company_id, entity_type, entity_id
    ) VALUES (
        v_task.assigned_by_id,
        'task_completed'::notification_type_t,
        format(
            '%s completed: %s',
            coalesce(v_completer, 'A member'),
            v_task.title
        ),
        format(
            'Completed by %s%s.',
            coalesce(v_completer, 'a member'),
            COALESCE(' for ' || v_company_name, '')
        ),
        v_link,
        v_task.id,
        v_task.company_id,
        'task',
        v_task.id
    );
END;
$$;

GRANT EXECUTE ON FUNCTION send_task_completed_notification(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION send_task_completed_notification(uuid, uuid) IS
    'Fires one ''task_completed'' notification to a task''s assigner '
    'when the assignee marks it done. No-ops when the task is self-'
    'assigned or the actor IS the assigner. Called best-effort from '
    'the updateTask action right after the status flip commits; '
    'the caller wraps in try/catch so a failed notify never blocks '
    'the status update.';
