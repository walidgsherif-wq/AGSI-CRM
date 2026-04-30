import { Badge } from '@/components/ui/badge';

type Props = {
  /** Date the data is "as of" — typically the snapshot_date or computed_at. */
  asOf: string | null | undefined;
  /** Optional extra context, e.g. last upload time. */
  refreshedAt?: string | null;
  /** Tighter visual when used inline next to a heading. */
  compact?: boolean;
};

/**
 * "Data as of <date>" badge for snapshot-driven views (insights, dashboard,
 * leadership reports, ecosystem panel). Per architecture §17.7 it gives the
 * reader an unambiguous signal that the numbers are point-in-time, not live.
 */
export function DataFreshnessBadge({ asOf, refreshedAt, compact }: Props) {
  if (!asOf) {
    return (
      <Badge variant="amber" className={compact ? '!px-1.5 !py-0' : undefined}>
        No data yet
      </Badge>
    );
  }
  const ageDays = ageInDays(asOf);
  const tone =
    ageDays === null
      ? 'neutral'
      : ageDays <= 7
        ? 'green'
        : ageDays <= 30
          ? 'blue'
          : ageDays <= 90
            ? 'amber'
            : 'red';
  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-xs text-agsi-darkGray">
      <Badge variant={tone} className={compact ? '!px-1.5 !py-0' : undefined}>
        Data as of {fmt(asOf)}
      </Badge>
      {refreshedAt && (
        <span className="text-[11px]">
          last refresh {fmt(refreshedAt)}
        </span>
      )}
    </span>
  );
}

function fmt(iso: string): string {
  // Accepts dates (YYYY-MM-DD) or full ISO timestamps.
  try {
    const date = new Date(iso.length <= 10 ? `${iso}T00:00:00Z` : iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function ageInDays(iso: string): number | null {
  try {
    const date = new Date(iso.length <= 10 ? `${iso}T00:00:00Z` : iso);
    if (Number.isNaN(date.getTime())) return null;
    return Math.floor((Date.now() - date.getTime()) / 86_400_000);
  } catch {
    return null;
  }
}
