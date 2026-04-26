'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setTaskStatus } from '@/server/actions/tasks';
import { TASK_STATUSES, TASK_STATUS_LABEL, type TaskStatus } from '@/lib/zod/task';

export function GlobalTaskStatusSelect({ id, status }: { id: string; status: TaskStatus }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <select
      defaultValue={status}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.value as TaskStatus;
        startTransition(async () => {
          await setTaskStatus(id, next);
          router.refresh();
        });
      }}
      className="rounded border border-agsi-midGray bg-white px-2 py-1 text-xs"
    >
      {TASK_STATUSES.map((s) => (
        <option key={s} value={s}>
          {TASK_STATUS_LABEL[s]}
        </option>
      ))}
    </select>
  );
}
