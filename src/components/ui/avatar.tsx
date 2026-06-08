import { cn } from '@/lib/utils';

// Reusable owner / profile avatar. Renders coloured initials today.
// When profiles.avatar_url lands (separate PR — see FX-022 PR notes),
// extend this with an optional `photoUrl` prop and prefer it over
// initials when present.
//
// Colour is hashed from the name so the same person always gets the
// same swatch across the app. Unassigned (no name) renders a neutral
// grey "?" placeholder, never a broken/empty avatar.

const PALETTE = [
  'bg-rose-500',
  'bg-amber-500',
  'bg-emerald-500',
  'bg-cyan-500',
  'bg-violet-500',
  'bg-fuchsia-500',
  'bg-indigo-500',
  'bg-teal-500',
] as const;

const SIZE_CLASSES = {
  xs: 'h-5 w-5 text-[9px]',
  sm: 'h-6 w-6 text-[10px]',
  md: 'h-8 w-8 text-xs',
  lg: 'h-10 w-10 text-sm',
} as const;

export type AvatarSize = keyof typeof SIZE_CLASSES;

function colorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({
  name,
  size = 'sm',
  title,
  className,
}: {
  name: string | null;
  size?: AvatarSize;
  /** Defaults to `name` (or "Unassigned") — pass a custom title to add
   *  context like "Owner: Jane Doe" on hover. */
  title?: string;
  className?: string;
}) {
  const sizeClass = SIZE_CLASSES[size];
  const effectiveTitle = title ?? name ?? 'Unassigned';

  if (!name || name.trim().length === 0) {
    return (
      <span
        className={cn(
          'inline-flex items-center justify-center rounded-full bg-agsi-lightGray text-agsi-darkGray font-semibold',
          sizeClass,
          className,
        )}
        title={effectiveTitle}
        aria-label={effectiveTitle}
      >
        ?
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-full text-white font-semibold',
        colorFor(name),
        sizeClass,
        className,
      )}
      title={effectiveTitle}
      aria-label={effectiveTitle}
    >
      {initialsFor(name)}
    </span>
  );
}
