-- 0008_engagements_tasks_notes.sql
-- Operational activity. Prompt §3.6.
-- Engagements are evidence for Driver C; tasks/notes are workflow support.

CREATE TABLE engagements (
    id                          uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id                  uuid                NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    project_id                  uuid                NULL     REFERENCES projects(id)  ON DELETE SET NULL,
    engagement_type             engagement_type_t   NOT NULL,
    summary                     text                NOT NULL,
    engagement_date             date                NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Dubai')::date,
    created_by                  uuid                NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
    triggered_level_change_id   uuid                NULL     REFERENCES level_history(id) ON DELETE SET NULL,
    created_at                  timestamptz         NOT NULL DEFAULT now(),
    updated_at                  timestamptz         NOT NULL DEFAULT now()
);

CREATE INDEX engagements_company_date_idx ON engagements (company_id, engagement_date DESC);
CREATE INDEX engagements_type_date_idx    ON engagements (engagement_type, engagement_date);
CREATE INDEX engagements_created_by_idx   ON engagements (created_by);
CREATE INDEX engagements_project_idx      ON engagements (project_id) WHERE project_id IS NOT NULL;

ALTER TABLE engagements ENABLE ROW LEVEL SECURITY;

-- Tasks ----------------------------------------------------------------

CREATE TABLE tasks (
    id              uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      uuid              NULL REFERENCES companies(id) ON DELETE CASCADE,
    project_id      uuid              NULL REFERENCES projects(id)  ON DELETE CASCADE,
    title           text              NOT NULL,
    description     text              NULL,
    owner_id        uuid              NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
    due_date        date              NULL,
    priority        task_priority_t   NOT NULL DEFAULT 'med',
    status          task_status_t     NOT NULL DEFAULT 'open',
    completed_at    timestamptz       NULL,
    source          task_source_t     NOT NULL DEFAULT 'manual',
    created_at      timestamptz       NOT NULL DEFAULT now(),
    updated_at      timestamptz       NOT NULL DEFAULT now(),
    CONSTRAINT tasks_completed_when_done
        CHECK ((status = 'done' AND completed_at IS NOT NULL) OR status <> 'done')
);

-- Explicit enum casts on the literals so PG15 treats the partial-index
-- predicate as IMMUTABLE.
CREATE INDEX tasks_owner_status_idx ON tasks (owner_id, status)
    WHERE status = 'open'::task_status_t OR status = 'in_progress'::task_status_t;
CREATE INDEX tasks_due_date_idx     ON tasks (due_date)
    WHERE status = 'open'::task_status_t OR status = 'in_progress'::task_status_t;
CREATE INDEX tasks_company_idx     ON tasks (company_id) WHERE company_id IS NOT NULL;

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- Notes ----------------------------------------------------------------

CREATE TABLE notes (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id  uuid        NULL REFERENCES companies(id) ON DELETE CASCADE,
    project_id  uuid        NULL REFERENCES projects(id)  ON DELETE CASCADE,
    body        text        NOT NULL,
    author_id   uuid        NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
    is_pinned   boolean     NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT notes_one_parent
        CHECK (company_id IS NOT NULL OR project_id IS NOT NULL)
);

CREATE INDEX notes_company_idx ON notes (company_id, created_at DESC) WHERE company_id IS NOT NULL;
CREATE INDEX notes_project_idx ON notes (project_id, created_at DESC) WHERE project_id IS NOT NULL;

ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
