'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { TASK_PRIORITIES, TASK_PRIORITY_LABEL } from '@/lib/zod/task';
import { createTask } from '@/server/actions/tasks';

type ProfileOption = { id: string; full_name: string };

export function TaskForm({
  companyId,
  profiles,
  defaultOwnerId,
}: {
  companyId: string;
  profiles: ProfileOption[];
  defaultOwnerId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const r = await createTask(formData);
      if (r.error) setError(r.error);
      else {
        setOpen(false);
        router.refresh();
      }
    });
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} size="sm">
        + New task
      </Button>
    );
  }

  return (
    <form action={onSubmit} className="space-y-3 rounded-xl border border-agsi-lightGray bg-white p-4">
      <input type="hidden" name="company_id" value={companyId} />
      <div>
        <label className="block text-xs font-medium text-agsi-darkGray">Title</label>
        <input
          name="title"
          required
          className="mt-1 w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-agsi-darkGray">Description (optional)</label>
        <textarea
          name="description"
          rows={2}
          className="mt-1 w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="block text-xs font-medium text-agsi-darkGray">Owner</label>
          <select
            name="owner_id"
            required
            defaultValue={defaultOwnerId}
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
            className="mt-1 w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-agsi-darkGray">Priority</label>
          <select
            name="priority"
            defaultValue="med"
            className="mt-1 w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm"
          >
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {TASK_PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Saving…' : 'Create task'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        {error && <p className="text-xs text-rag-red">{error}</p>}
      </div>
    </form>
  );
}
