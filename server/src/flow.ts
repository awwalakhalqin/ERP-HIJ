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
 *   - each instalment of the schedule: when it falls due, when it was billed,
 *     how much of it is paid
 */
import { readTable, findById, updateItem, insertItem, deleteItem } from './db.js';
import { spkQcAccepted } from './spk.js';
import { planTerms, termTrigger, termDaysLate, localDate, SAMPLE_SENT_STATUSES } from '../../src/lib/terms.js';
import { verifiedPaidForOrder } from '../../src/lib/readiness.js';

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

/** Next free revision number for a document family, and the id that carries it. */
export function nextRevision(table: string, baseId: string) {
  const family = readTable(table).filter(
    (r: any) => r.id === baseId || r.revisionOf === baseId
  );
  const highest = family.reduce((max: number, r: any) => Math.max(max, Number(r.revision) || 0), 0);
  const revision = highest + 1;
  return { revision, id: `${baseId}-R${revision}` };
}

// ------------------------------------------------------ billing terms

/** Whether the milestone an instalment waits for has happened, read from the records. */
function triggerReached(trigger: string, order: any): boolean {
  if (!order) return trigger === 'deal';
  if (order.status === 'Cancelled') return false;
  switch (trigger) {
    case 'deal':
      return true;
    case 'sampleSent':
      // An order with no physical sample has nothing to wait for.
      if (order.needsSample !== true || order.sampleStatus === 'Approved') return true;
      return readTable('samples').some((s: any) => s.orderId === order.id && SAMPLE_SENT_STATUSES.includes(s.status));
    case 'sample':
      return sampleSettled(order);
    case 'qc':
      // The surat jalan gate already demands a QC Accept, so a shipped order has passed it.
      return readTable('spk_produksi').some(
        (s: any) => s.orderId === order.id && (s.status === 'Completed' || spkQcAccepted(s.id))
      );
    case 'shipped':
      return readTable('shipments').some((s: any) => s.orderId === order.id && SHIPPED.includes(s.status));
    case 'delivered':
      return readTable('shipments').some((s: any) => s.orderId === order.id && s.status === 'Delivered');
    default:
      // 'manual' waits for finance to bill it.
      return false;
  }
}

/*
 * Brings an invoice's instalments in line with the records: which milestones
 * have been reached, how the verified money divides over them (oldest
 * instalment first), and what is owed right now. A billed instalment stays
 * billed; everything else is derived, so the same records always give the
 * same schedule whichever route last touched them.
 */
export function syncInvoiceTerms(invoiceId: string | undefined): any | null {
  const invoice = invoiceId ? findById('invoices', invoiceId) : null;
  if (!invoice || invoice.supersededBy) return invoice;
  const order = invoice.orderId ? findById('orders', invoice.orderId) : null;
  let terms: any[] = Array.isArray(invoice.paymentSchedule) ? invoice.paymentSchedule : [];
  /*
   * Invoices drafted at shipment, before invoices were born with the order,
   * carry no schedule of their own while the order agreed one (the printout
   * already fell back to it). They adopt it, so they are billed the same way.
   */
  if (terms.length === 0 && Array.isArray(order?.paymentSchedule) && order.paymentSchedule.length > 0) {
    terms = withAmounts(planTerms(order.paymentSchedule), Number(invoice.total) || 0);
  }
  if (terms.length === 0) return invoice;

  const now = new Date().toISOString();
  let unallocated = verifiedPaidForInvoice(invoice);
  let dueNow = 0;
  /*
   * A cancelled order owes nothing more and what it paid is a saldo pelanggan,
   * unless its sample had been made: then the invoice bills the sample fee.
   */
  const cancelled = order?.status === 'Cancelled';
  const feeOnCancel = cancelled && Number(invoice.cancellationFee) > 0;

  const next = terms.map((term, index) => {
    const amount = Number(term.amount) || 0;
    const trigger = termTrigger(term, index, terms.length);
    const paidAmount = Math.max(0, Math.min(amount, unallocated));
    unallocated -= paidAmount;
    const readyAt = feeOnCancel || triggerReached(trigger, order) ? term.readyAt || now : undefined;
    const settled = paidAmount >= amount;
    const status = settled
      ? 'Lunas'
      : paidAmount > 0
        ? 'Sebagian'
        : term.billedAt
          ? 'Ditagih'
          : readyAt
            ? 'Siap Ditagih'
            : 'Menunggu';
    if ((!cancelled || feeOnCancel) && !settled && (readyAt || term.billedAt)) dueNow += amount - paidAmount;
    return {
      ...term,
      trigger,
      status,
      readyAt,
      paidAmount,
      paidAt: settled ? term.paidAt || now : undefined
    };
  });

  // JSON drops the cleared (undefined) stamps, so compare what would be stored.
  if (JSON.stringify(next) === JSON.stringify(terms) && invoice.dueNow === dueNow) return invoice;
  return updateItem('invoices', invoice.id, { paymentSchedule: next, dueNow });
}

