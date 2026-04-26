'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { approveLevelRequest, rejectLevelRequest } from '@/server/actions/level';

export function ReviewActions({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rejectMode, setRejectMode] = useState(false);
  const [reviewNote, setReviewNote] = useState('');

  function approve() {
    setError(null);
    startTransition(async () => {
      const r = await approveLevelRequest(requestId, reviewNote.trim() || null);
      if (r.error) setError(r.error);
      else {
        setReviewNote('');
        router.refresh();
      }
    });
  }

  function reject() {
    if (!reviewNote.trim()) {
      setError('A reason is required when rejecting.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await rejectLevelRequest(requestId, reviewNote);
      if (r.error) setError(r.error);
      else {
        setReviewNote('');
        setRejectMode(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-2">
      <textarea
        value={reviewNote}
        onChange={(e) => setReviewNote(e.target.value)}
        placeholder={
          rejectMode
            ? 'Reason for rejection (required)…'
            : 'Optional review note for approval…'
        }
        rows={2}
        className="w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-xs"
      />
      <div className="flex flex-wrap items-center gap-2">
        {!rejectMode && (
          <Button size="sm" disabled={pending} onClick={approve}>
            {pending ? 'Working…' : 'Approve'}
          </Button>
        )}
        {!rejectMode && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => setRejectMode(true)}
          >
            Reject
          </Button>
        )}
        {rejectMode && (
          <>
            <Button size="sm" variant="danger" disabled={pending} onClick={reject}>
              {pending ? 'Working…' : 'Confirm reject'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setRejectMode(false);
                setReviewNote('');
                setError(null);
              }}
            >
              Cancel
            </Button>
          </>
        )}
        {error && <p className="text-xs text-rag-red">{error}</p>}
      </div>
    </div>
  );
}
