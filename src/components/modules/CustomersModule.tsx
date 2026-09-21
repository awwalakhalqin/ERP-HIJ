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
  AlertCircle,
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
import { PageHeader } from '../ui/PageHeader';
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell, TableRowActions, TableEmptyRow, TableSkeletonRows } from '../ui/Table';
import { DetailDrawer, DetailSection, DetailField, DetailStats, DetailBlock, RowDetailButton } from '../ui/DetailDrawer';
import { newestFirst } from '../../lib/ordering';

const labelClass = 'block text-sm font-medium text-slate-700 mb-1.5';
const fieldClass = 'w-full h-10 px-3 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-600';
const hintClass = 'mt-1.5 block text-xs text-slate-500';
const suggestButtonClass = 'inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-semibold transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal';
// Matches <Button variant="outline"> for links that must stay anchors (WhatsApp).
const outlineLinkClass = 'inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-white px-4 text-sm font-semibold text-foreground shadow-2xs transition-all duration-150 hover:bg-muted hover:border-brand-teal/60 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal focus-visible:ring-offset-2';

const PORTAL_URL = 'https://konveksi.hij.co.id/portal';

interface CustomersModuleProps {
  onPreviewCustomerPortal?: (customer: Customer) => void;
}

export const CustomersModule: React.FC<CustomersModuleProps> = ({ onPreviewCustomerPortal }) => {
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
    const text = `*KREDENSIAL PORTAL PELANGGAN HIJ KONVEKSI*\n\nHalo ${cust.name || 'Pelanggan'},\nBerikut akses resmi untuk login ke Portal Pelanggan HIJ Konveksi:\n- *Link Portal*: https://konveksi.hij.co.id/portal\n- *Username / No. WA*: ${uname}\n- *Kata Sandi*: ${pwd}\n- *WhatsApp CS Resmi*: ${COMPANY_CONTACT.whatsappFormatted}\n\nMelalui portal ini Anda dapat:\n1. Memantau progres SPK dan tahapan jahit secara real-time\n2. Melakukan konfirmasi approval desain & sampel\n3. Melihat invoice dan mengunggah bukti bayar\n4. Memeriksa nomor resi pengiriman barang\n5. Melacak riwayat semua pesanan dan mengajukan Repeat Order via WhatsApp\n\nJika ada kendala login atau pertanyaan produksi, silakan hubungi WhatsApp CS kami di ${COMPANY_CONTACT.whatsappFormatted}.\n\nTerima kasih atas kepercayaannya bermitra dengan PT Hasil Inti Jualan.`;
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
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name?.trim()) {
      alert('Nama pelanggan wajib diisi.');
      return;
    }

    if (formData.portalAccessActive !== false && formData.username) {
      const val = validateUsername(formData.username, selectedCustomer?.id);
      if (!val.valid) {
        alert(`Validasi Username Gagal: ${val.message}`);
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
      alert(err.message || 'Gagal menyimpan data pelanggan.');
    }
  };

  /** Returns true when the user confirmed the deletion. */
  const handleDelete = async (id: string) => {
    if (window.confirm(`Hapus data pelanggan ${id}? Tindakan ini tidak dapat dibatalkan.`)) {
      try {
        await deleteResource('customers', id);
        loadData();
      } catch (err) {
        console.error('Delete customer error:', err);
      }
      return true;
    }
    return false;
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
              <TableHead className="hidden md:table-cell">Kontak</TableHead>
              <TableHead className="hidden sm:table-cell text-right">Total Belanja</TableHead>
              <TableHead className="hidden sm:table-cell text-right">Total Pesanan</TableHead>
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

                    <TableCell className="hidden md:table-cell font-semibold text-slate-900 break-words">
                      {cust.name}
                    </TableCell>

                    <TableCell className="hidden md:table-cell max-w-[220px] truncate text-slate-600" title={cust.company || 'Perorangan'}>
                      {cust.company || 'Perorangan'}
                    </TableCell>

                    <TableCell className="hidden md:table-cell whitespace-nowrap">
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

                    <TableCell className="hidden sm:table-cell text-right whitespace-nowrap font-bold text-slate-900">
                      {formatCurrency(ltv)}
                    </TableCell>

                    <TableCell className="hidden sm:table-cell text-right whitespace-nowrap text-slate-600">
                      {orderCount} pesanan
                    </TableCell>

                    <TableCell className="text-center whitespace-nowrap">
                      <StatusBadge status={cust.status || 'Active'} />
                    </TableCell>

                    <TableCell className="cell-sticky-end text-right">
                      <TableRowActions>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => handleOpenEdit(cust)}
                          aria-label={`Ubah data pelanggan ${cust.name}`}
                          title="Ubah data pelanggan"
                          className="hidden size-8 sm:inline-flex"
                        >
                          <Edit size={14} aria-hidden="true" />
                        </Button>
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
        maxWidth="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-5 text-sm">
          {/* Section 1: Data Identitas Pelanggan */}
          <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/70 pb-2.5">
              <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
                <Users size={16} className="text-teal-700" aria-hidden="true" /> Profil PIC & Instansi
              </h3>
              <span className="rounded-md bg-teal-100/70 px-2 py-0.5 font-mono text-xs font-bold text-teal-800">
                {formData.id}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="cust-name" className={labelClass}>Nama Lengkap PIC *</label>
                <Input
                  id="cust-name"
                  type="text"
                  required
                  placeholder="Contoh: Muhammad Ihsan"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>

              <div>
                <label htmlFor="cust-company" className={labelClass}>Perusahaan / Instansi</label>
                <Input
                  id="cust-company"
                  type="text"
                  placeholder="Contoh: PT Arkato Kreasi"
                  value={formData.company}
                  onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="cust-status" className={labelClass}>Status Mitra</label>
                <select
                  id="cust-status"
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                  className={fieldClass}
                >
                  <option value="Active">{statusLabel('Active')}</option>
                  <option value="Inactive">{statusLabel('Inactive')}</option>
                </select>
              </div>

              <div>
                <label htmlFor="cust-phone" className={labelClass}>Nomor WhatsApp *</label>
                <Input
                  id="cust-phone"
                  type="tel"
                  required
                  placeholder="08xxxxxxxxxx"
                  value={formData.phone || formData.contact}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value, contact: e.target.value })}
                />
              </div>

              <div>
                <label htmlFor="cust-email" className={labelClass}>Email (Opsional)</label>
                <Input
                  id="cust-email"
                  type="email"
                  placeholder="klien@perusahaan.com"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                />
              </div>
            </div>
          </div>

          {/* Section 2: Kredensial Akses Portal Pelanggan */}
          <div className="space-y-4 rounded-xl border border-teal-200/80 bg-teal-50/70 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-teal-600 text-white" aria-hidden="true">
                  <ShieldCheck size={16} />
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-slate-900">Kredensial Portal Klien (Anti-Hack)</h3>
                  <p className="text-xs text-slate-500">Dikelola staf internal untuk login pelacakan mandiri</p>
                </div>
              </div>

              <label htmlFor="cust-portal-active" className="relative inline-flex min-h-10 cursor-pointer items-center">
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
                  className="relative h-5 w-9 rounded-full bg-slate-300 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:border after:border-slate-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-teal-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus-visible:ring-2 peer-focus-visible:ring-teal-600 peer-focus-visible:ring-offset-2"
                ></div>
                <span className="ml-2 text-xs font-bold text-slate-700" aria-hidden="true">
                  {formData.portalAccessActive !== false ? 'Aktif' : 'Nonaktif'}
                </span>
              </label>
            </div>

            <div className="space-y-1 rounded-lg border border-teal-100 bg-white p-3 text-xs text-slate-600">
              <div className="flex items-center gap-1.5 font-bold text-teal-900">
                <Sparkles size={14} className="text-brand-teal-dark" aria-hidden="true" /> Standar Keamanan Username:
              </div>
              <p className="leading-relaxed text-slate-600">
                Format standar yang disarankan: <strong className="font-mono text-teal-800">[brand].[4digitWA]</strong> (contoh: <span className="rounded bg-teal-50 px-1 py-0.5 font-mono font-bold text-teal-800">arkato.7766</span>). Sangat aman dari brute force dan mudah diingat oleh klien.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                  <label htmlFor="cust-username" className="text-sm font-medium text-slate-700">Username Portal *</label>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        const suggested = suggestUsername(formData.name || '', formData.company, formData.phone || formData.contact, 'phone');
                        setFormData({ ...formData, username: suggested });
                      }}
                      className={`${suggestButtonClass} bg-teal-100/90 text-teal-800 hover:bg-teal-200 hover:text-teal-950`}
                      title="Buat format brand.4digitWA"
                    >
                      <Sparkles size={12} aria-hidden="true" /> Saran WA
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const suggested = suggestUsername(formData.name || '', formData.company, formData.phone || formData.contact, 'year');
                        setFormData({ ...formData, username: suggested });
                      }}
                      className={`${suggestButtonClass} bg-slate-200/80 text-slate-700 hover:bg-slate-300 hover:text-slate-900`}
                      title="Buat format brand.tahun"
                    >
                      Tahun
                    </button>
                  </div>
                </div>
                <Input
                  id="cust-username"
                  type="text"
                  required
                  autoComplete="off"
                  placeholder="Contoh: arkato.7766"
                  value={formData.username || ''}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value.toLowerCase().replace(/\s+/g, '') })}
                  aria-invalid={usernameInvalid}
                  aria-describedby="cust-username-hint"
                  className="font-mono"
                />

                {/* Live validation feedback */}
                <div id="cust-username-hint" className="mt-1.5 text-xs" aria-live="polite">
                  {formData.username ? (
                    usernameValidation.valid ? (
                      <span className="flex items-start gap-1 font-semibold text-emerald-700">
                        <Check size={14} className="mt-px shrink-0" aria-hidden="true" /> {usernameValidation.message}
                      </span>
                    ) : (
                      <span className="flex items-start gap-1 font-semibold text-rose-600">
                        <AlertCircle size={14} className="mt-px shrink-0" aria-hidden="true" /> {usernameValidation.message}
                      </span>
                    )
                  ) : (
                    <span className="text-slate-500">Minimal 5 karakter alfanumerik unik</span>
                  )}
                </div>
              </div>

              <div>
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                  <label htmlFor="cust-password" className="text-sm font-medium text-slate-700">Kata Sandi Portal *</label>
                  <button
                    type="button"
                    onClick={() => {
                      const newPass = generateSecurePassword(formData.name || '', formData.company);
                      setFormData({ ...formData, password: newPass });
                    }}
                    className={`${suggestButtonClass} bg-teal-100/90 text-teal-800 hover:bg-teal-200 hover:text-teal-950`}
                    title="Buat sandi acak kuat dan mudah diingat"
                  >
                    <KeyRound size={12} aria-hidden="true" /> Acak Sandi Kuat
                  </button>
                </div>
                <Input
                  id="cust-password"
                  type="text"
                  required
                  autoComplete="off"
                  placeholder="Contoh: HijArkato#782"
                  value={formData.password || ''}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  aria-describedby="cust-password-hint"
                  className="font-mono"
                />
                <span id="cust-password-hint" className={hintClass}>
                  {isEditMode
                    ? 'Kosongkan untuk mempertahankan kata sandi yang sekarang.'
                    : 'Catat atau salin sekarang — setelah disimpan, kata sandi tidak bisa dibaca lagi.'}
                </span>
              </div>
            </div>
          </div>

          {/* Section 3: Alamat Pengiriman */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
            <label htmlFor="cust-address" className={labelClass}>Alamat Lengkap Pengiriman Logistik</label>
            <textarea
              id="cust-address"
              rows={3}
              placeholder="Jalan, RT/RW, Kelurahan, Kecamatan, Kota/Kabupaten, Provinsi, Kode Pos"
              value={formData.address || ''}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>

          {/* Modal Footer Buttons */}
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>
              Batal
            </Button>
            <Button type="submit">
              {isEditMode ? 'Simpan Perubahan' : 'Tambah Pelanggan'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
