'use client';

import { usePathname } from 'next/navigation';
import { TabNav, TabNavLink } from '@/components/ui/tab-nav';

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
