import React, { useState, useEffect, useMemo } from 'react';
import {
  Wallet,
  Search,
  Plus,
  Download,
  Printer,
  AlertCircle,
  FileText,
  Check,
  ArrowDownLeft,
  ExternalLink,
  Send
} from 'lucide-react';
import { Invoice, Payment, Order, Customer, PaymentTerm } from '../../types';
import { fetchResource, updateResource } from '../../services/api';
import { cn, formatCurrency, formatDate, formatDateTime, statusLabel, exportTableToExcel, terbilangRupiah } from '../../lib/utils';
import { getCurrentUser } from '../../lib/session';
import { Badge, StatusBadge } from '../ui/Badge';
import { Modal } from '../ui/Modal';
import { exportElementToPdf } from '../../services/pdfGenerator';
import { InvoiceDocument } from '../documents/InvoiceDocument';
import { withAmounts } from '../ui/PaymentTermsEditor';
import { COMPANY_CONTACT } from '../../config/contact';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { FormError } from '../ui/Field';
import { PageHeader } from '../ui/PageHeader';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell, TableRowActions, TableEmptyRow, TableSkeletonRows } from '../ui/Table';
import { Tabs, TabsList, TabsTrigger } from '../ui/Tabs';
import { DetailDrawer, DetailSection, DetailField, DetailStats, DetailBlock, RowDetailButton } from '../ui/DetailDrawer';
import { newestFirst } from '../../lib/ordering';

const labelClass = 'block text-sm font-medium text-slate-700 mb-1.5';
const selectClass = 'w-full h-10 px-3 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-600';
const linkClass = 'inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-brand-teal-dark underline underline-offset-4 hover:text-slate-900';

