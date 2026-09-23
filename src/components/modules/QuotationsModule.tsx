import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus,
  FileText,
  Search,
  Download,
  Trash2,
  CheckCircle2,
  Printer,
  Clock,
  XCircle,
  Palette,
  Pencil,
  Info
} from 'lucide-react';
import { Quotation, Customer, Design, Order, Invoice, PaymentTerm, SizeChart } from '../../types';
import { fetchResource, createResource, updateResource, deleteResource, authFetch, fetchStaffDirectory, StaffDirectoryEntry } from '../../services/api';
import { getCurrentUser } from '../../lib/session';
import { cn, formatCurrency, formatDate, formatDateTime, generateId } from '../../lib/utils';
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
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableRowActions,
  TableEmptyRow,
  TableSkeletonRows,
  TableSortHead,
  RowActionButton,
  sortRows,
  useTablePage,
  TablePagination,
  type SortState
} from '../ui/Table';
import { PageHeader } from '../ui/PageHeader';
import { SizeRowsEditor } from '../ui/SizeRowsEditor';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge, StatusBadge } from '../ui/Badge';
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
import { Toast, useToast } from '../ui/Toast';
import { useConfirm } from '../ui/ConfirmDialog';
import { QuotationDocument } from '../documents/QuotationDocument';
import {
  PaymentTermsEditor,
  createDefaultSchedule,
  withAmounts,
  totalPercentage
} from '../ui/PaymentTermsEditor';
import {
  parseSizeRows,
  serializeSizeRows,
  sizeRowsTotal,
  effectiveUnitPrice,
  isBelowMoq,
  type SizeRow
} from '../../lib/pricing';

/*
 * Validation focuses the first broken field, so the form order and the id map
 * live together: change the markup, change these.
 */
const QUO_STAGE_FILTERS = [
  { key: 'ALL', label: 'Semua', count: 'all' },
  { key: 'PENDING', label: 'Menunggu', count: 'pending' },
  { key: 'APPROVED', label: 'Deal', count: 'approved' },
  { key: 'REJECTED', label: 'Ditolak', count: 'rejected' }
] as const;

const QUO_FIELD_ORDER = [
  'customerId',
  'productType',
  'picUserId',
  'sizeChartId',
  'quantity',
  'moq',
  'price',
  'priceBelowMoq',
  'deadline',
  'paymentSchedule'
] as const;

const QUO_FIELD_IDS: Record<string, string> = {
  customerId: 'quo-customer',
  productType: 'quo-product',
  picUserId: 'quo-pic',
  sizeChartId: 'quo-size-chart',
  quantity: 'quo-quantity',
  moq: 'quo-moq',
  price: 'quo-price',
  priceBelowMoq: 'quo-price-below',
  deadline: 'quo-deadline',
  paymentSchedule: 'quo-term-percent-0'
};

const QuotationStatusTag: React.FC<{ quotation: Quotation; solid?: boolean }> = ({ quotation, solid }) => {
  if (quotation.status === 'Approved') {
    return (
      <Badge variant="done" size="sm" solid={solid}>
        <CheckCircle2 size={12} className="shrink-0" aria-hidden="true" />
        <span>Deal</span>
      </Badge>
    );
  }
  if (quotation.status === 'Rejected') {
    return (
      <Badge variant="critical" size="sm" solid={solid}>
        <XCircle size={12} className="shrink-0" aria-hidden="true" />
        <span>Ditolak</span>
      </Badge>
    );
  }
  if (quotation.status === 'Draft') {
    return (
      <Badge variant="idle" size="sm" solid={solid}>
        <span>Draft</span>
      </Badge>
    );
  }
  return (
    <Badge variant="warning" size="sm" solid={solid}>
      <Clock size={12} className="shrink-0" aria-hidden="true" />
      <span>Menunggu Deal</span>
    </Badge>
  );
};

