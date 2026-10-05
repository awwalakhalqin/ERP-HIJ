import {
  LayoutDashboard,
  Users,
  ShoppingCart,
  Palette,
  ClipboardList,
  ShoppingBag,
  Layers,
  Scissors,
  QrCode,
  Component,
  CheckCircle2,
  Package,
  RotateCcw,
  Truck,
  Coins,
  CreditCard,
  UserCog,
  BookOpen,
  NotebookPen,
  FileText,
  Wallet,
  Factory,
  type LucideIcon
} from 'lucide-react';
import { MODULE_SECTIONS, OPEN_TO_ALL_MODULES } from '../../config/modules';
import type { SOPModule, User } from '../../types';

/*
 * Presentation for the shell: icons and the short names the icon rail shows.
 * Module names and grouping still come from config/modules.ts, so the sidebar,
 * the rail, the search and the permissions screen all read one catalogue.
 */
export const MODULE_ICONS: Record<string, LucideIcon> = {
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
  DailyCash: NotebookPen,
  HowItWorks: BookOpen
};

/** One rail button per section, named for the part of the factory it covers. */
const SECTION_META: Record<string, { short: string; icon: LucideIcon }> = {
  Utama: { short: 'Utama', icon: LayoutDashboard },
  'Pra-Produksi & Penjualan': { short: 'Penjualan', icon: ShoppingCart },
  'Perencanaan & Bahan Baku': { short: 'Rencana', icon: ClipboardList },
  'Lantai Produksi': { short: 'Produksi', icon: Factory },
  'Kualitas & Logistik': { short: 'Logistik', icon: Truck },
  'Keuangan & Manajemen': { short: 'Keuangan', icon: Wallet }
};

export interface NavItem {
  id: SOPModule;
  label: string;
  sop?: string;
  icon: LucideIcon;
}

export interface NavSection {
  title: string;
  short: string;
  icon: LucideIcon;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = MODULE_SECTIONS.map(section => ({
  title: section.title,
  short: SECTION_META[section.title]?.short ?? section.title,
  icon: SECTION_META[section.title]?.icon ?? LayoutDashboard,
  items: section.items.map(item => ({ ...item, icon: MODULE_ICONS[item.id] ?? LayoutDashboard }))
}));

export const ALL_NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap(s => s.items);

export const navItem = (id: SOPModule) => ALL_NAV_ITEMS.find(i => i.id === id);

export const sectionOf = (id: SOPModule) => NAV_SECTIONS.find(s => s.items.some(i => i.id === id));

/*
 * The dashboard and the flow guide are open to everyone; every other module
 * follows the role's permissions. The sidebar, the tabs, the search and the
 * page restored after a reload all ask this one function.
 */
export const canUserOpenModule = (user: User | undefined, id: SOPModule) =>
  !!user && (
    user.role === 'Super Admin' ||
    !!user.allowedModules?.includes('*') ||
    id === 'Dashboard' ||
    id === 'HowItWorks' ||
    OPEN_TO_ALL_MODULES.includes(id) ||
    !!user.allowedModules?.includes(id)
  );
