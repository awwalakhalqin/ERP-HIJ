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
  CalendarClock,
  BadgeCheck,
  Ban
} from 'lucide-react';
import { Order, Customer, SPK, Design, Sample, Invoice, PaymentTerm, SizeChart } from '../../types';
import { fetchResource, createResource, updateResource, deleteResource, fetchReadinessData, issueSpkApi, approveDpApi, commitExcelImportApi, authFetch, fetchStaffDirectory, StaffDirectoryEntry } from '../../services/api';
import { COMPANY_CONTACT } from '../../config/contact';
import { getCurrentUser } from '../../lib/session';
import { parseWorkbookData, type ImportPlan } from '../../lib/excelImport';
import { db } from '../../db/dexie';
import { cn, formatCurrency, formatDate, formatDateTime, generateId, statusLabel } from '../../lib/utils';
import { getOrderReadiness, ordersAwaitingSpk, isSpkOptionalForOrder, type ReadinessData, type OrderReadiness } from '../../lib/readiness';
import { nextSequence } from '../../lib/ordering';
import { SizeRowsEditor } from '../ui/SizeRowsEditor';
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
  RowActionButton,
  TableSortHead,
  sortRows,
  useTablePage,
  TablePagination,
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
import { Toast, useToast } from '../ui/Toast';
import { useConfirm } from '../ui/ConfirmDialog';
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
    // "Lolos QC" and "Selesai" are different moments: the sheet says which.
    if (spk.status === 'QC Passed' || spk.status === 'Completed') {
      return (
        <Badge variant="done" size="sm" solid={solid}>
          <CheckCircle2 size={12} className="shrink-0" aria-hidden="true" />
          <span>{spk.status === 'Completed' ? 'Selesai' : 'Lolos QC'}</span>
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
  // A fast-path order that is not ready yet reads like any other: "Syarat n/3".
  if (isOptional && readiness?.ready) {
    return (
      <Badge variant="amber" size="sm" solid={solid} className="bg-amber-100 text-amber-800 border-amber-300">
        <Sparkles size={12} className="shrink-0" aria-hidden="true" />
        <span>Jalur cepat</span>
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
  const { toast, showToast } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [orders, setOrders] = useState<Order[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [spks, setSpks] = useState<SPK[]>([]);
  const [designs, setDesigns] = useState<Design[]>([]);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [readinessData, setReadinessData] = useState<ReadinessData>({ payments: [], samples: [], procurements: [] });
  const [loading, setLoading] = useState(true);

  // Filters & Sorting
  const [searchQuery, setSearchQuery] = useState('');
  const [orderStageFilter, setOrderStageFilter] = useState<'ALL' | 'WAITING' | 'IN_PRODUCTION' | 'QC' | 'COMPLETED'>('ALL');
  const [orderSort, setOrderSort] = useState<SortState>({ key: 'newest', direction: 'desc' });

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
  /** What the order was priced at when the form opened; 0 means it never had one. */
  const [originalOrderPrice, setOriginalOrderPrice] = useState(0);
  const [repeatSizeRows, setRepeatSizeRows] = useState<SizeRow[]>([]);
  /*
   * Size charts from the Size Chart page: the factory standards and the
   * charts drawn up for one customer. Picking one fills the size list so the
   * order uses the same labels the pattern room grades against.
   */
  const [sizeCharts, setSizeCharts] = useState<SizeChart[]>([]);
  /** Staff who can be named PIC; the signed-in user is the default. */
  const [staff, setStaff] = useState<StaffDirectoryEntry[]>([]);
  const [chartScope, setChartScope] = useState<'all' | 'standard' | 'customer'>('all');
  const [pickedChartId, setPickedChartId] = useState('');
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

  // DP approval from the WhatsApp proof (see handleOpenApproveDp)
  const [dpApproveOrder, setDpApproveOrder] = useState<Order | null>(null);
  const [dpForm, setDpForm] = useState({ amount: 0, date: '', bankAccount: '', notes: '' });
  const [dpSaving, setDpSaving] = useState(false);
  const [dpError, setDpError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [orderRes, customerRes, spkRes, readinessRes, designRes, sampleRes, invoiceRes, chartRes, staffRes] = await Promise.all([
        fetchResource<Order>('orders'),
        fetchResource<Customer>('customers'),
        fetchResource<SPK>('spk_produksi'),
        fetchReadinessData(),
        fetchResource<Design>('designs'),
        fetchResource<Sample>('samples'),
        fetchResource<Invoice>('invoices'),
        fetchResource<SizeChart>('size-charts'),
        fetchStaffDirectory().catch(() => [] as StaffDirectoryEntry[])
      ]);
      setSizeCharts(chartRes || []);
      setStaff(staffRes || []);
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
   * Every order can be corrected here, whatever it was born from. Orders that
   * came from a quotation also have Revisi Qty, which reissues the penawaran
   * and the faktur as numbered revisions — that stays the right path when the
   * customer agreed to a change. This one is for fixing what was mistyped, and
   * the form says so rather than quietly leaving the quotation behind.
   */
  const canEditOrderInPlace = (order?: Order | null) => !!order?.id;

  /*
   * Every design is offered, this customer's own (and unclaimed ones) first.
   * Filtering to the customer alone hid designs whose customerId did not
   * match — imported orders carry CUST-IMP-… ids while the design was filed
   * under the customer's original id — and the picker looked empty although
   * the Desain page listed the artwork. The label names the owner instead.
   */
  const customerById = (id?: string) => customers.find(c => c.id === id);
  const designOwnerLabel = (d: Design) => {
    if (!d.customerId) return 'belum ada pemilik';
    const owner = customerById(d.customerId);
    return owner ? owner.name || owner.company || d.customerId : d.customerId;
  };
  const designsForPicker = [...designs].sort((a, b) => {
    const rank = (d: Design) => (d.id === repeatFormData.designId ? 0 : d.customerId === repeatCustomerId ? 1 : !d.customerId ? 2 : 3);
    return rank(a) - rank(b) || String(a.name || '').localeCompare(String(b.name || ''), 'id');
  });
  const ownDesignCount = designsForPicker.filter(d => d.customerId === repeatCustomerId || !d.customerId).length;

  /** An order that carries a quotation behind it — its paper trail lives elsewhere. */
  const orderHasQuotation = (order?: Order | null) =>
    !!order && !order.isRepeatOrder && !!order.quotationId;

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

  /** Standards plus the chosen customer's own charts, narrowed by the scope toggle. */
  const availableCharts = sizeCharts.filter(c => {
    const scope = c.scope || 'standard';
    if (scope === 'customer' && c.customerId !== repeatCustomerId) return false;
    return chartScope === 'all' || scope === chartScope;
  });

  /*
   * Picking a chart fills the size list with its labels. Sizes that already
   * carry a quantity keep it, so switching charts mid-entry does not wipe what
   * has been typed.
   */
  const handlePickSizeChart = (chartId: string) => {
    setPickedChartId(chartId);
    const chart = sizeCharts.find(c => c.id === chartId);
    if (!chart) {
      recalcRepeat({ sizeChartId: '', sizeChartName: '' });
      return;
    }
    const existing = new Map(repeatSizeRows.filter(r => r.qty > 0).map(r => [r.size.trim().toUpperCase(), r.qty]));
    // The template travels with the order: the SPK sheet prints its measurements.
    recalcRepeat(
      { sizeChartId: chart.id, sizeChartName: chart.name },
      chart.rows.map(r => ({ size: r.size, qty: existing.get(r.size.trim().toUpperCase()) || 0 }))
    );
  };
  const pickedChart = sizeCharts.find(c => c.id === pickedChartId);

  /*
   * PIC is a named account with its role, so a deal can be traced to a person.
   * The signed-in user is the default; the list comes from the server so it
   * matches Akun & Hak Akses, with the current user added if it is missing.
   */
  const me = getCurrentUser();
  const picChoices: StaffDirectoryEntry[] =
    me && !staff.some(s => s.id === me.id) ? [{ id: me.id, name: me.name, role: String(me.role || '') }, ...staff] : staff;
  const defaultPic = () => (me ? { picUserId: me.id, picName: me.name, picRole: String(me.role || '') } : {});
  const handlePickPic = (userId: string) => {
    const person = picChoices.find(s => s.id === userId);
    setRepeatFormData(prev => ({
      ...prev,
      picUserId: person?.id || '',
      picName: person?.name || '',
      picRole: person?.role || ''
    }));
  };

  /*
   * DP approval. The customer sends the transfer proof over WhatsApp; the
   * order's PIC (or a full admin) confirms it here and the payment is recorded
   * as verified — the same rule the server enforces.
   */
  const isFullAdminUser = !!me && (me.role === 'Super Admin' || !!me.allowedModules?.includes('*'));
  const canApproveDp = (order: Order) => !!me && (isFullAdminUser || (!!order.picUserId && order.picUserId === me.id));
  const dpOutstanding = (order: Order) => Math.max(0, (Number(order.dpRequired) || 0) - (Number(order.downPayment) || 0));
  const defaultBankAccount = COMPANY_CONTACT.bankAccounts[0]
    ? `${COMPANY_CONTACT.bankAccounts[0].bank} ${COMPANY_CONTACT.bankAccounts[0].accountNumber}`
    : '';
  const handleOpenApproveDp = (order: Order) => {
    setDpError(null);
    setDpForm({
      amount: dpOutstanding(order),
      date: new Date().toISOString().split('T')[0],
      bankAccount: defaultBankAccount,
      notes: ''
    });
    setDpApproveOrder(order);
  };
  const handleSubmitApproveDp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dpApproveOrder || dpSaving) return;
    if (!Number(dpForm.amount) || Number(dpForm.amount) <= 0) {
      setDpError('Isi nominal yang diterima.');
      return;
    }
    setDpSaving(true);
    setDpError(null);
    try {
      const result = await approveDpApi(dpApproveOrder.id, {
        amount: Number(dpForm.amount),
        date: dpForm.date,
        bankAccount: dpForm.bankAccount,
        notes: dpForm.notes
      });
      setDpApproveOrder(null);
      await loadData();
      if (result.order) setSelectedOrder(result.order);
      showToast(result.message);
    } catch (err: any) {
      setDpError(err?.message || 'Gagal menyetujui DP. Coba lagi.');
    } finally {
      setDpSaving(false);
    }
  };

  const handleOpenEditOrder = (order: Order) => {
    setRepeatOrderError(null);
    setEditingOrderId(order.id);
    setOriginalOrderPrice(Number(order.price) || 0);
    setRepeatCustomerId(order.customerId || '');
    setSelectedPastOrderId(order.repeatFromOrderId || '');
    setRepeatFormData({
      productType: order.productType,
      material: order.material,
      color: order.color,
      size: order.size,
      sizeChart: order.sizeChart,
      sizeChartId: order.sizeChartId,
      sizeChartName: order.sizeChartName,
      accessories: order.accessories,
      sablonBordir: order.sablonBordir,
      quantity: order.quantity,
      price: order.price,
      // Without these the form opened blank and refused to save until retyped,
      // and custom payment terms were silently replaced by the default 50/50.
      moq: order.moq,
      priceBelowMoq: order.priceBelowMoq,
      paymentSchedule: order.paymentSchedule,
      totalPrice: order.totalPrice,
      downPayment: order.dpRequired,
      deadline: order.deadline,
      needsProcurement: order.needsProcurement,
      notes: order.notes,
      designId: order.designId,
      designName: order.designName,
      designUrl: order.designUrl,
      // Orders from before PICs were named default to whoever edits them.
      ...(order.picUserId
        ? { picUserId: order.picUserId, picName: order.picName, picRole: order.picRole }
        : defaultPic())
    });
    setRepeatSizeRows(parseSizeRows(order.size));
    setPickedChartId(order.sizeChartId || '');
    setChartScope('all');
    setSelectedOrder(null);
    setIsRepeatOrderModalOpen(true);
  };

  const handleOpenRepeatOrderModal = () => {
    setRepeatOrderError(null);
    setEditingOrderId(null);
    setRepeatSizeRows([]);
    setPickedChartId('');
    setChartScope('all');
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
      downPayment: 0,
      ...defaultPic()
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
      const unitPrice = Number(past.price) || 0;
      setPickedChartId(past.sizeChartId || '');
      /*
       * The past order's size rows are the starting point, and the quantity is
       * recomputed from them straight away. Before, the form kept its default
       * 50 pcs beside a size table summing to something else, and saving
       * without touching a row billed and produced the wrong quantity.
       */
      recalcRepeat(
        {
          productType: past.productType,
          material: past.material || '-',
          color: past.color || 'Custom',
          size: past.size || 'All Size',
          sizeChart: past.sizeChart,
          sizeChartId: past.sizeChartId,
          sizeChartName: past.sizeChartName,
          accessories: past.accessories || '-',
          sablonBordir: past.sablonBordir || past.accessories || '-',
          price: unitPrice,
          moq: past.moq || 100,
          priceBelowMoq: past.priceBelowMoq || unitPrice,
          // Agreed terms carry over; amounts are recomputed from the new total.
          paymentSchedule: past.paymentSchedule,
          designId: past.designId,
          designName: past.designName || past.productType,
          // The blank SPK template is not artwork; never carry it over.
          designUrl: past.designUrl && !past.designUrl.startsWith('/templates/') ? past.designUrl : '',
          repeatFromOrderId: past.id,
          isRepeatOrder: true,
          needsSample: false,
          sampleStatus: 'Approved',
          sampleWaivedReferenceOrderId: past.id,
          needsProcurement: past.needsProcurement || 'Perlu Pengadaan',
          notes: `[Repeat Order dari ${past.po || past.id}]. Spesifikasi bahan dan model disamakan.`
        },
        parseSizeRows(past.size)
      );
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
    if (!repeatFormData.picUserId) {
      setRepeatOrderError('Pilih PIC (penanggung jawab) pesanan ini.');
      document.getElementById('ord-pic')?.focus();
      return;
    }
    // The spec comes before the money: the SPK prints this template.
    if (!repeatFormData.sizeChartId) {
      setRepeatOrderError('Pilih template size chart (standar HIJ atau khusus pelanggan). Detail ukurannya dicetak di SPK.');
      document.getElementById('ord-size-chart')?.focus();
      return;
    }
    const qty = Number(repeatFormData.quantity);
    if (!qty || qty <= 0) {
      setRepeatOrderError('Kuantitas repeat order harus lebih besar dari 0.');
      return;
    }
    /*
     * Orders imported from the queue workbook carry no price — that sheet has no
     * price column. Demanding one here would mean inventing a figure just to
     * attach a design, so an order that arrived priceless may stay that way.
     * A brand new manual order still has to be priced.
     */
    const priceOptional = !!editingOrderId && !Number(originalOrderPrice);
    if (!priceOptional && !Number(repeatFormData.price)) {
      setRepeatOrderError('Harga di atas MOQ harus lebih besar dari Rp 0.');
      return;
    }
    if (!priceOptional && !Number(repeatFormData.priceBelowMoq)) {
      setRepeatOrderError('Harga di bawah MOQ harus lebih besar dari Rp 0.');
      return;
    }
    if (!priceOptional && !Number(repeatFormData.moq)) {
      setRepeatOrderError('MOQ harus lebih besar dari 0.');
      return;
    }
    // Small runs cost more per piece: the below-MOQ rate can never undercut the MOQ rate.
    if (Number(repeatFormData.price) > 0 && Number(repeatFormData.priceBelowMoq) > 0 && Number(repeatFormData.priceBelowMoq) < Number(repeatFormData.price)) {
      setRepeatOrderError('Harga di bawah MOQ harus lebih tinggi (atau sama) dari harga di atas MOQ — pesanan kecil lebih mahal per pcs.');
      return;
    }
    if (!priceOptional && !repeatFormData.deadline) {
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
    /*
     * `price` keeps the at-MOQ rate, as quotation-born orders do; the rate that
     * applies to this quantity is derived from it wherever it is shown or
     * billed. Storing the effective rate lost the MOQ rate, and a repeat of a
     * below-MOQ order was then billed the below-MOQ rate at any quantity.
     */
    const unitPrice = effectiveUnitPrice(repeatFormData);
    const moqRate = Number(repeatFormData.price) || unitPrice;

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
        /*
         * The agreed DP and the invoice are only rewritten when something that
         * prices the order changed. Fixing a typo in the colour must not reset
         * a DP the owner negotiated by hand or re-stamp the faktur.
         */
        const original = orders.find(o => o.id === editingOrderId);
        const nextMoq = Number(repeatFormData.moq) || 100;
        const nextBelowMoq = Number(repeatFormData.priceBelowMoq) || Number(repeatFormData.price);
        const scheduleKey = (terms?: PaymentTerm[]) =>
          JSON.stringify((terms || []).map(t => [t.label, Number(t.percentage) || 0]));
        const pricingChanged =
          !original ||
          qty !== Number(original.quantity) ||
          moqRate !== (Number(original.price) || 0) ||
          nextMoq !== (Number(original.moq) || 100) ||
          nextBelowMoq !== (Number(original.priceBelowMoq) || Number(original.price) || 0) ||
          scheduleKey(schedule) !== scheduleKey(original.paymentSchedule);

        const changes = {
          productType: repeatFormData.productType,
          quantity: qty,
          price: moqRate,
          totalPrice: total,
          moq: nextMoq,
          priceBelowMoq: nextBelowMoq,
          ...(pricingChanged ? { paymentSchedule: termsWithAmounts, dpRequired: dpFromTerms } : {}),
          deadline: repeatFormData.deadline,
          material: repeatFormData.material || '-',
          color: repeatFormData.color || 'Custom',
          size: serializeSizeRows(repeatSizeRows) || repeatFormData.size || 'All Size',
          sizeChart: repeatFormData.sizeChart,
          sizeChartId: repeatFormData.sizeChartId || '',
          sizeChartName: repeatFormData.sizeChartName || '',
          picUserId: repeatFormData.picUserId || '',
          picName: repeatFormData.picName || '',
          picRole: repeatFormData.picRole || '',
          accessories: repeatFormData.accessories || '-',
          sablonBordir: repeatFormData.sablonBordir || '-',
          needsProcurement: repeatFormData.needsProcurement || 'Perlu Pengadaan',
          notes: repeatFormData.notes,
          // The chosen design travels with the order; the SPK gate reads it.
          designId: repeatFormData.designId || '',
          designName: repeatFormData.designName || '',
          designUrl: repeatFormData.designUrl || '',
          updatedAt: now.toISOString()
        };
        await updateResource('orders', editingOrderId, changes);

        // Keep the money and the shop floor in step with the new quantity.
        const linkedInvoice = pricingChanged
          ? invoices.find(inv => inv.orderId === editingOrderId && !inv.supersededBy)
          : undefined;
        if (linkedInvoice) {
          const paid = Number(linkedInvoice.downPaymentReceived) || 0;
          const balanceRemaining = Math.max(0, total - paid);
          await updateResource('invoices', linkedInvoice.id, {
            amount: total,
            total,
            balanceRemaining,
            status: total > 0 && balanceRemaining <= 0 ? 'Lunas' : paid > 0 ? 'DP Dibayar' : 'Belum Bayar',
            dueDate: repeatFormData.deadline,
            paymentSchedule: termsWithAmounts
          });
        }
        const linkedSpk = spks.find(spk => spk.orderId === editingOrderId);
        if (linkedSpk) {
          // The cutting list follows the new breakdown, not just its total.
          await updateResource('spk_produksi', linkedSpk.id, {
            targetQty: qty,
            sizeChart: serializeSizeRows(repeatSizeRows) || repeatFormData.size || linkedSpk.sizeChart,
            tanggalSelesai: repeatFormData.deadline
          });
        }

        setIsRepeatOrderModalOpen(false);
        setEditingOrderId(null);
        await loadData();
        const synced = [linkedInvoice ? 'Tagihan' : '', linkedSpk ? 'SPK' : ''].filter(Boolean).join(' dan ');
        showToast(
          `Pesanan ${editingOrderId} diperbarui (${qty} Pcs).${synced ? ` ${synced} terkait ikut disesuaikan.` : ''}`
        );
        return;
      }

      // Highest number in use + 1: counting rows re-issued a deleted order's id.
      const nextNum = nextSequence(orders.map(o => o.id), 'ORD');
      const newOrderId = `ORD-${String(nextNum).padStart(3, '0')}`;
      const clientCode = (cust?.name || 'HIJ').replace(/[^a-zA-Z0-9]/g, '').slice(0, 3).toUpperCase();
      // Random tail: the PO number is typed into public tracking, so it must not be countable.
      const tail = Array.from(crypto.getRandomValues(new Uint8Array(4)), b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
      const newPo = `PO-${clientCode}-REPEAT-${now.getFullYear()}-${String(nextNum).padStart(3, '0')}${tail}`;

      const newOrderPayload: Order = {
        id: newOrderId,
        po: newPo,
        customerId: repeatCustomerId,
        customerName: cust?.name || 'Pelanggan',
        productType: repeatFormData.productType!,
        quantity: qty,
        price: moqRate,
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
        sizeChartId: repeatFormData.sizeChartId || '',
        sizeChartName: repeatFormData.sizeChartName || '',
        picUserId: repeatFormData.picUserId || '',
        picName: repeatFormData.picName || '',
        picRole: repeatFormData.picRole || '',
        accessories: repeatFormData.accessories || '-',
        sablonBordir: repeatFormData.sablonBordir || '-',
        needsProcurement: repeatFormData.needsProcurement || 'Perlu Pengadaan',
        notes: repeatFormData.notes || `Repeat Order dari ${selectedPastOrderId}`,
        timestamp: now.toISOString(),
        user: repeatFormData.picName || me?.name || 'Staf Penjualan',
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
      let invoiceNote = '';
      try {
        const invRes = await authFetch('/api/invoices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
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
          paymentSchedule: termsWithAmounts,
          timestamp: now.toISOString(),
          notes: `Tagihan untuk repeat order ${createdOrder.po || createdOrder.id}`
          })
        });
        if (!invRes.ok) throw new Error();
      } catch (invErr) {
        // The order stands; say so rather than leaving it silently unbilled.
        invoiceNote = ' Draf faktur belum terbuat — buat dari menu Keuangan.';
      }

      setIsRepeatOrderModalOpen(false);
      await loadData();
      showToast(`Pesanan manual Repeat Order ${newOrderPayload.po} (${newOrderPayload.quantity} Pcs) berhasil dibuat!${invoiceNote}`);
    } catch (err: any) {
      setRepeatOrderError(err?.message || 'Gagal membuat pesanan repeat order. Silakan coba lagi.');
    } finally {
      setSavingRepeatOrder(false);
    }
  };

  // Quick Issue SPK Manual for Repeat Order or Qty < 50
  const handleQuickIssueSpk = async (order: Order) => {
    const approved = await confirm({
      title: `Terbitkan SPK manual untuk ${order.po || order.id}?`,
      message: `Pesanan ${order.quantity} pcs ${order.productType} langsung masuk antrean produksi dan tampil di papan SPK lantai jahit.`,
      confirmLabel: 'Terbitkan SPK'
    });
    if (!approved) return;

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
      /*
       * The server's answer is shown as it is. A fallback used to write the SPK
       * straight to the table — or, offline, to a local queue — and report
       * success for an SPK the server had refused or never received.
       */
      showToast(err?.message || 'Gagal menerbitkan SPK manual. Coba lagi.', 'error');
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
  /*
   * Cancelling is the way out for an order that already has an SPK or money on
   * it (delete is refused then). The server refuses once production has
   * started; a queued SPK goes with the cancellation.
   */
  const handleCancelOrder = async (order: Order) => {
    const approved = await confirm({
      title: `Batalkan pesanan ${order.po || order.id}?`,
      message: 'SPK yang masih antre ikut dihapus dan pesanan berhenti diproduksi. Pembayaran yang sudah masuk tetap tercatat di Keuangan.',
      confirmLabel: 'Batalkan Pesanan',
      cancelLabel: 'Kembali',
      tone: 'danger'
    });
    if (!approved) return;
    try {
      const updated = await updateResource<Order>('orders', order.id, { status: 'Cancelled' });
      setSelectedOrder(updated);
      await loadData();
      showToast(`Pesanan ${order.po || order.id} dibatalkan.`);
    } catch (err: any) {
      showToast(err?.message || 'Pesanan tidak bisa dibatalkan.', 'error');
    }
  };

  const handleDeleteOrder = async (id: string) => {
    const approved = await confirm({
      title: `Hapus pesanan ${id}?`,
      message: 'Data pesanan hilang permanen dan tidak bisa dikembalikan. Bila pesanan sudah berjalan, pakai Batalkan supaya riwayatnya tetap tersimpan.',
      confirmLabel: 'Hapus Pesanan',
      tone: 'danger'
    });
    if (!approved) return;
    try {
      await deleteResource('orders', id);
      showToast(`Pesanan ${id} berhasil dihapus.`);
      await loadData();
      if (selectedOrder?.id === id) setSelectedOrder(null);
    } catch (err: any) {
      // e.g. the order already has an SPK or payments — the server says which.
      showToast(err?.message || 'Gagal menghapus pesanan. Coba lagi.', 'error');
    }
  };

  // Invoice Print Modal
  const handleOpenInvoicePrint = (order: Order) => {
    // A superseded revision is history; the live invoice is the one without a successor.
    let inv = invoices.find(i => i.orderId === order.id && !i.supersededBy);
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
  const spkOrderIds = useMemo(() => new Set(spks.map(s => s.orderId)), [spks]);

  const filteredOrders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const rows = orders.filter(item => {
      const matchSearch =
        !q ||
        item.id.toLowerCase().includes(q) ||
        (item.po || '').toLowerCase().includes(q) ||
        (item.customerName || '').toLowerCase().includes(q) ||
        (item.productType || '').toLowerCase().includes(q) ||
        (item.material || '').toLowerCase().includes(q) ||
        (item.picName || '').toLowerCase().includes(q);

      // A queued SPK is already on the floor's list, so it counts as production here.
      const hasSpk = spkOrderIds.has(item.id);
      const matchStage =
        orderStageFilter === 'ALL' ? true :
        orderStageFilter === 'WAITING' ? ((item.status === 'Order' || item.status === 'Sample') && !hasSpk) :
        orderStageFilter === 'IN_PRODUCTION' ? (item.status === 'In Production' || ((item.status === 'Order' || item.status === 'Sample') && hasSpk)) :
        orderStageFilter === 'QC' ? item.status === 'QC' :
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
  }, [orders, spkOrderIds, searchQuery, orderStageFilter, orderSort]);

  const { pageRows: pagedOrders, pagination } = useTablePage(filteredOrders);

  // Order Counts
  const orderCounts = useMemo(() => {
    const pending = (o: Order) => o.status === 'Order' || o.status === 'Sample';
    const waiting = orders.filter(o => pending(o) && !spkOrderIds.has(o.id)).length;
    const inProd = orders.filter(o => o.status === 'In Production' || (pending(o) && spkOrderIds.has(o.id))).length;
    const qc = orders.filter(o => o.status === 'QC').length;
    const completed = orders.filter(o => o.status === 'Shipping' || o.status === 'Completed').length;
    return { all: orders.length, waiting, inProd, qc, completed };
  }, [orders]);

  return (
    <div className="space-y-6">
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
                        <td className="px-3 py-2 text-xs text-muted-foreground">{o.deadline || '—'}</td>
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

      {/* KPI Cards — the four stage buckets add up to the total. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3 sm:gap-4">
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
            <p className="text-xs text-amber-600 font-medium">Menunggu SPK</p>
            <p className="text-2xl font-bold text-foreground">{orderCounts.waiting}</p>
          </div>
        </Card>

        <Card className="p-4 flex items-center gap-3 bg-linear-to-br from-card to-blue-500/5 border-blue-500/20">
          <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-500">
            <CalendarClock size={20} />
          </div>
          <div>
            <p className="text-xs text-blue-600 font-medium">Sedang Produksi</p>
            <p className="text-2xl font-bold text-foreground">{orderCounts.inProd}</p>
          </div>
        </Card>

        <Card className="p-4 flex items-center gap-3 bg-linear-to-br from-card to-violet-500/5 border-violet-500/20">
          <div className="p-2.5 rounded-xl bg-violet-500/10 text-violet-500">
            <ClipboardList size={20} />
          </div>
          <div>
            <p className="text-xs text-violet-600 font-medium">Tahap QC</p>
            <p className="text-2xl font-bold text-foreground">{orderCounts.qc}</p>
          </div>
        </Card>

        <Card className="p-4 flex items-center gap-3 bg-linear-to-br from-card to-emerald-500/5 border-emerald-500/20">
          <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-500">
            <CheckCircle2 size={20} />
          </div>
          <div>
            <p className="text-xs text-emerald-600 font-medium">Siap Kirim / Selesai</p>
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
              onClick={() => setOrderStageFilter('QC')}
              className={cn(
                "px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all",
                orderStageFilter === 'QC'
                  ? "bg-violet-500 text-white shadow-xs"
                  : "bg-muted/40 hover:bg-muted text-muted-foreground"
              )}
            >
              QC ({orderCounts.qc})
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
                <TableSortHead
                  sortKey="customerName"
                  sort={orderSort}
                  onSortChange={setOrderSort}
                  className="hidden md:table-cell"
                >
                  Pelanggan
                </TableSortHead>
                <TableHead className="hidden min-[1700px]:table-cell">Produk</TableHead>
                <TableSortHead
                  sortKey="quantity"
                  sort={orderSort}
                  onSortChange={setOrderSort}
                  align="right"
                  className="hidden sm:table-cell"
                >
                  Qty
                </TableSortHead>
                <TableHead className="hidden min-[2000px]:table-cell text-right">Harga Satuan</TableHead>
                <TableSortHead
                  sortKey="totalPrice"
                  sort={orderSort}
                  onSortChange={setOrderSort}
                  align="right"
                  className="hidden sm:table-cell"
                >
                  Nilai Pesanan
                </TableSortHead>
                <TableSortHead
                  sortKey="deadline"
                  sort={orderSort}
                  onSortChange={setOrderSort}
                  className="hidden lg:table-cell"
                >
                  Deadline
                </TableSortHead>
                {/*
                  * SPK status is what the sales desk chases day to day, so it is
                  * always visible. The order status (which now follows QC,
                  * shipping and payment through to Selesai) joins it from xl and
                  * is always in Detail.
                  */}
                <TableHead className="text-center">Status SPK</TableHead>
                <TableSortHead
                  sortKey="status"
                  sort={orderSort}
                  onSortChange={setOrderSort}
                  align="center"
                  className="hidden min-[1700px]:table-cell"
                >
                  Status
                </TableSortHead>
                <TableHead className="cell-sticky-end text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && orders.length === 0 ? (
                <TableSkeletonRows columns={10} />
              ) : filteredOrders.length === 0 ? (
                <TableEmptyRow
                  colSpan={10}
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
                pagedOrders.map(order => {
                const matchingSpk = spks.find(s => s.orderId === order.id);
                const readiness = readinessByOrder.get(order.id);
                const isOptional = isSpkOptionalForOrder(order);

                return (
                  <TableRow key={order.id}>
                    <TableCell className="cell-sticky-start whitespace-nowrap font-mono font-semibold text-foreground">
                      {order.po || order.id}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <span className="block max-w-[150px] truncate font-medium text-foreground" title={order.customerName}>
                        {order.customerName}
                      </span>
                    </TableCell>
                    <TableCell className="hidden min-[1700px]:table-cell text-muted-foreground">
                      <span className="block max-w-[150px] truncate" title={order.productType}>
                        {order.productType}
                      </span>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-right whitespace-nowrap tabular-nums font-semibold text-foreground">
                      {order.quantity}
                    </TableCell>
                    <TableCell className="hidden min-[2000px]:table-cell text-right whitespace-nowrap tabular-nums text-muted-foreground">
                      {effectiveUnitPrice(order) > 0 ? formatCurrency(effectiveUnitPrice(order)) : <span className="text-muted-foreground/60">&mdash;</span>}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-right whitespace-nowrap tabular-nums font-bold text-foreground">
                      {Number(order.totalPrice) > 0
                        ? formatCurrency(order.totalPrice)
                        : <span className="font-normal text-muted-foreground/60">Belum diisi</span>}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell whitespace-nowrap">
                      {order.deadline
                        ? <DeadlineBadge deadline={order.deadline} completed={order.status === 'Completed'} />
                        : <span className="text-muted-foreground/60">&mdash;</span>}
                    </TableCell>
                    <TableCell className="text-center whitespace-nowrap">
                      <SpkStatusTag spk={matchingSpk} readiness={readiness} order={order} solid />
                    </TableCell>
                    <TableCell className="hidden min-[1700px]:table-cell text-center whitespace-nowrap">
                      <StatusBadge status={order.status} size="sm" solid />
                    </TableCell>
                    <TableCell className="cell-sticky-end text-right">
                      <TableRowActions>
                        {/*
                          * DP is chased from this list: the button both marks an order
                          * still waiting for its DP and records it. Icon only, like the
                          * other row actions; the tooltip carries the amount.
                          */}
                        {Number(order.dpRequired) > 0 && dpOutstanding(order) > 0 && (
                          <RowActionButton
                            tone="primary"
                            icon={BadgeCheck}
                            label="Setujui DP"
                            ariaLabel={`Setujui DP ${order.po || order.id}`}
                            title={
                              canApproveDp(order)
                                ? `Setujui DP: bukti transfer diterima via WhatsApp? Catat sisa DP ${formatCurrency(dpOutstanding(order))}.`
                                : order.picName
                                  ? `Hanya PIC pesanan ini (${order.picName}) atau Super Admin yang bisa menyetujui DP.`
                                  : 'Pesanan ini belum punya PIC. Pilih PIC lewat Ubah Pesanan.'
                            }
                            disabled={!canApproveDp(order)}
                            onClick={() => handleOpenApproveDp(order)}
                          />
                        )}
                        {!matchingSpk && isOptional && readiness?.ready && (
                          <RowActionButton
                            tone="primary"
                            icon={CalendarClock}
                            label="Terbitkan SPK"
                            ariaLabel={`Terbitkan SPK manual untuk ${order.po || order.id}`}
                            title="Terbitkan SPK jalur cepat (repeat order / di bawah 50 pcs, desain sudah ACC)"
                            disabled={issuingSpkId === order.id}
                            onClick={() => handleQuickIssueSpk(order)}
                          />
                        )}
                        {/* Both are also in the Detail footer; on phones the status needs the room. */}
                        <RowActionButton
                          icon={Printer}
                          label="Cetak invoice"
                          ariaLabel={`Cetak invoice ${order.po || order.id}`}
                          title="Cetak invoice pesanan"
                          onClick={() => handleOpenInvoicePrint(order)}
                          className="hidden sm:inline-flex"
                        />
                        <RowActionButton
                          icon={Pencil}
                          label="Ubah"
                          ariaLabel={`Ubah pesanan ${order.po || order.id}`}
                          title="Ubah pesanan"
                          onClick={() => handleOpenEditOrder(order)}
                          className="hidden sm:inline-flex"
                        />
                        {/*
                          * Deleting an order is kept inside Detail on purpose: it sits one
                          * click from Ubah/Cetak here, and an order carries invoices and
                          * an SPK behind it — removal should follow a look at the record.
                          */}
                        <RowDetailButton label={order.po || order.id} onClick={() => setSelectedOrder(order)} />
                      </TableRowActions>
                    </TableCell>
                  </TableRow>
                );
                })
              )}
            </TableBody>
          </Table>
          <TablePagination {...pagination} label="pesanan" />
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
              {!['Cancelled', 'Shipping', 'Completed'].includes(selectedOrder.status) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleCancelOrder(selectedOrder)}
                  className="text-rose-600 hover:bg-rose-50 hover:border-rose-300"
                  title="Pesanan batal sebelum produksi mulai. Setelah potong/jahit tercatat, pembatalan ditolak."
                >
                  <Ban size={14} aria-hidden="true" /> Batalkan Pesanan
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => handleOpenInvoicePrint(selectedOrder)}>
                <Printer size={14} aria-hidden="true" /> Cetak Invoice
              </Button>
              {selectedOrder.status !== 'Cancelled' && Number(selectedOrder.dpRequired) > 0 && dpOutstanding(selectedOrder) > 0 && (
                <Button
                  size="sm"
                  onClick={() => handleOpenApproveDp(selectedOrder)}
                  disabled={!canApproveDp(selectedOrder)}
                  title={
                    canApproveDp(selectedOrder)
                      ? 'Bukti transfer sudah diterima via WhatsApp? Catat DP sebagai terverifikasi.'
                      : selectedOrder.picName
                        ? `Hanya PIC pesanan ini (${selectedOrder.picName}) atau Super Admin yang bisa menyetujui DP.`
                        : 'Pesanan ini belum punya PIC. Pilih PIC lewat Ubah Pesanan.'
                  }
                >
                  <BadgeCheck size={14} aria-hidden="true" /> Setujui DP
                </Button>
              )}
              {canEditOrderInPlace(selectedOrder) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleOpenEditOrder(selectedOrder)}
                  title={
                    orderHasQuotation(selectedOrder)
                      ? 'Perbaiki isi pesanan. Untuk perubahan yang disepakati pelanggan, pakai Revisi Qty di Surat Penawaran.'
                      : 'Perbaiki isi pesanan ini.'
                  }
                >
                  <Pencil size={14} aria-hidden="true" /> Ubah Pesanan
                </Button>
              )}
              {!selectedSpk && isSpkOptionalForOrder(selectedOrder) && selectedReadiness?.ready && (
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
                isQcPassed={['QC', 'Shipping', 'Completed'].includes(selectedOrder.status)}
                isShipped={selectedOrder.status === 'Shipping' || selectedOrder.status === 'Completed'}
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
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 space-y-1.5 text-xs text-amber-900">
                <p className="font-semibold flex items-center gap-1.5">
                  <Sparkles size={14} className="text-amber-600" />
                  Jalur cepat SPK ({selectedOrder.isRepeatOrder ? 'Repeat Order' : 'Kuantitas < 50 pcs'})
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {selectedReadiness?.ready
                    ? 'DP dan sampel tidak menahan SPK jalur cepat. Desain sudah disetujui, jadi SPK bisa diterbitkan sekarang.'
                    : 'DP dan sampel tidak menahan SPK jalur cepat, tapi desainnya harus sudah disetujui. Lampirkan dan setujui desain di menu Desain & Sampel dulu.'}
                </p>
                {selectedReadiness?.ready && (
                  <Button size="sm" onClick={() => handleQuickIssueSpk(selectedOrder)}>
                    <CalendarClock size={12} /> Buat SPK Manual Sekarang
                  </Button>
                )}
              </div>
            )}

            <DetailSection title="Rincian Pesanan">
              <DetailField label="Status pesanan">
                <StatusBadge status={selectedOrder.status} />
              </DetailField>
              <DetailField label="PIC">
                {selectedOrder.picName
                  ? `${selectedOrder.picName}${selectedOrder.picRole ? ` (${selectedOrder.picRole})` : ''}`
                  : selectedOrder.user || '-'}
              </DetailField>
              {selectedOrder.dpApprovedBy && (
                <DetailField label="DP disetujui">
                  {selectedOrder.dpApprovedBy}
                  {selectedOrder.dpApprovedAt ? ` · ${formatDateTime(selectedOrder.dpApprovedAt)}` : ''}
                </DetailField>
              )}
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
              <DetailField label="Template size chart">
                {selectedOrder.sizeChartName || selectedOrder.sizeChartId || 'Belum dipilih'}
              </DetailField>
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
              <DetailField label="Harga satuan">{formatCurrency(effectiveUnitPrice(selectedOrder))}</DetailField>
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
                    ? 'Catatan: Pesanan ini jalur cepat — DP dan sampel tidak menahan SPK; SPK tetap wajib terbit dengan desain yang sudah disetujui dan template size chart.'
                    : 'Hanya DP dan desain yang menahan penerbitan SPK. Bahan baku ditampilkan sebagai informasi — produksi boleh jalan sambil bahan menyusul. Terbitkan SPK di halaman Surat Perintah Kerja.'}
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
            ? 'Ubah kuantitas, harga, spesifikasi, atau deadline pesanan ini.'
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

          {editingOrderId && orderHasQuotation(orders.find(o => o.id === editingOrderId)) && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-900">
              <p className="font-semibold">
                Pesanan ini lahir dari penawaran {orders.find(o => o.id === editingOrderId)?.quotationId}.
              </p>
              <p className="mt-1 text-[11px]">
                Perubahan di sini memperbarui pesanan dan tagihannya, tapi <b>tidak menerbitkan revisi
                penawaran</b>. Kalau pelanggan menyetujui perubahan jumlah atau harga, pakai
                <b> Revisi Qty</b> di Surat Penawaran supaya penawaran dan faktur terbit ulang bernomor
                revisi. Pakai form ini untuk membetulkan salah ketik.
              </p>
            </div>
          )}

          {editingOrderId && spks.some(spk => spk.orderId === editingOrderId) && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-900">
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

          <FormSection title="Penanggung jawab (PIC)">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="ord-pic" className="block text-xs font-semibold text-foreground mb-1">
                  PIC pesanan <span className="text-rose-500">*</span>
                </label>
                <Select id="ord-pic" value={repeatFormData.picUserId || ''} onChange={e => handlePickPic(e.target.value)} required>
                  <option value="">-- Pilih PIC --</option>
                  {picChoices.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name}{s.role ? ` · ${s.role}` : ''}
                    </option>
                  ))}
                </Select>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Akun staf yang bertanggung jawab atas pesanan ini; tampil di tabel dan detail agar mudah dilacak.
                </p>
              </div>
            </div>
          </FormSection>

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
                  <p className="mt-1 text-xs text-amber-600">
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

                {/*
                  * A manual order has no quotation behind it, so nothing attaches a
                  * design on its way in. The SPK gate needs one, so it is chosen here.
                  */}
                <div className="mt-3">
                  <label htmlFor="ord-design" className="block text-xs font-semibold text-foreground mb-1">
                    Desain yang dipakai
                  </label>
                  <Select
                    id="ord-design"
                    value={repeatFormData.designId || ''}
                    onChange={e => {
                      const picked = designs.find(d => d.id === e.target.value);
                      setRepeatFormData(prev => ({
                        ...prev,
                        designId: picked?.id || '',
                        designName: picked?.name || '',
                        // The blank SPK template is not artwork; never carry it over.
                        designUrl: [picked?.mockupFront, picked?.mockupBack].find(
                          url => !!url && !url.startsWith('/templates/')
                        ) || ''
                      }));
                    }}
                  >
                    <option value="">Belum memilih desain</option>
                    {designsForPicker.map((d, index) => (
                      <React.Fragment key={d.id}>
                        {index === ownDesignCount && ownDesignCount < designsForPicker.length && (
                          <option disabled value="">── desain pelanggan lain ──</option>
                        )}
                        <option value={d.id}>
                          {d.id} · {d.name} · {designOwnerLabel(d)}
                          {d.status === 'Approved' ? ' · disetujui' : ` · ${statusLabel(d.status)}`}
                        </option>
                      </React.Fragment>
                    ))}
                  </Select>
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    SPK baru bisa terbit setelah pesanan punya desain yang <b>sudah disetujui</b>.
                    Belum ada desainnya? Buat dulu di menu <b>Desain &amp; Sampel</b>, lalu pilih di sini.
                  </p>
                </div>

                {repeatFormData.designUrl ? (
                  <div className="mt-2 flex items-center gap-3 p-2.5 rounded-xl border border-border bg-muted/20">
                    <img
                      src={repeatFormData.designUrl}
                      alt="Mockup acuan"
                      className="size-12 rounded-lg border border-border bg-white object-contain p-0.5"
                      onError={e => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }}
                    />
                    <div className="min-w-0 text-xs">
                      <p className="font-semibold text-foreground">
                        {repeatFormData.designName || 'Mockup acuan'}
                      </p>
                      <p className="text-muted-foreground text-[11px] truncate">
                        Gambar ini yang tercetak di surat SPK.
                      </p>
                    </div>
                  </div>
                ) : repeatFormData.designId ? (
                  <div className="mt-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-900">
                    Desain ini belum punya gambar mockup. Unggah dulu di Desain &amp; Sampel &mdash;
                    tanpa gambar, desain tidak bisa disetujui dan SPK tidak bisa terbit.
                  </div>
                ) : null}
              </FormSection>

                <div className="mt-3">
                  <label htmlFor="ord-size-chart" className="block text-xs font-semibold text-foreground mb-1">
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
                        id="ord-size-chart"
                        aria-label="Template size chart"
                        required
                        value={pickedChartId}
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
                  <p className="mb-2 text-[11px] text-muted-foreground">
                    {chartScope === 'customer' && !repeatCustomerId
                      ? 'Pilih pelanggan dulu untuk melihat size chart khususnya.'
                      : chartScope === 'customer' && availableCharts.length === 0
                        ? 'Pelanggan ini belum punya size chart khusus. Buat di menu Size Chart, atau pakai standar HIJ.'
                        : pickedChart
                          ? `Dicetak di SPK persis seperti di halaman Size Chart — kolom ${pickedChart.measurements.map(m => m.code || m.label).join(', ') || '-'}; ukuran ${pickedChart.rows.map(r => r.size).join(', ') || '-'}. Jumlah pcs per ukuran diisi di tabel bawah.`
                          : 'Wajib dipilih: detail ukuran template ini dicetak di SPK. Jumlah pcs per ukuran diisi di tabel bawah.'}
                  </p>
                  <SizeRowsEditor
                    rows={repeatSizeRows}
                    onChange={rows => recalcRepeat({}, rows)}
                    caption="Jumlah pcs per ukuran untuk pesanan ini"
                    hint="Kuantitas pesanan mengikuti total tabel ini."
                    idPrefix="ord-size"
                  />
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
                      Harga di Atas MOQ (Rp) <span className="text-rose-500">*</span>
                    </label>
                    <Input
                      type="number"
                      min={0}
                      value={repeatFormData.price || ''}
                      onChange={e => recalcRepeat({ price: Number(e.target.value) || 0 })}
                      required
                    />
                    <span className="mt-1 block text-[11px] text-muted-foreground">Dipakai bila jumlah &ge; MOQ — lebih murah per pcs.</span>
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
                    <span className="mt-1 block text-[11px] text-muted-foreground">Dipakai bila jumlah &lt; MOQ — lebih mahal per pcs.</span>
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
                      {' — '}
                      {isBelowMoq(repeatFormData) ? 'memakai harga di bawah MOQ' : 'memakai harga di atas MOQ'}
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
        isOpen={!!dpApproveOrder}
        onClose={() => (dpSaving ? undefined : setDpApproveOrder(null))}
        title={`Setujui DP ${dpApproveOrder?.po || dpApproveOrder?.id || ''}`}
        subtitle="Bukti transfer diterima via WhatsApp. Setelah disetujui, DP tercatat terverifikasi di Keuangan dan syarat SPK terpenuhi."
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDpApproveOrder(null)} disabled={dpSaving}>
              Batal
            </Button>
            <Button type="submit" form="approve-dp-form" disabled={dpSaving}>
              <BadgeCheck size={16} aria-hidden="true" />
              {dpSaving ? 'Menyimpan…' : 'Setujui & Catat DP'}
            </Button>
          </div>
        }
      >
        {dpApproveOrder && (
          <form id="approve-dp-form" onSubmit={handleSubmitApproveDp} className="space-y-4">
            <FormError>{dpError}</FormError>
            <FormNotice title="Ringkasan DP pesanan ini">
              <span className="font-semibold">{dpApproveOrder.customerName}</span> · DP disepakati{' '}
              <span className="font-semibold tabular-nums">{formatCurrency(dpApproveOrder.dpRequired || 0)}</span>, sudah diterima{' '}
              <span className="font-semibold tabular-nums">{formatCurrency(dpApproveOrder.downPayment || 0)}</span>, sisa{' '}
              <span className="font-semibold tabular-nums">{formatCurrency(dpOutstanding(dpApproveOrder))}</span>.
              <span className="block text-xs text-muted-foreground mt-1">
                Disetujui oleh {me?.name || '-'}{me?.role ? ` (${me.role})` : ''}.
              </span>
            </FormNotice>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <FieldLabel htmlFor="dp-amount" required>Nominal diterima</FieldLabel>
                <CurrencyInput
                  id="dp-amount"
                  value={dpForm.amount || ''}
                  onChange={e => setDpForm(prev => ({ ...prev, amount: Number(e.target.value) || 0 }))}
                />
                <FieldHint>Sesuai bukti transfer yang dikirim pelanggan.</FieldHint>
              </div>
              <div>
                <FieldLabel htmlFor="dp-date" required>Tanggal transfer</FieldLabel>
                <Input
                  id="dp-date"
                  type="date"
                  value={dpForm.date}
                  onChange={e => setDpForm(prev => ({ ...prev, date: e.target.value }))}
                />
              </div>
              <div>
                <FieldLabel htmlFor="dp-bank">Rekening tujuan</FieldLabel>
                <Select
                  id="dp-bank"
                  value={dpForm.bankAccount}
                  onChange={e => setDpForm(prev => ({ ...prev, bankAccount: e.target.value }))}
                >
                  {COMPANY_CONTACT.bankAccounts.map(acc => (
                    <option key={acc.accountNumber} value={`${acc.bank} ${acc.accountNumber}`}>
                      {acc.bank} {acc.accountNumber} · {acc.accountName}
                    </option>
                  ))}
                  <option value="Transfer lain">Rekening / metode lain</option>
                </Select>
              </div>
              <div>
                <FieldLabel htmlFor="dp-notes" aside="Opsional">Catatan</FieldLabel>
                <Textarea
                  id="dp-notes"
                  rows={2}
                  value={dpForm.notes}
                  onChange={e => setDpForm(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="Mis. nama pengirim di bukti transfer"
                />
              </div>
            </div>
          </form>
        )}
      </Modal>

      <Modal
        isOpen={!!printInvoice}
        onClose={() => setPrintInvoice(null)}
        title={
          printInvoice?.id.startsWith('INV-AUTO-')
            ? 'PRATINJAU — belum diterbitkan'
            : `Invoice ${printInvoice?.invoiceNo || printInvoice?.id || ''}`
        }
        subtitle={
          printInvoice?.id.startsWith('INV-AUTO-')
            ? 'Pesanan ini belum punya faktur. Angka di bawah dihitung dari pesanan; terbitkan fakturnya dari menu Keuangan.'
            : 'Dokumen A4 resmi di atas kop surat HIJ.'
        }
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

      <Toast toast={toast} />
      {confirmDialog}
    </div>
  );
};
