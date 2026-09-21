import React, { useState, useEffect } from 'react';
import { Scissors, Ruler, Calculator, Download, Plus, CheckCircle2, Link2, RotateCcw, Copy, Image as ImageIcon, Trash2 } from 'lucide-react';
import { Pattern, Order, SizeChart, SizeChartRow, Customer } from '../../types';
import { fetchResource, createResource, updateResource, deleteResource } from '../../services/api';
import { calculateFabricYield, exportTableToExcel, formatDateTime } from '../../lib/utils';
import { getCurrentUser } from '../../lib/session';
import { StatusBadge } from '../ui/Badge';
import { Modal } from '../ui/Modal';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { PageHeader } from '../ui/PageHeader';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell, TableRowActions, TableEmptyRow, TableSkeletonRows } from '../ui/Table';
import { DetailDrawer, DetailSection, DetailField, DetailStats, DetailBlock, RowDetailButton } from '../ui/DetailDrawer';
import { newestFirst } from '../../lib/ordering';
import { FieldLabel, FieldHint, FieldError, FormError, Select } from '../ui/Field';

const PATTERN_CATEGORIES = ['Kaos', 'Kemeja', 'Jaket', 'Celana', 'Baju Koko', 'Rompi', 'Lainnya'];

type ChartScope = 'standard' | 'customer';

const labelClass = 'block text-sm font-medium text-slate-700 mb-1.5';
const fieldClass = 'w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600';

const orderLabel = (o: Order) => `${o.po || o.id} – ${o.customerName}`;

function nextPatternCode(category: string, patterns: Pattern[]): string {
  const code = category.replace(/\s+/g, '').toUpperCase();
  const prefix = `POL-${code}-`;
  let num = patterns.filter(p => p.id.startsWith(prefix)).length + 1;
  let id = `${prefix}${String(num).padStart(3, '0')}`;
  while (patterns.some(p => p.id === id)) {
    num += 1;
    id = `${prefix}${String(num).padStart(3, '0')}`;
  }
  return id;
}

