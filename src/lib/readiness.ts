// Production requirements an order must meet before PPIC may issue its SPK.
// Shared by the server (enforcement) and the UI (checklists), so keep it dependency-free.
//
// Only DP, size chart and design block the SPK. Production may start while
// fabric is still on its way, so material is reported for awareness but never
// holds the work order back.
//
//   DP diterima         SOP-01 & SOP-20  blocking  verified payments >= agreed DP, or owner-approved special terms
//   Template size chart SOP-03           blocking  the order names a template from the Size Chart page; the SPK prints it
//   Desain disetujui    SOP-02           blocking  an approved design or sample, or a repeat order waiver
//   Bahan baku tersedia SOP-03 & SOP-04  info      every PO for the order received, or PPIC confirmed warehouse stock
import type { Order, Payment, Sample, Procurement, Design, SPK } from '../types';
import { statusLabel } from './status';

export type RequirementKey = 'dp' | 'sizeChart' | 'sample' | 'material';

export interface RequirementStatus {
  key: RequirementKey;
  label: string;
  met: boolean;
  detail: string;
  /** False for requirements shown as awareness only; they never block the SPK. */
  blocking: boolean;
}

export interface OrderReadiness {
  orderId: string;
  requirements: RequirementStatus[];
  metCount: number;
  total: number;
  ready: boolean;
  isSpkOptional?: boolean;
  /** Blocking requirements only — what the 'n/m' badge counts. */
  blockingMetCount: number;
  blockingTotal: number;
}

export interface ReadinessData {
  payments: Payment[];
  samples: Sample[];
  procurements: Procurement[];
  designs?: Design[];
}

export const REQUIREMENT_LABELS: Record<RequirementKey, string> = {
  dp: 'DP diterima',
  sizeChart: 'Template size chart',
  sample: 'Desain disetujui',
  material: 'Bahan baku tersedia'
};

