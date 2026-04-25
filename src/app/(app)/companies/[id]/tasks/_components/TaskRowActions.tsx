'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setTaskStatus, deleteTask } from '@/server/actions/tasks';
import { TASK_STATUSES, TASK_STATUS_LABEL, type TaskStatus } from '@/lib/zod/task';

export function TaskRowActions({
  id,
  status,
  contextPath,
  canDelete,
}: {
  id: string;
  status: TaskStatus;
  contextPath: string;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-2">
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
      {canDelete && (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (!confirm('Delete this task?')) return;
            startTransition(async () => {
              await deleteTask(id, contextPath);
              router.refresh();
            });
          }}
          className="text-xs text-rag-red hover:underline disabled:opacity-50"
        >
          Delete
        </button>
      )}
    </div>
  );
}
