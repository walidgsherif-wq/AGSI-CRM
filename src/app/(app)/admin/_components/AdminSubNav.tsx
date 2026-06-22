'use client';

import { usePathname } from 'next/navigation';
import { TabNav, TabNavLink } from '@/components/ui/tab-nav';
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
    <TabNav variant="pill">
      {ITEMS.map((i, idx) => (
        <TabNavLink
          key={i.href}
          href={i.href as never}
          active={idx === activeIndex}
          variant="pill"
        >
          {i.label}
        </TabNavLink>
      ))}
    </TabNav>
  );
}
