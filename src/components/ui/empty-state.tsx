import Link from 'next/link';
import { cn } from '@/lib/utils';

type Action =
  | { label: string; href: string }
  | { label: string; onClick: () => void };

type Props = {
  title: string;
  description?: string;
  /** Optional next-step CTA. */
  action?: Action;
  /** Optional icon-as-text (single emoji-free glyph or letter pair). */
  icon?: React.ReactNode;
  className?: string;
};

/**
 * EmptyState — used wherever a list / page renders nothing actionable.
 * Includes a clear next-step CTA when one applies, so users aren't
 * left guessing what to do.
 */
export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: Props) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-agsi-lightGray bg-agsi-offWhite px-6 py-10 text-center',
        className,
      )}
    >
      {icon && (
        <div
          aria-hidden
          className="mb-1 flex h-10 w-10 items-center justify-center rounded-full bg-agsi-lightGray text-base font-semibold text-agsi-navy"
        >
          {icon}
        </div>
      )}
      <p className="text-sm font-semibold text-agsi-navy">{title}</p>
      {description && (
        <p className="max-w-md text-xs text-agsi-darkGray">{description}</p>
      )}
      {action && <ActionButton action={action} />}
    </div>
  );
}

function ActionButton({ action }: { action: Action }) {
  const className =
    'mt-2 inline-flex items-center rounded-lg bg-agsi-navy px-3 py-1.5 text-xs font-medium text-white hover:bg-agsi-blue';
  if ('href' in action) {
    return (
      <Link href={action.href as never} className={className}>
        {action.label}
      </Link>
    );
  }
  return (
    <button type="button" onClick={action.onClick} className={className}>
      {action.label}
    </button>
  );
}
