import React, { useState, useEffect, useMemo } from 'react';
import {
  Search,
  Filter,
  Printer,
  Factory,
  Download,
  Edit,
  CheckCircle2,
  Circle,
  AlertTriangle,
  Loader2,
  Users,
  Trash2,
  Plus
} from 'lucide-react';
import { SPK, Order, InventoryItem, Operator, WorkAssignment, ProductionTask, PRODUCTION_TASKS } from '../../types';
import { fetchResource, createResource, updateResource, deleteResource, fetchReadinessData, issueSpkApi } from '../../services/api';
import { formatDate, formatCurrency, exportTableToExcel, statusLabel, todayLocal } from '../../lib/utils';
import {
  getOrderReadiness,
  ordersAwaitingSpk,
  canApproveSpecialTerms,
  isSpkOptionalForOrder,
  ReadinessData,
  RequirementKey,
  RequirementStatus
} from '../../lib/readiness';
import { getCurrentUser } from '../../lib/session';
import { Badge, StatusBadge, DeadlineBadge } from '../ui/Badge';
import { Modal } from '../ui/Modal';
import { exportTwoPageSPK } from '../../services/pdfGenerator';
import { SpkDocument } from '../documents/SpkDocument';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import {
  FieldLabel,
  FieldHint,
  FieldError,
  FormError,
  FormNotice,
  Select,
  Textarea
} from '../ui/Field';
import { PageHeader } from '../ui/PageHeader';
import { OrderFlowStepper } from '../ui/OrderFlowStepper';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableRowActions,
  TableEmptyRow,
  TableSkeletonRows,
  TableSortHead,
  sortRows,
  type SortState
} from '../ui/Table';
import {
  DetailDrawer,
  DetailSection,
  DetailField,
  RowDetailButton
} from '../ui/DetailDrawer';

