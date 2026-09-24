import React, { useState, useEffect } from 'react';
import { Ruler, Calculator, Download, Plus, Copy, Image as ImageIcon, Trash2 } from 'lucide-react';
import { SizeChart, SizeChartMeasurement, SizeChartRow, Customer } from '../../types';
import { fetchResource, createResource, updateResource, deleteResource } from '../../services/api';
import { calculateFabricYield, exportTableToExcel } from '../../lib/utils';
import { getCurrentUser } from '../../lib/session';
import { Modal } from '../ui/Modal';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { PageHeader } from '../ui/PageHeader';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell, TableEmptyRow } from '../ui/Table';
import { FieldLabel, FieldHint, FormError, Select } from '../ui/Field';
import { Toast, useToast } from '../ui/Toast';
import { useConfirm } from '../ui/ConfirmDialog';
import {
  STANDARD_SIZE_CHARTS,
  SIZE_CHART_COMMON_NOTES,
  isChestMeasurement,
  splitChest,
  joinChest,
  templateFor
} from '../../config/sizeChartTemplates';

type ChartScope = 'standard' | 'customer';

/** Order sizes are added in, matching the printed charts. */
const SIZE_SEQUENCE = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'];

const imageSrc = (path?: string) => (path ? encodeURI(path) : undefined);

/** The orange code chip printed on the diagram (LD, PB, PL, …). */
const CodeChip: React.FC<{ code?: string; sup?: string }> = ({ code, sup }) =>
  code ? (
    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-400 px-1.5 text-[10px] font-bold text-slate-900">
      {code}
      {sup ? <sup className="ml-px text-[8px]">{sup}</sup> : null}
    </span>
  ) : null;

/** Chest printed as width over circumference, like the published chart. */
const ChestValue: React.FC<{ value?: string }> = ({ value }) => {
  const [width, around] = splitChest(value);
  if (!width && !around) return <>—</>;
  if (!around) return <>{width}</>;
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span>{width}</span>
      <span className="border-t border-slate-300 text-muted-foreground">{around}</span>
    </span>
  );
};

interface ChartForm {
  name: string;
  garment: string;
  customerId: string;
  basedOn: string;
  notes: string;
  rows: SizeChartRow[];
  measurements: SizeChartMeasurement[];
}

const EMPTY_FORM: ChartForm = { name: '', garment: '', customerId: '', basedOn: '', notes: '', rows: [], measurements: [] };

