-- 0078_tasks_engagement_id.sql
-- Link follow-up tasks back to the engagement they spawned from.
-- NULLable + ON DELETE SET NULL: a task survives if its source
-- engagement is later removed; the link just clears.
--
-- Why a real FK and not a free-text reference: the task list needs a
-- typed "From engagement: <summary> · <date>" link that joins to the
-- engagements row. With a FK + ON DELETE SET NULL we get integrity
-- on insert/update and graceful degradation on engagement delete,
-- without coupling a task's lifetime to its source.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.

ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS engagement_id uuid NULL
        REFERENCES engagements(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS tasks_engagement_idx
    ON tasks (engagement_id)
    WHERE engagement_id IS NOT NULL;

COMMENT ON COLUMN tasks.engagement_id IS
    'Source engagement when this task was created from one (e.g. via '
    'the engagement row''s "+ Follow-up task" action). NULL for tasks '
    'created from any other entry point. ON DELETE SET NULL so a task '
    'survives engagement deletion with the link cleared.';
