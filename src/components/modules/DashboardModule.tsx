import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  ShoppingCart,
  Wallet,
  ArrowRight,
  QrCode,
  RefreshCw,
  Scissors,
  Component,
  ShieldCheck,
  ClipboardList,
  AlertTriangle,
  HandCoins,
  Package,
  TrendingUp,
  TrendingDown,
  Minus,
  NotebookPen,
  BadgeCheck
} from 'lucide-react';
import { fetchDashboardStatsApi, fetchResource } from '../../services/api';
import { cn, formatCurrency, todayLocal } from '../../lib/utils';
import { ageInDays, isCounted, isOpenTalangan, payerKey, DAILY_CASH_TYPES } from '../../lib/dailyCash';
import { ordersAwaitingSpk } from '../../lib/readiness';
import { Badge, DeadlineBadge, StatusBadge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Sparkline, TrendChart, TrendPoint } from '../dashboard/charts';
import { SOPModule, SPK, Order, DailyCashEntry } from '../../types';

/* ------------------------------------------------------------------ periods */

type RangeDays = 7 | 30 | 90;
const RANGES: { days: RangeDays; label: string }[] = [
  { days: 7, label: '7 hari' },
  { days: 30, label: '30 hari' },
  { days: 90, label: '90 hari' }
];

const DAY_MS = 24 * 60 * 60 * 1000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Local calendar day of a stored value: "YYYY-MM-DD" stays as is, a timestamp is converted. */
function dayOf(value?: string): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : todayLocal(d);
}

interface Bucket {
  /** First and last day covered, inclusive, as "YYYY-MM-DD". */
  from: string;
  to: string;
  label: string;
  fullLabel: string;
}

/*
 * Days for 7 and 30, weeks for 90: thirteen weekly points read as a trend,
 * ninety daily ones read as noise.
 */
function buildBuckets(days: RangeDays, offsetPeriods = 0): Bucket[] {
  const end = new Date(startOfDay(new Date()).getTime() - offsetPeriods * days * DAY_MS);
  const step = days === 90 ? 7 : 1;
  const count = Math.ceil(days / step);
  const out: Bucket[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const last = new Date(end.getTime() - i * step * DAY_MS);
    const first = new Date(last.getTime() - (step - 1) * DAY_MS);
    const short = first.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
    out.push({
      from: todayLocal(first),
      to: todayLocal(last),
      label: step === 1 && days === 7 ? first.toLocaleDateString('id-ID', { weekday: 'short' }) : short,
      fullLabel: step === 1
        ? first.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short' })
        : `Minggu ${short} – ${last.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}`
    });
  }
  return out;
}

