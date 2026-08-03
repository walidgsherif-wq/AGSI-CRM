'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { TabNav, TabNavLink } from '@/components/ui/tab-nav';
import { subscribeUnreadChanged } from '@/lib/notifications-events';
import { getUnreadMentionCountForCompany } from '@/server/actions/company-mentions';

const TABS = [
  { label: 'Overview', segment: '' },
  { label: 'Engagements', segment: 'engagements' },
  { label: 'Tasks', segment: 'tasks' },
  { label: 'Notes', segment: 'notes' },
  { label: 'Discussion', segment: 'discussion' },
  { label: 'Documents', segment: 'documents' },
  { label: 'Level history', segment: 'level-history' },
  { label: 'Ownership', segment: 'ownership-timeline' },
];

export function CompanyTabs({
  companyId,
  initialUnreadMentionCount,
}: {
  companyId: string;
  initialUnreadMentionCount: number;
}) {
  const pathname = usePathname();
  const base = `/companies/${companyId}`;

  // Live count for the Discussion tab. Server render seeds the state;
  // subscribing to the same unread-changed bus that decrements the
  // sidebar bell means MentionClearer's post-scroll markRead call
  // ripples here without any dedicated channel.
  const [mentionCount, setMentionCount] = useState(initialUnreadMentionCount);

  useEffect(() => {
    return subscribeUnreadChanged(() => {
      void getUnreadMentionCountForCompany(companyId)
        .then((n) => setMentionCount(n))
        .catch(() => {
          // RLS/auth blip — leave the count as-is; the next event or a
          // full page refresh will reconcile.
        });
    });
  }, [companyId]);

  return (
    <TabNav variant="underline">
      {TABS.map((tab) => {
        const href = tab.segment ? `${base}/${tab.segment}` : base;
        const active =
          tab.segment === ''
            ? pathname === base
            : pathname === href || pathname.startsWith(`${href}/`);
        const showBadge = tab.segment === 'discussion' && mentionCount > 0;
        return (
          <TabNavLink
            key={tab.segment}
            href={href as never}
            active={active}
            variant="underline"
          >
            <span className="inline-flex items-center gap-1.5">
              {tab.label}
              {showBadge && (
                <span
                  aria-label={`${mentionCount} unread mention${mentionCount === 1 ? '' : 's'}`}
                  className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-agsi-accent px-1.5 text-xxs font-semibold leading-4 text-white"
                >
                  {mentionCount > 99 ? '99+' : mentionCount}
                </span>
              )}
            </span>
          </TabNavLink>
        );
      })}
    </TabNav>
  );
}
