import React from 'react';
import { BookOpen, Star, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { SOPModule } from '../../types';
import { NavItem, NavSection } from './nav';

interface ModuleSidebarProps {
  /** Sections this account can see, each already filtered to permitted menus. */
  sections: NavSection[];
  /** Section whose menus fill the panel; follows the open page unless the rail picks another. */
  activeSection: string;
  onSelectSection: (title: string) => void;
  currentModule: SOPModule;
  onNavigate: (id: SOPModule) => void;
  favorites: NavItem[];
  badges: Partial<Record<SOPModule, number>>;
  userInitial: string;
  userName: string;
  onOpenProfile: () => void;
  onOpenGuide: () => void;
  /** Mobile drawer state; on large screens the panel is always shown. */
  isOpen: boolean;
  onClose: () => void;
}

const Badge: React.FC<{ count?: number }> = ({ count }) =>
  count ? (
    <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-brand-red px-1.5 text-[11px] font-bold leading-5 text-white tabular-nums">
      {count > 99 ? '99+' : count}
    </span>
  ) : null;

/*
 * Two columns, as in the reference layout: an icon rail that picks a part of
 * the factory, and a panel listing that part's menus. Twenty menus in one list
 * made people scroll to find Penjahitan; six rail buttons put any menu two
 * clicks away, and the favourites keep a person's daily pages one click away.
 */
export const ModuleSidebar: React.FC<ModuleSidebarProps> = ({
  sections, activeSection, onSelectSection, currentModule, onNavigate,
  favorites, badges, userInitial, userName, onOpenProfile, onOpenGuide, isOpen, onClose
}) => {
  const section = sections.find(s => s.title === activeSection) ?? sections[0];
  const sectionBadge = (s: NavSection) => s.items.reduce((n, i) => n + (badges[i.id] || 0), 0);

  const go = (id: SOPModule) => {
    onNavigate(id);
    onClose();
  };

  return (
    <>
      {isOpen && <div onClick={onClose} aria-hidden="true" className="fixed inset-0 z-40 bg-black/40 lg:hidden" />}

      <aside
        id="app-sidebar"
        aria-label="Navigasi"
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex shrink-0 bg-white transition-[translate,visibility] duration-200 ease-out lg:static lg:z-auto',
          isOpen ? 'translate-x-0' : 'max-lg:invisible -translate-x-full lg:translate-x-0'
        )}
      >
        {/* Icon rail */}
        <nav aria-label="Bagian kerja" className="flex w-[72px] shrink-0 flex-col items-center gap-1 border-r border-border py-3">
          {sections.map(s => {
            const Icon = s.icon;
            const selected = s.title === section?.title;
            const count = sectionBadge(s);
            return (
              <button
                key={s.title}
                type="button"
                onClick={() => onSelectSection(s.title)}
                aria-pressed={selected}
                title={s.title}
                className={cn(
                  'group relative flex w-16 flex-col items-center gap-1 rounded-xl px-0.5 py-2 text-[10px] tracking-tight font-semibold transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal',
                  selected ? 'bg-teal-50 text-brand-teal-dark' : 'text-slate-500 hover:bg-muted hover:text-foreground'
                )}
              >
                {selected && <span aria-hidden="true" className="absolute -left-1 top-2 bottom-2 w-1 rounded-r-full bg-brand-teal" />}
                <Icon size={20} aria-hidden="true" />
                <span className="w-full truncate text-center leading-tight">{s.short}</span>
                {count > 0 && (
                  <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-brand-red ring-2 ring-white" aria-label={`${count} perlu tindakan`} />
                )}
              </button>
            );
          })}

          <div className="mt-auto flex flex-col items-center gap-2 pt-3">
            <button
              type="button"
              onClick={() => { onOpenGuide(); onClose(); }}
              title="Panduan Alur"
              aria-label="Panduan Alur"
              className="flex size-10 items-center justify-center rounded-xl text-slate-500 hover:bg-muted hover:text-foreground cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal"
            >
              <BookOpen size={19} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={onOpenProfile}
              title={userName}
              aria-label={`Profil ${userName}`}
              className="flex size-10 items-center justify-center rounded-full border border-brand-teal-dark/20 bg-teal-50 text-sm font-extrabold text-brand-teal-dark cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal"
            >
              {userInitial}
            </button>
          </div>
        </nav>

        {/* Section panel */}
        <div className="flex w-60 flex-col border-r border-border">
          <div className="flex items-start justify-between gap-2 px-4 pb-2 pt-4">
            <div className="min-w-0">
              <div className="text-[11px] font-bold uppercase tracking-wider text-brand-teal-dark">Bagian</div>
              <div className="truncate text-[15px] font-extrabold text-foreground">{section?.title}</div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="-mr-1 inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted lg:hidden cursor-pointer"
              aria-label="Tutup menu"
            >
              <X size={18} />
            </button>
          </div>

          <nav aria-label={`Menu ${section?.title ?? ''}`} className="sidebar-scroll flex-1 overflow-y-auto overscroll-contain px-2.5 pb-4">
            <ul className="space-y-0.5">
              {section?.items.map(item => {
                const Icon = item.icon;
                const active = item.id === currentModule;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => go(item.id)}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal',
                        active ? 'bg-teal-50 font-bold text-black' : 'font-medium text-slate-700 hover:bg-muted hover:text-foreground'
                      )}
                    >
                      <Icon size={16} aria-hidden="true" className={cn('shrink-0', active ? 'text-brand-teal-dark' : 'text-slate-500')} />
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      <Badge count={badges[item.id]} />
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="mt-5 border-t border-border pt-4">
              <div className="flex items-center gap-1.5 px-2.5 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <Star size={12} aria-hidden="true" className="fill-status-warning-strong text-status-warning-strong" /> Favorit
              </div>
              {favorites.length === 0 ? (
                <p className="px-2.5 text-xs leading-relaxed text-muted-foreground">
                  Klik bintang di samping tab halaman untuk menyimpan menu yang sering dibuka.
                </p>
              ) : (
                <ul className="space-y-0.5">
                  {favorites.map(item => {
                    const Icon = item.icon;
                    const active = item.id === currentModule;
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => go(item.id)}
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal',
                            active ? 'bg-teal-50 font-bold text-black' : 'font-medium text-slate-700 hover:bg-muted'
                          )}
                        >
                          <Icon size={16} aria-hidden="true" className={cn('shrink-0', active ? 'text-brand-teal-dark' : 'text-slate-500')} />
                          <span className="min-w-0 flex-1 truncate">{item.label}</span>
                          <Badge count={badges[item.id]} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </nav>
        </div>
      </aside>
    </>
  );
};
