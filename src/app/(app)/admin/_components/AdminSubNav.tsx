'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { navMatchScore } from '@/components/domain/Sidebar';

// Admin section sub-nav. Active-state logic mirrors the sidebar
// (longest matching prefix wins) so /admin/audit highlights "Audit
// log" even though it's three letters off /admin/users — and the
// active styling uses the same agsi-navy fill so the two navs read
// consistently.

const ITEMS = [
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/uploads', label: 'BNC Uploads' },
  { href: '/admin/companies/merge', label: 'Match queue' },
  { href: '/admin/level-requests', label: 'Level requests' },
  { href: '/admin/inbound-email', label: 'Inbound email' },
  { href: '/admin/targets', label: 'Targets' },
  { href: '/admin/ecosystem-rebuild', label: 'Ecosystem' },
  { href: '/admin/notifications-eval', label: 'Notifications eval' },
  { href: '/admin/rebar-prices', label: 'Rebar prices' },
  { href: '/admin/reports', label: 'Reports' },
  { href: '/admin/settings', label: 'Settings' },
  { href: '/admin/audit', label: 'Audit log' },
] as const;

export function AdminSubNav() {
  const pathname = usePathname();
  const scores = ITEMS.map((i) => navMatchScore(i.href, pathname));
  const maxScore = Math.max(...scores, 0);
  const activeIndex = maxScore > 0 ? scores.indexOf(maxScore) : -1;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-agsi-lightGray pb-3">
      {ITEMS.map((i, idx) => {
        const isActive = idx === activeIndex;
        return (
          <Link
            key={i.href}
            href={i.href as never}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
              isActive
                ? 'bg-agsi-navy text-white'
                : 'text-agsi-darkGray hover:bg-agsi-lightGray hover:text-agsi-navy',
            )}
          >
            {i.label}
          </Link>
        );
      })}
    </div>
  );
}
