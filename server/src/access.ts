/*
 * Who may write what.
 *
 * The sidebar hides menus a staff member has no access to, but until now the
 * API let any signed-in staff token write any table: a production account
 * could promote itself to Super Admin, edit invoice amounts, or delete orders.
 * The menu list (`allowedModules`) is the permission; this file makes the API
 * read it the same way the sidebar does.
 */
import type { Request, Response, NextFunction } from 'express';
import { findById } from './db.js';

/** Same defaults the login handler applies when an account lists no modules. */
export const STAFF_ROLE_MODULES: Record<string, string[]> = {
  'Super Admin': ['*'],
  Owner: ['Dashboard', 'HowItWorks', 'Quotations', 'Orders', 'Customers', 'PPIC', 'QC', 'Shipping', 'Finance', 'HRPayroll'],
  Design: ['Dashboard', 'HowItWorks', 'Designs', 'Quotations', 'PatternGrading', 'Orders', 'Customers'],
  Pengadaan: ['Dashboard', 'HowItWorks', 'Quotations', 'Procurement', 'RawMaterial', 'Orders'],
  Produksi: ['Dashboard', 'HowItWorks', 'PPIC', 'Cutting', 'BundleTracking', 'Sewing', 'QC', 'Packaging', 'Shipping', 'Returns']
};

export function modulesFor(user: any): string[] {
  if (!user) return [];
  const own = Array.isArray(user.allowedModules) ? user.allowedModules : [];
  return own.length > 0 ? own : STAFF_ROLE_MODULES[user.role] || [];
}

export function canOpen(user: any, module: string): boolean {
  if (!user) return false;
  if (user.role === 'Super Admin') return true;
  const modules = modulesFor(user);
  return modules.includes('*') || module === 'Dashboard' || module === 'HowItWorks' || modules.includes(module);
}

export const isFullAdmin = (user: any) => !!user && (user.role === 'Super Admin' || modulesFor(user).includes('*'));

/*
 * Which menu a table belongs to. A write to the table needs one of the listed
 * menus. Reads stay open to every staff account except the few tables below,
 * because most screens read across tables (PPIC reads payments for the DP
 * gate, the dashboard reads everything).
 */
const WRITE_MODULES: Record<string, string[]> = {
  customers: ['Customers'],
  quotations: ['Quotations'],
  orders: ['Orders', 'Quotations', 'PPIC'],
  designs: ['Designs', 'Orders'],
  samples: ['Designs'],
  spk_produksi: ['PPIC', 'Orders'],
  work_assignments: ['PPIC', 'HRPayroll'],
  procurements: ['Procurement'],
  inventory_bahan: ['RawMaterial', 'Procurement'],
  stock_opname: ['RawMaterial'],
  patterns: ['PatternGrading', 'Designs'],
  pattern_gradings: ['PatternGrading', 'Designs'],
  size_charts: ['PatternGrading', 'Designs', 'Quotations'],
  cutting_batches: ['Cutting'],
  wip_bundles: ['BundleTracking', 'Cutting'],
  sewing_logs: ['Sewing'],
  productionlines: ['Sewing', 'PPIC'],
  machines: ['Sewing', 'PPIC'],
  safety_reports: ['Sewing', 'PPIC', 'QC'],
  trims_checks: ['QC', 'Sewing'],
  qc_reports: ['QC'],
  packaging_slips: ['Packaging'],
  inventory_produk_jadi: ['Packaging', 'Shipping'],
  shipments: ['Shipping'],
  returns_complaints: ['Returns', 'QC'],
  invoices: ['Finance'],
  payments: ['Finance'],
  operators: ['HRPayroll', 'PPIC'],
  borongan_salary_slips: ['HRPayroll'],
  users: ['Accounts']
};

/** Tables only these menus may even read. */
const READ_MODULES: Record<string, string[]> = {
  users: ['Accounts'],
  borongan_salary_slips: ['HRPayroll'],
  store_settings: ['Accounts']
};

/** Storefront and top-up tables: an admin-only area, whether or not it is switched on. */
const ADMIN_ONLY_PREFIXES = ['store_', 'digiflazz_'];

const isAdminOnlyTable = (table: string) => ADMIN_ONLY_PREFIXES.some(prefix => table.startsWith(prefix));

export function writeBlockReason(user: any, table: string): string | null {
  if (isFullAdmin(user)) return null;
  if (isAdminOnlyTable(table)) return 'Data ini hanya boleh diubah Super Admin.';
  const modules = WRITE_MODULES[table];
  if (!modules) return null; // unknown table: the table whitelist elsewhere decides
  if (modules.some(m => canOpen(user, m))) return null;
  return `Akun Anda tidak punya akses ke menu ${modules[0]}, jadi tidak bisa mengubah data ini.`;
}

export function readBlockReason(user: any, table: string): string | null {
  if (isFullAdmin(user)) return null;
  if (isAdminOnlyTable(table)) return 'Data ini hanya boleh dilihat Super Admin.';
  const modules = READ_MODULES[table];
  if (!modules || modules.some(m => canOpen(user, m))) return null;
  return `Akun Anda tidak punya akses ke menu ${modules[0]}.`;
}

/** Middleware for the dedicated routes: the caller must be staff with one of these menus. */
export function requireModule(...modules: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.actor) {
      return res.status(401).json({ error: 'Sesi tidak valid atau sudah berakhir. Silakan masuk lagi.' });
    }
    if (req.actor.type !== 'internal') return res.status(403).json({ error: 'Akses ini khusus staf HIJ.' });
    const user = findById('users', req.actor.sub);
    if (modules.length > 0 && !modules.some(m => canOpen(user, m))) {
      return res.status(403).json({ error: `Akun Anda tidak punya akses ke menu ${modules[0]}.` });
    }
    next();
  };
}

/*
 * Guards on the accounts table itself. Someone editing their own role, or
 * deleting the last account that can reach Akun & Hak Akses, locks the whole
 * company out of administering the app.
 */
export function usersWriteBlockReason(
  actorId: string,
  method: 'POST' | 'PUT' | 'DELETE',
  targetId: string | undefined,
  body: any,
  allUsers: any[]
): string | null {
  const self = targetId !== undefined && String(targetId).toLowerCase() === String(actorId).toLowerCase();
  const target = targetId ? allUsers.find(u => String(u.id).toLowerCase() === String(targetId).toLowerCase()) : null;
  const admins = allUsers.filter(isFullAdmin);
  const lastAdmin = target && isFullAdmin(target) && admins.length <= 1;

  if (method === 'DELETE') {
    if (self) return 'Anda tidak bisa menghapus akun yang sedang dipakai.';
    if (lastAdmin) return 'Ini satu-satunya akun Super Admin. Buat admin lain dulu sebelum menghapusnya.';
    return null;
  }
  if (method === 'PUT' && body && typeof body === 'object') {
    const touchesRights = body.role !== undefined || body.allowedModules !== undefined;
    if (self && touchesRights) {
      const sameRole = body.role === undefined || body.role === target?.role;
      const sameModules =
        body.allowedModules === undefined ||
        JSON.stringify(body.allowedModules) === JSON.stringify(target?.allowedModules || []);
      if (!sameRole || !sameModules) return 'Hak akses akun sendiri tidak bisa diubah. Minta admin lain yang mengubahnya.';
    }
    if (lastAdmin && touchesRights) {
      const stillAdmin = isFullAdmin({ ...target, ...body });
      if (!stillAdmin) return 'Ini satu-satunya akun Super Admin; haknya tidak bisa diturunkan.';
    }
  }
  return null;
}
