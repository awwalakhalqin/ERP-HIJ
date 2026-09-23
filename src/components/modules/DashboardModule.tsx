import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  ShoppingCart,
  Package,
  Wallet,
  ArrowRight,
  QrCode,
  RefreshCw,
  Scissors,
  Component,
  ShieldCheck,
  ClipboardList,
  AlertTriangle
} from 'lucide-react';
import { fetchDashboardStatsApi, fetchResource } from '../../services/api';
import { cn, formatCurrency } from '../../lib/utils';
import { ordersAwaitingSpk } from '../../lib/readiness';
import { Badge, DeadlineBadge, StatusBadge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { PageHeader } from '../ui/PageHeader';
import { SOPModule, SPK, Order } from '../../types';

interface KpiCardProps {
  label: string;
  /** Page the card opens, for the accessible name. */
  destination: string;
  icon: React.ReactNode;
  value: React.ReactNode;
  valueClassName?: string;
  valueTitle?: string;
  detail: React.ReactNode;
  onClick: () => void;
}

/** Headline number that opens its module. The whole card is one button. */
const KpiCard: React.FC<KpiCardProps> = ({ label, destination, icon, value, valueClassName, valueTitle, detail, onClick }) => (
  <Card className="min-w-0 p-0 transition-colors hover:border-brand-teal/40">
    <button
      type="button"
      onClick={onClick}
      className="flex h-full w-full flex-col rounded-xl p-4 sm:p-5 text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal focus-visible:ring-offset-2"
    >
      <span className="mb-2 flex items-start justify-between gap-2 text-sm font-medium text-slate-600">
        <span className="min-w-0">{label}</span>
        {icon}
      </span>
      <span className={cn('block font-bold text-black tabular-nums', valueClassName ?? 'text-2xl sm:text-3xl')} title={valueTitle}>
        {value}
      </span>
      <span className="mt-2 block text-sm font-semibold text-brand-teal-dark">{detail}</span>
      <span className="sr-only">, buka halaman {destination}</span>
    </button>
  </Card>
);

interface ProgressBarProps {
  value: number;
  label: string;
  barClassName: string;
}

const ProgressBar: React.FC<ProgressBarProps> = ({ value, label, barClassName }) => {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className="w-full bg-slate-200 h-2 rounded-full overflow-hidden"
    >
      <div className={cn('h-full rounded-full', barClassName)} style={{ width: `${pct}%` }} />
    </div>
  );
};

interface DashboardProps {
  onNavigate: (module: SOPModule) => void;
  onOpenScanner: () => void;
}

