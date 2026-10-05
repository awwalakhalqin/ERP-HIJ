import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { logoutApi, getAuthToken, AUTH_EXPIRED_EVENT } from './services/api';
import { setAuthToken } from './services/api';
import { ScanLine, ChevronsLeft } from 'lucide-react';
import { SOPModule, AuthSession, User } from './types';
import { db, syncOfflineQueue, clearCachedMirror } from './db/dexie';
// Common Components
import { LoginModal } from './components/common/LoginModal';
import { isPortalSite } from './lib/site';
import { PWAInstallBanner } from './components/common/PWAInstallBanner';
import { Modal } from './components/ui/Modal';
import { Button } from './components/ui/Button';
import { Toast, useToast } from './components/ui/Toast';
// Application shell
import { NAV_SECTIONS, ALL_NAV_ITEMS, canUserOpenModule, navItem, sectionOf } from './components/shell/nav';
import { useWorkspaceSignals } from './components/shell/useWorkspaceSignals';
import { ModuleSidebar } from './components/shell/ModuleSidebar';
import { TopBar } from './components/shell/TopBar';
import { ModuleTabs } from './components/shell/ModuleTabs';
import { StatusBar } from './components/shell/StatusBar';
import { AttentionPanel } from './components/shell/AttentionPanel';
import { CommandPalette } from './components/shell/CommandPalette';
const ScannerModal = React.lazy(() => import('./components/common/ScannerModal').then(m => ({ default: m.ScannerModal })));

// Customer Portal (Code-Split)
const CustomerPortal = React.lazy(() => import('./components/customer/CustomerPortal').then(m => ({ default: m.CustomerPortal })));

// Internal ERP Modules (SOP 01 - 20) - Lazy Loaded for Maximum Performance
import { DashboardModule } from './components/modules/DashboardModule'; // Loaded directly for instant FCP
const CustomersModule = React.lazy(() => import('./components/modules/CustomersModule').then(m => ({ default: m.CustomersModule })));
const QuotationsModule = React.lazy(() => import('./components/modules/QuotationsModule').then(m => ({ default: m.QuotationsModule })));
const OrdersModule = React.lazy(() => import('./components/modules/OrdersModule').then(m => ({ default: m.OrdersModule })));
const DesignSampleModule = React.lazy(() => import('./components/modules/DesignSampleModule').then(m => ({ default: m.DesignSampleModule })));
const PPICModule = React.lazy(() => import('./components/modules/PPICModule').then(m => ({ default: m.PPICModule })));
const ProcurementModule = React.lazy(() => import('./components/modules/ProcurementModule').then(m => ({ default: m.ProcurementModule })));
const RawMaterialModule = React.lazy(() => import('./components/modules/RawMaterialModule').then(m => ({ default: m.RawMaterialModule })));
const PatternGradingModule = React.lazy(() => import('./components/modules/PatternGradingModule').then(m => ({ default: m.PatternGradingModule })));
const CuttingModule = React.lazy(() => import('./components/modules/CuttingModule').then(m => ({ default: m.CuttingModule })));
const BundleTrackingModule = React.lazy(() => import('./components/modules/BundleTrackingModule').then(m => ({ default: m.BundleTrackingModule })));
const SewingModule = React.lazy(() => import('./components/modules/SewingModule').then(m => ({ default: m.SewingModule })));
const QCModule = React.lazy(() => import('./components/modules/QCModule').then(m => ({ default: m.QCModule })));
const PackagingModule = React.lazy(() => import('./components/modules/PackagingModule').then(m => ({ default: m.PackagingModule })));
const ReturnsModule = React.lazy(() => import('./components/modules/ReturnsModule').then(m => ({ default: m.ReturnsModule })));
const ShippingModule = React.lazy(() => import('./components/modules/ShippingModule').then(m => ({ default: m.ShippingModule })));
const HRPayrollModule = React.lazy(() => import('./components/modules/HRPayrollModule').then(m => ({ default: m.HRPayrollModule })));
const FinanceModule = React.lazy(() => import('./components/modules/FinanceModule').then(m => ({ default: m.FinanceModule })));
const AccountsModule = React.lazy(() => import('./components/modules/AccountsModule').then(m => ({ default: m.AccountsModule })));
const DailyCashModule = React.lazy(() => import('./components/modules/DailyCashModule').then(m => ({ default: m.DailyCashModule })));
const HowItWorksModule = React.lazy(() => import('./components/modules/HowItWorksModule').then(m => ({ default: m.HowItWorksModule })));