export const FinanceModule: React.FC = () => {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  // Navigation & Filtering
  const [activeTab, setActiveTab] = useState<'invoices' | 'payments'>('invoices');
  const [searchQuery, setSearchQuery] = useState('');
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState<'Semua' | 'Belum Bayar' | 'DP Dibayar' | 'Lunas' | 'Jatuh Tempo'>('Semua');
  const [paymentMethodFilter, setPaymentMethodFilter] = useState<string>('Semua');

  // Modals
  const [isRecordPaymentOpen, setIsRecordPaymentOpen] = useState(false);
  const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState(false);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [printInvoice, setPrintInvoice] = useState<Invoice | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isDownloadingInvoice, setIsDownloadingInvoice] = useState(false);
  const [invoicePdfError, setInvoicePdfError] = useState<string | null>(null);

  // Row detail drawers (by id, so the drawer shows fresh data after a reload)
  const [detailInvoiceId, setDetailInvoiceId] = useState<string | null>(null);
  const [detailPaymentId, setDetailPaymentId] = useState<string | null>(null);

  // Form State: Catat Kas Masuk
  const [paymentForm, setPaymentForm] = useState({
    invoiceId: '',
    orderId: '',
    customerId: '',
    customerName: '',
    amount: 0,
    type: 'DP' as 'DP' | 'Pelunasan' | 'Cicilan',
    paymentMethod: 'Transfer Bank BCA',
    date: new Date().toISOString().split('T')[0],
    proofImageUrl: '',
    notes: '',
    selectedInvoiceTotal: 0,
    selectedInvoicePaid: 0,
    selectedInvoiceBalance: 0
  });

  // Form State: Buat Faktur Invoice
  const [newInvoice, setNewInvoice] = useState<Partial<Invoice>>({
    orderId: '',
    customerId: '',
    customerName: '',
    amount: 0,
    tax: 0,
    total: 0,
    downPaymentReceived: 0,
    balanceRemaining: 0,
    dueDate: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
    status: 'Belum Bayar',
    notes: ''
  });

  const [submitting, setSubmitting] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      const [invRes, payRes, ordRes, custRes] = await Promise.all([
        fetchResource<Invoice>('invoices'),
        fetchResource<Payment>('payments'),
        fetchResource<Order>('orders'),
        fetchResource<Customer>('customers')
      ]);
      setInvoices(invRes);
      setPayments(payRes);
      setOrders(ordRes);
      setCustomers(custRes || []);
    } catch (err) {
      console.error('Error loading finance data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleDownloadInvoicePdf = async () => {
    if (!printInvoice || isDownloadingInvoice) return;
    setInvoicePdfError(null);
    setIsDownloadingInvoice(true);
    try {
      await exportElementToPdf('invoice-doc', `Invoice_${printInvoice.id}`);
    } catch (err) {
      setInvoicePdfError('PDF faktur gagal dibuat. Tutup pratinjau, lalu coba unduh lagi.');
    } finally {
      setIsDownloadingInvoice(false);
    }
  };

  // Header action: open an empty Catat Pembayaran form
  const handleOpenNewPayment = () => {
    setPaymentForm({
      invoiceId: '',
      orderId: '',
      customerId: '',
      customerName: '',
      amount: 0,
      type: 'DP',
      paymentMethod: 'Transfer Bank BCA',
      date: new Date().toISOString().split('T')[0],
      proofImageUrl: '',
      notes: '',
      selectedInvoiceTotal: 0,
      selectedInvoicePaid: 0,
      selectedInvoiceBalance: 0
    });
    setIsRecordPaymentOpen(true);
  };

  // Header action: open an empty Buat Faktur form
  const handleOpenNewInvoice = () => {
    setNewInvoice({
      orderId: '',
      customerId: '',
      customerName: '',
      amount: 0,
      tax: 0,
      total: 0,
      downPaymentReceived: 0,
      balanceRemaining: 0,
      dueDate: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
      status: 'Belum Bayar',
      notes: ''
    });
    setIsInvoiceModalOpen(true);
  };

  // Quick action: Open Catat Kas Masuk for a specific invoice
  const handleOpenPayForInvoice = (inv: Invoice) => {
    setPaymentForm({
      invoiceId: inv.id,
      orderId: inv.orderId || '',
      customerId: inv.customerId || '',
      customerName: inv.customerName,
      amount: inv.balanceRemaining > 0 ? inv.balanceRemaining : inv.total,
      type: (inv.status === 'DP Dibayar' || inv.downPaymentReceived > 0) ? 'Pelunasan' : 'DP',
      paymentMethod: 'Transfer Bank BCA',
      date: new Date().toISOString().split('T')[0],
      proofImageUrl: '',
      notes: `Pembayaran untuk Faktur ${inv.id}`,
      selectedInvoiceTotal: inv.total,
      selectedInvoicePaid: inv.downPaymentReceived,
      selectedInvoiceBalance: inv.balanceRemaining
    });
    setIsRecordPaymentOpen(true);
  };

  // Link a payment to an order, so a DP can be recorded before any invoice exists
  const handleSelectPaymentOrder = (orderId: string) => {
    const ord = orders.find(o => o.id === orderId);
    if (!ord) {
      setPaymentForm({
        ...paymentForm,
        orderId: '',
        invoiceId: '',
        selectedInvoiceTotal: 0,
        selectedInvoicePaid: 0,
        selectedInvoiceBalance: 0
      });
      return;
    }

    const inv = invoices.find(i => i.orderId === ord.id);
    let next = {
      ...paymentForm,
      orderId: ord.id,
      customerId: ord.customerId,
      customerName: ord.customerName,
      invoiceId: inv?.id || '',
      selectedInvoiceTotal: inv?.total || 0,
      selectedInvoicePaid: inv?.downPaymentReceived || 0,
      selectedInvoiceBalance: inv?.balanceRemaining || 0
    };

    if (next.type === 'DP' && ord.dpRequired !== undefined) {
      next = { ...next, amount: Math.max(0, Number(ord.dpRequired) - (Number(ord.downPayment) || 0)) };
    } else if (inv) {
      next = { ...next, amount: inv.balanceRemaining > 0 ? inv.balanceRemaining : inv.total };
    }
    setPaymentForm(next);
  };

  const handleChangePaymentType = (type: 'DP' | 'Pelunasan' | 'Cicilan') => {
    const ord = orders.find(o => o.id === paymentForm.orderId);
    if (type === 'DP' && ord?.dpRequired !== undefined) {
      setPaymentForm({
        ...paymentForm,
        type,
        amount: Math.max(0, Number(ord.dpRequired) - (Number(ord.downPayment) || 0))
      });
      return;
    }
    setPaymentForm({ ...paymentForm, type });
  };

  // SOP-20: finance reviews a draft invoice before it goes to the customer
  const handleMarkInvoiceSent = async (inv: Invoice) => {
    if (!window.confirm(`Tandai faktur ${inv.id} sudah diperiksa dan dikirim ke pelanggan?`)) return;
    try {
      await updateResource('invoices', inv.id, {
        reviewStatus: 'Sent',
        sentAt: new Date().toISOString(),
        sentBy: getCurrentUser()?.name || 'Admin Keuangan'
      });
      await loadData();
    } catch (err) {
      alert('Gagal memperbarui faktur. Coba lagi.');
    }
  };

  // Submit Kas Masuk
  const handleSubmitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentForm.amount || paymentForm.amount <= 0) {
      alert('Masukkan jumlah pembayaran yang valid.');
      return;
    }

    try {
      setSubmitting(true);
      const res = await fetch('/api/payments/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceId: paymentForm.invoiceId,
          orderId: paymentForm.orderId,
          customerId: paymentForm.customerId,
          customerName: paymentForm.customerName,
          amount: Number(paymentForm.amount),
          type: paymentForm.type,
          paymentMethod: paymentForm.paymentMethod,
          bankAccount: paymentForm.paymentMethod,
          date: paymentForm.date,
          proofImageUrl: paymentForm.proofImageUrl,
          notes: paymentForm.notes,
          status: 'Verified',
          user: 'Admin Keuangan'
        })
      });

      if (!res.ok) {
        throw new Error('Gagal mencatat pembayaran. Coba lagi.');
      }

      setIsRecordPaymentOpen(false);
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Gagal mencatat pembayaran. Coba lagi.');
    } finally {
      setSubmitting(false);
    }
  };

  // 1-Click Verify Payment
  const handleVerifyPayment = async (paymentId: string) => {
    try {
      const res = await fetch(`/api/payments/${paymentId}/verify`, { method: 'POST' });
      if (res.ok) {
        await loadData();
      } else {
        alert('Gagal memverifikasi pembayaran. Coba lagi.');
      }
    } catch (err) {
      alert('Koneksi bermasalah. Coba lagi.');
    }
  };

  // Create Invoice
  /** The order's agreed installments, recalculated for this invoice total. */
  const invoiceSchedule = (orderId?: string, total?: number): PaymentTerm[] => {
    const order = orders.find(o => o.id === orderId);
    if (!order?.paymentSchedule?.length) return [];
    return withAmounts(order.paymentSchedule, Number(total) || 0);
  };

  const handleCreateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newInvoice.total || newInvoice.total <= 0) {
      alert('Isi total tagihan faktur.');
      return;
    }

    try {
      setSubmitting(true);
      const invPayload = {
        orderId: newInvoice.orderId || 'ORD-GEN',
        customerId: newInvoice.customerId || 'CUST-GEN',
        customerName: newInvoice.customerName || 'Klien',
        amount: Number(newInvoice.amount) || Number(newInvoice.total) || 0,
        tax: Number(newInvoice.tax) || 0,
        total: Number(newInvoice.total) || 0,
        downPaymentReceived: Number(newInvoice.downPaymentReceived) || 0,
        balanceRemaining: Math.max(0, (Number(newInvoice.total) || 0) - (Number(newInvoice.downPaymentReceived) || 0)),
        dueDate: newInvoice.dueDate || new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
        status: newInvoice.status || 'Belum Bayar',
        notes: newInvoice.notes || 'Faktur pesanan konveksi',
        // Installments agreed on the quotation, restated against this invoice total
        paymentSchedule: invoiceSchedule(newInvoice.orderId, Number(newInvoice.total) || 0)
      };

      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(invPayload)
      });

      if (!res.ok) throw new Error('Gagal membuat faktur. Coba lagi.');

      setIsInvoiceModalOpen(false);
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Gagal membuat faktur. Coba lagi.');
    } finally {
      setSubmitting(false);
    }
  };

  // Summary Metrics calculations
  const totalOmzet = useMemo(() => {
    return invoices.reduce((acc, i) => acc + (Number(i.total) || 0), 0);
  }, [invoices]);

  const totalKasMasuk = useMemo(() => {
    return payments
      .filter(p => p.status === 'Verified')
      .reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
  }, [payments]);

  const totalPiutang = useMemo(() => {
    return invoices.reduce((acc, i) => acc + (Number(i.balanceRemaining) || 0), 0);
  }, [invoices]);

  const overdueCount = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    return invoices.filter(i => (Number(i.balanceRemaining) > 0 || i.status !== 'Lunas') && i.dueDate < today).length;
  }, [invoices]);

  const draftInvoiceCount = useMemo(() => invoices.filter(i => i.reviewStatus === 'Draft').length, [invoices]);

  const selectedPaymentOrder = orders.find(o => o.id === paymentForm.orderId);

  // Filtered Invoices
  const filteredInvoices = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    return newestFirst(invoices.filter(inv => {
      const q = searchQuery.toLowerCase();
      const matchQuery =
        (inv.id || '').toLowerCase().includes(q) ||
        (inv.customerName || '').toLowerCase().includes(q) ||
        (inv.orderId || '').toLowerCase().includes(q);

      if (!matchQuery) return false;

      if (invoiceStatusFilter === 'Semua') return true;
      if (invoiceStatusFilter === 'Belum Bayar') return inv.status === 'Belum Bayar' || (inv.downPaymentReceived === 0 && inv.status !== 'Lunas');
      if (invoiceStatusFilter === 'DP Dibayar') return inv.status === 'DP Dibayar' || (inv.downPaymentReceived > 0 && inv.balanceRemaining > 0);
      if (invoiceStatusFilter === 'Lunas') return inv.status === 'Lunas' || inv.balanceRemaining === 0;
      if (invoiceStatusFilter === 'Jatuh Tempo') return (inv.balanceRemaining > 0 || inv.status !== 'Lunas') && inv.dueDate < today;

      return true;
    }));
  }, [invoices, searchQuery, invoiceStatusFilter]);

  // Filtered Payments
  const filteredPayments = useMemo(() => {
    return newestFirst(payments.filter(pay => {
      const q = searchQuery.toLowerCase();
      const matchQuery =
        (pay.id || '').toLowerCase().includes(q) ||
        (pay.customerName || '').toLowerCase().includes(q) ||
        (pay.orderId || '').toLowerCase().includes(q) ||
        (pay.invoiceId || '').toLowerCase().includes(q);

      if (!matchQuery) return false;

      if (paymentMethodFilter === 'Semua') return true;
      return (pay.paymentMethod || pay.bankAccount || '').toLowerCase().includes(paymentMethodFilter.toLowerCase());
    }));
  }, [payments, searchQuery, paymentMethodFilter]);

  const today = new Date().toISOString().split('T')[0];
  const isInvoiceOverdue = (inv: Invoice) =>
    (Number(inv.balanceRemaining) > 0 || inv.status !== 'Lunas') && inv.dueDate < today;

  /** Same urgency rule as DeadlineBadge: within 3 days of the due date reads warning. */
  const isDueSoon = (dueDate?: string) => {
    if (!dueDate) return false;
    const due = new Date(dueDate);
    if (isNaN(due.getTime())) return false;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const days = Math.round((due.setHours(0, 0, 0, 0) - startOfToday.getTime()) / 86400000);
    return days >= 0 && days <= 3;
  };

  // Row detail records
  const detailInvoice = detailInvoiceId ? invoices.find(i => i.id === detailInvoiceId) ?? null : null;
  const detailInvoiceOverdue = detailInvoice ? isInvoiceOverdue(detailInvoice) : false;
  const detailInvoicePayments = detailInvoice
    ? payments.filter(p =>
        p.invoiceId === detailInvoice.id ||
        (!p.invoiceId && !!detailInvoice.orderId && p.orderId === detailInvoice.orderId)
      )
    : [];
  const detailPayment = detailPaymentId ? payments.find(p => p.id === detailPaymentId) ?? null : null;
  const detailPaymentInvoice = detailPayment?.invoiceId
    ? invoices.find(i => i.id === detailPayment.invoiceId)
    : undefined;

  const unpaidInvoiceCount = invoices.filter(i => (Number(i.balanceRemaining) > 0 || i.status !== 'Lunas')).length;
  const verifiedPaymentCount = payments.filter(p => p.status === 'Verified').length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Keuangan"
        description="Kelola faktur, catat pembayaran masuk, dan pantau sisa tagihan."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportTableToExcel(invoices, 'Laporan_Keuangan_HIJ')}
            >
              <Download size={16} aria-hidden="true" /> Unduh Excel
            </Button>
            <Button variant="outline" size="sm" onClick={handleOpenNewPayment}>
              <ArrowDownLeft size={16} aria-hidden="true" /> Catat Pembayaran
            </Button>
            <Button size="sm" onClick={handleOpenNewInvoice}>
              <Plus size={16} aria-hidden="true" /> Buat Faktur
            </Button>
          </>
        }
      />

      {/* DRAFT INVOICES NOTICE */}
      {draftInvoiceCount > 0 && (
        <div className="p-4 bg-status-warning-bg border border-status-warning-border rounded-xl flex items-start gap-3" role="status">
          <AlertCircle size={20} className="text-status-warning shrink-0" aria-hidden="true" />
          <p className="text-sm text-status-warning text-pretty">
            <span className="font-bold">{draftInvoiceCount} draf faktur perlu diperiksa sebelum dikirim ke pelanggan.</span>{' '}
            Buka Detail faktur berlabel Draf untuk menandainya terkirim.
          </p>
        </div>
      )}

      {/* SUMMARY — one compact strip: stacked rows on phones, three columns from sm */}
      <Card className="grid grid-cols-1 divide-y divide-border sm:grid-cols-3 sm:divide-y-0 sm:divide-x">
        {/* Kas Masuk */}
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-3 sm:grid-cols-1 sm:items-start sm:py-4">
          <p className="text-sm font-medium text-slate-600">Kas Masuk</p>
          <p className="row-span-2 text-base font-bold text-slate-900 tabular-nums whitespace-nowrap sm:row-span-1 sm:mt-1 sm:text-lg xl:text-2xl">
            {formatCurrency(totalKasMasuk)}
          </p>
          <p className="text-xs text-slate-500 sm:mt-1">
            {verifiedPaymentCount} pembayaran terverifikasi
          </p>
        </div>

        {/* Sisa Tagihan */}
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-3 sm:grid-cols-1 sm:items-start sm:py-4">
          <p className="text-sm font-medium text-slate-600">Sisa Tagihan</p>
          <p className="row-span-2 text-base font-bold text-status-warning tabular-nums whitespace-nowrap sm:row-span-1 sm:mt-1 sm:text-lg xl:text-2xl">
            {formatCurrency(totalPiutang)}
          </p>
          <div className="flex flex-wrap items-center gap-1.5 sm:mt-1">
            <span className="text-xs text-slate-500">{unpaidInvoiceCount} faktur belum lunas</span>
            {overdueCount > 0 && (
              <Badge variant="critical" size="sm">
                {overdueCount} jatuh tempo
              </Badge>
            )}
          </div>
        </div>

        {/* Total Tagihan */}
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-3 sm:grid-cols-1 sm:items-start sm:py-4">
          <p className="text-sm font-medium text-slate-600">Total Tagihan</p>
          <p className="row-span-2 text-base font-bold text-slate-900 tabular-nums whitespace-nowrap sm:row-span-1 sm:mt-1 sm:text-lg xl:text-2xl">
            {formatCurrency(totalOmzet)}
          </p>
          <p className="text-xs text-slate-500 sm:mt-1">
            {invoices.length} faktur
          </p>
        </div>
      </Card>

      {/* TABS & SEARCH */}
      <Card className="overflow-hidden">
        {/* Tab Header Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-slate-100 p-4 gap-4">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'invoices' | 'payments')}>
            <TabsList aria-label="Data keuangan">
              <TabsTrigger
                value="invoices"
                id="fin-tab-invoices"
                aria-controls={activeTab === 'invoices' ? 'fin-panel-invoices' : undefined}
                className="gap-2"
              >
                <FileText size={16} aria-hidden="true" />
                <span>Faktur</span>
                <Badge variant="idle" size="sm">
                  {invoices.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger
                value="payments"
                id="fin-tab-payments"
                aria-controls={activeTab === 'payments' ? 'fin-panel-payments' : undefined}
                className="gap-2"
              >
                <ArrowDownLeft size={16} aria-hidden="true" />
                <span>Pembayaran</span>
                <Badge variant="idle" size="sm">
                  {payments.length}
                </Badge>
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Search Bar */}
          <div className="relative w-full md:w-80">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <Input
              type="search"
              aria-label={activeTab === 'invoices' ? 'Cari faktur' : 'Cari pembayaran'}
              placeholder={activeTab === 'invoices' ? "Cari no. faktur atau pelanggan…" : "Cari no. transaksi atau pelanggan…"}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        {/* TAB 1: INVOICES */}
        {activeTab === 'invoices' && (
          <div role="tabpanel" id="fin-panel-invoices" aria-labelledby="fin-tab-invoices">
            <div
              role="group"
              aria-label="Filter status faktur"
              className="px-4 py-3 bg-slate-50/50 border-b border-slate-100 flex flex-wrap items-center gap-2"
            >
              {(['Semua', 'Belum Bayar', 'DP Dibayar', 'Lunas', 'Jatuh Tempo'] as const).map(tab => (
                <Button
                  key={tab}
                  size="sm"
                  variant={invoiceStatusFilter === tab ? "default" : "outline"}
                  aria-pressed={invoiceStatusFilter === tab}
                  onClick={() => setInvoiceStatusFilter(tab)}
                >
                  {tab === 'Semua' ? 'Semua Status' : tab}
                </Button>
              ))}
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="cell-sticky-start">No. Faktur</TableHead>
                  <TableHead className="hidden md:table-cell">Pesanan</TableHead>
                  <TableHead className="hidden md:table-cell">Pelanggan</TableHead>
                  <TableHead className="hidden sm:table-cell text-right">Total</TableHead>
                  <TableHead className="hidden sm:table-cell text-right">Sisa Tagihan</TableHead>
                  <TableHead className="hidden lg:table-cell">Jatuh Tempo</TableHead>
                  <TableHead className="hidden xl:table-cell">Pemeriksaan</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="cell-sticky-end text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && invoices.length === 0 ? (
                  <TableSkeletonRows columns={9} />
                ) : filteredInvoices.length === 0 ? (
                  <TableEmptyRow
                    colSpan={9}
                    icon={<FileText size={20} />}
                    title={invoices.length === 0 ? 'Belum ada faktur' : 'Tidak ada faktur yang cocok'}
                    description={
                      invoices.length === 0
                        ? 'Buat faktur dari pesanan lewat tombol Buat Faktur.'
                        : 'Coba kata kunci lain atau pilih Semua Status.'
                    }
                  />
                ) : (
                  filteredInvoices.map(inv => {
                    const isOverdue = isInvoiceOverdue(inv);
                    const hasBalance = Number(inv.balanceRemaining) > 0;
                    return (
                      <TableRow key={inv.id}>
                        {/* No. Faktur */}
                        <TableCell className="cell-sticky-start whitespace-nowrap">
                          <span
                            className={cn(
                              'font-mono font-bold',
                              inv.supersededBy ? 'text-slate-400 line-through' : 'text-slate-900'
                            )}
                          >
                            {inv.id}
                          </span>
                          {!!inv.revision && (
                            <Badge
                              variant={inv.supersededBy ? 'idle' : 'progress'}
                              size="sm"
                              className="ml-1.5 align-middle"
                            >
                              Rev.{inv.revision}
                            </Badge>
                          )}
                          {inv.supersededBy && (
                            <Badge variant="idle" size="sm" className="ml-1 align-middle">Diganti</Badge>
                          )}
                        </TableCell>

                        {/* Pesanan */}
                        <TableCell className="hidden md:table-cell whitespace-nowrap font-mono text-slate-600">
                          {inv.orderId || '—'}
                        </TableCell>

                        {/* Pelanggan */}
                        <TableCell className="hidden md:table-cell font-semibold text-slate-900">
                          {inv.customerName}
                        </TableCell>

                        {/* Total Tagihan */}
                        <TableCell className="hidden sm:table-cell text-right font-semibold text-slate-900 whitespace-nowrap">
                          {formatCurrency(inv.total)}
                        </TableCell>

                        {/* Sisa Tagihan */}
                        <TableCell className="hidden sm:table-cell text-right whitespace-nowrap">
                          <span
                            className={
                              !hasBalance
                                ? 'font-semibold text-slate-400'
                                : isOverdue
                                  ? 'font-bold text-status-critical'
                                  : 'font-bold text-status-warning'
                            }
                          >
                            {formatCurrency(inv.balanceRemaining || 0)}
                          </span>
                        </TableCell>

                        {/* Jatuh Tempo */}
                        <TableCell className="hidden lg:table-cell whitespace-nowrap">
                          {inv.dueDate ? (
                            <span
                              className={
                                isOverdue
                                  ? 'font-semibold text-status-critical'
                                  : isDueSoon(inv.dueDate)
                                    ? 'font-semibold text-status-warning'
                                    : 'text-slate-600'
                              }
                            >
                              {formatDate(inv.dueDate)}
                              {isOverdue && <span className="block text-xs font-semibold">Lewat tempo</span>}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </TableCell>

                        {/* Pemeriksaan */}
                        <TableCell className="hidden xl:table-cell whitespace-nowrap">
                          {inv.reviewStatus === 'Draft' ? (
                            <Badge variant="warning" size="sm">Draf</Badge>
                          ) : inv.reviewStatus ? (
                            <span className="text-xs text-slate-500">{statusLabel(inv.reviewStatus)}</span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </TableCell>

                        {/* Status */}
                        <TableCell className="text-center whitespace-nowrap">
                          <StatusBadge status={inv.status} />
                        </TableCell>

                        {/* Aksi */}
                        <TableCell className="cell-sticky-end text-right">
                          <TableRowActions>
                            {hasBalance && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleOpenPayForInvoice(inv)}
                                aria-label={`Bayar ${inv.id}`}
                                className="h-8 gap-1.5 px-2.5 text-xs"
                              >
                                <ArrowDownLeft size={14} aria-hidden="true" /> Bayar
                              </Button>
                            )}
                            <RowDetailButton label={inv.id} onClick={() => setDetailInvoiceId(inv.id)} />
                          </TableRowActions>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        )}

        {/* TAB 2: PAYMENTS */}
        {activeTab === 'payments' && (
          <div role="tabpanel" id="fin-panel-payments" aria-labelledby="fin-tab-payments">
            <div
              role="group"
              aria-label="Filter metode pembayaran"
              className="px-4 py-3 bg-slate-50/50 border-b border-slate-100 flex flex-wrap items-center gap-2"
            >
              {['Semua', 'BCA', 'Mandiri', 'Tunai'].map(method => (
                <Button
                  key={method}
                  size="sm"
                  variant={paymentMethodFilter === method ? "default" : "outline"}
                  aria-pressed={paymentMethodFilter === method}
                  onClick={() => setPaymentMethodFilter(method)}
                >
                  {method === 'Semua' ? 'Semua Metode' : method}
                </Button>
              ))}
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="cell-sticky-start">No. Transaksi</TableHead>
                  <TableHead className="hidden md:table-cell">Pelanggan</TableHead>
                  <TableHead className="hidden sm:table-cell text-right">Jumlah</TableHead>
                  <TableHead className="hidden lg:table-cell">Tanggal</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="cell-sticky-end text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && payments.length === 0 ? (
                  <TableSkeletonRows columns={6} />
                ) : filteredPayments.length === 0 ? (
                  <TableEmptyRow
                    colSpan={6}
                    icon={<Wallet size={20} />}
                    title={payments.length === 0 ? 'Belum ada pembayaran' : 'Tidak ada pembayaran yang cocok'}
                    description={
                      payments.length === 0
                        ? 'Catat pembayaran masuk lewat tombol Catat Pembayaran.'
                        : 'Coba kata kunci lain atau pilih Semua Metode.'
                    }
                  />
                ) : (
                  filteredPayments.map(pay => (
                    <TableRow key={pay.id}>
                      {/* No. Transaksi */}
                      <TableCell className="cell-sticky-start whitespace-nowrap">
                        <span className="font-mono font-bold text-slate-900">{pay.id}</span>
                      </TableCell>

                      {/* Pelanggan */}
                      <TableCell className="hidden md:table-cell font-semibold text-slate-900">
                        {pay.customerName}
                      </TableCell>

                      {/* Jumlah */}
                      <TableCell className="hidden sm:table-cell text-right font-bold text-status-done whitespace-nowrap">
                        {formatCurrency(pay.amount)}
                      </TableCell>

                      {/* Tanggal */}
                      <TableCell className="hidden lg:table-cell whitespace-nowrap text-slate-600">
                        {formatDate(pay.date)}
                      </TableCell>

                      {/* Status */}
                      <TableCell className="text-center whitespace-nowrap">
                        <StatusBadge status={pay.status} />
                      </TableCell>

                      {/* Aksi */}
                      <TableCell className="cell-sticky-end text-right">
                        <TableRowActions>
                          {pay.status !== 'Verified' && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleVerifyPayment(pay.id)}
                              aria-label={`Verifikasi ${pay.id}`}
                              className="h-8 w-8 gap-1.5 px-0 text-xs sm:w-auto sm:px-2.5"
                            >
                              <Check size={14} aria-hidden="true" />
                              <span className="hidden sm:inline">Verifikasi</span>
                            </Button>
                          )}
                          <RowDetailButton label={pay.id} onClick={() => setDetailPaymentId(pay.id)} />
                        </TableRowActions>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {/* DETAIL: FAKTUR */}
      <DetailDrawer
        isOpen={!!detailInvoice}
        onClose={() => setDetailInvoiceId(null)}
        title={detailInvoice?.customerName}
        subtitle={
          detailInvoice && (
            <span className="font-mono">
              {detailInvoice.id}
              {detailInvoice.timestamp ? ` · ${formatDate(detailInvoice.timestamp)}` : ''}
            </span>
          )
        }
        status={
          detailInvoice && (
            <>
              <StatusBadge status={detailInvoice.status} />
              {detailInvoice.reviewStatus === 'Draft' && <Badge variant="warning" size="sm">Draf</Badge>}
            </>
          )
        }
        footer={
          detailInvoice && (
            <>
              {detailInvoice.reviewStatus === 'Draft' && (
                <Button variant="outline" onClick={() => handleMarkInvoiceSent(detailInvoice)}>
                  <Send size={16} aria-hidden="true" /> Tandai Sudah Dikirim
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => { setPrintInvoice(detailInvoice); setIsPrintModalOpen(true); }}
              >
                <Printer size={16} aria-hidden="true" /> Cetak
              </Button>
              {Number(detailInvoice.balanceRemaining) > 0 && (
                <Button onClick={() => handleOpenPayForInvoice(detailInvoice)}>
                  <ArrowDownLeft size={16} aria-hidden="true" /> Bayar
                </Button>
              )}
            </>
          )
        }
      >
        {detailInvoice && (
          <>
            <DetailStats
              items={[
                { label: 'Total tagihan', value: formatCurrency(detailInvoice.total) },
                { label: 'Sudah dibayar', value: formatCurrency(detailInvoice.downPaymentReceived || 0) },
                {
                  label: 'Sisa tagihan',
                  value: formatCurrency(detailInvoice.balanceRemaining || 0),
                  tone: Number(detailInvoice.balanceRemaining) > 0 ? 'danger' : 'default'
                }
              ]}
            />
            <DetailSection title="Faktur">
              <DetailField label="No. faktur" mono>{detailInvoice.id}</DetailField>
              <DetailField label="Pesanan" mono>{detailInvoice.orderId}</DetailField>
              <DetailField label="Tanggal faktur">{detailInvoice.timestamp && formatDate(detailInvoice.timestamp)}</DetailField>
              <DetailField label="Jatuh tempo">
                {detailInvoice.dueDate && (
                  <span
                    className={
                      detailInvoiceOverdue
                        ? 'font-semibold text-status-critical'
                        : isDueSoon(detailInvoice.dueDate)
                          ? 'font-semibold text-status-warning'
                          : undefined
                    }
                  >
                    {formatDate(detailInvoice.dueDate)}
                    {detailInvoiceOverdue && <span className="block text-xs font-semibold">Lewat tempo</span>}
                  </span>
                )}
              </DetailField>
              <DetailField label="Status"><StatusBadge status={detailInvoice.status} /></DetailField>
              <DetailField label="Metode pembayaran">{detailInvoice.paymentMethod}</DetailField>
            </DetailSection>
            <DetailSection title="Rincian Tagihan">
              <DetailField label="Nilai pesanan">{formatCurrency(detailInvoice.amount)}</DetailField>
              <DetailField label="Pajak">
                {detailInvoice.tax !== undefined && detailInvoice.tax !== null ? formatCurrency(detailInvoice.tax) : undefined}
              </DetailField>
            </DetailSection>
            <DetailSection title="Pelanggan">
              <DetailField label="Nama">{detailInvoice.customerName}</DetailField>
              <DetailField label="ID pelanggan" mono>{detailInvoice.customerId}</DetailField>
            </DetailSection>
            <DetailSection title="Pemeriksaan & Pengiriman">
              <DetailField label="Pemeriksaan">
                {detailInvoice.reviewStatus && statusLabel(detailInvoice.reviewStatus)}
              </DetailField>
              <DetailField label="No. pengiriman" mono>{detailInvoice.shipmentId}</DetailField>
              <DetailField label="Dikirim oleh">{detailInvoice.sentBy}</DetailField>
              <DetailField label="Dikirim pada">{detailInvoice.sentAt && formatDateTime(detailInvoice.sentAt)}</DetailField>
            </DetailSection>
            <DetailSection title="Catatan">
              <DetailField label="Catatan faktur" full>{detailInvoice.notes}</DetailField>
            </DetailSection>
            <DetailBlock title={`Pembayaran (${detailInvoicePayments.length})`}>
              {detailInvoicePayments.length === 0 ? (
                <p className="text-sm text-muted-foreground">Belum ada pembayaran tercatat untuk faktur ini.</p>
              ) : (
                <ul className="divide-y divide-border rounded-xl border border-border">
                  {detailInvoicePayments.map(p => (
                    <li key={p.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="font-mono text-[13px] font-medium text-foreground">{p.id}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground break-words">
                          {formatDate(p.date)} · {p.type} · {p.paymentMethod || p.bankAccount || '-'}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-bold text-foreground tabular-nums whitespace-nowrap">{formatCurrency(p.amount)}</p>
                        <div className="mt-1">
                          <StatusBadge status={p.status} />
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </DetailBlock>
            <DetailSection title="Riwayat Data">
              <DetailField label="Dicatat oleh">{detailInvoice.user}</DetailField>
              <DetailField label="Dicatat pada">{detailInvoice.timestamp && formatDateTime(detailInvoice.timestamp)}</DetailField>
            </DetailSection>
          </>
        )}
      </DetailDrawer>

      {/* DETAIL: PEMBAYARAN */}
      <DetailDrawer
        isOpen={!!detailPayment}
        onClose={() => setDetailPaymentId(null)}
        title={detailPayment?.customerName}
        subtitle={
          detailPayment && (
            <span className="font-mono">
              {detailPayment.id}
              {detailPayment.date ? ` · ${formatDate(detailPayment.date)}` : ''}
            </span>
          )
        }
        status={detailPayment && <StatusBadge status={detailPayment.status} />}
        footer={
          detailPayment && detailPayment.status !== 'Verified' && (
            <Button onClick={() => handleVerifyPayment(detailPayment.id)}>
              <Check size={16} aria-hidden="true" /> Verifikasi
            </Button>
          )
        }
      >
        {detailPayment && (
          <>
            <DetailStats
              items={
                detailPaymentInvoice
                  ? [
                      { label: 'Jumlah dibayar', value: formatCurrency(detailPayment.amount), tone: 'accent' },
                      { label: 'Total faktur', value: formatCurrency(detailPaymentInvoice.total) },
                      {
                        label: 'Sisa tagihan',
                        value: formatCurrency(detailPaymentInvoice.balanceRemaining || 0),
                        tone: Number(detailPaymentInvoice.balanceRemaining) > 0 ? 'danger' : 'default'
                      }
                    ]
                  : [
                      { label: 'Jumlah dibayar', value: formatCurrency(detailPayment.amount), tone: 'accent' },
                      { label: 'Jenis pembayaran', value: detailPayment.type }
                    ]
              }
            />
            <DetailSection title="Referensi">
              <DetailField label="Faktur" mono>{detailPayment.invoiceId}</DetailField>
              <DetailField label="Pesanan" mono>{detailPayment.orderId}</DetailField>
              <DetailField label="Pelanggan">{detailPayment.customerName}</DetailField>
              <DetailField label="ID pelanggan" mono>{detailPayment.customerId}</DetailField>
            </DetailSection>
            <DetailSection title="Jenis & Metode">
              <DetailField label="Jenis">{detailPayment.type}</DetailField>
              <DetailField label="Tanggal diterima">{detailPayment.date && formatDate(detailPayment.date)}</DetailField>
              <DetailField label="Metode">{detailPayment.paymentMethod}</DetailField>
              <DetailField label="Rekening">{detailPayment.bankAccount}</DetailField>
            </DetailSection>
            <DetailBlock title="Bukti Bayar">
              {detailPayment.proofImageUrl ? (
                <div className="space-y-1">
                  <a
                    href={detailPayment.proofImageUrl}
                    target="_blank"
                    rel="noreferrer"
                    tabIndex={-1}
                    aria-hidden="true"
                    className="block overflow-hidden rounded-xl border border-border bg-muted"
                  >
                    <img
                      src={detailPayment.proofImageUrl}
                      alt=""
                      loading="lazy"
                      className="max-h-64 w-full object-contain"
                    />
                  </a>
                  <a
                    href={detailPayment.proofImageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={linkClass}
                  >
                    <ExternalLink size={14} aria-hidden="true" /> Buka bukti bayar
                  </a>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Belum diunggah</p>
              )}
            </DetailBlock>
            <DetailSection title="Verifikasi">
              <DetailField label="Status"><StatusBadge status={detailPayment.status} /></DetailField>
              {detailPayment.status !== 'Verified' && (
                <DetailField label="Tindak lanjut" full>
                  Periksa bukti bayar, lalu tekan Verifikasi.
                </DetailField>
              )}
            </DetailSection>
            <DetailSection title="Catatan">
              <DetailField label="Catatan pembayaran" full>{detailPayment.notes}</DetailField>
            </DetailSection>
            <DetailSection title="Riwayat Data">
              <DetailField label="Dicatat oleh">{detailPayment.user}</DetailField>
              <DetailField label="Dicatat pada">{detailPayment.timestamp && formatDateTime(detailPayment.timestamp)}</DetailField>
            </DetailSection>
          </>
        )}
      </DetailDrawer>

      {/* MODAL 1: CATAT PEMBAYARAN */}
      <Modal
        isOpen={isRecordPaymentOpen}
        onClose={() => setIsRecordPaymentOpen(false)}
        title="Catat Pembayaran"
        maxWidth="xl"
      >
        <form onSubmit={handleSubmitPayment} className="space-y-5">
          {/* Linked Order Selector — lets a DP be recorded before an invoice exists */}
          <div>
            <label htmlFor="fin-pay-order" className={labelClass}>Pesanan</label>
            <select
              id="fin-pay-order"
              value={paymentForm.orderId}
              onChange={(e) => handleSelectPaymentOrder(e.target.value)}
              aria-describedby={selectedPaymentOrder?.dpRequired !== undefined ? 'fin-pay-order-hint' : undefined}
              className={selectClass}
            >
              <option value="">Pilih pesanan (opsional)</option>
              {paymentForm.orderId && !selectedPaymentOrder && (
                <option value={paymentForm.orderId}>{paymentForm.orderId}</option>
              )}
              {orders.map(o => (
                <option key={o.id} value={o.id}>
                  {o.po || o.id} - {o.customerName}
                </option>
              ))}
            </select>
            {selectedPaymentOrder?.dpRequired !== undefined && (
              <p id="fin-pay-order-hint" className="text-xs text-slate-500 mt-1.5">
                DP disepakati {formatCurrency(selectedPaymentOrder.dpRequired)} · sudah dibayar {formatCurrency(selectedPaymentOrder.downPayment || 0)}
              </p>
            )}
          </div>

          {/* Linked Invoice Selector */}
          <div>
            <label htmlFor="fin-pay-invoice" className={labelClass}>Faktur</label>
            <select
              id="fin-pay-invoice"
              value={paymentForm.invoiceId}
              onChange={(e) => {
                const invId = e.target.value;
                const inv = invoices.find(i => i.id === invId);
                if (inv) {
                  setPaymentForm({
                    ...paymentForm,
                    invoiceId: inv.id,
                    orderId: inv.orderId,
                    customerId: inv.customerId,
                    customerName: inv.customerName,
                    amount: inv.balanceRemaining > 0 ? inv.balanceRemaining : inv.total,
                    type: (inv.status === 'DP Dibayar' || inv.downPaymentReceived > 0) ? 'Pelunasan' : 'DP',
                    selectedInvoiceTotal: inv.total,
                    selectedInvoicePaid: inv.downPaymentReceived,
                    selectedInvoiceBalance: inv.balanceRemaining,
                    notes: `Pembayaran ${inv.balanceRemaining > 0 ? 'pelunasan' : 'DP'} untuk Faktur ${inv.id}`
                  });
                } else {
                  setPaymentForm({
                    ...paymentForm,
                    invoiceId: '',
                    selectedInvoiceTotal: 0,
                    selectedInvoicePaid: 0,
                    selectedInvoiceBalance: 0
                  });
                }
              }}
              className={selectClass}
            >
              <option value="">Pilih faktur (opsional)</option>
              {invoices.map(inv => (
                <option key={inv.id} value={inv.id}>
                  {inv.id} - {inv.customerName} (Sisa: {formatCurrency(inv.balanceRemaining)})
                </option>
              ))}
            </select>
          </div>

          {/* Invoice Summary Box if selected */}
          {paymentForm.selectedInvoiceTotal > 0 && (
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-600">Total Tagihan</span>
                <span className="font-bold text-slate-900 tabular-nums whitespace-nowrap">{formatCurrency(paymentForm.selectedInvoiceTotal)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-600">Sudah Dibayar</span>
                <span className="font-bold text-status-done tabular-nums whitespace-nowrap">{formatCurrency(paymentForm.selectedInvoicePaid)}</span>
              </div>
              <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-200">
                <span className="text-slate-600">Sisa Tagihan</span>
                <span className="font-bold text-status-warning tabular-nums whitespace-nowrap">{formatCurrency(paymentForm.selectedInvoiceBalance)}</span>
              </div>
            </div>
          )}

          {/* Customer Name */}
          <div>
            <label htmlFor="fin-pay-customer" className={labelClass}>Nama Pelanggan</label>
            <Input
              id="fin-pay-customer"
              type="text"
              required
              value={paymentForm.customerName}
              onChange={(e) => setPaymentForm({ ...paymentForm, customerName: e.target.value })}
              placeholder="Contoh: PT Arkato"
            />
          </div>

          {/* Jumlah & Quick Fill */}
          <div>
            <label htmlFor="fin-pay-amount" className={labelClass}>Jumlah Dibayar (Rp)</label>
            <Input
              id="fin-pay-amount"
              type="number"
              required
              min={1}
              value={paymentForm.amount || ''}
              onChange={(e) => setPaymentForm({ ...paymentForm, amount: Number(e.target.value) })}
              placeholder="0"
              className="font-bold tabular-nums text-base text-status-done"
            />
            {paymentForm.selectedInvoiceBalance > 0 && (
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPaymentForm({ ...paymentForm, amount: paymentForm.selectedInvoiceBalance, type: 'Pelunasan' })}
                >
                  Lunasi Sisa ({formatCurrency(paymentForm.selectedInvoiceBalance)})
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPaymentForm({ ...paymentForm, amount: Math.round(paymentForm.selectedInvoiceTotal * 0.5), type: 'DP' })}
                >
                  DP 50% ({formatCurrency(Math.round(paymentForm.selectedInvoiceTotal * 0.5))})
                </Button>
              </div>
            )}
          </div>

          {/* Jenis Pembayaran & Metode */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="fin-pay-type" className={labelClass}>Jenis Pembayaran</label>
              <select
                id="fin-pay-type"
                value={paymentForm.type}
                onChange={(e) => handleChangePaymentType(e.target.value as 'DP' | 'Pelunasan' | 'Cicilan')}
                className={selectClass}
              >
                <option value="DP">DP (Uang Muka)</option>
                <option value="Pelunasan">Pelunasan</option>
                <option value="Cicilan">Cicilan</option>
              </select>
            </div>
            <div>
              <label htmlFor="fin-pay-method" className={labelClass}>Metode Pembayaran</label>
              <select
                id="fin-pay-method"
                value={paymentForm.paymentMethod}
                onChange={(e) => setPaymentForm({ ...paymentForm, paymentMethod: e.target.value })}
                className={selectClass}
              >
                <option value="Transfer Bank BCA">Transfer BCA (829-082-1199)</option>
                <option value="Transfer Bank Mandiri">Transfer Mandiri (131-00-1928374-1)</option>
                <option value="Kas Tunai / Cash">Tunai</option>
                <option value="Transfer Bank Lain">Transfer Bank Lain</option>
              </select>
            </div>
          </div>

          {/* Tanggal & Catatan */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="fin-pay-date" className={labelClass}>Tanggal Diterima</label>
              <Input
                id="fin-pay-date"
                type="date"
                required
                value={paymentForm.date}
                onChange={(e) => setPaymentForm({ ...paymentForm, date: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="fin-pay-notes" className={labelClass}>Catatan</label>
              <Input
                id="fin-pay-notes"
                type="text"
                value={paymentForm.notes}
                onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })}
                placeholder="Contoh: no. referensi transfer"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsRecordPaymentOpen(false)}
            >
              Batal
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Menyimpan…' : 'Simpan Pembayaran'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* MODAL 2: BUAT FAKTUR */}
      <Modal
        isOpen={isInvoiceModalOpen}
        onClose={() => setIsInvoiceModalOpen(false)}
        title="Buat Faktur"
        maxWidth="xl"
      >
        <form onSubmit={handleCreateInvoice} className="space-y-5">
          <div>
            <label htmlFor="fin-inv-order" className={labelClass}>Pesanan</label>
            <select
              id="fin-inv-order"
              value={newInvoice.orderId}
              onChange={(e) => {
                const ord = orders.find(o => o.id === e.target.value);
                if (ord) {
                  const total = ord.totalPrice || 0;
                  const dp = ord.downPayment || 0;
                  setNewInvoice({
                    ...newInvoice,
                    orderId: ord.id,
                    customerId: ord.customerId,
                    customerName: ord.customerName,
                    amount: total,
                    total: total,
                    downPaymentReceived: dp,
                    balanceRemaining: Math.max(0, total - dp),
                    status: dp >= total ? 'Lunas' : (dp > 0 ? 'DP Dibayar' : 'Belum Bayar')
                  });
                }
              }}
              className={selectClass}
            >
              <option value="">Pilih pesanan (atau isi manual)</option>
              {orders.map(o => (
                <option key={o.id} value={o.id}>
                  {o.po || o.id} - {o.customerName} ({formatCurrency(o.totalPrice)})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="fin-inv-customer" className={labelClass}>Nama Pelanggan</label>
              <Input
                id="fin-inv-customer"
                type="text"
                required
                value={newInvoice.customerName}
                onChange={(e) => setNewInvoice({ ...newInvoice, customerName: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="fin-inv-due" className={labelClass}>Jatuh Tempo</label>
              <Input
                id="fin-inv-due"
                type="date"
                required
                value={newInvoice.dueDate}
                onChange={(e) => setNewInvoice({ ...newInvoice, dueDate: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="fin-inv-total" className={labelClass}>Total Tagihan (Rp)</label>
              <Input
                id="fin-inv-total"
                type="number"
                required
                min={0}
                value={newInvoice.total || ''}
                onChange={(e) => {
                  const tot = Number(e.target.value);
                  const dp = Number(newInvoice.downPaymentReceived) || 0;
                  setNewInvoice({
                    ...newInvoice,
                    total: tot,
                    amount: tot,
                    balanceRemaining: Math.max(0, tot - dp)
                  });
                }}
                className="tabular-nums font-bold text-slate-900"
              />
            </div>
            <div>
              <label htmlFor="fin-inv-dp" className={labelClass}>DP Diterima (Rp)</label>
              <Input
                id="fin-inv-dp"
                type="number"
                min={0}
                value={newInvoice.downPaymentReceived || ''}
                onChange={(e) => {
                  const dp = Number(e.target.value);
                  const tot = Number(newInvoice.total) || 0;
                  setNewInvoice({
                    ...newInvoice,
                    downPaymentReceived: dp,
                    balanceRemaining: Math.max(0, tot - dp)
                  });
                }}
                className="tabular-nums font-bold text-status-done"
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 bg-slate-50 px-4 py-3 rounded-xl border border-slate-200">
            <span className="text-sm text-slate-600">Sisa Tagihan</span>
            <span className="text-base font-bold tabular-nums whitespace-nowrap text-status-warning">
              {formatCurrency(newInvoice.balanceRemaining || 0)}
            </span>
          </div>

          <div>
            <label htmlFor="fin-inv-notes" className={labelClass}>Catatan</label>
            <textarea
              id="fin-inv-notes"
              rows={3}
              value={newInvoice.notes}
              onChange={(e) => setNewInvoice({ ...newInvoice, notes: e.target.value })}
              placeholder="Contoh: termin pembayaran"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsInvoiceModalOpen(false)}
            >
              Batal
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Menyimpan…' : 'Buat Faktur'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* MODAL 3: CETAK FAKTUR PDF */}
      <Modal
        isOpen={isPrintModalOpen}
        onClose={() => setIsPrintModalOpen(false)}
        title={`Faktur ${printInvoice?.id ?? ''}`}
        subtitle="Dokumen A4 resmi di atas kop surat HIJ."
        maxWidth="4xl"
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setIsPrintModalOpen(false)}>
              Tutup
            </Button>
            <Button onClick={handleDownloadInvoicePdf} disabled={isDownloadingInvoice}>
              <Download size={16} aria-hidden="true" />
              {isDownloadingInvoice ? 'Membuat PDF…' : 'Unduh PDF'}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <FormError>{invoicePdfError}</FormError>
          <div className="max-h-[68vh] overflow-auto rounded-xl bg-slate-200 p-3">
            <div className="mx-auto w-fit">
              {printInvoice && (
                <InvoiceDocument
                  id="invoice-doc"
                  invoice={printInvoice}
                  order={orders.find(o => o.id === printInvoice.orderId)}
                  customer={customers.find(c => c.id === printInvoice.customerId)}
                />
              )}
            </div>
          </div>
        </div>
      </Modal>

    </div>
  );
};

