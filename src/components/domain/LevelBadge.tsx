import type { Level } from '@/types/domain';
import { cn } from '@/lib/utils';

// L-level palette from prompt §15:
// L0 = midGray, L1 = accent, L2 = blue, L3 = green,
// L4 = purple, L5 = gold
const classes: Record<Level, string> = {
  L0: 'bg-agsi-midGray/40 text-agsi-darkGray',
  L1: 'bg-agsi-accent/10 text-agsi-accent',
  L2: 'bg-agsi-blue/10 text-agsi-blue',
  L3: 'bg-agsi-green/10 text-agsi-green',
  L4: 'bg-agsi-purple/10 text-agsi-purple',
  L5: 'bg-agsi-gold/20 text-agsi-navy',
};

export function LevelBadge({ level, className }: { level: Level; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold tabular',
        classes[level],
        className,
      )}
    >
      {level}
    </span>
  );
}
