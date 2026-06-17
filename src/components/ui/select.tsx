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
        className={cn(inputVariants({ tone }), 'pr-8', className)}
        {...props}
      >
        {children}
      </select>
    );
  },
);
Select.displayName = 'Select';
