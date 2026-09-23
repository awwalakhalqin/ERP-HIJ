import React, { useState, useEffect, useMemo } from 'react';
import {
  Plus,
  Search,
  Users,
  Download,
  Edit,
  Trash2,
  ShoppingBag,
  MessageCircle,
  CreditCard,
  ExternalLink,
  Copy,
  Check,
  ShieldCheck,
  Sparkles,
  KeyRound,
  RefreshCw,
  X
} from 'lucide-react';
import { Customer, Order } from '../../types';
import { fetchResource, createResource, updateResource, deleteResource } from '../../services/api';
import { formatDate, formatDateTime, generateId, exportTableToExcel, formatCurrency, statusLabel } from '../../lib/utils';
import { COMPANY_CONTACT } from '../../config/contact';
import { StatusBadge, Badge } from '../ui/Badge';
import { Modal } from '../ui/Modal';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { FieldLabel, FieldHint, FieldError, FormError, FormSection, FormNotice, Select, Textarea, ChipButton } from '../ui/Field';
import { Toast, useToast } from '../ui/Toast';
import { useConfirm } from '../ui/ConfirmDialog';
import { PageHeader } from '../ui/PageHeader';
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell, TableRowActions, RowActionButton, TableEmptyRow, TableSkeletonRows } from '../ui/Table';
import { DetailDrawer, DetailSection, DetailField, DetailStats, DetailBlock, RowDetailButton } from '../ui/DetailDrawer';
import { newestFirst } from '../../lib/ordering';

// Quick-fill chips stay compact with a mouse but reach 44px on touch screens.
const touchChipClass = 'pointer-coarse:min-h-11';
// Matches <Button variant="outline"> for links that must stay anchors (WhatsApp).
const outlineLinkClass = 'inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-white px-4 text-sm font-semibold text-foreground shadow-2xs transition-all duration-150 hover:bg-muted hover:border-brand-teal/60 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal focus-visible:ring-offset-2';

const PORTAL_URL = COMPANY_CONTACT.portalUrl;

interface CustomersModuleProps {
  onPreviewCustomerPortal?: (customer: Customer) => void;
}

