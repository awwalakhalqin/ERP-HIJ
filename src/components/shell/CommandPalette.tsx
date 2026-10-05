import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, CornerDownLeft, ScanLine, Search, ShoppingCart, ClipboardList } from 'lucide-react';
import { useDialogFocus } from '../ui/useDialogFocus';
import { cn, statusLabel } from '../../lib/utils';
import type { Order, SOPModule, SPK } from '../../types';
import { NavItem } from './nav';

interface Entry {
  id: string;
  group: 'Menu' | 'Aksi' | 'Pesanan' | 'SPK';
  title: string;
  hint?: string;
  icon: React.ElementType;
  run: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  /** Menus this account may open — the search never offers a locked one. */
  items: NavItem[];
  orders: Order[];
  spks: SPK[];
  canOpen: (id: SOPModule) => boolean;
  onNavigate: (id: SOPModule) => void;
  onOpenScanner: () => void;
}

const norm = (s: unknown) => String(s ?? '').toLowerCase();

/*
 * One search box for the whole ERP: menus by name or SOP number, and orders or
 * SPKs by number, PO, customer or product. Picking a record opens the page that
 * owns it. Records come from the shell's attention read, so typing costs no
 * extra request.
 */
export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen, onClose, items, orders, spks, canOpen, onNavigate, onOpenScanner
}) => {
  const panelRef = useDialogFocus(isOpen, onClose);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setActive(0);
    }
  }, [isOpen]);

  const entries = useMemo<Entry[]>(() => {
    const q = norm(query).trim();
    const go = (id: SOPModule) => () => { onNavigate(id); onClose(); };

    const menu: Entry[] = items
      .filter(i => !q || norm(i.label).includes(q) || norm(i.id).includes(q))
      .map(i => ({ id: `m-${i.id}`, group: 'Menu', title: i.label, icon: i.icon, run: go(i.id) }));

    const actions: Entry[] = [
      { id: 'a-scan', group: 'Aksi' as const, title: 'Scan QR / barcode', hint: 'Bundel, SPK, pesanan, roll', icon: ScanLine, run: () => { onClose(); onOpenScanner(); } },
      ...(canOpen('Orders') ? [{ id: 'a-order', group: 'Aksi' as const, title: 'Buat pesanan baru', hint: 'Pesanan Masuk', icon: ShoppingCart, run: go('Orders') }] : []),
      ...(canOpen('DailyCash') ? [{ id: 'a-cash', group: 'Aksi' as const, title: 'Catat pengeluaran hari ini', hint: 'Catatan Keuangan Harian', icon: ClipboardList, run: go('DailyCash') }] : [])
    ].filter(a => !q || norm(a.title).includes(q) || norm(a.hint).includes(q));

    // Records only once something is typed; an empty box lists menus and actions.
    const records: Entry[] = q.length < 2 ? [] : [
      ...(canOpen('Orders') ? orders
        .filter(o => [o.id, o.po, o.customerName, o.productType].some(v => norm(v).includes(q)))
        .slice(0, 6)
        .map(o => ({
          id: `o-${o.id}`, group: 'Pesanan' as const,
          title: `${o.po || o.id} · ${o.customerName || 'Tanpa nama'}`,
          hint: `${o.productType || 'Garmen'} · ${statusLabel(o.status)}`,
          icon: ShoppingCart, run: go('Orders')
        })) : []),
      ...(canOpen('PPIC') ? spks
        .filter(s => [s.id, s.po, s.customerName, s.productName].some(v => norm(v).includes(q)))
        .slice(0, 6)
        .map(s => ({
          id: `s-${s.id}`, group: 'SPK' as const,
          title: `${s.id} · ${s.productName || 'SPK'}`,
          hint: `${s.customerName || ''} · ${s.progress || 0}%`,
          icon: ClipboardList, run: go('PPIC')
        })) : [])
    ];

    return [...menu, ...actions, ...records];
  }, [query, items, orders, spks, canOpen, onNavigate, onClose, onOpenScanner]);

  useEffect(() => { setActive(0); }, [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!isOpen) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(entries.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); entries[active]?.run(); }
  };

  let lastGroup = '';

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 px-3 pt-[12vh]" onMouseDown={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Cari di ERP"
        tabIndex={-1}
        onMouseDown={e => e.stopPropagation()}
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-white shadow-diffusion-lg focus:outline-none"
      >
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search size={18} className="shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            data-autofocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Cari menu, nomor pesanan, PO, SPK, pelanggan…"
            aria-label="Kata kunci"
            aria-controls="palette-list"
            aria-activedescendant={entries[active] ? `palette-${entries[active].id}` : undefined}
            className="h-14 w-full bg-transparent text-[15px] text-foreground placeholder:text-slate-400 focus:outline-none"
          />
          <kbd className="hidden shrink-0 rounded-md border border-border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground sm:block">Esc</kbd>
        </div>

        <ul id="palette-list" ref={listRef} role="listbox" className="max-h-[52vh] overflow-y-auto overscroll-contain p-2">
          {entries.length === 0 && (
            <li className="px-3 py-8 text-center text-sm text-muted-foreground">
              Tidak ada yang cocok dengan “{query}”.
            </li>
          )}
          {entries.map((entry, index) => {
            const header = entry.group !== lastGroup ? entry.group : null;
            lastGroup = entry.group;
            const Icon = entry.icon;
            const isActive = index === active;
            return (
              <React.Fragment key={entry.id}>
                {header && (
                  <li role="presentation" className="px-3 pb-1 pt-3 text-[11px] font-bold uppercase tracking-wider text-brand-teal-dark first:pt-1">
                    {header}
                  </li>
                )}
                <li
                  id={`palette-${entry.id}`}
                  role="option"
                  aria-selected={isActive}
                  data-index={index}
                  onMouseEnter={() => setActive(index)}
                  onClick={entry.run}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm',
                    isActive ? 'bg-teal-50 text-foreground' : 'text-slate-700'
                  )}
                >
                  <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg border',
                    isActive ? 'border-brand-teal/40 bg-white text-brand-teal-dark' : 'border-border bg-white text-slate-500')}>
                    <Icon size={16} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{entry.title}</span>
                    {entry.hint && <span className="block truncate text-xs text-muted-foreground">{entry.hint}</span>}
                  </span>
                  {isActive
                    ? <CornerDownLeft size={15} className="shrink-0 text-brand-teal-dark" aria-hidden="true" />
                    : <ArrowRight size={15} className="shrink-0 text-slate-300" aria-hidden="true" />}
                </li>
              </React.Fragment>
            );
          })}
        </ul>

        <div className="flex items-center gap-4 border-t border-border bg-slate-50/60 px-4 py-2 text-[11px] text-muted-foreground">
          <span><kbd className="font-mono">↑↓</kbd> pilih</span>
          <span><kbd className="font-mono">Enter</kbd> buka</span>
          <span className="ml-auto">Ketik minimal 2 huruf untuk mencari pesanan & SPK</span>
        </div>
      </div>
    </div>
  );
};
