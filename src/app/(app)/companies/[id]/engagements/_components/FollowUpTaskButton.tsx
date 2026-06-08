'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createFollowUpTask } from '@/server/actions/tasks';

// Small action button rendered on each engagement row. Spins up a
// follow-up task pre-linked to the same company, assigned to the
// caller, title seeded from the engagement summary. Click handler
// stops propagation so the parent row's drawer-open doesn't fire.

export function FollowUpTaskButton({
  engagementId,
  disabled,
}: {
  engagementId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<'idle' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    if (disabled || pending || state === 'done') return;
    setError(null);
    startTransition(async () => {
      const r = await createFollowUpTask(engagementId);
      if (r.error) {
        setError(r.error);
        setState('error');
      } else {
        setState('done');
        router.refresh();
      }
    });
  }

  const label =
    pending ? 'Creating…'
    : state === 'done' ? 'Task created ✓'
    : state === 'error' ? 'Try again'
    : '+ Follow-up task';

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || pending || state === 'done'}
      title={
        error ??
        'Create a follow-up task on this company, assigned to you. Set the due date afterward in the Tasks tab.'
      }
      aria-label="Create follow-up task from this engagement"
      className={
        state === 'done'
          ? 'rounded border border-rag-green/30 bg-rag-green/10 px-2 py-1 text-xs font-medium text-rag-green'
          : state === 'error'
          ? 'rounded border border-rag-red/30 bg-white px-2 py-1 text-xs font-medium text-rag-red hover:bg-rag-red/5'
          : 'rounded border border-agsi-midGray bg-white px-2 py-1 text-xs font-medium text-agsi-navy hover:bg-agsi-lightGray/40 disabled:opacity-50'
      }
    >
      {label}
    </button>
  );
}