export const CustomersModule: React.FC<CustomersModuleProps> = ({ onPreviewCustomerPortal }) => {
  const { toast, showToast } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  /** Galat isian form, ditampilkan di dalam modal tepat di atas tombol simpan. */
  const [formError, setFormError] = useState<string | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'Active' | 'Inactive'>('ALL');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  // Detail Drawer State
  const [detailCustomer, setDetailCustomer] = useState<Customer | null>(null);
  const [copyToast, setCopyToast] = useState<string | null>(null);

  // Form State
  const [formData, setFormData] = useState<Partial<Customer>>({
    id: '',
    name: '',
    company: '',
    contact: '',
    email: '',
    phone: '',
    address: '',
    status: 'Active',
    username: '',
    password: '',
    portalAccessActive: true
  });

  /*
   * Passwords are hashed by the server and stripped from every response, so the
   * only moment the plaintext exists is right after staff set it. It is kept
   * here, in memory only, so the WhatsApp handover still works — and disappears
   * on reload rather than being readable from the customer record forever.
   */
  const [issuedPasswords, setIssuedPasswords] = useState<Record<string, string>>({});

  const loadData = async () => {
    try {
      setLoading(true);
      const [custRes, orderRes] = await Promise.all([
        fetchResource<Customer>('customers'),
        fetchResource<Order>('orders')
      ]);
      setCustomers(custRes || []);
      setOrders(orderRes || []);
    } catch (err) {
      console.error('Failed loading customers:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCopyCredentials = (cust: Partial<Customer>) => {
    const uname = cust.username || cust.phone || cust.id || '-';
    const known = cust.id ? issuedPasswords[cust.id] : undefined;
    if (!known) {
      setCopyToast('Kata sandi tidak tersimpan di sisi kami. Buka Ubah lalu atur kata sandi baru untuk bisa dikirim.');
      setTimeout(() => setCopyToast(null), 5000);
      return;
    }
    const pwd = known;
    const text = `*KREDENSIAL PORTAL PELANGGAN HIJ KONVEKSI*\n\nHalo ${cust.name || 'Pelanggan'},\nBerikut akses resmi untuk login ke Portal Pelanggan HIJ Konveksi:\n- *Link Portal*: ${PORTAL_URL}\n- *Username / No. WA*: ${uname}\n- *Kata Sandi*: ${pwd}\n- *WhatsApp CS Resmi*: ${COMPANY_CONTACT.whatsappFormatted}\n\nMelalui portal ini Anda dapat:\n1. Memantau progres SPK dan tahapan jahit secara real-time\n2. Melakukan konfirmasi approval desain & sampel\n3. Melihat invoice dan mengunggah bukti bayar\n4. Memeriksa nomor resi pengiriman barang\n5. Melacak riwayat semua pesanan dan mengajukan Repeat Order via WhatsApp\n\nJika ada kendala login atau pertanyaan produksi, silakan hubungi WhatsApp CS kami di ${COMPANY_CONTACT.whatsappFormatted}.\n\nTerima kasih atas kepercayaannya bermitra dengan PT Hasil Inti Jualan.`;
    navigator.clipboard.writeText(text);
    setCopyToast(`Akses WhatsApp untuk ${cust.name || uname} berhasil disalin!`);
    setTimeout(() => setCopyToast(null), 3500);
  };

  const suggestUsername = (name: string, company?: string, phone?: string, mode: 'phone' | 'year' = 'phone') => {
    const raw = (company || name)
      .toLowerCase()
      .replace(/^(pt|cv|ud|yayasan|toko|distro|brand|konveksi)\.?\s+/i, '')
      .trim();
    const slug = raw.replace(/[^a-z0-9]/g, '').slice(0, 10) || 'klien';

    if (mode === 'phone') {
      const cleanPhone = (phone || '').replace(/[^0-9]/g, '');
      const phoneDigits = cleanPhone.length >= 4 ? cleanPhone.slice(-4) : '2026';
      return `${slug}.${phoneDigits}`;
    } else {
      const currentYear = new Date().getFullYear();
      return `${slug}.${currentYear}`;
    }
  };

  const generateSecurePassword = (name?: string, company?: string) => {
    const raw = (company || name || 'Klien').replace(/[^a-zA-Z]/g, '');
    const capitalized = raw ? raw.charAt(0).toUpperCase() + raw.slice(1, 6).toLowerCase() : 'Klien';
    const randNum = Math.floor(100 + Math.random() * 900);
    return `Hij${capitalized}#${randNum}`;
  };

  const validateUsername = (username?: string, currentCustomerId?: string) => {
    if (!username || !username.trim()) {
      return { valid: false, message: 'Username wajib diisi' };
    }
    const clean = username.trim().toLowerCase();
    if (clean.length < 5) {
      return { valid: false, message: 'Minimal 5 karakter agar aman dari pembajakan' };
    }
    if (!/^[a-z0-9._-]+$/.test(clean)) {
      return { valid: false, message: 'Hanya huruf kecil, angka, titik (.), strip (-), atau underscore (_)' };
    }
    // A quick hint only; the server applies the authoritative rule and its error is shown on save.
    const blacklisted = ['admin', 'klien', 'customer', 'root', 'user', 'guest', 'test', 'staff', 'superuser'];
    if (blacklisted.includes(clean)) {
      return { valid: false, message: 'Username terlalu umum & rawan dibajak, gunakan nama spesifik' };
    }
    const isTaken = customers.some(c => c.id !== currentCustomerId && c.username?.toLowerCase() === clean);
    if (isTaken) {
      return { valid: false, message: 'Username sudah digunakan oleh pelanggan lain' };
    }
    return { valid: true, message: 'Username unik, aman, dan siap digunakan' };
  };

  const usernameValidation = useMemo(() => {
    return validateUsername(formData.username, selectedCustomer?.id);
  }, [formData.username, selectedCustomer?.id, customers]);

  const handleOpenAdd = () => {
    setIsEditMode(false);
    setSelectedCustomer(null);
    const newId = generateId('CUST');
    setFormData({
      id: newId,
      name: '',
      company: '',
      contact: '',
      email: '',
      phone: '',
      address: '',
      status: 'Active',
      username: '',
      password: generateSecurePassword(),
      portalAccessActive: true
    });
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (customer: Customer) => {
    setIsEditMode(true);
    setSelectedCustomer(customer);
    setFormData({
      ...customer,
      username: customer.username || suggestUsername(customer.name, customer.company, customer.phone || customer.contact),
      // Empty means "keep the stored password"; the hash can never be shown back.
      password: '',
      portalAccessActive: customer.portalAccessActive !== false
    });
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    // Galat isian muncul di dalam modal, tepat di atas tombol simpan — bukan di
    // kotak browser yang menutupi form yang sedang diperbaiki.
    if (!formData.name?.trim()) {
      setFormError('Nama pelanggan wajib diisi.');
      return;
    }

    if (formData.portalAccessActive !== false && formData.username) {
      const val = validateUsername(formData.username, selectedCustomer?.id);
      if (!val.valid) {
        setFormError(`Username belum bisa dipakai: ${val.message}`);
        return;
      }
    }

    try {
      const typedPassword = String(formData.password || '').trim();

      if (isEditMode && selectedCustomer) {
        // Sending an empty password would overwrite the stored hash with nothing.
        const { password: _omit, ...rest } = formData;
        const payload = typedPassword ? { ...rest, password: typedPassword } : rest;
        await updateResource('customers', selectedCustomer.id, payload);
        if (typedPassword) {
          setIssuedPasswords(prev => ({ ...prev, [selectedCustomer.id]: typedPassword }));
        }
      } else {
        const created = await createResource<Customer>('customers', formData as Customer);
        if (created?.id && typedPassword) {
          setIssuedPasswords(prev => ({ ...prev, [created.id]: typedPassword }));
        }
      }
      setIsModalOpen(false);
      loadData();
    } catch (err: any) {
      console.error('Save customer error:', err);
      setFormError(err.message || 'Gagal menyimpan data pelanggan.');
    }
  };

  /** Returns true when the user confirmed the deletion. */
  const handleDelete = async (id: string) => {
    const customer = customers.find(c => c.id === id);
    const approved = await confirm({
      title: `Hapus pelanggan ${customer?.name || id}?`,
      message: 'Data pelanggan beserta akses portalnya dihapus permanen. Riwayat pesanan yang sudah ada tidak ikut terhapus.',
      confirmLabel: 'Hapus Pelanggan',
      tone: 'danger'
    });
    if (!approved) return false;
    try {
      await deleteResource('customers', id);
      loadData();
      showToast(`Pelanggan ${customer?.name || id} dihapus.`);
    } catch (err: any) {
      // e.g. 409: the customer still has orders or quotations — the server says which.
      showToast(err?.message || 'Gagal menghapus pelanggan. Coba lagi.', 'error');
      return false;
    }
    return true;
  };

  const getCustomerOrders = (customerId: string) => {
    return orders.filter(o => o.customerId === customerId);
  };

  const getCustomerLtv = (customerId: string) => {
    return orders
      .filter(o => o.customerId === customerId)
      .reduce((sum, o) => sum + (Number(o.totalPrice) || 0), 0);
  };

  const filteredCustomers = useMemo(() => {
    return newestFirst(customers.filter(c => {
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        (c.name || '').toLowerCase().includes(q) ||
        (c.company || '').toLowerCase().includes(q) ||
        (c.phone || c.contact || '').toLowerCase().includes(q) ||
        (c.id || '').toLowerCase().includes(q) ||
        (c.username || '').toLowerCase().includes(q) ||
        (c.address || '').toLowerCase().includes(q);

      const matchesStatus = statusFilter === 'ALL' || c.status === statusFilter;
      return matchesSearch && matchesStatus;
    }));
  }, [customers, searchQuery, statusFilter]);

  const activeCount = useMemo(() => customers.filter(c => c.status === 'Active').length, [customers]);
  const totalLtv = useMemo(() => orders.reduce((sum, o) => sum + (Number(o.totalPrice) || 0), 0), [orders]);
  const activeOrdersCount = useMemo(() => orders.filter(o => o.status !== 'Completed').length, [orders]);
  const avgLtv = useMemo(() => (customers.length > 0 ? Math.round(totalLtv / customers.length) : 0), [customers, totalLtv]);

  const handleExport = () => {
    const exportData = customers.map(c => ({
      'ID Pelanggan': c.id,
      'Nama PIC': c.name,
      'Instansi / Perusahaan': c.company || '-',
      'Kontak WhatsApp': c.phone || c.contact || '-',
      'Email': c.email || '-',
      'Username Portal': c.username || '-',
      'Status Akses Portal': c.portalAccessActive !== false ? 'Aktif' : 'Nonaktif',
      'Alamat Pengiriman': c.address || '-',
      'Total Order': getCustomerOrders(c.id).length,
      'Total Belanja (LTV)': getCustomerLtv(c.id),
      'Status Klien': c.status || 'Active'
    }));
    exportTableToExcel(exportData, 'Database_Pelanggan_HIJ_Konveksi');
  };

  const hasActiveFilters = searchQuery !== '' || statusFilter !== 'ALL';
  const resetFilters = () => {
    setSearchQuery('');
    setStatusFilter('ALL');
  };

  // Drawer data for the selected customer
  const detailOrders = detailCustomer ? getCustomerOrders(detailCustomer.id) : [];
  const detailLtv = detailCustomer ? getCustomerLtv(detailCustomer.id) : 0;
  const detailPhone = detailCustomer ? detailCustomer.phone || detailCustomer.contact || '' : '';
  const detailCleanPhone = detailPhone.replace(/[^0-9]/g, '');
  const detailHasAudit = !!detailCustomer && !!(detailCustomer.user || detailCustomer.timestamp || detailCustomer.updatedAt);

  const retentionPct = customers.length > 0 ? Math.round((activeCount / customers.length) * 100) : 0;
  const usernameInvalid = !!formData.username && !usernameValidation.valid;
  /*
   * Credentials are only mandatory when an account is being created with portal
   * access on. On edit an empty password means "keep the current one", and the
   * server is the authority on username rules either way.
   */
  const usernameRequired = !isEditMode && formData.portalAccessActive !== false;
  const passwordRequired = !isEditMode;

  return (
    <div className="space-y-6">
      {/* Toast notification for copied credentials */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed top-4 left-4 right-4 z-[60] flex justify-end sm:top-6 sm:left-auto sm:right-6"
      >
        {copyToast && (
          <div className="pointer-events-auto flex w-full items-center gap-3 rounded-xl border border-teal-500/40 bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-lg sm:w-auto sm:max-w-sm">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-teal-500/20 text-teal-300" aria-hidden="true">
              <Check size={18} />
            </span>
            <span className="min-w-0 break-words">{copyToast}</span>
          </div>
        )}
      </div>

      <PageHeader
        title="Pelanggan"
        description="Data pelanggan, akses portal klien, dan riwayat belanja."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download size={16} aria-hidden="true" /> Unduh Excel
            </Button>
            <Button size="sm" onClick={handleOpenAdd}>
              <Plus size={16} aria-hidden="true" /> Tambah Pelanggan
            </Button>
          </>
        }
      />

      {/* METRIC CARDS */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3">
        <Card className="min-w-0 p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-xs font-semibold text-slate-500">Total Pelanggan</span>
            <Users size={16} className="shrink-0 text-brand-teal-dark" aria-hidden="true" />
          </div>
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5">
            <span className="text-2xl font-bold tabular-nums text-slate-900">{customers.length}</span>
            <span className="text-xs text-slate-500">Entitas Mitra</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-slate-500">
            <span className="font-semibold text-slate-700">{activeCount} Klien Aktif</span>
            <span>{retentionPct}% Tingkat Retensi</span>
          </div>
        </Card>

        <Card className="min-w-0 p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-xs font-semibold text-slate-500">Aktivitas Pesanan</span>
            <ShoppingBag size={16} className="shrink-0 text-brand-teal-dark" aria-hidden="true" />
          </div>
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5">
            <span className="text-2xl font-bold tabular-nums text-slate-900">{orders.length}</span>
            <span className="text-xs text-slate-500">Surat Perintah Kerja</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-slate-500">
            <span className="font-semibold text-slate-700">{activeOrdersCount} Sedang Diproduksi</span>
            <span>{orders.length - activeOrdersCount} Pesanan Selesai</span>
          </div>
        </Card>

        <Card className="col-span-2 min-w-0 p-4 xl:col-span-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-xs font-semibold text-slate-500">Akumulasi Belanja (LTV)</span>
            <CreditCard size={16} className="shrink-0 text-brand-teal-dark" aria-hidden="true" />
          </div>
          <div className="mt-1.5 min-w-0">
            <span
              className="block truncate whitespace-nowrap text-2xl font-bold tabular-nums text-slate-900"
              title={formatCurrency(totalLtv)}
            >
              {formatCurrency(totalLtv)}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs text-slate-500">
            <span>Rata-rata Nilai Mitra:</span>
            <span className="whitespace-nowrap font-semibold tabular-nums text-slate-700">{formatCurrency(avgLtv)}</span>
          </div>
        </Card>
      </div>

      {/* FILTER & SEARCH BAR */}
      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-md sm:flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <Input
            type="search"
            aria-label="Cari pelanggan"
            placeholder="Cari nama PIC, perusahaan, WhatsApp, username, atau ID…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 pr-10 [&::-webkit-search-cancel-button]:appearance-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Hapus pencarian"
              className="absolute right-1 top-1/2 inline-flex size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-muted hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal"
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div
            role="group"
            aria-label="Filter status pelanggan"
            className="flex flex-1 divide-x divide-border overflow-hidden rounded-lg border border-border sm:flex-none"
          >
            {(['ALL', 'Active', 'Inactive'] as const).map(status => {
              const count =
                status === 'ALL'
                  ? customers.length
                  : status === 'Active'
                  ? activeCount
                  : customers.length - activeCount;

              const isSelected = statusFilter === status;
              return (
                <button
                  key={status}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => setStatusFilter(status)}
                  className={`inline-flex h-10 flex-1 cursor-pointer items-center justify-center gap-1.5 px-3 text-sm font-semibold transition-colors focus-visible:relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-teal sm:flex-none ${
                    isSelected
                      ? 'bg-teal-50 text-brand-teal-dark'
                      : 'bg-white text-slate-600 hover:bg-muted hover:text-slate-900'
                  }`}
                >
                  <span>{status === 'ALL' ? 'Semua' : statusLabel(status)}</span>
                  <span
                    className={`rounded-full px-1.5 text-xs tabular-nums ${
                      isSelected ? 'bg-teal-100 text-teal-900' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          <Button
            variant="outline"
            size="icon"
            onClick={loadData}
            aria-label="Muat ulang data pelanggan"
            title="Muat ulang data pelanggan"
            className="size-10 shrink-0"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin motion-reduce:animate-none' : ''} aria-hidden="true" />
          </Button>
        </div>
      </Card>

      {/* CUSTOMER DATA TABLE */}
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="cell-sticky-start">ID</TableHead>
              <TableHead className="hidden md:table-cell">Nama</TableHead>
              <TableHead className="hidden md:table-cell">Perusahaan</TableHead>
              <TableHead className="hidden 2xl:table-cell">Kontak</TableHead>
              <TableHead className="hidden sm:table-cell text-right tabular-nums">Total Belanja</TableHead>
              <TableHead className="hidden sm:table-cell text-right tabular-nums">Total Pesanan</TableHead>
              <TableHead className="text-center">Status</TableHead>
              <TableHead className="cell-sticky-end text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableSkeletonRows columns={8} />
            ) : filteredCustomers.length === 0 ? (
              <TableEmptyRow
                colSpan={8}
                icon={<Users size={20} />}
                title={hasActiveFilters ? 'Pelanggan tidak ditemukan' : 'Belum ada pelanggan'}
                description={
                  hasActiveFilters
                    ? 'Tidak ada data yang cocok dengan pencarian atau filter status. Coba kata kunci lain.'
                    : 'Tambahkan pelanggan pertama untuk membuat akses portal dan mencatat pesanannya.'
                }
                action={
                  hasActiveFilters ? (
                    <Button variant="outline" size="sm" onClick={resetFilters}>
                      Reset Filter
                    </Button>
                  ) : (
                    <Button size="sm" onClick={handleOpenAdd}>
                      <Plus size={16} aria-hidden="true" /> Tambah Pelanggan
                    </Button>
                  )
                }
              />
            ) : (
              filteredCustomers.map((cust) => {
                const orderCount = getCustomerOrders(cust.id).length;
                const ltv = getCustomerLtv(cust.id);
                const rawPhone = cust.phone || cust.contact || '';
                const cleanPhone = rawPhone.replace(/[^0-9]/g, '');

                return (
                  <TableRow key={cust.id}>
                    <TableCell className="cell-sticky-start whitespace-nowrap">
                      <span className="font-mono font-bold text-slate-900">{cust.id}</span>
                    </TableCell>

                    <TableCell className="hidden md:table-cell font-semibold text-slate-900">
                      <span className="block max-w-[140px] truncate" title={cust.name}>
                        {cust.name}
                      </span>
                    </TableCell>

                    <TableCell className="hidden md:table-cell text-slate-600">
                      <span className="block max-w-[140px] truncate" title={cust.company || 'Perorangan'}>
                        {cust.company || 'Perorangan'}
                      </span>
                    </TableCell>

                    <TableCell className="hidden 2xl:table-cell whitespace-nowrap">
                      {cleanPhone ? (
                        <a
                          href={`https://wa.me/${cleanPhone}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Buka WhatsApp"
                          className="inline-flex min-h-8 items-center gap-1.5 rounded text-sm font-semibold text-brand-teal-dark hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal"
                        >
                          <MessageCircle size={14} className="shrink-0" aria-hidden="true" />
                          <span className="sr-only">WhatsApp </span>
                          <span className="font-mono">{rawPhone}</span>
                        </a>
                      ) : (
                        <span className="text-sm text-slate-400">—</span>
                      )}
                    </TableCell>

                    <TableCell className="hidden sm:table-cell text-right tabular-nums whitespace-nowrap font-bold text-slate-900">
                      {formatCurrency(ltv)}
                    </TableCell>

                    <TableCell className="hidden sm:table-cell text-right tabular-nums whitespace-nowrap text-slate-600">
                      {orderCount} pesanan
                    </TableCell>

                    <TableCell className="text-center whitespace-nowrap">
                      <StatusBadge status={cust.status || 'Active'} size="sm" solid />
                    </TableCell>

                    <TableCell className="cell-sticky-end text-right">
                      <TableRowActions>
                        <RowActionButton
                          label="Ubah"
                          icon={Edit}
                          onClick={() => handleOpenEdit(cust)}
                          ariaLabel={`Ubah data pelanggan ${cust.name}`}
                          title="Ubah data pelanggan"
                        />
                        <RowActionButton
                          label="Hapus"
                          icon={Trash2}
                          tone="danger"
                          onClick={() => handleDelete(cust.id)}
                          ariaLabel={`Hapus pelanggan ${cust.name}`}
                          title="Hapus pelanggan"
                        />
                        <RowDetailButton label={cust.name || cust.id} onClick={() => setDetailCustomer(cust)} />
                      </TableRowActions>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>

      {/* CUSTOMER DETAIL DRAWER */}
      <DetailDrawer
        size="lg"
        isOpen={!!detailCustomer}
        onClose={() => setDetailCustomer(null)}
        title={detailCustomer?.name}
        subtitle={
          detailCustomer && (
            <span className="min-w-0 break-words">
              <span className="font-mono">{detailCustomer.id}</span> · {detailCustomer.company || 'Perorangan'}
            </span>
          )
        }
        status={detailCustomer && <StatusBadge status={detailCustomer.status || 'Active'} />}
        footer={
          detailCustomer && (
            <>
              {detailCleanPhone && (
                <a
                  href={`https://wa.me/${detailCleanPhone}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={outlineLinkClass}
                >
                  <MessageCircle size={16} aria-hidden="true" /> Chat WhatsApp
                </a>
              )}
              {onPreviewCustomerPortal && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    onPreviewCustomerPortal(detailCustomer);
                    setDetailCustomer(null);
                  }}
                >
                  <ExternalLink size={16} aria-hidden="true" /> Pratinjau Portal
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  const deleted = await handleDelete(detailCustomer.id);
                  if (deleted) setDetailCustomer(null);
                }}
                className="text-brand-red hover:bg-rose-50 hover:text-brand-red"
              >
                <Trash2 size={16} aria-hidden="true" /> Hapus
              </Button>
              <Button
                type="button"
                onClick={() => {
                  const custToEdit = detailCustomer;
                  setDetailCustomer(null);
                  handleOpenEdit(custToEdit);
                }}
              >
                <Edit size={16} aria-hidden="true" /> Ubah Data
              </Button>
            </>
          )
        }
      >
        {detailCustomer && (
          <>
            <DetailStats
              items={[
                { label: 'Pesanan', value: `${detailOrders.length} pesanan` },
                { label: 'Total belanja', value: formatCurrency(detailLtv), tone: 'accent' },
                {
                  label: 'Rata-rata per pesanan',
                  value: formatCurrency(detailOrders.length > 0 ? Math.round(detailLtv / detailOrders.length) : 0)
                }
              ]}
            />

            <DetailSection title="Identitas">
              <DetailField label="Nama PIC">{detailCustomer.name}</DetailField>
              <DetailField label="Perusahaan / instansi">{detailCustomer.company || 'Perorangan'}</DetailField>
              <DetailField label="ID pelanggan" mono>{detailCustomer.id}</DetailField>
              <DetailField label="Status">
                <StatusBadge status={detailCustomer.status || 'Active'} />
              </DetailField>
            </DetailSection>

            <DetailSection title="Kontak & Alamat">
              <DetailField label="WhatsApp" mono>
                {detailCleanPhone && (
                  <a
                    href={`https://wa.me/${detailCleanPhone}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-teal-dark underline-offset-2 hover:underline"
                  >
                    {detailPhone}
                  </a>
                )}
              </DetailField>
              <DetailField label="Email">
                {detailCustomer.email && (
                  <a
                    href={`mailto:${detailCustomer.email}`}
                    className="break-all text-brand-teal-dark underline-offset-2 hover:underline"
                  >
                    {detailCustomer.email}
                  </a>
                )}
              </DetailField>
              <DetailField label="Alamat pengiriman" full>{detailCustomer.address}</DetailField>
            </DetailSection>

            <DetailBlock title="Akses Portal">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5">
                <DetailField label="Status akses">
                  {detailCustomer.portalAccessActive !== false ? (
                    <Badge variant="teal">Aktif</Badge>
                  ) : (
                    <Badge variant="rose">Dinonaktifkan</Badge>
                  )}
                </DetailField>
                <DetailField label="Username" mono>
                  <span className="select-all">
                    {detailCustomer.username || suggestUsername(detailCustomer.name, detailCustomer.company)}
                  </span>
                </DetailField>
                <DetailField label="Kata sandi">
                  {issuedPasswords[detailCustomer.id] ? (
                    <span className="select-all font-mono">{issuedPasswords[detailCustomer.id]}</span>
                  ) : (
                    <span className="text-muted-foreground">
                      Tersimpan terenkripsi — tidak bisa dibaca lagi. Buka <b>Ubah</b> untuk mengatur kata sandi baru.
                    </span>
                  )}
                </DetailField>
              </dl>
              <div className="mt-4 space-y-2">
                <Button type="button" variant="outline" size="sm" onClick={() => handleCopyCredentials(detailCustomer)} className="h-10">
                  <Copy size={16} aria-hidden="true" /> Salin kredensial WhatsApp
                </Button>
                <p className="text-xs text-slate-500 text-pretty">
                  Klien membuka portal di <span className="font-mono break-all">{PORTAL_URL}</span> untuk melacak SPK, konfirmasi desain/sampel, melihat invoice, dan klaim garansi.
                </p>
              </div>
            </DetailBlock>

            <DetailBlock title={`Riwayat Pesanan (${detailOrders.length})`}>
              {detailOrders.length === 0 ? (
                <p className="text-sm text-slate-500">
                  Belum ada riwayat pesanan. Klien ini belum memiliki pesanan SPK di sistem.
                </p>
              ) : (
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {detailOrders.map((o) => (
                    <li key={o.id} className="flex items-start justify-between gap-3 px-3 py-3">
                      <div className="min-w-0 space-y-0.5">
                        <div className="font-semibold text-slate-900 break-words">{o.productType}</div>
                        <div className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                          <span className="font-mono text-slate-700">{o.po || o.id}</span>
                          <span aria-hidden="true">·</span>
                          <span>{o.quantity} Pcs</span>
                          <span aria-hidden="true">·</span>
                          <span className="whitespace-nowrap">Deadline {formatDate(o.deadline)}</span>
                        </div>
                      </div>
                      <div className="shrink-0 space-y-1 text-right">
                        <div className="whitespace-nowrap text-sm font-bold tabular-nums text-slate-900">
                          {formatCurrency(o.totalPrice)}
                        </div>
                        <StatusBadge status={o.status} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </DetailBlock>

            {detailHasAudit && (
              <DetailSection title="Riwayat Data">
                <DetailField label="Dicatat oleh">{detailCustomer.user}</DetailField>
                <DetailField label="Dicatat pada">
                  {detailCustomer.timestamp && formatDateTime(detailCustomer.timestamp)}
                </DetailField>
                {detailCustomer.updatedAt && (
                  <DetailField label="Diperbarui pada">{formatDateTime(detailCustomer.updatedAt)}</DetailField>
                )}
              </DetailSection>
            )}
          </>
        )}
      </DetailDrawer>

      {/* ADD / EDIT CUSTOMER MODAL */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={isEditMode ? 'Ubah Data Mitra Pelanggan' : 'Tambah Mitra Pelanggan Baru'}
        subtitle="Identitas, kontak, dan akses portal pelacakan mandiri untuk klien."
        maxWidth="lg"
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>
              Batal
            </Button>
            <Button type="submit" form="customer-form">
              {isEditMode ? 'Simpan Perubahan' : 'Tambah Pelanggan'}
            </Button>
          </div>
        }
      >
        <form id="customer-form" onSubmit={handleSubmit} className="space-y-5">
          <FormError>{formError}</FormError>
          <FormSection
            step={1}
            title="Identitas"
            description="Siapa yang dihubungi dan instansi yang diwakilinya."
            aside={
              <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs font-bold text-brand-teal-dark">
                {formData.id}
              </span>
            }
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <FieldLabel htmlFor="cust-name" required>Nama PIC</FieldLabel>
                <Input
                  id="cust-name"
                  type="text"
                  required
                  placeholder="Nama penanggung jawab"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>

              <div>
                <FieldLabel htmlFor="cust-company" aside="Opsional">Perusahaan / Instansi</FieldLabel>
                <Input
                  id="cust-company"
                  type="text"
                  placeholder="Nama perusahaan"
                  value={formData.company}
                  onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                />
              </div>

              <div>
                <FieldLabel htmlFor="cust-status">Status Mitra</FieldLabel>
                <Select
                  id="cust-status"
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                >
                  <option value="Active">{statusLabel('Active')}</option>
                  <option value="Inactive">{statusLabel('Inactive')}</option>
                </Select>
              </div>
            </div>
          </FormSection>

          <FormSection
            step={2}
            title="Kontak"
            description="Nomor WhatsApp dipakai untuk koordinasi produksi dan pengiriman kredensial portal."
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <FieldLabel htmlFor="cust-phone" required>Nomor WhatsApp</FieldLabel>
                <Input
                  id="cust-phone"
                  type="tel"
                  inputMode="tel"
                  required
                  placeholder="08xxxxxxxxxx"
                  value={formData.phone || formData.contact}
                  aria-describedby="cust-phone-hint"
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value, contact: e.target.value })}
                />
                <FieldHint id="cust-phone-hint">Nomor aktif; 4 digit terakhirnya dipakai untuk saran username.</FieldHint>
              </div>

              <div>
                <FieldLabel htmlFor="cust-email" aside="Opsional">Email</FieldLabel>
                <Input
                  id="cust-email"
                  type="email"
                  inputMode="email"
                  placeholder="nama@perusahaan.com"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                />
              </div>

              <div className="sm:col-span-2">
                <FieldLabel htmlFor="cust-address" aside="Opsional">Alamat pengiriman</FieldLabel>
                <Textarea
                  id="cust-address"
                  rows={3}
                  placeholder="Jalan, RT/RW, kelurahan, kecamatan, kota/kabupaten, provinsi, kode pos"
                  value={formData.address || ''}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                />
              </div>
            </div>
          </FormSection>

          <FormSection
            step={3}
            title="Akses portal pelanggan"
            description="Kredensial login klien untuk memantau pesanan secara mandiri; dikelola staf internal."
            aside={
              <label htmlFor="cust-portal-active" className="relative inline-flex min-h-11 cursor-pointer items-center">
                <input
                  id="cust-portal-active"
                  type="checkbox"
                  role="switch"
                  aria-label="Akses portal klien"
                  checked={formData.portalAccessActive !== false}
                  onChange={(e) => setFormData({ ...formData, portalAccessActive: e.target.checked })}
                  className="peer sr-only"
                />
                <div
                  aria-hidden="true"
                  className="relative h-5 w-9 rounded-full bg-slate-300 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:border after:border-slate-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-brand-teal-dark peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus-visible:ring-2 peer-focus-visible:ring-brand-teal peer-focus-visible:ring-offset-2"
                ></div>
                <span className="ml-2 text-xs font-bold text-foreground" aria-hidden="true">
                  {formData.portalAccessActive !== false ? 'Aktif' : 'Nonaktif'}
                </span>
              </label>
            }
          >
            <FormNotice icon={<ShieldCheck size={16} />} title="Standar username">
              Format yang disarankan <strong className="font-mono">[brand].[4 digit WA]</strong>, misalnya{' '}
              <span className="font-mono font-bold">namabrand.1234</span>. Sulit ditebak dan mudah diingat klien.
            </FormNotice>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <FieldLabel htmlFor="cust-username" required={usernameRequired}>Username portal</FieldLabel>
                <Input
                  id="cust-username"
                  type="text"
                  required={usernameRequired}
                  autoComplete="off"
                  placeholder="brand.1234"
                  value={formData.username || ''}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value.toLowerCase().replace(/\s+/g, '') })}
                  aria-invalid={usernameInvalid}
                  aria-describedby={usernameInvalid ? 'cust-username-error' : 'cust-username-hint'}
                  className="font-mono"
                />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <ChipButton
                    className={touchChipClass}
                    title="Buat format brand.4digitWA"
                    onClick={() => {
                      const suggested = suggestUsername(formData.name || '', formData.company, formData.phone || formData.contact, 'phone');
                      setFormData({ ...formData, username: suggested });
                    }}
                  >
                    <Sparkles size={12} className="mr-1" aria-hidden="true" /> Saran dari WA
                  </ChipButton>
                  <ChipButton
                    className={touchChipClass}
                    title="Buat format brand.tahun"
                    onClick={() => {
                      const suggested = suggestUsername(formData.name || '', formData.company, formData.phone || formData.contact, 'year');
                      setFormData({ ...formData, username: suggested });
                    }}
                  >
                    Saran dari tahun
                  </ChipButton>
                </div>

                {/* Live validation feedback */}
                <div aria-live="polite">
                  {formData.username ? (
                    usernameValidation.valid ? (
                      <FieldHint id="cust-username-hint" className="flex items-start gap-1.5 font-semibold text-emerald-700">
                        <Check size={14} className="mt-px shrink-0" aria-hidden="true" />
                        <span>{usernameValidation.message}</span>
                      </FieldHint>
                    ) : (
                      <FieldError id="cust-username-error">{usernameValidation.message}</FieldError>
                    )
                  ) : (
                    <FieldHint id="cust-username-hint">
                      Minimal 5 karakter: huruf kecil, angka, titik, strip, atau underscore.
                    </FieldHint>
                  )}
                </div>
              </div>

              <div>
                <FieldLabel htmlFor="cust-password" required={passwordRequired}>Kata sandi portal</FieldLabel>
                <Input
                  id="cust-password"
                  type="text"
                  required={passwordRequired}
                  autoComplete="off"
                  placeholder="Kata sandi portal"
                  value={formData.password || ''}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  aria-describedby="cust-password-hint"
                  className="font-mono"
                />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <ChipButton
                    className={touchChipClass}
                    title="Buat sandi acak kuat dan mudah diingat"
                    onClick={() => {
                      const newPass = generateSecurePassword(formData.name || '', formData.company);
                      setFormData({ ...formData, password: newPass });
                    }}
                  >
                    <KeyRound size={12} className="mr-1" aria-hidden="true" /> Acak sandi kuat
                  </ChipButton>
                </div>
                <FieldHint id="cust-password-hint">
                  {isEditMode
                    ? 'Kosongkan untuk mempertahankan kata sandi yang sekarang.'
                    : 'Catat atau salin sekarang; setelah disimpan, kata sandi tidak bisa dibaca lagi.'}
                </FieldHint>
              </div>
            </div>
          </FormSection>
        </form>
      </Modal>

      <Toast toast={toast} />
      {confirmDialog}
    </div>
  );
};
