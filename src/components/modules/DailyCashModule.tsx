import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Search,
  Download,
  Pencil,
  Ban,
  Undo2,
  HandCoins,
  Wallet,
  CalendarDays,
  Truck,
  UserCog,
  Eye,
  NotebookPen,
  Boxes,
  ReceiptText
} from 'lucide-react';
import type { DailyCashEntry, DailyCashSettings, DailyCashType, InventoryItem, Order, Shipment } from '../../types';
import {
  fetchResource,
  fetchDailyCashSettingsApi,
  saveDailyCashPjApi,
  fetchStaffDirectory,
  createDailyCashEntryApi,
  updateDailyCashEntryApi,
  cancelDailyCashEntryApi,
  reopenDailyCashEntryApi,
  settleDailyCashApi,
  type DailyCashInput,
  type StaffDirectoryEntry
} from '../../services/api';
import { formatCurrency, formatDate, formatDateTime, exportTableToExcel, todayLocal } from '../../lib/utils';
import { ageInDays, distinctNames, isCounted, isOpenTalangan, payerKey, DAILY_CASH_TYPES } from '../../lib/dailyCash';
import { newestFirst } from '../../lib/ordering';
import { Badge } from '../ui/Badge';
import { Modal } from '../ui/Modal';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { FieldLabel, FieldHint, FormError, Select, Textarea, CurrencyInput, ChipButton } from '../ui/Field';
import { Toast, useToast } from '../ui/Toast';
import { useConfirm } from '../ui/ConfirmDialog';
import { PageHeader } from '../ui/PageHeader';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  TableRowActions,
  RowActionButton,
  TableEmptyRow,
  TableSkeletonRows,
  useTablePage,
  TablePagination
} from '../ui/Table';
import { DetailDrawer, DetailSection, DetailBlock, DetailField, DetailStats, RowDetailButton } from '../ui/DetailDrawer';

/*
 * Catatan Keuangan Harian.
 *
 * The PJ writes down each day's spending after checking the receipt, marks
 * who fronted the money, and pays it back when they can, usually in the
 * afternoon. What is still owed stays at the top of the page, grouped by
 * person, until it is settled. Everyone else sees the same page without the
 * buttons; the server refuses their writes regardless.
 */

const isStockItem = (r: any): r is InventoryItem =>
  typeof r?.name === 'string' && r?.stock !== undefined && r?.stock !== null && !Number.isNaN(Number(r.stock));

const TYPE_ICON: Record<DailyCashType, React.ElementType> = {
  Pengiriman: Truck,
  'Stok Gudang': Boxes,
  Lainnya: ReceiptText
};

const TYPE_HINT: Record<DailyCashType, string> = {
  Pengiriman: 'Ongkir surat jalan yang dibayar HIJ. Nominal tercatat di surat jalannya.',
  'Stok Gudang': 'Belanja barang stok gudang. Stok barangnya langsung bertambah.',
  Lainnya: 'Pengeluaran di luar pengiriman dan stok gudang. Kategori diisi sendiri.'
};

const statusBadge = (entry: DailyCashEntry) => {
  if (entry.status === 'Dibatalkan') return <Badge variant="idle" size="sm">Dibatalkan</Badge>;
  if (entry.status === 'Lunas') return <Badge variant="done" size="sm">Lunas</Badge>;
  return <Badge variant="warning" size="sm">Belum diganti</Badge>;
};

const ageLabel = (days: number) => `sudah ${days} hari`;

const emptyForm = (): DailyCashInput => ({
  type: 'Lainnya',
  date: todayLocal(),
  amount: 0,
  paidWith: 'Ditalangi',
  payerName: '',
  orderId: '',
  itemName: '',
  category: '',
  shipmentId: '',
  stockItemId: '',
  qty: 0,
  notes: ''
});

interface PayerGroup {
  key: string;
  name: string;
  entries: DailyCashEntry[];
  total: number;
  oldestDays: number;
}

