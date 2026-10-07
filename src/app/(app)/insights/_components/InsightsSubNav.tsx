import Link from 'next/link';

/**
 * Small horizontal tab-strip surfacing the Insights sub-routes.
 * Lives below the page H1 so the user can jump between Market
 * snapshot (the /insights root), Engagement (added in Phase 1a),
 * and the existing Maps / Ecosystem sub-pages. Not represented in
 * the global sidebar for Engagement or Ecosystem — those are only
 * reachable via this strip (and the Maps sidebar entry for Maps).
 */
export type InsightsTab = 'market' | 'engagement' | 'maps' | 'ecosystem';

const TABS: Array<{ key: InsightsTab; label: string; href: string }> = [
  { key: 'market', label: 'Market snapshot', href: '/insights' },
  { key: 'engagement', label: 'Engagement', href: '/insights/engagement' },
  { key: 'maps', label: 'Maps', href: '/insights/maps/geographic' },
  { key: 'ecosystem', label: 'Ecosystem', href: '/insights/ecosystem' },
];

export function InsightsSubNav({ active }: { active: InsightsTab }) {
  return (
    <nav
      aria-label="Insights sections"
      className="flex flex-wrap items-center gap-1 border-b border-agsi-lightGray pb-2 text-sm"
    >
      {TABS.map((t) => {
        const isActive = t.key === active;
        return (
          <Link
            key={t.key}
            href={t.href as never}
            className={
              isActive
                ? 'rounded bg-agsi-navy px-3 py-1 font-medium text-white'
                : 'rounded px-3 py-1 text-agsi-navy hover:bg-agsi-lightGray/40'
            }
            aria-current={isActive ? 'page' : undefined}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
