import Link from 'next/link';
import { requireRole } from '@/lib/auth/require-role';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireRole(['admin']);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 border-b border-agsi-lightGray pb-3">
        {[
          { href: '/admin/users', label: 'Users' },
          { href: '/admin/uploads', label: 'BNC Uploads' },
          { href: '/admin/companies/merge', label: 'Match queue' },
          { href: '/admin/level-requests', label: 'Level requests' },
          { href: '/admin/inbound-email', label: 'Inbound email' },
          { href: '/admin/targets', label: 'Targets' },
          { href: '/admin/reports', label: 'Reports' },
          { href: '/admin/settings', label: 'Settings' },
          { href: '/admin/audit', label: 'Audit log' },
        ].map((i) => (
          <Link
            key={i.href}
            href={i.href as never}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-agsi-darkGray hover:bg-agsi-lightGray hover:text-agsi-navy"
          >
            {i.label}
          </Link>
        ))}
      </div>
      {children}
    </div>
  );
}
