import Link from 'next/link';
import { requireFeature } from '@/lib/auth/features';

export default async function MapsLayout({ children }: { children: React.ReactNode }) {
  // §7.5: heat maps blocked for bd_manager by default; per-user
  // overrides managed at /admin/users.
  await requireFeature('insights_maps');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 border-b border-agsi-lightGray pb-3">
        <Link
          href="/insights/maps/geographic"
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-agsi-darkGray hover:bg-agsi-lightGray hover:text-agsi-navy"
        >
          Geographic
        </Link>
        <Link
          href="/insights/maps/level-distribution"
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-agsi-darkGray hover:bg-agsi-lightGray hover:text-agsi-navy"
        >
          Level distribution
        </Link>
        <Link
          href="/insights/maps/engagement-freshness"
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-agsi-darkGray hover:bg-agsi-lightGray hover:text-agsi-navy"
        >
          Engagement freshness
        </Link>
      </div>
      {children}
    </div>
  );
}
