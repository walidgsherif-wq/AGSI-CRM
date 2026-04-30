import { cn } from '@/lib/utils';

/**
 * Skeleton — a shimmering grey block used as a placeholder while
 * server-component data loads (Next.js loading.tsx). Inherits whatever
 * size/shape the consumer sets via className. Default has rounded
 * corners + a 1.6s pulse animation.
 */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-md bg-agsi-lightGray',
        className,
      )}
      {...props}
      aria-hidden
    />
  );
}