function seriesFor<T>(buckets: Bucket[], rows: T[], day: (r: T) => string | null, value: (r: T) => number): number[] {
  return buckets.map(b => rows.reduce((sum, r) => {
    const d = day(r);
    return d && d >= b.from && d <= b.to ? sum + value(r) : sum;
  }, 0));
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Change against the previous period of the same length; null when there is nothing to compare with. */
const deltaPct = (current: number, previous: number) => (previous > 0 ? ((current - previous) / previous) * 100 : null);

const compactRupiah = (v: number) => {
  if (v >= 1e9) return `${(v / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 1 })} M`;
  if (v >= 1e6) return `${(v / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`;
  if (v >= 1e3) return `${(v / 1e3).toLocaleString('id-ID', { maximumFractionDigits: 0 })} rb`;
  return v.toLocaleString('id-ID');
};

function relativeTime(value?: string): string {
  if (!value) return '';
  const t = new Date(value).getTime();
  if (isNaN(t)) return '';
  const diff = Date.now() - t;
  const min = Math.round(diff / 60000);
  if (min < 1) return 'baru saja';
  if (min < 60) return `${min} menit lalu`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'kemarin';
  if (days < 7) return `${days} hari lalu`;
  return new Date(t).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

function greeting(now = new Date()) {
  const h = now.getHours();
  if (h < 11) return 'Selamat pagi';
  if (h < 15) return 'Selamat siang';
  if (h < 18) return 'Selamat sore';
  return 'Selamat malam';
}

/* --------------------------------------------------------------- pieces */

const Delta: React.FC<{ pct: number | null; /** For spending, going up is not good news. */ invert?: boolean }> = ({ pct, invert }) => {
  if (pct === null) return <span className="text-xs font-medium text-muted-foreground">belum ada pembanding</span>;
  const rounded = Math.round(pct);
  const up = rounded > 0;
  const flat = rounded === 0;
  const good = flat ? null : invert ? !up : up;
  const Icon = flat ? Minus : up ? TrendingUp : TrendingDown;
  return (
    <span className={cn(
      'inline-flex items-center gap-1 text-xs font-bold tabular-nums',
      good === null ? 'text-muted-foreground' : good ? 'text-status-done' : 'text-status-critical'
    )}>
      <Icon size={14} aria-hidden="true" />
      {up ? '+' : ''}{rounded}%
      <span className="font-medium text-muted-foreground">vs periode lalu</span>
    </span>
  );
};

interface KpiCardProps {
  label: string;
  /** Page the card opens, for the accessible name. */
  destination: string;
  icon: React.ReactNode;
  value: React.ReactNode;
  valueTitle?: string;
  footer: React.ReactNode;
  trend?: number[];
  trendLabel?: string;
  onClick: () => void;
}

/** Headline number that opens its module. The whole card is one button. */
const KpiCard: React.FC<KpiCardProps> = ({ label, destination, icon, value, valueTitle, footer, trend, trendLabel, onClick }) => (
  <Card className="min-w-0 p-0 transition-colors hover:border-brand-teal/50">
    <button
      type="button"
      onClick={onClick}
      className="flex h-full w-full flex-col gap-1 rounded-xl p-4 text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal focus-visible:ring-offset-2"
    >
      <span className="flex items-start justify-between gap-2 text-sm font-medium text-slate-600">
        <span className="min-w-0">{label}</span>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-teal-50">{icon}</span>
      </span>
      <span className="block truncate text-2xl font-extrabold tracking-tight text-black tabular-nums @5xl:text-[1.7rem]" title={valueTitle}>
        {value}
      </span>
      <span className="block min-h-5">{footer}</span>
      {trend && <Sparkline values={trend} label={trendLabel ?? `Tren ${label}`} className="mt-1" />}
      <span className="sr-only">, buka halaman {destination}</span>
    </button>
  </Card>
);

const PanelHeader: React.FC<{ title: string; subtitle?: React.ReactNode; action?: React.ReactNode }> = ({ title, subtitle, action }) => (
  <div className="flex flex-wrap items-start justify-between gap-2">
    <div className="min-w-0">
      <h2 className="text-base font-bold text-black">{title}</h2>
      {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
    </div>
    {action}
  </div>
);

const SeeAll: React.FC<{ onClick: () => void; label: string }> = ({ onClick, label }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-semibold text-brand-teal-dark hover:bg-teal-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal"
  >
    Lihat semua <ArrowRight size={15} aria-hidden="true" />
  </button>
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
      className="w-full bg-slate-100 h-2 rounded-full overflow-hidden"
    >
      <div className={cn('h-full rounded-full', barClassName)} style={{ width: `${pct}%` }} />
    </div>
  );
};

/* -------------------------------------------------------------- module */

interface DashboardProps {
  userName?: string;
  onNavigate: (module: SOPModule) => void;
  onOpenScanner: () => void;
}

export const DashboardModule: React.FC<DashboardProps> = ({ userName, onNavigate, onOpenScanner }) => {
  // Only the defect rate is read from the stats endpoint; everything else is
  // computed here from the records themselves.
  const [stats, setStats] = useState<{ defectRate?: string }>({});
  const [statsError, setStatsError] = useState<string | null>(null);

  const [activeSpks, setActiveSpks] = useState<SPK[]>([]);
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);
  const [rawMaterials, setRawMaterials] = useState<any[]>([]);
  const [cashEntries, setCashEntries] = useState<DailyCashEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const [range, setRange] = useState<RangeDays>(30);
  const [trendMetric, setTrendMetric] = useState<'count' | 'value'>('count');

  const loadDashboardData = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      /*
       * Each request stands on its own: the stats endpoint failing used to
       * blank the whole page although the SPK and order lists had loaded fine.
       */
      const [statsRes, spkRes, orderRes, materialRes, cashRes] = await Promise.allSettled([
        fetchDashboardStatsApi(),
        fetchResource<SPK>('spk_produksi'),
        fetchResource<Order>('orders'),
        fetchResource<any>('raw-materials'),
        fetchResource<DailyCashEntry>('daily-cash')
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
      if (cashRes.status === 'fulfilled') setCashEntries(cashRes.value || []);
      else console.error('Failed to load daily cash entries:', cashRes.reason);
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
    const pct = (n: number) => (targetPcs > 0 ? Math.min(100, Math.round((n / targetPcs) * 100)) : 0);

    return {
      inProgress,
      liveOrders,
      targetPcs,
      cutPcs,
      cutPct: pct(cutPcs),
      sewnPcs,
      sewnPct: pct(sewnPcs),
      qcPcs,
      qcPct: pct(qcPcs),
      finishedPcs,
      finPct: pct(finishedPcs),
      totalOrdersAmount,
      dpPercent
    };
  }, [activeSpks, recentOrders]);

  /*
   * The period figures: orders by the day they were entered, spending by the
   * day the money went out. Each total is compared with the period of the same
   * length just before it.
   */
  const period = useMemo(() => {
    const now = buildBuckets(range);
    const prev = buildBuckets(range, 1);
    const orderDay = (o: Order) => dayOf(o.timestamp);
    const orders = metrics.liveOrders;
    const cash = cashEntries.filter(isCounted);

    const countNow = seriesFor(now, orders, orderDay, () => 1);
    const valueNow = seriesFor(now, orders, orderDay, o => Number(o.totalPrice) || 0);
    const spendNow = seriesFor(now, cash, e => dayOf(e.date), e => Number(e.amount) || 0);

    const countPrev = sum(seriesFor(prev, orders, orderDay, () => 1));
    const valuePrev = sum(seriesFor(prev, orders, orderDay, o => Number(o.totalPrice) || 0));
    const spendPrev = sum(seriesFor(prev, cash, e => dayOf(e.date), e => Number(e.amount) || 0));

    return {
      buckets: now,
      countNow, valueNow, spendNow,
      count: sum(countNow), value: sum(valueNow), spend: sum(spendNow),
      countDelta: deltaPct(sum(countNow), countPrev),
      valueDelta: deltaPct(sum(valueNow), valuePrev),
      spendDelta: deltaPct(sum(spendNow), spendPrev)
    };
  }, [range, metrics.liveOrders, cashEntries]);

  const trendPoints: TrendPoint[] = useMemo(
    () => period.buckets.map((b, i) => ({
      label: b.label,
      fullLabel: b.fullLabel,
      value: trendMetric === 'count' ? period.countNow[i] : period.valueNow[i]
    })),
    [period, trendMetric]
  );

  /*
   * "Progres SPK" is about work in flight, so finished SPKs step aside while
   * anything is still running. With nothing running, the finished ones are the
   * only story to tell and are shown instead of an empty panel.
   */
  const spotlightSpks = useMemo(
    () => (metrics.inProgress.length > 0 ? metrics.inProgress : activeSpks),
    [metrics.inProgress, activeSpks]
  );

  /* Spending from Catatan Keuangan Harian; cancelled entries are not money spent. */
  const spending = useMemo(() => {
    const today = todayLocal();
    const month = cashEntries.filter(e => isCounted(e) && String(e.date).startsWith(today.slice(0, 7)));
    const total = (rows: DailyCashEntry[]) => rows.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const open = cashEntries.filter(isOpenTalangan);
    return {
      monthTotal: total(month),
      todayTotal: total(month.filter(e => e.date === today)),
      officeTotal: total(month.filter(e => e.paidWith === 'Kas Kantor')),
      talanganTotal: total(month.filter(e => e.paidWith === 'Ditalangi')),
      byType: DAILY_CASH_TYPES.map(type => ({ label: type, total: total(month.filter(e => e.type === type)) })),
      openTotal: total(open),
      openCount: open.length,
      openPeople: new Set(open.map(e => payerKey(e.payerName))).size,
      oldestDays: open.reduce((max, e) => Math.max(max, ageInDays(e.timestamp)), 0)
    };
  }, [cashEntries]);

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

  /* What happened lately, newest first: orders in, DP approved, SPKs issued, money spent. */
  const activity = useMemo(() => {
    type Event = { id: string; at: string; icon: React.ElementType; title: React.ReactNode; detail: string; module: SOPModule };
    const events: Event[] = [];
    for (const o of recentOrders) {
      if (o.timestamp) events.push({
        id: `o-${o.id}`, at: o.timestamp, icon: ShoppingCart, module: 'Orders',
        title: <>Pesanan <b className="font-mono">{o.po || o.id}</b> masuk</>,
        detail: `${o.customerName || 'Pelanggan'} · ${(o.quantity || 0).toLocaleString('id-ID')} pcs ${o.productType || ''}`.trim()
      });
      if (o.dpApprovedAt) events.push({
        id: `dp-${o.id}`, at: o.dpApprovedAt, icon: BadgeCheck, module: 'Orders',
        title: <>DP <b className="font-mono">{o.po || o.id}</b> disetujui</>,
        detail: `${o.dpApprovedBy ? `oleh ${o.dpApprovedBy} · ` : ''}${formatCurrency(o.downPayment || 0)}`
      });
    }
    for (const s of activeSpks) {
      if (s.timestamp) events.push({
        id: `s-${s.id}`, at: s.timestamp, icon: ClipboardList, module: 'PPIC',
        title: <>SPK <b className="font-mono">{s.id}</b> diterbitkan</>,
        detail: `${s.productName || 'Produk'} · ${s.customerName || ''}`
      });
    }
    for (const e of cashEntries) {
      if (e.timestamp && isCounted(e)) events.push({
        id: `c-${e.id}`, at: e.timestamp, icon: NotebookPen, module: 'DailyCash',
        title: <>Pengeluaran <b>{e.itemName || e.category}</b> dicatat</>,
        detail: `${formatCurrency(e.amount)}${e.createdBy ? ` · ${e.createdBy}` : ''}`
      });
    }
    return events
      .filter(e => !isNaN(new Date(e.at).getTime()))
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 7);
  }, [recentOrders, activeSpks, cashEntries]);

  /* Deadline chip: overdue reads critical, due within 3 days warning, the rest idle. */
  const getDeadlineTag = (dateStr?: string, status?: string) => {
    const completed = status === 'Completed';
    if (completed && !dateStr) {
      return <Badge variant="done" size="sm">Selesai</Badge>;
    }
    return <DeadlineBadge deadline={dateStr} completed={completed} />;
  };

  const stages: { module: SOPModule; label: string; icon: React.ElementType; pct: number; pcs: number; bar: string }[] = [
    { module: 'Cutting', label: 'Pemotongan', icon: Scissors, pct: metrics.cutPct, pcs: metrics.cutPcs, bar: 'bg-brand-teal' },
    { module: 'Sewing', label: 'Penjahitan', icon: Component, pct: metrics.sewnPct, pcs: metrics.sewnPcs, bar: 'bg-brand-teal-dark' },
    { module: 'QC', label: 'QC', icon: ShieldCheck, pct: metrics.qcPct, pcs: metrics.qcPcs, bar: 'bg-brand-teal' },
    { module: 'Packaging', label: 'Pengemasan', icon: Package, pct: metrics.finPct, pcs: metrics.finishedPcs, bar: 'bg-black' }
  ];

  const firstName = (userName || '').trim().split(/\s+/)[0];
  const rangeLabel = RANGES.find(r => r.days === range)?.label ?? '';
  const todayText = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="@container mx-auto max-w-7xl space-y-5">
      {/* GREETING + PERIOD */}
      <div className="flex flex-col gap-3 @4xl:flex-row @4xl:items-end @4xl:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground text-balance @3xl:text-[1.75rem]">
            {greeting()}{firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {todayText}
            {lastUpdated && <span aria-live="polite"> · diperbarui pukul {lastUpdated}</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label="Rentang waktu" className="inline-flex rounded-lg border border-border bg-white p-0.5">
            {RANGES.map(r => (
              <button
                key={r.days}
                type="button"
                role="radio"
                aria-checked={range === r.days}
                onClick={() => setRange(r.days)}
                className={cn(
                  'h-8 rounded-md px-3 text-sm font-semibold transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal',
                  range === r.days ? 'bg-brand-teal-dark text-white' : 'text-slate-600 hover:text-foreground'
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
          <Button variant="outline" size="icon" onClick={() => loadDashboardData(true)} disabled={refreshing} title="Muat ulang data" aria-label="Muat ulang data">
            <RefreshCw size={16} className={refreshing ? 'animate-spin motion-reduce:animate-none' : ''} aria-hidden="true" />
          </Button>
          <Button variant="outline" size="sm" onClick={onOpenScanner}>
            <QrCode size={16} aria-hidden="true" />
            <span>Scan QR</span>
          </Button>
          <Button size="sm" onClick={() => onNavigate('Orders')}>
            <ShoppingCart size={16} aria-hidden="true" />
            <span>Pesanan Baru</span>
          </Button>
        </div>
      </div>

      {/* ATTENTION — below xl the right-hand panel is hidden, so the alerts sit here */}
      {(awaitingSpkCount > 0 || lowStockCount > 0) && (
        <div className="flex flex-wrap gap-3 xl:hidden">
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

      {/* KPI ROW */}
      <div className="grid grid-cols-1 gap-3 @lg:grid-cols-2 @5xl:grid-cols-4">
        <KpiCard
          label={`Pesanan masuk · ${rangeLabel}`}
          destination="Pesanan Masuk"
          icon={<ShoppingCart size={16} className="text-brand-teal-dark" aria-hidden="true" />}
          value={period.count.toLocaleString('id-ID')}
          footer={<Delta pct={period.countDelta} />}
          trend={period.countNow}
          trendLabel={`Jumlah pesanan per ${range === 90 ? 'minggu' : 'hari'}, ${rangeLabel} terakhir`}
          onClick={() => onNavigate('Orders')}
        />
        <KpiCard
          label={`Nilai pesanan · ${rangeLabel}`}
          destination="Keuangan"
          icon={<Wallet size={16} className="text-brand-teal-dark" aria-hidden="true" />}
          value={`Rp ${compactRupiah(period.value)}`}
          valueTitle={formatCurrency(period.value)}
          footer={<Delta pct={period.valueDelta} />}
          trend={period.valueNow}
          trendLabel={`Nilai pesanan per ${range === 90 ? 'minggu' : 'hari'}, ${rangeLabel} terakhir`}
          onClick={() => onNavigate('Finance')}
        />
        <KpiCard
          label="Produksi berjalan"
          destination="Surat Perintah Kerja"
          icon={<ClipboardList size={16} className="text-brand-teal-dark" aria-hidden="true" />}
          value={<>{metrics.inProgress.length} <span className="text-base font-semibold text-slate-500">SPK</span></>}
          footer={
            <span className="text-xs font-semibold text-slate-600 tabular-nums">
              {metrics.finishedPcs.toLocaleString('id-ID')} / {metrics.targetPcs.toLocaleString('id-ID')} pcs selesai
            </span>
          }
          onClick={() => onNavigate('PPIC')}
        />
        <KpiCard
          label={`Pengeluaran · ${rangeLabel}`}
          destination="Catatan Keuangan Harian"
          icon={<NotebookPen size={16} className="text-brand-teal-dark" aria-hidden="true" />}
          value={`Rp ${compactRupiah(period.spend)}`}
          valueTitle={formatCurrency(period.spend)}
          footer={<Delta pct={period.spendDelta} invert />}
          trend={period.spendNow}
          trendLabel={`Pengeluaran per ${range === 90 ? 'minggu' : 'hari'}, ${rangeLabel} terakhir`}
          onClick={() => onNavigate('DailyCash')}
        />
      </div>

      {/* TREND + STAGES */}
      <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-12">
        <Card className="min-w-0 p-5 @3xl:col-span-8">
          <PanelHeader
            title="Tren pesanan"
            subtitle={`${range === 90 ? 'Per minggu' : 'Per hari'}, ${rangeLabel} terakhir · pesanan batal tidak dihitung`}
            action={
              <div role="radiogroup" aria-label="Ukuran tren" className="inline-flex rounded-lg border border-border p-0.5 text-xs">
                {([['count', 'Jumlah'], ['value', 'Nilai']] as const).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={trendMetric === key}
                    onClick={() => setTrendMetric(key)}
                    className={cn(
                      'h-7 rounded-md px-2.5 font-semibold cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal',
                      trendMetric === key ? 'bg-teal-50 text-brand-teal-dark' : 'text-slate-500 hover:text-foreground'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            }
          />
          <div className="mt-4">
            {loading && recentOrders.length === 0 ? (
              <div className="h-[230px] animate-pulse rounded-lg bg-muted/50" role="status" aria-label="Memuat grafik" />
            ) : (
              <TrendChart
                points={trendPoints}
                label={`Tren ${trendMetric === 'count' ? 'jumlah' : 'nilai'} pesanan ${rangeLabel} terakhir`}
                format={v => (trendMetric === 'count' ? `${v.toLocaleString('id-ID')} pesanan` : formatCurrency(v))}
                formatAxis={v => (trendMetric === 'count' ? v.toLocaleString('id-ID') : compactRupiah(v))}
              />
            )}
          </div>
        </Card>

        <Card className="min-w-0 p-5 @3xl:col-span-4">
          <PanelHeader
            title="Progres per tahap"
            subtitle={`${metrics.inProgress.length} SPK berjalan · target ${metrics.targetPcs.toLocaleString('id-ID')} pcs`}
          />
          <ul className="mt-4 space-y-4">
            {stages.map(stage => {
              const Icon = stage.icon;
              return (
                <li key={stage.module}>
                  <button
                    type="button"
                    onClick={() => onNavigate(stage.module)}
                    className="group w-full space-y-1.5 rounded-lg text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal focus-visible:ring-offset-2"
                  >
                    <span className="flex items-center justify-between gap-2 text-sm">
                      <span className="flex min-w-0 items-center gap-2 font-semibold text-foreground group-hover:text-brand-teal-dark">
                        <Icon size={15} className="shrink-0 text-slate-500" aria-hidden="true" />
                        <span className="truncate">{stage.label}</span>
                      </span>
                      <span className="shrink-0 tabular-nums">
                        <span className="font-bold text-black">{stage.pct}%</span>
                        <span className="ml-1.5 text-xs text-muted-foreground">{stage.pcs.toLocaleString('id-ID')} pcs</span>
                      </span>
                    </span>
                    <ProgressBar value={stage.pct} label={`Progres ${stage.label}`} barClassName={stage.bar} />
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-5 flex items-center justify-between border-t border-border pt-3 text-xs">
            <span className="text-muted-foreground">Tingkat cacat QC</span>
            <span className="font-bold tabular-nums text-foreground">{statsError ? '—' : stats.defectRate || '0%'}</span>
          </div>
        </Card>
      </div>

      {/* SPK + DEADLINES */}
      <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-12">
        <Card className="min-w-0 p-5 @3xl:col-span-7">
          <PanelHeader title="Progres SPK" subtitle="Yang sedang berjalan" action={<SeeAll onClick={() => onNavigate('PPIC')} label="Lihat semua SPK" />} />

          <div className="mt-3">
            {loading && activeSpks.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500" role="status">Memuat SPK…</p>
            ) : activeSpks.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">Belum ada SPK.</p>
            ) : metrics.inProgress.length === 0 && (
              <p className="pb-2 text-xs text-slate-500">Semua SPK sudah selesai; menampilkan yang terakhir.</p>
            )}

            <ul className="divide-y divide-border">
              {spotlightSpks.slice(0, 5).map(spk => (
                <li key={spk.id} className="space-y-2 py-3 first:pt-1 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="rounded-md border border-teal-300/60 bg-teal-50 px-2 py-0.5 font-mono text-xs font-bold text-brand-teal-dark">{spk.id}</span>
                      <StatusBadge status={spk.status} />
                    </div>
                    {getDeadlineTag(spk.deadline || spk.tanggalSelesai, spk.status)}
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold text-black">{spk.productName}</div>
                      <div className="truncate text-xs text-slate-600">{spk.customerName}</div>
                    </div>
                    <span className="shrink-0 text-sm font-bold text-black tabular-nums">{(spk.targetQty || 0).toLocaleString('id-ID')} pcs</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <ProgressBar value={spk.progress || 0} label={`Progres ${spk.id}`} barClassName="bg-brand-teal-dark" />
                    <span className="w-10 shrink-0 text-right text-sm font-extrabold text-brand-teal-dark tabular-nums">{spk.progress || 0}%</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </Card>

        <Card className="min-w-0 p-5 @3xl:col-span-5">
          <PanelHeader title="Deadline pesanan" subtitle="Paling dekat lebih dulu" action={<SeeAll onClick={() => onNavigate('Orders')} label="Lihat semua pesanan" />} />

          <div className="mt-3">
            {loading && recentOrders.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500" role="status">Memuat pesanan…</p>
            ) : deadlineOrders.length === 0 && (
              <p className="py-6 text-center text-sm text-slate-500">
                {recentOrders.length === 0 ? 'Belum ada pesanan.' : 'Tidak ada pesanan berjalan yang punya deadline.'}
              </p>
            )}

            <ul className="divide-y divide-border">
              {deadlineOrders.slice(0, 6).map(order => {
                const priced = (Number(order.totalPrice) || 0) > 0;
                const isPaid = priced && (order.downPayment || 0) >= (order.totalPrice || 0);
                const dpPct = priced ? Math.round(((order.downPayment || 0) / order.totalPrice) * 100) : 0;
                return (
                  <li key={order.id} className="flex items-start justify-between gap-3 py-3 first:pt-1 last:pb-0">
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-bold text-black">{order.po || order.id}</span>
                        {getDeadlineTag(order.deadline, order.status)}
                      </div>
                      <div className="truncate text-xs text-slate-600">
                        {order.customerName} · {(order.quantity || 0).toLocaleString('id-ID')} pcs {order.productType || 'Garmen'}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-sm font-bold text-black tabular-nums">
                        {priced ? `Rp ${compactRupiah(order.totalPrice)}` : <span className="text-xs font-normal text-slate-500">Harga belum diisi</span>}
                      </div>
                      {priced && (
                        <div className={cn('text-xs font-bold', isPaid ? 'text-status-done' : 'text-status-warning')}>
                          {isPaid ? 'Lunas' : `DP ${dpPct}%`}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </Card>
      </div>

      {/* ACTIVITY + SPENDING */}
      <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-12">
        <Card className="min-w-0 p-5 @3xl:col-span-7">
          <PanelHeader title="Aktivitas terbaru" subtitle="Pesanan, DP, SPK, dan pengeluaran yang baru dicatat" />
          {activity.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">{loading ? 'Memuat aktivitas…' : 'Belum ada aktivitas tercatat.'}</p>
          ) : (
            <ul className="mt-3 divide-y divide-border">
              {activity.map(event => {
                const Icon = event.icon;
                return (
                  <li key={event.id}>
                    <button
                      type="button"
                      onClick={() => onNavigate(event.module)}
                      className="flex w-full items-center gap-3 py-2.5 text-left cursor-pointer hover:bg-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal rounded-lg"
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-white text-brand-teal-dark">
                        <Icon size={15} aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-foreground">{event.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">{event.detail}</span>
                      </span>
                      <time dateTime={event.at} className="shrink-0 text-xs text-muted-foreground">{relativeTime(event.at)}</time>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="min-w-0 p-5 @3xl:col-span-5">
          <PanelHeader title="Pengeluaran bulan ini" subtitle="Dari Catatan Keuangan Harian" action={<SeeAll onClick={() => onNavigate('DailyCash')} label="Buka catatan keuangan harian" />} />
          <div className="mt-3 space-y-4">
            <div>
              <div className="truncate text-2xl font-extrabold tracking-tight text-black tabular-nums" title={formatCurrency(spending.monthTotal)}>
                {formatCurrency(spending.monthTotal)}
              </div>
              <div className="mt-0.5 text-xs text-slate-600">
                Hari ini {formatCurrency(spending.todayTotal)} · kas kantor {formatCurrency(spending.officeTotal)} · talangan {formatCurrency(spending.talanganTotal)}
              </div>
            </div>
            <ul className="space-y-2.5">
              {spending.byType.map(row => {
                const pct = spending.monthTotal > 0 ? Math.round((row.total / spending.monthTotal) * 100) : 0;
                return (
                  <li key={row.label} className="space-y-1">
                    <div className="flex justify-between gap-2 text-sm">
                      <span className="text-slate-700">{row.label}</span>
                      <span className="font-semibold tabular-nums text-slate-900">{formatCurrency(row.total)}</span>
                    </div>
                    <ProgressBar value={pct} label={`Porsi ${row.label}`} barClassName="bg-brand-teal" />
                  </li>
                );
              })}
            </ul>
            <button
              type="button"
              onClick={() => onNavigate('DailyCash')}
              className="flex w-full items-start gap-3 rounded-xl border border-status-warning-border bg-status-warning-bg p-3 text-left transition-colors hover:bg-status-warning-border/40 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal focus-visible:ring-offset-2"
            >
              <HandCoins size={18} className="mt-0.5 shrink-0 text-status-warning" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block text-sm font-bold text-slate-900 tabular-nums">Talangan belum diganti: {formatCurrency(spending.openTotal)}</span>
                <span className="block text-xs text-slate-700">
                  {spending.openPeople === 0
                    ? 'Semua talangan sudah diganti.'
                    : `${spending.openPeople} orang · ${spending.openCount} catatan · tertua ${spending.oldestDays} hari`}
                </span>
              </span>
            </button>
          </div>
        </Card>
      </div>
    </div>
  );
};
