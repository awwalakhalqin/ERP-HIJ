import React, { useId, useRef } from 'react';
import { Eye, X } from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { cn } from '../../lib/utils';
import { Button } from './Button';
import { useDialogFocus } from './useDialogFocus';

/*
 * Row inspector for data tables. Tables show only the columns people scan by;
 * everything else about a row lives here, opened from <RowDetailButton>.
 *
 *   const [detail, setDetail] = useState<Item | null>(null);
 *   ...
 *   <RowDetailButton label={item.id} onClick={() => setDetail(item)} />
 *   ...
 *   <DetailDrawer isOpen={!!detail} onClose={() => setDetail(null)} title={detail?.name} ...>
 *     {detail && (
 *       <DetailSection title="Produksi">
 *         <DetailField label="Operator">{detail.operator}</DetailField>
 *       </DetailSection>
 *     )}
 *   </DetailDrawer>
 */

interface DetailDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  /** Record name, e.g. customer or product name. */
  title: React.ReactNode;
  /** Secondary identity line, e.g. document number and date. */
  subtitle?: React.ReactNode;
  /** Status badge shown beside the subtitle. */
  status?: React.ReactNode;
  /** Row actions (edit, print, delete) pinned to the bottom of the panel. */
  footer?: React.ReactNode;
  size?: 'md' | 'lg';
  children: React.ReactNode;
}

interface DrawerContent {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  status?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

export const DetailDrawer: React.FC<DetailDrawerProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  status,
  footer,
  size = 'md',
  children
}) => {
  const titleId = useId();
  const reduceMotion = useReducedMotion();
  const panelRef = useDialogFocus(isOpen, onClose);

  // Callers usually clear the selected row on close. Keep the last content so
  // the panel slides out with its data instead of collapsing to an empty box.
  const lastContent = useRef<DrawerContent>({ title, subtitle, status, footer, children });
  if (isOpen) {
    lastContent.current = { title, subtitle, status, footer, children };
  }
  const content = lastContent.current;

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            aria-hidden="true"
            className="absolute inset-0 bg-[#0a1414]/40"
          />

          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            initial={reduceMotion ? { opacity: 0 } : { x: '100%' }}
            animate={reduceMotion ? { opacity: 1 } : { x: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { x: '100%' }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              'relative flex h-dvh w-full flex-col bg-card text-foreground shadow-[-12px_0_40px_-12px_rgba(0,0,0,0.25)] outline-none sm:border-l sm:border-border',
              size === 'lg' ? 'sm:max-w-xl' : 'sm:max-w-md'
            )}
          >
            <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
              <div className="min-w-0 space-y-1.5">
                <h2 id={titleId} className="text-lg font-bold leading-snug text-foreground text-balance break-words">
                  {content.title || 'Detail'}
                </h2>
                {(content.subtitle || content.status) && (
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-sm text-muted-foreground">
                    {content.subtitle}
                    {content.status}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Tutup detail"
                className="-mr-1.5 inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain px-5 divide-y divide-border">
              {content.children}
            </div>

            {content.footer && (
              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-muted/40 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                {content.footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

interface DetailSectionProps {
  title?: string;
  className?: string;
  children: React.ReactNode;
}

/** A titled group of fields. Sections are separated by hairlines. */
export const DetailSection: React.FC<DetailSectionProps> = ({ title, className, children }) => (
  <section className={cn('py-5', className)}>
    {title && <h3 className="mb-3 text-sm font-bold text-foreground">{title}</h3>}
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5">{children}</dl>
  </section>
);

/** Free-form block inside the drawer body (lists, images, notes). */
export const DetailBlock: React.FC<DetailSectionProps> = ({ title, className, children }) => (
  <section className={cn('py-5', className)}>
    {title && <h3 className="mb-3 text-sm font-bold text-foreground">{title}</h3>}
    {children}
  </section>
);

const isEmptyValue = (value: React.ReactNode) =>
  value === null || value === undefined || value === '' || value === false;

interface DetailFieldProps {
  label: string;
  /** Span both columns, for long text such as addresses and notes. */
  full?: boolean;
  /** Codes, document numbers and measurements. */
  mono?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export const DetailField: React.FC<DetailFieldProps> = ({ label, full, mono, className, children }) => (
  <div className={cn('min-w-0', full && 'col-span-2', className)}>
    <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
    <dd
      className={cn(
        'mt-0.5 text-sm font-semibold text-foreground break-words',
        mono && 'font-mono text-[13px] font-medium'
      )}
    >
      {isEmptyValue(children) ? <span className="font-normal text-muted-foreground">Tidak dicatat</span> : children}
    </dd>
  </div>
);

interface DetailStatsProps {
  items: { label: string; value: React.ReactNode; tone?: 'default' | 'danger' | 'accent' }[];
}

/** Two to three headline numbers for the record (totals, balances, quantities). */
export const DetailStats: React.FC<DetailStatsProps> = ({ items }) => (
  <div className="py-5">
    <dl
      className={cn(
        'grid gap-px overflow-hidden rounded-xl border border-border bg-border',
        items.length >= 3 ? 'grid-cols-3' : 'grid-cols-2'
      )}
    >
      {items.map(item => (
        <div key={item.label} className="min-w-0 bg-card px-3 py-2.5">
          <dt className="truncate text-xs font-medium text-muted-foreground">{item.label}</dt>
          <dd
            className={cn(
              'mt-0.5 text-sm font-bold tabular-nums break-words',
              item.tone === 'danger' && 'text-brand-red',
              item.tone === 'accent' && 'text-brand-teal-dark',
              (!item.tone || item.tone === 'default') && 'text-foreground'
            )}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  </div>
);

interface RowDetailButtonProps {
  /** Row identity for the accessible name, e.g. "INV-001". */
  label: string;
  onClick: () => void;
  className?: string;
}

/** The single entry point from a table row into its DetailDrawer. */
export const RowDetailButton: React.FC<RowDetailButtonProps> = ({ label, onClick, className }) => (
  <Button
    type="button"
    variant="outline"
    size="sm"
    onClick={onClick}
    aria-label={`Lihat detail ${label}`}
    title="Lihat semua data baris ini"
    className={cn('h-8 gap-1.5 px-2 text-xs sm:px-2.5', className)}
  >
    <Eye size={14} aria-hidden="true" />
    <span className="hidden sm:inline">Detail</span>
  </Button>
);
