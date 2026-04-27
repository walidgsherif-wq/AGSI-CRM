'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ENGAGEMENT_TYPE_LABEL, type EngagementType } from '@/lib/zod/engagement';
import { EngagementDetailsSheet } from '@/components/domain/EngagementDetailsSheet';
import { DeleteEngagementButton } from './DeleteEngagementButton';

type Role = 'admin' | 'leadership' | 'bd_head' | 'bd_manager';

export type EngagementRowData = {
  id: string;
  engagement_type: EngagementType;
  summary: string;
  engagement_date: string;
  created_by: string;
  project: { id: string; name: string } | null;
  author_name: string | null;
};

type Props = {
  companyId: string;
  engagements: EngagementRowData[];
  projects: Array<{ id: string; name: string }>;
  role: Role;
  currentUserId: string;
  canCreate: boolean;
};

export function EngagementsList({
  companyId,
  engagements,
  projects,
  role,
  currentUserId,
  canCreate,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  function openDrawer(id: string) {
    setSelectedId(id);
    setIsOpen(true);
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Engagement log</CardTitle>
          <CardDescription>
            {engagements.length} most recent. Each entry feeds Driver C credit + the stagnation timer.
            Click a row to view details.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {engagements.length === 0 ? (
            <p className="p-6 text-sm text-agsi-darkGray">
              No engagements logged yet.{' '}
              {canCreate && 'Click "Log engagement" above to record the first one.'}
            </p>
          ) : (
            <ul className="divide-y divide-agsi-lightGray">
              {engagements.map((e) => {
                const canDelete =
                  role === 'admin' || (role !== 'leadership' && e.created_by === currentUserId);
                return (
                  <li key={e.id} className="px-0 py-0">
                    <div className="flex items-start justify-between gap-3 px-4 py-3 transition-colors hover:bg-agsi-offWhite">
                      <button
                        type="button"
                        onClick={() => openDrawer(e.id)}
                        className="flex-1 text-left focus:outline-none focus:ring-2 focus:ring-agsi-accent rounded"
                        aria-label={`View ${ENGAGEMENT_TYPE_LABEL[e.engagement_type]} from ${e.engagement_date}`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="blue">{ENGAGEMENT_TYPE_LABEL[e.engagement_type]}</Badge>
                          <span className="text-xs text-agsi-darkGray">{e.engagement_date}</span>
                          {e.project && (
                            <span className="text-xs text-agsi-accent">↳ {e.project.name}</span>
                          )}
                        </div>
                        <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-agsi-navy">
                          {e.summary}
                        </p>
                        <p className="mt-1 text-xs text-agsi-darkGray">
                          by {e.author_name ?? 'Unknown'}
                        </p>
                      </button>
                      {canDelete && (
                        <div onClick={(ev) => ev.stopPropagation()}>
                          <DeleteEngagementButton id={e.id} companyId={companyId} />
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <EngagementDetailsSheet
        engagementId={selectedId}
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        projects={projects}
        role={role}
        currentUserId={currentUserId}
      />
    </>
  );
}
