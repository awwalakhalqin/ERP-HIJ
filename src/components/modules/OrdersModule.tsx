import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ClipboardList,
  Plus,
  Upload,
  AlertTriangle,
  Pencil,
  ShoppingCart,
  Search,
  Download,
  Trash2,
  CheckCircle2,
  Circle,
  FileCheck,
  Printer,
  Sparkles,
  Clock,
  RotateCcw,
  AlertCircle,
  Info,
  CalendarClock
} from 'lucide-react';
import { Order, Customer, SPK, Design, Sample, Invoice, PaymentTerm } from '../../types';
import { fetchResource, createResource, updateResource, deleteResource, fetchReadinessData, issueSpkApi, commitExcelImportApi } from '../../services/api';
import { parseWorkbookData, type ImportPlan } from '../../lib/excelImport';
import { db } from '../../db/dexie';
import { cn, formatCurrency, formatDate, formatDateTime, generateId, statusLabel } from '../../lib/utils';
import { getOrderReadiness, ordersAwaitingSpk, isSpkOptionalForOrder, type ReadinessData, type OrderReadiness } from '../../lib/readiness';
import {
  parseSizeRows,
  serializeSizeRows,
  sizeRowsTotal,
  effectiveUnitPrice,
  isBelowMoq,
  type SizeRow
} from '../../lib/pricing';
import {
  PaymentTermsEditor,
  createDefaultSchedule,
  withAmounts,
  totalPercentage
} from '../ui/PaymentTermsEditor';
import { exportElementToPdf } from '../../services/pdfGenerator';
import {
  DetailDrawer,
  DetailSection,
  DetailField,
  DetailStats,
  DetailBlock,
  RowDetailButton
} from '../ui/DetailDrawer';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  TableRowActions,
  TableEmptyRow,
  TableSkeletonRows,
  TableSortHead,
  sortRows,
  type SortState
} from '../ui/Table';
import { PageHeader } from '../ui/PageHeader';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge, StatusBadge, DeadlineBadge } from '../ui/Badge';
import { Input } from '../ui/Input';
import {
  FieldLabel,
  FieldHint,
  FieldError,
  Select,
  Textarea,
  CurrencyInput,
  FormSection,
  FormError,
  FormNotice,
  ChipButton
} from '../ui/Field';
import { Modal } from '../ui/Modal';
import { InvoiceDocument } from '../documents/InvoiceDocument';
import { OrderFlowStepper } from '../ui/OrderFlowStepper';

const ReadinessBadge: React.FC<{ readiness?: OrderReadiness }> = ({ readiness }) => {
  if (!readiness) return null;
  return readiness.ready
    ? <Badge variant="done" size="sm">Siap Produksi</Badge>
    : <Badge variant="warning" size="sm">Menunggu Syarat ({readiness.blockingMetCount}/{readiness.blockingTotal})</Badge>;
};

const SpkStatusTag: React.FC<{ spk?: SPK; readiness?: OrderReadiness; order?: Order; solid?: boolean }> = ({
  spk,
  readiness,
  order,
  solid
}) => {
  if (spk) {
    const isDone = spk.status === 'QC Passed' || spk.status === 'Completed';
    if (isDone) {
      return (
        <Badge variant="done" size="sm" solid={solid}>
          <CheckCircle2 size={12} className="shrink-0" aria-hidden="true" />
          <span>Selesai</span>
        </Badge>
      );
    }
    return (
      <Badge variant="progress" size="sm" solid={solid}>
        <FileCheck size={12} className="shrink-0" aria-hidden="true" />
        <span>{statusLabel(spk.status) || spk.status}</span>
      </Badge>
    );
  }

  const isOptional = isSpkOptionalForOrder(order);
  if (isOptional) {
    return (
      <Badge variant="amber" size="sm" solid={solid} className="bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 border-amber-300">
        <Sparkles size={12} className="shrink-0" aria-hidden="true" />
        <span>SPK Opsional</span>
      </Badge>
    );
  }

  if (readiness?.ready) {
    return (
      <Badge variant="warning" size="sm" solid={solid}>
        <Sparkles size={12} className="shrink-0" aria-hidden="true" />
        <span>Siap terbit</span>
      </Badge>
    );
  }

  const met = readiness?.blockingMetCount ?? 0;
  const total = readiness?.blockingTotal ?? 2;
  return (
    <Badge variant="warning" size="sm" solid={solid}>
      <Clock size={12} className="shrink-0" aria-hidden="true" />
      <span>Syarat {met}/{total}</span>
    </Badge>
  );
};