export const DailyCashModule: React.FC = () => {
  const { toast, showToast } = useToast();
  const { ask, confirmDialog } = useConfirm();

  const [entries, setEntries] = useState<DailyCashEntry[]>([]);
  const [settings, setSettings] = useState<DailyCashSettings | null>(null);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [stockItems, setStockItems] = useState<InventoryItem[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [payerFilter, setPayerFilter] = useState('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Entry form
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<DailyCashInput>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Settlement
  const [settlePayer, setSettlePayer] = useState<PayerGroup | null>(null);
  const [settleIds, setSettleIds] = useState<string[]>([]);
  const [settleMethod, setSettleMethod] = useState<'Transfer' | 'Tunai'>('Transfer');
  const [settleDate, setSettleDate] = useState(todayLocal());
  const [settleError, setSettleError] = useState<string | null>(null);
  const [settling, setSettling] = useState(false);

  // PJ appointment (Super Admin)
  const [isPjModalOpen, setIsPjModalOpen] = useState(false);
  const [staff, setStaff] = useState<StaffDirectoryEntry[]>([]);
  const [pjChoice, setPjChoice] = useState('');
  const [pjError, setPjError] = useState<string | null>(null);

  const [detailId, setDetailId] = useState<string | null>(null);

  const isPj = !!settings?.isPj;

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const [entryRes, settingsRes, shipmentRes, materialRes, orderRes] = await Promise.all([
        fetchResource<DailyCashEntry>('daily-cash'),
        fetchDailyCashSettingsApi(),
        fetchResource<Shipment>('shipments'),
        fetchResource<any>('raw-materials'),
        fetchResource<Order>('orders')
      ]);
      setEntries(entryRes || []);
      setSettings(settingsRes);
      setShipments(shipmentRes || []);
      setStockItems((materialRes || []).filter(isStockItem));
      setOrders(orderRes || []);
    } catch (err: any) {
      setLoadError(err?.message || 'Catatan harian gagal dimuat. Periksa koneksi ke server, lalu muat ulang halaman.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ------------------------------------------------------------ derived

  const counted = useMemo(() => entries.filter(isCounted), [entries]);
  const today = todayLocal();
  const monthPrefix = today.slice(0, 7);
  const todayTotal = counted.filter(e => e.date === today).reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const monthEntries = counted.filter(e => String(e.date).startsWith(monthPrefix));
  const monthTotal = monthEntries.reduce((s, e) => s + (Number(e.amount) || 0), 0);

  /** What the office still owes, one group per person, longest-waiting first. */
  const payerGroups = useMemo<PayerGroup[]>(() => {
    const groups = new Map<string, PayerGroup>();
    for (const entry of entries.filter(isOpenTalangan)) {
      const key = payerKey(entry.payerName);
      const group = groups.get(key) || { key, name: entry.payerName || '-', entries: [], total: 0, oldestDays: 0 };
      group.entries.push(entry);
      group.total += Number(entry.amount) || 0;
      group.oldestDays = Math.max(group.oldestDays, ageInDays(entry.timestamp));
      groups.set(key, group);
    }
    return [...groups.values()]
      .map(g => ({ ...g, entries: [...g.entries].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp))) }))
      .sort((a, b) => b.oldestDays - a.oldestDays || b.total - a.total);
  }, [entries]);
  const openTotal = payerGroups.reduce((s, g) => s + g.total, 0);

  /** Surat jalan whose ongkir HIJ pays but that nobody has written down yet. */
  const shipmentsToRecord = useMemo(() => {
    const recorded = new Set(counted.filter(e => e.shipmentId).map(e => e.shipmentId));
    return newestFirst(shipments.filter(s => s.paidBy === 'Pengirim' && !recorded.has(s.id)));
  }, [shipments, counted]);

  const payerNames = useMemo(() => distinctNames(entries.map(e => e.payerName)), [entries]);
  const categories = useMemo(() => distinctNames(entries.map(e => e.category)), [entries]);
  const otherCategories = useMemo(
    () => distinctNames(entries.filter(e => e.type === 'Lainnya').map(e => e.category)),
    [entries]
  );

  const orderLabel = (orderId?: string) => {
    if (!orderId) return '';
    const order = orders.find(o => o.id === orderId);
    return order?.po || orderId;
  };

  const query = searchQuery.trim().toLowerCase();
  const filteredEntries = useMemo(
    () =>
      newestFirst(
        entries.filter(e => {
          if (typeFilter !== 'ALL' && e.type !== typeFilter) return false;
          if (categoryFilter !== 'ALL' && payerKey(e.category) !== payerKey(categoryFilter)) return false;
          if (statusFilter !== 'ALL' && e.status !== statusFilter) return false;
          if (payerFilter !== 'ALL' && payerKey(e.payerName) !== payerKey(payerFilter)) return false;
          if (dateFrom && String(e.date) < dateFrom) return false;
          if (dateTo && String(e.date) > dateTo) return false;
          if (!query) return true;
          return [e.id, e.itemName, e.category, e.payerName, e.orderId, orderLabel(e.orderId), e.notes]
            .some(v => String(v || '').toLowerCase().includes(query));
        })
      ),
    // orderLabel only reads orders
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, typeFilter, categoryFilter, statusFilter, payerFilter, dateFrom, dateTo, query, orders]
  );
  const filteredTotal = filteredEntries.filter(isCounted).reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const isFiltered =
    !!query || typeFilter !== 'ALL' || categoryFilter !== 'ALL' || statusFilter !== 'ALL' || payerFilter !== 'ALL' || !!dateFrom || !!dateTo;

  const { pageRows, pagination } = useTablePage(filteredEntries);
  const detailEntry = detailId ? entries.find(e => e.id === detailId) ?? null : null;

  // ------------------------------------------------------------ form

  const openCreate = (prefill: Partial<DailyCashInput> = {}) => {
    setEditingId(null);
    setForm({ ...emptyForm(), ...prefill });
    setFormError(null);
    setIsFormOpen(true);
  };

  const openEdit = (entry: DailyCashEntry) => {
    setEditingId(entry.id);
    setForm({
      type: entry.type,
      date: entry.date,
      amount: Number(entry.amount) || 0,
      paidWith: entry.paidWith,
      payerName: entry.payerName || '',
      orderId: entry.orderId || '',
      itemName: entry.type === 'Lainnya' ? entry.itemName : '',
      category: entry.type === 'Lainnya' ? entry.category : '',
      shipmentId: entry.shipmentId || '',
      stockItemId: entry.stockItemId || '',
      qty: Number(entry.qty) || 0,
      notes: entry.notes || ''
    });
    setFormError(null);
    setIsFormOpen(true);
  };

  const editingEntry = editingId ? entries.find(e => e.id === editingId) ?? null : null;
  /** A settled talangan keeps its amount, payer and payment until it is reopened. */
  const moneyLocked = !!editingEntry && editingEntry.paidWith === 'Ditalangi' && editingEntry.status === 'Lunas';

  const shipmentChoices = useMemo(() => {
    const recordedElsewhere = new Set(
      counted.filter(e => e.shipmentId && e.id !== editingId).map(e => e.shipmentId)
    );
    return newestFirst(shipments.filter(s => s.paidBy === 'Pengirim' && !recordedElsewhere.has(s.id)));
  }, [shipments, counted, editingId]);

  const selectedShipment = shipments.find(s => s.id === form.shipmentId);
  const selectedStock = stockItems.find(i => i.id === form.stockItemId);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const problems: string[] = [];
    if (form.type === 'Pengiriman' && !form.shipmentId) problems.push('Pilih surat jalan.');
    if (form.type === 'Stok Gudang') {
      if (!form.stockItemId) problems.push('Pilih barang stok gudang.');
      if (!(Number(form.qty) > 0)) problems.push('Isi jumlah barang.');
    }
    if (form.type === 'Lainnya') {
      if (!form.itemName?.trim()) problems.push('Isi nama barang atau keperluannya.');
      if (!form.category?.trim()) problems.push('Isi kategori.');
    }
    if (!(Number(form.amount) > 0)) problems.push('Isi nominal.');
    if (form.paidWith === 'Ditalangi' && !form.payerName?.trim()) problems.push('Isi nama yang menalangi.');
    if (problems.length > 0) {
      setFormError(problems.join(' '));
      return;
    }

    const payload: DailyCashInput = {
      ...form,
      amount: Math.round(Number(form.amount)),
      qty: Number(form.qty) || 0,
      payerName: form.paidWith === 'Ditalangi' ? form.payerName : ''
    };
    try {
      setSaving(true);
      setFormError(null);
      const saved = editingId
        ? await updateDailyCashEntryApi(editingId, payload)
        : await createDailyCashEntryApi(payload);
      setIsFormOpen(false);
      showToast(editingId ? `${saved.id} diperbarui.` : `${saved.id} dicatat.`);
      await loadData();
    } catch (err: any) {
      setFormError(err?.message || 'Catatan gagal disimpan. Coba lagi.');
    } finally {
      setSaving(false);
    }
  };

  // ------------------------------------------------------------ status actions

  const openSettle = (group: PayerGroup, onlyId?: string) => {
    setSettlePayer(group);
    setSettleIds(onlyId ? [onlyId] : group.entries.map(e => e.id));
    setSettleMethod('Transfer');
    setSettleDate(todayLocal());
    setSettleError(null);
  };

  const openSettleFor = (entry: DailyCashEntry) => {
    const group = payerGroups.find(g => g.key === payerKey(entry.payerName));
    if (group) openSettle(group, entry.id);
  };

  const settleTotal = settlePayer
    ? settlePayer.entries.filter(e => settleIds.includes(e.id)).reduce((s, e) => s + (Number(e.amount) || 0), 0)
    : 0;

  const handleSettle = async () => {
    if (!settlePayer || settling) return;
    if (settleIds.length === 0) {
      setSettleError('Centang minimal satu catatan yang dilunasi.');
      return;
    }
    try {
      setSettling(true);
      setSettleError(null);
      await settleDailyCashApi(settleIds, settleMethod, settleDate);
      showToast(`${settleIds.length} catatan ${settlePayer.name} lunas (${formatCurrency(settleTotal)}).`);
      setSettlePayer(null);
      await loadData();
    } catch (err: any) {
      setSettleError(err?.message || 'Pelunasan gagal disimpan. Coba lagi.');
    } finally {
      setSettling(false);
    }
  };

  const handleCancel = async (entry: DailyCashEntry) => {
    const reason = await ask({
      title: `Batalkan ${entry.id}?`,
      message:
        entry.type === 'Stok Gudang'
          ? 'Catatan tetap tersimpan sebagai riwayat, dan stok barangnya dikurangi kembali.'
          : 'Catatan tetap tersimpan sebagai riwayat dan tidak dihitung lagi sebagai pengeluaran.',
      inputLabel: 'Alasan pembatalan',
      placeholder: 'Mis. salah catat, nota dobel',
      required: true,
      confirmLabel: 'Batalkan Catatan',
      tone: 'danger'
    });
    if (!reason) return;
    try {
      await cancelDailyCashEntryApi(entry.id, reason);
      showToast(`${entry.id} dibatalkan.`);
      await loadData();
    } catch (err: any) {
      showToast(err?.message || 'Catatan gagal dibatalkan.', 'error');
    }
  };

  const handleReopen = async (entry: DailyCashEntry) => {
    const reason = await ask({
      title: `Kembalikan ${entry.id} ke Belum Diganti?`,
      message: `Talangan ${entry.payerName} ${formatCurrency(entry.amount)} akan muncul lagi di daftar yang belum diganti.`,
      inputLabel: 'Alasan',
      placeholder: 'Mis. salah centang saat pelunasan',
      required: true,
      confirmLabel: 'Kembalikan'
    });
    if (!reason) return;
    try {
      await reopenDailyCashEntryApi(entry.id, reason);
      showToast(`${entry.id} kembali ke Belum Diganti.`);
      await loadData();
    } catch (err: any) {
      showToast(err?.message || 'Status gagal dikembalikan.', 'error');
    }
  };

  const openPjModal = async () => {
    setPjError(null);
    setPjChoice(settings?.pjUserId || '');
    setIsPjModalOpen(true);
    setStaff(await fetchStaffDirectory());
  };

  const handleSavePj = async () => {
    if (!pjChoice) {
      setPjError('Pilih akun yang menjadi PJ.');
      return;
    }
    try {
      const saved = await saveDailyCashPjApi(pjChoice);
      setIsPjModalOpen(false);
      showToast(`PJ Catatan Harian sekarang ${saved.pjName}.`);
      await loadData();
    } catch (err: any) {
      setPjError(err?.message || 'PJ gagal diganti.');
    }
  };

  const handleExport = () => {
    exportTableToExcel(
      filteredEntries.map(e => ({
        'No. Catatan': e.id,
        Tanggal: formatDate(e.date),
        Jenis: e.type,
        Barang: e.itemName,
        Kategori: e.category,
        Pesanan: orderLabel(e.orderId) || '-',
        Nominal: Number(e.amount) || 0,
        'Dibayar Pakai': e.paidWith,
        Penalang: e.payerName || '-',
        Status: e.status,
        'Tanggal Lunas': e.settledAt ? formatDate(e.settledAt) : '-',
        'Cara Lunas': e.settleMethod || '-',
        Catatan: e.notes || '-'
      })),
      `Catatan_Keuangan_Harian_${todayLocal()}`,
      'Catatan Harian'
    );
  };

  const filterClass = 'h-10 w-full text-sm bg-white border border-slate-300 rounded-lg px-3 text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-600';

  // ------------------------------------------------------------ render

  return (
    <div className="space-y-6">
      <Toast toast={toast} />
      {confirmDialog}

      <PageHeader
        title="Catatan Keuangan Harian"
        description="Pengeluaran harian dan talangan personil yang harus diganti. Dicatat setelah nota diterima PJ."
        actions={
          <>
            {settings?.canChangePj && (
              <Button variant="outline" size="sm" onClick={openPjModal}>
                <UserCog size={16} aria-hidden="true" /> Ganti PJ
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={handleExport} disabled={filteredEntries.length === 0}>
              <Download size={16} aria-hidden="true" /> Unduh Excel
            </Button>
            {isPj && (
              <Button size="sm" onClick={() => openCreate()}>
                <Plus size={16} aria-hidden="true" /> Catat Pengeluaran
              </Button>
            )}
          </>
        }
      />

      <FormError>{loadError}</FormError>

      {settings && !isPj && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-xl border border-border bg-slate-50 px-3.5 py-2.5 text-sm text-slate-700"
        >
          <Eye size={16} className="mt-0.5 shrink-0 text-slate-500" aria-hidden="true" />
          <span>
            {settings.pjName
              ? <>Catatan ini diisi dan dilunasi oleh <b>{settings.pjName}</b>. Akun Anda hanya bisa melihat.</>
              : <>PJ Catatan Harian belum ditunjuk. {settings.canChangePj ? 'Tunjuk lewat tombol Ganti PJ.' : 'Hubungi Super Admin.'}</>}
          </span>
        </p>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Card className="p-4 flex items-center gap-3.5 min-w-0">
          <div className="hidden sm:flex w-10 h-10 rounded-lg bg-teal-50 text-brand-teal-dark items-center justify-center shrink-0" aria-hidden="true">
            <CalendarDays className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="text-sm text-slate-500">Pengeluaran Hari Ini</div>
            <div className="text-base sm:text-lg font-bold text-slate-900 tabular-nums whitespace-nowrap truncate mt-0.5" title={formatCurrency(todayTotal)}>
              {formatCurrency(todayTotal)}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">{counted.filter(e => e.date === today).length} catatan</div>
          </div>
        </Card>
        <Card className="p-4 flex items-center gap-3.5 min-w-0">
          <div className="hidden sm:flex w-10 h-10 rounded-lg bg-blue-50 text-blue-700 items-center justify-center shrink-0" aria-hidden="true">
            <Wallet className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="text-sm text-slate-500">Pengeluaran Bulan Ini</div>
            <div className="text-base sm:text-lg font-bold text-slate-900 tabular-nums whitespace-nowrap truncate mt-0.5" title={formatCurrency(monthTotal)}>
              {formatCurrency(monthTotal)}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">{monthEntries.length} catatan</div>
          </div>
        </Card>
        <Card className="p-4 flex items-center gap-3.5 min-w-0">
          <div className="hidden sm:flex w-10 h-10 rounded-lg bg-amber-50 text-amber-700 items-center justify-center shrink-0" aria-hidden="true">
            <HandCoins className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="text-sm text-slate-500">Talangan Belum Diganti</div>
            <div className="text-base sm:text-lg font-bold text-amber-800 tabular-nums whitespace-nowrap truncate mt-0.5" title={formatCurrency(openTotal)}>
              {formatCurrency(openTotal)}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">{payerGroups.length} orang</div>
          </div>
        </Card>
        <Card className="p-4 flex items-center gap-3.5 min-w-0">
          <div className="hidden sm:flex w-10 h-10 rounded-lg bg-rose-50 text-brand-red items-center justify-center shrink-0" aria-hidden="true">
            <Truck className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="text-sm text-slate-500">Ongkir Belum Dicatat</div>
            <div className="text-base sm:text-lg font-bold text-slate-900 tabular-nums whitespace-nowrap mt-0.5">{shipmentsToRecord.length}</div>
            <div className="text-xs text-slate-500 mt-0.5">Surat jalan dibayar HIJ</div>
          </div>
        </Card>
      </div>

      {/* Owed to people, longest waiting first */}
      <Card className="p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-bold text-slate-900">Belum Diganti</h2>
          <span className="text-sm text-slate-500">Dihitung dari tanggal catatan dibuat</span>
        </div>
        {loading ? (
          <div className="h-16 rounded-xl bg-muted/50 animate-pulse" />
        ) : payerGroups.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-5 text-center text-sm text-slate-500">
            Semua talangan sudah diganti.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {payerGroups.map(group => (
              <li key={group.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-slate-900 truncate">{group.name}</div>
                  <div className="text-sm text-slate-500">
                    {group.entries.length} catatan · tertua {ageLabel(group.oldestDays)}
                  </div>
                </div>
                <div className="text-right font-bold tabular-nums text-slate-900">{formatCurrency(group.total)}</div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setPayerFilter(group.name);
                      setStatusFilter('Belum Diganti');
                    }}
                  >
                    Lihat
                  </Button>
                  {isPj && (
                    <Button size="sm" onClick={() => openSettle(group)}>
                      <HandCoins size={16} aria-hidden="true" /> Lunasi
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Surat jalan waiting to be written down */}
      {!loading && shipmentsToRecord.length > 0 && (
        <Card className="p-4 sm:p-5 space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-bold text-slate-900">Ongkir Perlu Dicatat</h2>
            <span className="text-sm text-slate-500">Surat jalan yang ongkirnya dibayar HIJ</span>
          </div>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {shipmentsToRecord.slice(0, 8).map(s => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-slate-900">
                    <span className="font-mono">{s.id}</span> · {s.courier || 'Kurir'}
                  </div>
                  <div className="text-sm text-slate-500 truncate">
                    {orderLabel(s.orderId)} · {s.customerName}
                    {Number(s.shippingCost) > 0 && <> · perkiraan {formatCurrency(s.shippingCost)}</>}
                  </div>
                </div>
                {isPj && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      openCreate({ type: 'Pengiriman', shipmentId: s.id, amount: Number(s.shippingCost) || 0 })
                    }
                  >
                    <NotebookPen size={16} aria-hidden="true" /> Catat Ongkir
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {shipmentsToRecord.length > 8 && (
            <p className="text-sm text-slate-500">dan {shipmentsToRecord.length - 8} surat jalan lainnya.</p>
          )}
        </Card>
      )}

      {/* Filters */}
      <Card className="p-4 space-y-3">
        <div className="relative w-full">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <Input
            type="search"
            aria-label="Cari catatan"
            placeholder="Cari barang, kategori, penalang, pesanan, atau no. catatan…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} aria-label="Filter jenis" className={filterClass}>
            <option value="ALL">Semua jenis</option>
            {DAILY_CASH_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} aria-label="Filter kategori" className={filterClass}>
            <option value="ALL">Semua kategori</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} aria-label="Filter status" className={filterClass}>
            <option value="ALL">Semua status</option>
            <option value="Belum Diganti">Belum diganti</option>
            <option value="Lunas">Lunas</option>
            <option value="Dibatalkan">Dibatalkan</option>
          </select>
          <select value={payerFilter} onChange={e => setPayerFilter(e.target.value)} aria-label="Filter penalang" className={filterClass}>
            <option value="ALL">Semua penalang</option>
            {payerNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <Input type="date" aria-label="Dari tanggal" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          <Input type="date" aria-label="Sampai tanggal" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        </div>
        {isFiltered && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-slate-600">
              {filteredEntries.length} catatan · total {formatCurrency(filteredTotal)} (tanpa yang dibatalkan)
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchQuery('');
                setTypeFilter('ALL');
                setCategoryFilter('ALL');
                setStatusFilter('ALL');
                setPayerFilter('ALL');
                setDateFrom('');
                setDateTo('');
              }}
            >
              Hapus filter
            </Button>
          </div>
        )}
      </Card>

      {/* Entries */}
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="cell-sticky-start">Tanggal</TableHead>
              <TableHead>Barang / Jenis</TableHead>
              <TableHead className="hidden lg:table-cell">Kategori</TableHead>
              <TableHead className="hidden 2xl:table-cell">Pesanan</TableHead>
              <TableHead className="text-right tabular-nums">Nominal</TableHead>
              <TableHead className="hidden md:table-cell">Dibayar / Penalang</TableHead>
              <TableHead className="hidden sm:table-cell">Status</TableHead>
              <TableHead className="cell-sticky-end text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableSkeletonRows columns={8} />
            ) : filteredEntries.length === 0 ? (
              <TableEmptyRow
                colSpan={8}
                icon={<NotebookPen size={20} />}
                title={isFiltered && entries.length > 0 ? 'Tidak ada catatan yang cocok' : 'Belum ada pengeluaran dicatat'}
                description={
                  isFiltered && entries.length > 0
                    ? 'Coba kata kunci lain atau ubah filter.'
                    : isPj
                      ? 'Klik "Catat Pengeluaran" setelah menerima nota.'
                      : 'Catatan muncul di sini setelah PJ mencatat pengeluaran.'
                }
              />
            ) : (
              pageRows.map(entry => {
                const open = isOpenTalangan(entry);
                const cancelled = entry.status === 'Dibatalkan';
                const TypeIcon = TYPE_ICON[entry.type] || ReceiptText;
                return (
                  <TableRow key={entry.id} className={cancelled ? 'opacity-60' : undefined}>
                    <TableCell className="cell-sticky-start whitespace-nowrap">
                      <span className="block font-medium text-slate-900">{formatDate(entry.date)}</span>
                      <span className="block font-mono text-xs text-slate-500">{entry.id}</span>
                    </TableCell>
                    <TableCell>
                      <span className={`block max-w-[240px] truncate font-semibold text-slate-900 ${cancelled ? 'line-through' : ''}`} title={entry.itemName}>
                        {entry.itemName}
                      </span>
                      <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-slate-500">
                        <TypeIcon size={13} aria-hidden="true" /> {entry.type}
                        <span className="lg:hidden">· {entry.category}</span>
                      </span>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <Badge variant="idle" size="sm">{entry.category}</Badge>
                    </TableCell>
                    <TableCell className="hidden 2xl:table-cell font-mono text-slate-700">{orderLabel(entry.orderId) || '—'}</TableCell>
                    <TableCell className="text-right tabular-nums font-bold text-slate-900 whitespace-nowrap">
                      {formatCurrency(entry.amount)}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <span className="block whitespace-nowrap text-slate-700">{entry.paidWith}</span>
                      {entry.payerName && (
                        <span className="block max-w-[160px] truncate text-xs font-semibold text-slate-900" title={entry.payerName}>
                          {entry.payerName}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell whitespace-nowrap">
                      {statusBadge(entry)}
                      {open && <span className="mt-0.5 block text-xs text-slate-500">{ageLabel(ageInDays(entry.timestamp))}</span>}
                    </TableCell>
                    <TableCell className="cell-sticky-end text-right">
                      <TableRowActions>
                        {isPj && open && (
                          <RowActionButton
                            label="Lunasi"
                            icon={HandCoins}
                            display="labeled"
                            tone="primary"
                            onClick={() => openSettleFor(entry)}
                            ariaLabel={`Lunasi ${entry.id}`}
                          />
                        )}
                        {isPj && !cancelled && (
                          <RowActionButton
                            label="Ubah"
                            icon={Pencil}
                            onClick={() => openEdit(entry)}
                            ariaLabel={`Ubah ${entry.id}`}
                          />
                        )}
                        <RowDetailButton label={entry.id} onClick={() => setDetailId(entry.id)} />
                      </TableRowActions>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
        <TablePagination {...pagination} label="catatan" />
      </Card>

      {/* Detail */}
      <DetailDrawer
        isOpen={!!detailEntry}
        onClose={() => setDetailId(null)}
        title={detailEntry?.itemName}
        subtitle={detailEntry && <span className="font-mono">{detailEntry.id} · {formatDate(detailEntry.date)}</span>}
        status={detailEntry && statusBadge(detailEntry)}
        footer={
          detailEntry && isPj && detailEntry.status !== 'Dibatalkan' && (
            <>
              {isOpenTalangan(detailEntry) && (
                <Button
                  size="sm"
                  onClick={() => {
                    setDetailId(null);
                    openSettleFor(detailEntry);
                  }}
                >
                  <HandCoins size={16} aria-hidden="true" /> Lunasi
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDetailId(null);
                  openEdit(detailEntry);
                }}
              >
                <Pencil size={16} aria-hidden="true" /> Ubah
              </Button>
              {detailEntry.paidWith === 'Ditalangi' && detailEntry.status === 'Lunas' ? (
                <Button variant="outline" size="sm" onClick={() => handleReopen(detailEntry)}>
                  <Undo2 size={16} aria-hidden="true" /> Kembalikan ke Belum Diganti
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-brand-red hover:bg-rose-50 hover:text-brand-red"
                  onClick={() => handleCancel(detailEntry)}
                >
                  <Ban size={16} aria-hidden="true" /> Batalkan
                </Button>
              )}
            </>
          )
        }
      >
        {detailEntry && (
          <>
            <DetailStats
              items={[
                { label: 'Nominal', value: formatCurrency(detailEntry.amount), tone: 'accent' },
                { label: 'Dibayar pakai', value: detailEntry.paidWith },
                {
                  label: isOpenTalangan(detailEntry) ? 'Umur' : 'Status',
                  value: isOpenTalangan(detailEntry) ? ageLabel(ageInDays(detailEntry.timestamp)) : detailEntry.status
                }
              ]}
            />
            <DetailSection title="Catatan">
              <DetailField label="Jenis">{detailEntry.type}</DetailField>
              <DetailField label="Kategori">{detailEntry.category}</DetailField>
              <DetailField label="Barang" full>{detailEntry.itemName}</DetailField>
              {detailEntry.shipmentId && <DetailField label="Surat jalan" mono>{detailEntry.shipmentId}</DetailField>}
              {detailEntry.stockReceiptId && (
                <DetailField label="Stok masuk" mono>{detailEntry.stockReceiptId}</DetailField>
              )}
              <DetailField label="Pesanan" mono>{orderLabel(detailEntry.orderId) || '-'}</DetailField>
              <DetailField label="Tanggal">{formatDate(detailEntry.date)}</DetailField>
              <DetailField label="Dicatat">{formatDateTime(detailEntry.timestamp)}</DetailField>
              {detailEntry.notes && <DetailField label="Keterangan" full>{detailEntry.notes}</DetailField>}
            </DetailSection>
            <DetailSection title="Pembayaran">
              <DetailField label="Penalang">{detailEntry.payerName || '-'}</DetailField>
              <DetailField label="Status">{detailEntry.status}</DetailField>
              {detailEntry.status === 'Lunas' && (
                <>
                  <DetailField label="Tanggal lunas">{formatDate(detailEntry.settledAt)}</DetailField>
                  <DetailField label="Cara">{detailEntry.settleMethod || '-'}</DetailField>
                  <DetailField label="Oleh">{detailEntry.settledBy || '-'}</DetailField>
                </>
              )}
              {detailEntry.status === 'Dibatalkan' && (
                <DetailField label="Alasan batal" full>{detailEntry.cancelReason || '-'}</DetailField>
              )}
            </DetailSection>
            <DetailBlock title="Riwayat">
              <ol className="space-y-2 text-sm">
                {[...(detailEntry.history || [])].reverse().map((item, index) => (
                  <li key={`${item.at}-${index}`} className="rounded-lg border border-border px-3 py-2">
                    <div className="font-semibold text-slate-900">{item.action}</div>
                    <div className="text-xs text-slate-500">{formatDateTime(item.at)} · {item.by}</div>
                    {item.note && <div className="mt-1 text-slate-700">{item.note}</div>}
                  </li>
                ))}
              </ol>
            </DetailBlock>
          </>
        )}
      </DetailDrawer>

      {/* Create / edit */}
      <Modal
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        title={editingId ? `Ubah ${editingId}` : 'Catat Pengeluaran'}
        subtitle="Isi setelah nota diterima dan dicek."
        maxWidth="2xl"
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="outline" disabled={saving} onClick={() => setIsFormOpen(false)}>
              Batal
            </Button>
            <Button type="submit" form="daily-cash-form" disabled={saving}>
              {saving ? 'Menyimpan…' : editingId ? 'Simpan Perubahan' : 'Simpan Catatan'}
            </Button>
          </div>
        }
      >
        <form id="daily-cash-form" noValidate onSubmit={handleSave} className="space-y-5">
          <FormError>{formError}</FormError>

          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-slate-700">Jenis</legend>
            <div className="flex flex-wrap gap-2">
              {DAILY_CASH_TYPES.map(type => (
                <ChipButton
                  key={type}
                  selected={form.type === type}
                  aria-pressed={form.type === type}
                  onClick={() => setForm({ ...form, type })}
                >
                  {type}
                </ChipButton>
              ))}
            </div>
            <FieldHint>{TYPE_HINT[form.type]}</FieldHint>
          </fieldset>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel htmlFor="dc-date" required>Tanggal</FieldLabel>
              <Input id="dc-date" type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
            </div>
            <div>
              <FieldLabel htmlFor="dc-amount" required>Nominal</FieldLabel>
              <CurrencyInput
                id="dc-amount"
                value={form.amount || ''}
                disabled={moneyLocked}
                onChange={e => setForm({ ...form, amount: Number(e.target.value) })}
              />
            </div>
          </div>

          {form.type === 'Pengiriman' && (
            <div>
              <FieldLabel htmlFor="dc-shipment" required>Surat jalan</FieldLabel>
              <Select id="dc-shipment" value={form.shipmentId} onChange={e => setForm({ ...form, shipmentId: e.target.value })}>
                <option value="">Pilih surat jalan…</option>
                {shipmentChoices.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.id} · {s.courier || 'Kurir'} · {orderLabel(s.orderId)} · {s.customerName}
                  </option>
                ))}
              </Select>
              <FieldHint>
                {selectedShipment
                  ? <>Pesanan {orderLabel(selectedShipment.orderId)}. Barang dan kategori terisi otomatis.</>
                  : 'Hanya surat jalan yang ongkirnya dibayar HIJ dan belum dicatat.'}
              </FieldHint>
            </div>
          )}

          {form.type === 'Stok Gudang' && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <FieldLabel htmlFor="dc-stock" required>Barang stok gudang</FieldLabel>
                <Select id="dc-stock" value={form.stockItemId} onChange={e => setForm({ ...form, stockItemId: e.target.value })}>
                  <option value="">Pilih barang…</option>
                  {[...stockItems].sort((a, b) => a.name.localeCompare(b.name, 'id')).map(item => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.category} · stok {Number(item.stock).toLocaleString('id-ID')} {item.unit}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <FieldLabel htmlFor="dc-qty" required>Jumlah{selectedStock ? ` (${selectedStock.unit})` : ''}</FieldLabel>
                <Input
                  id="dc-qty"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={form.qty || ''}
                  onChange={e => setForm({ ...form, qty: Number(e.target.value) })}
                />
              </div>
              <FieldHint className="sm:col-span-3">
                Stok barang bertambah saat disimpan dan tercatat di riwayat stok masuk Gudang. Kategori mengikuti kategori barangnya.
              </FieldHint>
            </div>
          )}

          {form.type === 'Lainnya' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <FieldLabel htmlFor="dc-item" required>Barang / keperluan</FieldLabel>
                <Input
                  id="dc-item"
                  value={form.itemName}
                  maxLength={120}
                  placeholder="Mis. Bensin antar kain ke penjahit"
                  onChange={e => setForm({ ...form, itemName: e.target.value })}
                />
              </div>
              <div>
                <FieldLabel htmlFor="dc-category" required>Kategori</FieldLabel>
                <Input
                  id="dc-category"
                  list="dc-category-suggestions"
                  value={form.category}
                  maxLength={60}
                  placeholder="Mis. Transport"
                  onChange={e => setForm({ ...form, category: e.target.value })}
                />
                <datalist id="dc-category-suggestions">
                  {otherCategories.map(c => <option key={c} value={c} />)}
                </datalist>
                <FieldHint>Pilih dari saran supaya kategori yang sama tidak tercatat dua kali.</FieldHint>
              </div>
            </div>
          )}

          {form.type !== 'Pengiriman' && (
            <div>
              <FieldLabel htmlFor="dc-order">Pesanan (opsional)</FieldLabel>
              <Select id="dc-order" value={form.orderId} onChange={e => setForm({ ...form, orderId: e.target.value })}>
                <option value="">Tidak terkait pesanan</option>
                {newestFirst(orders.filter(o => o.status !== 'Cancelled')).map(o => (
                  <option key={o.id} value={o.id}>{o.po || o.id} · {o.customerName} · {o.productType}</option>
                ))}
              </Select>
            </div>
          )}

          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-slate-700">Dibayar pakai</legend>
            <div className="flex flex-wrap gap-2">
              {(['Ditalangi', 'Kas Kantor'] as const).map(option => (
                <ChipButton
                  key={option}
                  selected={form.paidWith === option}
                  aria-pressed={form.paidWith === option}
                  disabled={moneyLocked}
                  onClick={() => setForm({ ...form, paidWith: option })}
                >
                  {option}
                </ChipButton>
              ))}
            </div>
            <FieldHint>
              {form.paidWith === 'Kas Kantor'
                ? 'Dibayar langsung pakai uang kantor, jadi langsung tercatat Lunas.'
                : 'Seseorang memakai uangnya sendiri. Masuk daftar Belum Diganti sampai dilunasi.'}
            </FieldHint>
          </fieldset>

          {form.paidWith === 'Ditalangi' && (
            <div>
              <FieldLabel htmlFor="dc-payer" required>Nama yang menalangi</FieldLabel>
              <Input
                id="dc-payer"
                list="dc-payer-suggestions"
                value={form.payerName}
                maxLength={60}
                disabled={moneyLocked}
                placeholder="Mis. Asep Kurir"
                onChange={e => setForm({ ...form, payerName: e.target.value })}
              />
              <datalist id="dc-payer-suggestions">
                {payerNames.map(n => <option key={n} value={n} />)}
              </datalist>
              <FieldHint>
                Pilih nama yang sudah ada kalau orangnya sama. Untuk dua orang bernama sama, bedakan penulisannya, misalnya "Asep Gudang" dan "Asep Kurir".
              </FieldHint>
            </div>
          )}

          {moneyLocked && (
            <FieldHint className="text-amber-800">
              Catatan ini sudah dilunasi, jadi nominal, cara bayar, dan penalang terkunci. Kembalikan ke Belum Diganti dulu kalau perlu diubah.
            </FieldHint>
          )}

          <div>
            <FieldLabel htmlFor="dc-notes">Keterangan (opsional)</FieldLabel>
            <Textarea
              id="dc-notes"
              rows={2}
              value={form.notes}
              maxLength={300}
              onChange={e => setForm({ ...form, notes: e.target.value })}
            />
          </div>
        </form>
      </Modal>

      {/* Settle */}
      <Modal
        isOpen={!!settlePayer}
        onClose={() => setSettlePayer(null)}
        title={settlePayer ? `Lunasi talangan ${settlePayer.name}` : 'Lunasi'}
        subtitle="Centang catatan yang dibayar sekarang."
        maxWidth="xl"
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold text-slate-900 tabular-nums">Total {formatCurrency(settleTotal)}</span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" disabled={settling} onClick={() => setSettlePayer(null)}>
                Batal
              </Button>
              <Button type="button" disabled={settling || settleIds.length === 0} onClick={handleSettle}>
                {settling ? 'Menyimpan…' : `Tandai Lunas (${settleIds.length})`}
              </Button>
            </div>
          </div>
        }
      >
        {settlePayer && (
          <div className="space-y-4">
            <FormError>{settleError}</FormError>
            <ul className="divide-y divide-border rounded-xl border border-border">
              {settlePayer.entries.map(entry => {
                const checked = settleIds.includes(entry.id);
                return (
                  <li key={entry.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-4 py-3">
                      <input
                        type="checkbox"
                        className="size-4 accent-teal-700"
                        checked={checked}
                        onChange={() =>
                          setSettleIds(checked ? settleIds.filter(id => id !== entry.id) : [...settleIds, entry.id])
                        }
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-slate-900">{entry.itemName}</span>
                        <span className="block text-xs text-slate-500">
                          {entry.id} · {formatDate(entry.date)} · {ageLabel(ageInDays(entry.timestamp))}
                        </span>
                      </span>
                      <span className="font-bold tabular-nums text-slate-900">{formatCurrency(entry.amount)}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <FieldLabel htmlFor="dc-settle-method" required>Cara bayar</FieldLabel>
                <Select id="dc-settle-method" value={settleMethod} onChange={e => setSettleMethod(e.target.value as 'Transfer' | 'Tunai')}>
                  <option value="Transfer">Transfer</option>
                  <option value="Tunai">Tunai</option>
                </Select>
              </div>
              <div>
                <FieldLabel htmlFor="dc-settle-date" required>Tanggal lunas</FieldLabel>
                <Input id="dc-settle-date" type="date" value={settleDate} onChange={e => setSettleDate(e.target.value)} />
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Appoint PJ */}
      <Modal
        isOpen={isPjModalOpen}
        onClose={() => setIsPjModalOpen(false)}
        title="Ganti PJ Catatan Harian"
        subtitle="Hanya PJ yang bisa mencatat dan melunasi. Akun lain, termasuk Super Admin, hanya bisa melihat."
        maxWidth="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setIsPjModalOpen(false)}>Batal</Button>
            <Button type="button" onClick={handleSavePj}>Simpan PJ</Button>
          </div>
        }
      >
        <div className="space-y-3">
          <FormError>{pjError}</FormError>
          <FieldLabel htmlFor="dc-pj" required>Akun PJ</FieldLabel>
          <Select id="dc-pj" value={pjChoice} onChange={e => setPjChoice(e.target.value)}>
            <option value="">Pilih akun…</option>
            {staff.map(s => <option key={s.id} value={s.id}>{s.name} · {s.role}</option>)}
          </Select>
        </div>
      </Modal>
    </div>
  );
};
