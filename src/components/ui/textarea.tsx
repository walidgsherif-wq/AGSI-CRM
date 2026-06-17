import * as React from 'react';
import { type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { inputVariants } from './input';

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement>,
    VariantProps<typeof inputVariants> {}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, tone, rows, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        rows={rows ?? 3}
        className={cn(inputVariants({ tone }), 'min-h-[72px]', className)}
        {...props}
      />
    );
  },
);
Textarea.displayName = 'Textarea';
