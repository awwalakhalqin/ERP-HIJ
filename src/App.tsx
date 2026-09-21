import React, { useState, useEffect, useRef } from 'react';
import { logoutApi, getAuthToken, AUTH_EXPIRED_EVENT } from './services/api';
import { MODULE_SECTIONS } from './config/modules';
import { 
  LayoutDashboard, 
  Users, 
  ShoppingCart, 
  Palette, 
  CalendarClock,
  ClipboardList, 
  ShoppingBag, 
  Layers, 
  Scissors, 
  QrCode, 
  Component, 
  CheckCircle2, 
  Package, 
  Warehouse, 
  RotateCcw, 
  Truck, 
  Coins, 
  CreditCard, 
  UserCog, 
  Menu, 
  X, 
  LogOut, 
  ScanLine, 
  ChevronRight,
  ChevronDown,
  User as UserIcon,
  Shield,
  FileSpreadsheet,
  Clock,
  BookOpen,
  FileText
} from 'lucide-react';
import { SOPModule, AuthSession, User } from './types';
import { db } from './db/dexie';
// Common Components
import { LoginModal } from './components/common/LoginModal';
import { PWAInstallBanner } from './components/common/PWAInstallBanner';
import { Modal } from './components/ui/Modal';
import { Button } from './components/ui/Button';
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

interface MenuItem {
  id: SOPModule;
  label: string;
  sop?: string;
  icon: React.ElementType;
}

interface MenuSection {
  title: string;
  items: MenuItem[];
}

/*
 * Names and grouping come from the shared catalogue; only the icons live here,
 * so the sidebar and the permissions screen can never disagree about what a
 * module is called.
 */
const MODULE_ICONS: Record<string, MenuItem['icon']> = {
  Dashboard: LayoutDashboard,
  Customers: Users,
  Designs: Palette,
  Quotations: FileText,
  Orders: ShoppingCart,
  PPIC: ClipboardList,
  Procurement: ShoppingBag,
  RawMaterial: Layers,
  PatternGrading: Scissors,
  Cutting: Scissors,
  BundleTracking: QrCode,
  Sewing: Component,
  QC: CheckCircle2,
  Packaging: Package,
  Shipping: Truck,
  Returns: RotateCcw,
  Finance: CreditCard,
  HRPayroll: Coins,
  Accounts: UserCog,
  HowItWorks: BookOpen
};

const MENU_SECTIONS: MenuSection[] = MODULE_SECTIONS.map(section => ({
  title: section.title,
  items: section.items.map(item => ({ ...item, icon: MODULE_ICONS[item.id] }))
}));

/** Which page this tab was on, kept per tab so two tabs can sit on different pages. */
const ACTIVE_MODULE_KEY = 'hij_active_module';

/*
 * The dashboard and the flow guide are open to everyone; every other module
 * follows the role's permissions. Written once here because both the sidebar
 * and the page restored after a reload have to agree on it.
 */
const canUserOpenModule = (user: User | undefined, id: SOPModule) =>
  !!user && (
    user.role === 'Super Admin' ||
    !!user.allowedModules?.includes('*') ||
    id === 'Dashboard' ||
    id === 'HowItWorks' ||
    !!user.allowedModules?.includes(id)
  );

/*
 * Reopen the page the user was on. A reload should not cost them their place:
 * the browser may refresh for a new app version, a dropped connection, or a
 * stray F5 in the middle of typing an order.
 */
