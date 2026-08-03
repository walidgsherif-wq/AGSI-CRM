'use client';

import { usePathname } from 'next/navigation';
import { TabNav, TabNavLink } from '@/components/ui/tab-nav';

const TABS = [
  { label: 'Overview', segment: '' },
  { label: 'Engagements', segment: 'engagements' },
  { label: 'Tasks', segment: 'tasks' },
  { label: 'Notes', segment: 'notes' },
  { label: 'Documents', segment: 'documents' },
  { label: 'Level history', segment: 'level-history' },
  { label: 'Ownership', segment: 'ownership-timeline' },
];

/**
 * Discussion used to be an entry here (#157). It moved to the
 * persistent right rail; the tab bar keeps the record-focused tabs
 * only. The mention-count badge that briefly lived on this bar
 * (#158) re-homes to the rail's own chrome — one source of truth
 * for the count in the visible surface.
 */
export function CompanyTabs({ companyId }: { companyId: string }) {
  const pathname = usePathname();
  const base = `/companies/${companyId}`;

  return (
    <TabNav variant="underline">
      {TABS.map((tab) => {
        const href = tab.segment ? `${base}/${tab.segment}` : base;
        const active =
          tab.segment === ''
            ? pathname === base
            : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <TabNavLink
            key={tab.segment}
            href={href as never}
            active={active}
            variant="underline"
          >
            {tab.label}
          </TabNavLink>
        );
      })}
    </TabNav>
  );
}
