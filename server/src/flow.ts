/*
 * The order's life from deal to "Selesai", in one place.
 *
 * Both ways an order is born — a quotation that closes (Pola 1) and a repeat
 * order typed straight into Pesanan Masuk (Pola 2) — end up in the same
 * tables, and every stage after that reads them the same way. What used to be
 * scattered across route handlers lives here so the two paths cannot drift:
 *
 *   - ids that never collide, whatever was deleted before
 *   - which invoice of a revision family is the one to pay
 *   - how much of it is paid (verified money only, whichever invoice id the
 *     payment happened to be recorded against)
 *   - the order status, derived from what actually happened downstream
 */
import { readTable, findById, updateItem } from './db.js';
import { spkQcAccepted } from './spk.js';

// ------------------------------------------------------------------ ids

/**
 * Next free `PREFIX-NNN`. Counting rows re-issued a deleted order's id to the
 * next one, which then inherited its payments and its SPK.
 */
export function nextId(table: string, prefix: string, pad = 3): string {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`, 'i');
  const highest = readTable(table).reduce((max: number, row: any) => {
    const match = pattern.exec(String(row?.id || ''));
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  let num = highest + 1;
  let id = `${prefix}-${String(num).padStart(pad, '0')}`;
  while (findById(table, id)) {
    num += 1;
    id = `${prefix}-${String(num).padStart(pad, '0')}`;
  }
  return id;
}

// ------------------------------------------------------------- invoices

/** Follows `supersededBy` to the revision that is still in force. */
export function activeInvoiceFor(invoiceId: string | undefined): any | null {
  let invoice = invoiceId ? findById('invoices', invoiceId) : null;
  const seen = new Set<string>();
  while (invoice?.supersededBy && !seen.has(invoice.id)) {
    seen.add(invoice.id);
    const next = findById('invoices', invoice.supersededBy);
    if (!next) break;
    invoice = next;
  }
  return invoice;
}

/** The invoice an order is billed on now: never a superseded revision. */
export function activeInvoiceForOrder(orderId: string | undefined): any | null {
  if (!orderId) return null;
  return readTable('invoices').find((i: any) => i.orderId === orderId && !i.supersededBy) || null;
}

/**
 * Verified money that belongs to this invoice. A DP recorded against the order
 * before any invoice existed, or against revision R0 before R1 replaced it, is
 * still the customer's money — counting only payments stamped with this exact
 * invoice id billed the DP a second time at pelunasan.
 */
export function verifiedPaidForInvoice(invoice: any): number {
  if (!invoice) return 0;
  const base = invoice.revisionOf || invoice.id;
  const family = new Set(
    readTable('invoices')
      .filter((i: any) => i.id === base || i.revisionOf === base)
      .map((i: any) => i.id)
  );
  family.add(invoice.id);
  return readTable('payments')
    .filter(
      (p: any) =>
        p.status === 'Verified' &&
        ((invoice.orderId && p.orderId === invoice.orderId) || family.has(p.invoiceId))
    )
    .reduce((sum: number, p: any) => sum + (Number(p.amount) || 0), 0);
}

export function invoiceStatusFor(total: number, paid: number): 'Belum Bayar' | 'DP Dibayar' | 'Lunas' {
  if (total > 0 && paid >= total) return 'Lunas';
  return paid > 0 ? 'DP Dibayar' : 'Belum Bayar';
}

// ------------------------------------------------------ payment terms

/** Same arithmetic as the client's PaymentTermsEditor: parts always sum to the total. */
export function withAmounts(terms: any[], total: number): any[] {
  const safeTotal = Number(total) || 0;
  const amounts = terms.map(term => Math.round((safeTotal * (Number(term.percentage) || 0)) / 100));
  const sum = amounts.reduce((acc, value) => acc + value, 0);
  const percent = terms.reduce((acc, term) => acc + (Number(term.percentage) || 0), 0);
  if (amounts.length > 0 && percent === 100 && sum !== safeTotal) {
    amounts[amounts.length - 1] += safeTotal - sum;
  }
  return terms.map((term, index) => ({ ...term, amount: amounts[index] }));
}

// -------------------------------------------------------- order status

const STATUS_RANK: Record<string, number> = {
  Quotation: 0,
  Sample: 1,
  Order: 2,
  'In Production': 3,
  QC: 4,
  Shipping: 5,
  Completed: 6
};

const SHIPPED = ['Picked Up', 'In Transit', 'Delivered'];

/** How far the order has actually got, read from the records each stage leaves behind. */
function derivedOrderStatus(order: any): string | null {
  const spks = readTable('spk_produksi').filter((s: any) => s.orderId === order.id);
  const shipments = readTable('shipments').filter((s: any) => s.orderId === order.id);

  const delivered = shipments.some((s: any) => s.status === 'Delivered');
  if (delivered) {
    const invoice = activeInvoiceForOrder(order.id);
    const total = Number(invoice?.total ?? order.totalPrice) || 0;
    const paid = invoice ? verifiedPaidForInvoice(invoice) : 0;
    // Delivered is not finished while the customer still owes money. Invoices
    // settled before payments were itemised carry only their Lunas status; an
    // order with no price on record (imports) owes nothing.
    if (total <= 0 || paid >= total || invoice?.status === 'Lunas') return 'Completed';
    return 'Shipping';
  }
  if (shipments.some((s: any) => SHIPPED.includes(s.status))) return 'Shipping';

  // The latest report per SPK decides, the same reading the shipment gate uses.
  if (spks.some((s: any) => s.status === 'Completed' || spkQcAccepted(s.id))) return 'QC';

  // An SPK in the queue is a plan, not production: the order reads
  // "Diproduksi" only once the floor has recorded work on it.
  if (spks.some((s: any) => s.status === 'In Progress' || s.status === 'Finishing')) return 'In Production';

  // An order waiting on its sample moves on once the sample is approved or waived.
  if (order.status === 'Sample' && sampleSettled(order)) return 'Order';
  return null;
}

/** The sample gate is passed: an approved sample record, or a waiver / approval noted on the order. */
export function sampleSettled(order: any): boolean {
  if (order.sampleWaivedBy || order.sampleStatus === 'Approved' || order.needsSample === false) return true;
  return readTable('samples').some((s: any) => s.orderId === order.id && s.status === 'Approved');
}

/**
 * Moves the order forward to wherever its records say it is. Forward only: a
 * status set by hand, or a later stage already reached, is never undone here,
 * and a cancelled order stays cancelled. Nothing advanced orders past
 * "In Production" before, so "Selesai" was never reached by any order.
 */
export function syncOrderStatus(orderId: string | undefined): any | null {
  if (!orderId) return null;
  const order = findById('orders', orderId);
  if (!order || order.status === 'Cancelled') return null;
  const next = derivedOrderStatus(order);
  /*
   * The one step back. "In Production" used to be set the moment an SPK was
   * issued, so an order read Diproduksi beside an SPK still "Antre". An order
   * whose SPKs are all still queued returns to "Order"; nothing else is undone.
   */
  if (!next && order.status === 'In Production') {
    const spks = readTable('spk_produksi').filter((s: any) => s.orderId === order.id);
    if (spks.every((s: any) => s.status === 'Queued')) {
      return updateItem('orders', order.id, { status: 'Order' });
    }
    return null;
  }
  if (!next) return null;
  const currentRank = STATUS_RANK[order.status] ?? -1;
  const nextRank = STATUS_RANK[next] ?? -1;
  if (nextRank === currentRank) return null;
  /*
   * Backwards only inside production, and only for an order whose records are
   * complete enough to trust (it has an SPK): a deleted QC report or surat
   * jalan takes the order back to where its remaining records put it. Orders
   * from before records were kept, and finished orders, are never moved back.
   */
  if (nextRank < currentRank) {
    const hasSpk = readTable('spk_produksi').some((s: any) => s.orderId === order.id);
    if (!hasSpk || !['In Production', 'QC', 'Shipping'].includes(order.status)) return null;
  }
  return updateItem('orders', order.id, { status: next });
}

/** Brings every order in line once, e.g. at boot after this logic first ships. */
export function syncAllOrderStatuses(): number {
  let moved = 0;
  for (const order of readTable('orders')) {
    if (syncOrderStatus(order.id)) moved += 1;
  }
  return moved;
}