// Lightweight Skeleton for smooth transitions between modules
const ModuleLoadingFallback: React.FC = () => (
  <div className="bg-card rounded-2xl p-6 sm:p-8 border border-border shadow-xs space-y-4 animate-pulse">
    <div className="flex items-center justify-between pb-4 border-b border-border">
      <div className="space-y-2">
        <div className="h-6 w-48 bg-muted rounded-md" />
        <div className="h-3.5 w-72 bg-muted/60 rounded-md" />
      </div>
      <div className="h-9 w-24 bg-muted rounded-xl" />
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
      <div className="h-20 bg-muted/60 rounded-xl" />
      <div className="h-20 bg-muted/60 rounded-xl" />
      <div className="h-20 bg-muted/60 rounded-xl" />
    </div>
    <div className="h-56 bg-muted/30 rounded-xl border border-border mt-4" />
  </div>
);

/** Which page this tab was on, kept per tab so two tabs can sit on different pages. */
const ACTIVE_MODULE_KEY = 'hij_active_module';
/** The page tabs open in this browser tab. */
const OPEN_TABS_KEY = 'hij_open_tabs';
/** Whether the dashboard's attention column is shown; a per-device preference. */
const ATTENTION_PANEL_KEY = 'hij_attention_panel';
const MAX_TABS = 8;

const readStaffUser = (): User | undefined => {
  const session = JSON.parse(localStorage.getItem('hij_auth_session') || 'null') as AuthSession | null;
  // Only staff navigate these modules, and permissions may have changed since.
  return session && session.type !== 'customer' ? session.user : undefined;
};

/*
 * Reopen the page the user was on. A reload should not cost them their place:
 * the browser may refresh for a new app version, a dropped connection, or a
 * stray F5 in the middle of typing an order.
 */
const restoreActiveModule = (): SOPModule => {
  try {
    const saved = sessionStorage.getItem(ACTIVE_MODULE_KEY) as SOPModule | null;
    if (!saved) return 'Dashboard';
    return canUserOpenModule(readStaffUser(), saved) ? saved : 'Dashboard';
  } catch {
    return 'Dashboard';
  }
};

const restoreOpenTabs = (): SOPModule[] => {
  try {
    const saved = JSON.parse(sessionStorage.getItem(OPEN_TABS_KEY) || '[]') as SOPModule[];
    const user = readStaffUser();
    const allowed = saved.filter(id => navItem(id) && id !== 'Dashboard' && canUserOpenModule(user, id));
    return (['Dashboard', ...allowed] as SOPModule[]).slice(0, MAX_TABS);
  } catch {
    return ['Dashboard'];
  }
};

const favoritesKey = (user?: User) => `hij_favorites_${user?.id || user?.username || 'anon'}`;

const loadFavorites = (user?: User): SOPModule[] => {
  try {
    return JSON.parse(localStorage.getItem(favoritesKey(user)) || '[]');
  } catch {
    return [];
  }
};

