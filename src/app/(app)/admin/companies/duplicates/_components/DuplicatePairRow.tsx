'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { Route } from 'next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LevelBadge } from '@/components/domain/LevelBadge';
import type { Role } from '@/types/domain';
import type {
  CompanySnapshot,
  PairChildCounts,
} from '../page';
import { MergeDialog } from './MergeDialog';
import { MarkDistinctButton } from './MarkDistinctButton';

/**
 * One candidate pair rendered as a two-column summary + row actions.
 * The Compare & merge button opens MergeDialog with the pair; the
 * merge-permission check happens inside the dialog so we can show a
 * "needs bd_head/admin" message rather than hide the row entirely.
 */
export function DuplicatePairRow({
  pair,
  left,
  right,
  leftCounts,
  rightCounts,
  viewerId,
  viewerRole,
}: {
  pair: { aId: string; bId: string };
  left: CompanySnapshot;
  right: CompanySnapshot;
  leftCounts: PairChildCounts;
  rightCounts: PairChildCounts;
  viewerId: string;
  viewerRole: Role;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);

  // Permission: bd_manager can only merge if BOTH companies are their
  // own or unowned. bd_head/admin can always merge. This mirrors the
  // RPC's guard so the UI matches the eventual server verdict.
  const canMerge =
    viewerRole === 'admin' ||
    viewerRole === 'bd_head' ||
    (viewerRole === 'bd_manager' &&
      (left.owner_id === null || left.owner_id === viewerId) &&
      (right.owner_id === null || right.owner_id === viewerId));

  return (
    <div>
      <div className="grid gap-3 lg:grid-cols-2">
        <SideCard side={left} counts={leftCounts} />
        <SideCard side={right} counts={rightCounts} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {canMerge ? (
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            Compare &amp; merge&hellip;
          </Button>
        ) : (
          <span className="text-xs italic text-agsi-darkGray">
            Needs bd_head/admin to merge (owned by another member).
          </span>
        )}
        <MarkDistinctButton aId={pair.aId} bId={pair.bId} />
      </div>

      {canMerge && (
        <MergeDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          left={left}
          right={right}
          leftCounts={leftCounts}
          rightCounts={rightCounts}
        />
      )}
    </div>
  );
}

function SideCard({
  side,
  counts,
}: {
  side: CompanySnapshot;
  counts: PairChildCounts;
}) {
  const owner = Array.isArray(side.owner) ? side.owner[0] : side.owner;
  return (
    <div className="rounded-lg border border-agsi-lightGray bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          href={`/companies/${side.id}` as Route}
          className="font-medium text-agsi-navy hover:underline"
        >
          {side.canonical_name}
        </Link>
        <LevelBadge level={side.current_level} />
      </div>
      <p className="mt-1 text-xs text-agsi-darkGray">
        Owner: {owner?.full_name ?? 'Unassigned'}
        {side.country ? ` · ${side.country}` : ''}
      </p>
      <div className="mt-2 flex flex-wrap gap-1">
        {side.is_key_stakeholder && <Badge variant="gold">Key</Badge>}
        {side.parent_company_id && <Badge variant="blue">Grouped child</Badge>}
      </div>
      <p className="mt-2 text-xs tabular-nums text-agsi-darkGray">
        {counts.projects} projects · {counts.engagements} engagements ·{' '}
        {counts.contacts} contacts · {counts.levelHistory} level events
      </p>
    </div>
  );
}
