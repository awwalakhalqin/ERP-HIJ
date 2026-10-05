import React, { useEffect, useRef, useState } from 'react';
import {
  Bell, BookOpen, CheckCircle2, ChevronDown, LogOut, Menu, ScanLine, Search, User as UserIcon, UserCog, X, ArrowRight
} from 'lucide-react';
import { cn } from '../../lib/utils';
import type { SOPModule, User } from '../../types';
import type { AttentionItem } from './useWorkspaceSignals';

interface TopBarProps {
  user: User;
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  onOpenSearch: () => void;
  onOpenScanner: () => void;
  onOpenProfile: () => void;
  onNavigate: (id: SOPModule) => void;
  onLogout: () => void;
  canManageAccounts: boolean;
  attention: AttentionItem[];
  attentionTotal: number;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** Closes a popover on outside click and Escape. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

const iconButton =
  'relative inline-flex size-10 items-center justify-center rounded-xl text-slate-600 transition-colors hover:bg-muted hover:text-foreground cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal';

export const TopBar: React.FC<TopBarProps> = ({
  user, isSidebarOpen, onToggleSidebar, onOpenSearch, onOpenScanner, onOpenProfile,
  onNavigate, onLogout, canManageAccounts, attention, attentionTotal
}) => {
  const bell = usePopover();
  const account = usePopover();
  const initial = user.name ? user.name.charAt(0).toUpperCase() : 'U';

  return (
    <header className="relative z-30 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-white pl-2 pr-3 sm:pr-4 lg:pl-0">
      <button
        onClick={onToggleSidebar}
        className={cn(iconButton, 'lg:hidden')}
        aria-label={isSidebarOpen ? 'Tutup menu' : 'Buka menu'}
        aria-expanded={isSidebarOpen}
        aria-controls="app-sidebar"
      >
        {isSidebarOpen ? <X size={22} /> : <Menu size={22} />}
      </button>

      {/* Brand block lines up with rail + section panel on large screens. */}
      <div className="flex min-w-0 items-center gap-2.5 lg:w-[312px] lg:shrink-0 lg:pl-4">
        <img src="/logo.png" alt="" className="size-9 shrink-0 rounded-lg border border-border bg-white object-contain p-1" />
        <div className="min-w-0 leading-tight">
          <div className="truncate text-[15px] font-extrabold tracking-tight text-black">HIJ Konveksi</div>
          <div className="truncate text-[11px] font-semibold text-muted-foreground">PT Hasil Inti Jualan</div>
        </div>
      </div>

      {/* Global search */}
      <button
        type="button"
        onClick={onOpenSearch}
        className="hidden h-10 w-full max-w-md items-center gap-2.5 rounded-xl border border-border bg-slate-50/70 px-3 text-left text-sm text-slate-500 transition-colors hover:border-brand-teal/50 hover:bg-white md:flex cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal"
        aria-label="Cari menu, pesanan, atau SPK"
      >
        <Search size={16} aria-hidden="true" className="shrink-0" />
        <span className="flex-1 truncate">Cari menu, pesanan, SPK…</span>
        <kbd className="shrink-0 rounded-md border border-border bg-white px-1.5 py-0.5 font-mono text-[11px] text-slate-500">
          {isMac ? '⌘' : 'Ctrl'} K
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-1 sm:gap-1.5">
        <button type="button" onClick={onOpenSearch} className={cn(iconButton, 'md:hidden')} aria-label="Cari">
          <Search size={19} />
        </button>

        <button type="button" onClick={() => onNavigate('HowItWorks')} className={cn(iconButton, 'hidden sm:inline-flex')} aria-label="Panduan Alur" title="Panduan Alur">
          <BookOpen size={19} />
        </button>

        {/* Notifications: the same attention list as the dashboard panel. */}
        <div className="relative" ref={bell.ref}>
          <button
            type="button"
            onClick={() => bell.setOpen(o => !o)}
            className={iconButton}
            aria-expanded={bell.open}
            aria-haspopup="true"
            aria-label={attentionTotal > 0 ? `${attentionTotal} hal perlu tindakan` : 'Notifikasi'}
            title="Perlu tindakan"
          >
            <Bell size={19} />
            {attentionTotal > 0 && (
              <span className="absolute right-1 top-1 inline-flex min-w-[18px] items-center justify-center rounded-full bg-brand-red px-1 text-[10px] font-bold leading-[18px] text-white ring-2 ring-white tabular-nums">
                {attentionTotal > 99 ? '99+' : attentionTotal}
              </span>
            )}
          </button>
          {bell.open && (
            <div className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-1.5rem)] rounded-2xl border border-border bg-white p-2 shadow-diffusion-lg">
              <div className="px-3 pb-2 pt-1.5 text-sm font-bold text-foreground">Perlu tindakan</div>
              <ul className="space-y-0.5">
                {attention.map(item => (
                  <li key={item.key}>
                    <button
                      type="button"
                      onClick={() => { bell.setOpen(false); onNavigate(item.module); }}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-muted cursor-pointer"
                    >
                      {item.count > 0 ? (
                        <span className={cn(
                          'inline-flex min-w-7 items-center justify-center rounded-lg px-1.5 py-0.5 text-xs font-extrabold tabular-nums',
                          item.tone === 'critical' ? 'bg-status-critical-bg text-status-critical' : 'bg-status-warning-bg text-status-warning'
                        )}>
                          {item.count}
                        </span>
                      ) : (
                        <CheckCircle2 size={18} className="mx-1 shrink-0 text-status-done" aria-hidden="true" />
                      )}
                      <span className={cn('min-w-0 flex-1', item.count === 0 && 'text-muted-foreground')}>
                        {item.count > 0 ? item.label : item.doneLabel}
                      </span>
                      {item.count > 0 && <ArrowRight size={15} className="shrink-0 text-slate-400" aria-hidden="true" />}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onOpenScanner}
          className="ml-1 inline-flex h-10 items-center gap-1.5 rounded-xl bg-brand-teal-dark px-3 text-sm font-bold text-white transition-colors hover:bg-[#0e5662] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black"
          aria-label="Scan QR"
        >
          <ScanLine size={16} aria-hidden="true" />
          <span className="hidden md:inline">Scan QR</span>
        </button>

        {/* Account */}
        <div className="relative ml-1" ref={account.ref}>
          <button
            type="button"
            onClick={() => account.setOpen(o => !o)}
            className="inline-flex h-10 items-center gap-2 rounded-xl pl-1 pr-2 transition-colors hover:bg-muted cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal"
            aria-expanded={account.open}
            aria-haspopup="true"
            aria-label={`Menu akun ${user.name}`}
          >
            <span className="flex size-8 items-center justify-center rounded-full bg-brand-teal text-sm font-extrabold text-black">{initial}</span>
            <span className="hidden text-left sm:block">
              <span className="block max-w-[140px] truncate text-xs font-bold leading-tight text-black">{user.name}</span>
              <span className="block text-[10px] font-semibold leading-tight text-brand-teal-dark">{user.role}</span>
            </span>
            <ChevronDown size={14} aria-hidden="true" className={cn('text-slate-500 transition-transform', account.open && 'rotate-180')} />
          </button>

          {account.open && (
            <div className="absolute right-0 top-full mt-2 w-72 max-w-[calc(100vw-1.5rem)] rounded-2xl border border-border bg-white p-2 text-black shadow-diffusion-lg">
              <div className="mb-2 rounded-xl border border-teal-200/70 bg-teal-50/60 p-3">
                <div className="flex items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-teal text-base font-extrabold text-black">{initial}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold">{user.name}</div>
                    <div className="truncate font-mono text-xs text-slate-500">@{user.username}</div>
                  </div>
                </div>
                <div className="mt-2.5 flex items-center justify-between border-t border-teal-200/60 pt-2">
                  <span className="text-[11px] font-medium text-slate-600">Peran Staff</span>
                  <span className="rounded-md bg-brand-teal-dark px-2 py-0.5 text-[11px] font-bold text-white">{user.role}</span>
                </div>
              </div>

              <div className="space-y-1 text-sm">
                <button
                  onClick={() => { account.setOpen(false); onOpenProfile(); }}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left font-semibold hover:bg-teal-50 hover:text-brand-teal-dark cursor-pointer"
                >
                  <UserIcon size={16} className="text-brand-teal-dark" /> Profil Akun
                </button>
                {canManageAccounts && (
                  <button
                    onClick={() => { account.setOpen(false); onNavigate('Accounts'); }}
                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left font-semibold hover:bg-teal-50 hover:text-brand-teal-dark cursor-pointer"
                  >
                    <UserCog size={16} className="text-brand-teal-dark" /> Kelola Akun & Hak Akses
                  </button>
                )}
                <button
                  onClick={() => { account.setOpen(false); onNavigate('HowItWorks'); }}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left font-semibold hover:bg-teal-50 hover:text-brand-teal-dark cursor-pointer"
                >
                  <BookOpen size={16} className="text-brand-teal-dark" /> Panduan Alur Kerja
                </button>
              </div>

              <div className="my-1.5 border-t border-border" />

              <button
                onClick={() => { account.setOpen(false); onLogout(); }}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-bold text-brand-red hover:bg-rose-50 cursor-pointer"
              >
                <LogOut size={16} /> Keluar dari Sistem
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