export const App: React.FC = () => {
  // Authentication session state
  const [session, setSession] = useState<AuthSession | null>(() => {
    try {
      const saved = localStorage.getItem('hij_auth_session');
      if (!saved) return null;
      /*
       * Sessions stored before the API required a signed token would restore
       * fine and then have every request rejected, leaving the app looking
       * empty instead of logged out. No token means no session.
       */
      if (!getAuthToken()) {
        localStorage.removeItem('hij_auth_session');
        return null;
      }
      const restored = JSON.parse(saved) as AuthSession;
      // A staff session has no business on the portal host, nor a customer one on the ERP.
      if ((isPortalSite && restored.type !== 'customer') || (!isPortalSite && restored.type !== 'internal')) {
        localStorage.removeItem('hij_auth_session');
        setAuthToken(undefined);
        return null;
      }
      return restored;
    } catch {
      return null;
    }
  });

  // Navigation state
  const [currentModule, setCurrentModule] = useState<SOPModule>(restoreActiveModule);
  const [openTabs, setOpenTabs] = useState<SOPModule[]>(restoreOpenTabs);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  /* The rail can show another section's menus without leaving the current page. */
  const [railSection, setRailSection] = useState<string>(() => sectionOf(restoreActiveModule())?.title ?? NAV_SECTIONS[0].title);
  const [showAttentionPanel, setShowAttentionPanel] = useState<boolean>(() => {
    try {
      return localStorage.getItem(ATTENTION_PANEL_KEY) !== '0';
    } catch {
      return true;
    }
  });

  /*
   * Which dataset the API behind this page is serving. Typing an afternoon of
   * trial orders into production because the two look identical is the failure
   * this guards against, so the answer is shown, not assumed.
   */
  const [serverMode, setServerMode] = useState<{ mode: string; dataDir: string } | null>(null);
  const [serverOk, setServerOk] = useState<boolean | null>(null);
  const checkHealth = useCallback(() => {
    // Plain fetch: /api/health needs no session, and a failure here is not a login problem.
    return fetch('/api/health')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        setServerOk(!!d);
        if (d?.mode) setServerMode({ mode: d.mode, dataDir: d.dataDir });
      })
      .catch(() => setServerOk(false));
  }, []);
  useEffect(() => {
    checkHealth();
    const id = setInterval(checkHealth, 60_000);
    return () => clearInterval(id);
  }, [checkHealth]);

  // Connectivity & Offline Queue State
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);

  // Staff previewing customer portal state
  const [previousStaffUser, setPreviousStaffUser] = useState<User | null>(null);

  // Global QR / Barcode Scanner Modal
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scanNotification, setScanNotification] = useState<string | null>(null);

  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);

  const staffUser = session?.type === 'internal' ? session.user : undefined;
  const isStaffSession = session?.type === 'internal';

  // Favourite menus belong to the person, so they survive logout on a shared PC.
  const [favorites, setFavorites] = useState<SOPModule[]>(() => loadFavorites(staffUser));
  useEffect(() => {
    setFavorites(loadFavorites(staffUser));
  }, [staffUser?.id, staffUser?.username]);

  const signals = useWorkspaceSignals(isStaffSession);

  // Escape closes the mobile sidebar
  useEffect(() => {
    if (!isSidebarOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsSidebarOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isSidebarOpen]);

  // Ctrl+K / ⌘K opens the search from anywhere in the ERP.
  useEffect(() => {
    if (!isStaffSession) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsPaletteOpen(open => !open);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isStaffSession]);

  // Each module opens at the top, with its name in the browser tab
  useEffect(() => {
    try {
      sessionStorage.setItem(ACTIVE_MODULE_KEY, currentModule);
    } catch {
      // Private browsing can refuse storage; only the restore-after-reload is lost.
    }
    mainRef.current?.scrollTo({ top: 0 });
    const label = navItem(currentModule)?.label ?? null;
    document.title = label ? `${label} · HIJ Konveksi` : 'HIJ Konveksi';
    const section = sectionOf(currentModule);
    if (section) setRailSection(section.title);
  }, [currentModule]);

  useEffect(() => {
    try {
      sessionStorage.setItem(OPEN_TABS_KEY, JSON.stringify(openTabs));
    } catch {
      // Only the restore-after-reload is lost.
    }
  }, [openTabs]);

  const { toast, showToast } = useToast();

  // Network listener, queue counter, and replay of writes made while offline
  useEffect(() => {
    let cancelled = false;
    let replaying = false;

    const checkQueue = async () => {
      try {
        /*
         * Queue rows carry `synced: false`; a boolean is not an IndexedDB key,
         * so the indexed lookup this replaced always counted zero.
         */
        const count = await db.offlineQueue.filter(item => !item.synced).count();
        if (!cancelled) setPendingSyncCount(count);
      } catch {
        // Dexie unavailable (private mode); the counter simply stays at zero.
      }
    };

    const replayQueue = async () => {
      // Only staff writes are queued, and the server needs their token to accept them.
      if (replaying || !navigator.onLine || !isStaffSession) return;
      replaying = true;
      try {
        const { syncedCount, failed } = await syncOfflineQueue();
        await checkQueue();
        if (cancelled) return;
        if (failed.length > 0) {
          showToast(
            `${failed.length} perubahan offline ditolak server: ${failed[0].error}`,
            'error'
          );
        } else if (syncedCount > 0) {
          showToast(`${syncedCount} perubahan offline berhasil dikirim ke server.`);
        }
      } catch {
        // Dexie unavailable; nothing was queued to begin with.
      } finally {
        replaying = false;
      }
    };

    const handleOnline = () => {
      setIsOnline(true);
      checkHealth();
      replayQueue();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    checkQueue();
    replayQueue();
    const interval = setInterval(checkQueue, 4000);

    return () => {
      cancelled = true;
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, [isStaffSession, showToast, checkHealth]);

  /*
   * Rows mirrored in IndexedDB belong to whoever fetched them. When the session
   * ends they are dropped, so the next person at a shared PC starts empty
   * instead of seeing the previous user's orders while offline.
   */
  const forgetSession = () => {
    localStorage.removeItem('hij_auth_session');
    try {
      sessionStorage.removeItem(ACTIVE_MODULE_KEY);
      sessionStorage.removeItem(OPEN_TABS_KEY);
    } catch {
      // Nothing to clean up if storage is unavailable.
    }
    setOpenTabs(['Dashboard']);
    clearCachedMirror().catch(() => {});
  };

  const handleLoginSuccess = (newSession: AuthSession) => {
    setSession(newSession);
    setPreviousStaffUser(null);
    try {
      localStorage.setItem('hij_auth_session', JSON.stringify(newSession));
    } catch (err) {
      console.error('Storage error:', err);
    }
    setOpenTabs(['Dashboard']);
    setCurrentModule('Dashboard');
  };

  const handleLogout = () => {
    setSession(null);
    setPreviousStaffUser(null);
    setCurrentModule('Dashboard');
    forgetSession();
    // The signed token outlives the session object unless it is cleared too.
    logoutApi();
  };

  /*
   * The API raises this when it rejects the session mid-use — a lapsed token,
   * or a deleted account. Showing the login screen is the honest response;
   * leaving the shell up would render every list empty instead.
   */
  useEffect(() => {
    const onExpired = () => {
      setSession(null);
      setPreviousStaffUser(null);
      setCurrentModule('Dashboard');
      forgetSession();
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, []);

  const canOpenModule = useCallback((id: SOPModule) => canUserOpenModule(staffUser, id), [staffUser]);

  /*
   * Every route into a module goes through here — sidebar, tabs, search,
   * dashboard tiles, the scanner, the flow guide — so a hidden menu item cannot
   * be reached through a side door, and the refusal reads the same everywhere.
   */
  const navigateTo = useCallback((module: SOPModule) => {
    if (!canUserOpenModule(staffUser, module)) {
      showToast('Anda tidak punya akses ke menu ini', 'error');
      return;
    }
    setOpenTabs(tabs => {
      if (tabs.includes(module)) return tabs;
      const next = [...tabs, module];
      // Past the limit the oldest tab goes, never the dashboard.
      while (next.length > MAX_TABS) next.splice(1, 1);
      return next;
    });
    setCurrentModule(module);
  }, [staffUser, showToast]);

  const closeTab = (module: SOPModule) => {
    if (module === 'Dashboard') return;
    const index = openTabs.indexOf(module);
    const next = openTabs.filter(t => t !== module);
    setOpenTabs(next.length ? next : ['Dashboard']);
    // Closing the page in view lands on its left neighbour, as browsers do.
    if (module === currentModule) setCurrentModule(next[Math.max(0, index - 1)] ?? 'Dashboard');
  };

  const toggleFavorite = () => {
    setFavorites(list => {
      const next = list.includes(currentModule) ? list.filter(m => m !== currentModule) : [...list, currentModule];
      try {
        localStorage.setItem(favoritesKey(staffUser), JSON.stringify(next));
      } catch {
        // Favourites simply do not persist on this device.
      }
      return next;
    });
  };

  const toggleAttentionPanel = (show: boolean) => {
    setShowAttentionPanel(show);
    try {
      localStorage.setItem(ATTENTION_PANEL_KEY, show ? '1' : '0');
    } catch {
      // Preference is kept for this visit only.
    }
  };

  const openScanner = useCallback(() => setIsScannerOpen(true), []);
  const closePalette = useCallback(() => setIsPaletteOpen(false), []);

  const permittedSections = useMemo(
    () => NAV_SECTIONS
      .map(section => ({ ...section, items: section.items.filter(item => canOpenModule(item.id)) }))
      .filter(section => section.items.length > 0),
    [canOpenModule]
  );
  const permittedItems = useMemo(() => ALL_NAV_ITEMS.filter(i => canOpenModule(i.id)), [canOpenModule]);
  const favoriteItems = useMemo(
    () => favorites.map(id => navItem(id)).filter(i => i && canOpenModule(i.id)) as typeof ALL_NAV_ITEMS,
    [favorites, canOpenModule]
  );

  const handlePreviewCustomer = (customer: any) => {
    if (session?.type === 'internal') {
      setPreviousStaffUser(session.user);
    }
    setSession({
      type: 'customer',
      customer
    });
  };

  const handleBackToStaff = () => {
    if (previousStaffUser) {
      setSession({
        type: 'internal',
        user: previousStaffUser
      });
      setPreviousStaffUser(null);
    } else {
      handleLogout();
    }
  };

  // Barcode / QR Global Scanner Result Dispatcher
  const handleGlobalScanSuccess = (decodedText: string) => {
    setIsScannerOpen(false);
    const text = decodedText.trim();

    if (text.startsWith('BND-')) {
      // WIP Bundle barcode detected
      navigateTo('BundleTracking');
      setScanNotification(`Bundel ${text} ditemukan. Membuka Lacak Bundel.`);
    } else if (text.startsWith('SPK-')) {
      navigateTo('PPIC');
      setScanNotification(`SPK ${text} ditemukan. Membuka Surat Perintah Kerja.`);
    } else if (text.startsWith('ORD-')) {
      navigateTo('Orders');
      setScanNotification(`Pesanan ${text} ditemukan. Membuka Pesanan.`);
    } else if (text.startsWith('ROL-') || text.startsWith('LOT-')) {
      navigateTo('RawMaterial');
      setScanNotification(`Roll bahan ${text} ditemukan. Membuka Gudang Bahan Baku.`);
    } else {
      setScanNotification(`Hasil scan: ${text}`);
    }

    setTimeout(() => setScanNotification(null), 5000);
  };

  const testModeBanner = serverMode?.mode === 'test' ? (
    <div
      role="status"
      className="shrink-0 bg-amber-400 px-3 py-1.5 text-center text-xs font-bold text-black sm:px-4"
    >
      MODE UJI COBA — data tersimpan di <span className="font-mono">{serverMode.dataDir}</span>, terpisah dari produksi
    </div>
  ) : null;

  // If not logged in, render LoginModal
  if (!session) {
    return (
      <div className="min-h-screen bg-slate-100 flex flex-col justify-between">
        {testModeBanner}
        <PWAInstallBanner />
        <LoginModal onLoginSuccess={handleLoginSuccess} />
      </div>
    );
  }

  // If customer logged in, render CustomerPortal
  if (session.type === 'customer') {
    return (
      <div className="min-h-screen bg-slate-50">
        {testModeBanner}
        <PWAInstallBanner />
        <React.Suspense fallback={<ModuleLoadingFallback />}>
          <CustomerPortal
            customer={session.customer}
            onLogout={handleLogout}
            onBackToStaff={previousStaffUser ? handleBackToStaff : undefined}
          />
        </React.Suspense>
      </div>
    );
  }

  // Internal Staff ERP
  const user = session.user;
  const canManageAccounts = canOpenModule('Accounts');
  const isDashboard = currentModule === 'Dashboard';

  // Render current active module component
  const renderActiveModule = () => {
    switch (currentModule) {
      case 'Dashboard':
        return (
          <DashboardModule
            userName={user.name}
            onNavigate={navigateTo}
            onOpenScanner={openScanner}
          />
        );
      case 'Customers':
        return <CustomersModule onPreviewCustomerPortal={handlePreviewCustomer} />;
      case 'Quotations':
        return <QuotationsModule />;
      case 'Orders':
        return <OrdersModule />;
      case 'Designs':
        return <DesignSampleModule />;
      case 'PPIC':
        return <PPICModule />;
      case 'Procurement':
        return <ProcurementModule />;
      case 'RawMaterial':
        return <RawMaterialModule />;
      case 'PatternGrading':
        return <PatternGradingModule />;
      case 'Cutting':
        return <CuttingModule />;
      case 'BundleTracking':
        return <BundleTrackingModule />;
      case 'Sewing':
        return <SewingModule />;
      case 'QC':
        return <QCModule />;
      case 'Packaging':
        return <PackagingModule />;
      case 'Returns':
        return <ReturnsModule />;
      case 'Shipping':
        return <ShippingModule />;
      case 'HRPayroll':
        return <HRPayrollModule />;
      case 'Finance':
        return <FinanceModule />;
      case 'Accounts':
        return <AccountsModule />;
      case 'DailyCash':
        return <DailyCashModule />;
      case 'HowItWorks':
        return (
          <HowItWorksModule
            onNavigate={navigateTo}
            canOpen={canOpenModule}
          />
        );
      default:
        return (
          <DashboardModule
            userName={user.name}
            onNavigate={navigateTo}
            onOpenScanner={openScanner}
          />
        );
    }
  };

  return (
    <div className="h-dvh bg-canvas flex flex-col overflow-hidden font-sans text-foreground antialiased">
      <PWAInstallBanner />

      {/* Global Scan Toast Notification */}
      {scanNotification && (
        <div role="status" className="fixed top-4 right-4 left-4 sm:left-auto z-50 bg-white text-black px-4 py-3 rounded-2xl shadow-xl border-2 border-brand-teal flex items-center gap-3 sm:max-w-md">
          <ScanLine className="w-5 h-5 text-brand-teal-dark shrink-0" aria-hidden="true" />
          <span className="text-sm font-semibold">{scanNotification}</span>
        </div>
      )}

      <Toast toast={toast} />

      {testModeBanner}

      <TopBar
        user={user}
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={() => setIsSidebarOpen(open => !open)}
        onOpenSearch={() => setIsPaletteOpen(true)}
        onOpenScanner={openScanner}
        onOpenProfile={() => setIsProfileModalOpen(true)}
        onNavigate={navigateTo}
        onLogout={handleLogout}
        canManageAccounts={canManageAccounts}
        attention={signals.attention}
        attentionTotal={signals.attentionTotal}
      />

      <div className="flex-1 min-h-0 flex">
        <ModuleSidebar
          sections={permittedSections}
          activeSection={railSection}
          onSelectSection={setRailSection}
          currentModule={currentModule}
          onNavigate={navigateTo}
          favorites={favoriteItems}
          badges={signals.badges}
          userInitial={user.name ? user.name.charAt(0).toUpperCase() : 'U'}
          userName={user.name}
          onOpenProfile={() => setIsProfileModalOpen(true)}
          onOpenGuide={() => navigateTo('HowItWorks')}
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <ModuleTabs
            tabs={openTabs}
            current={currentModule}
            onSelect={setCurrentModule}
            onClose={closeTab}
            isFavorite={favorites.includes(currentModule)}
            onToggleFavorite={toggleFavorite}
            onNewTab={() => setIsPaletteOpen(true)}
          />

          <div className="flex min-h-0 flex-1">
            <main ref={mainRef} className="flex-1 min-w-0 overflow-y-auto overscroll-contain px-4 py-5 sm:p-6 lg:px-8 lg:py-7">
              <div className="max-w-[1600px] mx-auto">
                <React.Suspense fallback={<ModuleLoadingFallback />}>
                  {renderActiveModule()}
                </React.Suspense>
              </div>
            </main>

            {isDashboard && showAttentionPanel && (
              <AttentionPanel
                attention={signals.attention}
                loaded={signals.loaded}
                canOpen={canOpenModule}
                onNavigate={navigateTo}
                onOpenScanner={openScanner}
                onCollapse={() => toggleAttentionPanel(false)}
              />
            )}
            {isDashboard && !showAttentionPanel && (
              <button
                type="button"
                onClick={() => toggleAttentionPanel(true)}
                title="Tampilkan panel perlu tindakan"
                aria-label="Tampilkan panel perlu tindakan"
                className="hidden xl:flex w-9 shrink-0 items-start justify-center border-l border-border bg-white pt-4 text-slate-400 hover:text-foreground cursor-pointer"
              >
                <ChevronsLeft size={16} />
              </button>
            )}
          </div>
        </div>
      </div>

      <StatusBar
        isOnline={isOnline}
        serverOk={serverOk}
        serverMode={serverMode?.mode}
        pendingSyncCount={pendingSyncCount}
        onOpenGuide={() => navigateTo('HowItWorks')}
      />

      <CommandPalette
        isOpen={isPaletteOpen}
        onClose={closePalette}
        items={permittedItems}
        orders={signals.orders}
        spks={signals.spks}
        canOpen={canOpenModule}
        onNavigate={navigateTo}
        onOpenScanner={openScanner}
      />

      {/* Global Barcode / QR Scanner Modal (Loaded On Demand) */}
      {isScannerOpen && (
        <React.Suspense fallback={null}>
          <ScannerModal
            isOpen={isScannerOpen}
            onClose={() => setIsScannerOpen(false)}
            onScanSuccess={handleGlobalScanSuccess}
            title="Scan QR / Barcode"
            subtitle="Arahkan kamera ke QR bundel, SPK, pesanan, roll bahan, atau mesin."
          />
        </React.Suspense>
      )}

      {/* Profile Detail Modal */}
      {isProfileModalOpen && session?.type === 'internal' && (
        <Modal
          isOpen={isProfileModalOpen}
          onClose={() => setIsProfileModalOpen(false)}
          title="Profil Akun Staff"
          subtitle="Informasi identitas dan wewenang akun operasional HIJ Konveksi"
          size="md"
        >
          <div className="space-y-4">
            {/* Identity Card */}
            <div className="flex items-center gap-4 p-4 bg-teal-50/40 rounded-2xl border border-teal-200/80">
              <div className="w-14 h-14 rounded-2xl bg-brand-teal text-black flex items-center justify-center font-extrabold text-xl shadow-xs border border-brand-teal-dark/30 shrink-0">
                {session.user.name ? session.user.name.charAt(0).toUpperCase() : 'U'}
              </div>
              <div className="min-w-0">
                <h4 className="font-extrabold text-base text-black">{session.user.name}</h4>
                <p className="text-sm text-slate-600 font-mono">@{session.user.username}</p>
                <div className="mt-1">
                  <span className="inline-block px-2.5 py-0.5 rounded-md text-xs font-bold bg-brand-teal-dark text-white">
                    {session.user.role}
                  </span>
                </div>
              </div>
            </div>

            {/* Details Table */}
            <div className="rounded-xl border border-border overflow-hidden divide-y divide-border text-sm">
              <div className="p-3 flex justify-between items-center">
                <span className="text-slate-500 font-medium">Sistem ID</span>
                <span className="font-mono font-bold text-black">{session.user.id || 'STAFF-AUTH'}</span>
              </div>
              <div className="p-3 flex justify-between items-center">
                <span className="text-slate-500 font-medium">Hak Wewenang</span>
                <span className="font-semibold text-black">{session.user.role} Konveksi</span>
              </div>
              <div className="p-3 flex justify-between items-center">
                <span className="text-slate-500 font-medium">Status Sesi</span>
                <span className="inline-flex items-center gap-1.5 font-bold text-brand-teal-dark">
                  <span className="w-2 h-2 rounded-full bg-brand-teal" /> Aktif
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="pt-2 flex items-center justify-end gap-2">
              {canManageAccounts && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsProfileModalOpen(false);
                    navigateTo('Accounts');
                  }}
                  className="font-bold border-teal-300 text-brand-teal-dark hover:bg-teal-50"
                >
                  Buka Manajemen Akun
                </Button>
              )}
              <Button
                variant="default"
                onClick={() => setIsProfileModalOpen(false)}
              >
                Tutup
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default App;
