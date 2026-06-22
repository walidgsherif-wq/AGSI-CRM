'use client';

import * as React from 'react';
import Link from 'next/link';

type LinkComponentProps = React.ComponentProps<typeof Link>;
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// Two styles in active use:
//   - underline: tabs within a page section (CompanyTabs).
//   - pill:      section-level navigation (AdminSubNav).
//
// Container wraps the row; Item is the link. Caller computes `active`
// for each item — the primitive doesn't try to be clever about
// pathname matching, since the two consumers use very different
// strategies (segment compare vs. navMatchScore longest-prefix).

const tabNavRoot = cva('', {
  variants: {
    variant: {
      underline: 'flex gap-1 border-b border-agsi-lightGray',
      pill: 'flex flex-wrap items-center gap-2 border-b border-agsi-lightGray pb-3',
    },
  },
  defaultVariants: { variant: 'underline' },
});

const tabNavItem = cva('transition-colors', {
  variants: {
    variant: {
      underline:
        '-mb-px border-b-2 px-3 py-2 text-sm font-medium',
      pill: 'rounded-lg px-3 py-1.5 text-sm font-medium',
    },
    active: {
      true: '',
      false: '',
    },
  },
  compoundVariants: [
    {
      variant: 'underline',
      active: true,
      className: 'border-agsi-navy text-agsi-navy',
    },
    {
      variant: 'underline',
      active: false,
      className: 'border-transparent text-agsi-darkGray hover:text-agsi-navy',
    },
    {
      variant: 'pill',
      active: true,
      className: 'bg-agsi-navy text-white',
    },
    {
      variant: 'pill',
      active: false,
      className: 'text-agsi-darkGray hover:bg-agsi-lightGray hover:text-agsi-navy',
    },
  ],
  defaultVariants: { variant: 'underline', active: false },
});

type RootVariantProps = VariantProps<typeof tabNavRoot>;

export type TabNavVariant = NonNullable<RootVariantProps['variant']>;

interface TabNavProps
  extends React.HTMLAttributes<HTMLElement>,
    RootVariantProps {}

export function TabNav({ className, variant, ...props }: TabNavProps) {
  return <nav className={cn(tabNavRoot({ variant }), className)} {...props} />;
}

interface TabNavLinkProps extends LinkComponentProps {
  active?: boolean;
  variant?: TabNavVariant;
}

export function TabNavLink({
  className,
  active = false,
  variant = 'underline',
  ...props
}: TabNavLinkProps) {
  return (
    <Link
      aria-current={active ? 'page' : undefined}
      className={cn(tabNavItem({ variant, active }), className)}
      {...props}
    />
  );
}
