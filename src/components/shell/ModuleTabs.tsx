import React, { useEffect, useRef } from 'react';
import { Plus, Star, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { SOPModule } from '../../types';
import { navItem } from './nav';

interface ModuleTabsProps {
  tabs: SOPModule[];
  current: SOPModule;
  onSelect: (id: SOPModule) => void;
  onClose: (id: SOPModule) => void;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onNewTab: () => void;
}

/*
 * The pages a person is working between — an order, its SPK, the warehouse —
 * stay one click apart instead of a trip back through the menu. The dashboard
 * tab is permanent so there is always somewhere to land.
 */
export const ModuleTabs: React.FC<ModuleTabsProps> = ({
  tabs, current, onSelect, onClose, isFavorite, onToggleFavorite, onNewTab
}) => {
  const stripRef = useRef<HTMLDivElement>(null);

  // Keep the active tab in view when the strip scrolls.
  useEffect(() => {
    stripRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [current, tabs.length]);

  const currentLabel = navItem(current)?.label ?? current;

  return (
    <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border bg-white px-2 sm:px-3">
      <button
        type="button"
        onClick={onToggleFavorite}
        aria-pressed={isFavorite}
        aria-label={isFavorite ? `Hapus ${currentLabel} dari favorit` : `Tambahkan ${currentLabel} ke favorit`}
        title={isFavorite ? 'Hapus dari favorit' : 'Tambahkan ke favorit'}
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-muted cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal"
      >
        <Star size={17} className={cn(isFavorite && 'fill-status-warning-strong text-status-warning-strong')} />
      </button>

      <div ref={stripRef} role="tablist" aria-label="Halaman terbuka" className="no-scrollbar flex min-w-0 flex-1 items-stretch gap-0.5 self-stretch overflow-x-auto">
        {tabs.map(id => {
          const item = navItem(id);
          if (!item) return null;
          const Icon = item.icon;
          const active = id === current;
          const closable = id !== 'Dashboard';
          return (
            <div
              key={id}
              className={cn(
                'group relative flex shrink-0 items-center border-b-2',
                active ? 'border-brand-teal' : 'border-transparent'
              )}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onSelect(id)}
                onAuxClick={e => { if (e.button === 1 && closable) { e.preventDefault(); onClose(id); } }}
                className={cn(
                  'flex h-full items-center gap-2 rounded-t-lg pl-3 text-sm transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-teal',
                  closable ? 'pr-1.5' : 'pr-3',
                  active ? 'font-bold text-black' : 'font-medium text-slate-500 hover:bg-muted/60 hover:text-foreground'
                )}
              >
                <Icon size={15} aria-hidden="true" className={active ? 'text-brand-teal-dark' : ''} />
                <span className="max-w-[160px] truncate">{item.label}</span>
              </button>
              {closable && (
                <button
                  type="button"
                  onClick={() => onClose(id)}
                  aria-label={`Tutup tab ${item.label}`}
                  className={cn(
                    'mr-1 inline-flex size-6 items-center justify-center rounded-md text-slate-400 hover:bg-muted hover:text-foreground cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal',
                    !active && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                  )}
                >
                  <X size={13} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onNewTab}
        className="hidden h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-semibold text-slate-600 hover:border-brand-teal/50 hover:text-foreground sm:inline-flex cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal"
      >
        <Plus size={14} aria-hidden="true" /> Tab baru
      </button>
    </div>
  );
};
