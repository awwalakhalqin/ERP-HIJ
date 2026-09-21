import React from 'react';
import { ChevronUp } from 'lucide-react';
import { cn } from '../../lib/utils';

/*
 * ATURAN TABEL: satu kolom = satu field.
 *
 * Setiap field punya <TableHead> dan <TableCell> sendiri. Dilarang menumpuk
 * field kedua sebagai sub-baris di dalam sel (mis. ID dengan tanggal di
 * bawahnya, atau nama pelanggan dengan produk di bawahnya). Satu baris = satu
 * record, satu kolom = satu field, sama seperti tabel database — supaya tiap
 * field bisa diurutkan, difilter, dan dilacak sendiri-sendiri.
 *
 * Urutan kolom: identitas, relasi/nama, angka, tanggal, status, Aksi.
 *
 * Layar sempit ditangani dengan MENYEMBUNYIKAN kolom (`hidden md:table-cell`),
 * bukan menggabungkannya kembali. Prioritas tampil: identitas, status, dan
 * Aksi selalu ada; uang dan kuantitas mulai `sm`; nama dan relasi mulai `md`;
 * tanggal mulai `lg`; atribut sekunder mulai `xl`.
 *
 * Kolom identitas memakai `cell-sticky-start` dan kolom Aksi memakai
 * `cell-sticky-end` (lihat src/index.css) supaya keduanya tetap terlihat
 * ketika bagian tengah tabel digeser.
 */

export const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => (
  <div className="relative w-full overflow-x-auto">
    <table
      ref={ref}
      className={cn('w-full caption-bottom text-sm text-left tabular-nums', className)}
      {...props}
    />
  </div>
));
Table.displayName = 'Table';

export const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn('[&_tr]:border-b [&_tr]:bg-muted border-border text-muted-foreground font-semibold text-xs', className)} {...props} />
));
TableHeader.displayName = 'TableHeader';

export const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn('[&_tr:last-child]:border-0 divide-y divide-border/60 font-medium text-foreground', className)}
    {...props}
  />
));
TableBody.displayName = 'TableBody';

export const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn(
      'border-t border-border bg-muted/40 font-medium [&>tr]:last:border-b-0 text-muted-foreground',
      className
    )}
    {...props}
  />
));
TableFooter.displayName = 'TableFooter';

export const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      'border-b border-border/70 bg-card transition-colors hover:bg-row-hover data-[state=selected]:bg-accent',
      className
    )}
    {...props}
  />
));
TableRow.displayName = 'TableRow';

export const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, scope = 'col', ...props }, ref) => (
  <th
    ref={ref}
    scope={scope}
    className={cn(
      'h-11 px-2.5 sm:px-3 2xl:px-4 text-left align-middle text-xs font-semibold text-muted-foreground whitespace-nowrap [&:has([role=checkbox])]:pr-0',
      className
    )}
    {...props}
  />
));
TableHead.displayName = 'TableHead';

export const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn('py-3 px-2.5 sm:px-3 2xl:px-4 align-middle text-foreground [&:has([role=checkbox])]:pr-0', className)}
    {...props}
  />
));
TableCell.displayName = 'TableCell';

export const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn('mt-4 text-xs text-muted-foreground', className)}
    {...props}
  />
));
TableCaption.displayName = 'TableCaption';

export type SortDirection = 'asc' | 'desc';

export interface SortState<K extends string = string> {
  key: K;
  direction: SortDirection;
}

interface SortableHeadProps<K extends string = string>
  extends React.ThHTMLAttributes<HTMLTableCellElement> {
  /** The field this column sorts by. */
  sortKey: K;
  sort: SortState<K>;
  onSortChange: (sort: SortState<K>) => void;
  /** Right-align numeric and date columns. */
  align?: 'left' | 'right' | 'center';
  children: React.ReactNode;
}

/** Column header that sorts the table, with the direction announced. */
export function TableSortHead<K extends string = string>({
  sortKey,
  sort,
  onSortChange,
  align = 'left',
  className,
  children,
  ...props
}: SortableHeadProps<K>) {
  const active = sort.key === sortKey;
  const direction = active ? sort.direction : undefined;

  return (
    <TableHead
      aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn(align === 'right' && 'text-right', align === 'center' && 'text-center', className)}
      {...props}
    >
      <button
        type="button"
        onClick={() =>
          onSortChange({ key: sortKey, direction: active && sort.direction === 'asc' ? 'desc' : 'asc' })
        }
        className={cn(
          'inline-flex cursor-pointer items-center gap-1 rounded text-xs font-semibold transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal',
          active ? 'text-foreground' : 'text-muted-foreground',
          align === 'right' && 'flex-row-reverse'
        )}
      >
        <span>{children}</span>
        <ChevronUp
          size={13}
          aria-hidden="true"
          className={cn(
            'transition-transform',
            !active && 'opacity-30',
            direction === 'desc' && 'rotate-180'
          )}
        />
      </button>
    </TableHead>
  );
}

/** Sort a list by one field, with dates, numbers and text handled sensibly. */
export function sortRows<T>(rows: T[], sort: SortState, read: (row: T, key: string) => unknown): T[] {
  const factor = sort.direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = read(a, sort.key);
    const right = read(b, sort.key);

    // Empty values always sink to the bottom, whichever way the column is sorted.
    const leftEmpty = left === undefined || left === null || left === '';
    const rightEmpty = right === undefined || right === null || right === '';
    if (leftEmpty && rightEmpty) return 0;
    if (leftEmpty) return 1;
    if (rightEmpty) return -1;

    if (typeof left === 'number' && typeof right === 'number') return (left - right) * factor;
    return String(left).localeCompare(String(right), 'id') * factor;
  });
}

/** Right-aligned cluster for the last column: row quick action(s) + Detail. */
export const TableRowActions: React.FC<{ className?: string; children: React.ReactNode }> = ({
  className,
  children
}) => <div className={cn('flex items-center justify-end gap-1.5', className)}>{children}</div>;

interface TableEmptyRowProps {
  colSpan: number;
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

/** Empty state that explains what belongs in the table and how to add it. */
export const TableEmptyRow: React.FC<TableEmptyRowProps> = ({ colSpan, icon, title, description, action }) => (
  <tr>
    <td colSpan={colSpan} className="px-4 py-14">
      <div className="mx-auto flex max-w-sm flex-col items-center gap-2 text-center">
        {icon && (
          <div className="mb-1 flex size-11 items-center justify-center rounded-xl bg-muted text-brand-teal-dark" aria-hidden="true">
            {icon}
          </div>
        )}
        <p className="text-sm font-bold text-foreground">{title}</p>
        {description && <p className="text-sm text-muted-foreground text-pretty">{description}</p>}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </td>
  </tr>
);

/** Placeholder rows while table data loads. */
export const TableSkeletonRows: React.FC<{ columns: number; rows?: number }> = ({ columns, rows = 4 }) => (
  <>
    {Array.from({ length: rows }).map((_, r) => (
      <tr key={r} aria-hidden="true" className="border-b border-border/70">
        {Array.from({ length: columns }).map((_, c) => (
          <td
            key={c}
            className={cn('px-2.5 sm:px-4 py-3.5', c > 1 && c < columns - 1 && 'hidden sm:table-cell')}
          >
            <div
              className={cn(
                'h-3.5 animate-pulse rounded bg-muted motion-reduce:animate-none',
                c === 0 ? 'w-28' : c === columns - 1 ? 'ml-auto w-16' : 'w-20'
              )}
            />
          </td>
        ))}
      </tr>
    ))}
  </>
);
