import * as React from 'react';
import { cn } from '@/lib/utils';

// Thin styled wrappers for <table>. No external dep, no sort/pagination
// — those build on top later if needed. The goal here is to lock the
// border/typography/padding pattern used across the app's 25+
// hand-rolled tables into one place so a future style tweak is a
// one-component edit, not an N-file sweep.
//
// Convention:
//   <Table>
//     <THead>
//       <TR head>
//         <TH>…</TH>
//       </TR>
//     </THead>
//     <TBody>
//       <TR>
//         <TD>…</TD>
//       </TR>
//     </TBody>
//   </Table>
//
// `<TR head>` switches the row to header styling (uppercase, smaller
// text, darker border). `<TR>` alone is a body row with a subtle
// bottom rule.

export const Table = React.forwardRef<
  HTMLTableElement,
  React.TableHTMLAttributes<HTMLTableElement> & { wrapperClassName?: string }
>(({ className, wrapperClassName, ...props }, ref) => (
  <div className={cn('overflow-x-auto', wrapperClassName)}>
    <table ref={ref} className={cn('w-full text-sm', className)} {...props} />
  </div>
));
Table.displayName = 'Table';

export const THead = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={className} {...props} />
));
THead.displayName = 'THead';

export const TBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={className} {...props} />
));
TBody.displayName = 'TBody';

export interface TRProps extends React.HTMLAttributes<HTMLTableRowElement> {
  /** Header row styling: uppercase, darker bottom border, smaller text. */
  head?: boolean;
}

export const TR = React.forwardRef<HTMLTableRowElement, TRProps>(
  ({ className, head, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        head
          ? 'border-b border-agsi-lightGray text-left text-xs uppercase tracking-wider text-agsi-darkGray'
          : 'border-b border-agsi-lightGray/50',
        className,
      )}
      {...props}
    />
  ),
);
TR.displayName = 'TR';

export const TH = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th ref={ref} className={cn('py-2 font-medium', className)} {...props} />
));
TH.displayName = 'TH';

export const TD = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td ref={ref} className={cn('py-3', className)} {...props} />
));
TD.displayName = 'TD';