export function syncTermsForOrder(orderId: string | undefined): any | null {
  const invoice = activeInvoiceForOrder(orderId);
  return invoice ? syncInvoiceTerms(invoice.id) : null;
}

/** The instalment the next payment lands in: the oldest one not yet settled. */
export function openTermFor(invoice: any): { term: any; index: number; count: number } | null {
  const terms: any[] = Array.isArray(invoice?.paymentSchedule) ? invoice.paymentSchedule : [];
  const index = terms.findIndex(term => term.status !== 'Lunas');
  return index === -1 ? null : { term: terms[index], index, count: terms.length };
}

/** Recomputes what an invoice has received from its verified payments, then everything that follows from it. */
export function reconcileInvoice(invoiceId: string) {
  if (!invoiceId) return null;
  const invoice = activeInvoiceFor(invoiceId);
  if (!invoice) return null;

  // Verified money only, and all of it: see verifiedPaidForInvoice.
  const totalPaid = verifiedPaidForInvoice(invoice);
  const invoiceTotal = Number(invoice.total) || Number(invoice.amount) || 0;
  const cancelled = !!invoice.orderId && findById('orders', invoice.orderId)?.status === 'Cancelled';
  // A cancelled order still owes its sample fee when one was set at cancellation.
  const owedTotal = cancelled ? Number(invoice.cancellationFee) || 0 : invoiceTotal;

  updateItem('invoices', invoice.id, {
    downPaymentReceived: totalPaid,
    balanceRemaining: Math.max(0, owedTotal - totalPaid),
    status: cancelled && owedTotal <= 0 ? 'Dibatalkan' : invoiceStatusFor(owedTotal, totalPaid)
  });

  if (invoice.orderId) {
    const order = findById('orders', invoice.orderId);
    if (order) {
      const paid = verifiedPaidForOrder(order.id, readTable('payments'));
      updateItem('orders', order.id, {
        downPayment: paid,
        dpPercent: order.totalPrice > 0 ? Math.min(100, Math.round((paid / order.totalPrice) * 100)) : 0
      });
    }
    syncOrderStatus(invoice.orderId);
  }
  // An invoice without an order has no milestones, but its instalments still divide the money.
  const synced = syncInvoiceTerms(invoice.id);
  syncCreditFor(synced);
  return synced;
}

// ------------------------------------------------------ saldo pelanggan

const creditUsed = (credit: any) =>
  (Array.isArray(credit?.history) ? credit.history : []).reduce((sum: number, h: any) => sum + (Number(h.amount) || 0), 0);

/** What HIJ holds for the customer on this invoice: everything paid if the order was cancelled, else the excess. */
export function creditOwedFor(invoice: any, paid = verifiedPaidForInvoice(invoice)): { owed: number; source: 'Lebih Bayar' | 'Pesanan Batal' } {
  const order = invoice?.orderId ? findById('orders', invoice.orderId) : null;
  if (order?.status === 'Cancelled') {
    return { owed: Math.max(0, paid - (Number(invoice?.cancellationFee) || 0)), source: 'Pesanan Batal' };
  }
  return { owed: Math.max(0, paid - (Number(invoice?.total) || 0)), source: 'Lebih Bayar' };
}

export function creditForInvoice(invoice: any): any | null {
  const base = invoice?.revisionOf || invoice?.id;
  return base ? readTable('customer_credits').find((c: any) => c.invoiceId === base) || null : null;
}

/*
 * One saldo per invoice family, kept equal to what the payments say: an
 * overpayment, or everything a cancelled order paid. What has already been
 * refunded, forfeited or moved stays settled, so the saldo never shrinks
 * below it (the payment routes refuse a void that would need that).
 */
export function syncCreditFor(invoice: any): any | null {
  if (!invoice || invoice.supersededBy) return null;
  const { owed, source } = creditOwedFor(invoice);
  const existing = creditForInvoice(invoice);
  if (!existing) {
    if (owed <= 0) return null;
    return insertItem('customer_credits', {
      id: nextId('customer_credits', 'SAL'),
      customerId: invoice.customerId || '',
      customerName: invoice.customerName || 'Klien',
      source,
      orderId: invoice.orderId || '',
      invoiceId: invoice.revisionOf || invoice.id,
      amount: owed,
      remaining: owed,
      status: 'Terbuka',
      history: [],
      timestamp: new Date().toISOString()
    });
  }
  const used = creditUsed(existing);
  if (used === 0 && owed <= 0) {
    // A void took the excess away before anything was done with it.
    deleteItem('customer_credits', existing.id);
    return null;
  }
  const amount = Math.max(owed, used);
  const remaining = amount - used;
  const status = remaining > 0 ? 'Terbuka' : 'Selesai';
  if (existing.amount === amount && existing.remaining === remaining && existing.status === status && existing.source === source) {
    return existing;
  }
  return updateItem('customer_credits', existing.id, { amount, remaining, status, source });
}

