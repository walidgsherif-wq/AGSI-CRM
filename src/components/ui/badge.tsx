import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
  {
    variants: {
      variant: {
        neutral: 'bg-agsi-lightGray text-agsi-darkGray',
        blue: 'bg-agsi-accent/10 text-agsi-accent',
        green: 'bg-agsi-green/10 text-agsi-green',
        amber: 'bg-rag-amber/15 text-rag-amber',
        red: 'bg-rag-red/10 text-rag-red',
        purple: 'bg-agsi-purple/10 text-agsi-purple',
        gold: 'bg-agsi-gold/15 text-agsi-navy',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
