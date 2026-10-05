import React from 'react';
import { BookOpen, CloudOff, RefreshCw } from 'lucide-react';
import { cn } from '../../lib/utils';
import { COMPANY_CONTACT } from '../../config/contact';

interface StatusBarProps {
  isOnline: boolean;
  /** null while the first health check is in flight, false when it failed. */
  serverOk: boolean | null;
  serverMode?: string;
  pendingSyncCount: number;
  onOpenGuide: () => void;
}

declare const __APP_VERSION__: string;
const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '';

/*
 * The facts a shop floor needs before trusting the screen: is the server
 * reachable, is this the real dataset or the test one, and are there changes
 * made offline that have not reached the server yet.
 */
export const StatusBar: React.FC<StatusBarProps> = ({ isOnline, serverOk, serverMode, pendingSyncCount, onOpenGuide }) => {
  const state = !isOnline
    ? { dot: 'bg-status-critical', text: 'Offline — perubahan disimpan di perangkat ini' }
    : serverOk === false
      ? { dot: 'bg-status-critical', text: 'Server ERP tidak menjawab' }
      : serverOk === null
        ? { dot: 'bg-slate-300', text: 'Memeriksa server…' }
        : serverMode === 'test'
          ? { dot: 'bg-status-warning-strong', text: 'Terhubung · mode uji coba' }
          : { dot: 'bg-status-done', text: 'Semua sistem berjalan' };

  return (
    <footer className="hidden h-8 shrink-0 items-center gap-4 border-t border-border bg-white px-4 text-xs text-slate-600 md:flex">
      <span className="inline-flex items-center gap-2" role="status">
        <span className={cn('size-2 rounded-full', state.dot)} aria-hidden="true" />
        {!isOnline && <CloudOff size={13} aria-hidden="true" />}
        {state.text}
      </span>

      {pendingSyncCount > 0 && (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-status-warning-border bg-status-warning-bg px-2.5 py-0.5 font-semibold text-status-warning">
          <RefreshCw size={12} aria-hidden="true" className={cn(isOnline && 'animate-spin motion-reduce:animate-none')} />
          {pendingSyncCount} perubahan menunggu sinkron
        </span>
      )}

      <nav aria-label="Tautan bantuan" className="ml-auto flex items-center gap-4">
        <button type="button" onClick={onOpenGuide} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer">
          <BookOpen size={12} aria-hidden="true" /> Panduan
        </button>
        <a href={COMPANY_CONTACT.portalUrl} target="_blank" rel="noopener noreferrer" className="hover:text-foreground">
          Portal pelanggan
        </a>
        {APP_VERSION && <span className="font-mono text-slate-400">v{APP_VERSION}</span>}
      </nav>
    </footer>
  );
};