export const PPICModule: React.FC = () => {
  const [spks, setSpks] = useState<SPK[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [detailSpk, setDetailSpk] = useState<SPK | null>(null);
  const [detailAwaiting, setDetailAwaiting] = useState<Order | null>(null);
  const [spkSort, setSpkSort] = useState<SortState>({ key: 'newest', direction: 'desc' });

  // Edit Progress Modal
  const [selectedSpk, setSelectedSpk] = useState<SPK | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editFormData, setEditFormData] = useState<Partial<SPK>>({});

  /*
   * Who worked on this SPK. Recorded here because this is where production
   * happens; payroll adds these up instead of asking for the numbers twice.
   */
  const [operators, setOperators] = useState<Operator[]>([]);
  const [assignments, setAssignments] = useState<WorkAssignment[]>([]);
  const [workerSpk, setWorkerSpk] = useState<SPK | null>(null);
  const [workerError, setWorkerError] = useState<string | null>(null);
  const [savingWorker, setSavingWorker] = useState(false);
  /*
   * The rate is typed per record, not read from the operator. Piece rates move
   * with how hard a particular job is, and nobody here is tied to one task —
   * the same person may cut today and sew tomorrow at a different rate.
   */
  const [workerForm, setWorkerForm] = useState<{
    task: ProductionTask;
    operatorId: string;
    qty: number;
    rate: number;
    date: string;
  }>({
    task: 'Jahit',
    operatorId: '',
    qty: 0,
    rate: 0,
    date: todayLocal()
  });

  // Print Preview Modal
  const [printSpk, setPrintSpk] = useState<SPK | null>(null);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  // Orders awaiting SPK (SOP-03): requirement data and actions
  const [readinessData, setReadinessData] = useState<ReadinessData>({
    payments: [],
    samples: [],
    procurements: [],
    patterns: []
  });
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [savingOrderId, setSavingOrderId] = useState<string | null>(null);

  const [waiveOrder, setWaiveOrder] = useState<Order | null>(null);
  const [waiveRefOrderId, setWaiveRefOrderId] = useState('');

  const [materialOrder, setMaterialOrder] = useState<Order | null>(null);

  const [issueOrder, setIssueOrder] = useState<Order | null>(null);
  const [issueStart, setIssueStart] = useState('');
  const [issueNotes, setIssueNotes] = useState('');
  const [issuing, setIssuing] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [savingProgress, setSavingProgress] = useState(false);
  const [progressError, setProgressError] = useState<string | null>(null);
  const [progressFieldErrors, setProgressFieldErrors] = useState<Record<string, string>>({});
  const [savingWaive, setSavingWaive] = useState(false);
  const [waiveError, setWaiveError] = useState<string | null>(null);
  const [confirmingMaterial, setConfirmingMaterial] = useState(false);
  const [materialError, setMaterialError] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const assignmentsFor = (spkId: string) => assignments.filter(a => a.spkId === spkId);

  /*
   * Progress is the sum of work people actually finished, not a quota booked in
   * advance. Each SPK stage reads the matching task on the worker records, so
   * the progress figure and the payroll figure can never drift apart.
   *
   * Returns null while an SPK has no worker records yet — those SPKs keep the
   * numbers that were typed before this existed instead of being reset to zero.
   */
  const stagesFromWork = (rows: WorkAssignment[], targetQty: number) => {
    if (rows.length === 0) return null;
    const cap = (n: number) => (targetQty > 0 ? Math.min(n, targetQty) : n);
    const sum = (task: ProductionTask) =>
      rows.filter(r => r.task === task).reduce((total, r) => total + (Number(r.qty) || 0), 0);
    return {
      cutting: cap(sum('Cutting')),
      sewing: cap(sum('Jahit')),
      finishing: cap(sum('Finishing')),
      qc: cap(sum('QC'))
    };
  };

  // Same arithmetic the manual form uses, so an SPK reads the same either way.
  const progressFromStages = (
    stages: { cutting: number; sewing: number; finishing: number; qc: number },
    targetQty: number
  ) => {
    const pct = Math.round(
      ((stages.cutting + stages.sewing + stages.finishing + stages.qc) / ((targetQty || 1) * 4)) * 100
    );
    const progress = Math.min(100, Math.max(0, Number.isFinite(pct) ? pct : 0));
    return {
      progress,
      status: (progress >= 100 ? 'Completed' : progress >= 75 ? 'QC Passed' : 'In Progress') as SPK['status']
    };
  };

  /** Push the stage figures a worker record implies back onto the SPK. */
  const syncSpkProgress = async (spk: SPK, rows: WorkAssignment[]) => {
    const stages = stagesFromWork(rows, spk.targetQty);
    if (!stages) return;
    await updateResource('spk_produksi', spk.id, { ...stages, ...progressFromStages(stages, spk.targetQty) });
  };

  const handleOpenWorkers = (spk: SPK) => {
    setWorkerSpk(spk);
    setWorkerError(null);
    setWorkerForm({
      task: 'Jahit',
      operatorId: '',
      qty: 0,
      rate: 0,
      date: todayLocal()
    });
  };

  const handleAddAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workerSpk || savingWorker) return;

    const operator = operators.find(o => o.id === workerForm.operatorId);
    if (!operator) {
      setWorkerError('Pilih petugas yang mengerjakan.');
      return;
    }
    if (!(workerForm.qty > 0)) {
      setWorkerError('Jumlah pcs harus lebih besar dari 0.');
      return;
    }
    if (!(workerForm.rate > 0)) {
      setWorkerError('Isi tarif borongan untuk pekerjaan ini.');
      return;
    }

    try {
      setSavingWorker(true);
      setWorkerError(null);
      const record = {
        id: `WRK-${Date.now().toString(36).toUpperCase()}`,
        spkId: workerSpk.id,
        orderId: workerSpk.orderId,
        productName: workerSpk.productName,
        task: workerForm.task,
        operatorId: operator.id,
        operatorName: operator.name,
        qty: Number(workerForm.qty),
        // The rate agreed for this job, kept on the record so later changes
        // never rewrite what past work was worth.
        ratePerPiece: Number(workerForm.rate) || 0,
        date: workerForm.date,
        user: getCurrentUser()?.name,
        timestamp: new Date().toISOString()
      } as WorkAssignment;

      await createResource<WorkAssignment>('work-assignments', record);
      // Progress follows the record immediately; nobody has to retype it.
      await syncSpkProgress(workerSpk, [...assignmentsFor(workerSpk.id), record]);
      setWorkerForm(prev => ({ ...prev, operatorId: '', qty: 0, rate: 0 }));
      await loadData();
    } catch (err: any) {
      setWorkerError(err?.message || 'Gagal menyimpan petugas. Coba lagi.');
    } finally {
      setSavingWorker(false);
    }
  };

  const handleRemoveAssignment = async (assignment: WorkAssignment) => {
    if (!window.confirm(`Hapus catatan ${assignment.operatorName} (${assignment.task}, ${assignment.qty} pcs)?`)) return;
    try {
      await deleteResource('work-assignments', assignment.id);
      if (workerSpk) {
        await syncSpkProgress(workerSpk, assignmentsFor(workerSpk.id).filter(a => a.id !== assignment.id));
      }
      await loadData();
    } catch {
      setWorkerError('Gagal menghapus catatan. Coba lagi.');
    }
  };

  const currentUser = getCurrentUser();
  const canApproveTerms = canApproveSpecialTerms(currentUser?.role);

  const loadData = async () => {
    try {
      setLoading(true);
      const [spkRes, orderRes, readinessRes, inventoryRes, operatorRes, assignmentRes] = await Promise.all([
        fetchResource<SPK>('spk_produksi'),
        fetchResource<Order>('orders'),
        fetchReadinessData(),
        fetchResource<InventoryItem>('raw-materials'),
        fetchResource<Operator>('operators'),
        fetchResource<WorkAssignment>('work-assignments')
      ]);
      setSpks(spkRes);
      setOrders(orderRes);
      setReadinessData(readinessRes);
      setInventory(inventoryRes);
      setOperators(operatorRes || []);
      setAssignments(assignmentRes || []);
    } catch (err) {
      console.error('Failed to load SPKs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const today = () => new Date().toISOString().split('T')[0];

  const awaitingOrders = useMemo(() => ordersAwaitingSpk(orders, spks), [orders, spks]);

  const lowStockItems = useMemo(
    () =>
      inventory.filter(item =>
        item.stock !== undefined &&
        item.minStock !== undefined &&
        !isNaN(Number(item.stock)) &&
        !isNaN(Number(item.minStock)) &&
        Number(item.stock) <= Number(item.minStock)
      ),
    [inventory]
  );

  const updateOrderFields = async (order: Order, fields: Partial<Order>, successMsg: string) => {
    try {
      setSavingOrderId(order.id);
      await updateResource('orders', order.id, fields);
      showToast(successMsg);
      await loadData();
    } catch (err) {
      alert('Gagal menyimpan perubahan pesanan. Coba lagi.');
    } finally {
      setSavingOrderId(null);
    }
  };

  const handleApproveSpecialTerms = (order: Order) => {
    if (!window.confirm(`Setujui termin khusus untuk ${order.id}? Produksi boleh dimulai sebelum DP diterima.`)) return;
    updateOrderFields(
      order,
      { specialTermsApprovedBy: currentUser?.name || 'Owner', specialTermsApprovedAt: new Date().toISOString() },
      `Termin khusus untuk ${order.id} disetujui.`
    );
  };

  const handleUndoConfirmation = (order: Order, key: RequirementKey) => {
    if (!window.confirm(`Batalkan konfirmasi untuk ${order.id}?`)) return;
    const fields: Partial<Order> =
      key === 'dp'
        ? { specialTermsApprovedBy: '', specialTermsApprovedAt: '' }
        : key === 'sample'
          ? { sampleWaivedReferenceOrderId: '', sampleWaivedBy: '', sampleWaivedAt: '' }
          : { materialConfirmedBy: '', materialConfirmedAt: '' };
    updateOrderFields(order, fields, 'Konfirmasi dibatalkan.');
  };

  const handleOpenWaive = (order: Order) => {
    setWaiveOrder(order);
    setWaiveRefOrderId('');
    setWaiveError(null);
  };

  const handleSubmitWaive = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!waiveOrder || savingWaive) return;
    if (!waiveRefOrderId) {
      setWaiveError('Pilih pesanan sebelumnya yang jadi acuan repeat order.');
      document.getElementById('ppic-waive-ref-order')?.focus();
      return;
    }
    const order = waiveOrder;
    setWaiveError(null);
    setSavingWaive(true);
    try {
      await updateOrderFields(
        order,
        {
          sampleWaivedReferenceOrderId: waiveRefOrderId,
          sampleWaivedBy: currentUser?.name || 'PPIC',
          sampleWaivedAt: new Date().toISOString()
        },
        `Sampel ${order.id} dilewati sebagai repeat order dari ${waiveRefOrderId}.`
      );
      setWaiveOrder(null);
    } catch (err) {
      setWaiveError('Sampel gagal dilewati. Periksa koneksi ke server, lalu coba lagi.');
    } finally {
      setSavingWaive(false);
    }
  };

  const handleConfirmMaterial = async () => {
    if (!materialOrder || confirmingMaterial) return;
    const order = materialOrder;
    setMaterialError(null);
    setConfirmingMaterial(true);
    try {
      await updateOrderFields(
        order,
        { materialConfirmedBy: currentUser?.name || 'PPIC', materialConfirmedAt: new Date().toISOString() },
        `Stok bahan untuk ${order.id} dikonfirmasi.`
      );
      setMaterialOrder(null);
    } catch (err) {
      setMaterialError('Konfirmasi stok gagal disimpan. Periksa koneksi ke server, lalu coba lagi.');
    } finally {
      setConfirmingMaterial(false);
    }
  };

  const handleOpenIssue = (order: Order) => {
    setIssueOrder(order);
    setIssueStart(today());
    setIssueNotes(order.notes || '');
    setIssueError(null);
  };

  const isSpkOpt = issueOrder ? isSpkOptionalForOrder(issueOrder) : false;

  const issueBlocked = !isSpkOpt && (!!issueOrder
    && issueOrder.needsSample !== false
    && issueOrder.sampleStatus !== 'Approved'
    && !readinessData.samples.some(sample => sample.orderId === issueOrder.id && sample.status === 'Approved')
    && !issueOrder.sampleWaivedBy);

  const handleSubmitIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!issueOrder) return;

    // Gerbang Anti-Skip: jika order butuh sampel dan belum approved / waived, blokir penerbitan SPK
    // Kecuali jika pesanan merupakan Repeat Order atau Qty < 50 (SPK Opsional)
    const isSpkOptOrder = isSpkOptionalForOrder(issueOrder);
    const isSampleBlocked = !isSpkOptOrder && (issueOrder.needsSample !== false &&
      issueOrder.sampleStatus !== 'Approved' &&
      !readinessData.samples.some(s => s.orderId === issueOrder.id && s.status === 'Approved') &&
      !issueOrder.sampleWaivedBy);

    if (isSampleBlocked) {
      setIssueError('Gerbang Anti-Skip: Pesanan ini mewajibkan sampel fisik dan sampel belum disetujui (Approved). SPK Produksi tidak dapat diterbitkan sebelum sampel disetujui.');
      return;
    }

    try {
      setIssuing(true);
      setIssueError(null);
      const result = await issueSpkApi(issueOrder.id, {
        plannedStart: issueStart,
        notes: issueNotes,
        user: currentUser?.name
      });
      setIssueOrder(null);
      showToast(result.message || 'SPK berhasil diterbitkan.');
      await loadData();
    } catch (err: any) {
      setIssueError(err.message || 'Gagal menerbitkan SPK. Coba lagi.');
    } finally {
      setIssuing(false);
    }
  };

  // Whether a met requirement comes from a manual confirmation that can be undone
  const isManuallyConfirmed = (order: Order, req: RequirementStatus) => {
    if (!req.met) return false;
    if (req.key === 'dp') return !!order.specialTermsApprovedBy && canApproveTerms;
    if (req.key === 'material') return !!order.materialConfirmedBy;
    if (req.key === 'sample') {
      const hasApprovedSample = readinessData.samples.some(s => s.orderId === order.id && s.status === 'Approved');
      return !!order.sampleWaivedBy && !hasApprovedSample;
    }
    return false;
  };

  const handleOpenEdit = (spk: SPK) => {
    const fromWork = stagesFromWork(assignmentsFor(spk.id), spk.targetQty);
    setSelectedSpk(spk);
    setEditFormData({
      ...spk,
      cutting: fromWork ? fromWork.cutting : spk.cutting || 0,
      sewing: fromWork ? fromWork.sewing : spk.sewing || 0,
      finishing: fromWork ? fromWork.finishing : spk.finishing || 0,
      qc: fromWork ? fromWork.qc : spk.qc || 0,
      ...(fromWork ? progressFromStages(fromWork, spk.targetQty) : {}),
      progress: fromWork ? progressFromStages(fromWork, spk.targetQty).progress : spk.progress || 0,
      pjKepalaProduksi: spk.pjKepalaProduksi || 'Goro / Mas Dan',
      pjCutting: spk.pjCutting || 'Budi Santoso',
      pjFinishing: spk.pjFinishing || 'Siti Aminah'
    });
    setProgressError(null);
    setProgressFieldErrors({});
    setIsEditModalOpen(true);
  };

  const handleProgressUpdate = (stage: 'cutting' | 'sewing' | 'finishing' | 'qc', val: number) => {
    setProgressFieldErrors(prev => ({ ...prev, [stage]: '' }));
    const updated = { ...editFormData, [stage]: val };
    const target = updated.targetQty || 1;
    // Calculate overall average progress across stages
    const avgPct = Math.round(
      (((updated.cutting || 0) + (updated.sewing || 0) + (updated.finishing || 0) + (updated.qc || 0)) / (target * 4)) * 100
    );
    setEditFormData({
      ...updated,
      progress: Math.min(100, Math.max(0, Number.isFinite(avgPct) ? avgPct : 0)),
      status: avgPct >= 100 ? 'Completed' : avgPct >= 75 ? 'QC Passed' : 'In Progress'
    });
  };

  const handleSaveProgress = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSpk || savingProgress) return;

    const derivedStages = stagesFromWork(assignmentsFor(selectedSpk.id), selectedSpk.targetQty);

    const target = Number(editFormData.targetQty || 0);
    const cutting = Number(editFormData.cutting || 0);
    const sewing = Number(editFormData.sewing || 0);
    const finishing = Number(editFormData.finishing || 0);
    const qc = Number(editFormData.qc || 0);

    // A stage can never report more pieces than the target, nor more than the
    // stage before it: you cannot sew what was never cut. Figures taken from the
    // worker records are reported as they stand instead — see the modal notice.
    const errors: Record<string, string> = {};
    const stages: { key: string; label: string; value: number; prevLabel?: string; prevValue?: number }[] = [
      { key: 'cutting', label: 'Potong', value: cutting },
      { key: 'sewing', label: 'Jahit', value: sewing, prevLabel: 'potong', prevValue: cutting },
      { key: 'finishing', label: 'Finishing', value: finishing, prevLabel: 'jahit', prevValue: sewing },
      { key: 'qc', label: 'Lolos QC', value: qc, prevLabel: 'finishing', prevValue: finishing }
    ];

    for (const stage of derivedStages ? [] : stages) {
      if (stage.value < 0) {
        errors[stage.key] = `${stage.label} tidak boleh minus.`;
      } else if (target > 0 && stage.value > target) {
        errors[stage.key] = `${stage.label} ${stage.value} pcs melebihi target ${target} pcs.`;
      } else if (stage.prevValue !== undefined && stage.value > stage.prevValue) {
        errors[stage.key] = `${stage.label} ${stage.value} pcs melebihi hasil ${stage.prevLabel} ${stage.prevValue} pcs.`;
      }
    }

    if (Object.keys(errors).length > 0) {
      setProgressFieldErrors(errors);
      setProgressError('Periksa angka yang ditandai merah, lalu simpan lagi.');
      const firstKey = stages.map(st => st.key).find(key => errors[key]);
      if (firstKey) document.getElementById(`ppic-edit-${firstKey}`)?.focus();
      return;
    }

    setProgressFieldErrors({});
    setProgressError(null);
    setSavingProgress(true);
    try {
      await updateResource('spk_produksi', selectedSpk.id, editFormData);
      setIsEditModalOpen(false);
      loadData();
    } catch (err) {
      setProgressError('Progres gagal disimpan. Periksa koneksi ke server, lalu coba simpan lagi.');
    } finally {
      setSavingProgress(false);
    }
  };

  const handleOpenPrintModal = (spk: SPK) => {
    setPrintSpk(spk);
    setIsPrintModalOpen(true);
  };

  const handleDownloadPdf = async () => {
    if (!printSpk) return;
    try {
      setPdfError(null);
      setIsGeneratingPdf(true);
      await exportTwoPageSPK('spk-pdf-page1', 'spk-pdf-page2', printSpk.id);
    } catch (err) {
      setPdfError('PDF SPK gagal dibuat. Tutup pratinjau, lalu coba unduh lagi.');
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const filteredSpks = spks.filter(spk => {
    const matchesSearch =
      String(spk.id).toLowerCase().includes(searchQuery.toLowerCase()) ||
      String(spk.po || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      String(spk.customerName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      String(spk.productName || '').toLowerCase().includes(searchQuery.toLowerCase());

    if (statusFilter === 'ALL') return matchesSearch;
    return matchesSearch && spk.status === statusFilter;
  });

  const sortedSpks = useMemo(
    () =>
      sortRows(filteredSpks, spkSort, (spk, key) => {
        switch (key) {
          case 'newest':
            // Default view: the SPK issued most recently leads the list.
            return new Date(spk.timestamp || spk.tanggalMasuk || 0).getTime();
          case 'tanggalSelesai':
            // Finished work orders stop competing for attention.
            if (spk.status === 'Completed' || !spk.tanggalSelesai) return undefined;
            return new Date(spk.tanggalSelesai).getTime();
          case 'targetQty':
            return Number(spk.targetQty) || 0;
          case 'progress':
            return Number(spk.progress) || 0;
          case 'customerName':
            return spk.customerName;
          case 'orderId':
            return spk.orderId;
          default:
            return spk.id;
        }
      }),
    [filteredSpks, spkSort]
  );


  /*
   * The gate checklist lives in the row's detail drawer now: the queue table
   * stays scannable while every shortcut button here keeps working.
   */
  const renderRequirements = (
    order: Order,
    readiness: ReturnType<typeof getOrderReadiness>,
    isSaving: boolean,
    orderRef: string
  ) => (
              <ul className="space-y-3 pt-4 border-t border-slate-100" aria-label={`Syarat produksi ${orderRef}`}>
                {readiness.requirements.map(req => (
                  <li key={req.key} className="flex items-start gap-3">
                    {req.met ? (
                      <CheckCircle2 size={20} className="text-status-done shrink-0 mt-0.5" aria-hidden="true" />
                    ) : (
                      <Circle
                        size={20}
                        className={`shrink-0 mt-0.5 ${req.blocking ? 'text-status-warning' : 'text-slate-300'}`}
                        aria-hidden="true"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm font-semibold ${req.met ? 'text-slate-900' : 'text-slate-700'}`}>
                        {req.label}
                        {!req.blocking && (
                          <Badge variant="idle" size="sm" className="ml-1.5 align-middle">Info</Badge>
                        )}
                        <span className="sr-only">
                          : {req.met ? 'terpenuhi' : 'belum terpenuhi'}
                          {req.blocking ? '' : ', tidak menghambat penerbitan SPK'}
                        </span>
                      </p>
                      <p className="text-sm text-slate-500 break-words">
                        {req.detail}
                        {isManuallyConfirmed(order, req) && (
                          <button
                            type="button"
                            onClick={() => handleUndoConfirmation(order, req.key)}
                            disabled={isSaving}
                            aria-label={`Batalkan konfirmasi ${req.label.toLowerCase()} untuk ${orderRef}`}
                            className="ml-1 inline-flex min-h-8 items-center rounded-md px-1.5 align-middle text-sm font-semibold text-brand-red hover:bg-rose-50 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal disabled:opacity-50 cursor-pointer"
                          >
                            Batalkan
                          </button>
                        )}
                      </p>

                      {!req.met && (
                        <div className="flex flex-wrap items-center gap-2 mt-2">
                          {req.key === 'dp' && (
                            canApproveTerms ? (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleApproveSpecialTerms(order)}
                                disabled={isSaving}
                              >
                                Setujui Termin Khusus
                              </Button>
                            ) : (
                              <span className="text-xs text-slate-500">Catat DP di halaman Keuangan.</span>
                            )
                          )}
                          {req.key === 'dp' && canApproveTerms && (
                            <span className="text-xs text-slate-500">Atau catat DP di halaman Keuangan.</span>
                          )}

                          {req.key === 'sample' && (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleOpenWaive(order)}
                                disabled={isSaving}
                              >
                                Lewati Sampel (Repeat Order)
                              </Button>
                              <span className="text-xs text-slate-500">Hubungkan sampel di halaman Desain &amp; Sampel.</span>
                            </>
                          )}

                          {req.key === 'material' && (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setMaterialOrder(order)}
                                disabled={isSaving}
                              >
                                Konfirmasi Stok Bahan
                              </Button>
                              <span className="text-xs text-slate-500">Atau buat PO di halaman Pembelian Bahan.</span>
                            </>
                          )}

                          {req.key === 'sample' && (
                            <span className="text-xs text-slate-500">Setujui desain di halaman Desain &amp; Sampel. Pola difinalkan di halaman Size Chart — statusnya ikut tampil, tapi tidak menahan SPK.</span>
                          )}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
  );


  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-5 left-4 right-4 sm:left-auto sm:right-5 z-50 sm:max-w-md bg-slate-900 text-white px-4 py-3 rounded-2xl shadow-xl border border-teal-500/50 flex items-center gap-2.5 text-sm font-semibold" role="status">
          <CheckCircle2 size={18} className="text-teal-400 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">{toastMessage}</span>
        </div>
      )}

      <PageHeader
        title="Surat Perintah Kerja (SPK)"
        description="Antrean pesanan yang menunggu SPK, dan daftar SPK berjalan beserta progres tiap tahapnya."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportTableToExcel(spks, 'Daftar_SPK_Produksi_HIJ')}
          >
            <Download size={16} aria-hidden="true" />
            Unduh Excel
          </Button>
        }
      />

      {/* ORDERS AWAITING SPK (SOP-03) */}
      <section className="space-y-4" aria-labelledby="awaiting-spk-heading">
        <div className="flex items-center gap-2">
          <h2 id="awaiting-spk-heading" className="text-lg font-bold text-slate-900">1 &middot; Pesanan Menunggu SPK</h2>
          {awaitingOrders.length > 0 && (
            <Badge variant="warning">
              {awaitingOrders.length}<span className="sr-only"> pesanan</span>
            </Badge>
          )}
        </div>

        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="cell-sticky-start">Pesanan</TableHead>
                <TableHead className="hidden md:table-cell">Pelanggan</TableHead>
                <TableHead className="hidden xl:table-cell">Produk</TableHead>
                <TableHead className="hidden sm:table-cell text-right">Qty</TableHead>
                <TableHead className="hidden md:table-cell">Deadline</TableHead>
                <TableHead className="text-center">Syarat</TableHead>
                <TableHead className="cell-sticky-end text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && awaitingOrders.length === 0 ? (
                <TableSkeletonRows columns={7} />
              ) : awaitingOrders.length === 0 ? (
                <TableEmptyRow
                  colSpan={7}
                  icon={<CheckCircle2 size={20} />}
                  title="Tidak ada pesanan yang menunggu SPK"
                  description="Semua pesanan yang sudah deal sudah punya surat perintah kerja."
                />
              ) : (
                awaitingOrders.map(order => {
                  const readiness = getOrderReadiness(order, readinessData);
                  const isSaving = savingOrderId === order.id;
                  const orderRef = order.po || order.id;

                  return (
                    <TableRow key={order.id}>
                      <TableCell className="cell-sticky-start whitespace-nowrap font-mono font-bold text-slate-900">
                        {orderRef}
                      </TableCell>

                      <TableCell className="hidden md:table-cell">
                        <span className="block max-w-[150px] truncate font-semibold text-slate-900" title={order.customerName}>
                          {order.customerName}
                        </span>
                      </TableCell>

                      <TableCell className="hidden xl:table-cell">
                        <span className="block max-w-[160px] truncate" title={order.productType}>
                          {order.productType}
                        </span>
                      </TableCell>

                      <TableCell className="hidden sm:table-cell text-right whitespace-nowrap font-semibold text-slate-900">
                        {order.quantity}
                      </TableCell>

                      <TableCell className="hidden md:table-cell whitespace-nowrap">
                        <DeadlineBadge deadline={order.deadline} />
                      </TableCell>

                      <TableCell className="text-center whitespace-nowrap">
                        {readiness.isSpkOptional ? (
                          <Badge variant="done" size="sm" solid>
                            {order.isRepeatOrder ? 'Repeat Order' : 'Qty < 50'}
                          </Badge>
                        ) : readiness.ready ? (
                          <Badge variant="done" size="sm" solid>Siap</Badge>
                        ) : (
                          <Badge variant="warning" size="sm" solid>
                            {readiness.blockingMetCount}/{readiness.blockingTotal}
                          </Badge>
                        )}
                      </TableCell>

                      <TableCell className="cell-sticky-end text-right">
                        <TableRowActions>
                          <Button
                            size="sm"
                            onClick={() => handleOpenIssue(order)}
                            disabled={(!readiness.ready && !readiness.isSpkOptional) || isSaving}
                            aria-label={`Terbitkan SPK untuk ${orderRef}`}
                            className="hidden h-8 px-2.5 text-xs sm:inline-flex"
                          >
                            Terbitkan SPK
                          </Button>
                          <RowDetailButton label={orderRef} onClick={() => setDetailAwaiting(order)} />
                        </TableRowActions>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </Card>
      </section>

      <section className="space-y-4" aria-labelledby="spk-list-heading">
        <h2 id="spk-list-heading" className="text-lg font-bold text-slate-900 pt-2">2 &middot; Daftar SPK Berjalan</h2>

        {/* FILTER & SEARCH */}
        <Card className="p-4 flex flex-col sm:flex-row gap-3 items-center justify-between">
          <div className="relative w-full sm:w-80">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <Input
              type="search"
              aria-label="Cari SPK"
              placeholder="Cari SPK, PO, atau pelanggan…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Filter size={16} className="text-slate-400 shrink-0" aria-hidden="true" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Filter status SPK"
              className="w-full sm:w-auto h-10 px-3 bg-white border border-slate-300 rounded-lg text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-600"
            >
              <option value="ALL">Semua Status</option>
              <option value="Queued">{statusLabel('Queued')}</option>
              <option value="In Progress">{statusLabel('In Progress')}</option>
              <option value="Finishing">{statusLabel('Finishing')}</option>
              <option value="QC Passed">{statusLabel('QC Passed')}</option>
              <option value="Completed">{statusLabel('Completed')}</option>
            </select>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableSortHead sortKey="id" sort={spkSort} onSortChange={setSpkSort} className="cell-sticky-start">
                  No. SPK
                </TableSortHead>
                <TableSortHead
                  sortKey="orderId"
                  sort={spkSort}
                  onSortChange={setSpkSort}
                  className="hidden lg:table-cell"
                >
                  Pesanan
                </TableSortHead>
                <TableSortHead
                  sortKey="customerName"
                  sort={spkSort}
                  onSortChange={setSpkSort}
                  className="hidden md:table-cell"
                >
                  Pelanggan
                </TableSortHead>
                <TableHead className="hidden 2xl:table-cell">Produk</TableHead>
                <TableSortHead
                  sortKey="targetQty"
                  sort={spkSort}
                  onSortChange={setSpkSort}
                  align="right"
                  className="hidden sm:table-cell"
                >
                  Target
                </TableSortHead>
                <TableSortHead
                  sortKey="progress"
                  sort={spkSort}
                  onSortChange={setSpkSort}
                  className="hidden sm:table-cell"
                >
                  Progres
                </TableSortHead>
                <TableSortHead
                  sortKey="tanggalSelesai"
                  sort={spkSort}
                  onSortChange={setSpkSort}
                  className="hidden md:table-cell"
                >
                  Deadline
                </TableSortHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="cell-sticky-end text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && spks.length === 0 ? (
                <TableSkeletonRows columns={9} />
              ) : sortedSpks.length === 0 ? (
                <TableEmptyRow
                  colSpan={9}
                  icon={<Factory size={20} />}
                  title={spks.length > 0 ? 'Tidak ada SPK yang cocok' : 'Belum ada SPK'}
                  description={
                    spks.length > 0
                      ? 'Coba kata kunci atau status lain.'
                      : 'Terbitkan SPK dari pesanan yang sudah siap produksi.'
                  }
                />
              ) : (
                sortedSpks.map(spk => {
                  const pct = Math.min(100, Math.max(0, spk.progress || 0));
                  return (
                    <TableRow key={spk.id}>
                      <TableCell className="cell-sticky-start whitespace-nowrap font-mono font-bold text-slate-900">
                        {spk.id}
                      </TableCell>

                      <TableCell className="hidden lg:table-cell whitespace-nowrap font-mono text-slate-600">
                        {spk.po || spk.orderId || '\u2014'}
                      </TableCell>

                      <TableCell className="hidden md:table-cell">
                        <span className="block max-w-[150px] truncate font-semibold text-slate-900" title={spk.customerName}>
                          {spk.customerName}
                        </span>
                      </TableCell>

                      <TableCell className="hidden 2xl:table-cell">
                        <span className="block max-w-[160px] truncate" title={spk.productName}>
                          {spk.productName}
                        </span>
                      </TableCell>

                      <TableCell className="hidden sm:table-cell text-right whitespace-nowrap font-semibold text-slate-900">
                        {spk.targetQty}
                      </TableCell>

                      <TableCell className="hidden sm:table-cell">
                        <div className="flex items-center gap-2">
                          <div
                            className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-slate-100"
                            role="progressbar"
                            aria-label={`Progres ${spk.id}`}
                            aria-valuenow={pct}
                            aria-valuemin={0}
                            aria-valuemax={100}
                          >
                            <div
                              className="h-full rounded-full bg-status-progress transition-[width] duration-500 motion-reduce:transition-none"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="tabular-nums text-xs font-semibold text-slate-700">{pct}%</span>
                        </div>
                      </TableCell>

                      <TableCell className="hidden md:table-cell whitespace-nowrap">
                        <DeadlineBadge
                          deadline={spk.tanggalSelesai}
                          completed={spk.status === 'Completed'}
                        />
                      </TableCell>

                      <TableCell className="text-center whitespace-nowrap">
                        <StatusBadge status={spk.status} size="sm" solid />
                      </TableCell>

                      <TableCell className="cell-sticky-end text-right">
                        <TableRowActions>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleOpenPrintModal(spk)}
                            title="Cetak SPK"
                            aria-label={`Cetak SPK ${spk.id}`}
                            className="size-8"
                          >
                            <Printer size={15} aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleOpenWorkers(spk)}
                            title="Petugas yang mengerjakan"
                            aria-label={`Catat petugas ${spk.id}`}
                            className="size-8"
                          >
                            <Users size={15} aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleOpenEdit(spk)}
                            title="Perbarui progres"
                            aria-label={`Perbarui progres ${spk.id}`}
                            className="size-8"
                          >
                            <Edit size={15} aria-hidden="true" />
                          </Button>
                          <RowDetailButton label={spk.id} onClick={() => setDetailSpk(spk)} />
                        </TableRowActions>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </Card>
      </section>

      {/* AWAITING-SPK DETAIL */}
      <DetailDrawer
        isOpen={!!detailAwaiting}
        onClose={() => setDetailAwaiting(null)}
        title={detailAwaiting?.productType}
        subtitle={detailAwaiting && (
          <span className="font-mono">{detailAwaiting.po || detailAwaiting.id}</span>
        )}
        status={detailAwaiting && <StatusBadge status={detailAwaiting.status} />}
        size="lg"
        footer={detailAwaiting && (() => {
          const readiness = getOrderReadiness(detailAwaiting, readinessData);
          return (
            <Button
              type="button"
              size="sm"
              onClick={() => handleOpenIssue(detailAwaiting)}
              disabled={(!readiness.ready && !readiness.isSpkOptional) || savingOrderId === detailAwaiting.id}
            >
              {readiness.isSpkOptional ? 'Terbitkan SPK (Opsional)' : 'Terbitkan SPK'}
            </Button>
          );
        })()}
      >
        {detailAwaiting && (
          <>
            <DetailSection title="Pesanan">
              <DetailField label="No. Pesanan" mono>{detailAwaiting.po || detailAwaiting.id}</DetailField>
              <DetailField label="Pelanggan">{detailAwaiting.customerName}</DetailField>
              <DetailField label="Produk">{detailAwaiting.productType}</DetailField>
              <DetailField label="Kuantitas">{detailAwaiting.quantity} Pcs</DetailField>
              <DetailField label="Deadline">{formatDate(detailAwaiting.deadline)}</DetailField>
            </DetailSection>

            <DetailSection title="Syarat sebelum SPK terbit">
              <div className="col-span-full">
                {renderRequirements(
                  detailAwaiting,
                  getOrderReadiness(detailAwaiting, readinessData),
                  savingOrderId === detailAwaiting.id,
                  detailAwaiting.po || detailAwaiting.id
                )}
              </div>
            </DetailSection>

            {detailAwaiting.notes && (
              <DetailSection title="Catatan">
                <DetailField label="Instruksi" full>{detailAwaiting.notes}</DetailField>
              </DetailSection>
            )}
          </>
        )}
      </DetailDrawer>

      {/* SPK DETAIL */}
      <DetailDrawer
        isOpen={!!detailSpk}
        onClose={() => setDetailSpk(null)}
        title={detailSpk?.productName}
        subtitle={detailSpk && <span className="font-mono">{detailSpk.id}</span>}
        status={detailSpk && <StatusBadge status={detailSpk.status} />}
        size="lg"
        footer={detailSpk && (
          <>
            <Button type="button" variant="outline" size="sm" onClick={() => handleOpenPrintModal(detailSpk)}>
              <Printer size={15} aria-hidden="true" /> Cetak SPK
            </Button>
            <Button type="button" size="sm" onClick={() => handleOpenEdit(detailSpk)}>
              <Edit size={15} aria-hidden="true" /> Perbarui Progres
            </Button>
          </>
        )}
      >
        {detailSpk && (
          <>
            <DetailSection title="Identitas">
              <DetailField label="No. SPK" mono>{detailSpk.id}</DetailField>
              <DetailField label="Pesanan" mono>{detailSpk.po || detailSpk.orderId || '\u2014'}</DetailField>
              <DetailField label="Pelanggan">{detailSpk.customerName}</DetailField>
              <DetailField label="Produk">{detailSpk.productName}</DetailField>
              <DetailField label="Bahan">{detailSpk.material || '\u2014'}</DetailField>
              <DetailField label="Sablon / Bordir">{detailSpk.sablonBordir || '\u2014'}</DetailField>
            </DetailSection>

            <DetailSection title="Jadwal">
              <DetailField label="Masuk produksi">{formatDate(detailSpk.tanggalMasuk)}</DetailField>
              <DetailField label="Deadline">{formatDate(detailSpk.tanggalSelesai)}</DetailField>
            </DetailSection>

            <DetailSection title="Capaian per tahap">
              <DetailField label="Target">{detailSpk.targetQty} Pcs</DetailField>
              <DetailField label="Potong">{detailSpk.cutting || 0} Pcs</DetailField>
              <DetailField label="Jahit">{detailSpk.sewing || 0} Pcs</DetailField>
              <DetailField label="Finishing">{detailSpk.finishing || 0} Pcs</DetailField>
              <DetailField label="Lolos QC">{detailSpk.qc || 0} Pcs</DetailField>
              <DetailField label="Progres total">{detailSpk.progress || 0}%</DetailField>
            </DetailSection>

            <DetailSection title="Penanggung jawab">
              <DetailField label="Kepala produksi">{detailSpk.pjKepalaProduksi || '\u2014'}</DetailField>
              <DetailField label="Pemotongan">{detailSpk.pjCutting || '\u2014'}</DetailField>
              <DetailField label="Finishing">{detailSpk.pjFinishing || '\u2014'}</DetailField>
            </DetailSection>

            {detailSpk.sizeChart && (
              <DetailSection title="Rincian ukuran">
                <DetailField label="Size chart" full>{detailSpk.sizeChart}</DetailField>
              </DetailSection>
            )}

            {detailSpk.notes && (
              <DetailSection title="Catatan">
                <DetailField label="Instruksi" full>{detailSpk.notes}</DetailField>
              </DetailSection>
            )}
          </>
        )}
      </DetailDrawer>

      {/* UPDATE PROGRESS MODAL */}
      {/* PETUGAS PRODUKSI PER SPK */}
      <Modal
        isOpen={!!workerSpk}
        onClose={() => setWorkerSpk(null)}
        title={`Petugas Produksi ${workerSpk?.id ?? ''}`}
        subtitle={workerSpk ? `${workerSpk.productName} \u00b7 target ${workerSpk.targetQty} pcs` : undefined}
        maxWidth="3xl"
        footer={
          <div className="flex justify-end">
            <Button type="button" variant="outline" onClick={() => setWorkerSpk(null)}>Tutup</Button>
          </div>
        }
      >
        {workerSpk && (() => {
          const rows = assignmentsFor(workerSpk.id);
          const totalUpah = rows.reduce((sum, a) => sum + a.qty * a.ratePerPiece, 0);
          const perTask = PRODUCTION_TASKS.map(task => ({
            task,
            qty: rows.filter(r => r.task === task).reduce((sum, r) => sum + r.qty, 0)
          })).filter(t => t.qty > 0);

          return (
            <div className="space-y-5">
              <FormNotice icon={<Users size={18} />} title="Catatan di sini yang menggerakkan progres SPK">
                Progres tiap tahap dijumlahkan dari catatan ini, bukan diisi terpisah, jadi tidak ada selisih.
                Tarifnya pun ikut tersimpan per catatan, jadi menaikkan tarif nanti tidak mengubah nilai
                pekerjaan yang sudah lewat.
              </FormNotice>

              {operators.length === 0 ? (
                <div className="rounded-xl border border-amber-500/40 bg-amber-50 px-3.5 py-3 text-sm text-amber-900">
                  Belum ada data petugas. Tambahkan dulu di menu <b>Penggajian</b> &mdash; cukup nama dan nomor HP.
                </div>
              ) : (
                <form onSubmit={handleAddAssignment} className="space-y-4 rounded-2xl border border-border bg-muted/30 p-4">
                  <FormError>{workerError}</FormError>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                    <div>
                      <FieldLabel htmlFor="wrk-task" required>Tahap</FieldLabel>
                      <Select
                        id="wrk-task"
                        value={workerForm.task}
                        onChange={e => setWorkerForm(prev => ({ ...prev, task: e.target.value as ProductionTask }))}
                      >
                        {PRODUCTION_TASKS.map(t => <option key={t} value={t}>{t}</option>)}
                      </Select>
                    </div>

                    <div className="sm:col-span-2">
                      <FieldLabel htmlFor="wrk-operator" required>Petugas</FieldLabel>
                      <Select
                        id="wrk-operator"
                        value={workerForm.operatorId}
                        onChange={e => setWorkerForm(prev => ({ ...prev, operatorId: e.target.value }))}
                      >
                        <option value="">Pilih petugas</option>
                        {operators
                          .filter(o => o.status !== 'Resigned')
                          .map(o => (
                            <option key={o.id} value={o.id}>{o.name}</option>
                          ))}
                      </Select>
                    </div>

                    <div>
                      <FieldLabel htmlFor="wrk-qty" required>Jumlah (pcs)</FieldLabel>
                      <Input
                        id="wrk-qty"
                        type="number"
                        min={1}
                        inputMode="numeric"
                        value={workerForm.qty || ''}
                        className="text-right font-semibold tabular-nums"
                        onChange={e => setWorkerForm(prev => ({ ...prev, qty: Number(e.target.value) || 0 }))}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <FieldLabel htmlFor="wrk-rate" required>Tarif borongan (Rp/pcs)</FieldLabel>
                      <Input
                        id="wrk-rate"
                        type="number"
                        min={0}
                        step={100}
                        inputMode="numeric"
                        value={workerForm.rate || ''}
                        aria-describedby="wrk-rate-hint"
                        className="text-right font-semibold tabular-nums"
                        onChange={e => setWorkerForm(prev => ({ ...prev, rate: Number(e.target.value) || 0 }))}
                      />
                      <FieldHint id="wrk-rate-hint">
                        Sesuai kesulitan pekerjaan ini, bukan tarif tetap orangnya.
                      </FieldHint>
                    </div>
                    <div>
                      <FieldLabel htmlFor="wrk-date">Tanggal kerja</FieldLabel>
                      <Input
                        id="wrk-date"
                        type="date"
                        value={workerForm.date}
                        onChange={e => setWorkerForm(prev => ({ ...prev, date: e.target.value }))}
                      />
                    </div>
                    <div>
                      <span className="mb-1.5 block text-sm font-semibold text-foreground">Upah</span>
                      <p className="flex h-10 items-center justify-end rounded-lg border border-dashed border-border bg-white px-3 text-sm font-bold tabular-nums text-foreground">
                        {formatCurrency((workerForm.qty || 0) * (workerForm.rate || 0))}
                      </p>
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <Button type="submit" size="sm" disabled={savingWorker}>
                      <Plus size={14} aria-hidden="true" /> {savingWorker ? 'Menyimpan\u2026' : 'Tambah Catatan'}
                    </Button>
                  </div>
                </form>
              )}

              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-foreground">Tercatat di SPK ini ({rows.length})</h3>
                  {rows.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      Total upah borongan: <b className="text-foreground">{formatCurrency(totalUpah)}</b>
                    </span>
                  )}
                </div>

                {perTask.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {perTask.map(t => (
                      <span key={t.task} className="inline-flex h-7 items-center rounded-lg border border-border bg-white px-2.5 text-xs font-semibold text-slate-700">
                        {t.task}: {t.qty} pcs
                        {workerSpk.targetQty > 0 && t.qty !== workerSpk.targetQty && (
                          <span className="ml-1 font-normal text-amber-700">
                            (target {workerSpk.targetQty})
                          </span>
                        )}
                      </span>
                    ))}
                  </div>
                )}

                <div className="overflow-hidden rounded-xl border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/60 text-xs font-semibold text-muted-foreground">
                      <tr>
                        <th scope="col" className="px-3 py-2 text-left">Tahap</th>
                        <th scope="col" className="px-3 py-2 text-left">Petugas</th>
                        <th scope="col" className="px-3 py-2 text-right">Pcs</th>
                        <th scope="col" className="px-3 py-2 text-right">Tarif</th>
                        <th scope="col" className="px-3 py-2 text-right">Upah</th>
                        <th scope="col" className="px-3 py-2 text-left">Tanggal</th>
                        <th scope="col" className="w-12 px-3 py-2"><span className="sr-only">Hapus</span></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {rows.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-3 py-5 text-center text-xs text-muted-foreground">
                            Belum ada petugas dicatat untuk SPK ini.
                          </td>
                        </tr>
                      ) : (
                        rows.map(a => (
                          <tr key={a.id}>
                            <td className="px-3 py-2 font-semibold text-foreground">{a.task}</td>
                            <td className="px-3 py-2">{a.operatorName}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{a.qty}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatCurrency(a.ratePerPiece)}</td>
                            <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatCurrency(a.qty * a.ratePerPiece)}</td>
                            <td className="px-3 py-2 text-xs text-muted-foreground">{a.date ? formatDate(a.date) : '\u2014'}</td>
                            <td className="px-3 py-2 text-right">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={`Hapus catatan ${a.operatorName}`}
                                onClick={() => handleRemoveAssignment(a)}
                                className="size-8 text-brand-red hover:bg-rose-50"
                              >
                                <Trash2 size={14} aria-hidden="true" />
                              </Button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          );
        })()}
      </Modal>

      <Modal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        title={`Perbarui Progres ${selectedSpk?.id ?? ''}`}
        subtitle="Dijumlahkan dari catatan petugas produksi SPK ini."
        maxWidth="lg"
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="block text-xs font-medium text-muted-foreground">Progres total</span>
              <span className="block text-lg font-bold tabular-nums text-foreground" aria-live="polite">
                {editFormData.progress || 0}%
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" disabled={savingProgress} onClick={() => setIsEditModalOpen(false)}>
                Batal
              </Button>
              <Button type="submit" form="ppic-progress-form" disabled={savingProgress}>
                {savingProgress ? 'Menyimpan…' : 'Simpan Progres'}
              </Button>
            </div>
          </div>
        }
      >
        <form id="ppic-progress-form" noValidate onSubmit={handleSaveProgress} className="space-y-5">
          <FormError>{progressError}</FormError>

          <div className="rounded-xl border border-border bg-muted/40 p-4">
            <p className="text-sm font-semibold text-foreground break-words">{selectedSpk?.productName}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Target {editFormData.targetQty || 0} Pcs · {selectedSpk?.customerName}
            </p>
          </div>

          {(() => {
            const STAGES = [
              { key: 'cutting', label: 'Potong selesai', task: 'Cutting', hint: 'Jumlah potongan keluar dari meja cutting.' },
              { key: 'sewing', label: 'Jahit selesai', task: 'Jahit', hint: 'Tidak boleh melebihi hasil potong.' },
              { key: 'finishing', label: 'Finishing selesai', task: 'Finishing', hint: 'Tidak boleh melebihi hasil jahit.' },
              { key: 'qc', label: 'Lolos QC', task: 'QC', hint: 'Tidak boleh melebihi hasil finishing.' }
            ] as const;

            const workRows = selectedSpk ? assignmentsFor(selectedSpk.id) : [];
            const fromWork = selectedSpk ? stagesFromWork(workRows, selectedSpk.targetQty) : null;

            // Recorded but outside the four SPK stages, so the modal still accounts
            // for every piece someone was paid for.
            const extraTasks = PRODUCTION_TASKS
              .filter(task => !STAGES.some(st => st.task === task))
              .map(task => ({
                task,
                qty: workRows.filter(r => r.task === task).reduce((sum, r) => sum + (Number(r.qty) || 0), 0)
              }))
              .filter(t => t.qty > 0);

            // A later stage running ahead of an earlier one means a record is off.
            const anomalies = fromWork
              ? STAGES.slice(1)
                  .map((stage, i) => {
                    const prev = STAGES[i];
                    const value = fromWork[stage.key];
                    const prevValue = fromWork[prev.key];
                    return value > prevValue
                      ? `${stage.label.replace(' selesai', '')} ${value} pcs melebihi ${prev.label.replace(' selesai', '').toLowerCase()} ${prevValue} pcs.`
                      : null;
                  })
                  .filter(Boolean)
              : [];

            return (
              <>
                {fromWork ? (
                  <FormNotice icon={<Users size={18} />} title="Angka mengikuti catatan petugas produksi">
                    Dijumlahkan dari {workRows.length} catatan pekerjaan di SPK ini, jadi progres dan upah selalu
                    sama. Kalau ada angka yang keliru, perbaiki catatannya &mdash; bukan angka di sini.
                  </FormNotice>
                ) : (
                  <FormNotice icon={<Edit size={18} />} title="Belum ada catatan petugas untuk SPK ini">
                    Isi manual dulu. Begitu pekerjaan dicatat per petugas, progres tiap tahap ikut terisi sendiri
                    dari catatan itu.
                  </FormNotice>
                )}

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {STAGES.map(stage => (
                    <div key={stage.key}>
                      <FieldLabel htmlFor={fromWork ? undefined : `ppic-edit-${stage.key}`}>
                        {stage.label} (Pcs)
                      </FieldLabel>
                      {fromWork ? (
                        <>
                          <p className="flex h-10 items-center justify-end rounded-lg border border-dashed border-border bg-muted/40 px-3 text-sm font-bold tabular-nums text-foreground">
                            {fromWork[stage.key]}
                          </p>
                          <FieldHint>
                            Dari catatan tahap {stage.task}.
                          </FieldHint>
                        </>
                      ) : (
                        <>
                          <Input
                            id={`ppic-edit-${stage.key}`}
                            type="number"
                            inputMode="numeric"
                            min={0}
                            max={editFormData.targetQty}
                            value={editFormData[stage.key] || 0}
                            aria-invalid={!!progressFieldErrors[stage.key]}
                            aria-describedby={
                              progressFieldErrors[stage.key] ? `ppic-edit-${stage.key}-error` : `ppic-edit-${stage.key}-hint`
                            }
                            onChange={(e) => handleProgressUpdate(stage.key, Number(e.target.value))}
                            className="text-right font-semibold tabular-nums"
                          />
                          {progressFieldErrors[stage.key] ? (
                            <FieldError id={`ppic-edit-${stage.key}-error`}>{progressFieldErrors[stage.key]}</FieldError>
                          ) : (
                            <FieldHint id={`ppic-edit-${stage.key}-hint`}>{stage.hint}</FieldHint>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                </div>

                {extraTasks.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Tahap lain yang tercatat:</span>
                    {extraTasks.map(t => (
                      <span
                        key={t.task}
                        className="inline-flex h-7 items-center rounded-lg border border-border bg-white px-2.5 text-xs font-semibold text-slate-700"
                      >
                        {t.task} {t.qty} pcs
                      </span>
                    ))}
                  </div>
                )}

                {anomalies.length > 0 && (
                  <div className="rounded-xl border border-amber-500/40 bg-amber-50 px-3.5 py-3 text-sm text-amber-900">
                    <p className="font-semibold">Ada angka yang perlu diperiksa</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5">
                      {anomalies.map(msg => <li key={String(msg)}>{msg}</li>)}
                    </ul>
                    <p className="mt-1.5 text-xs">
                      Progres tetap disimpan apa adanya &mdash; perbaiki di Petugas Produksi kalau memang salah catat.
                    </p>
                  </div>
                )}

                {selectedSpk && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const spk = selectedSpk;
                      setIsEditModalOpen(false);
                      handleOpenWorkers(spk);
                    }}
                  >
                    <Users size={15} aria-hidden="true" /> Buka Petugas Produksi
                  </Button>
                )}
              </>
            );
          })()}
        </form>
      </Modal>

      {/* SPK 2-PAGE PRINT PREVIEW MODAL */}
      <Modal
        isOpen={isPrintModalOpen}
        onClose={() => setIsPrintModalOpen(false)}
        title={`Pratinjau SPK ${printSpk?.id ?? ''}`}
        subtitle="Ukuran A4, 2 halaman."
        maxWidth="4xl"
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setIsPrintModalOpen(false)}>
              Tutup
            </Button>
            <Button onClick={handleDownloadPdf} disabled={isGeneratingPdf}>
              {isGeneratingPdf
                ? <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                : <Download size={16} aria-hidden="true" />}
              {isGeneratingPdf ? 'Membuat PDF…' : 'Unduh PDF'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <FormError>{pdfError}</FormError>

          {/* SPK TEMPLATE PREVIEW CONTAINER */}
          <div className="max-h-[62vh] overflow-auto rounded-xl bg-slate-200 p-3">
            <div className="mx-auto flex w-fit flex-col gap-4">
              {printSpk && (
                <SpkDocument spk={printSpk} page1Id="spk-pdf-page1" page2Id="spk-pdf-page2" />
              )}
            </div>
          </div>
        </div>
      </Modal>

      {/* REPEAT ORDER: SKIP SAMPLE */}
      <Modal
        isOpen={!!waiveOrder}
        onClose={() => setWaiveOrder(null)}
        title={`Lewati Sampel ${waiveOrder?.id ?? ''}`}
        subtitle="Pilih pesanan sebelumnya dengan desain yang sama."
        maxWidth="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={savingWaive} onClick={() => setWaiveOrder(null)}>
              Batal
            </Button>
            <Button type="submit" form="ppic-waive-form" disabled={savingWaive || !waiveRefOrderId}>
              {savingWaive ? 'Menyimpan…' : 'Lewati Sampel'}
            </Button>
          </div>
        }
      >
        {waiveOrder && (() => {
          const previousOrders = orders.filter(o => o.customerId === waiveOrder.customerId && o.id !== waiveOrder.id);
          return (
            <form id="ppic-waive-form" noValidate onSubmit={handleSubmitWaive} className="space-y-5">
              <FormError>{waiveError}</FormError>

              <div className="rounded-xl border border-border bg-muted/40 p-4">
                <p className="text-sm font-semibold text-foreground break-words">{waiveOrder.productType}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{waiveOrder.customerName}</p>
              </div>

              {previousOrders.length === 0 ? (
                <p className="rounded-xl border border-status-critical-border bg-status-critical-bg p-4 text-sm font-medium text-status-critical">
                  Pelanggan ini belum punya pesanan lain, jadi repeat order belum bisa dipakai. Terbitkan SPK
                  setelah sampel fisik disetujui di modul Desain &amp; Sampel.
                </p>
              ) : (
                <div>
                  <FieldLabel htmlFor="ppic-waive-ref-order" required>Pesanan sebelumnya</FieldLabel>
                  <Select
                    id="ppic-waive-ref-order"
                    value={waiveRefOrderId}
                    aria-invalid={!!waiveError && !waiveRefOrderId}
                    aria-describedby="ppic-waive-ref-hint"
                    onChange={(e) => {
                      setWaiveError(null);
                      setWaiveRefOrderId(e.target.value);
                    }}
                  >
                    <option value="">Pilih pesanan…</option>
                    {previousOrders.map(o => (
                      <option key={o.id} value={o.id}>
                        {o.po || o.id} – {o.productType}
                      </option>
                    ))}
                  </Select>
                  <FieldHint id="ppic-waive-ref-hint">
                    Sampel dilewati atas nama {currentUser?.name || 'PPIC'} dan tercatat di riwayat pesanan.
                  </FieldHint>
                </div>
              )}
            </form>
          );
        })()}
      </Modal>

      {/* CONFIRM WAREHOUSE STOCK */}
      <Modal
        isOpen={!!materialOrder}
        onClose={() => setMaterialOrder(null)}
        title={`Konfirmasi Stok Bahan ${materialOrder?.id ?? ''}`}
        subtitle="Pastikan bahan tersedia sebelum SPK diterbitkan."
        maxWidth="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={confirmingMaterial} onClick={() => setMaterialOrder(null)}>
              Batal
            </Button>
            <Button type="button" disabled={confirmingMaterial} onClick={handleConfirmMaterial}>
              {confirmingMaterial ? 'Menyimpan…' : 'Konfirmasi Stok Tersedia'}
            </Button>
          </div>
        }
      >
        {materialOrder && (
          <div className="space-y-5">
            <FormError>{materialError}</FormError>

            <div className="rounded-xl border border-border bg-muted/40 p-4">
              <p className="text-sm font-semibold text-foreground break-words">{materialOrder.productType}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {materialOrder.quantity} Pcs • Bahan: {materialOrder.material || '-'}
              </p>
            </div>

            {lowStockItems.length === 0 ? (
              <p className="text-sm text-status-done bg-status-done-bg border border-status-done-border rounded-xl p-4 font-semibold">
                Semua bahan di atas stok minimum.
              </p>
            ) : (
              <div className="bg-status-critical-bg border border-status-critical-border rounded-xl p-4 space-y-2">
                <p className="flex items-center gap-2 text-sm font-bold text-status-critical">
                  <AlertTriangle size={18} className="shrink-0" aria-hidden="true" />
                  {lowStockItems.length} bahan di bawah stok minimum
                </p>
                <ul className="space-y-1">
                  {lowStockItems.map(item => (
                    <li key={item.id} className="text-sm text-slate-700 font-medium break-words">
                      {item.name}: <span className="font-bold text-status-critical">{item.stock} {item.unit}</span> (minimum {item.minStock} {item.unit})
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ISSUE SPK */}
      <Modal
        isOpen={!!issueOrder}
        onClose={() => setIssueOrder(null)}
        title={`Terbitkan SPK ${issueOrder?.id ?? ''}`}
        subtitle="SPK masuk antrean produksi."
        maxWidth="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={issuing} onClick={() => setIssueOrder(null)}>
              Batal
            </Button>
            <Button type="submit" form="ppic-issue-form" disabled={issuing || issueBlocked}>
              {issuing && <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
              {issuing ? 'Menerbitkan…' : 'Terbitkan SPK'}
            </Button>
          </div>
        }
      >
        {issueOrder && (() => {
          const isSpkOptOrder = isSpkOptionalForOrder(issueOrder);
          const isSampleBlocked = !isSpkOptOrder && (issueOrder.needsSample !== false &&
            issueOrder.sampleStatus !== 'Approved' &&
            !readinessData.samples.some(s => s.orderId === issueOrder.id && s.status === 'Approved') &&
            !issueOrder.sampleWaivedBy);

          return (
            <form id="ppic-issue-form" noValidate onSubmit={handleSubmitIssue} className="space-y-5">
              <FormError>{issueError}</FormError>

              <OrderFlowStepper
                currentStep={4}
                needsSample={issueOrder.needsSample !== false}
                sampleStatus={issueOrder.sampleStatus}
                isSampleApproved={!isSampleBlocked}
                compact
                className="mb-2"
              />

              <div className="rounded-xl border border-border bg-muted/40 p-4">
                <p className="text-sm font-semibold text-foreground break-words">{issueOrder.productType}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {issueOrder.customerName} · {issueOrder.quantity} Pcs · Deadline {formatDate(issueOrder.deadline)}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {isSpkOptOrder && (
                    <Badge variant="done">Jalur Cepat: SPK Opsional ({issueOrder.isRepeatOrder ? 'Repeat Order' : 'Qty < 50'})</Badge>
                  )}
                  {issueOrder.needsSample === false ? (
                    <Badge variant="idle">Tanpa sampel fisik · jalur cepat</Badge>
                  ) : issueOrder.sampleStatus === 'Approved' ? (
                    <Badge variant="done">Sampel fisik disetujui</Badge>
                  ) : (
                    <Badge variant="warning">
                      Sampel fisik: {statusLabel(issueOrder.sampleStatus) || 'Menunggu'}
                    </Badge>
                  )}
                </div>
              </div>

              {isSampleBlocked && (
                <div
                  role="status"
                  className="flex items-start gap-3 rounded-xl border border-status-critical-border bg-status-critical-bg p-4"
                >
                  <AlertTriangle size={20} className="mt-0.5 shrink-0 text-status-critical" aria-hidden="true" />
                  <div className="text-sm">
                    <p className="font-bold text-status-critical">SPK belum bisa diterbitkan: sampel fisik belum disetujui</p>
                    <p className="mt-1 text-xs leading-relaxed text-slate-700">
                      Setujui sampel di modul Desain &amp; Sampel, atau lewati sampel sebagai repeat order dari
                      pesanan sebelumnya.
                    </p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <FieldLabel htmlFor="ppic-issue-start" required>Rencana mulai produksi</FieldLabel>
                  <Input
                    id="ppic-issue-start"
                    type="date"
                    value={issueStart}
                    aria-describedby="ppic-issue-start-hint"
                    onChange={(e) => setIssueStart(e.target.value)}
                  />
                  <FieldHint id="ppic-issue-start-hint">
                    Deadline pesanan {formatDate(issueOrder.deadline)}.
                  </FieldHint>
                </div>
              </div>

              <div>
                <FieldLabel htmlFor="ppic-issue-notes" aside="Opsional">Catatan untuk tim produksi</FieldLabel>
                <Textarea
                  id="ppic-issue-notes"
                  rows={4}
                  value={issueNotes}
                  placeholder="Contoh: jahitan rantai pundak, obras presisi, buang benang sebelum QC."
                  onChange={(e) => setIssueNotes(e.target.value)}
                />
              </div>
            </form>
          );
        })()}
      </Modal>
    </div>
  );
};
