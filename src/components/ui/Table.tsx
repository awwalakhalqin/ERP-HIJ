import React from 'react';
import { ChevronUp, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from './Button';

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
 * Breakpoint mengikuti lebar LAYAR, sedangkan sidebar memakan ±320px: di layar
 * 1366px tabel hanya dapat ±1050px, di 1440px ±1120px, dan konten dibatasi
 * 1600px. Tabel dengan 8 kolom atau lebih menaruh atribut sekundernya di `2xl`
 * atau `min-[1700px]` — datanya tetap ada di Detail. Target: tabel pas tanpa
 * geser mulai 1366px (diukur, bukan ditebak).
 *
 * Kolom identitas memakai `cell-sticky-start` dan kolom Aksi memakai
 * `cell-sticky-end` (lihat src/index.css) supaya keduanya tetap terlihat
 * ketika bagian tengah tabel digeser.
 *
 * Satu baris = satu baris teks. Sel tidak membungkus (`whitespace-nowrap`
 * bawaan TableCell); teks panjang (nama, produk, alamat) dipotong dengan
 * `block truncate max-w-[…]` plus `title` berisi teks lengkapnya.
 *
 * Angka dan uang rata kanan (`text-right tabular-nums`) di header maupun sel.
 * Status memakai `<StatusBadge size="sm" solid />`, header dan sel rata tengah.
 * Tanggal dan DeadlineBadge termasuk kelompok tanggal (mulai `lg`).
 *
 * Aksi: paling banyak dua aksi cepat lalu Detail, semuanya lewat
 * <RowActionButton> supaya ukuran dan gayanya sama di setiap halaman. Aksi yang
 * hanya ada di baris tidak pernah disembunyikan di layar kecil — yang
 * disembunyikan hanya labelnya. Aksi yang juga ada di footer Detail boleh
 * disembunyikan di bawah `sm` bila kolom status butuh tempatnya.
 * Tabel riwayat/rekap tanpa baris yang bisa dibuka boleh tanpa kolom Aksi.
 */

/*
 * The wrapper reports which edges still hide columns (`data-overflow-start`,
 * `data-overflow-end`). The sticky identity and Aksi columns draw a shadow only
 * on those edges, so a cell passing under them reads as "scroll for more"
 * rather than as a badge cut in half.
 */
function useScrollEdges() {
  const ref = React.useRef<HTMLDivElement>(null);
  const [edges, setEdges] = React.useState({ start: false, end: false });

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      const next = { start: el.scrollLeft > 1, end: max - el.scrollLeft > 1 };
      setEdges(prev => (prev.start === next.start && prev.end === next.end ? prev : next));
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    observer?.observe(el);
    if (el.firstElementChild) observer?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, []);

  return { ref, edges };
}

export const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => {
  const { ref: scrollRef, edges } = useScrollEdges();
  return (
    <div
      ref={scrollRef}
      className="table-scroll relative w-full overflow-x-auto"
      data-overflow-start={edges.start || undefined}
      data-overflow-end={edges.end || undefined}
    >
      <table
        ref={ref}
        className={cn('w-full caption-bottom text-sm text-left tabular-nums', className)}
        {...props}
      />
    </div>
  );
});
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
    className={cn('py-3 px-2.5 sm:px-3 2xl:px-4 align-middle whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0', className)}
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

interface RowActionButtonProps {
  /** The verb, e.g. "Bayar". Shown beside the icon from `sm` up when `labeled`. */
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  /** Fuller accessible name, e.g. "Bayar faktur INV-001". Defaults to `label`. */
  ariaLabel?: string;
  /** Tooltip. Defaults to `label`. */
  title?: string;
  /**
   * `icon`: square ghost button, for the everyday Ubah / Cetak / Hapus.
   * `labeled`: outline button with its verb, for the one action that moves the
   * row to its next step (Bayar, Periksa, Terbitkan SPK). The label collapses
   * to the icon on phones; the action itself never disappears.
   */
  display?: 'icon' | 'labeled';
  tone?: 'default' | 'primary' | 'danger';
  disabled?: boolean;
  className?: string;
}

const rowActionTone = {
  default: '',
  primary: 'text-brand-teal-dark hover:bg-teal-50 hover:text-brand-teal-dark',
  danger: 'text-brand-red hover:bg-rose-50 hover:text-brand-red'
};

/** The one quick-action button for table rows, so every table's Aksi column matches. */
export const RowActionButton: React.FC<RowActionButtonProps> = ({
  label,
  icon: Icon,
  onClick,
  ariaLabel,
  title,
  display = 'icon',
  tone = 'default',
  disabled,
  className
}) =>
  display === 'labeled' ? (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel || label}
      title={title || label}
      className={cn(
        'h-8 gap-1.5 px-2 text-xs sm:px-2.5',
        tone === 'primary' && 'border-brand-teal/50',
        rowActionTone[tone],
        className
      )}
    >
      <Icon size={14} aria-hidden="true" />
      <span className="hidden sm:inline">{label}</span>
    </Button>
  ) : (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel || label}
      title={title || label}
      className={cn('size-8', rowActionTone[tone], className)}
    >
      <Icon size={15} aria-hidden="true" />
    </Button>
  );

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

/*
 * Placeholder rows while table data loads. Each row is one cell spanning the
 * table: guessing which columns are visible at the current width used to put
 * more skeleton cells than headers, and the layout jumped when data arrived.
 */
export const TableSkeletonRows: React.FC<{ columns: number; rows?: number }> = ({ columns, rows = 4 }) => (
  <>
    {Array.from({ length: rows }).map((_, r) => (
      <tr key={r} aria-hidden="true" className="border-b border-border/70">
        <td colSpan={columns} className="py-3 px-2.5 sm:px-3 2xl:px-4">
          <div className="flex h-8 items-center gap-6">
            <div className="h-3.5 w-28 animate-pulse rounded bg-muted motion-reduce:animate-none" />
            <div className="h-3.5 w-40 animate-pulse rounded bg-muted motion-reduce:animate-none" />
            <div className="hidden h-3.5 w-24 animate-pulse rounded bg-muted motion-reduce:animate-none sm:block" />
            <div className="hidden h-3.5 w-20 animate-pulse rounded bg-muted motion-reduce:animate-none md:block" />
            <div className="ml-auto h-3.5 w-16 animate-pulse rounded bg-muted motion-reduce:animate-none" />
          </div>
        </td>
      </tr>
    ))}
  </>
);
