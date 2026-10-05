import React from 'react';
import { ArrowRight, Check, ChevronsRight, NotebookPen, ScanLine, ShoppingCart, BookOpen } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { SOPModule } from '../../types';
import type { AttentionItem } from './useWorkspaceSignals';

interface AttentionPanelProps {
  attention: AttentionItem[];
  loaded: boolean;
  canOpen: (id: SOPModule) => boolean;
  onNavigate: (id: SOPModule) => void;
  onOpenScanner: () => void;
  onCollapse: () => void;
}

/*
 * The right-hand column of the dashboard: what is waiting on someone today,
 * scored as "beres" so the morning check reads as a short list to clear, and
 * the handful of things people start most often.
 */
export const AttentionPanel: React.FC<AttentionPanelProps> = ({
  attention, loaded, canOpen, onNavigate, onOpenScanner, onCollapse
}) => {
  const done = attention.filter(a => a.count === 0).length;
  const pct = attention.length ? Math.round((done / attention.length) * 100) : 0;

  const actions = [
    canOpen('Orders') && { label: 'Pesanan baru', icon: ShoppingCart, run: () => onNavigate('Orders') },
    { label: 'Scan QR', icon: ScanLine, run: onOpenScanner },
    canOpen('DailyCash') && { label: 'Catat pengeluaran', icon: NotebookPen, run: () => onNavigate('DailyCash') },
    { label: 'Panduan alur', icon: BookOpen, run: () => onNavigate('HowItWorks') }
  ].filter(Boolean) as { label: string; icon: React.ElementType; run: () => void }[];

  return (
    <aside aria-label="Perlu tindakan" className="hidden w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l border-border bg-white p-4 xl:flex">
      <section className="rounded-xl border border-border p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-foreground">Perlu tindakan hari ini</h2>
            <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
              {loaded ? `${done} dari ${attention.length} beres` : 'Memeriksa…'}
            </p>
          </div>
          <button
            type="button"
            onClick={onCollapse}
            title="Sembunyikan panel"
            aria-label="Sembunyikan panel perlu tindakan"
            className="-mr-1 -mt-1 inline-flex size-8 items-center justify-center rounded-lg text-slate-400 hover:bg-muted hover:text-foreground cursor-pointer"
          >
            <ChevronsRight size={16} />
          </button>
        </div>

        <div
          role="progressbar"
          aria-label="Perlu tindakan yang sudah beres"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"
        >
          <div className="h-full rounded-full bg-brand-teal transition-[width] duration-500" style={{ width: `${loaded ? pct : 0}%` }} />
        </div>

        <ul className="mt-3 space-y-1">
          {attention.map(item => {
            const clear = item.count === 0;
            const allowed = canOpen(item.module);
            return (
              <li key={item.key}>
                <button
                  type="button"
                  disabled={!allowed}
                  onClick={() => onNavigate(item.module)}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-muted disabled:cursor-default disabled:hover:bg-transparent cursor-pointer"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex size-5 shrink-0 items-center justify-center rounded-md border',
                      clear ? 'border-brand-teal-dark bg-brand-teal-dark text-white' : 'border-slate-300 bg-white'
                    )}
                  >
                    {clear && <Check size={13} strokeWidth={3} />}
                  </span>
                  <span className={cn('min-w-0 flex-1', clear ? 'text-muted-foreground' : 'font-medium text-foreground')}>
                    {clear ? item.doneLabel : (
                      <>
                        <span className={cn('font-extrabold tabular-nums', item.tone === 'critical' ? 'text-status-critical' : 'text-status-warning')}>
                          {item.count}
                        </span>{' '}
                        {item.label}
                      </>
                    )}
                  </span>
                  {!clear && allowed && <ArrowRight size={14} className="shrink-0 text-slate-400" aria-hidden="true" />}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="rounded-xl border border-border p-4">
        <h2 className="text-sm font-bold text-foreground">Aksi cepat</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {actions.map(a => {
            const Icon = a.icon;
            return (
              <button
                key={a.label}
                type="button"
                onClick={a.run}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:border-brand-teal/60 hover:bg-teal-50 hover:text-brand-teal-dark cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal"
              >
                <Icon size={14} aria-hidden="true" /> {a.label}
              </button>
            );
          })}
        </div>
      </section>
    </aside>
  );
};
