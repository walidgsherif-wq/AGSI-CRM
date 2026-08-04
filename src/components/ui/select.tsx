import * as React from 'react';
import { type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { inputVariants } from './input';

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement>,
    VariantProps<typeof inputVariants> {}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, tone, children, ...props }, ref) => {
    return (
      <select
        ref={ref}
        className={cn(
          inputVariants({ tone }),
          // A <select> is always a click target when enabled — force
          // the pointer cursor explicitly so browser default cursors
          // (arrow / text) don't leak through from parent CSS or
          // Tailwind preflight version drift. disabled:cursor-not-
          // allowed from inputVariants still wins when the select
          // is actually disabled.
          'cursor-pointer pr-8 hover:border-agsi-navy',
          className,
        )}
        {...props}
      >
        {children}
      </select>
    );
  },
);
Select.displayName = 'Select';