export const PatternGradingModule: React.FC = () => {
  const { toast, showToast } = useToast();
  const { confirm, confirmDialog } = useConfirm();

  const [charts, setCharts] = useState<SizeChart[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [chartScope, setChartScope] = useState<ChartScope>('standard');
  const [selectedChartId, setSelectedChartId] = useState<string>('');

  // Editor for a client's own chart
  const [isChartOpen, setIsChartOpen] = useState(false);
  const [editingChartId, setEditingChartId] = useState<string | null>(null);
  const [chartError, setChartError] = useState<string | null>(null);
  const [savingChart, setSavingChart] = useState(false);
  const [chartForm, setChartForm] = useState<ChartForm>(EMPTY_FORM);

  // Calculator State
  const [calcPcs, setCalcPcs] = useState(100);
  const [calcConsumption, setCalcConsumption] = useState(0.65); // meters per piece
  const [calcEfficiency, setCalcEfficiency] = useState(86); // percentage marker efficiency

  const loadCharts = async () => {
    try {
      setLoading(true);
      const [chartRes, custRes] = await Promise.all([
        fetchResource<SizeChart>('size-charts'),
        fetchResource<Customer>('customers')
      ]);
      setCharts(chartRes || []);
      setCustomers(custRes || []);
    } catch (err) {
      console.error('Failed to load size charts:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCharts();
  }, []);

  /*
   * The templates a new chart can start from: the published HIJ charts, in the
   * version stored on the server when it has one (it may have been corrected).
   */
  const templates: SizeChart[] = STANDARD_SIZE_CHARTS.map(
    t => charts.find(c => c.id === t.id) || { ...t, scope: 'standard' as const }
  );

  /*
   * A client's chart almost always starts as the factory standard with a few
   * numbers changed, so every entry point copies an existing chart's columns
   * and sizes rather than asking anyone to define measurements again.
   */
  const startChartForm = (base: SizeChart | null, customerId = '') => {
    setChartError(null);
    setChartForm({
      name: base ? base.name : '',
      garment: base ? base.garment : '',
      customerId,
      basedOn: base ? (base.scope === 'customer' ? base.basedOn || '' : base.id) : '',
      notes: base?.notes || SIZE_CHART_COMMON_NOTES,
      measurements: base ? base.measurements.map(m => ({ ...m })) : [],
      rows: base ? base.rows.map(r => ({ size: r.size, values: { ...r.values } })) : []
    });
    setIsChartOpen(true);
  };

  const handleOpenNewChart = () => {
    setEditingChartId(null);
    const current = chartScope === 'standard' ? selectedChart : null;
    startChartForm(current || templates[0] || null);
  };

  const handleCopyChartForCustomer = (chart: SizeChart) => {
    setEditingChartId(null);
    startChartForm(chart, chart.scope === 'customer' ? chart.customerId || '' : '');
  };

  const handleEditChart = (chart: SizeChart) => {
    setEditingChartId(chart.id);
    startChartForm(chart, chart.customerId || '');
  };

  /** Switching garment swaps columns and sizes for that template's own. */
  const handlePickTemplate = (template: SizeChart) => {
    setChartForm(prev => ({
      ...prev,
      name: !prev.name || prev.name === templateName(prev.basedOn) ? template.name : prev.name,
      garment: template.garment,
      basedOn: template.id,
      measurements: template.measurements.map(m => ({ ...m })),
      rows: template.rows.map(r => ({ size: r.size, values: { ...r.values } }))
    }));
  };

  const templateName = (id: string) => templates.find(t => t.id === id)?.name;

  const handleDeleteChart = async (chart: SizeChart) => {
    const approved = await confirm({
      title: `Hapus size chart "${chart.name}"?`,
      message: `Chart khusus ${chart.customerName || chart.customerId} beserta seluruh baris ukurannya hilang permanen. Salin dulu dari standar bila masih dibutuhkan.`,
      confirmLabel: 'Hapus Size Chart',
      tone: 'danger'
    });
    if (!approved) return;
    try {
      await deleteResource('size-charts', chart.id);
      setSelectedChartId('');
      loadCharts();
      showToast(`Size chart "${chart.name}" dihapus.`);
    } catch (err: any) {
      showToast(err?.message || 'Gagal menghapus size chart. Coba lagi.', 'error');
    }
  };

  const updateRow = (rowIndex: number, update: (row: SizeChartRow) => SizeChartRow) => {
    setChartForm(prev => ({ ...prev, rows: prev.rows.map((r, i) => (i === rowIndex ? update(r) : r)) }));
  };

  const updateValue = (rowIndex: number, key: string, value: string) =>
    updateRow(rowIndex, r => ({ ...r, values: { ...r.values, [key]: value } }));

  /*
   * Circumference is twice the width on every published chart, so it follows
   * the width until someone types a different number into it.
   */
  const updateChestWidth = (rowIndex: number, key: string, width: string) =>
    updateRow(rowIndex, r => {
      const [oldWidth, oldAround] = splitChest(r.values[key]);
      const followed = !oldAround || Number(oldAround) === Number(oldWidth) * 2;
      const n = Number(width.replace(',', '.'));
      const around = followed ? (width.trim() && Number.isFinite(n) ? String(n * 2) : '') : oldAround;
      return { ...r, values: { ...r.values, [key]: joinChest(width, around) } };
    });

  const updateChestAround = (rowIndex: number, key: string, around: string) =>
    updateRow(rowIndex, r => {
      const [width] = splitChest(r.values[key]);
      return { ...r, values: { ...r.values, [key]: joinChest(width, around) } };
    });

  const addSizeRow = () =>
    setChartForm(prev => {
      const last = prev.rows[prev.rows.length - 1]?.size.toUpperCase();
      const at = last ? SIZE_SEQUENCE.indexOf(last) : -1;
      const next = at >= 0 && at < SIZE_SEQUENCE.length - 1 ? SIZE_SEQUENCE[at + 1] : '';
      return { ...prev, rows: [...prev.rows, { size: next, values: {} }] };
    });

  const handleSaveChart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingChart) return;

    if (chartForm.measurements.length === 0) {
      setChartError('Pilih jenis pakaian dulu.');
      return;
    }
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
    const sizes = filled.map(r => r.size.trim().toUpperCase());
    const duplicate = sizes.find((s, i) => sizes.indexOf(s) !== i);
    if (duplicate) {
      setChartError(`Ukuran ${duplicate} tertulis dua kali. Setiap ukuran cukup satu baris.`);
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
      basedOn: chartForm.basedOn || undefined,
      measurements: chartForm.measurements,
      rows: filled.map(r => ({ size: r.size.trim().toUpperCase(), values: r.values })),
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
      loadCharts();
      showToast(`Size chart "${payload.name}" disimpan.`);
    } catch (err: any) {
      setChartError(err?.message || 'Gagal menyimpan size chart. Coba lagi.');
    } finally {
      setSavingChart(false);
    }
  };

  const yieldResult = calculateFabricYield(calcPcs, calcConsumption, calcEfficiency);

  /*
   * Rows stay in stored order: S, M, L, XL reads as a chart, not a log — so the
   * newest-first rule that governs every other table deliberately does not
   * apply here.
   */
  const scopedCharts = chartScope === 'standard'
    ? templates.filter(t => charts.some(c => c.id === t.id))
    : charts.filter(c => c.scope === 'customer');
  const selectedChart =
    scopedCharts.find(c => c.id === selectedChartId) || scopedCharts[0] || null;
  const selectedImage = selectedChart
    ? selectedChart.referenceImage || templateFor(selectedChart)?.referenceImage
    : undefined;

  const formTemplate = templateFor({ id: chartForm.basedOn, garment: chartForm.garment, name: chartForm.name, basedOn: chartForm.basedOn });
  const formImage = formTemplate?.referenceImage;

  const calcFieldClass = 'w-full h-10 px-3 bg-white/10 border border-white/40 rounded-lg font-semibold font-mono text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal';

  const closeChartForm = () => {
    setIsChartOpen(false);
    setEditingChartId(null);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Size Chart"
        description="Size chart standar HIJ dan size chart khusus milik pelanggan, plus kalkulator kebutuhan kain."
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
            <Button size="sm" onClick={handleOpenNewChart}>
              <Plus size={16} aria-hidden="true" /> Buat Size Chart Pelanggan
            </Button>
          </>
        }
      />

      <section className="space-y-3" aria-label="Size chart">
        {/* Whose chart: the factory standard, or one client's own. */}
        <div className="flex flex-wrap gap-1 p-1 bg-slate-100 rounded-lg w-fit" role="tablist" aria-label="Pemilik size chart">
          {([
            ['standard', `Standar HIJ (${templates.filter(t => charts.some(c => c.id === t.id)).length})`],
            ['customer', `Khusus Pelanggan (${charts.filter(c => c.scope === 'customer').length})`]
          ] as [ChartScope, string][]).map(([scope, label]) => {
            const selected = chartScope === scope;
            return (
              <button
                key={scope}
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

        {loading ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">Memuat size chart…</Card>
        ) : scopedCharts.length === 0 ? (
          <Card className="p-8 text-center">
            <Ruler size={22} className="mx-auto mb-2 text-slate-400" aria-hidden="true" />
            <p className="text-sm font-semibold text-slate-900">
              {chartScope === 'standard' ? 'Size chart standar belum dimuat' : 'Belum ada size chart khusus pelanggan'}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {chartScope === 'standard'
                ? 'Size chart standar ditambahkan otomatis saat server dijalankan ulang.'
                : 'Pelanggan yang punya ukuran sendiri bisa dibuatkan chart terpisah, disalin dari standar lalu disesuaikan.'}
            </p>
            {chartScope === 'customer' && (
              <Button size="sm" className="mt-4" onClick={handleOpenNewChart}>
                <Plus size={16} aria-hidden="true" /> Buat Size Chart Pelanggan
              </Button>
            )}
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
                    {selectedImage && (
                      <a
                        href={imageSrc(selectedImage)}
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
                      <TableHead className="cell-sticky-start">Size</TableHead>
                      {selectedChart.measurements.map(m => (
                        <TableHead key={m.key} className="text-right">
                          <span className="inline-flex items-center justify-end gap-1.5">
                            <CodeChip code={m.code} />
                            <span>{m.label}</span>
                          </span>
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedChart.rows.length === 0 ? (
                      <TableEmptyRow
                        colSpan={selectedChart.measurements.length + 1}
                        icon={<Ruler size={20} />}
                        title="Belum ada baris ukuran"
                        description={
                          selectedChart.scope === 'customer'
                            ? 'Klik Ubah untuk menambahkan ukuran dan nilai ukurnya.'
                            : 'Size chart ini belum punya ukuran. Salin untuk pelanggan lalu isi ukurannya.'
                        }
                      />
                    ) : selectedChart.rows.map(r => (
                      <TableRow key={r.size}>
                        <TableCell className="cell-sticky-start font-mono font-bold text-slate-900">
                          {r.size}
                        </TableCell>
                        {selectedChart.measurements.map(m => (
                          <TableCell key={m.key} className="text-right font-semibold tabular-nums text-slate-800">
                            {isChestMeasurement(m) ? <ChestValue value={r.values[m.key]} /> : r.values[m.key] || '—'}
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

      {/* CUSTOMER SIZE CHART FORM — laid out like the published charts */}
      <Modal
        isOpen={isChartOpen}
        onClose={closeChartForm}
        title={editingChartId ? 'Ubah Size Chart Pelanggan' : 'Buat Size Chart Pelanggan'}
        subtitle="Mulai dari size chart standar HIJ, lalu sesuaikan angkanya dengan permintaan pelanggan. Semua ukuran dalam cm."
        maxWidth="6xl"
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="outline" disabled={savingChart} onClick={closeChartForm}>
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

          {/* 1. Garment — each one brings the columns printed on its chart. */}
          <fieldset>
            <legend className="mb-1.5 block text-sm font-semibold text-foreground">Jenis pakaian</legend>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {templates.map(t => {
                const active = chartForm.basedOn === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => handlePickTemplate(t)}
                    className={`group flex flex-col overflow-hidden rounded-xl border text-left transition-colors cursor-pointer ${
                      active
                        ? 'border-brand-teal-dark ring-2 ring-brand-teal/30'
                        : 'border-border hover:border-brand-teal/50'
                    }`}
                  >
                    <img
                      src={imageSrc(t.referenceImage)}
                      alt=""
                      loading="lazy"
                      className="aspect-[4/3] w-full bg-muted object-cover object-[center_22%]"
                    />
                    <span className={`px-2 py-1.5 text-xs font-semibold ${active ? 'bg-brand-teal-dark text-white' : 'bg-white text-slate-700'}`}>
                      {t.name}
                    </span>
                  </button>
                );
              })}
            </div>
            <FieldHint>Kolom ukuran mengikuti size chart jenis pakaian yang dipilih. Mengganti jenis pakaian mengisi ulang tabel di bawah.</FieldHint>
          </fieldset>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
            {/* 2. The diagram the codes refer to. */}
            <aside className="space-y-2">
              {formImage ? (
                <a href={imageSrc(formImage)} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-xl border border-border bg-muted">
                  <img
                    src={imageSrc(formImage)}
                    alt={`Size chart acuan ${formTemplate?.name || ''}`}
                    className="h-56 w-full object-cover object-[center_32%] sm:h-72 lg:h-auto"
                  />
                </a>
              ) : (
                <div className="flex aspect-[3/4] items-center justify-center rounded-xl border border-dashed border-border text-xs text-muted-foreground">
                  Pilih jenis pakaian
                </div>
              )}
              {chartForm.measurements.length > 0 && (
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {chartForm.measurements.flatMap(m =>
                    isChestMeasurement(m)
                      ? [
                          <li key={`${m.key}-1`} className="flex items-center gap-1.5"><CodeChip code={m.code} sup="1" /> Lebar dada (diukur datar)</li>,
                          <li key={`${m.key}-2`} className="flex items-center gap-1.5"><CodeChip code={m.code} sup="2" /> Lingkar dada</li>
                        ]
                      : [<li key={m.key} className="flex items-center gap-1.5"><CodeChip code={m.code} /> {m.label}</li>]
                  )}
                </ul>
              )}
            </aside>

            <div className="min-w-0 space-y-4">
              {/* 3. Owner and name */}
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

              {/* 4. The table, columns as printed */}
              <div>
                <span className="mb-1.5 block text-sm font-semibold text-foreground">Ukuran (cm)</span>
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/60 text-xs font-semibold text-muted-foreground">
                      <tr>
                        <th scope="col" className="px-2 py-2 text-left">
                          <span className="inline-flex h-6 items-center rounded-md bg-brand-teal px-2 text-xs font-bold text-slate-900">Size</span>
                        </th>
                        {chartForm.measurements.flatMap(m =>
                          isChestMeasurement(m)
                            ? [
                                <th key={`${m.key}-1`} scope="col" className="px-2 py-2 text-center whitespace-nowrap">
                                  <span className="flex flex-col items-center gap-1"><CodeChip code={m.code} sup="1" /> Lebar Dada</span>
                                </th>,
                                <th key={`${m.key}-2`} scope="col" className="px-2 py-2 text-center whitespace-nowrap">
                                  <span className="flex flex-col items-center gap-1"><CodeChip code={m.code} sup="2" /> Lingkar Dada</span>
                                </th>
                              ]
                            : [
                                <th key={m.key} scope="col" className="px-2 py-2 text-center whitespace-nowrap">
                                  <span className="flex flex-col items-center gap-1"><CodeChip code={m.code} /> {m.label}</span>
                                </th>
                              ]
                        )}
                        <th scope="col" className="w-10 px-2 py-2"><span className="sr-only">Hapus</span></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {chartForm.rows.length === 0 ? (
                        <tr>
                          <td colSpan={chartForm.measurements.length + 3} className="px-3 py-4 text-center text-sm text-muted-foreground">
                            {chartForm.measurements.length === 0 ? 'Pilih jenis pakaian di atas.' : 'Belum ada baris ukuran.'}
                          </td>
                        </tr>
                      ) : (
                        chartForm.rows.map((r, index) => {
                          const sizeName = r.size || `baris ${index + 1}`;
                          return (
                            <tr key={index}>
                              <td className="px-2 py-1.5">
                                <Input
                                  aria-label={`Nama ukuran baris ${index + 1}`}
                                  value={r.size}
                                  placeholder="S"
                                  onChange={e => updateRow(index, row => ({ ...row, size: e.target.value.toUpperCase() }))}
                                  className="h-9 w-16 text-center font-mono font-bold"
                                />
                              </td>
                              {chartForm.measurements.flatMap(m => {
                                if (!isChestMeasurement(m)) {
                                  return [
                                    <td key={m.key} className="px-2 py-1.5">
                                      <Input
                                        aria-label={`${m.label} ukuran ${sizeName}`}
                                        inputMode="decimal"
                                        value={r.values[m.key] || ''}
                                        onChange={e => updateValue(index, m.key, e.target.value)}
                                        className="h-9 min-w-16 text-center tabular-nums"
                                      />
                                    </td>
                                  ];
                                }
                                const [width, around] = splitChest(r.values[m.key]);
                                return [
                                  <td key={`${m.key}-1`} className="px-2 py-1.5">
                                    <Input
                                      aria-label={`Lebar dada ukuran ${sizeName}`}
                                      inputMode="decimal"
                                      value={width}
                                      onChange={e => updateChestWidth(index, m.key, e.target.value)}
                                      className="h-9 min-w-16 text-center tabular-nums"
                                    />
                                  </td>,
                                  <td key={`${m.key}-2`} className="px-2 py-1.5">
                                    <Input
                                      aria-label={`Lingkar dada ukuran ${sizeName}`}
                                      inputMode="decimal"
                                      value={around}
                                      onChange={e => updateChestAround(index, m.key, e.target.value)}
                                      className="h-9 min-w-16 text-center tabular-nums"
                                    />
                                  </td>
                                ];
                              })}
                              <td className="px-2 py-1.5 text-right">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`Hapus ukuran ${sizeName}`}
                                  onClick={() => setChartForm(prev => ({ ...prev, rows: prev.rows.filter((_, i) => i !== index) }))}
                                  className="size-8 text-brand-red hover:bg-rose-50"
                                >
                                  <Trash2 size={14} aria-hidden="true" />
                                </Button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={chartForm.measurements.length === 0}
                    onClick={addSizeRow}
                  >
                    <Plus size={14} aria-hidden="true" /> Tambah Ukuran
                  </Button>
                  {chartForm.measurements.some(isChestMeasurement) && (
                    <span className="text-xs text-muted-foreground">
                      Lingkar dada terisi otomatis 2× lebar dada; ubah bila berbeda.
                    </span>
                  )}
                </div>
              </div>

              <div>
                <FieldLabel htmlFor="szc-notes" aside="Opsional">Catatan</FieldLabel>
                <textarea
                  id="szc-notes"
                  rows={2}
                  value={chartForm.notes}
                  onChange={e => setChartForm(prev => ({ ...prev, notes: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal"
                />
              </div>
            </div>
          </div>
        </form>
      </Modal>

      <Toast toast={toast} />
      {confirmDialog}
    </div>
  );
};
