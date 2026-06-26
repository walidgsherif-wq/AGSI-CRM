'use client';

import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Badge } from '@/components/ui/badge';
import type { Level, Role } from '@/types/domain';
import { ReviewActions } from '@/app/(app)/admin/level-requests/_components/ReviewActions';

export type PendingRequestSummary = {
  request_id: string;
  from_level: Level;
  to_level: Level;
};

/**
 * Shown on company-detail pages and pipeline cards when the company
 * has a pending level_change_request. Renders a directional chip
 * (e.g. "L1 → L2 pending").
 *
 * For admin / bd_head the chip is the approval entry point — clicking
 * opens a modal hosting the SAME ReviewActions component that
 * /admin/level-requests uses, so the approve/reject flow stays
 * single-source. For every other role the chip is status-only.
 *
 * The badge clears as soon as the request is approved/rejected
 * because the parent re-fetches via router.refresh() (ReviewActions
 * already does that on success).
 */
export function PendingLevelUpBadge({
  request,
  viewerRole,
  size = 'inline',
}: {
  request: PendingRequestSummary;
  viewerRole: Role;
  size?: 'inline' | 'card';
}) {
  const [open, setOpen] = useState(false);
  const canReview = viewerRole === 'admin' || viewerRole === 'bd_head';

  const label = `${request.from_level} → ${request.to_level} pending`;
  const chip = (
    <Badge variant="amber" className={size === 'card' ? 'mt-2' : undefined}>
      {label}
    </Badge>
  );

  if (!canReview) {
    return (
      <span
        title="A level change has been requested for this stakeholder."
        className="inline-flex"
      >
        {chip}
      </span>
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label={`Review pending level change ${label}`}
          className="inline-flex rounded focus:outline-none focus:ring-2 focus:ring-agsi-accent"
        >
          {chip}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-agsi-navy/50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 p-4 focus:outline-none"
          aria-describedby={undefined}
        >
          <div className="space-y-4 rounded-xl border border-agsi-lightGray bg-white p-5 shadow-xl">
            <Dialog.Title className="text-base font-semibold text-agsi-navy">
              Review level change — {label}
            </Dialog.Title>
            <p className="text-sm text-agsi-darkGray">
              Approve to move the stakeholder up; reject to send it back to
              the requester with a reason.
            </p>
            <ReviewActions requestId={request.request_id} />
            <div className="flex items-center justify-end">
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded border border-agsi-midGray bg-white px-3 py-1 text-xs font-medium text-agsi-navy hover:bg-agsi-lightGray/40"
                >
                  Close
                </button>
              </Dialog.Close>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