export const DashboardModule: React.FC<DashboardProps> = ({ onNavigate, onOpenScanner }) => {
  // Only the defect rate is read from the stats endpoint; everything else is
  // computed here from the records themselves.
  const [stats, setStats] = useState<{ defectRate?: string }>({});
  const [statsError, setStatsError] = useState<string | null>(null);

  const [activeSpks, setActiveSpks] = useState<SPK[]>([]);
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);
  const [rawMaterials, setRawMaterials] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string>('');

  const loadDashboardData = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      /*
       * Each request stands on its own: the stats endpoint failing used to
       * blank the whole page although the SPK and order lists had loaded fine.
       */
      const [statsRes, spkRes, orderRes, materialRes] = await Promise.allSettled([
        fetchDashboardStatsApi(),
        fetchResource<SPK>('spk_produksi'),
        fetchResource<Order>('orders'),
        fetchResource<any>('raw-materials')
      ]);
      if (statsRes.status === 'fulfilled') {
        setStats(statsRes.value || {});
        setStatsError(null);
      } else {
        console.error('Failed to load dashboard stats:', statsRes.reason);
        setStatsError(statsRes.reason?.message || 'Statistik ringkas belum bisa dimuat.');
      }
      if (spkRes.status === 'fulfilled') setActiveSpks(spkRes.value || []);
      else console.error('Failed to load SPKs:', spkRes.reason);
      if (orderRes.status === 'fulfilled') setRecentOrders(orderRes.value || []);
      else console.error('Failed to load orders:', orderRes.reason);
      if (materialRes.status === 'fulfilled') setRawMaterials(materialRes.value || []);
      else console.error('Failed to load raw materials:', materialRes.reason);
      const now = new Date();
      setLastUpdated(now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  // Operational calculations (Real values only)
  const metrics = useMemo(() => {
    const inProgress = activeSpks.filter(s => s.status !== 'Completed');
    const targetPcs = inProgress.reduce((a, s) => a + (Number(s.targetQty) || 0), 0);
    const cutPcs = inProgress.reduce((a, s) => a + (Number(s.cutting) || 0), 0);
    const sewnPcs = inProgress.reduce((a, s) => a + (Number(s.sewing) || 0), 0);
    const qcPcs = inProgress.reduce((a, s) => a + (Number(s.qc) || 0), 0);
    const finishedPcs = inProgress.reduce((a, s) => a + (Number(s.finishing) || 0), 0);

    // A cancelled order is neither an incoming order nor money on the table.
    const liveOrders = recentOrders.filter(o => o.status !== 'Cancelled');
    const totalOrdersAmount = liveOrders.reduce((a, o) => a + (Number(o.totalPrice) || 0), 0);
    const totalDp = liveOrders.reduce((a, o) => a + (Number(o.downPayment) || 0), 0);
    const dpPercent = totalOrdersAmount > 0 ? Math.round((totalDp / totalOrdersAmount) * 100) : 0;

    return {
      inProgress,
      liveOrderCount: liveOrders.length,
      targetPcs,
      cutPcs,
      cutPct: targetPcs > 0 ? Math.min(100, Math.round((cutPcs / targetPcs) * 100)) : 0,
      sewnPcs,
      sewnPct: targetPcs > 0 ? Math.min(100, Math.round((sewnPcs / targetPcs) * 100)) : 0,
      qcPcs,
      qcPct: targetPcs > 0 ? Math.min(100, Math.round((qcPcs / targetPcs) * 100)) : 0,
      finishedPcs,
      finPct: targetPcs > 0 ? Math.min(100, Math.round((finishedPcs / targetPcs) * 100)) : 0,
      totalOrdersAmount,
      totalDp,
      dpPercent
    };
  }, [activeSpks, recentOrders]);

  /*
   * "Progres SPK" is about work in flight, so finished SPKs step aside while
   * anything is still running. With nothing running, the finished ones are the
   * only story to tell and are shown instead of an empty panel.
   */
  const spotlightSpks = useMemo(
    () => (metrics.inProgress.length > 0 ? metrics.inProgress : activeSpks),
    [metrics.inProgress, activeSpks]
  );

  // Attention items (SOP-03 & SOP-04/05)
  const awaitingSpkCount = useMemo(() => ordersAwaitingSpk(recentOrders, activeSpks).length, [recentOrders, activeSpks]);
  const lowStockCount = useMemo(() => rawMaterials.filter(r =>
    typeof r?.name === 'string' &&
    r?.stock !== undefined && r?.stock !== null && !isNaN(Number(r.stock)) &&
    r?.minStock !== undefined && r?.minStock !== null && !isNaN(Number(r.minStock)) &&
    Number(r.stock) <= Number(r.minStock)
  ).length, [rawMaterials]);

  /*
   * The deadline panel answers "which order is due next", so it lists open
   * orders that actually have a deadline, soonest (and overdue) first. Newest-
   * created order is a different question, and finished orders are not due.
   */
  const deadlineOrders = useMemo(
    () =>
      recentOrders
        .filter(o => !!o.deadline && o.status !== 'Completed' && o.status !== 'Cancelled')
        .sort((a, b) => String(a.deadline).localeCompare(String(b.deadline))),
    [recentOrders]
  );

  /* Deadline chip: overdue reads critical, due within 3 days warning, the rest idle. */
  const getDeadlineTag = (dateStr?: string, status?: string) => {
    const completed = status === 'Completed';
    if (completed && !dateStr) {
      return <Badge variant="done" size="sm">Selesai</Badge>;
    }
    return <DeadlineBadge deadline={dateStr} completed={completed} />;
  };

  const stageTiles: {
    module: SOPModule;
    label: string;
    destination: string;
    icon: React.ReactNode;
    pct: number;
    pcs: number;
    pctClass: string;
    barClass: string;
    hoverClass: string;
  }[] = [
    {
      module: 'Cutting',
      label: 'Pemotongan',
      destination: 'Pemotongan',
      icon: <Scissors size={16} className="shrink-0 text-brand-teal" aria-hidden="true" />,
      pct: metrics.cutPct,
      pcs: metrics.cutPcs,
      pctClass: 'text-brand-teal-dark',
      barClass: 'bg-brand-teal',
      hoverClass: 'hover:border-brand-teal'
    },
    {
      module: 'Sewing',
      label: 'Penjahitan',
      destination: 'Penjahitan',
      icon: <Component size={16} className="shrink-0 text-brand-teal-dark" aria-hidden="true" />,
      pct: metrics.sewnPct,
      pcs: metrics.sewnPcs,
      pctClass: 'text-brand-teal-dark',
      barClass: 'bg-brand-teal-dark',
      hoverClass: 'hover:border-brand-teal-dark'
    },
    {
      module: 'QC',
      label: 'QC',
      destination: 'Pemeriksaan QC',
      icon: <ShieldCheck size={16} className="shrink-0 text-brand-teal" aria-hidden="true" />,
      pct: metrics.qcPct,
      pcs: metrics.qcPcs,
      pctClass: 'text-brand-teal-dark',
      barClass: 'bg-brand-teal',
      hoverClass: 'hover:border-brand-teal'
    },
    {
      module: 'Packaging',
      label: 'Pengemasan',
      destination: 'Pengemasan & Siap Kirim',
      icon: <Package size={16} className="shrink-0 text-black" aria-hidden="true" />,
      pct: metrics.finPct,
      pcs: metrics.finishedPcs,
      pctClass: 'text-black',
      barClass: 'bg-black',
      hoverClass: 'hover:border-black'
    }
  ];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="Dasbor"
        description={lastUpdated ? <span aria-live="polite">Diperbarui pukul {lastUpdated}</span> : undefined}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadDashboardData(true)}
              disabled={refreshing}
              title="Muat ulang data"
            >
              <RefreshCw
                size={16}
                className={refreshing ? 'animate-spin motion-reduce:animate-none' : ''}
                aria-hidden="true"
              />
              <span>Muat Ulang</span>
            </Button>

            <Button variant="outline" size="sm" onClick={onOpenScanner}>
              <QrCode size={16} aria-hidden="true" />
              <span>Scan QR</span>
            </Button>

            <Button size="sm" onClick={() => onNavigate('Orders')}>
              <ShoppingCart size={16} aria-hidden="true" />
              <span>Pesanan Baru</span>
            </Button>
          </>
        }
      />

      {/* ATTENTION ALERTS — waiting work reads warning, low stock reads critical */}
      {(awaitingSpkCount > 0 || lowStockCount > 0) && (
        <div className="flex flex-wrap gap-3">
          {awaitingSpkCount > 0 && (
            <button
              type="button"
              onClick={() => onNavigate('PPIC')}
              className="inline-flex min-h-10 items-center gap-2 px-4 py-2.5 rounded-xl border border-status-warning-border bg-status-warning-bg text-left text-sm font-bold text-status-warning hover:bg-status-warning-border/50 transition-colors shadow-xs cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal focus-visible:ring-offset-2"
            >
              <ClipboardList size={16} className="shrink-0" aria-hidden="true" />
              {awaitingSpkCount} pesanan menunggu SPK
              <ArrowRight size={16} className="shrink-0" aria-hidden="true" />
            </button>
          )}
          {lowStockCount > 0 && (
            <button
              type="button"
              onClick={() => onNavigate('RawMaterial')}
              className="inline-flex min-h-10 items-center gap-2 px-4 py-2.5 rounded-xl border border-status-critical-border bg-status-critical-bg text-left text-sm font-bold text-status-critical hover:bg-status-critical-border/50 transition-colors shadow-xs cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal focus-visible:ring-offset-2"
            >
              <AlertTriangle size={16} className="shrink-0" aria-hidden="true" />
              {lowStockCount} bahan stok menipis
              <ArrowRight size={16} className="shrink-0" aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      {statsError && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-xl border border-status-warning-border bg-status-warning-bg px-3.5 py-2.5 text-sm font-medium text-status-warning"
        >
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>Statistik ringkas (tingkat cacat) belum bisa dimuat: {statsError}. Angka lain di halaman ini tetap dari data terbaru.</span>
        </p>
      )}

      {/* 4 CORE KPI METRICS */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KpiCard
          label="Pesanan Masuk"
          destination="Pesanan Masuk"
          icon={<ShoppingCart size={18} className="shrink-0 text-brand-teal" aria-hidden="true" />}
          value={metrics.liveOrderCount}
          detail={<>{metrics.inProgress.length} SPK berjalan &middot; target {metrics.targetPcs.toLocaleString('id-ID')} Pcs</>}
          onClick={() => onNavigate('Orders')}
        />

        <KpiCard
          label="Sudah Dijahit"
          destination="Penjahitan"
          icon={<Component size={18} className="shrink-0 text-brand-teal-dark" aria-hidden="true" />}
          value={<>{metrics.sewnPct}%</>}
          detail={<>{metrics.sewnPcs.toLocaleString('id-ID')} dari {metrics.targetPcs.toLocaleString('id-ID')} Pcs</>}
          onClick={() => onNavigate('Sewing')}
        />

        <KpiCard
          label="Lolos QC"
          destination="Pemeriksaan QC"
          icon={<ShieldCheck size={18} className="shrink-0 text-brand-teal" aria-hidden="true" />}
          value={<>{metrics.qcPcs.toLocaleString('id-ID')} <span className="text-base font-medium text-slate-500">Pcs</span></>}
          detail={<>Tingkat cacat {statsError ? '—' : stats.defectRate || '0%'}</>}
          onClick={() => onNavigate('QC')}
        />

        <KpiCard
          label="Nilai Pesanan"
          destination="Keuangan"
          icon={<Wallet size={18} className="shrink-0 text-black" aria-hidden="true" />}
          value={formatCurrency(metrics.totalOrdersAmount)}
          valueClassName="text-base sm:text-xl whitespace-nowrap truncate"
          valueTitle={formatCurrency(metrics.totalOrdersAmount)}
          detail={<>DP dibayar {metrics.dpPercent}%</>}
          onClick={() => onNavigate('Finance')}
        />
      </div>

      {/* PROGRES PER TAHAP */}
      <Card className="p-5 space-y-4">
        <h2 className="text-base font-bold text-black">
          Progres per Tahap
        </h2>

        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
          {stageTiles.map(tile => (
            <div
              key={tile.module}
              className={cn(
                'relative min-w-0 p-3 sm:p-4 bg-teal-50/40 rounded-xl border border-teal-200/80 transition-colors space-y-2',
                tile.hoverClass
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-sm font-semibold text-black">
                {/* The button's ::after covers the whole tile, so the tile is one click/focus target. */}
                <button
                  type="button"
                  onClick={() => onNavigate(tile.module)}
                  className="flex min-w-0 items-center gap-2 text-left cursor-pointer focus-visible:outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-brand-teal"
                >
                  {tile.icon}
                  <span className="min-w-0 break-words">{tile.label}</span>
                  <span className="sr-only">, buka halaman {tile.destination}</span>
                </button>
                <span className={cn('font-bold tabular-nums', tile.pctClass)}>{tile.pct}%</span>
              </div>
              <div className="text-lg sm:text-xl font-bold text-black tabular-nums whitespace-nowrap">
                {tile.pcs.toLocaleString('id-ID')} <span className="text-sm font-medium text-slate-500">Pcs</span>
              </div>
              <ProgressBar value={tile.pct} label={`Progres ${tile.label}`} barClassName={tile.barClass} />
            </div>
          ))}
        </div>
      </Card>

      {/* DUA LAPORAN RINGKAS: Name, Value, Progress ONLY */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* LAPORAN 1: Antrian SPK Produksi */}
        <Card className="lg:col-span-7 p-5 space-y-4">
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-border">
            <h2 className="text-base font-bold text-black">
              Progres SPK
            </h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onNavigate('PPIC')}
              aria-label="Lihat semua SPK"
              className="h-10"
            >
              Lihat Semua <ArrowRight size={16} aria-hidden="true" />
            </Button>
          </div>

          {loading && activeSpks.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500" role="status">Memuat SPK…</p>
          ) : activeSpks.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">Belum ada SPK.</p>
          ) : metrics.inProgress.length === 0 && (
            <p className="text-xs text-slate-500">Semua SPK sudah selesai; menampilkan yang terakhir.</p>
          )}

          <div className="space-y-3">
            {spotlightSpks.slice(0, 6).map(spk => (
              <div
                key={spk.id}
                className="p-4 bg-teal-50/30 rounded-xl border border-teal-200/60 space-y-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <span className="font-mono font-bold text-xs text-brand-teal-dark bg-teal-100/80 border border-teal-300/60 px-2 py-0.5 rounded-md break-words">
                      {spk.id}
                    </span>
                    <StatusBadge status={spk.status} />
                  </div>
                  {getDeadlineTag(spk.deadline || spk.tanggalSelesai, spk.status)}
                </div>

                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-black break-words">
                      {spk.productName}
                    </div>
                    <div className="text-sm text-slate-600 break-words">
                      {spk.customerName}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-sm font-bold text-black whitespace-nowrap tabular-nums">
                      {(spk.targetQty || 0).toLocaleString('id-ID')} Pcs
                    </span>
                  </div>
                </div>

                {/* Progress bar and stations count */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-700 font-medium">
                    <span className="min-w-0 tabular-nums">
                      Potong {spk.cutting || 0} · Jahit {spk.sewing || 0} · QC {spk.qc || 0}
                    </span>
                    <span className="text-sm text-brand-teal-dark font-extrabold tabular-nums">{spk.progress || 0}%</span>
                  </div>
                  <ProgressBar
                    value={spk.progress || 0}
                    label={`Progres ${spk.id}`}
                    barClassName="bg-brand-teal-dark"
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* LAPORAN 2: Deadline Pesanan */}
        <Card className="lg:col-span-5 p-5 space-y-4">
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-border">
            <h2 className="text-base font-bold text-black">
              Deadline Pesanan
            </h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onNavigate('Orders')}
              aria-label="Lihat semua pesanan"
              className="h-10"
            >
              Lihat Semua <ArrowRight size={16} aria-hidden="true" />
            </Button>
          </div>

          {loading && recentOrders.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500" role="status">Memuat pesanan…</p>
          ) : deadlineOrders.length === 0 && (
            <p className="py-6 text-center text-sm text-slate-500">
              {recentOrders.length === 0 ? 'Belum ada pesanan.' : 'Tidak ada pesanan berjalan yang punya deadline.'}
            </p>
          )}

          <div className="space-y-3">
            {deadlineOrders.slice(0, 6).map(order => {
              const priced = (Number(order.totalPrice) || 0) > 0;
              const isPaid = priced && (order.downPayment || 0) >= (order.totalPrice || 0);
              const dpPct = priced ? Math.round(((order.downPayment || 0) / order.totalPrice) * 100) : 0;

              return (
                <div
                  key={order.id}
                  className="p-4 bg-teal-50/30 rounded-xl border border-teal-200/60 space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-bold text-black font-mono break-words min-w-0">
                      {order.po || order.id}
                    </span>
                    {getDeadlineTag(order.deadline, order.status)}
                  </div>

                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-black break-words">
                        {order.productType || 'Garmen'}
                      </div>
                      <div className="text-sm text-slate-600 break-words">
                        {order.customerName} · <span className="whitespace-nowrap">{(order.quantity || 0).toLocaleString('id-ID')} Pcs</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-bold text-black whitespace-nowrap tabular-nums">
                        {priced ? formatCurrency(order.totalPrice) : <span className="font-normal text-slate-500">Harga belum diisi</span>}
                      </div>
                      <div className="text-xs font-semibold text-slate-600">
                        {!priced ? null : isPaid ? (
                          <span className="font-bold text-status-done">Lunas</span>
                        ) : (
                          <span className="font-bold text-status-warning">DP {dpPct}%</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
};
