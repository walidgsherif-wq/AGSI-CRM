'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const TABS = [
  { label: 'Overview', segment: '' },
  { label: 'Engagements', segment: 'engagements' },
  { label: 'Tasks', segment: 'tasks' },
  { label: 'Notes', segment: 'notes' },
  { label: 'Documents', segment: 'documents' },
  { label: 'Level history', segment: 'level-history' },
  { label: 'Ownership', segment: 'ownership-timeline' },
];

export function CompanyTabs({ companyId }: { companyId: string }) {
  const pathname = usePathname();
  const base = `/companies/${companyId}`;

  return (
    <nav className="flex gap-1 border-b border-agsi-lightGray">
      {TABS.map((tab) => {
        const href = tab.segment ? `${base}/${tab.segment}` : base;
        const active =
          tab.segment === ''
            ? pathname === base
            : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={tab.segment}
            href={href as never}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              active
                ? 'border-agsi-navy text-agsi-navy'
                : 'border-transparent text-agsi-darkGray hover:text-agsi-navy',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