export const QuotationsModule: React.FC = () => {
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [designs, setDesigns] = useState<Design[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters & Sorting
  const [searchQuery, setSearchQuery] = useState('');
  const [quoStageFilter, setQuoStageFilter] = useState<'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED'>('ALL');
  const [quotationSort, setQuotationSort] = useState<SortState>({ key: 'newest', direction: 'desc' });
  const { toast, showToast } = useToast();
  const { confirm, confirmDialog } = useConfirm();

  // Selected design for auto-fill
  const [selectedDesignId, setSelectedDesignId] = useState<string>('');

  // Detail Drawer
  const [detailQuotation, setDetailQuotation] = useState<Quotation | null>(null);

  // Modal: Deal Approval
  const [dealQuotation, setDealQuotation] = useState<Quotation | null>(null);
  const [dealPo, setDealPo] = useState('');
  const [dealDp, setDealDp] = useState<number>(0);
  const [dealDeadline, setDealDeadline] = useState('');
  const [submittingDeal, setSubmittingDeal] = useState(false);
  const [dealError, setDealError] = useState<string | null>(null);

  // Modal: Tolak penawaran. The reason is a form field, not a browser prompt.
  const [rejectTarget, setRejectTarget] = useState<Quotation | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState<string | null>(null);
  const [submittingReject, setSubmittingReject] = useState(false);

  // Modal: Revisi Penawaran yang sudah Deal
  const [reviseQuotation, setReviseQuotation] = useState<Quotation | null>(null);
  const [reviseQty, setReviseQty] = useState<number>(100);
  const [reviseSizeRows, setReviseSizeRows] = useState<SizeRow[]>([]);
  const [revisePrice, setRevisePrice] = useState<number>(0);
  const [reviseDeadline, setReviseDeadline] = useState<string>('');
  const [reviseNotes, setReviseNotes] = useState<string>('');
  const [submittingRevise, setSubmittingRevise] = useState(false);
  const [reviseError, setReviseError] = useState<string | null>(null);

  // Modal: Print Official Quotation PDF
  const [printQuotation, setPrintQuotation] = useState<Quotation | null>(null);
  const [isPrintQuoOpen, setIsPrintQuoOpen] = useState(false);
  const [isDownloadingQuo, setIsDownloadingQuo] = useState(false);
  const [quoPdfError, setQuoPdfError] = useState<string | null>(null);

  // Modal: Create / Edit Quotation
  const [isQuoModalOpen, setIsQuoModalOpen] = useState(false);
  const [editingQuotationId, setEditingQuotationId] = useState<string | null>(null);
  const [sizeRows, setSizeRows] = useState<SizeRow[]>([]);
  const [sizeCharts, setSizeCharts] = useState<SizeChart[]>([]);
  const [chartScope, setChartScope] = useState<'all' | 'standard' | 'customer'>('all');
  /** Staff who can be named PIC; the signed-in user is the default. */
  const [staff, setStaff] = useState<StaffDirectoryEntry[]>([]);
  const [pickedChartId, setPickedChartId] = useState('');
  const [savingQuo, setSavingQuo] = useState(false);
  const [quoError, setQuoError] = useState<string | null>(null);
  const [quoFieldErrors, setQuoFieldErrors] = useState<Record<string, string>>({});
  const [quoFormData, setQuoFormData] = useState<Partial<Quotation>>({
    id: '',
    customerId: '',
    customerName: '',
    productType: '',
    designId: '',
    designName: '',
    designUrl: '/templates/Halaman1.png',
    quantity: 100,
    moq: 100,
    price: 0,
    priceBelowMoq: 0,
    totalPrice: 0,
    deadline: '',
    material: '',
    color: '',
    size: '',
    accessories: '',
    sablonBordir: '',
    needsSample: false,
    needsProcurement: 'Perlu Pengadaan',
    notes: '',
    status: 'Sent'
  });

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [quoRes, customerRes, designRes, orderRes, invoiceRes, chartRes, staffRes] = await Promise.all([
        fetchResource<Quotation>('quotations'),
        fetchResource<Customer>('customers'),
        fetchResource<Design>('designs'),
        fetchResource<Order>('orders'),
        fetchResource<Invoice>('invoices'),
        fetchResource<SizeChart>('size-charts'),
        fetchStaffDirectory().catch(() => [] as StaffDirectoryEntry[])
      ]);
      setStaff(staffRes || []);
      setQuotations(quoRes || []);
      setCustomers(customerRes || []);
      setDesigns(designRes || []);
      setOrders(orderRes || []);
      setInvoices(invoiceRes || []);
      setSizeCharts(chartRes || []);
    } catch (err) {
      console.error('Failed to load quotations:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const approvedDesigns = useMemo(() => designs.filter(d => d.status === 'Approved'), [designs]);

  // Handler auto-fill dari Desain Mockup ke form Penawaran
  const handleSelectDesign = (designId: string) => {
    setSelectedDesignId(designId);
    if (!designId) {
      setQuoFormData(prev => ({
        ...prev,
        designId: '',
        designUrl: prev.designUrl || '/templates/Halaman1.png'
      }));
      return;
    }

    const design = designs.find(d => d.id === designId);
    if (design) {
      const matchingCust = customers.find(c => c.id === design.customerId);
      const mockupUrl = design.mockupFront || design.mockupBack || '/templates/Halaman1.png';
      setQuoFormData(prev => ({
        ...prev,
        designId: design.id,
        designName: design.name || prev.designName,
        designUrl: mockupUrl,
        customerId: design.customerId || matchingCust?.id || prev.customerId,
        customerName: matchingCust?.name || prev.customerName,
        productType: design.name || prev.productType,
        notes: design.description ? `[Acuan Desain ${design.id}]: ${design.description}` : prev.notes
        // Whether a physical sample is needed is the customer's call, not the design's status.
      }));
    }
  };

  // Open deal approval modal
  const handleOpenDealModal = (q: Quotation) => {
    setDealQuotation(q);
    setDealError(null);
    const clientCode = (q.customerName || 'HIJ').replace(/[^a-zA-Z0-9]/g, '').slice(0, 3).toUpperCase();
    setDealPo(`PO-${clientCode}-${new Date().getFullYear()}-${Date.now().toString().slice(-3)}`);
    const total = Number(q.totalPrice) || (Number(q.quantity) * Number(q.price));
    // The first instalment agreed on the quotation is the DP; 50% only when none was set.
    const agreedDp = q.paymentSchedule?.length ? Number(withAmounts(q.paymentSchedule, total)[0]?.amount) : 0;
    setDealDp(agreedDp || Math.round(total * 0.5));
    setDealDeadline(q.deadline || new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0]);
  };

  // Submit quotation deal -> creates the Order
  const handleConfirmDeal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dealQuotation) return;

    const orderValue = Number(dealQuotation.totalPrice) || 0;
    if (!dealPo.trim()) {
      setDealError('Nomor PO wajib diisi agar pesanan bisa dilacak.');
      document.getElementById('deal-po')?.focus();
      return;
    }
    if (dealDp < 0 || (orderValue > 0 && dealDp > orderValue)) {
      setDealError(`Uang muka harus antara Rp 0 dan ${formatCurrency(orderValue)}.`);
      document.getElementById('deal-dp')?.focus();
      return;
    }
    if (!dealDeadline) {
      setDealError('Target selesai wajib diisi.');
      document.getElementById('deal-deadline')?.focus();
      return;
    }

    try {
      setSubmittingDeal(true);
      setDealError(null);
      const res = await authFetch(`/api/quotations/${dealQuotation.id}/approve-to-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          po: dealPo,
          downPayment: dealDp,
          deadline: dealDeadline
        })
      });

      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.error || 'Gagal menyetujui penawaran. Coba lagi.');

      setDealQuotation(null);
      await loadData();
      showToast(result.message || 'Penawaran disetujui! Pesanan resmi telah dibuat dan masuk ke halaman Pesanan.');
    } catch (err: any) {
      setDealError(err?.message || 'Gagal menyetujui penawaran. Coba lagi.');
    } finally {
      setSubmittingDeal(false);
    }
  };

  // Reject quotation: open the reason form
  const handleOpenReject = (q: Quotation) => {
    setRejectTarget(q);
    setRejectReason('');
    setRejectError(null);
  };

  const handleConfirmReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectTarget) return;
    const reason = rejectReason.trim();
    if (!reason) {
      setRejectError('Tulis alasan penolakan supaya riwayat negosiasi terbaca nanti.');
      document.getElementById('reject-reason')?.focus();
      return;
    }
    try {
      setSubmittingReject(true);
      setRejectError(null);
      await updateResource('quotations', rejectTarget.id, {
        status: 'Rejected',
        notes: `${rejectTarget.notes ? rejectTarget.notes + ' | ' : ''}Alasan ditolak: ${reason}`
      });
      const rejectedId = rejectTarget.id;
      setRejectTarget(null);
      if (detailQuotation?.id === rejectedId) setDetailQuotation(null);
      await loadData();
      showToast(`Penawaran ${rejectedId} ditandai ditolak.`);
    } catch (err) {
      setRejectError('Gagal menandai penawaran ditolak. Periksa koneksi ke server, lalu coba lagi.');
    } finally {
      setSubmittingReject(false);
    }
  };

  // Open modal revisi penawaran yang sudah Deal
  const handleOpenReviseDealModal = (q: Quotation) => {
    setReviseQuotation(q);
    setReviseQty(Number(q.quantity) || 100);
    setReviseSizeRows(parseSizeRows(q.size));
    setRevisePrice(Number(q.price) || 0);
    setReviseDeadline(q.deadline || '');
    setReviseNotes('');
    setReviseError(null);
  };

  /*
   * A revision may push the quantity under MOQ, and then the agreed rate is the
   * below-MOQ one. The revised total has to follow the same rule the create form
   * uses, otherwise the reissued invoice bills the wrong amount.
   */
  const reviseUnitPrice = effectiveUnitPrice({
    quantity: reviseQty,
    price: revisePrice,
    moq: Number(reviseQuotation?.moq) || 0,
    priceBelowMoq: Number(reviseQuotation?.priceBelowMoq) || 0
  });
  const reviseTotal = reviseQty * reviseUnitPrice;
  const reviseUsesBelowMoq = reviseUnitPrice !== revisePrice;

  // Submit revisi penawaran deal dengan sinkronisasi ke Order dan Invoice
  const handleSubmitReviseDeal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviseQuotation) return;

    if (!reviseQty || reviseQty <= 0) {
      setReviseError('Kuantitas harus lebih besar dari 0.');
      return;
    }
    if (!revisePrice || revisePrice <= 0) {
      setReviseError('Harga satuan harus lebih besar dari Rp 0.');
      return;
    }

    try {
      setSubmittingRevise(true);
      setReviseError(null);
      const newTotal = reviseTotal;

      // 1. Panggil endpoint revisi deal ke backend
      const res = await authFetch(`/api/quotations/${reviseQuotation.id}/revise-deal`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quantity: reviseQty,
          price: revisePrice,
          totalPrice: newTotal,
          // The breakdown travels with the quantity so the SPK cuts the new sizes.
          size: reviseSizeRows.some(r => r.size.trim()) ? serializeSizeRows(reviseSizeRows) : undefined,
          deadline: reviseDeadline || reviseQuotation.deadline,
          notes: reviseNotes ? `[Revisi Qty: ${reviseQty} pcs] ${reviseNotes}` : reviseQuotation.notes
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Gagal merevisi penawaran di server.');
      }

      const result = await res.json().catch(() => ({}));
      setReviseQuotation(null);
      await loadData();
      showToast(result.message || `Revisi penawaran ${reviseQuotation.id} berhasil diterbitkan.`);
    } catch (err: any) {
      setReviseError(err?.message || 'Gagal merevisi penawaran deal. Silakan coba lagi.');
    } finally {
      setSubmittingRevise(false);
    }
  };

  // Open modal create new quotation
  const handleOpenNewQuoModal = () => {
    setEditingQuotationId(null);
    // Free-text fields start empty: staff describe the product themselves.
    setSizeRows([]);
    setSelectedDesignId('');
    setQuoError(null);
    setQuoFieldErrors({});
    const initialPrice = 0;
    const initialQty = 100;
    const initialTotal = initialPrice * initialQty;
    setQuoFormData({
      id: generateId('QUO'),
      // Nobody is preselected: a quotation silently issued to the first customer is worse than a required field.
      customerId: '',
      customerName: '',
      productType: '',
      designId: '',
      designName: '',
      designUrl: '/templates/Halaman1.png',
      quantity: initialQty,
      moq: 100,
      price: initialPrice,
      priceBelowMoq: 0,
      totalPrice: initialTotal,
      deadline: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
      material: '',
      color: '',
      size: '',
      accessories: '',
      sablonBordir: '',
      needsSample: false,
      needsProcurement: 'Perlu Pengadaan',
      notes: '',
      status: 'Sent',
      paymentSchedule: createDefaultSchedule(initialTotal),
      ...defaultPic()
    });
    setPickedChartId('');
    setChartScope('all');
    setIsQuoModalOpen(true);
  };

  // Open modal edit quotation (draft/sent)
  /*
   * One writer for the size table: it rewrites the stored "S: 20, M: 50"
   * string and, whenever a breakdown exists, makes the total the quantity so
   * the two can never disagree.
   */
  const applySizeRows = (rows: SizeRow[]) => {
    setSizeRows(rows);
    const filled = rows.filter(row => row.size.trim());
    const totalQty = filled.reduce((sum, row) => sum + (Number(row.qty) || 0), 0);
    setQuoFormData(prev => {
      const quantity = filled.length > 0 ? totalQty : prev.quantity;
      const total = (Number(quantity) || 0) * effectiveUnitPrice({ ...prev, quantity });
      return {
        ...prev,
        size: serializeSizeRows(rows),
        quantity,
        totalPrice: total,
        paymentSchedule: prev.paymentSchedule ? withAmounts(prev.paymentSchedule, total) : undefined
      };
    });
  };

  /*
   * A size chart says which sizes a garment comes in, not how many of each —
   * so picking one lays out the rows and leaves the quantities to be filled.
   * Sizes already carrying a quantity are kept, so switching charts mid-entry
   * does not wipe what has been typed.
   */
  const handlePickSizeChart = (chartId: string) => {
    setPickedChartId(chartId);
    setQuoFieldErrors(prev => ({ ...prev, sizeChartId: '' }));
    const chart = sizeCharts.find(c => c.id === chartId);
    if (!chart) {
      setQuoFormData(prev => ({ ...prev, sizeChartId: '', sizeChartName: '' }));
      return;
    }
    // The template follows the deal into the order, and from there onto the SPK sheet.
    setQuoFormData(prev => ({ ...prev, sizeChartId: chart.id, sizeChartName: chart.name }));

    const existing = new Map(sizeRows.filter(r => r.qty > 0).map(r => [r.size.trim().toUpperCase(), r.qty]));
    applySizeRows(chart.rows.map(r => ({ size: r.size, qty: existing.get(r.size.trim().toUpperCase()) || 0 })));
  };

  /** Standards plus the chosen customer's own charts, narrowed by the scope toggle — as on the order form. */
  const availableCharts = sizeCharts.filter(c => {
    const scope = c.scope || 'standard';
    if (scope === 'customer' && c.customerId !== quoFormData.customerId) return false;
    return chartScope === 'all' || scope === chartScope;
  });
  const pickedChart = sizeCharts.find(c => c.id === pickedChartId);

  /*
   * PIC is a named account with its role, so a deal can be traced to a person.
   * The signed-in user is the default; the list comes from the server so it
   * matches Akun & Hak Akses, with the current user added if it is missing.
   */
  const me = getCurrentUser();
  const picChoices: StaffDirectoryEntry[] =
    me && !staff.some(s => s.id === me.id) ? [{ id: me.id, name: me.name, role: String(me.role || '') }, ...staff] : staff;
  function defaultPic() {
    return me ? { picUserId: me.id, picName: me.name, picRole: String(me.role || '') } : {};
  }
  const handlePickPic = (userId: string) => {
    const person = picChoices.find(s => s.id === userId);
    setQuoFieldErrors(prev => ({ ...prev, picUserId: '' }));
    setQuoFormData(prev => ({
      ...prev,
      picUserId: person?.id || '',
      picName: person?.name || '',
      picRole: person?.role || ''
    }));
  };

  const handleOpenEditQuoModal = (q: Quotation) => {
    setEditingQuotationId(q.id);
    setSizeRows(parseSizeRows(q.size));
    setPickedChartId(q.sizeChartId || '');
    setSelectedDesignId(q.designId || '');
    setQuoError(null);
    setQuoFieldErrors({});
    const total = Number(q.totalPrice) || (Number(q.quantity) * Number(q.price));
    setQuoFormData({
      ...q,
      paymentSchedule: Array.isArray(q.paymentSchedule) && q.paymentSchedule.length > 0
        ? q.paymentSchedule
        : createDefaultSchedule(total),
      // Quotations from before PICs were named default to whoever edits them.
      ...(q.picUserId ? {} : defaultPic())
    });
    setChartScope('all');
    setIsQuoModalOpen(true);
  };

  // Save new / edit quotation
  const handleSaveQuotation = async (e: React.FormEvent) => {
    e.preventDefault();
    setQuoError(null);
    const errors: Record<string, string> = {};

    if (!quoFormData.customerId) errors.customerId = 'Pelanggan wajib dipilih.';
    if (!quoFormData.productType?.trim()) errors.productType = 'Jenis produk wajib diisi.';
    if (!quoFormData.quantity || Number(quoFormData.quantity) <= 0) errors.quantity = 'Jumlah harus lebih besar dari 0.';
    if (!quoFormData.price || Number(quoFormData.price) <= 0) errors.price = 'Harga di atas MOQ harus lebih besar dari 0.';
    if (!quoFormData.priceBelowMoq || Number(quoFormData.priceBelowMoq) <= 0) {
      errors.priceBelowMoq = 'Harga di bawah MOQ harus lebih besar dari 0.';
    }
    if (!quoFormData.moq || Number(quoFormData.moq) <= 0) errors.moq = 'MOQ harus lebih besar dari 0.';
    // Small runs cost more per piece: the below-MOQ rate can never undercut the MOQ rate.
    if (
      Number(quoFormData.price) > 0 &&
      Number(quoFormData.priceBelowMoq) > 0 &&
      Number(quoFormData.priceBelowMoq) < Number(quoFormData.price)
    ) {
      errors.priceBelowMoq = 'Harga di bawah MOQ harus lebih tinggi (atau sama) dari harga di atas MOQ — pesanan kecil lebih mahal per pcs.';
    }
    if (!quoFormData.deadline) errors.deadline = 'Target tanggal selesai wajib diisi.';
    if (!quoFormData.picUserId) errors.picUserId = 'Pilih PIC (penanggung jawab) penawaran ini.';
    if (!quoFormData.sizeChartId) {
      errors.sizeChartId = 'Pilih template size chart (standar HIJ atau khusus pelanggan) — detail ukurannya dicetak di SPK.';
    }

    const total = (Number(quoFormData.quantity) || 0) * effectiveUnitPrice(quoFormData);
    const schedule = quoFormData.paymentSchedule;
    if (schedule && schedule.length > 0) {
      const pct = totalPercentage(schedule);
      if (pct !== 100) {
        errors.paymentSchedule = `Total persentase termin harus 100% (saat ini ${pct}%).`;
      }
    }

    if (Object.keys(errors).length > 0) {
      setQuoFieldErrors(errors);
      setQuoError('Lengkapi isian yang ditandai merah, lalu simpan lagi.');
      // The modal is long, so move the cursor to the first thing that needs fixing.
      const firstBroken = QUO_FIELD_ORDER.find(field => errors[field]);
      if (firstBroken) document.getElementById(QUO_FIELD_IDS[firstBroken])?.focus();
      return;
    }

    setSavingQuo(true);
    try {
      const selectedCust = customers.find(c => c.id === quoFormData.customerId);
      const scheduleWithAmounts = schedule && schedule.length > 0
        ? withAmounts(schedule, total)
        : createDefaultSchedule(total);

      const payload: Quotation = {
        id: editingQuotationId || quoFormData.id || generateId('QUO'),
        customerId: quoFormData.customerId!,
        customerName: selectedCust?.name || quoFormData.customerName || 'Pelanggan',
        productType: quoFormData.productType!.trim(),
        quantity: Number(quoFormData.quantity),
        price: Number(quoFormData.price),
        totalPrice: total,
        deadline: quoFormData.deadline!,
        status: quoFormData.status as any || 'Sent',
        material: quoFormData.material || '-',
        color: quoFormData.color || 'Custom',
        size: quoFormData.size || 'All Size',
        sizeChartId: quoFormData.sizeChartId || '',
        sizeChartName: quoFormData.sizeChartName || '',
        picUserId: quoFormData.picUserId || '',
        picName: quoFormData.picName || '',
        picRole: quoFormData.picRole || '',
        user: quoFormData.picName || quoFormData.user || me?.name || 'Staf Penjualan',
        accessories: quoFormData.accessories || '-',
        needsProcurement: quoFormData.needsProcurement || 'Perlu Pengadaan',
        notes: quoFormData.notes || '',
        designId: quoFormData.designId || '',
        designName: quoFormData.designName || quoFormData.productType || '',
        designUrl: quoFormData.designUrl || '/templates/Halaman1.png',
        moq: Number(quoFormData.moq) || 100,
        priceBelowMoq: Number(quoFormData.priceBelowMoq) || Number(quoFormData.price),
        needsSample: Boolean(quoFormData.needsSample),
        sampleStatus: quoFormData.needsSample ? 'Pending' : 'Tanpa Sampel',
        paymentSchedule: scheduleWithAmounts,
        timestamp: quoFormData.timestamp || new Date().toISOString()
      };

      if (editingQuotationId) {
        await updateResource('quotations', editingQuotationId, payload);
        showToast(`Penawaran ${payload.id} berhasil diperbarui.`);
      } else {
        await createResource('quotations', payload);
        showToast(`Surat penawaran harga ${payload.id} berhasil dibuat.`);
      }

      setIsQuoModalOpen(false);
      await loadData();
    } catch (err: any) {
      setQuoError(err?.message || 'Gagal menyimpan surat penawaran. Coba lagi.');
    } finally {
      setSavingQuo(false);
    }
  };

  // Delete quotation
  /*
   * A deal already became an order, and a superseded revision is the paper
   * trail of one; deleting either left the order or the next revision pointing
   * at nothing. The server refuses both, so the button isn't offered.
   */
  const canDeleteQuotation = (q: Quotation) =>
    !q.supersededBy && !(q.status === 'Approved' && !!q.orderId);

  const handleDeleteQuotation = async (id: string) => {
    const approved = await confirm({
      title: `Hapus surat penawaran ${id}?`,
      message: 'Surat penawaran beserta rincian harganya hilang permanen dan tidak dapat dikembalikan. Klien yang sudah menerima salinannya perlu dikabari ulang.',
      confirmLabel: 'Hapus Penawaran',
      tone: 'danger'
    });
    if (!approved) return;
    try {
      await deleteResource('quotations', id);
      showToast(`Surat penawaran ${id} telah dihapus.`);
      await loadData();
      if (detailQuotation?.id === id) setDetailQuotation(null);
    } catch (err: any) {
      showToast(err?.message || 'Gagal menghapus penawaran. Periksa koneksi ke server, lalu coba lagi.', 'error');
    }
  };

  // Print PDF handler
  const handleOpenPrintQuo = (q: Quotation) => {
    setPrintQuotation(q);
    setQuoPdfError(null);
    setIsPrintQuoOpen(true);
  };

  const handleDownloadQuotationPdf = async () => {
    if (!printQuotation) return;
    try {
      setIsDownloadingQuo(true);
      setQuoPdfError(null);
      await exportElementToPdf('quotation-doc', `Surat_Penawaran_${printQuotation.id}.pdf`);
      showToast(`PDF Penawaran ${printQuotation.id} berhasil diunduh.`);
    } catch (err: any) {
      setQuoPdfError(err?.message || 'Gagal membuat file PDF. Coba gunakan fitur cetak peramban.');
    } finally {
      setIsDownloadingQuo(false);
    }
  };

  // Filtered & Sorted Quotations
  const filteredQuotations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const rows = quotations.filter(item => {
      const matchSearch =
        !q ||
        item.id.toLowerCase().includes(q) ||
        (item.customerName || '').toLowerCase().includes(q) ||
        (item.productType || '').toLowerCase().includes(q) ||
        (item.designName || '').toLowerCase().includes(q) ||
        (item.material || '').toLowerCase().includes(q) ||
        (item.picName || '').toLowerCase().includes(q);

      const matchStage =
        quoStageFilter === 'ALL' ? true :
        quoStageFilter === 'PENDING' ? (item.status === 'Sent' || item.status === 'Draft') :
        quoStageFilter === 'APPROVED' ? item.status === 'Approved' :
        quoStageFilter === 'REJECTED' ? item.status === 'Rejected' : true;

      return matchSearch && matchStage;
    });

    return sortRows(rows, quotationSort, (item, key) => {
      // Default view: the penawaran made most recently leads the list.
      if (key === 'newest') return new Date(item.timestamp || item.deadline || 0).getTime();
      if (key === 'id') return item.id;
      if (key === 'customerName') return item.customerName;
      if (key === 'productType') return item.productType;
      if (key === 'quantity') return item.quantity;
      if (key === 'totalPrice') return item.totalPrice;
      if (key === 'deadline') return item.deadline;
      if (key === 'status') return item.status;
      return (item as any)[key];
    });
  }, [quotations, searchQuery, quoStageFilter, quotationSort]);

  const { pageRows: pagedQuotations, pagination } = useTablePage(filteredQuotations);

  /*
   * One number for the whole form. The summary card, the instalment editor, and
   * the saved payload all read this, so they cannot disagree about what the
   * quotation is worth when the quantity falls below MOQ.
   */
  const quoTotal = (Number(quoFormData.quantity) || 0) * effectiveUnitPrice(quoFormData);

  // Finance thinks in percentages, so the DP field says what fraction it is.
  const dealOrderValue = Number(dealQuotation?.totalPrice) || 0;
  const dealPercent = dealOrderValue > 0 ? Math.round((dealDp / dealOrderValue) * 100) : null;
  const quantityFromSizeRows = sizeRows.some(row => row.size.trim());

  // Counts for KPI
  const quoCounts = useMemo(() => {
    const pending = quotations.filter(q => q.status === 'Sent' || q.status === 'Draft').length;
    const approved = quotations.filter(q => q.status === 'Approved').length;
    const rejected = quotations.filter(q => q.status === 'Rejected').length;
    return { all: quotations.length, pending, approved, rejected };
  }, [quotations]);

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      <Toast toast={toast} />

      {/* Page Header */}
      <PageHeader
        title="Surat Penawaran Harga"
        description="Penerbitan surat penawaran harga resmi (Quotation), spesifikasi 4 serangkai dari desain/sampel ACC, negosiasi termin pembayaran, persetujuan deal klien, dan revisi kuantitas."
        actions={
          <Button onClick={handleOpenNewQuoModal}>
            <Plus size={16} aria-hidden="true" /> Buat Penawaran Baru
          </Button>
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <Card className="p-4 flex items-center gap-3 bg-linear-to-br from-card to-muted/20 border-border">
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
            <Clock size={20} />
          </div>
          <div>
            <p className="text-xs text-muted-foreground font-medium">Total Penawaran</p>
            <p className="text-2xl font-bold text-foreground">{quoCounts.all}</p>
          </div>
        </Card>

        <Card className="p-4 flex items-center gap-3 bg-linear-to-br from-card to-amber-500/5 border-amber-500/20">
          <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-500">
            <Clock size={20} />
          </div>
          <div>
            <p className="text-xs text-amber-600 font-medium">Menunggu Deal</p>
            <p className="text-2xl font-bold text-foreground">{quoCounts.pending}</p>
          </div>
        </Card>

        <Card className="p-4 flex items-center gap-3 bg-linear-to-br from-card to-emerald-500/5 border-emerald-500/20">
          <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-500">
            <CheckCircle2 size={20} />
          </div>
          <div>
            <p className="text-xs text-emerald-600 font-medium">Sudah Deal</p>
            <p className="text-2xl font-bold text-foreground">{quoCounts.approved}</p>
          </div>
        </Card>

        <Card className="p-4 flex items-center gap-3 bg-linear-to-br from-card to-rose-500/5 border-rose-500/20">
          <div className="p-2.5 rounded-xl bg-rose-500/10 text-rose-500">
            <XCircle size={20} />
          </div>
          <div>
            <p className="text-xs text-rose-600 font-medium">Ditolak</p>
            <p className="text-2xl font-bold text-foreground">{quoCounts.rejected}</p>
          </div>
        </Card>
      </div>

      {/* Control Bar: Filter & Search */}
      <Card className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex-1 sm:max-w-md">
            <FieldLabel htmlFor="quo-search" className="sr-only">
              Cari penawaran
            </FieldLabel>
            <div className="relative">
              <Search
                size={16}
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                id="quo-search"
                type="search"
                value={searchQuery}
                placeholder="Cari no. penawaran, pelanggan, atau produk…"
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          <div role="group" aria-label="Filter tahap penawaran" className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            {QUO_STAGE_FILTERS.map(stage => (
              <ChipButton
                key={stage.key}
                selected={quoStageFilter === stage.key}
                onClick={() => setQuoStageFilter(stage.key)}
                className="whitespace-nowrap"
              >
                {stage.label} ({quoCounts[stage.count]})
              </ChipButton>
            ))}
          </div>
        </div>
      </Card>

      {/* Table of Quotations */}
      {(
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableSortHead
                  sortKey="id"
                  sort={quotationSort}
                  onSortChange={setQuotationSort}
                  className="cell-sticky-start"
                >
                  No. Penawaran
                </TableSortHead>
                <TableHead className="hidden min-[1800px]:table-cell">Pesanan</TableHead>
                <TableSortHead
                  sortKey="customerName"
                  sort={quotationSort}
                  onSortChange={setQuotationSort}
                  className="hidden md:table-cell"
                >
                  Pelanggan
                </TableSortHead>
                <TableHead className="hidden min-[1700px]:table-cell">Produk</TableHead>
                <TableSortHead
                  sortKey="quantity"
                  sort={quotationSort}
                  onSortChange={setQuotationSort}
                  align="right"
                  className="hidden sm:table-cell"
                >
                  Qty
                </TableSortHead>
                <TableHead className="hidden min-[1800px]:table-cell text-right">Harga Satuan</TableHead>
                <TableSortHead
                  sortKey="totalPrice"
                  sort={quotationSort}
                  onSortChange={setQuotationSort}
                  align="right"
                  className="hidden sm:table-cell"
                >
                  Total Harga
                </TableSortHead>
                <TableSortHead
                  sortKey="deadline"
                  sort={quotationSort}
                  onSortChange={setQuotationSort}
                  className="hidden 2xl:table-cell"
                >
                  Target Selesai
                </TableSortHead>
                <TableSortHead
                  sortKey="status"
                  sort={quotationSort}
                  onSortChange={setQuotationSort}
                  align="center"
                >
                  Status
                </TableSortHead>
                <TableHead className="cell-sticky-end text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && quotations.length === 0 ? (
                <TableSkeletonRows columns={10} />
              ) : filteredQuotations.length === 0 ? (
                <TableEmptyRow
                  colSpan={10}
                  icon={<FileText size={20} />}
                  title={
                    searchQuery || quoStageFilter !== 'ALL'
                      ? 'Tidak ada penawaran yang cocok'
                      : 'Belum ada surat penawaran'
                  }
                  description={
                    searchQuery || quoStageFilter !== 'ALL'
                      ? 'Coba ganti kata kunci atau reset filter status.'
                      : 'Buat surat penawaran untuk diajukan ke pelanggan setelah desain dan sampel disetujui.'
                  }
                  action={
                    searchQuery || quoStageFilter !== 'ALL' ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSearchQuery('');
                          setQuoStageFilter('ALL');
                        }}
                      >
                        Reset Filter
                      </Button>
                    ) : (
                      <Button size="sm" onClick={handleOpenNewQuoModal}>
                        <Plus size={16} aria-hidden="true" /> Buat Penawaran Baru
                      </Button>
                    )
                  }
                />
              ) : (
                pagedQuotations.map(quo => {
                const total = Number(quo.totalPrice) || (Number(quo.quantity) * Number(quo.price));
                return (
                  <TableRow key={quo.id}>
                    <TableCell className="cell-sticky-start whitespace-nowrap font-mono font-semibold text-foreground">
                      <span className={quo.supersededBy ? 'text-muted-foreground line-through' : undefined}>
                        {quo.quotationNo || quo.id}
                      </span>
                      {!!quo.revision && (
                        <Badge
                          variant={quo.supersededBy ? 'idle' : 'progress'}
                          size="sm"
                          className="ml-1.5 align-middle"
                        >
                          Rev.{quo.revision}
                        </Badge>
                      )}
                      {quo.supersededBy && (
                        <Badge variant="idle" size="sm" className="ml-1 align-middle">Diganti</Badge>
                      )}
                    </TableCell>
                    <TableCell className="hidden min-[1800px]:table-cell whitespace-nowrap font-mono text-muted-foreground">
                      {quo.orderId || '—'}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <span className="block max-w-[150px] truncate font-medium text-foreground" title={quo.customerName}>
                        {quo.customerName}
                      </span>
                    </TableCell>
                    <TableCell className="hidden min-[1700px]:table-cell">
                      <span className="block max-w-[170px] truncate" title={quo.productType}>
                        {quo.productType}
                      </span>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-right tabular-nums font-semibold text-foreground">
                      {quo.quantity}
                    </TableCell>
                    <TableCell className="hidden min-[1800px]:table-cell text-right tabular-nums text-muted-foreground">
                      {/* The rate that actually prices this quantity; below MOQ that is the below-MOQ one. */}
                      {formatCurrency(effectiveUnitPrice(quo))}
                      {isBelowMoq(quo) && !!quo.priceBelowMoq && (
                        <span className="block text-[10px] text-amber-700">di bawah MOQ</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-right tabular-nums font-bold text-foreground">
                      {formatCurrency(total)}
                    </TableCell>
                    <TableCell className="hidden 2xl:table-cell text-muted-foreground">
                      {formatDate(quo.deadline)}
                    </TableCell>
                    <TableCell className="text-center">
                      <QuotationStatusTag quotation={quo} solid />
                    </TableCell>
                    <TableCell className="cell-sticky-end text-right">
                      <TableRowActions>
                        {/*
                          * The decision comes first. Tandai Ditolak and Cetak stay in
                          * Detail, so a row never carries more than three buttons.
                          */}
                        {quo.supersededBy ? (
                          <RowActionButton
                            icon={Printer}
                            label="Cetak"
                            ariaLabel={`Cetak surat penawaran ${quo.id}`}
                            title="Cetak surat penawaran (riwayat revisi)"
                            onClick={() => handleOpenPrintQuo(quo)}
                          />
                        ) : quo.status === 'Approved' ? (
                          <>
                            <RowActionButton
                              display="labeled"
                              tone="primary"
                              icon={Pencil}
                              label="Revisi"
                              ariaLabel={`Revisi kuantitas penawaran ${quo.id}`}
                              title="Revisi kuantitas atau harga deal"
                              onClick={() => handleOpenReviseDealModal(quo)}
                            />
                            <RowActionButton
                              icon={Printer}
                              label="Cetak"
                              ariaLabel={`Cetak surat penawaran ${quo.id}`}
                              title="Cetak surat penawaran"
                              onClick={() => handleOpenPrintQuo(quo)}
                            />
                          </>
                        ) : quo.status === 'Rejected' ? (
                          // A rejected quotation is history: the server refuses to deal it, so neither is offered.
                          <RowActionButton
                            icon={Printer}
                            label="Cetak"
                            ariaLabel={`Cetak surat penawaran ${quo.id}`}
                            title="Cetak surat penawaran (ditolak)"
                            onClick={() => handleOpenPrintQuo(quo)}
                          />
                        ) : (
                          <>
                            <RowActionButton
                              display="labeled"
                              tone="primary"
                              icon={CheckCircle2}
                              label="Deal"
                              ariaLabel={`Setujui deal penawaran ${quo.id}`}
                              title="Setujui deal dan terbitkan pesanan"
                              onClick={() => handleOpenDealModal(quo)}
                            />
                            <RowActionButton
                              icon={Pencil}
                              label="Ubah"
                              ariaLabel={`Ubah penawaran ${quo.id}`}
                              title="Ubah penawaran"
                              onClick={() => handleOpenEditQuoModal(quo)}
                            />
                          </>
                        )}

                        {canDeleteQuotation(quo) && (
                          <RowActionButton
                            icon={Trash2}
                            tone="danger"
                            label="Hapus"
                            ariaLabel={`Hapus penawaran ${quo.id}`}
                            title="Hapus penawaran"
                            onClick={() => handleDeleteQuotation(quo.id)}
                          />
                        )}

                        <RowDetailButton label={quo.id} onClick={() => setDetailQuotation(quo)} />
                      </TableRowActions>
                    </TableCell>
                  </TableRow>
                );
                })
              )}
            </TableBody>
          </Table>
          <TablePagination {...pagination} label="penawaran" />
        </Card>
      )}

      {/* DETAIL DRAWER: QUOTATION */}
      <DetailDrawer
        isOpen={!!detailQuotation}
        onClose={() => setDetailQuotation(null)}
        title={`Penawaran ${detailQuotation?.id ?? ''}`}
        subtitle={detailQuotation?.customerName}
        footer={
          detailQuotation && (
            <div className="flex flex-wrap items-center gap-2">
              {canDeleteQuotation(detailQuotation) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const target = detailQuotation;
                    setDetailQuotation(null);
                    handleDeleteQuotation(target.id);
                  }}
                  className="mr-auto text-brand-red hover:bg-rose-50 hover:border-rose-300"
                >
                  <Trash2 size={14} aria-hidden="true" /> Hapus
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => handleOpenPrintQuo(detailQuotation)}>
                <Printer size={14} aria-hidden="true" /> Cetak PDF
              </Button>
              {detailQuotation.supersededBy || detailQuotation.status === 'Rejected' ? null : detailQuotation.status === 'Approved' ? (
                <Button size="sm" onClick={() => handleOpenReviseDealModal(detailQuotation)}>
                  <Pencil size={14} aria-hidden="true" /> Revisi Qty Deal
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleOpenReject(detailQuotation)}
                    className="text-brand-red hover:border-brand-red/40 hover:bg-rose-50"
                  >
                    <XCircle size={14} aria-hidden="true" /> Tandai Ditolak
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => handleOpenEditQuoModal(detailQuotation)}>
                    <Pencil size={14} aria-hidden="true" /> Ubah
                  </Button>
                  <Button size="sm" onClick={() => handleOpenDealModal(detailQuotation)}>
                    <CheckCircle2 size={14} aria-hidden="true" /> Setujui Deal & Buat Pesanan
                  </Button>
                </>
              )}
            </div>
          )
        }
      >
        {detailQuotation && (
          <>
            <DetailStats
              items={[
                { label: 'Jumlah penawaran', value: `${detailQuotation.quantity} Pcs` },
                {
                  label: 'Total penawaran',
                  value: formatCurrency(Number(detailQuotation.totalPrice) || (Number(detailQuotation.quantity) * Number(detailQuotation.price))),
                  tone: 'accent'
                },
                { label: 'Target selesai', value: formatDate(detailQuotation.deadline) }
              ]}
            />

            <DetailSection title="Status penawaran">
              <DetailField label="Status">
                <QuotationStatusTag quotation={detailQuotation} solid />
              </DetailField>
              <DetailField label="Pelanggan">{detailQuotation.customerName}</DetailField>
              <DetailField label="PIC">
                {detailQuotation.picName
                  ? `${detailQuotation.picName}${detailQuotation.picRole ? ` (${detailQuotation.picRole})` : ''}`
                  : detailQuotation.user || '-'}
              </DetailField>
              <DetailField label="No. Penawaran" mono>
                {detailQuotation.quotationNo || detailQuotation.id}
                {!!detailQuotation.revision && ` (Revisi ${detailQuotation.revision})`}
              </DetailField>
              {!!detailQuotation.revision && (
                <DetailField label="Menggantikan" mono>{detailQuotation.revisionOf}</DetailField>
              )}
              {!!detailQuotation.revisedBy && (
                <DetailField label="Direvisi oleh">{detailQuotation.revisedBy}</DetailField>
              )}
              {detailQuotation.orderId && (
                <DetailField label="Pesanan terhubung" mono>{detailQuotation.orderId}</DetailField>
              )}
              {detailQuotation.approvedAt && (
                <DetailField label="Disetujui pada">{formatDateTime(detailQuotation.approvedAt)}</DetailField>
              )}
            </DetailSection>

            <DetailSection title="Spesifikasi produk">
              <DetailField label="Jenis produk">{detailQuotation.productType}</DetailField>
              <DetailField label="Desain">{detailQuotation.designName || '-'}</DetailField>
              <DetailField label="Bahan">{detailQuotation.material}</DetailField>
              <DetailField label="Warna">{detailQuotation.color}</DetailField>
              <DetailField label="Sablon / bordir">{detailQuotation.sablonBordir || detailQuotation.accessories}</DetailField>
              <DetailField label="Rincian ukuran">{detailQuotation.size}</DetailField>
              <DetailField label="Template size chart">
                {detailQuotation.sizeChartName || detailQuotation.sizeChartId || 'Belum dipilih'}
              </DetailField>
              <DetailField label="Kebutuhan sampel">
                {detailQuotation.needsSample ? 'Perlu sampel fisik' : 'Tanpa sampel fisik (langsung produksi)'}
              </DetailField>
            </DetailSection>

            {detailQuotation.designUrl && (
              <DetailBlock title="Mockup acuan desain">
                <figure className="flex items-center gap-4">
                  <img
                    src={detailQuotation.designUrl}
                    alt={`Mockup ${detailQuotation.productType}`}
                    className="size-28 shrink-0 rounded-xl border border-border bg-white object-contain p-1"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = '/templates/Halaman1.png';
                    }}
                  />
                  <figcaption className="min-w-0 text-sm">
                    <span className="block font-semibold text-foreground">
                      {detailQuotation.designName || detailQuotation.productType}
                    </span>
                    {detailQuotation.designId && (
                      <span className="mt-0.5 block font-mono text-xs text-muted-foreground">
                        {detailQuotation.designId}
                      </span>
                    )}
                  </figcaption>
                </figure>
              </DetailBlock>
            )}

            <DetailSection title="Harga & kuantitas">
              <DetailField label={isBelowMoq(detailQuotation) && !!detailQuotation.priceBelowMoq ? 'Harga satuan berlaku (di bawah MOQ)' : 'Harga satuan berlaku'}>
                {formatCurrency(effectiveUnitPrice(detailQuotation))}
              </DetailField>
              <DetailField label="Total harga">
                {formatCurrency(Number(detailQuotation.totalPrice) || (Number(detailQuotation.quantity) * effectiveUnitPrice(detailQuotation)))}
              </DetailField>
              <DetailField label="MOQ standar">{detailQuotation.moq || 100} Pcs</DetailField>
              <DetailField label="Harga di atas MOQ">{formatCurrency(detailQuotation.price)}</DetailField>
              {!!detailQuotation.priceBelowMoq && (
                <DetailField label="Harga di bawah MOQ">{formatCurrency(detailQuotation.priceBelowMoq)}</DetailField>
              )}
            </DetailSection>

            {detailQuotation.paymentSchedule && detailQuotation.paymentSchedule.length > 0 && (
              <DetailBlock title="Rencana termin pembayaran">
                <ul className="divide-y divide-border/70 text-sm">
                  {detailQuotation.paymentSchedule.map(term => (
                    <li key={term.id} className="flex items-center justify-between gap-3 py-2">
                      <span className="min-w-0">
                        <span className="font-semibold text-foreground">
                          {term.label} {term.percentage}%
                        </span>
                      </span>
                      <span className="shrink-0 font-bold tabular-nums text-foreground">
                        {formatCurrency(term.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              </DetailBlock>
            )}

            {detailQuotation.notes && (
              <DetailSection title="Catatan penawaran">
                <DetailField label="Catatan khusus" full>{detailQuotation.notes}</DetailField>
              </DetailSection>
            )}
          </>
        )}
      </DetailDrawer>

      {/* MODAL: SETUJUI DEAL PENAWARAN KE PESANAN */}
      <Modal
        isOpen={!!dealQuotation}
        onClose={() => setDealQuotation(null)}
        title="Persetujuan Surat Penawaran (Deal Klien)"
        subtitle={`Pelanggan menyetujui ${dealQuotation?.id} (${dealQuotation?.productType}).`}
        maxWidth="xl"
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="outline" disabled={submittingDeal} onClick={() => setDealQuotation(null)}>
              Batal
            </Button>
            <Button type="submit" form="deal-form" disabled={submittingDeal}>
              <CheckCircle2 size={16} aria-hidden="true" />
              {submittingDeal ? 'Memproses Pesanan…' : 'Setujui Deal & Buat Pesanan'}
            </Button>
          </div>
        }
      >
        <form id="deal-form" noValidate onSubmit={handleConfirmDeal} className="space-y-4">
          <FormNotice icon={<CheckCircle2 size={18} />} title="Menyetujui penawaran akan menerbitkan pesanan resmi">
            Pesanan muncul di halaman Pesanan Masuk dengan spesifikasi 4 serangkai yang sama, dan tagihannya ikut dibuat.
          </FormNotice>

          <FormError>{dealError}</FormError>

          <div>
            <FieldLabel htmlFor="deal-po" required>Nomor PO resmi klien / HIJ</FieldLabel>
            <Input
              id="deal-po"
              type="text"
              value={dealPo}
              placeholder="Contoh: PO-CLI-2026-001"
              onChange={e => setDealPo(e.target.value)}
            />
            <FieldHint>Nomor ini yang dipakai tim produksi dan pengiriman untuk melacak pesanan.</FieldHint>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor="deal-dp" required>Uang muka (DP disepakati)</FieldLabel>
              <CurrencyInput
                id="deal-dp"
                value={dealDp}
                aria-describedby="deal-dp-hint"
                onChange={e => setDealDp(Number(e.target.value))}
              />
              <FieldHint id="deal-dp-hint">
                {dealPercent !== null
                  ? `${dealPercent}% dari nilai pesanan ${formatCurrency(Number(dealQuotation?.totalPrice) || 0)}.`
                  : `Nilai pesanan ${formatCurrency(Number(dealQuotation?.totalPrice) || 0)}.`}
              </FieldHint>
            </div>

            <div>
              <FieldLabel htmlFor="deal-deadline" required>Target selesai / deadline kirim</FieldLabel>
              <Input
                id="deal-deadline"
                type="date"
                value={dealDeadline}
                onChange={e => setDealDeadline(e.target.value)}
              />
            </div>
          </div>
        </form>
      </Modal>

      {/* MODAL: REVISI KUANTITAS / HARGA PENAWARAN DEAL */}
      <Modal
        isOpen={!!reviseQuotation}
        onClose={() => setReviseQuotation(null)}
        title={`Revisi Penawaran Deal: ${reviseQuotation?.id ?? ''}`}
        subtitle={`Klien ${reviseQuotation?.customerName} (${reviseQuotation?.productType}).`}
        maxWidth="lg"
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="outline" disabled={submittingRevise} onClick={() => setReviseQuotation(null)}>
              Batal
            </Button>
            <Button type="submit" form="revise-form" disabled={submittingRevise}>
              <CheckCircle2 size={16} aria-hidden="true" />
              {submittingRevise ? 'Menyinkronkan…' : 'Simpan & Sinkronkan Pesanan/Invoice'}
            </Button>
          </div>
        }
      >
        <form id="revise-form" noValidate onSubmit={handleSubmitReviseDeal} className="space-y-4">
          <FormNotice icon={<Info size={18} />} title="Revisi diterbitkan sebagai dokumen bernomor baru">
            Penawaran lama menjadi riwayat, lalu pesanan dan tagihannya ikut diperbarui ke angka baru ini.
          </FormNotice>

          <FormError>{reviseError}</FormError>

          <div>
            <FieldLabel>Rincian ukuran baru</FieldLabel>
            <SizeRowsEditor
              rows={reviseSizeRows}
              onChange={rows => {
                setReviseSizeRows(rows);
                if (rows.some(r => r.size.trim())) setReviseQty(sizeRowsTotal(rows));
              }}
              caption="Jumlah pcs per ukuran setelah revisi"
              hint="Kuantitas baru mengikuti total tabel ini; pesanan dan SPK ikut memakai rincian ini."
              idPrefix="revise-size"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor="revise-qty" required>Kuantitas baru (Pcs)</FieldLabel>
              <Input
                id="revise-qty"
                type="number"
                min={1}
                inputMode="numeric"
                value={reviseQty}
                readOnly={reviseSizeRows.some(r => r.size.trim())}
                aria-describedby="revise-qty-hint"
                className="text-right font-semibold tabular-nums read-only:border-dashed read-only:bg-muted/60"
                onChange={e => setReviseQty(Number(e.target.value))}
              />
              <FieldHint id="revise-qty-hint">
                Sebelumnya {reviseQuotation?.quantity} Pcs, MOQ {Number(reviseQuotation?.moq) || '—'} Pcs.
              </FieldHint>
            </div>

            <div>
              <FieldLabel htmlFor="revise-price" required>Harga di atas MOQ</FieldLabel>
              <CurrencyInput
                id="revise-price"
                value={revisePrice}
                aria-describedby="revise-price-hint"
                onChange={e => setRevisePrice(Number(e.target.value))}
              />
              <FieldHint id="revise-price-hint">
                Harga di bawah MOQ ({formatCurrency(Number(reviseQuotation?.priceBelowMoq) || 0)}) ikut dari penawaran asal.
              </FieldHint>
            </div>
          </div>

          <div
            aria-live="polite"
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-muted/40 p-3.5"
          >
            <div>
              <span className="block text-xs font-semibold text-muted-foreground">Total nilai baru</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {reviseQty} Pcs &times; {formatCurrency(reviseUnitPrice)}
                {' — '}
                {reviseUsesBelowMoq ? 'memakai harga di bawah MOQ' : 'memakai harga di atas MOQ'}
              </span>
            </div>
            <span className="text-lg font-bold tabular-nums text-foreground">
              {formatCurrency(reviseTotal)}
            </span>
          </div>

          <div>
            <FieldLabel htmlFor="revise-deadline" aside="Opsional">Target tanggal selesai baru</FieldLabel>
            <Input
              id="revise-deadline"
              type="date"
              value={reviseDeadline}
              onChange={e => setReviseDeadline(e.target.value)}
            />
          </div>

          <div>
            <FieldLabel htmlFor="revise-notes" aside="Opsional">Alasan perubahan / catatan negosiasi</FieldLabel>
            <Textarea
              id="revise-notes"
              rows={2}
              value={reviseNotes}
              placeholder="Contoh: Klien menambah 50 pcs kaos ukuran L dan XL untuk divisi operasional."
              onChange={e => setReviseNotes(e.target.value)}
            />
          </div>
        </form>
      </Modal>

      {/* MODAL: BUAT / EDIT SURAT PENAWARAN */}
      <Modal
        isOpen={isQuoModalOpen}
        onClose={() => setIsQuoModalOpen(false)}
        title={editingQuotationId ? `Edit Penawaran ${editingQuotationId}` : 'Buat Surat Penawaran Harga'}
        subtitle="Definisikan 4 Serangkai: Desain Mockup, Bahan, Warna/Ukuran, dan Sablon/Bordir."
        maxWidth="3xl"
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="outline" disabled={savingQuo} onClick={() => setIsQuoModalOpen(false)}>
              Batal
            </Button>
            <Button type="submit" form="quotation-form" disabled={savingQuo}>
              <CheckCircle2 size={16} aria-hidden="true" />
              {savingQuo ? 'Menyimpan…' : 'Simpan Surat Penawaran'}
            </Button>
          </div>
        }
      >
        <form id="quotation-form" noValidate onSubmit={handleSaveQuotation} className="space-y-5">
          <FormError>{quoError}</FormError>

          {/* Pull the agreed mockup in rather than retyping its specification. */}
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-3.5">
            <FieldLabel htmlFor="quo-design" aside="Opsional">
              <span className="inline-flex items-center gap-1.5">
                <Palette size={14} className="text-primary" aria-hidden="true" />
                Acuan desain mockup (R&amp;D pra-produksi)
              </span>
            </FieldLabel>
            <Select
              id="quo-design"
              value={selectedDesignId}
              disabled={approvedDesigns.length === 0}
              aria-describedby="quo-design-hint"
              onChange={e => handleSelectDesign(e.target.value)}
            >
              <option value="">
                {approvedDesigns.length === 0
                  ? 'Belum ada desain yang disetujui'
                  : 'Tanpa acuan desain — isi spesifikasi manual'}
              </option>
              {approvedDesigns.map(d => (
                <option key={d.id} value={d.id}>
                  {d.id} · {d.name} ({d.category || 'Custom'})
                </option>
              ))}
            </Select>
            <FieldHint id="quo-design-hint">
              {approvedDesigns.length === 0
                ? 'Setujui desain di halaman Desain & Sampel agar bisa ditarik ke penawaran ini.'
                : 'Memilih desain mengisi otomatis nama produk, klien, dan catatan spesifikasinya.'}
            </FieldHint>
          </div>

          <FormSection step={1} title="Data klien & produk">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <FieldLabel htmlFor="quo-customer" required>Pelanggan</FieldLabel>
                <Select
                  id="quo-customer"
                  value={quoFormData.customerId || ''}
                  aria-invalid={!!quoFieldErrors.customerId}
                  aria-describedby={quoFieldErrors.customerId ? 'quo-customer-error' : undefined}
                  onChange={e => {
                    const c = customers.find(item => item.id === e.target.value);
                    setQuoFieldErrors(prev => ({ ...prev, customerId: '' }));
                    setQuoFormData(prev => ({
                      ...prev,
                      customerId: e.target.value,
                      customerName: c?.name || ''
                    }));
                  }}
                >
                  <option value="">Pilih pelanggan</option>
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.company ? `(${c.company})` : ''}
                    </option>
                  ))}
                </Select>
                <FieldError id="quo-customer-error">{quoFieldErrors.customerId}</FieldError>
              </div>

              <div>
                <FieldLabel htmlFor="quo-product" required>Nama / jenis produk</FieldLabel>
                <Input
                  id="quo-product"
                  type="text"
                  value={quoFormData.productType || ''}
                  placeholder="Contoh: Kemeja Tactical Ripstop"
                  aria-invalid={!!quoFieldErrors.productType}
                  aria-describedby={quoFieldErrors.productType ? 'quo-product-error' : undefined}
                  onChange={e => {
                    setQuoFieldErrors(prev => ({ ...prev, productType: '' }));
                    setQuoFormData(prev => ({ ...prev, productType: e.target.value }));
                  }}
                />
                <FieldError id="quo-product-error">{quoFieldErrors.productType}</FieldError>
              </div>

              <div>
                <FieldLabel htmlFor="quo-pic" required>PIC (penanggung jawab)</FieldLabel>
                <Select
                  id="quo-pic"
                  value={quoFormData.picUserId || ''}
                  aria-invalid={!!quoFieldErrors.picUserId}
                  aria-describedby={quoFieldErrors.picUserId ? 'quo-pic-error' : 'quo-pic-hint'}
                  onChange={e => handlePickPic(e.target.value)}
                >
                  <option value="">Pilih PIC</option>
                  {picChoices.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name}{s.role ? ` · ${s.role}` : ''}
                    </option>
                  ))}
                </Select>
                {quoFieldErrors.picUserId
                  ? <FieldError id="quo-pic-error">{quoFieldErrors.picUserId}</FieldError>
                  : <FieldHint id="quo-pic-hint">Akun staf yang menangani penawaran ini; ikut ke pesanan saat deal.</FieldHint>}
              </div>
            </div>
          </FormSection>

          <FormSection
            step={2}
            title="Spesifikasi 4 serangkai"
            description="Bahan, warna, sablon/bordir, dan rincian ukuran — semuanya tercetak di surat penawaran."
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <FieldLabel htmlFor="quo-material">Bahan baku / kain</FieldLabel>
                <Input
                  id="quo-material"
                  type="text"
                  value={quoFormData.material || ''}
                  placeholder="Contoh: Cotton Combed 24s / Ripstop Tornado"
                  onChange={e => setQuoFormData(prev => ({ ...prev, material: e.target.value }))}
                />
              </div>

              <div>
                <FieldLabel htmlFor="quo-color">Warna kain</FieldLabel>
                <Input
                  id="quo-color"
                  type="text"
                  value={quoFormData.color || ''}
                  placeholder="Contoh: Hitam Reaktif / Navy Blue"
                  onChange={e => setQuoFormData(prev => ({ ...prev, color: e.target.value }))}
                />
              </div>

              <div className="sm:col-span-2">
                <FieldLabel htmlFor="quo-finishing">Sablon / bordir / trims</FieldLabel>
                <Input
                  id="quo-finishing"
                  type="text"
                  value={quoFormData.sablonBordir || quoFormData.accessories || ''}
                  placeholder="Contoh: Bordir komputer dada kanan & punggung"
                  onChange={e => setQuoFormData(prev => ({
                    ...prev,
                    sablonBordir: e.target.value,
                    accessories: e.target.value
                  }))}
                />
              </div>
            </div>

            <fieldset className="sm:col-span-2">
              <legend className="mb-1.5 block text-sm font-semibold text-foreground">
                Rincian ukuran (size breakdown)
              </legend>

              {/* Mirrors the order form, so what the deal records is what the SPK prints. */}
              <label htmlFor="quo-size-chart" className="mb-1 block text-xs font-semibold text-foreground">
                Template size chart <span className="text-brand-red" aria-hidden="true">*</span>
              </label>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <div role="group" aria-label="Sumber size chart" className="inline-flex rounded-lg border border-border p-0.5">
                  {([
                    ['all', 'Semua'],
                    ['standard', 'Standar HIJ'],
                    ['customer', 'Khusus pelanggan']
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={chartScope === value}
                      onClick={() => setChartScope(value)}
                      className={cn(
                        'rounded-md px-2.5 py-1 text-xs font-semibold transition-colors',
                        chartScope === value ? 'bg-brand-teal-dark text-white' : 'text-muted-foreground hover:bg-muted'
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="min-w-[220px] flex-1 sm:max-w-xs">
                  <Select
                    id="quo-size-chart"
                    aria-label="Template size chart"
                    required
                    value={pickedChartId}
                    aria-invalid={!!quoFieldErrors.sizeChartId}
                    aria-describedby={quoFieldErrors.sizeChartId ? 'quo-size-chart-error' : undefined}
                    onChange={e => handlePickSizeChart(e.target.value)}
                  >
                    <option value="">-- Pilih template size chart --</option>
                    {availableCharts.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {(c.scope || 'standard') === 'customer' ? ` · khusus ${c.customerName || 'pelanggan'}` : ' · standar HIJ'}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              <FieldError id="quo-size-chart-error">{quoFieldErrors.sizeChartId}</FieldError>
              <p className="mb-2 text-[11px] text-muted-foreground">
                {chartScope === 'customer' && !quoFormData.customerId
                  ? 'Pilih pelanggan dulu untuk melihat size chart khususnya.'
                  : chartScope === 'customer' && availableCharts.length === 0
                    ? 'Pelanggan ini belum punya size chart khusus. Buat di menu Size Chart, atau pakai standar HIJ.'
                    : pickedChart
                      ? `Dicetak di SPK persis seperti di halaman Size Chart — kolom ${pickedChart.measurements.map(m => m.code || m.label).join(', ') || '-'}; ukuran ${pickedChart.rows.map(r => r.size).join(', ') || '-'}. Jumlah pcs per ukuran diisi di tabel bawah.`
                      : 'Wajib dipilih: detail ukuran template ini dicetak di SPK. Jumlah pcs per ukuran diisi di tabel bawah.'}
              </p>
              <SizeRowsEditor
                rows={sizeRows}
                onChange={applySizeRows}
                caption="Jumlah pcs per ukuran untuk penawaran ini"
                hint="Kuantitas pesanan mengikuti total tabel ini."
                idPrefix="quo-size"
              />
            </fieldset>
          </FormSection>

          <FormSection step={3} title="Kuantitas, harga & jadwal">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <FieldLabel htmlFor="quo-quantity" required>Kuantitas (Pcs)</FieldLabel>
                <Input
                  id="quo-quantity"
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={quoFormData.quantity || ''}
                  readOnly={quantityFromSizeRows}
                  aria-invalid={!!quoFieldErrors.quantity}
                  aria-describedby={
                    quoFieldErrors.quantity
                      ? 'quo-quantity-error'
                      : quantityFromSizeRows ? 'quo-quantity-hint' : undefined
                  }
                  className={cn(
                    'text-right font-semibold tabular-nums',
                    // A read-only box that still looks editable invites typing that goes nowhere.
                    quantityFromSizeRows && 'cursor-not-allowed border-dashed bg-muted/60 text-muted-foreground'
                  )}
                  onChange={e => {
                    const q = Number(e.target.value);
                    setQuoFieldErrors(prev => ({ ...prev, quantity: '' }));
                    setQuoFormData(prev => {
                      const next = { ...prev, quantity: q };
                      const tot = q * effectiveUnitPrice(next);
                      return {
                        ...next,
                        totalPrice: tot,
                        paymentSchedule: next.paymentSchedule ? withAmounts(next.paymentSchedule, tot) : undefined
                      };
                    });
                  }}
                />
                {quantityFromSizeRows && !quoFieldErrors.quantity && (
                  <FieldHint id="quo-quantity-hint">Dihitung dari rincian ukuran di atas.</FieldHint>
                )}
                <FieldError id="quo-quantity-error">{quoFieldErrors.quantity}</FieldError>
              </div>

              <div>
                <FieldLabel htmlFor="quo-moq" required>MOQ (Pcs)</FieldLabel>
                <Input
                  id="quo-moq"
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={quoFormData.moq || ''}
                  aria-invalid={!!quoFieldErrors.moq}
                  aria-describedby={quoFieldErrors.moq ? 'quo-moq-error' : undefined}
                  className="text-right font-semibold tabular-nums"
                  onChange={e => {
                    const moq = Number(e.target.value) || 0;
                    setQuoFieldErrors(prev => ({ ...prev, moq: '' }));
                    setQuoFormData(prev => {
                      const next = { ...prev, moq };
                      const tot = (Number(next.quantity) || 0) * effectiveUnitPrice(next);
                      return {
                        ...next,
                        totalPrice: tot,
                        paymentSchedule: next.paymentSchedule ? withAmounts(next.paymentSchedule, tot) : undefined
                      };
                    });
                  }}
                />
                <FieldError id="quo-moq-error">{quoFieldErrors.moq}</FieldError>
              </div>

              <div>
                <FieldLabel htmlFor="quo-deadline" required>Target tanggal selesai</FieldLabel>
                <Input
                  id="quo-deadline"
                  type="date"
                  value={quoFormData.deadline || ''}
                  aria-invalid={!!quoFieldErrors.deadline}
                  aria-describedby={quoFieldErrors.deadline ? 'quo-deadline-error' : undefined}
                  onChange={e => {
                    setQuoFieldErrors(prev => ({ ...prev, deadline: '' }));
                    setQuoFormData(prev => ({ ...prev, deadline: e.target.value }));
                  }}
                />
                <FieldError id="quo-deadline-error">{quoFieldErrors.deadline}</FieldError>
              </div>

              <div>
                <FieldLabel htmlFor="quo-price" required>Harga di atas MOQ</FieldLabel>
                <CurrencyInput
                  id="quo-price"
                  value={quoFormData.price || ''}
                  aria-invalid={!!quoFieldErrors.price}
                  aria-describedby={quoFieldErrors.price ? 'quo-price-error' : 'quo-price-hint'}
                  onChange={e => {
                    const price = Number(e.target.value) || 0;
                    setQuoFieldErrors(prev => ({ ...prev, price: '' }));
                    setQuoFormData(prev => {
                      const next = { ...prev, price };
                      const tot = (Number(next.quantity) || 0) * effectiveUnitPrice(next);
                      return {
                        ...next,
                        totalPrice: tot,
                        paymentSchedule: next.paymentSchedule ? withAmounts(next.paymentSchedule, tot) : undefined
                      };
                    });
                  }}
                />
                {quoFieldErrors.price
                  ? <FieldError id="quo-price-error">{quoFieldErrors.price}</FieldError>
                  : <FieldHint id="quo-price-hint">Dipakai bila jumlah &ge; MOQ — harga lebih murah per pcs.</FieldHint>}
              </div>

              <div>
                <FieldLabel htmlFor="quo-price-below" required>Harga di bawah MOQ</FieldLabel>
                <CurrencyInput
                  id="quo-price-below"
                  value={quoFormData.priceBelowMoq || ''}
                  aria-invalid={!!quoFieldErrors.priceBelowMoq}
                  aria-describedby={quoFieldErrors.priceBelowMoq ? 'quo-price-below-error' : 'quo-price-below-hint'}
                  onChange={e => {
                    const priceBelowMoq = Number(e.target.value) || 0;
                    setQuoFieldErrors(prev => ({ ...prev, priceBelowMoq: '' }));
                    setQuoFormData(prev => {
                      const next = { ...prev, priceBelowMoq };
                      const tot = (Number(next.quantity) || 0) * effectiveUnitPrice(next);
                      return {
                        ...next,
                        totalPrice: tot,
                        paymentSchedule: next.paymentSchedule ? withAmounts(next.paymentSchedule, tot) : undefined
                      };
                    });
                  }}
                />
                {quoFieldErrors.priceBelowMoq
                  ? <FieldError id="quo-price-below-error">{quoFieldErrors.priceBelowMoq}</FieldError>
                  : <FieldHint id="quo-price-below-hint">Dipakai bila jumlah &lt; MOQ — harga lebih mahal per pcs.</FieldHint>}
              </div>
            </div>

            <div
              aria-live="polite"
              className="mt-1 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-muted/40 p-3"
            >
              <div>
                <span className="block text-xs font-semibold text-muted-foreground">Total penawaran harga</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {Number(quoFormData.quantity) || 0} Pcs &times; {formatCurrency(effectiveUnitPrice(quoFormData))}
                  {' — '}
                  {isBelowMoq(quoFormData) ? 'memakai harga di bawah MOQ' : 'memakai harga di atas MOQ'}
                </span>
              </div>
              <span className="text-lg font-bold tabular-nums text-foreground">
                {formatCurrency(quoTotal)}
              </span>
            </div>
          </FormSection>

          <FormSection step={4} title="Sampel, pengadaan & termin pembayaran">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <FieldLabel htmlFor="quo-needs-sample">Kebutuhan sampel fisik</FieldLabel>
                <Select
                  id="quo-needs-sample"
                  value={quoFormData.needsSample ? 'true' : 'false'}
                  onChange={e => setQuoFormData(prev => ({ ...prev, needsSample: e.target.value === 'true' }))}
                >
                  <option value="false">Tanpa sampel fisik (langsung produksi massal)</option>
                  <option value="true">Wajib sampel fisik (ACC sebelum SPK)</option>
                </Select>
              </div>

              <div>
                <FieldLabel htmlFor="quo-procurement">Status pengadaan bahan</FieldLabel>
                <Select
                  id="quo-procurement"
                  value={quoFormData.needsProcurement || 'Perlu Pengadaan'}
                  onChange={e => setQuoFormData(prev => ({ ...prev, needsProcurement: e.target.value }))}
                >
                  <option value="Perlu Pengadaan">Perlu pengadaan (beli kain / trims)</option>
                  <option value="Tanpa Pengadaan">Tanpa pengadaan (stok gudang cukup / bahan dari klien)</option>
                </Select>
              </div>
            </div>

            <PaymentTermsEditor
              idPrefix="quo-term"
              terms={quoFormData.paymentSchedule || createDefaultSchedule(quoTotal)}
              total={quoTotal}
              onChange={terms => {
                setQuoFieldErrors(prev => ({ ...prev, paymentSchedule: '' }));
                setQuoFormData(prev => ({ ...prev, paymentSchedule: terms }));
              }}
              error={quoFieldErrors.paymentSchedule}
            />

            <div>
              <FieldLabel htmlFor="quo-notes" aside="Opsional">
                Catatan syarat &amp; ketentuan tambahan
              </FieldLabel>
              <Textarea
                id="quo-notes"
                rows={2}
                value={quoFormData.notes || ''}
                placeholder="Contoh: Packing polybag per pcs, jahitan pundak rantai, label woven leher."
                onChange={e => setQuoFormData(prev => ({ ...prev, notes: e.target.value }))}
              />
            </div>
          </FormSection>
        </form>
      </Modal>

      {/* MODAL: TANDAI PENAWARAN DITOLAK KLIEN */}
      <Modal
        isOpen={!!rejectTarget}
        onClose={() => setRejectTarget(null)}
        title={`Tandai ${rejectTarget?.id ?? ''} Ditolak`}
        subtitle={rejectTarget ? `Klien ${rejectTarget.customerName} tidak melanjutkan penawaran ini.` : undefined}
        maxWidth="lg"
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="outline" disabled={submittingReject} onClick={() => setRejectTarget(null)}>
              Batal
            </Button>
            <Button type="submit" form="reject-form" variant="destructive" disabled={submittingReject}>
              <XCircle size={16} aria-hidden="true" />
              {submittingReject ? 'Menyimpan…' : 'Tandai Ditolak'}
            </Button>
          </div>
        }
      >
        <form id="reject-form" noValidate onSubmit={handleConfirmReject} className="space-y-4">
          <FormError>{rejectError}</FormError>

          <div>
            <FieldLabel htmlFor="reject-reason" required>Alasan penolakan</FieldLabel>
            <Textarea
              id="reject-reason"
              rows={3}
              value={rejectReason}
              placeholder="Contoh: Harga di atas anggaran klien, tender dimenangkan vendor lain."
              aria-invalid={!!rejectError}
              aria-describedby={rejectError ? undefined : 'reject-reason-hint'}
              onChange={e => {
                setRejectError(null);
                setRejectReason(e.target.value);
              }}
            />
            <FieldHint id="reject-reason-hint">
              Alasan ini disimpan di catatan penawaran, jadi riwayat negosiasinya tetap terbaca saat klien kembali.
            </FieldHint>
          </div>
        </form>
      </Modal>

      {/* MODAL: CETAK SURAT PENAWARAN RESMI PDF */}
      <Modal
        isOpen={isPrintQuoOpen}
        onClose={() => setIsPrintQuoOpen(false)}
        title={`Surat Penawaran ${printQuotation?.id ?? ''}`}
        subtitle="Dokumen A4 resmi di atas kop surat HIJ."
        maxWidth="4xl"
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setIsPrintQuoOpen(false)}>
              Tutup
            </Button>
            <Button onClick={handleDownloadQuotationPdf} disabled={isDownloadingQuo}>
              <Download size={16} aria-hidden="true" />
              {isDownloadingQuo ? 'Membuat PDF…' : 'Unduh PDF Penawaran'}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <FormError>{quoPdfError}</FormError>
          <div className="max-h-[68vh] overflow-auto rounded-xl bg-slate-200 p-3">
            <div className="mx-auto w-fit">
              {printQuotation && (
                <QuotationDocument
                  id="quotation-doc"
                  quotation={printQuotation}
                  customer={customers.find(c => c.id === printQuotation.customerId)}
                />
              )}
            </div>
          </div>
        </div>
      </Modal>

      {/* Ditaruh paling akhir supaya kotak konfirmasi tampil di atas drawer dan modal lain. */}
      {confirmDialog}
    </div>
  );
};