const restoreActiveModule = (): SOPModule => {
  try {
    const saved = sessionStorage.getItem(ACTIVE_MODULE_KEY) as SOPModule | null;
    if (!saved) return 'Dashboard';
    const session = JSON.parse(localStorage.getItem('hij_auth_session') || 'null') as AuthSession | null;
    // Only staff navigate these modules, and permissions may have changed since.
    const user = session && session.type !== 'customer' ? session.user : undefined;
    return canUserOpenModule(user, saved) ? saved : 'Dashboard';
  } catch {
    return 'Dashboard';
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
      return JSON.parse(saved);
    } catch {
      return null;
    }
  });

  // Navigation state
  const [currentModule, setCurrentModule] = useState<SOPModule>(restoreActiveModule);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  /*
   * Which dataset the API behind this page is serving. Typing an afternoon of
   * trial orders into production because the two look identical is the failure
   * this guards against, so the answer is shown, not assumed.
   */
  const [serverMode, setServerMode] = useState<{ mode: string; dataDir: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    // Plain fetch: /api/health needs no session, and a failure here is not a login problem.
    fetch('/api/health')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!cancelled && d?.mode) setServerMode({ mode: d.mode, dataDir: d.dataDir });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Connectivity & Offline Queue State
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);

  // Staff previewing customer portal state
  const [previousStaffUser, setPreviousStaffUser] = useState<User | null>(null);

  // Global QR / Barcode Scanner Modal
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scanNotification, setScanNotification] = useState<string | null>(null);

  // User Account Dropdown & Profile Modal State
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  // Click outside listener for Account Dropdown Menu
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(event.target as Node)) {
        setIsAccountMenuOpen(false);
      }
    };
    if (isAccountMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isAccountMenuOpen]);

  // Escape closes the account menu and the mobile sidebar
  useEffect(() => {
    if (!isAccountMenuOpen && !isSidebarOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setIsAccountMenuOpen(false);
      setIsSidebarOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isAccountMenuOpen, isSidebarOpen]);

  // Each module opens at the top, with its name in the browser tab
  useEffect(() => {
    try {
      sessionStorage.setItem(ACTIVE_MODULE_KEY, currentModule);
    } catch {
      // Private browsing can refuse storage; only the restore-after-reload is lost.
    }
    mainRef.current?.scrollTo({ top: 0 });
    const item = MENU_SECTIONS.flatMap(section => section.items).find(i => i.id === currentModule);
    const label = item?.label ?? (currentModule === 'HowItWorks' ? 'Panduan Alur' : null);
    document.title = label ? `${label} · HIJ Konveksi` : 'HIJ Konveksi';
  }, [currentModule]);

  // Network listener & sync counter
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const checkQueue = async () => {
      try {
        const count = await db.syncQueue.where('synced').equals(0).count();
        setPendingSyncCount(count);
      } catch {
        // Dexie table check fallback
      }
    };

    checkQueue();
    const interval = setInterval(checkQueue, 4000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, []);

  const handleLoginSuccess = (newSession: AuthSession) => {
    setSession(newSession);
    setPreviousStaffUser(null);
    try {
      localStorage.setItem('hij_auth_session', JSON.stringify(newSession));
    } catch (err) {
      console.error('Storage error:', err);
    }
    setCurrentModule('Dashboard');
  };

  const handleLogout = () => {
    setSession(null);
    setPreviousStaffUser(null);
    setCurrentModule('Dashboard');
    localStorage.removeItem('hij_auth_session');
    try {
      sessionStorage.removeItem(ACTIVE_MODULE_KEY);
    } catch {
      // Nothing to clean up if storage is unavailable.
    }
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
      localStorage.removeItem('hij_auth_session');
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, []);

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
      setCurrentModule('BundleTracking');
      setScanNotification(`Bundel ${text} ditemukan. Membuka Lacak Bundel.`);
    } else if (text.startsWith('SPK-')) {
      setCurrentModule('PPIC');
      setScanNotification(`SPK ${text} ditemukan. Membuka Surat Perintah Kerja.`);
    } else if (text.startsWith('ORD-')) {
      setCurrentModule('Orders');
      setScanNotification(`Pesanan ${text} ditemukan. Membuka Pesanan.`);
    } else if (text.startsWith('ROL-') || text.startsWith('LOT-')) {
      setCurrentModule('RawMaterial');
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
  const isSuperAdmin = user.role === 'Super Admin' || user.allowedModules?.includes('*');

  const canOpenModule = (id: SOPModule) => canUserOpenModule(user, id);

  // Filter menu sections based on user role permissions
  const filteredSections = MENU_SECTIONS.map(section => ({
    ...section,
    items: section.items.filter(item => canOpenModule(item.id))
  })).filter(section => section.items.length > 0);

  // Render current active module component
  const renderActiveModule = () => {
    switch (currentModule) {
      case 'Dashboard':
        return (
          <DashboardModule 
            onNavigate={(mod) => setCurrentModule(mod)} 
            onOpenScanner={() => setIsScannerOpen(true)} 
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
      case 'HowItWorks':
        return (
          <HowItWorksModule
            onNavigate={(mod) => setCurrentModule(mod)}
            canOpen={canOpenModule}
          />
        );
      default:
        return (
          <DashboardModule 
            onNavigate={(mod) => setCurrentModule(mod)} 
            onOpenScanner={() => setIsScannerOpen(true)} 
          />
        );
    }
  };

  return (
    <div className="h-dvh bg-white flex flex-col overflow-hidden font-sans text-foreground antialiased">
      <PWAInstallBanner />

      {/* Global Scan Toast Notification */}
      {scanNotification && (
        <div role="status" className="fixed top-4 right-4 left-4 sm:left-auto z-50 bg-white text-black px-4 py-3 rounded-2xl shadow-xl border-2 border-brand-teal flex items-center gap-3 sm:max-w-md">
          <ScanLine className="w-5 h-5 text-brand-teal-dark shrink-0" aria-hidden="true" />
          <span className="text-sm font-semibold">{scanNotification}</span>
        </div>
      )}

      {testModeBanner}

      {/* Top Navbar (brand teal #2bb2b5; dark ink because the surface is light) */}
      <header className="relative z-30 shrink-0 bg-brand-teal text-black border-b border-black/10 px-3 sm:px-4 py-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="size-10 inline-flex items-center justify-center rounded-xl text-black hover:bg-black/10 transition lg:hidden cursor-pointer"
            aria-label={isSidebarOpen ? 'Tutup menu' : 'Buka menu'}
            aria-expanded={isSidebarOpen}
            aria-controls="app-sidebar"
          >
            {isSidebarOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>

          <div className="flex items-center gap-2.5 min-w-0">
            <img
              src="/logo.png"
              alt="Logo PT Hasil Inti Jualan"
              className="h-9 sm:h-10 w-auto object-contain bg-white p-1.5 rounded-xl border border-black/10 shrink-0"
            />
            <div className="min-w-0">
              <div className="font-extrabold text-base leading-tight text-black tracking-wide">HIJ Konveksi</div>
              <div className="text-xs text-black/70 font-semibold">PT Hasil Inti Jualan</div>
            </div>
          </div>
        </div>

        {/* Header Right Actions */}
        <div className="flex items-center gap-2.5 sm:gap-3">
          {/* Quick Scanner Button */}
          <button
            onClick={() => setIsScannerOpen(true)}
            className="inline-flex h-10 items-center gap-1.5 px-3 bg-brand-teal-dark hover:bg-[#0e5662] text-white text-sm font-bold rounded-xl transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black"
            aria-label="Scan QR"
          >
            <ScanLine className="w-4 h-4 text-white" aria-hidden="true" />
            <span className="hidden md:inline">Scan QR</span>
          </button>

          {/* User Account Dropdown Button */}
          <div className="relative" ref={accountMenuRef}>
            <button
              onClick={() => setIsAccountMenuOpen(!isAccountMenuOpen)}
              className="inline-flex h-10 items-center gap-2 pl-1.5 pr-2.5 bg-white hover:bg-teal-50 text-black rounded-xl transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black"
              aria-expanded={isAccountMenuOpen}
              aria-haspopup="true"
              aria-label={`Menu akun ${user.name}`}
            >
              <div className="w-7 h-7 rounded-lg bg-teal-50 text-brand-teal-dark border border-teal-200 flex items-center justify-center font-bold text-xs shrink-0">
                {user.name ? user.name.charAt(0).toUpperCase() : 'U'}
              </div>
              <div className="text-left hidden sm:block">
                <div className="text-xs font-bold text-black leading-tight truncate max-w-[140px]">{user.name}</div>
                <div className="text-[10px] font-semibold text-brand-teal-dark leading-tight">{user.role}</div>
              </div>
              <ChevronDown aria-hidden="true" className={`w-3.5 h-3.5 text-black/70 transition-transform duration-200 ${isAccountMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Dropdown Menu Popup */}
            {isAccountMenuOpen && (
              <div className="absolute right-0 top-full mt-2 w-72 max-w-[calc(100vw-1.5rem)] bg-white rounded-2xl border border-border shadow-diffusion-lg p-2 z-50 text-black">
                {/* User Header Summary */}
                <div className="p-3 bg-teal-50/60 rounded-xl border border-teal-200/70 mb-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-brand-teal text-black flex items-center justify-center font-extrabold text-base border border-brand-teal-dark/30 shadow-xs shrink-0">
                      {user.name ? user.name.charAt(0).toUpperCase() : 'U'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-sm text-black truncate">{user.name}</div>
                      <div className="text-xs text-slate-500 font-mono truncate">@{user.username}</div>
                    </div>
                  </div>
                  <div className="mt-2.5 pt-2 border-t border-teal-200/60 flex items-center justify-between">
                    <span className="text-[11px] text-slate-600 font-medium">Peran Staff</span>
                    <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-brand-teal-dark text-white shadow-2xs">
                      {user.role}
                    </span>
                  </div>
                </div>

                {/* Dropdown Navigation Actions */}
                <div className="space-y-1 text-sm">
                  <button
                    onClick={() => {
                      setIsAccountMenuOpen(false);
                      setIsProfileModalOpen(true);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-black hover:bg-teal-50 hover:text-brand-teal-dark transition-colors cursor-pointer text-left font-semibold"
                  >
                    <UserIcon size={16} className="text-brand-teal-dark" />
                    <span>Profil Akun</span>
                  </button>

                  {(user.role === 'Super Admin' || user.role === 'Owner') && (
                    <button
                      onClick={() => {
                        setIsAccountMenuOpen(false);
                        setCurrentModule('Accounts');
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-black hover:bg-teal-50 hover:text-brand-teal-dark transition-colors cursor-pointer text-left font-semibold"
                    >
                      <UserCog size={16} className="text-brand-teal-dark" />
                      <span>Kelola Akun & Hak Akses</span>
                    </button>
                  )}

                  <button
                    onClick={() => {
                      setIsAccountMenuOpen(false);
                      setCurrentModule('HowItWorks');
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-black hover:bg-teal-50 hover:text-brand-teal-dark transition-colors cursor-pointer text-left font-semibold"
                  >
                    <BookOpen size={16} className="text-brand-teal-dark" />
                    <span>Panduan Alur Kerja</span>
                  </button>
                </div>

                {/* Hairline Divider */}
                <div className="my-1.5 border-t border-border" />

                {/* Logout Button */}
                <button
                  onClick={() => {
                    setIsAccountMenuOpen(false);
                    handleLogout();
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-brand-red hover:bg-rose-50 transition-colors cursor-pointer text-left font-bold text-sm"
                >
                  <LogOut size={16} className="text-brand-red" />
                  <span>Keluar dari Sistem</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Body Container */}
      <div className="flex-1 min-h-0 flex">
        {/* Sidebar Overlay for Mobile */}
        {isSidebarOpen && (
          <div
            onClick={() => setIsSidebarOpen(false)}
            aria-hidden="true"
            className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          />
        )}

        {/* Sidebar Navigation (white canvas; teal is reserved for the active item) */}
        <aside
          id="app-sidebar"
          className={`fixed lg:static inset-y-0 left-0 z-40 w-72 lg:w-64 shrink-0 bg-white text-foreground border-r border-border flex flex-col transition-[translate,visibility] duration-200 ease-out ${
            isSidebarOpen ? 'translate-x-0' : 'max-lg:invisible -translate-x-full lg:translate-x-0'
          }`}
        >
          {/* Mobile Sidebar Close Button */}
          <div className="p-4 flex items-center justify-between lg:hidden border-b border-border">
            <span className="text-sm font-bold text-foreground">Menu</span>
            <button
              onClick={() => setIsSidebarOpen(false)}
              className="size-10 inline-flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground rounded-lg cursor-pointer"
              aria-label="Tutup menu"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation Links List */}
          <nav aria-label="Menu modul" className="sidebar-scroll flex-1 overflow-y-auto overscroll-contain py-4 px-3 space-y-5">
            {filteredSections.map((section) => (
              <div key={section.title} className="space-y-0.5">
                <div className="px-3 text-[11px] font-bold text-brand-teal-dark mb-1.5 uppercase tracking-wider">
                  {section.title}
                </div>
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = currentModule === item.id;

                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        setCurrentModule(item.id);
                        setIsSidebarOpen(false);
                      }}
                      aria-current={isActive ? 'page' : undefined}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal ${
                        isActive
                          ? 'bg-brand-teal text-black font-bold'
                          : 'font-medium text-slate-700 hover:bg-muted hover:text-brand-teal-dark'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 truncate">
                        <Icon aria-hidden="true" className={`w-4 h-4 shrink-0 ${isActive ? 'text-black' : 'text-brand-teal-dark'}`} />
                        <span className="truncate">{item.label}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
        </aside>

        {/* Main Content Area (Dominant Pure White Canvas) */}
        <main ref={mainRef} className="flex-1 min-w-0 overflow-y-auto overscroll-contain px-4 py-5 sm:p-6 lg:p-8 bg-white">
          <div className="max-w-[1600px] mx-auto">
            <React.Suspense fallback={<ModuleLoadingFallback />}>
              {renderActiveModule()}
            </React.Suspense>
          </div>
        </main>
      </div>

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
              {(session.user.role === 'Super Admin' || session.user.role === 'Owner') && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsProfileModalOpen(false);
                    setCurrentModule('Accounts');
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
