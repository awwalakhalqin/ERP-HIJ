import type { SOPModule } from '../types';

/*
 * The one catalogue of module names.
 *
 * The sidebar and the permissions screen used to keep separate hand-written
 * lists, and they drifted: the same warehouse page was "Gudang Stok Aksesoris"
 * in the menu and "Gudang Bahan Baku" in the permissions list, so an admin
 * granted access to a name the staff member would never see. Both read this
 * file now, and a rename here reaches every surface at once.
 *
 * Icons stay in App.tsx — they are presentation, and keeping them out lets this
 * file be imported by any module without pulling in the icon library.
 */

export interface ModuleInfo {
  id: SOPModule;
  /** Shown in the sidebar, the permissions list, and the page header. */
  label: string;
  /** The SOP this module implements, shown as a badge. */
  sop?: string;
}

export interface ModuleSection {
  title: string;
  items: ModuleInfo[];
}

export const MODULE_SECTIONS: ModuleSection[] = [
  {
    title: 'Utama',
    items: [
      { id: 'Dashboard', label: 'Dasbor' },
      { id: 'Customers', label: 'Pelanggan', sop: 'SOP-01' }
    ]
  },
  {
    title: 'Pra-Produksi & Penjualan',
    items: [
      { id: 'Designs', label: 'Desain & Sampel', sop: 'SOP-02' },
      { id: 'Quotations', label: 'Surat Penawaran', sop: 'SOP-01A/20' },
      { id: 'Orders', label: 'Pesanan Masuk', sop: 'SOP-01B' }
    ]
  },
  {
    title: 'Perencanaan & Bahan Baku',
    items: [
      { id: 'PPIC', label: 'Surat Perintah Kerja', sop: 'SOP-03' },
      { id: 'Procurement', label: 'Pembelian Bahan Proyek', sop: 'SOP-04' },
      { id: 'RawMaterial', label: 'Gudang Aksesoris & Kain', sop: 'SOP-05' },
      { id: 'PatternGrading', label: 'Size Chart', sop: 'SOP-06' }
    ]
  },
  {
    title: 'Lantai Produksi',
    items: [
      { id: 'Cutting', label: 'Pemotongan', sop: 'SOP-07' },
      { id: 'BundleTracking', label: 'Lacak Bundel', sop: 'SOP-08' },
      { id: 'Sewing', label: 'Penjahitan', sop: 'SOP-09/10' }
    ]
  },
  {
    title: 'Kualitas & Logistik',
    items: [
      { id: 'QC', label: 'Pemeriksaan QC', sop: 'SOP-12' },
      { id: 'Packaging', label: 'Pengemasan', sop: 'SOP-13' },
      { id: 'Shipping', label: 'Pengiriman', sop: 'SOP-16' },
      { id: 'Returns', label: 'Retur & Garansi', sop: 'SOP-15' }
    ]
  },
  {
    title: 'Keuangan & Manajemen',
    items: [
      { id: 'Finance', label: 'Keuangan', sop: 'SOP-20' },
      { id: 'HRPayroll', label: 'Penggajian', sop: 'SOP-19' },
      { id: 'Accounts', label: 'Akun & Hak Akses', sop: 'Admin' },
      { id: 'HowItWorks', label: 'Panduan Alur', sop: 'SOP' }
    ]
  }
];

export const ALL_MODULES: ModuleInfo[] = MODULE_SECTIONS.flatMap(section => section.items);

export const moduleLabel = (id: string) => ALL_MODULES.find(m => m.id === id)?.label ?? id;
export const moduleSop = (id: string) => ALL_MODULES.find(m => m.id === id)?.sop ?? '';