export const OrdersModule: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [spks, setSpks] = useState<SPK[]>([]);
  const [designs, setDesigns] = useState<Design[]>([]);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [readinessData, setReadinessData] = useState<ReadinessData>({ payments: [], samples: [], procurements: [], patterns: [] });
  const [loading, setLoading] = useState(true);

  // Filters & Sorting
  const [searchQuery, setSearchQuery] = useState('');
  const [orderStageFilter, setOrderStageFilter] = useState<'ALL' | 'WAITING' | 'IN_PRODUCTION' | 'COMPLETED'>('ALL');
  const [orderSort, setOrderSort] = useState<SortState>({ key: 'newest', direction: 'desc' });
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Excel import: parse locally, show the plan, write nothing until approved.
  const importFileRef = useRef<HTMLInputElement>(null);
  const [importPlan, setImportPlan] = useState<ImportPlan | null>(null);
  const [importFileName, setImportFileName] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  // Drawer: Selected Order Detail
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  // Modal: Invoice Print Preview
  const [printInvoice, setPrintInvoice] = useState<Invoice | null>(null);
  const [isDownloadingInvoice, setIsDownloadingInvoice] = useState(false);
  const [invoicePdfError, setInvoicePdfError] = useState<string | null>(null);

  // Modal: Tambah Pesanan Manual (Khusus Repeat Order)
  const [isRepeatOrderModalOpen, setIsRepeatOrderModalOpen] = useState(false);
  /** Set while the manual-order modal is editing an existing order rather than creating one. */
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [repeatSizeRows, setRepeatSizeRows] = useState<SizeRow[]>([]);
  const [repeatCustomerId, setRepeatCustomerId] = useState<string>('');
  const [selectedPastOrderId, setSelectedPastOrderId] = useState<string>('');
  const [repeatFormData, setRepeatFormData] = useState<Partial<Order>>({
    productType: '',
    material: '',
    color: '',
    size: '',
    accessories: '',
    sablonBordir: '',
    quantity: 50,
    price: 0,
    totalPrice: 0,
    deadline: '',
    notes: '',
    downPayment: 0
  });
  const [savingRepeatOrder, setSavingRepeatOrder] = useState(false);
  const [repeatOrderError, setRepeatOrderError] = useState<string | null>(null);

  // State for manual SPK issuing in progress
  const [issuingSpkId, setIssuingSpkId] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4500);
  };

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [orderRes, customerRes, spkRes, readinessRes, designRes, sampleRes, invoiceRes] = await Promise.all([
        fetchResource<Order>('orders'),
        fetchResource<Customer>('customers'),
        fetchResource<SPK>('spk_produksi'),
        fetchReadinessData(),
        fetchResource<Design>('designs'),
        fetchResource<Sample>('samples'),
        fetchResource<Invoice>('invoices')
      ]);
      setOrders(orderRes || []);
      setCustomers(customerRes || []);
      setSpks(spkRes || []);
      setReadinessData(readinessRes);
      setDesigns(designRes || []);
      setSamples(sampleRes || []);
      setInvoices(invoiceRes || []);
    } catch (err) {
      console.error('Failed to load orders data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Map Readiness by Order
  const readinessByOrder = useMemo(() => {
    const map = new Map<string, OrderReadiness>();
    orders.forEach(o => map.set(o.id, getOrderReadiness(o, readinessData)));
    return map;
  }, [orders, readinessData]);

  // Selected Order SPK & Readiness
  const selectedSpk = useMemo(() => {
    if (!selectedOrder) return null;
    return spks.find(s => s.orderId === selectedOrder.id) || null;
  }, [selectedOrder, spks]);

  const selectedReadiness = useMemo(() => {
    if (!selectedOrder) return null;
    return readinessByOrder.get(selectedOrder.id) || null;
  }, [selectedOrder, readinessByOrder]);

  // Past Orders of the selected customer for Repeat Order modal
  const customerPastOrders = useMemo(() => {
    if (!repeatCustomerId) return [];
    return orders.filter(o => o.customerId === repeatCustomerId);
  }, [orders, repeatCustomerId]);

  // Open Repeat Order Modal
  /*
   * Only repeat orders are editable here. Everything else carries a quotation
   * behind it, and changing those goes through Revisi Qty on the quotation so
   * the penawaran and the faktur are reissued together.
   */
  const canEditOrderInPlace = (order?: Order | null) => order?.isRepeatOrder === true;

  /*
   * The size table is the single source of the quantity, and the quantity
   * decides which of the two MOQ rates prices the job. Installments follow the
   * total, so everything is recomputed from one place.
   */
  const recalcRepeat = (patch: Partial<Order>, rows?: SizeRow[]) => {
    setRepeatFormData(prev => {
      const next = { ...prev, ...patch };
      const activeRows = rows ?? repeatSizeRows;
      const filled = activeRows.filter(row => row.size.trim());
      if (rows) next.size = serializeSizeRows(rows);
      if (filled.length > 0) next.quantity = sizeRowsTotal(filled);
      const total = (Number(next.quantity) || 0) * effectiveUnitPrice(next);
      next.totalPrice = total;
      next.paymentSchedule = next.paymentSchedule
        ? withAmounts(next.paymentSchedule, total)
        : createDefaultSchedule(total);
      return next;
    });
    if (rows) setRepeatSizeRows(rows);
  };

  const handleOpenEditOrder = (order: Order) => {
    setRepeatOrderError(null);
    setEditingOrderId(order.id);
    setRepeatCustomerId(order.customerId || '');
    setSelectedPastOrderId(order.repeatFromOrderId || '');
    setRepeatFormData({
      productType: order.productType,
      material: order.material,
      color: order.color,
      size: order.size,
      sizeChart: order.sizeChart,
      accessories: order.accessories,
      sablonBordir: order.sablonBordir,
      quantity: order.quantity,
      price: order.price,
      totalPrice: order.totalPrice,
      downPayment: order.dpRequired,
      deadline: order.deadline,
      needsProcurement: order.needsProcurement,
      notes: order.notes,
      designId: order.designId,
      designName: order.designName,
      designUrl: order.designUrl
    });
    setRepeatSizeRows(parseSizeRows(order.size));
    setSelectedOrder(null);
    setIsRepeatOrderModalOpen(true);
  };

  const handleOpenRepeatOrderModal = () => {
    setRepeatOrderError(null);
    setEditingOrderId(null);
    setRepeatSizeRows([]);
    setRepeatCustomerId('');
    setSelectedPastOrderId('');
    setRepeatFormData({
      productType: '',
      material: '',
      color: '',
      size: '',
      accessories: '',
      sablonBordir: '',
      quantity: 50,
      price: 0,
      totalPrice: 0,
      deadline: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
      notes: '',
      downPayment: 0
    });
    setIsRepeatOrderModalOpen(true);
  };

  // Handler when a past order is selected in the repeat order form
  const handleSelectPastOrder = (pastId: string) => {
    setSelectedPastOrderId(pastId);
    if (!pastId) {
      setRepeatFormData(prev => ({
        ...prev,
        productType: '',
        material: '',
        color: '',
        size: '',
        accessories: '',
        sablonBordir: '',
        price: 0,
        totalPrice: 0
      }));
      return;
    }

    const past = orders.find(o => o.id === pastId);
    if (past) {
      setRepeatSizeRows(parseSizeRows(past.size));
      const unitPrice = past.price || 0;
      const initialQty = repeatFormData.quantity || 50;
      const total = initialQty * unitPrice;
      setRepeatFormData(prev => ({
        ...prev,
        productType: past.productType,
        material: past.material || '-',
        color: past.color || 'Custom',
        size: past.size || 'All Size',
        sizeChart: past.sizeChart,
        accessories: past.accessories || '-',
        sablonBordir: past.sablonBordir || past.accessories || '-',
        price: unitPrice,
        moq: past.moq || 100,
        priceBelowMoq: past.priceBelowMoq || unitPrice,
        totalPrice: total,
        paymentSchedule: createDefaultSchedule(total),
        designId: past.designId,
        designName: past.designName || past.productType,
        designUrl: past.designUrl || '/templates/Halaman1.png',
        repeatFromOrderId: past.id,
        isRepeatOrder: true,
        needsSample: false,
        sampleStatus: 'Approved',
        sampleWaivedReferenceOrderId: past.id,
        needsProcurement: past.needsProcurement || 'Perlu Pengadaan',
        notes: `[Repeat Order dari ${past.po || past.id}]. Spesifikasi bahan dan model disamakan.`
      }));
    }
  };

  // Submit Repeat Order Manual
  const handleSubmitRepeatOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setRepeatOrderError(null);

    if (!repeatCustomerId) {
      setRepeatOrderError('Pilih pelanggan terlebih dahulu.');
      return;
    }
    if (!editingOrderId && !selectedPastOrderId) {
      setRepeatOrderError('Pilih produk dari riwayat pesanan sebelumnya.');
      return;
    }
    const qty = Number(repeatFormData.quantity);
    if (!qty || qty <= 0) {
      setRepeatOrderError('Kuantitas repeat order harus lebih besar dari 0.');
      return;
    }
    if (!Number(repeatFormData.price)) {
      setRepeatOrderError('Harga sesuai MOQ harus lebih besar dari Rp 0.');
      return;
    }
    if (!Number(repeatFormData.priceBelowMoq)) {
      setRepeatOrderError('Harga di bawah MOQ harus lebih besar dari Rp 0.');
      return;
    }
    if (!Number(repeatFormData.moq)) {
      setRepeatOrderError('MOQ harus lebih besar dari 0.');
      return;
    }
    if (!repeatFormData.deadline) {
      setRepeatOrderError('Target tanggal selesai / deadline wajib diisi.');
      return;
    }
    const schedule = repeatFormData.paymentSchedule;
    if (schedule && schedule.length > 0 && totalPercentage(schedule) !== 100) {
      setRepeatOrderError(
        `Total persentase termin harus 100% (saat ini ${totalPercentage(schedule)}%).`
      );
      return;
    }
    const unitPrice = effectiveUnitPrice(repeatFormData);

    setSavingRepeatOrder(true);
    try {
      const cust = customers.find(c => c.id === repeatCustomerId);
      const total = qty * unitPrice;
      const now = new Date();
      const termsWithAmounts = schedule && schedule.length > 0
        ? withAmounts(schedule, total)
        : createDefaultSchedule(total);
      // The first instalment is what finance chases before production starts.
      const dpFromTerms = Number(termsWithAmounts[0]?.amount) || Math.round(total * 0.5);

      if (editingOrderId) {
        const changes = {
          productType: repeatFormData.productType,
          quantity: qty,
          price: unitPrice,
          totalPrice: total,
          moq: Number(repeatFormData.moq) || 100,
          priceBelowMoq: Number(repeatFormData.priceBelowMoq) || Number(repeatFormData.price),
          paymentSchedule: termsWithAmounts,
          dpRequired: dpFromTerms,
          deadline: repeatFormData.deadline,
          material: repeatFormData.material || '-',
          color: repeatFormData.color || 'Custom',
          size: serializeSizeRows(repeatSizeRows) || repeatFormData.size || 'All Size',
          sizeChart: repeatFormData.sizeChart,
          accessories: repeatFormData.accessories || '-',
          sablonBordir: repeatFormData.sablonBordir || '-',
          needsProcurement: repeatFormData.needsProcurement || 'Perlu Pengadaan',
          notes: repeatFormData.notes,
          updatedAt: now.toISOString()
        };
        await updateResource('orders', editingOrderId, changes);

        // Keep the money and the shop floor in step with the new quantity.
        const linkedInvoice = invoices.find(inv => inv.orderId === editingOrderId && !inv.supersededBy);
        if (linkedInvoice) {
          const paid = Number(linkedInvoice.downPaymentReceived) || 0;
          const balanceRemaining = Math.max(0, total - paid);
          await updateResource('invoices', linkedInvoice.id, {
            amount: total,
            total,
            balanceRemaining,
            status: total > 0 && balanceRemaining <= 0 ? 'Lunas' : paid > 0 ? 'DP Dibayar' : 'Belum Bayar',
            dueDate: repeatFormData.deadline
          });
        }
        const linkedSpk = spks.find(spk => spk.orderId === editingOrderId);
        if (linkedSpk) {
          await updateResource('spk_produksi', linkedSpk.id, {
            targetQty: qty,
            tanggalSelesai: repeatFormData.deadline
          });
        }

        setIsRepeatOrderModalOpen(false);
        setEditingOrderId(null);
        await loadData();
        showToast(
          `Pesanan ${editingOrderId} diperbarui (${qty} Pcs). Tagihan${linkedSpk ? ' dan SPK' : ''} terkait ikut disesuaikan.`
        );
        return;
      }

      const nextNum = orders.length + 1;
      const newOrderId = `ORD-${String(nextNum).padStart(3, '0')}`;
      const clientCode = (cust?.name || 'HIJ').replace(/[^a-zA-Z0-9]/g, '').slice(0, 3).toUpperCase();
      const newPo = `PO-${clientCode}-REPEAT-${now.getFullYear()}-${String(nextNum).padStart(3, '0')}`;

      const newOrderPayload: Order = {
        id: newOrderId,
        po: newPo,
        customerId: repeatCustomerId,
        customerName: cust?.name || 'Pelanggan',
        productType: repeatFormData.productType!,
        quantity: qty,
        price: unitPrice,
        totalPrice: total,
        moq: Number(repeatFormData.moq) || 100,
        priceBelowMoq: Number(repeatFormData.priceBelowMoq) || Number(repeatFormData.price),
        paymentSchedule: termsWithAmounts,
        dpRequired: dpFromTerms,
        downPayment: 0,
        dpPercent: 0,
        deadline: repeatFormData.deadline!,
        status: 'Order',
        isRepeatOrder: true,
        repeatFromOrderId: selectedPastOrderId,
        material: repeatFormData.material || '-',
        color: repeatFormData.color || 'Custom',
        size: serializeSizeRows(repeatSizeRows) || repeatFormData.size || 'All Size',
        sizeChart: repeatFormData.sizeChart,
        accessories: repeatFormData.accessories || '-',
        sablonBordir: repeatFormData.sablonBordir || '-',
        needsProcurement: repeatFormData.needsProcurement || 'Perlu Pengadaan',
        notes: repeatFormData.notes || `Repeat Order dari ${selectedPastOrderId}`,
        timestamp: now.toISOString(),
        user: 'Staf Penjualan',
        needsSample: false,
        sampleStatus: 'Approved',
        sampleWaivedReferenceOrderId: selectedPastOrderId,
        designId: repeatFormData.designId,
        designName: repeatFormData.designName,
        designUrl: repeatFormData.designUrl
      };

      // 1. Simpan order baru
      const createdOrder = await createResource('orders', newOrderPayload);

      // 2. Otomatis buatkan draft Invoice untuk pesanan ini
      try {
        const nextInvNum = invoices.length + 1;
        const newInvoiceId = `INV-${now.getFullYear()}-${String(nextInvNum).padStart(3, '0')}`;
        await createResource('invoices', {
          id: newInvoiceId,
          orderId: createdOrder.id,
          customerId: createdOrder.customerId,
          customerName: createdOrder.customerName,
          amount: total,
          total: total,
          downPaymentReceived: 0,
          balanceRemaining: total,
          dueDate: createdOrder.deadline,
          status: 'Belum Bayar',
          reviewStatus: 'Draft',
          timestamp: now.toISOString(),
          notes: `Tagihan untuk repeat order ${createdOrder.po || createdOrder.id}`
        });
      } catch (invErr) {
        console.warn('Auto invoice notice:', invErr);
      }

      setIsRepeatOrderModalOpen(false);
      await loadData();
      showToast(`Pesanan manual Repeat Order ${newOrderPayload.po} (${newOrderPayload.quantity} Pcs) berhasil dibuat!`);
    } catch (err: any) {
      setRepeatOrderError(err?.message || 'Gagal membuat pesanan repeat order. Silakan coba lagi.');
    } finally {
      setSavingRepeatOrder(false);
    }
  };

  // Quick Issue SPK Manual for Repeat Order or Qty < 50
  const handleQuickIssueSpk = async (order: Order) => {
    if (!window.confirm(`Terbitkan SPK Manual untuk pesanan ${order.po || order.id}?`)) return;

    try {
      setIssuingSpkId(order.id);
      const result = await issueSpkApi(order.id, {
        plannedStart: new Date().toISOString().split('T')[0],
        notes: order.notes,
        user: 'PPIC Manual'
      });
      showToast(result.message || `SPK manual untuk ${order.id} berhasil diterbitkan.`);
      await loadData();
    } catch (err: any) {
      // Fallback: Jika endpoint issue-spk gagal koneksi, buat SPK langsung
      try {
        const spkPayload: Partial<SPK> = {
          id: `SPK-${order.id}`,
          orderId: order.id,
          po: order.po || `PO-${order.id}`,
          customerId: order.customerId,
          customerName: order.customerName,
          productName: order.productType,
          targetQty: Number(order.quantity) || 1,
          material: order.material || '-',
          sablonBordir: order.sablonBordir || order.accessories || '-',
          tanggalMasuk: new Date().toISOString().split('T')[0],
          tanggalSelesai: order.deadline,
          status: 'In Progress',
          notes: order.notes,
          mockupDepan: order.designUrl || '/templates/Halaman1.png'
        };
        await createResource('spk_produksi', spkPayload);
        await updateResource('orders', order.id, { status: 'In Production' });
        showToast(`SPK manual untuk ${order.id} berhasil dibuat.`);
        await loadData();
      } catch (fallbackErr: any) {
        alert(err?.message || fallbackErr?.message || 'Gagal menerbitkan SPK manual.');
      }
    } finally {
      setIssuingSpkId(null);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setImportError(null);
    try {
      const buffer = await file.arrayBuffer();
      const label = file.name.replace(/\.xlsx?$/i, '');
      const plan = parseWorkbookData(buffer, label);
      if (plan.orders.length === 0) {
        setImportError('Tidak ada baris antrian yang terbaca. Pastikan berkas memuat sheet bulanan dengan kolom BRAND.');
        return;
      }
      setImportFileName(file.name);
      setImportPlan(plan);
    } catch (err: any) {
      setImportError(err?.message || 'Berkas tidak bisa dibaca. Pastikan formatnya .xlsx.');
    }
  };

  const handleConfirmImport = async () => {
    if (!importPlan || importing) return;
    try {
      setImporting(true);
      setImportError(null);
      const result = await commitExcelImportApi({
        monthLabel: importPlan.monthLabel,
        orders: importPlan.orders,
        samples: importPlan.samples
      });
      setImportPlan(null);
      showToast(result.message || 'Impor selesai.');
      await loadData();
    } catch (err: any) {
      setImportError(err?.message || 'Impor gagal disimpan.');
    } finally {
      setImporting(false);
    }
  };

  // Delete Order
  const handleDeleteOrder = async (id: string) => {
    if (!window.confirm(`Hapus pesanan ${id}? Tindakan ini tidak dapat dibatalkan.`)) return;
    try {
      await deleteResource('orders', id);
      showToast(`Pesanan ${id} berhasil dihapus.`);
      await loadData();
      if (selectedOrder?.id === id) setSelectedOrder(null);
    } catch (err) {
      alert('Gagal menghapus pesanan. Coba lagi.');
    }
  };

  // Invoice Print Modal
  const handleOpenInvoicePrint = (order: Order) => {
    let inv = invoices.find(i => i.orderId === order.id);
    if (!inv) {
      inv = {
        id: `INV-AUTO-${order.id}`,
        orderId: order.id,
        customerId: order.customerId,
        customerName: order.customerName,
        amount: order.totalPrice,
        total: order.totalPrice,
        downPaymentReceived: order.downPayment || 0,
        balanceRemaining: Math.max(0, order.totalPrice - (order.downPayment || 0)),
        dueDate: order.deadline,
        status: (order.downPayment || 0) >= order.totalPrice ? 'Lunas' : (order.downPayment || 0) > 0 ? 'DP Dibayar' : 'Belum Bayar',
        paymentSchedule: order.paymentSchedule
      };
    }
    setPrintInvoice(inv);
    setInvoicePdfError(null);
  };

  const handleDownloadInvoicePdf = async () => {
    if (!printInvoice) return;
    try {
      setIsDownloadingInvoice(true);
      setInvoicePdfError(null);
      await exportElementToPdf('order-invoice-doc', `Invoice_${printInvoice.id}.pdf`);
      showToast(`PDF Invoice ${printInvoice.id} berhasil diunduh.`);
    } catch (err: any) {
      setInvoicePdfError(err?.message || 'Gagal membuat file PDF invoice.');
    } finally {
      setIsDownloadingInvoice(false);
    }
  };

  // Filter & Sort Orders
  const filteredOrders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const rows = orders.filter(item => {
      const matchSearch =
        !q ||
        item.id.toLowerCase().includes(q) ||
        (item.po || '').toLowerCase().includes(q) ||
        (item.customerName || '').toLowerCase().includes(q) ||
        (item.productType || '').toLowerCase().includes(q) ||
        (item.material || '').toLowerCase().includes(q);

      const matchStage =
        orderStageFilter === 'ALL' ? true :
        orderStageFilter === 'WAITING' ? (item.status === 'Order' || item.status === 'Sample') :
        orderStageFilter === 'IN_PRODUCTION' ? item.status === 'In Production' :
        orderStageFilter === 'COMPLETED' ? (item.status === 'Shipping' || item.status === 'Completed') : true;

      return matchSearch && matchStage;
    });

    return sortRows(rows, orderSort, (item, key) => {
      // Default view: the pesanan created most recently leads the list.
      if (key === 'newest') return new Date(item.timestamp || item.deadline || 0).getTime();
      if (key === 'id') return item.id;
      if (key === 'po') return item.po;
      if (key === 'customerName') return item.customerName;
      if (key === 'productType') return item.productType;
      if (key === 'quantity') return item.quantity;
      if (key === 'totalPrice') return item.totalPrice;
      if (key === 'deadline') return item.deadline;
      if (key === 'status') return item.status;
      return (item as any)[key];
    });
  }, [orders, searchQuery, orderStageFilter, orderSort]);

  // Order Counts
  const orderCounts = useMemo(() => {
    const waiting = orders.filter(o => o.status === 'Order' || o.status === 'Sample').length;
    const inProd = orders.filter(o => o.status === 'In Production').length;
    const completed = orders.filter(o => o.status === 'Shipping' || o.status === 'Completed').length;
    return { all: orders.length, waiting, inProd, completed };
  }, [orders]);

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-2xl border border-border bg-popover px-4 py-3 text-sm font-medium text-popover-foreground shadow-lg animate-in fade-in slide-in-from-bottom-2"
        >
          <Sparkles size={18} className="text-brand-teal shrink-0" aria-hidden="true" />
          <span>{toastMessage}</span>
        </div>
      )}

      <input
        ref={importFileRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={handleImportFile}
      />

      {importError && !importPlan && (
        <div role="alert" className="rounded-2xl border border-brand-red/30 bg-rose-50 px-4 py-3 text-sm font-medium text-foreground">
          {importError}
        </div>
      )}

      {/* IMPORT PREVIEW — nothing is written until this is confirmed */}
      <Modal
        isOpen={!!importPlan}
        onClose={() => setImportPlan(null)}
        title="Pratinjau Impor Excel"
        subtitle={importFileName}
        maxWidth="4xl"
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="outline" disabled={importing} onClick={() => setImportPlan(null)}>
              Batal
            </Button>
            <Button type="button" disabled={importing} onClick={handleConfirmImport}>
              {importing ? 'Menyimpan…' : `Impor ${importPlan?.orders.length ?? 0} Pesanan`}
            </Button>
          </div>
        }
      >
        {importPlan && (
          <div className="space-y-5">
            {importError && (
              <div role="alert" className="rounded-xl border border-brand-red/30 bg-rose-50 px-3.5 py-3 text-sm font-medium">
                {importError}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ['Pesanan', importPlan.orders.length],
                ['Total pcs', importPlan.totalQuantity],
                ['Agenda sampel', importPlan.samples.length],
                ['Perlu dicek', importPlan.needsReview]
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-xl border border-border bg-muted/40 p-3">
                  <span className="block text-xs font-semibold text-muted-foreground">{label}</span>
                  <span className="mt-0.5 block text-xl font-bold tabular-nums text-foreground">{value}</span>
                </div>
              ))}
            </div>

            {importPlan.needsReview > 0 && (
              <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-50 px-3.5 py-3">
                <AlertTriangle size={18} className="mt-px shrink-0 text-amber-600" aria-hidden="true" />
                <div className="min-w-0 text-xs text-amber-900">
                  <p className="text-sm font-semibold">
                    {importPlan.needsReview} pesanan: rincian ukuran tidak cocok dengan jumlah di antrian
                  </p>
                  <p className="mt-0.5">
                    Jumlah pesanan tetap memakai angka antrian. Rincian ukurannya <b>tidak</b> ikut disimpan sampai
                    selisihnya dibereskan, supaya tidak ada yang memotong kain dari angka yang belum diverifikasi.
                  </p>
                </div>
              </div>
            )}

            <div>
              <h3 className="mb-2 text-sm font-bold text-foreground">Pesanan yang akan dibuat</h3>
              <div className="max-h-72 overflow-auto rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/80 text-xs font-semibold text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-left">Brand</th>
                      <th scope="col" className="px-3 py-2 text-right">Qty</th>
                      <th scope="col" className="px-3 py-2 text-left">Deadline</th>
                      <th scope="col" className="px-3 py-2 text-left">Rincian</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {importPlan.orders.map(o => (
                      <tr key={o.sourceRow}>
                        <td className="px-3 py-2">
                          <span className="font-semibold text-foreground">{o.brand}</span>
                          {o.pic && <span className="ml-1.5 text-xs text-muted-foreground">· {o.pic}</span>}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">{o.quantity}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{o.deadline || '\u2014'}</td>
                        <td className="px-3 py-2 text-xs">
                          {!o.detailSheet ? (
                            <span className="text-muted-foreground">tanpa sheet rincian</span>
                          ) : o.detailWarning ? (
                            <span className="text-amber-700">
                              sheet {o.detailTotal} pcs ≠ antrian {o.quantity} — ditahan
                            </span>
                          ) : (
                            <span className="text-status-done">{o.products.length} produk, cocok</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {importPlan.skipped.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-bold text-foreground">
                  Sheet yang dilewati ({importPlan.skipped.length})
                </h3>
                <ul className="space-y-1 rounded-xl border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                  {importPlan.skipped.map(sk => (
                    <li key={sk.sheet}>
                      <b className="text-foreground">{sk.sheet}</b> — {sk.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Page Header */}
      <PageHeader
        title="Pesanan Masuk"
        description="Pencatatan pesanan resmi dari Surat Penawaran yang disetujui (Deal), pembuatan pesanan manual khusus Repeat Order, serta pemantauan status SPK dan kesiapan produksi."
        actions={
          <>
            <Button variant="outline" onClick={() => importFileRef.current?.click()}>
              <Upload size={16} aria-hidden="true" /> Impor Excel
            </Button>
            <Button onClick={handleOpenRepeatOrderModal}>
              <RotateCcw size={16} aria-hidden="true" /> Tambah Pesanan (Repeat Order)
            </Button>
          </>
        }
      />

      {/* Notice Banner: Repeat Order Only Policy */}
      <div className="rounded-2xl border border-border bg-muted/40 p-4 flex items-start gap-3.5 text-xs text-muted-foreground">
        <Info size={18} className="text-primary mt-0.5 shrink-0" />
        <div className="space-y-1">
          <p className="font-semibold text-foreground">Kebijakan Pembuatan Pesanan Manual:</p>
          <p>
            Pembuatan pesanan manual <strong>hanya diperuntukkan bagi Repeat Order</strong> pelanggan lama yang memesan produk/model serupa terdahulu. Untuk pesanan custom baru dengan desain atau kain baru, pembuatan pesanan wajib melalui alur <strong>Desain & Sampel → Surat Penawaran Harga</strong>.
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <Card className="p-4 flex items-center gap-3 bg-linear-to-br from-card to-muted/20 border-border">
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
            <FileCheck size={20} />
          </div>
          <div>
            <p className="text-xs text-muted-foreground font-medium">Total Pesanan</p>
            <p className="text-2xl font-bold text-foreground">{orderCounts.all}</p>
          </div>
        </Card>

        <Card className="p-4 flex items-center gap-3 bg-linear-to-br from-card to-amber-500/5 border-amber-500/20">
          <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-500">
            <Clock size={20} />
          </div>
          <div>
            <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">Menunggu SPK</p>
            <p className="text-2xl font-bold text-foreground">{orderCounts.waiting}</p>
          </div>
        </Card>

        <Card className="p-4 flex items-center gap-3 bg-linear-to-br from-card to-blue-500/5 border-blue-500/20">
          <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-500">
            <CalendarClock size={20} />
          </div>
          <div>
            <p className="text-xs text-blue-600 dark:text-blue-400 font-medium">Sedang Produksi</p>
            <p className="text-2xl font-bold text-foreground">{orderCounts.inProd}</p>
          </div>
        </Card>

        <Card className="p-4 flex items-center gap-3 bg-linear-to-br from-card to-emerald-500/5 border-emerald-500/20">
          <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-500">
            <CheckCircle2 size={20} />
          </div>
          <div>
            <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">Siap Kirim / Selesai</p>
            <p className="text-2xl font-bold text-foreground">{orderCounts.completed}</p>
          </div>
        </Card>
      </div>

      {/* Control Bar: Filter & Search */}
      <Card className="p-4 space-y-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
            <input
              type="text"
              placeholder="Cari no. PO, ID pesanan, pelanggan, atau nama produk..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-muted/40 border border-input rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            <button
              onClick={() => setOrderStageFilter('ALL')}
              className={cn(
                "px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all",
                orderStageFilter === 'ALL'
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-muted/40 hover:bg-muted text-muted-foreground"
              )}
            >
              Semua ({orderCounts.all})
            </button>
            <button
              onClick={() => setOrderStageFilter('WAITING')}
              className={cn(
                "px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all",
                orderStageFilter === 'WAITING'
                  ? "bg-amber-500 text-white shadow-xs"
                  : "bg-muted/40 hover:bg-muted text-muted-foreground"
              )}
            >
              Menunggu SPK ({orderCounts.waiting})
            </button>
            <button
              onClick={() => setOrderStageFilter('IN_PRODUCTION')}
              className={cn(
                "px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all",
                orderStageFilter === 'IN_PRODUCTION'
                  ? "bg-blue-500 text-white shadow-xs"
                  : "bg-muted/40 hover:bg-muted text-muted-foreground"
              )}
            >
              Produksi ({orderCounts.inProd})
            </button>
            <button
              onClick={() => setOrderStageFilter('COMPLETED')}
              className={cn(
                "px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all",
                orderStageFilter === 'COMPLETED'
                  ? "bg-emerald-500 text-white shadow-xs"
                  : "bg-muted/40 hover:bg-muted text-muted-foreground"
              )}
            >
              Selesai ({orderCounts.completed})
            </button>
          </div>
        </div>
      </Card>

      {/* Table of Orders */}
      {(
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableSortHead
                  sortKey="id"
                  sort={orderSort}
                  onSortChange={setOrderSort}
                
                  className="cell-sticky-start"
                >
                  No. PO
                </TableSortHead>
                <TableHead className="hidden min-[1800px]:table-cell">ID Pesanan</TableHead>
                <TableSortHead
                  sortKey="customerName"
                  sort={orderSort}
                  onSortChange={setOrderSort}
                  className="hidden md:table-cell"
                >
                  Pelanggan
                </TableSortHead>
                <TableHead className="hidden md:table-cell">Produk</TableHead>
                <TableSortHead
                  sortKey="quantity"
                  sort={orderSort}
                  onSortChange={setOrderSort}
                  align="right"
                  className="hidden sm:table-cell"
                >
                  Qty
                </TableSortHead>
                <TableHead className="hidden min-[1800px]:table-cell text-right">Harga Satuan</TableHead>
                <TableSortHead
                  sortKey="totalPrice"
                  sort={orderSort}
                  onSortChange={setOrderSort}
                >
                  Nilai Pesanan
                </TableSortHead>
                <TableSortHead
                  sortKey="deadline"
                  sort={orderSort}
                  onSortChange={setOrderSort}
                >
                  Deadline Kirim
                </TableSortHead>
                <TableHead>Status SPK</TableHead>
                <TableSortHead
                  sortKey="status"
                  sort={orderSort}
                  onSortChange={setOrderSort}
                >
                  Status
                </TableSortHead>
                <TableHead className="cell-sticky-end text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && orders.length === 0 ? (
                <TableSkeletonRows columns={11} />
              ) : filteredOrders.length === 0 ? (
                <TableEmptyRow
                  colSpan={11}
                  icon={<ShoppingCart size={20} />}
                  title={
                    searchQuery || orderStageFilter !== 'ALL'
                      ? 'Tidak ada pesanan yang cocok'
                      : 'Belum ada pesanan aktif'
                  }
                  description={
                    searchQuery || orderStageFilter !== 'ALL'
                      ? 'Coba ganti kata kunci atau bersihkan filter pencarian.'
                      : 'Pesanan masuk otomatis saat penawaran disetujui, atau dibuat langsung lewat Repeat Order.'
                  }
                  action={
                    searchQuery || orderStageFilter !== 'ALL' ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSearchQuery('');
                          setOrderStageFilter('ALL');
                        }}
                      >
                        Reset Filter
                      </Button>
                    ) : (
                      <Button size="sm" onClick={handleOpenRepeatOrderModal}>
                        <RotateCcw size={16} aria-hidden="true" /> Tambah Pesanan (Repeat Order)
                      </Button>
                    )
                  }
                />
              ) : (
                filteredOrders.map(order => {
                const matchingSpk = spks.find(s => s.orderId === order.id);
                const readiness = readinessByOrder.get(order.id);
                const isOptional = isSpkOptionalForOrder(order);

                return (
                  <TableRow key={order.id}>
                    <TableCell className="cell-sticky-start whitespace-nowrap font-mono font-semibold text-foreground">
                      {order.po || order.id}
                    </TableCell>
                    <TableCell className="hidden min-[1800px]:table-cell whitespace-nowrap font-mono text-muted-foreground">
                      {order.id}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <span className="block max-w-[150px] truncate font-medium text-foreground" title={order.customerName}>
                        {order.customerName}
                      </span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <span className="block max-w-[170px] truncate" title={order.productType}>
                        {order.productType}
                      </span>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-right whitespace-nowrap font-semibold text-foreground">
                      {order.quantity}
                    </TableCell>
                    <TableCell className="hidden min-[1800px]:table-cell text-right whitespace-nowrap text-muted-foreground">
                      {formatCurrency(order.price)}
                    </TableCell>
                    <TableCell className="font-bold text-foreground">
                      {formatCurrency(order.totalPrice)}
                    </TableCell>
                    <TableCell>
                      <DeadlineBadge
                        deadline={order.deadline}
                        completed={order.status === 'Completed'}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <SpkStatusTag spk={matchingSpk} readiness={readiness} order={order} solid />
                        {!matchingSpk && isOptional && (
                          <button
                            onClick={() => handleQuickIssueSpk(order)}
                            disabled={issuingSpkId === order.id}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
                          >
                            <CalendarClock size={12} />
                            {issuingSpkId === order.id ? 'Menerbitkan…' : 'Buat SPK Manual'}
                          </button>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={order.status} size="sm" solid />
                    </TableCell>
                    <TableCell className="cell-sticky-end text-right">
                      <TableRowActions>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Cetak Invoice Pesanan"
                          onClick={() => handleOpenInvoicePrint(order)}
                        >
                          <Printer size={14} className="text-muted-foreground hover:text-foreground" />
                        </Button>
                        <RowDetailButton label={order.po || order.id} onClick={() => setSelectedOrder(order)} />
                      </TableRowActions>
                    </TableCell>
                  </TableRow>
                );
                })
              )}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* DETAIL DRAWER: ORDER */}
      <DetailDrawer
        isOpen={!!selectedOrder}
        onClose={() => setSelectedOrder(null)}
        title={`Pesanan ${selectedOrder?.po || selectedOrder?.id || ''}`}
        subtitle={selectedOrder?.customerName}
        status={selectedOrder && <StatusBadge status={selectedOrder.status} />}
        size="lg"
        footer={
          selectedOrder && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const target = selectedOrder;
                  setSelectedOrder(null);
                  handleDeleteOrder(target.id);
                }}
                className="mr-auto text-rose-600 hover:bg-rose-50 hover:border-rose-300"
              >
                <Trash2 size={14} aria-hidden="true" /> Hapus
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleOpenInvoicePrint(selectedOrder)}>
                <Printer size={14} aria-hidden="true" /> Cetak Invoice
              </Button>
              {canEditOrderInPlace(selectedOrder) && (
                <Button variant="outline" size="sm" onClick={() => handleOpenEditOrder(selectedOrder)}>
                  <Pencil size={14} aria-hidden="true" /> Ubah Pesanan
                </Button>
              )}
              {!selectedSpk && isSpkOptionalForOrder(selectedOrder) && (
                <Button size="sm" onClick={() => handleQuickIssueSpk(selectedOrder)}>
                  <ClipboardList size={14} aria-hidden="true" /> Terbitkan SPK Langsung
                </Button>
              )}
            </div>
          )
        }
      >
        {selectedOrder && (
          <>
            <div className="pb-4">
              <OrderFlowStepper
                currentStep={
                  selectedOrder.status === 'Sample' ? 3 :
                  selectedOrder.status === 'In Production' ? 4 :
                  selectedOrder.status === 'QC' ? 5 :
                  (selectedOrder.status === 'Shipping' || selectedOrder.status === 'Completed') ? 6 :
                  selectedSpk ? 4 :
                  (selectedOrder.needsSample === false ? 4 : 3)
                }
                hasQuotation={!!selectedOrder.quotationId}
                isQuotationConverted={true}
                needsSample={selectedOrder.needsSample !== false}
                sampleStatus={selectedOrder.sampleStatus}
                hasSpk={!!selectedSpk}
                isProductionFinished={selectedSpk?.status === 'QC Passed' || selectedSpk?.status === 'Completed'}
                isQcPassed={selectedOrder.status === 'Shipping' || selectedOrder.status === 'Completed'}
                isShipped={selectedOrder.status === 'Completed'}
                compact
              />
            </div>

            <DetailStats
              items={[
                { label: 'Jumlah', value: `${selectedOrder.quantity} Pcs` },
                { label: 'Nilai pesanan', value: formatCurrency(selectedOrder.totalPrice), tone: 'accent' },
                { label: 'Deadline kirim', value: formatDate(selectedOrder.deadline) }
              ]}
            />

            {/* Banner SPK Opsional jika berlaku */}
            {isSpkOptionalForOrder(selectedOrder) && !selectedSpk && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 space-y-1.5 text-xs text-amber-900 dark:text-amber-200">
                <p className="font-semibold flex items-center gap-1.5">
                  <Sparkles size={14} className="text-amber-600 dark:text-amber-400" />
                  Status: SPK Opsional ({selectedOrder.isRepeatOrder ? 'Repeat Order' : 'Kuantitas < 50 pcs'})
                </p>
                <p className="text-[11px] text-muted-foreground">
                  SPK boleh diterbitkan kapan saja tanpa menunggu checklist syarat.
                </p>
                <Button size="sm" onClick={() => handleQuickIssueSpk(selectedOrder)}>
                  <CalendarClock size={12} /> Buat SPK Manual Sekarang
                </Button>
              </div>
            )}

            <DetailSection title="Rincian Pesanan">
              <DetailField label="Status pesanan">
                <StatusBadge status={selectedOrder.status} />
              </DetailField>
              <DetailField label="Jenis pesanan">
                {selectedOrder.isRepeatOrder ? (
                  <Badge variant="done" size="sm">Repeat Order</Badge>
                ) : selectedOrder.quotationId ? (
                  <Badge variant="idle" size="sm">Dari penawaran</Badge>
                ) : (
                  <Badge variant="idle" size="sm">Dibuat manual</Badge>
                )}
              </DetailField>
              <DetailField label="Sampel">
                {selectedOrder.needsSample === false ? (
                  <Badge variant="idle" size="sm">Tidak diperlukan</Badge>
                ) : selectedOrder.sampleStatus === 'Approved' ? (
                  <Badge variant="done" size="sm">Disetujui</Badge>
                ) : (
                  <Badge variant="warning" size="sm">Menunggu</Badge>
                )}
              </DetailField>
              <DetailField label="Pelanggan">{selectedOrder.customerName}</DetailField>
              <DetailField label="No. PO" mono>{selectedOrder.po}</DetailField>
              <DetailField label="ID Pesanan" mono>{selectedOrder.id}</DetailField>
              {selectedOrder.quotationId && (
                <DetailField label="Dari Penawaran" mono>{selectedOrder.quotationId}</DetailField>
              )}
              {selectedOrder.repeatFromOrderId && (
                <DetailField label="Acuan Pesanan Lama" mono>{selectedOrder.repeatFromOrderId}</DetailField>
              )}
            </DetailSection>

            <DetailSection title="Spesifikasi Produk">
              <DetailField label="Jenis produk">{selectedOrder.productType}</DetailField>
              <DetailField label="Bahan kain">{selectedOrder.material}</DetailField>
              <DetailField label="Warna">{selectedOrder.color}</DetailField>
              <DetailField label="Sablon / bordir">
                {selectedOrder.sablonBordir || selectedOrder.accessories}
              </DetailField>
              <DetailField label="Rincian ukuran">{selectedOrder.size}</DetailField>
              <DetailField label="Pengadaan bahan">{selectedOrder.needsProcurement}</DetailField>
            </DetailSection>

            {(selectedOrder.designUrl || selectedSpk?.mockupDepan) && (
              <DetailBlock title="Mockup Produksi">
                <figure className="flex items-center gap-4">
                  <img
                    src={selectedOrder.designUrl || selectedSpk?.mockupDepan || '/templates/Halaman1.png'}
                    alt={`Mockup ${selectedOrder.productType}`}
                    className="size-28 shrink-0 rounded-xl border border-border bg-white object-contain p-1"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = '/templates/Halaman1.png';
                    }}
                  />
                  <figcaption className="min-w-0 text-sm">
                    <span className="block font-semibold text-foreground">
                      {selectedOrder.designName || selectedOrder.productType}
                    </span>
                    {selectedOrder.designId && (
                      <span className="mt-0.5 block font-mono text-xs text-muted-foreground">
                        {selectedOrder.designId}
                      </span>
                    )}
                  </figcaption>
                </figure>
              </DetailBlock>
            )}

            <DetailSection title="Harga & Pembayaran">
              <DetailField label="Harga satuan">{formatCurrency(selectedOrder.price)}</DetailField>
              <DetailField label="Total nilai">{formatCurrency(selectedOrder.totalPrice)}</DetailField>
              <DetailField label="DP disepakati">
                {selectedOrder.dpRequired !== undefined ? formatCurrency(selectedOrder.dpRequired) : undefined}
              </DetailField>
              <DetailField label="DP diterima">
                {selectedOrder.downPayment !== undefined ? formatCurrency(selectedOrder.downPayment) : undefined}
              </DetailField>
            </DetailSection>

            {selectedSpk ? (
              <DetailSection title="Status Produksi & SPK">
                <DetailField label="Nomor SPK" mono>{selectedSpk.id}</DetailField>
                <DetailField label="Status SPK">
                  <StatusBadge status={selectedSpk.status} />
                </DetailField>
                <DetailField label="Tanggal Masuk">{formatDate(selectedSpk.tanggalMasuk)}</DetailField>
                <DetailField label="Target Selesai">{formatDate(selectedSpk.tanggalSelesai)}</DetailField>
              </DetailSection>
            ) : selectedReadiness && (
              <DetailBlock title="Syarat sebelum SPK terbit">
                <div className="mb-3">
                  <ReadinessBadge readiness={selectedReadiness} />
                </div>
                <ul className="space-y-2.5">
                  {selectedReadiness.requirements.map(req => (
                    <li key={req.key} className="flex items-start gap-2.5">
                      {req.met
                        ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
                        : <Circle size={18} className={cn('mt-0.5 shrink-0', req.blocking ? 'text-amber-500' : 'text-slate-300')} aria-hidden="true" />}
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">
                          {req.label}
                          {!req.blocking && (
                            <Badge variant="idle" size="sm" className="ml-1.5 align-middle">Info</Badge>
                          )}
                          <span className="sr-only">
                            : {req.met ? 'terpenuhi' : 'belum terpenuhi'}
                            {req.blocking ? '' : ', tidak menghambat penerbitan SPK'}
                          </span>
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{req.detail}</p>
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-muted-foreground">
                  {isSpkOptionalForOrder(selectedOrder)
                    ? 'Catatan: Pesanan ini memenuhi syarat SPK Opsional sehingga SPK dapat diterbitkan secara langsung kapan saja.'
                    : 'Hanya DP dan desain yang menahan penerbitan SPK. Bahan baku dan pola ditampilkan sebagai informasi — produksi boleh jalan sambil bahan menyusul. Terbitkan SPK di halaman Surat Perintah Kerja.'}
                </p>
              </DetailBlock>
            )}

            {selectedOrder.notes && (
              <DetailSection title="Catatan Khusus">
                <DetailField label="Instruksi" full>{selectedOrder.notes}</DetailField>
              </DetailSection>
            )}
          </>
        )}
      </DetailDrawer>

      {/* MODAL: TAMBAH PESANAN MANUAL (KHUSUS REPEAT ORDER) */}
      <Modal
        isOpen={isRepeatOrderModalOpen}
        onClose={() => {
          setIsRepeatOrderModalOpen(false);
          setEditingOrderId(null);
        }}
        title={editingOrderId ? `Ubah Pesanan ${editingOrderId}` : 'Buat Pesanan Manual (Khusus Repeat Order)'}
        subtitle={
          editingOrderId
            ? 'Ubah kuantitas, harga, spesifikasi, atau deadline pesanan manual ini.'
            : 'Khusus repeat order pelanggan lama yang memesan produk serupa terdahulu.'
        }
        maxWidth="3xl"
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setIsRepeatOrderModalOpen(false);
                setEditingOrderId(null);
              }}
            >
              Batal
            </Button>
            <Button onClick={handleSubmitRepeatOrder} disabled={savingRepeatOrder}>
              <CheckCircle2 size={16} aria-hidden="true" />
              {savingRepeatOrder
                ? 'Menyimpan…'
                : editingOrderId
                  ? 'Simpan Perubahan'
                  : 'Simpan Pesanan Repeat Order'}
            </Button>
          </div>
        }
      >
        <form onSubmit={handleSubmitRepeatOrder} className="space-y-5">
          <FormError>{repeatOrderError}</FormError>

          {editingOrderId && spks.some(spk => spk.orderId === editingOrderId) && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-900 dark:text-amber-200">
              <p className="font-semibold">Pesanan ini sudah punya SPK berjalan.</p>
              <p className="mt-1 text-[11px]">
                Mengubah kuantitas akan ikut memperbarui target SPK dan nilai tagihan. Pastikan tim produksi diberi tahu.
              </p>
            </div>
          )}

          {!editingOrderId && (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-3.5 space-y-1.5 text-xs text-muted-foreground">
            <p className="font-semibold text-primary flex items-center gap-1.5">
              <RotateCcw size={14} /> Ketentuan Repeat Order Tanpa Penawaran Baru
            </p>
            <p>
              Pilih pelanggan lama dan pilih produk yang pernah dipesan sebelumnya. Spesifikasi teknis (kain, sablon/bordir, warna, acuan mockup desain) akan otomatis terisi dan sampel fisik otomatis disetujui. Anda cukup menentukan kuantitas baru dan target deadline.
            </p>
          </div>
          )}

          {!editingOrderId && (
          <FormSection title="1. Pilih Pelanggan & Produk Sebelumnya">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  Pilih Pelanggan Lama <span className="text-rose-500">*</span>
                </label>
                <Select
                  value={repeatCustomerId}
                  onChange={e => {
                    setRepeatCustomerId(e.target.value);
                    setSelectedPastOrderId('');
                  }}
                  required
                >
                  <option value="">-- Pilih Pelanggan --</option>
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.company ? `(${c.company})` : ''}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  Produk dari Riwayat Pesanan <span className="text-rose-500">*</span>
                </label>
                <Select
                  value={selectedPastOrderId}
                  onChange={e => handleSelectPastOrder(e.target.value)}
                  disabled={!repeatCustomerId}
                  required
                >
                  <option value="">
                    {!repeatCustomerId
                      ? '-- Pilih pelanggan terlebih dahulu --'
                      : customerPastOrders.length === 0
                        ? '-- Pelanggan belum memiliki riwayat pesanan --'
                        : '-- Pilih Produk yang Ingin Dipesan Ulang --'}
                  </option>
                  {customerPastOrders.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.po || p.id} - {p.productType} ({p.quantity} pcs @ {formatCurrency(p.price)})
                    </option>
                  ))}
                </Select>
                {repeatCustomerId && customerPastOrders.length === 0 && (
                  <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                    Pelanggan ini belum pernah memiliki pesanan. Pesanan custom baru harus melalui Surat Penawaran terlebih dahulu.
                  </p>
                )}
              </div>
            </div>
          </FormSection>

          )}

          {(editingOrderId || selectedPastOrderId) && (
            <>
              <FormSection
                title={editingOrderId ? '1. Spesifikasi Produk' : '2. Spesifikasi Terpilih (Sesuai Pesanan Terdahulu)'}
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-foreground mb-1">
                      Nama / Jenis Produk
                    </label>
                    <Input
                      value={repeatFormData.productType || ''}
                      onChange={e => setRepeatFormData(prev => ({ ...prev, productType: e.target.value }))}
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-foreground mb-1">
                      Bahan Kain
                    </label>
                    <Input
                      value={repeatFormData.material || ''}
                      onChange={e => setRepeatFormData(prev => ({ ...prev, material: e.target.value }))}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-foreground mb-1">
                      Warna Kain
                    </label>
                    <Input
                      value={repeatFormData.color || ''}
                      onChange={e => setRepeatFormData(prev => ({ ...prev, color: e.target.value }))}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-foreground mb-1">
                      Sablon / Bordir
                    </label>
                    <Input
                      value={repeatFormData.sablonBordir || repeatFormData.accessories || ''}
                      onChange={e => setRepeatFormData(prev => ({
                        ...prev,
                        sablonBordir: e.target.value,
                        accessories: e.target.value
                      }))}
                    />
                  </div>
                </div>

                {repeatFormData.designUrl && (
                  <div className="mt-2 flex items-center gap-3 p-2.5 rounded-xl border border-border bg-muted/20">
                    <img
                      src={repeatFormData.designUrl}
                      alt="Mockup Acuan"
                      className="size-12 rounded-lg border border-border bg-white object-contain p-0.5"
                    />
                    <div className="min-w-0 text-xs">
                      <p className="font-semibold text-foreground">Acuan Desain Mockup Tersimpan</p>
                      <p className="text-muted-foreground text-[11px] truncate">{repeatFormData.designName || repeatFormData.productType}</p>
                    </div>
                  </div>
                )}
              </FormSection>

                <div className="mt-3">
                  <label className="block text-xs font-semibold text-foreground mb-1">
                    Rincian Ukuran (Size Breakdown)
                  </label>
                  <div className="overflow-hidden rounded-xl border border-border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/60 text-xs font-semibold text-muted-foreground">
                        <tr>
                          <th scope="col" className="px-3 py-2 text-left">Ukuran</th>
                          <th scope="col" className="px-3 py-2 text-right">Jumlah (Pcs)</th>
                          <th scope="col" className="w-12 px-3 py-2 text-right">
                            <span className="sr-only">Hapus</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {repeatSizeRows.length === 0 ? (
                          <tr>
                            <td colSpan={3} className="px-3 py-4 text-center text-xs text-muted-foreground">
                              Belum ada rincian ukuran. Tanpa rincian, kuantitas diisi manual di bawah.
                            </td>
                          </tr>
                        ) : (
                          repeatSizeRows.map((row, index) => (
                            <tr key={index}>
                              <td className="px-2 py-1.5">
                                <Input
                                  aria-label={`Nama ukuran baris ${index + 1}`}
                                  value={row.size}
                                  onChange={e =>
                                    recalcRepeat({}, repeatSizeRows.map((r, i) =>
                                      i === index ? { ...r, size: e.target.value } : r
                                    ))
                                  }
                                  placeholder="S / M / L / XL"
                                  className="h-9"
                                />
                              </td>
                              <td className="px-2 py-1.5">
                                <Input
                                  type="number"
                                  min={0}
                                  aria-label={`Jumlah ukuran ${row.size || index + 1}`}
                                  value={row.qty || ''}
                                  onChange={e =>
                                    recalcRepeat({}, repeatSizeRows.map((r, i) =>
                                      i === index ? { ...r, qty: Number(e.target.value) || 0 } : r
                                    ))
                                  }
                                  className="h-9 text-right"
                                />
                              </td>
                              <td className="px-2 py-1.5 text-right">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`Hapus ukuran ${row.size || index + 1}`}
                                  onClick={() => recalcRepeat({}, repeatSizeRows.filter((_, i) => i !== index))}
                                  className="size-8 text-rose-600 hover:bg-rose-50"
                                >
                                  <Trash2 size={14} aria-hidden="true" />
                                </Button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                      {repeatSizeRows.length > 0 && (
                        <tfoot className="border-t border-border bg-muted/40 text-sm font-semibold">
                          <tr>
                            <td className="px-3 py-2">Total</td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {sizeRowsTotal(repeatSizeRows)} Pcs
                            </td>
                            <td />
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => recalcRepeat({}, [...repeatSizeRows, { size: '', qty: 0 }])}
                    >
                      <Plus size={14} aria-hidden="true" /> Tambah Ukuran
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      Kuantitas pesanan mengikuti total tabel ini.
                    </span>
                  </div>
                </div>


              <FormSection
                title={editingOrderId ? '2. Kuantitas, Harga & Jadwal Kirim' : '3. Kuantitas Baru, Harga & Jadwal Kirim'}
              >
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-foreground mb-1">
                      Kuantitas (Pcs) <span className="text-rose-500">*</span>
                    </label>
                    <Input
                      type="number"
                      min={1}
                      value={repeatFormData.quantity || ''}
                      readOnly={repeatSizeRows.some(row => row.size.trim())}
                      onChange={e => recalcRepeat({ quantity: Number(e.target.value) })}
                      required
                    />
                    <span className="mt-1 block text-[11px] text-muted-foreground">
                      {repeatSizeRows.some(row => row.size.trim())
                        ? 'Dihitung dari rincian ukuran di atas.'
                        : 'Bisa berbeda dari pesanan sebelumnya.'}
                    </span>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-foreground mb-1">
                      MOQ (Pcs) <span className="text-rose-500">*</span>
                    </label>
                    <Input
                      type="number"
                      min={1}
                      value={repeatFormData.moq || ''}
                      onChange={e => recalcRepeat({ moq: Number(e.target.value) || 0 })}
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-foreground mb-1">
                      Harga Sesuai MOQ (Rp) <span className="text-rose-500">*</span>
                    </label>
                    <Input
                      type="number"
                      min={0}
                      value={repeatFormData.price || ''}
                      onChange={e => recalcRepeat({ price: Number(e.target.value) || 0 })}
                      required
                    />
                    <span className="mt-1 block text-[11px] text-muted-foreground">Dipakai bila jumlah &ge; MOQ.</span>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-foreground mb-1">
                      Harga Di Bawah MOQ (Rp) <span className="text-rose-500">*</span>
                    </label>
                    <Input
                      type="number"
                      min={0}
                      value={repeatFormData.priceBelowMoq || ''}
                      onChange={e => recalcRepeat({ priceBelowMoq: Number(e.target.value) || 0 })}
                      required
                    />
                    <span className="mt-1 block text-[11px] text-muted-foreground">Dipakai bila jumlah &lt; MOQ.</span>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-foreground mb-1">
                      {editingOrderId ? 'Deadline Kirim' : 'Deadline Kirim Baru'} <span className="text-rose-500">*</span>
                    </label>
                    <Input
                      type="date"
                      value={repeatFormData.deadline || ''}
                      onChange={e => recalcRepeat({ deadline: e.target.value })}
                      required
                    />
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-muted/40 p-3">
                  <div>
                    <span className="block text-xs font-semibold text-muted-foreground">Total Nilai Pesanan</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {Number(repeatFormData.quantity) || 0} Pcs &times; {formatCurrency(effectiveUnitPrice(repeatFormData))}
                      {' \u2014 '}
                      {isBelowMoq(repeatFormData) ? 'memakai harga di bawah MOQ' : 'memakai harga sesuai MOQ'}
                    </span>
                  </div>
                  <span className="text-lg font-bold text-foreground">
                    {formatCurrency((Number(repeatFormData.quantity) || 0) * effectiveUnitPrice(repeatFormData))}
                  </span>
                </div>

                <div className="mt-4">
                  <label className="mb-1.5 block text-xs font-semibold text-foreground">
                    Termin Pembayaran
                  </label>
                  <PaymentTermsEditor
                    idPrefix="repeat-term"
                    terms={
                      repeatFormData.paymentSchedule ||
                      createDefaultSchedule(
                        (Number(repeatFormData.quantity) || 0) * effectiveUnitPrice(repeatFormData)
                      )
                    }
                    total={(Number(repeatFormData.quantity) || 0) * effectiveUnitPrice(repeatFormData)}
                    onChange={terms => setRepeatFormData(prev => ({ ...prev, paymentSchedule: terms }))}
                    error={repeatOrderError && repeatOrderError.includes('termin') ? repeatOrderError : undefined}
                  />
                </div>

                <div className="mt-3">
                  <label className="block text-xs font-semibold text-foreground mb-1">
                    Catatan Khusus Repeat Order
                  </label>
                  <Textarea
                    rows={2}
                    value={repeatFormData.notes || ''}
                    onChange={e => setRepeatFormData(prev => ({ ...prev, notes: e.target.value }))}
                    placeholder="Contoh: Warna kain sama persis lot sebelumnya, packing polybag satuan."
                  />
                </div>
              </FormSection>
            </>
          )}
        </form>
      </Modal>

      {/* MODAL: CETAK INVOICE PESANAN */}
      <Modal
        isOpen={!!printInvoice}
        onClose={() => setPrintInvoice(null)}
        title={`Invoice ${printInvoice?.id ?? ''}`}
        subtitle="Dokumen A4 resmi di atas kop surat HIJ."
        maxWidth="4xl"
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setPrintInvoice(null)}>
              Tutup
            </Button>
            <Button onClick={handleDownloadInvoicePdf} disabled={isDownloadingInvoice}>
              <Download size={16} aria-hidden="true" />
              {isDownloadingInvoice ? 'Membuat PDF…' : 'Unduh PDF Invoice'}
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
                  id="order-invoice-doc"
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
