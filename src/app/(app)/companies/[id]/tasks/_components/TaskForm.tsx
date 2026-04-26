'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
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

export function TaskForm({
  mode,
  companyId,
  profiles,
  defaultOwnerId,
  initial,
  onClose,
}: {
  mode: 'create' | 'edit';
  companyId: string;
  profiles: ProfileOption[];
  defaultOwnerId: string;
  initial?: TaskFormInitial;
  onClose?: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(mode === 'edit');
  const [reminders, setReminders] = useState<Set<ReminderKind>>(
    new Set(initial?.reminder_kinds ?? []),
  );
  const [customAt, setCustomAt] = useState(initial?.reminder_custom_at ?? '');

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
    <form
      action={onSubmit}
      className="space-y-3 rounded-xl border border-agsi-lightGray bg-white p-4"
    >
      {mode === 'edit' && initial && <input type="hidden" name="id" value={initial.id} />}
      <input type="hidden" name="company_id" value={companyId} />

      <div>
        <label className="block text-xs font-medium text-agsi-darkGray">Title</label>
        <input
          name="title"
          required
          defaultValue={initial?.title ?? ''}
          className="mt-1 w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-agsi-darkGray">
          Description (optional)
        </label>
        <textarea
          name="description"
          rows={2}
          defaultValue={initial?.description ?? ''}
          className="mt-1 w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <div>
          <label className="block text-xs font-medium text-agsi-darkGray">Owner</label>
          <select
            name="owner_id"
            required
            defaultValue={initial?.owner_id ?? defaultOwnerId}
            className="mt-1 w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm"
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-agsi-darkGray">Due date</label>
          <input
            name="due_date"
            type="date"
            defaultValue={initial?.due_date ?? ''}
            className="mt-1 w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-agsi-darkGray">Priority</label>
          <select
            name="priority"
            defaultValue={initial?.priority ?? 'med'}
            className="mt-1 w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm"
          >
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {TASK_PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
        </div>
        {mode === 'edit' && (
          <div>
            <label className="block text-xs font-medium text-agsi-darkGray">Status</label>
            <select
              name="status"
              defaultValue={initial?.status ?? 'open'}
              className="mt-1 w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm"
            >
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {TASK_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
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
            <input
              type="datetime-local"
              name="reminder_custom_at"
              value={customAt}
              onChange={(e) => setCustomAt(e.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm"
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
    </form>
  );
}
