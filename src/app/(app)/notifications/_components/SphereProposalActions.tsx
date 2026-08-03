'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  approveSphereProposal,
  rejectSphereProposal,
} from '@/server/actions/sphere-proposals';
import { notifyUnreadChanged } from '@/lib/notifications-events';

/**
 * Inline approve / reject for a pending sphere proposal, mirrored on
 * the level-change ReviewActions pattern so the two decision surfaces
 * feel identical. Approve auto-clears the peer reviewers' notifications
 * via resolve_notifications_for_entity (in the RPC), reject records the
 * required rationale.
 */
export function SphereProposalActions({ proposalId }: { proposalId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rejectMode, setRejectMode] = useState(false);
  const [reviewNote, setReviewNote] = useState('');

  function approve() {
    setError(null);
    startTransition(async () => {
      const r = await approveSphereProposal(proposalId, reviewNote.trim() || null);
      if ('error' in r) setError(r.error);
      else {
        setReviewNote('');
        notifyUnreadChanged();
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
      const r = await rejectSphereProposal(proposalId, reviewNote);
      if ('error' in r) setError(r.error);
      else {
        setReviewNote('');
        setRejectMode(false);
        notifyUnreadChanged();
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
            : 'Optional note on approval…'
        }
        rows={2}
        className="w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-xs"
      />
      <div className="flex flex-wrap items-center gap-2">
        {!rejectMode && (
          <Button size="sm" disabled={pending} onClick={approve}>
            {pending ? 'Working…' : 'Add to sphere'}
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
