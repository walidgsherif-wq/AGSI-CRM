import { Skeleton } from '@/components/ui/skeleton';

/**
 * Default loading state for any (app)/* route that doesn't ship its
 * own loading.tsx. A pair of header bars + three card-shaped blocks
 * is generic enough for most data-heavy pages.
 */
export default function AppLoading() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