/** Requirements that actually hold the SPK back. The rest are shown for awareness. */
export const BLOCKING_REQUIREMENTS: RequirementKey[] = ['dp', 'sizeChart', 'sample'];

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when a procurement's free-text "intendedFor" names this order (by ID or PO number). */
export function procurementIsForOrder(procurement: Procurement, order: Order): boolean {
  const target = String(procurement.intendedFor || '');
  if (!target) return false;
  return [order.id, order.po]
    .filter((ref): ref is string => !!ref)
    .some(ref => new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(ref)}($|[^A-Za-z0-9])`, 'i').test(target));
}

export function verifiedPaidForOrder(orderId: string, payments: Payment[]): number {
  return payments
    .filter(p => p.orderId === orderId && p.status === 'Verified')
    .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
}

function checkDp(order: Order, data: ReadinessData): RequirementStatus {
  const paid = verifiedPaidForOrder(order.id, data.payments);
  const required = Number(order.dpRequired) || 0;
  const base = { key: 'dp' as const, label: REQUIREMENT_LABELS.dp, blocking: true };

  if (order.specialTermsApprovedBy) {
    return { ...base, met: true, detail: `Termin khusus disetujui ${order.specialTermsApprovedBy}` };
  }
  if (required > 0) {
    return paid >= required
      ? { ...base, met: true, detail: `Dibayar ${rupiah(paid)}` }
      : { ...base, met: false, detail: `Dibayar ${rupiah(paid)} dari ${rupiah(required)}` };
  }
  if (paid > 0) return { ...base, met: true, detail: `Dibayar ${rupiah(paid)}` };
  // Orders from before payments were itemised carry their DP on the record itself.
  const legacyDp = Number(order.downPayment) || 0;
  if (legacyDp > 0) return { ...base, met: true, detail: `DP ${rupiah(legacyDp)} tercatat di pesanan (data lama)` };
  return { ...base, met: false, detail: 'Belum ada pembayaran DP' };
}

/*
 * The SPK sheet prints the size chart the garment is cut to, exactly as the
 * Size Chart page holds it — so an order must name a template before the
 * sheet can be issued. Repeat orders and small runs are not exempt.
 */
function checkSizeChart(order: Order): RequirementStatus {
  const base = { key: 'sizeChart' as const, label: REQUIREMENT_LABELS.sizeChart, blocking: true };
  if (order.sizeChartId) {
    return { ...base, met: true, detail: `Template ${order.sizeChartName || order.sizeChartId}` };
  }
  return {
    ...base,
    met: false,
    detail: 'Pilih template di Edit Pesanan (standar HIJ atau khusus pelanggan) — detail ukurannya dicetak di SPK'
  };
}

/**
 * The design attached to an order, approved or not. An order points at a design
 * (`designId`), or a design points back at an order (`orderId`); both are used
 * in practice, so both are accepted here.
 */
export function designForOrder(order: Order, designs: Design[] = []): Design | undefined {
  return (
    designs.find(d => !!order.designId && d.id === order.designId) ||
    designs.find(d => d.orderId === order.id)
  );
}

function checkSample(order: Order, data: ReadinessData): RequirementStatus {
  const base = { key: 'sample' as const, label: REQUIREMENT_LABELS.sample, blocking: true };
  /*
   * Nothing is cut from a description. The SPK sheet carries the artwork the
   * floor works from, so an order with no design attached cannot produce one —
   * whatever the sample arrangement says.
   */
  const design = designForOrder(order, data.designs || []);
  if (!design) {
    return { ...base, met: false, detail: `Desain belum dilampirkan ke pesanan ini` };
  }
  if (design.status !== 'Approved') {
    return {
      ...base,
      met: false,
      detail: `Desain ${design.id} belum disetujui (${statusLabel(design.status)})`
    };
  }

  // Approved artwork is enough to cut; a physical sample only matters when the
  // quotation asked for one.
  if (order.needsSample !== true) {
    return { ...base, met: true, detail: `Desain ${design.id} disetujui` };
  }

  // Jika status sampel pada pesanan sudah Approved
  if (order.sampleStatus === 'Approved') {
    return { ...base, met: true, detail: `Sampel fisik telah disetujui (ACC)` };
  }

  const linked = data.samples.filter(s => s.orderId === order.id);
  const approved = linked.find(s => s.status === 'Approved');

  if (approved) {
    return { ...base, met: true, detail: `Sampel ${approved.id} disetujui` };
  }
  if (order.sampleWaivedBy) {
    const ref = order.sampleWaivedReferenceOrderId ? ` dari ${order.sampleWaivedReferenceOrderId}` : '';
    return { ...base, met: true, detail: `Repeat order${ref}` };
  }
  if (linked.length > 0) {
    const latest = linked[0];
    return { ...base, met: false, detail: `Sampel ${latest.id}: ${statusLabel(latest.status)}` };
  }
  return { ...base, met: false, detail: `Belum ada sampel untuk pesanan ini` };
}

function checkMaterial(order: Order, data: ReadinessData): RequirementStatus {
  const base = { key: 'material' as const, label: REQUIREMENT_LABELS.material, blocking: false };
  /*
   * Pengadaan records purchases that already happened — there is no order-to-
   * receipt lifecycle to wait on, so a record for this order means the material
   * was bought.
   */
  const purchases = data.procurements.filter(p => procurementIsForOrder(p, order));

  if (order.materialConfirmedBy) {
    return { ...base, met: true, detail: `Stok gudang dikonfirmasi ${order.materialConfirmedBy}` };
  }
  if (purchases.length > 0) {
    const spend = purchases.reduce((sum, p) => sum + (Number(p.totalPrice) || 0), 0);
    return {
      ...base,
      met: true,
      detail: `${purchases.length} pembelian bahan tercatat${spend > 0 ? ` (Rp ${spend.toLocaleString('id-ID')})` : ''}`
    };
  }
  return {
    ...base,
    met: false,
    detail: order.needsProcurement === 'Perlu Pengadaan'
      ? 'Belum ada pembelian bahan untuk pesanan ini'
      : 'Stok gudang belum dikonfirmasi PPIC'
  };
}

/**
 * Jalur cepat: Repeat Order atau kuantitas di bawah 50 pcs tidak ditahan DP dan
 * sampel. SPK-nya tetap wajib terbit — pengiriman membutuhkan SPK yang lolos QC.
 */
export function isSpkOptionalForOrder(order: Partial<Order> | undefined): boolean {
  if (!order) return false;
  if (order.isRepeatOrder) return true;
  const qty = Number(order.quantity);
  return !isNaN(qty) && qty > 0 && qty < 50;
}

export function getOrderReadiness(order: Order, data: ReadinessData): OrderReadiness {
  const isOptional = isSpkOptionalForOrder(order);
  const requirements = [
    checkDp(order, data),
    checkSizeChart(order),
    checkSample(order, data),
    checkMaterial(order, data)
  ];
  const metCount = requirements.filter(r => r.met).length;
  const blocking = requirements.filter(r => r.blocking);
  const blockingMetCount = blocking.filter(r => r.met).length;
  /*
   * The fast path skips DP and sample, not the artwork: the server refuses any
   * SPK whose order has no approved design. Reporting such an order as ready
   * showed "Siap Produksi" on a button that then failed.
   */
  const designApproved = designForOrder(order, data.designs || [])?.status === 'Approved';
  const chartPicked = !!order.sizeChartId;
  return {
    orderId: order.id,
    requirements,
    metCount,
    total: requirements.length,
    ready: isOptional ? designApproved && chartPicked : blockingMetCount === blocking.length,
    isSpkOptional: isOptional,
    blockingMetCount,
    blockingTotal: blocking.length
  };
}

/**
 * Orders with no SPK yet, still before production ('Order', or 'Sample' while
 * the sample is being made) and no SPK yet. An issued SPK keeps the order at
 * 'Order' until the floor records work, so the SPK itself is what excludes it.
 *
 * 'Sample' is included because nothing reliably flips it to 'Order' — linking an
 * already-approved sample did not — and the order then vanished from PPIC while
 * its checklist was complete. The checklist still shows what the sample needs.
 */
export function ordersAwaitingSpk(orders: Order[], spks: SPK[]): Order[] {
  const withSpk = new Set(spks.map(s => s.orderId));
  return orders.filter(o => (o.status === 'Order' || o.status === 'Sample') && !withSpk.has(o.id));
}

/** Roles allowed to approve special payment terms (SOP-20 step 8). */
export function canApproveSpecialTerms(role: string | undefined): boolean {
  const r = String(role || '').toLowerCase();
  return r.includes('owner') || r.includes('super admin') || r.includes('pimpinan');
}
