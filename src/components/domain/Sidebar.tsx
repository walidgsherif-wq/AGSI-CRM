'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  KanbanSquare,
  Building2,
  FolderKanban,
  CheckSquare,
  LineChart,
  Map as MapIcon,
  FileText,
  Shield,
  Settings,
  LogOut,
  type LucideIcon,
} from 'lucide-react';
import type { Role } from '@/types/domain';
import { ROLE_LABEL } from '@/types/domain';
import { cn } from '@/lib/utils';
import { DevRoleSwitcher } from './DevRoleSwitcher';
import { NotificationBell } from './NotificationBell';

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  roles: Role[];
};

const NAV: NavItem[] = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    roles: ['admin', 'leadership', 'bd_head', 'bd_manager'],
  },
  {
    href: '/pipeline',
    label: 'Pipeline',
    icon: KanbanSquare,
    roles: ['admin', 'bd_head', 'bd_manager'],
  },
  {
    href: '/companies',
    label: 'Companies',
    icon: Building2,
    roles: ['admin', 'leadership', 'bd_head', 'bd_manager'],
  },
  {
    href: '/projects',
    label: 'Projects',
    icon: FolderKanban,
    roles: ['admin', 'leadership', 'bd_head', 'bd_manager'],
  },
  {
    href: '/tasks',
    label: 'Tasks',
    icon: CheckSquare,
    roles: ['admin', 'bd_head', 'bd_manager'],
  },
  {
    href: '/insights',
    label: 'Insights',
    icon: LineChart,
    roles: ['admin', 'leadership', 'bd_head', 'bd_manager'],
  },
  {
    href: '/insights/maps/geographic',
    label: 'Maps',
    icon: MapIcon,
    roles: ['admin', 'leadership', 'bd_head'],
  },
  {
    href: '/reports',
    label: 'Reports',
    icon: FileText,
    roles: ['admin', 'leadership', 'bd_head'],
  },
  {
    href: '/settings/notifications',
    label: 'Settings',
    icon: Settings,
    roles: ['admin', 'leadership', 'bd_head', 'bd_manager'],
  },
  {
    href: '/admin/users',
    label: 'Admin',
    icon: Shield,
    roles: ['admin'],
  },
];

export function Sidebar({ role, fullName, email }: { role: Role; fullName: string; email: string }) {
  const pathname = usePathname();
  const items = NAV.filter((i) => i.roles.includes(role));

  return (
    <aside className="flex h-screen w-64 flex-col border-r border-agsi-lightGray bg-white">
      <div className="flex items-center gap-3 px-6 pt-6 pb-8">
        <div
          aria-hidden
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-agsi-navy text-sm font-bold text-white"
        >
          AG
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-agsi-navy">AGSI CRM</span>
          <span className="text-xs text-agsi-darkGray">Business Development</span>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {items.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== '/dashboard' && pathname.startsWith(item.href));
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href as never}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-agsi-offWhite text-agsi-navy'
                  : 'text-agsi-darkGray hover:bg-agsi-offWhite hover:text-agsi-navy',
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-agsi-lightGray p-4">
        <div className="flex items-center gap-3">
          <div
            aria-hidden
            className="flex h-8 w-8 items-center justify-center rounded-full bg-agsi-lightGray text-xs font-semibold text-agsi-navy"
          >
            {initials(fullName)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-agsi-navy">{fullName}</p>
            <p className="truncate text-xs text-agsi-darkGray">{ROLE_LABEL[role]}</p>
          </div>
        </div>
        <p className="mt-2 truncate text-xs text-agsi-darkGray" title={email}>
          {email}
        </p>
        <div className="mt-3">
          <NotificationBell />
        </div>
        <form action="/auth/signout" method="post" className="mt-2">
          <button
            type="submit"
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium text-agsi-darkGray hover:bg-agsi-offWhite hover:text-agsi-navy"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden />
            Sign out
          </button>
        </form>
        {process.env.NODE_ENV !== 'production' ? (
          <DevRoleSwitcher currentRole={role} />
        ) : null}
      </div>
    </aside>
  );
}

function initials(name: string) {
  return name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
