'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABEL,
  TASK_STATUSES,
  TASK_STATUS_LABEL,
  REMINDER_KINDS,
  REMINDER_KIND_LABEL,
  type ReminderKind,
  type TaskPriority,
  type TaskStatus,
} from '@/lib/zod/task';
import { createTask, updateTask } from '@/server/actions/tasks';
import { GuardedForm } from '@/components/ui/guarded-form';

type ProfileOption = { id: string; full_name: string };

export type TaskFormInitial = {
  id: string;
  title: string;
  description: string | null;
  owner_id: string;
  due_date: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  reminder_kinds: ReminderKind[];
  reminder_custom_at: string | null;
};

export type EngagementContext = {
  id: string;
  summary: string;
  engagement_date: string;
  author_name: string | null;
  /** Where to send the user when they click "From engagement". */
  href: string;
};

/**
 * Comment context — mirrors EngagementContext so the same TaskForm
 * renders a "From comment" panel + hidden comment_id input when a
 * user creates a task from the discussion thread.
 */
export type CommentContext = {
  id: string;
  body: string;
  created_at: string;
  author_name: string | null;
  /** Deep-link back to the source comment in the discussion rail. */
  href: string;
};

export function TaskForm({
  mode,
  companyId,
  profiles,
  defaultOwnerId,
  initial,
  onClose,
  canAssignToOthers = false,
  engagementContext,
  commentContext,
  titleDefault,
  descriptionDefault,
  defaultOpen,
}: {
  mode: 'create' | 'edit';
  /** Null for standalone / ad-hoc tasks (FX-014c). When null, the
   *  hidden company_id input is skipped and the task lands with
   *  company_id = NULL — invisible to every company's Tasks tab,
   *  visible only on /tasks. */
  companyId: string | null;
  profiles: ProfileOption[];
  defaultOwnerId: string;
  initial?: TaskFormInitial;
  onClose?: () => void;
  canAssignToOthers?: boolean;
  /** When set (follow-up entry path): renders a collapsible read-only
   *  "From engagement" block above the form, emits a hidden
   *  engagement_id input so the saved task carries the link, and
   *  opens the form on mount. */
  engagementContext?: EngagementContext;
  /** When set (task-from-comment entry path): renders the same
   *  collapsible chrome as engagementContext but for a discussion
   *  comment; emits a hidden comment_id. */
  commentContext?: CommentContext;
  /** Used when initial.title is empty — typically
   *  "Follow up: {companyName}" for the follow-up path. */
  titleDefault?: string;
  /** Pre-fill the description field (empty by default). Used by the
   *  comment-follow-up path to seed a `From comment: "…"` quote. */
  descriptionDefault?: string;
  /** Open the form on mount (used when arriving via follow-up URL). */
  defaultOpen?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(
    mode === 'edit' ||
      defaultOpen === true ||
      !!engagementContext ||
      !!commentContext,
  );
  const [reminders, setReminders] = useState<Set<ReminderKind>>(
    new Set(initial?.reminder_kinds ?? []),
  );
  const [customAt, setCustomAt] = useState(initial?.reminder_custom_at ?? '');
  const [engagementExpanded, setEngagementExpanded] = useState(false);
  const [commentExpanded, setCommentExpanded] = useState(false);

  function close() {
    if (mode === 'edit' && onClose) onClose();
    else setOpen(false);
  }

  function toggleKind(k: ReminderKind, checked: boolean) {
    setReminders((prev) => {
      const next = new Set(prev);
      if (checked) next.add(k);
      else next.delete(k);
      return next;
    });
  }

  async function onSubmit(formData: FormData) {
    setError(null);
    // Append reminder_kinds (FormData.append for arrays)
    formData.delete('reminder_kinds');
    for (const k of reminders) formData.append('reminder_kinds', k);

    startTransition(async () => {
      const r = mode === 'create' ? await createTask(formData) : await updateTask(formData);
      if (r.error) {
        setError(r.error);
      } else {
        close();
        router.refresh();
      }
    });
  }

  if (mode === 'create' && !open) {
    return (
      <Button onClick={() => setOpen(true)} size="sm">
        + New task
      </Button>
    );
  }

  return (
    <GuardedForm
      action={onSubmit}
      className="space-y-3 rounded-xl border border-agsi-lightGray bg-white p-4"
    >
      {mode === 'edit' && initial && <input type="hidden" name="id" value={initial.id} />}
      {companyId && <input type="hidden" name="company_id" value={companyId} />}
      {engagementContext && (
        <input
          type="hidden"
          name="engagement_id"
          value={engagementContext.id}
        />
      )}
      {commentContext && (
        <input type="hidden" name="comment_id" value={commentContext.id} />
      )}

      {commentContext && (
        <div className="rounded-lg border border-agsi-accent/40 bg-agsi-accent/5 px-3 py-2 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold text-agsi-navy">
              From comment · {new Date(commentContext.created_at).toLocaleString()}
              {commentContext.author_name && (
                <span className="font-normal text-agsi-darkGray">
                  {' '}
                  · by {commentContext.author_name}
                </span>
              )}
            </p>
            <button
              type="button"
              onClick={() => setCommentExpanded((v) => !v)}
              className="text-xs font-medium text-agsi-accent hover:underline"
            >
              {commentExpanded ? 'Hide comment' : 'Show comment'}
            </button>
          </div>
          {commentExpanded && (
            <p className="mt-2 whitespace-pre-wrap text-agsi-navy">
              {commentContext.body}
            </p>
          )}
        </div>
      )}

      {engagementContext && (
        <div className="rounded-lg border border-agsi-accent/40 bg-agsi-accent/5 px-3 py-2 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold text-agsi-navy">
              From engagement · {engagementContext.engagement_date}
              {engagementContext.author_name && (
                <span className="font-normal text-agsi-darkGray">
                  {' '}
                  · by {engagementContext.author_name}
                </span>
              )}
            </p>
            <button
              type="button"
              onClick={() => setEngagementExpanded((v) => !v)}
              className="text-xs font-medium text-agsi-accent hover:underline"
            >
              {engagementExpanded ? 'Hide note' : 'Show note'}
            </button>
          </div>
          {engagementExpanded && (
            <p className="mt-2 whitespace-pre-wrap text-agsi-navy">
              {engagementContext.summary}
            </p>
          )}
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-agsi-darkGray">Title</label>
        <Input
          name="title"
          required
          defaultValue={initial?.title ?? titleDefault ?? ''}
          className="mt-1"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-agsi-darkGray">
          Description (optional)
        </label>
        <Textarea
          name="description"
          rows={2}
          defaultValue={initial?.description ?? descriptionDefault ?? ''}
          className="mt-1"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <div>
          <label className="block text-xs font-medium text-agsi-darkGray">
            {canAssignToOthers ? 'Assign to' : 'Owner'}
          </label>
          {canAssignToOthers ? (
            <Select
              name="owner_id"
              required
              defaultValue={initial?.owner_id ?? defaultOwnerId}
              className="mt-1"
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </Select>
          ) : (
            <>
              <input
                type="hidden"
                name="owner_id"
                value={initial?.owner_id ?? defaultOwnerId}
              />
              <p className="mt-1 rounded-lg border border-agsi-lightGray bg-agsi-offWhite px-3 py-2 text-sm text-agsi-darkGray">
                {profiles.find(
                  (p) => p.id === (initial?.owner_id ?? defaultOwnerId),
                )?.full_name ?? 'You'}
              </p>
            </>
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-agsi-darkGray">Due date</label>
          <Input
            name="due_date"
            type="date"
            defaultValue={initial?.due_date ?? ''}
            className="mt-1"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-agsi-darkGray">Priority</label>
          <Select
            name="priority"
            defaultValue={initial?.priority ?? 'med'}
            className="mt-1"
          >
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {TASK_PRIORITY_LABEL[p]}
              </option>
            ))}
          </Select>
        </div>
        {mode === 'edit' && (
          <div>
            <label className="block text-xs font-medium text-agsi-darkGray">Status</label>
            <Select
              name="status"
              defaultValue={initial?.status ?? 'open'}
              className="mt-1"
            >
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {TASK_STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>

      <fieldset className="rounded-lg border border-agsi-lightGray p-3">
        <legend className="px-1 text-xs font-medium text-agsi-darkGray">Reminders</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {REMINDER_KINDS.map((k) => (
            <label
              key={k}
              className="flex items-center gap-2 text-sm text-agsi-navy"
            >
              <input
                type="checkbox"
                checked={reminders.has(k)}
                onChange={(e) => toggleKind(k, e.target.checked)}
                className="h-4 w-4 rounded border-agsi-midGray"
              />
              {REMINDER_KIND_LABEL[k]}
            </label>
          ))}
        </div>
        {reminders.has('custom') && (
          <div className="mt-3">
            <label className="block text-xs font-medium text-agsi-darkGray">
              Custom reminder time (Asia/Dubai)
            </label>
            <Input
              type="datetime-local"
              name="reminder_custom_at"
              value={customAt}
              onChange={(e) => setCustomAt(e.target.value)}
              required
              className="mt-1"
            />
          </div>
        )}
        <p className="mt-2 text-xs text-agsi-darkGray">
          Reminders fire as in-app notifications at the chosen time(s). The non-custom
          kinds anchor to 09:00 Asia/Dubai on the offset date and require a due date set.
        </p>
      </fieldset>

      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Saving…' : mode === 'create' ? 'Create task' : 'Save changes'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={close}>
          Cancel
        </Button>
        {error && <p className="text-xs text-rag-red">{error}</p>}
      </div>
    </GuardedForm>
  );
}
