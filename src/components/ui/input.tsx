import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// Shared with select.tsx + textarea.tsx so all three controls render the
// same border, focus ring, disabled, and readonly treatments.
export const inputVariants = cva(
  [
    'w-full rounded-lg border bg-white px-3 py-2 text-sm text-agsi-navy',
    'placeholder:text-agsi-midGray transition-colors',
    'focus:outline-none focus:ring-1',
    'disabled:cursor-not-allowed disabled:bg-agsi-lightGray/40 disabled:text-agsi-darkGray',
    'read-only:cursor-not-allowed read-only:bg-agsi-lightGray/40 read-only:text-agsi-darkGray',
  ].join(' '),
  {
    variants: {
      tone: {
        default:
          'border-agsi-midGray focus:border-agsi-accent focus:ring-agsi-accent',
        error: 'border-rag-red focus:border-rag-red focus:ring-rag-red',
      },
    },
    defaultVariants: { tone: 'default' },
  },
);

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement>,
    VariantProps<typeof inputVariants> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, tone, type, ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type ?? 'text'}
        className={cn(inputVariants({ tone }), className)}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';