export const PatternGradingModule: React.FC = () => {

  // Pattern register (SOP-06)
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loadingPatterns, setLoadingPatterns] = useState(true);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [codeTouched, setCodeTouched] = useState(false);
  const [newPattern, setNewPattern] = useState({
    id: '',
    productName: '',
    category: 'Kaos',
    baseSize: 'M',
    sizes: 'S, M, L, XL',
    orderId: '',
    notes: ''
  });
  const [linkPattern, setLinkPattern] = useState<Pattern | null>(null);
  const [linkOrderId, setLinkOrderId] = useState('');
  const [detailPatternId, setDetailPatternId] = useState<string | null>(null);

  /*
   * Size charts come from the server now. The old version kept a hardcoded
   * table in component state, so nothing an operator saw could be corrected
   * without a code change — and it did not match the charts the factory
   * actually publishes.
   */
  const [charts, setCharts] = useState<SizeChart[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [chartScope, setChartScope] = useState<ChartScope>('standard');
  const [selectedChartId, setSelectedChartId] = useState<string>('');

  // Editor for a client's own chart
  const [isChartOpen, setIsChartOpen] = useState(false);
  const [editingChartId, setEditingChartId] = useState<string | null>(null);
  const [chartError, setChartError] = useState<string | null>(null);
  const [savingChart, setSavingChart] = useState(false);
  const [chartForm, setChartForm] = useState<{
    name: string;
    garment: string;
    customerId: string;
    basedOn: string;
    notes: string;
    rows: SizeChartRow[];
    measurements: SizeChart['measurements'];
  }>({ name: '', garment: '', customerId: '', basedOn: '', notes: '', rows: [], measurements: [] });

  // Calculator State
  const [calcPcs, setCalcPcs] = useState(100);
  const [calcConsumption, setCalcConsumption] = useState(0.65); // meters per piece
  const [calcEfficiency, setCalcEfficiency] = useState(86); // percentage marker efficiency

  // Size charts are loaded from the server; see loadPatterns below.

  const loadPatterns = async () => {
    try {
      setLoadingPatterns(true);
      const [patternRes, orderRes, chartRes, custRes] = await Promise.all([
        fetchResource<Pattern>('patterns'),
        fetchResource<Order>('orders'),
        fetchResource<SizeChart>('size-charts'),
        fetchResource<Customer>('customers')
      ]);
      setPatterns(patternRes || []);
      setOrders(orderRes || []);
      setCharts(chartRes || []);
      setCustomers(custRes || []);
    } catch (err) {
      console.error('Failed to load patterns:', err);
    } finally {
      setLoadingPatterns(false);
    }
  };

  useEffect(() => {
    loadPatterns();
  }, []);

  const handleOpenAdd = () => {
    setCodeTouched(false);
    setNewPattern({
      id: nextPatternCode('Kaos', patterns),
      productName: '',
      category: 'Kaos',
      baseSize: 'M',
      sizes: 'S, M, L, XL',
      orderId: '',
      notes: ''
    });
    setIsAddOpen(true);
  };

  const handleCreatePattern = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = newPattern.id.trim().toUpperCase();
    if (!code) {
      alert('Isi kode pola.');
      return;
    }
    if (patterns.some(p => p.id.toUpperCase() === code)) {
      alert(`Kode pola ${code} sudah dipakai.`);
      return;
    }

    const item: Pattern = {
      id: code,
      productName: newPattern.productName.trim(),
      category: newPattern.category,
      baseSize: newPattern.baseSize.trim() || 'M',
      sizes: newPattern.sizes.trim(),
      revision: 0,
      orderIds: newPattern.orderId ? [newPattern.orderId] : [],
      status: 'Draft',
      notes: newPattern.notes.trim() || undefined,
      user: getCurrentUser()?.name,
      timestamp: new Date().toISOString()
    };

    try {
      await createResource('patterns', item);
      setIsAddOpen(false);
      loadPatterns();
    } catch (err) {
      alert('Gagal menyimpan pola. Coba lagi.');
    }
  };

  const handleFinalize = async (pattern: Pattern) => {
    if (!window.confirm(`Tandai pola ${pattern.id} sebagai final? Pola final menjadi acuan resmi pemotongan.`)) return;
    try {
      await updateResource('patterns', pattern.id, {
        status: 'Final',
        finalizedBy: getCurrentUser()?.name || 'Staf',
        finalizedAt: new Date().toISOString()
      });
      loadPatterns();
    } catch (err) {
      alert('Gagal memperbarui pola. Coba lagi.');
    }
  };

  const handleRevise = async (pattern: Pattern) => {
    if (!window.confirm(`Buat revisi pola ${pattern.id}? Status kembali ke draf sampai ditandai final lagi.`)) return;
    try {
      await updateResource('patterns', pattern.id, {
        revision: (Number(pattern.revision) || 0) + 1,
        status: 'Draft',
        finalizedBy: '',
        finalizedAt: ''
      });
      loadPatterns();
    } catch (err) {
      alert('Gagal membuat revisi. Coba lagi.');
    }
  };

  const handleOpenLink = (pattern: Pattern) => {
    setLinkPattern(pattern);
    setLinkOrderId('');
  };

  const handleLinkOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkPattern || !linkOrderId) return;
    try {
      await updateResource('patterns', linkPattern.id, {
        orderIds: [...(linkPattern.orderIds || []), linkOrderId]
      });
      setLinkPattern(null);
      loadPatterns();
    } catch (err) {
      alert('Gagal menghubungkan pesanan. Coba lagi.');
    }
  };

  /*
   * A client's chart almost always starts as the factory standard with a few
   * numbers changed, so every entry point here copies an existing chart's
   * column structure rather than asking anyone to define measurements again.
   */
  const startChartForm = (base: SizeChart | null, customerId = '') => {
    setChartError(null);
    setChartForm({
      name: base ? base.name : '',
      garment: base ? base.garment : '',
      customerId,
      basedOn: base ? base.id : '',
      notes: base?.notes || '',
      measurements: base ? base.measurements.map(m => ({ ...m })) : [],
      rows: base ? base.rows.map(r => ({ size: r.size, values: { ...r.values } })) : []
    });
    setIsChartOpen(true);
  };

  const handleOpenNewChart = () => {
    const base = charts.find(c => (c.scope || 'standard') === 'standard') || null;
    setEditingChartId(null);
    startChartForm(base);
  };

  const handleCopyChartForCustomer = (chart: SizeChart) => {
    setEditingChartId(null);
    setChartScope('customer');
    startChartForm(chart, chart.scope === 'customer' ? chart.customerId || '' : '');
  };

  const handleEditChart = (chart: SizeChart) => {
    setEditingChartId(chart.id);
    startChartForm(chart, chart.customerId || '');
  };

  const handleDeleteChart = async (chart: SizeChart) => {
    if (!window.confirm(`Hapus size chart "${chart.name}" milik ${chart.customerName || chart.customerId}?`)) return;
    try {
      await deleteResource('size-charts', chart.id);
      setSelectedChartId('');
      loadPatterns();
    } catch {
      alert('Gagal menghapus size chart. Coba lagi.');
    }
  };

  const updateChartValue = (rowIndex: number, key: string, value: string) => {
    setChartForm(prev => ({
      ...prev,
      rows: prev.rows.map((r, i) => (i === rowIndex ? { ...r, values: { ...r.values, [key]: value } } : r))
    }));
  };

  const updateChartSize = (rowIndex: number, size: string) => {
    setChartForm(prev => ({
      ...prev,
      rows: prev.rows.map((r, i) => (i === rowIndex ? { ...r, size } : r))
    }));
  };

  const handleSaveChart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingChart) return;

    if (!chartForm.customerId) {
      setChartError('Pilih pelanggan pemilik size chart ini.');
      return;
    }
    if (!chartForm.name.trim()) {
      setChartError('Isi nama size chart, misalnya "Kemeja PDL".');
      return;
    }
    const filled = chartForm.rows.filter(r => r.size.trim());
    if (filled.length === 0) {
      setChartError('Isi minimal satu baris ukuran.');
      return;
    }

    const customer = customers.find(c => c.id === chartForm.customerId);
    const payload: SizeChart = {
      id: editingChartId || `SZC-${Date.now().toString(36).toUpperCase()}`,
      name: chartForm.name.trim(),
      garment: chartForm.garment.trim() || chartForm.name.trim(),
      scope: 'customer',
      customerId: chartForm.customerId,
      customerName: customer?.company || customer?.name,
      measurements: chartForm.measurements,
      rows: filled,
      notes: chartForm.notes.trim() || undefined,
      user: getCurrentUser()?.name,
      timestamp: new Date().toISOString()
    };

    try {
      setSavingChart(true);
      if (editingChartId) {
        await updateResource('size-charts', editingChartId, payload);
      } else {
        await createResource('size-charts', payload);
      }
      setIsChartOpen(false);
      setEditingChartId(null);
      setChartScope('customer');
      setSelectedChartId(payload.id);
      loadPatterns();
    } catch (err: any) {
      setChartError(err?.message || 'Gagal menyimpan size chart. Coba lagi.');
    } finally {
      setSavingChart(false);
    }
  };

  const yieldResult = calculateFabricYield(calcPcs, calcConsumption, calcEfficiency);

  const sortedPatterns = newestFirst(patterns);

  /*
   * Rows stay in stored order: S, M, L, XL reads as a chart, not a log — so the
   * newest-first rule that governs every other table deliberately does not
   * apply here.
   */
  const scopedCharts = charts.filter(c => (c.scope || 'standard') === chartScope);
  const selectedChart =
    scopedCharts.find(c => c.id === selectedChartId) || scopedCharts[0] || null;

  const calcFieldClass = 'w-full h-10 px-3 bg-white/10 border border-white/40 rounded-lg font-semibold font-mono text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal';

  const unlinkedOrders = linkPattern
    ? orders.filter(o => !(linkPattern.orderIds || []).includes(o.id))
    : [];

  const orderRefs = (p: Pattern) =>
    (p.orderIds || []).map(id => orders.find(o => o.id === id)?.po || id).join(', ');

  const detailPattern = detailPatternId ? patterns.find(p => p.id === detailPatternId) ?? null : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Size Chart"
        description="Size chart standar HIJ dan size chart khusus milik pelanggan, plus daftar pola dan kalkulator kebutuhan kain."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={!selectedChart}
              onClick={() =>
                selectedChart &&
                exportTableToExcel(
                  selectedChart.rows.map(r => ({
                    Ukuran: r.size,
                    ...Object.fromEntries(
                      selectedChart.measurements.map(m => [m.label, r.values[m.key] ?? ''])
                    )
                  })),
                  `Size_Chart_${selectedChart.name.replace(/[^A-Za-z0-9]+/g, '_')}`
                )
              }
            >
              <Download size={16} aria-hidden="true" /> Unduh Size Chart
            </Button>
            <Button size="sm" onClick={handleOpenAdd}>
              <Plus size={16} aria-hidden="true" /> Tambah Pola
            </Button>
          </>
        }
      />

      {/* SIZE CHART */}
      <section className="space-y-3" aria-labelledby="pg-size-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="pg-size-heading" className="text-base font-bold text-slate-900">Size Chart</h2>
          {chartScope === 'customer' && (
            <Button size="sm" onClick={handleOpenNewChart}>
              <Plus size={16} aria-hidden="true" /> Size Chart Pelanggan
            </Button>
          )}
        </div>

        {/* Whose chart: the factory standard, or one client's own. */}
        <div className="flex flex-wrap gap-1 p-1 bg-slate-100 rounded-lg w-fit" role="tablist" aria-label="Pemilik size chart">
          {([
            ['standard', `Standar HIJ (${charts.filter(c => (c.scope || 'standard') === 'standard').length})`],
            ['customer', `Khusus Pelanggan (${charts.filter(c => c.scope === 'customer').length})`]
          ] as [ChartScope, string][]).map(([scope, label], index) => {
            const selected = chartScope === scope;
            return (
              <button
                key={scope}
                id={`pg-scope-tab-${index}`}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => { setChartScope(scope); setSelectedChartId(''); }}
                className={`px-3 py-1.5 rounded-md text-sm font-semibold transition-colors cursor-pointer ${
                  selected ? 'bg-white text-brand-teal-dark shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {scopedCharts.length === 0 ? (
          <Card className="p-8 text-center">
            <Ruler size={22} className="mx-auto mb-2 text-slate-400" aria-hidden="true" />
            <p className="text-sm font-semibold text-slate-900">
              {chartScope === 'standard' ? 'Size chart standar belum dimuat' : 'Belum ada size chart khusus pelanggan'}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {chartScope === 'standard'
                ? 'Jalankan: node server/scripts/seed-size-charts.mjs'
                : 'Pelanggan yang punya ukuran sendiri bisa dibuatkan chart terpisah, disalin dari standar lalu disesuaikan.'}
            </p>
          </Card>
        ) : (
          <>
            {/* Which garment */}
            <div className="flex flex-wrap gap-1.5">
              {scopedCharts.map(chart => {
                const active = selectedChart?.id === chart.id;
                return (
                  <button
                    key={chart.id}
                    type="button"
                    onClick={() => setSelectedChartId(chart.id)}
                    className={`inline-flex h-9 items-center rounded-lg border px-3 text-xs font-semibold transition-colors cursor-pointer ${
                      active
                        ? 'border-brand-teal-dark bg-brand-teal-dark text-white'
                        : 'border-border bg-white text-slate-700 hover:border-brand-teal/50 hover:bg-muted'
                    }`}
                  >
                    {chart.name}
                    {chart.scope === 'customer' && chart.customerName ? ` · ${chart.customerName}` : ''}
                  </button>
                );
              })}
            </div>

            {selectedChart && (
              <Card className="overflow-hidden">
                <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border bg-muted/40 px-4 py-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-foreground">{selectedChart.name}</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {selectedChart.scope === 'customer'
                        ? `Khusus ${selectedChart.customerName || selectedChart.customerId}`
                        : 'Standar HIJ Konveksi'}
                      {' · '}{selectedChart.rows.length} ukuran
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {selectedChart.referenceImage && (
                      <a
                        href={selectedChart.referenceImage}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-muted"
                      >
                        <ImageIcon size={14} aria-hidden="true" /> Gambar acuan
                      </a>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCopyChartForCustomer(selectedChart)}
                      className="h-8 gap-1.5 px-2.5 text-xs"
                    >
                      <Copy size={14} aria-hidden="true" /> Salin untuk pelanggan
                    </Button>
                    {selectedChart.scope === 'customer' && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleEditChart(selectedChart)}
                          className="h-8 gap-1.5 px-2.5 text-xs"
                        >
                          <Ruler size={14} aria-hidden="true" /> Ubah
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDeleteChart(selectedChart)}
                          aria-label={`Hapus size chart ${selectedChart.name}`}
                          className="h-8 w-9 px-0 text-brand-red hover:border-brand-red/40 hover:bg-rose-50"
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="cell-sticky-start">Ukuran</TableHead>
                      {selectedChart.measurements.map(m => (
                        <TableHead key={m.key} className="text-right">
                          {m.label}
                          {m.code ? <span className="ml-1 font-normal text-muted-foreground">({m.code})</span> : null}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedChart.rows.map(r => (
                      <TableRow key={r.size}>
                        <TableCell className="cell-sticky-start whitespace-nowrap font-mono font-bold text-slate-900">
                          {r.size}
                        </TableCell>
                        {selectedChart.measurements.map(m => (
                          <TableCell key={m.key} className="text-right font-semibold tabular-nums text-slate-800 whitespace-nowrap">
                            {r.values[m.key] || '\u2014'}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                {selectedChart.notes && (
                  <p className="border-t border-border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground text-pretty">
                    {selectedChart.notes}
                  </p>
                )}
              </Card>
            )}
          </>
        )}
      </section>

      {/* PATTERN REGISTER */}
      <Card className="overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-900">Daftar Pola</h2>
          <p className="text-sm text-slate-500 mt-0.5">Hanya pola final yang boleh dipakai untuk pemotongan.</p>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="cell-sticky-start">Kode Pola</TableHead>
              <TableHead className="hidden md:table-cell">Produk</TableHead>
              <TableHead className="hidden lg:table-cell">Pesanan</TableHead>
              <TableHead className="hidden lg:table-cell">Ukuran Dasar</TableHead>
              <TableHead className="hidden xl:table-cell">Daftar Ukuran</TableHead>
              <TableHead className="text-center">Status</TableHead>
              <TableHead className="cell-sticky-end text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loadingPatterns ? (
              <TableSkeletonRows columns={7} rows={3} />
            ) : patterns.length === 0 ? (
              <TableEmptyRow
                colSpan={7}
                icon={<Scissors size={20} />}
                title="Belum ada pola"
                description="Klik Tambah Pola untuk mendaftarkan pola pertama. Pola baru disimpan sebagai draf."
              />
            ) : sortedPatterns.map(p => (
              <TableRow key={p.id}>
                <TableCell className="cell-sticky-start whitespace-nowrap font-mono font-bold text-slate-900">{p.id}</TableCell>
                <TableCell className="hidden md:table-cell">
                  <span className="font-semibold text-slate-900 break-words">{p.productName || '-'}</span>
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  {(p.orderIds || []).length === 0 ? (
                    <span className="text-slate-500">Belum terhubung ke pesanan</span>
                  ) : (
                    <span className="font-mono">{orderRefs(p)}</span>
                  )}
                </TableCell>
                <TableCell className="hidden lg:table-cell whitespace-nowrap">{p.baseSize || '—'}</TableCell>
                <TableCell className="hidden xl:table-cell">{p.sizes || '—'}</TableCell>
                <TableCell className="text-center whitespace-nowrap">
                  <StatusBadge status={p.status} />
                </TableCell>
                <TableCell className="cell-sticky-end text-right">
                  <TableRowActions>
                    {p.status === 'Draft' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleFinalize(p)}
                        aria-label={`Tandai Final ${p.id}`}
                        title="Tandai Final"
                        className="h-8 min-w-8 px-2.5 text-xs"
                      >
                        <CheckCircle2 size={14} aria-hidden="true" />
                        <span className="hidden sm:inline">Tandai Final</span>
                      </Button>
                    )}
                    <RowDetailButton label={p.id} onClick={() => setDetailPatternId(p.id)} />
                  </TableRowActions>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* MARKER EFFICIENCY & FABRIC YIELD CALCULATOR */}
      <Card className="bg-teal-900 text-white p-5 border-teal-900 space-y-5">
        <div className="flex items-center gap-2">
          <Calculator size={20} className="text-teal-300" aria-hidden="true" />
          <h2 className="text-base font-bold text-white">Kalkulator Kebutuhan Kain</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label htmlFor="pg-calc-pcs" className="text-sm font-medium text-teal-100 block mb-1.5">Jumlah Produk (Pcs)</label>
            <input
              id="pg-calc-pcs"
              type="number"
              min={1}
              value={calcPcs}
              onChange={(e) => setCalcPcs(Number(e.target.value))}
              className={calcFieldClass}
            />
          </div>

          <div>
            <label htmlFor="pg-calc-consumption" className="text-sm font-medium text-teal-100 block mb-1.5">Pemakaian Kain per Pcs (m)</label>
            <input
              id="pg-calc-consumption"
              type="number"
              step="0.01"
              value={calcConsumption}
              onChange={(e) => setCalcConsumption(Number(e.target.value))}
              className={calcFieldClass}
            />
          </div>

          <div>
            <label htmlFor="pg-calc-efficiency" className="text-sm font-medium text-teal-100 block mb-1.5">Efisiensi Marker (%)</label>
            <input
              id="pg-calc-efficiency"
              type="number"
              min={50}
              max={100}
              value={calcEfficiency}
              onChange={(e) => setCalcEfficiency(Number(e.target.value))}
              className={calcFieldClass}
            />
          </div>
        </div>

        {/* CALCULATED RESULTS */}
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4 bg-white/10 rounded-xl p-4 border border-white/15">
          <div className="min-w-0">
            <dt className="text-sm text-teal-100">Kebutuhan Kain (Teori)</dt>
            <dd className="text-lg font-bold text-white tabular-nums whitespace-nowrap">{yieldResult.theoreticalUsage} m</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-sm font-semibold text-white">Kebutuhan Kain + Perca</dt>
            <dd className="text-lg font-bold text-teal-200 tabular-nums whitespace-nowrap">{yieldResult.actualUsageWithWaste} m</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-sm text-teal-100">Perkiraan Sisa Perca</dt>
            <dd className="text-lg font-bold text-white tabular-nums whitespace-nowrap">{yieldResult.wasteMeters} m</dd>
          </div>
        </dl>
      </Card>

      {/* PATTERN DETAIL */}
      <DetailDrawer
        isOpen={!!detailPattern}
        onClose={() => setDetailPatternId(null)}
        title={detailPattern && (detailPattern.productName || detailPattern.id)}
        subtitle={detailPattern && <span className="font-mono">{detailPattern.id} · Rev. {detailPattern.revision ?? 0}</span>}
        status={detailPattern && <StatusBadge status={detailPattern.status} />}
        footer={
          detailPattern && detailPattern.status !== 'Inactive' ? (
            detailPattern.status === 'Draft' ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setDetailPatternId(null);
                    handleOpenLink(detailPattern);
                  }}
                >
                  <Link2 size={16} aria-hidden="true" /> Hubungkan Pesanan
                </Button>
                <Button size="sm" onClick={() => handleFinalize(detailPattern)}>
                  <CheckCircle2 size={16} aria-hidden="true" /> Tandai Final
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={() => handleRevise(detailPattern)}>
                  <RotateCcw size={16} aria-hidden="true" /> Buat Revisi
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    setDetailPatternId(null);
                    handleOpenLink(detailPattern);
                  }}
                >
                  <Link2 size={16} aria-hidden="true" /> Hubungkan Pesanan
                </Button>
              </>
            )
          ) : undefined
        }
      >
        {detailPattern && (
          <>
            <DetailStats
              items={[
                { label: 'Revisi', value: detailPattern.revision ?? 0 },
                { label: 'Ukuran dasar', value: detailPattern.baseSize || '—' },
                { label: 'Pesanan', value: (detailPattern.orderIds || []).length, tone: 'accent' }
              ]}
            />
            <DetailSection title="Pola">
              <DetailField label="Kode pola" mono>{detailPattern.id}</DetailField>
              <DetailField label="Status"><StatusBadge status={detailPattern.status} /></DetailField>
              <DetailField label="Nama produk" full>{detailPattern.productName}</DetailField>
              <DetailField label="Kategori">{detailPattern.category}</DetailField>
              <DetailField label="Revisi">{String(detailPattern.revision ?? 0)}</DetailField>
            </DetailSection>
            <DetailSection title="Ukuran">
              <DetailField label="Ukuran dasar">{detailPattern.baseSize}</DetailField>
              <DetailField label="Daftar ukuran">{detailPattern.sizes}</DetailField>
            </DetailSection>
            <DetailBlock title="Pesanan">
              {(detailPattern.orderIds || []).length === 0 ? (
                <p className="text-sm text-muted-foreground">Belum terhubung ke pesanan.</p>
              ) : (
                <ul className="space-y-2">
                  {(detailPattern.orderIds || []).map(id => {
                    const o = orders.find(ord => ord.id === id);
                    return (
                      <li key={id} className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="font-mono font-semibold text-foreground whitespace-nowrap">{o?.po || id}</span>
                        <span className="min-w-0 text-right text-muted-foreground break-words">{o?.customerName || '—'}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </DetailBlock>
            <DetailSection title="Finalisasi">
              <DetailField label="Ditandai final oleh">{detailPattern.finalizedBy}</DetailField>
              <DetailField label="Ditandai final pada">
                {detailPattern.finalizedAt ? formatDateTime(detailPattern.finalizedAt) : ''}
              </DetailField>
            </DetailSection>
            <DetailSection title="Catatan">
              <DetailField label="Catatan pola" full>{detailPattern.notes}</DetailField>
            </DetailSection>
            {(detailPattern.user || detailPattern.timestamp || detailPattern.updatedAt) && (
              <DetailSection title="Riwayat Data">
                <DetailField label="Dicatat oleh">{detailPattern.user}</DetailField>
                <DetailField label="Dicatat pada">
                  {detailPattern.timestamp ? formatDateTime(detailPattern.timestamp) : ''}
                </DetailField>
                <DetailField label="Diperbarui pada">
                  {detailPattern.updatedAt ? formatDateTime(detailPattern.updatedAt) : ''}
                </DetailField>
              </DetailSection>
            )}
          </>
        )}
      </DetailDrawer>

      {/* CUSTOMER SIZE CHART EDITOR */}
      <Modal
        isOpen={isChartOpen}
        onClose={() => { setIsChartOpen(false); setEditingChartId(null); }}
        title={editingChartId ? 'Ubah Size Chart Pelanggan' : 'Size Chart Khusus Pelanggan'}
        subtitle="Disalin dari size chart yang ada, lalu angkanya disesuaikan dengan permintaan pelanggan."
        maxWidth="4xl"
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="outline" disabled={savingChart} onClick={() => { setIsChartOpen(false); setEditingChartId(null); }}>
              Batal
            </Button>
            <Button type="submit" form="size-chart-form" disabled={savingChart}>
              {savingChart ? 'Menyimpan…' : 'Simpan Size Chart'}
            </Button>
          </div>
        }
      >
        <form id="size-chart-form" noValidate onSubmit={handleSaveChart} className="space-y-5">
          <FormError>{chartError}</FormError>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor="szc-customer" required>Pelanggan</FieldLabel>
              <Select
                id="szc-customer"
                value={chartForm.customerId}
                onChange={e => setChartForm(prev => ({ ...prev, customerId: e.target.value }))}
              >
                <option value="">Pilih pelanggan</option>
                {customers.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.company ? ` (${c.company})` : ''}
                  </option>
                ))}
              </Select>
              <FieldHint>Chart ini hanya berlaku untuk pelanggan tersebut.</FieldHint>
            </div>

            <div>
              <FieldLabel htmlFor="szc-name" required>Nama size chart</FieldLabel>
              <Input
                id="szc-name"
                type="text"
                value={chartForm.name}
                placeholder="Contoh: Kemeja PDL"
                onChange={e => setChartForm(prev => ({ ...prev, name: e.target.value }))}
              />
            </div>
          </div>

          <div>
            <span className="mb-1.5 block text-sm font-semibold text-foreground">Ukuran</span>
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-xs font-semibold text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left">Ukuran</th>
                    {chartForm.measurements.map(m => (
                      <th key={m.key} scope="col" className="px-3 py-2 text-right whitespace-nowrap">{m.label}</th>
                    ))}
                    <th scope="col" className="w-12 px-3 py-2"><span className="sr-only">Hapus</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {chartForm.rows.length === 0 ? (
                    <tr>
                      <td colSpan={chartForm.measurements.length + 2} className="px-3 py-4 text-center text-xs text-muted-foreground">
                        Belum ada baris ukuran.
                      </td>
                    </tr>
                  ) : (
                    chartForm.rows.map((r, index) => (
                      <tr key={index}>
                        <td className="px-2 py-1.5">
                          <Input
                            aria-label={`Nama ukuran baris ${index + 1}`}
                            value={r.size}
                            placeholder="S / M / L"
                            onChange={e => updateChartSize(index, e.target.value)}
                            className="h-9 w-24"
                          />
                        </td>
                        {chartForm.measurements.map(m => (
                          <td key={m.key} className="px-2 py-1.5">
                            <Input
                              aria-label={`${m.label} ukuran ${r.size || index + 1}`}
                              value={r.values[m.key] || ''}
                              placeholder="cm"
                              onChange={e => updateChartValue(index, m.key, e.target.value)}
                              className="h-9 text-right"
                            />
                          </td>
                        ))}
                        <td className="px-2 py-1.5 text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`Hapus baris ${r.size || index + 1}`}
                            onClick={() => setChartForm(prev => ({ ...prev, rows: prev.rows.filter((_, i) => i !== index) }))}
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
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setChartForm(prev => ({ ...prev, rows: [...prev.rows, { size: '', values: {} }] }))
                }
              >
                <Plus size={14} aria-hidden="true" /> Tambah Ukuran
              </Button>
              <span className="text-xs text-muted-foreground">
                Lebar dada ditulis seperti di chart standar, misalnya <span className="font-mono">52/104</span>.
              </span>
            </div>
          </div>

          <div>
            <FieldLabel htmlFor="szc-notes" aside="Opsional">Catatan</FieldLabel>
            <Input
              id="szc-notes"
              type="text"
              value={chartForm.notes}
              placeholder="Contoh: toleransi jahit 1 cm, dada diukur datar."
              onChange={e => setChartForm(prev => ({ ...prev, notes: e.target.value }))}
            />
          </div>
        </form>
      </Modal>

      {/* ADD PATTERN MODAL */}
      <Modal isOpen={isAddOpen} onClose={() => setIsAddOpen(false)} title="Tambah Pola" maxWidth="2xl">
        <form onSubmit={handleCreatePattern} className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="pg-category" className={labelClass}>Kategori</label>
              <select
                id="pg-category"
                value={newPattern.category}
                onChange={(e) => {
                  const category = e.target.value;
                  setNewPattern(prev => ({
                    ...prev,
                    category,
                    id: codeTouched ? prev.id : nextPatternCode(category, patterns)
                  }));
                }}
                className={fieldClass}
              >
                {PATTERN_CATEGORIES.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="pg-code" className={labelClass}>Kode Pola</label>
              <Input
                id="pg-code"
                type="text"
                required
                value={newPattern.id}
                onChange={(e) => {
                  setCodeTouched(true);
                  setNewPattern({ ...newPattern, id: e.target.value });
                }}
                className="font-mono"
              />
            </div>
          </div>

          <div>
            <label htmlFor="pg-product" className={labelClass}>Nama Produk</label>
            <Input
              id="pg-product"
              type="text"
              required
              placeholder="Contoh: Kaos Cotton Combed 24s lengan pendek"
              value={newPattern.productName}
              onChange={(e) => setNewPattern({ ...newPattern, productName: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="pg-base-size" className={labelClass}>Ukuran Dasar</label>
              <Input
                id="pg-base-size"
                type="text"
                required
                value={newPattern.baseSize}
                onChange={(e) => setNewPattern({ ...newPattern, baseSize: e.target.value })}
              />
            </div>

            <div>
              <label htmlFor="pg-sizes" className={labelClass}>Daftar Ukuran</label>
              <Input
                id="pg-sizes"
                type="text"
                placeholder="Contoh: S, M, L, XL"
                value={newPattern.sizes}
                onChange={(e) => setNewPattern({ ...newPattern, sizes: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label htmlFor="pg-order" className={labelClass}>Untuk Pesanan</label>
            <select
              id="pg-order"
              value={newPattern.orderId}
              onChange={(e) => setNewPattern({ ...newPattern, orderId: e.target.value })}
              className={fieldClass}
            >
              <option value="">Belum ada pesanan</option>
              {orders.map(o => (
                <option key={o.id} value={o.id}>{orderLabel(o)}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="pg-notes" className={labelClass}>Catatan</label>
            <textarea
              id="pg-notes"
              rows={3}
              value={newPattern.notes}
              onChange={(e) => setNewPattern({ ...newPattern, notes: e.target.value })}
              placeholder="Contoh: kerah rib 2 cm, lengan raglan"
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>

          <p className="text-sm text-slate-500">Pola baru disimpan sebagai draf.</p>

          <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
            <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>
              Batal
            </Button>
            <Button type="submit">
              Simpan Pola
            </Button>
          </div>
        </form>
      </Modal>

      {/* LINK ORDER MODAL */}
      <Modal
        isOpen={!!linkPattern}
        onClose={() => setLinkPattern(null)}
        title={`Hubungkan Pesanan ke ${linkPattern?.id ?? ''}`}
        maxWidth="lg"
      >
        <form onSubmit={handleLinkOrder} className="space-y-5">
          <div>
            <label htmlFor="pg-link-order" className={labelClass}>Pesanan</label>
            <select
              id="pg-link-order"
              required
              value={linkOrderId}
              onChange={(e) => setLinkOrderId(e.target.value)}
              aria-describedby={linkPattern?.status !== 'Final' ? 'pg-link-order-hint' : undefined}
              className={fieldClass}
            >
              <option value="">Pilih pesanan</option>
              {unlinkedOrders.map(o => (
                <option key={o.id} value={o.id}>{orderLabel(o)}</option>
              ))}
            </select>
            {linkPattern?.status !== 'Final' && (
              <p id="pg-link-order-hint" className="text-xs text-slate-500 mt-1.5">Syarat pola baru terpenuhi setelah pola ditandai final.</p>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
            <Button type="button" variant="outline" onClick={() => setLinkPattern(null)}>
              Batal
            </Button>
            <Button type="submit" disabled={!linkOrderId}>
              Hubungkan
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
