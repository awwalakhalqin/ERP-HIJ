import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchResource } from '../../services/api';
import { ordersAwaitingSpk } from '../../lib/readiness';
import { isOpenTalangan, payerKey } from '../../lib/dailyCash';
import { todayLocal } from '../../lib/utils';
import type { DailyCashEntry, Order, SOPModule, SPK } from '../../types';

/** Something on the floor that is waiting for a person, and where to fix it. */
export interface AttentionItem {
  key: 'awaitingSpk' | 'overdue' | 'lowStock' | 'talangan';
  label: string;
  /** What "done" looks like, shown when the count is zero. */
  doneLabel: string;
  count: number;
  module: SOPModule;
  tone: 'warning' | 'critical';
}

export interface WorkspaceSignals {
  loaded: boolean;
  orders: Order[];
  spks: SPK[];
  attention: AttentionItem[];
  /** Open items across all attention rows, for the bell. */
  attentionTotal: number;
  /** Sidebar badge per module. */
  badges: Partial<Record<SOPModule, number>>;
  refresh: () => void;
}

const REFRESH_MS = 3 * 60 * 1000;

/*
 * The shell's own light read of the tables behind the attention list: sidebar
 * badges, the bell, the "Perlu Tindakan" panel and the search all come from
 * here. Reads are open to every staff account (see server/src/access.ts), so
 * this never trips a permission error. Each request stands alone — one table
 * failing leaves the others counted.
 */
export function useWorkspaceSignals(enabled: boolean): WorkspaceSignals {
  const [orders, setOrders] = useState<Order[]>([]);
  const [spks, setSpks] = useState<SPK[]>([]);
  const [materials, setMaterials] = useState<any[]>([]);
  const [cash, setCash] = useState<DailyCashEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    Promise.allSettled([
      fetchResource<Order>('orders'),
      fetchResource<SPK>('spk_produksi'),
      fetchResource<any>('raw-materials'),
      fetchResource<DailyCashEntry>('daily-cash')
    ]).then(([o, s, m, c]) => {
      if (cancelled) return;
      if (o.status === 'fulfilled') setOrders(o.value || []);
      if (s.status === 'fulfilled') setSpks(s.value || []);
      if (m.status === 'fulfilled') setMaterials(m.value || []);
      if (c.status === 'fulfilled') setCash(c.value || []);
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [enabled, tick]);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, [enabled, refresh]);

  const attention = useMemo<AttentionItem[]>(() => {
    const today = todayLocal();
    const awaitingSpk = ordersAwaitingSpk(orders, spks).length;
    const overdue = orders.filter(
      o => !!o.deadline && o.status !== 'Completed' && o.status !== 'Cancelled' && String(o.deadline).slice(0, 10) < today
    ).length;
    const lowStock = materials.filter(r =>
      typeof r?.name === 'string' &&
      r?.stock != null && !isNaN(Number(r.stock)) &&
      r?.minStock != null && !isNaN(Number(r.minStock)) &&
      Number(r.stock) <= Number(r.minStock)
    ).length;
    const talangan = new Set(cash.filter(isOpenTalangan).map(e => payerKey(e.payerName))).size;

    return [
      { key: 'awaitingSpk', label: 'pesanan menunggu SPK', doneLabel: 'Semua pesanan siap sudah ber-SPK', count: awaitingSpk, module: 'PPIC', tone: 'warning' },
      { key: 'overdue', label: 'pesanan lewat deadline', doneLabel: 'Tidak ada pesanan terlambat', count: overdue, module: 'Orders', tone: 'critical' },
      { key: 'lowStock', label: 'bahan stok menipis', doneLabel: 'Stok bahan aman', count: lowStock, module: 'RawMaterial', tone: 'critical' },
      { key: 'talangan', label: 'orang menunggu ganti talangan', doneLabel: 'Semua talangan sudah diganti', count: talangan, module: 'DailyCash', tone: 'warning' }
    ];
  }, [orders, spks, materials, cash]);

  const badges = useMemo(() => {
    const out: Partial<Record<SOPModule, number>> = {};
    for (const item of attention) {
      if (item.count > 0) out[item.module] = (out[item.module] || 0) + item.count;
    }
    return out;
  }, [attention]);

  return {
    loaded,
    orders,
    spks,
    attention,
    attentionTotal: attention.reduce((s, a) => s + a.count, 0),
    badges,
    refresh
  };
}