export { creditUsed };

// ------------------------------------------------------ overdue tagihan

/** Billed instalments of this customer that are past their due date and unpaid. */
export function overdueTermsForCustomer(customerId: string | undefined, excludeOrderId?: string) {
  if (!customerId) return [];
  const today = localDate();
  return readTable('invoices')
    .filter((inv: any) =>
      !inv.supersededBy &&
      inv.status !== 'Dibatalkan' &&
      !(findById('orders', inv.orderId)?.status === 'Cancelled' && !(Number(inv.cancellationFee) > 0)) &&
      String(inv.customerId) === String(customerId) &&
      (!excludeOrderId || inv.orderId !== excludeOrderId)
    )
    .flatMap((inv: any) =>
      (Array.isArray(inv.paymentSchedule) ? inv.paymentSchedule : []).map((term: any) => ({
        invoice: inv,
        term,
        daysLate: termDaysLate(term, today)
      }))
    )
    .filter((row: any) => row.daysLate > 0);
}

/*
 * The invoice is born with the order, so the DP is billed on paper before
 * anything is cut. Its schedule is the order's agreed plan; the instalments
 * then fall due one by one as the order reaches each milestone.
 */
export function createInvoiceForOrder(
  order: any,
  options: { reviewStatus?: 'Draft' | 'Sent'; shipmentId?: string; notes?: string; user?: string } = {}
): any | null {
  if (!order || activeInvoiceForOrder(order.id)) return null;
  const total = Number(order.totalPrice) || 0;
  // An order with no price on record (imports) has nothing to bill.
  if (total <= 0) return null;

  const created = insertItem('invoices', {
    id: nextId('invoices', 'INV'),
    orderId: order.id,
    customerId: order.customerId || '',
    customerName: order.customerName || 'Klien',
    amount: total,
    tax: 0,
    total,
    downPaymentReceived: 0,
    balanceRemaining: total,
    status: 'Belum Bayar',
    reviewStatus: options.reviewStatus || 'Draft',
    ...(options.shipmentId ? { shipmentId: options.shipmentId } : {}),
    paymentSchedule: withAmounts(planTerms(order.paymentSchedule), total),
    notes: options.notes || `Faktur pesanan ${order.po || order.id}.`,
    user: options.user || 'Sistem',
    timestamp: new Date().toISOString()
  });
  // Money recorded against the order before the invoice existed counts toward it.
  return reconcileInvoice(created.id) || created;
}

/*
 * A changed deal is never overwritten on the invoice: a new revision replaces
 * it. Billing stamps follow the instalment they were made for, and payments
 * already received carry over (verifiedPaidForInvoice reads the whole family).
 */
export function reviseInvoice(
  active: any,
  changes: { total: number; schedule?: any[]; revisedBy: string; quotationId?: string; notes?: string }
): any {
  const base = active.revisionOf || active.id;
  const { revision, id } = nextRevision('invoices', base);
  const total = Number(changes.total) || 0;
  const oldTerms: any[] = Array.isArray(active.paymentSchedule) ? active.paymentSchedule : [];
  const schedule = withAmounts(planTerms(changes.schedule ?? oldTerms), total).map(term => {
    const old = oldTerms.find(t => t.id === term.id);
    return old
      ? { ...term, billNo: old.billNo, billedAt: old.billedAt, billedBy: old.billedBy, billedEarlyReason: old.billedEarlyReason, readyAt: old.readyAt }
      : term;
  });
  const paid = verifiedPaidForInvoice(active);
  const now = new Date().toISOString();

  insertItem('invoices', {
    ...active,
    id,
    invoiceNo: active.invoiceNo || base,
    revision,
    revisionOf: base,
    revisedBy: changes.revisedBy,
    supersededBy: undefined,
    supersededAt: undefined,
    ...(changes.quotationId ? { quotationId: changes.quotationId } : {}),
    ...(changes.notes ? { notes: changes.notes } : {}),
    amount: total,
    total,
    downPaymentReceived: paid,
    balanceRemaining: Math.max(0, total - paid),
    status: invoiceStatusFor(total, paid),
    paymentSchedule: schedule,
    timestamp: now
  });
  updateItem('invoices', active.id, { supersededBy: id, supersededAt: now });
  return syncInvoiceTerms(id);
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
 *
 * The same records decide which instalments have fallen due, so the invoice's
 * schedule is brought along every time.
 */
export function syncOrderStatus(orderId: string | undefined): any | null {
  const moved = advanceOrderStatus(orderId);
  syncTermsForOrder(orderId);
  return moved;
}

function advanceOrderStatus(orderId: string | undefined): any | null {
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
