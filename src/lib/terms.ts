// Payment-term rules shared by the quotation form, the invoice and the server.
// Kept free of dependencies so the server can import it too.
import type { PaymentTerm, TermTrigger } from '../types';

/** What each milestone is called on screen and on the printed documents. */
export const TERM_TRIGGER_LABELS: Record<TermTrigger, string> = {
  // Read after "Ditagih saat …", so no "saat" of its own.
  deal: 'Deal',
  sampleSent: 'Sampel dikirim',
  sample: 'Sampel disetujui',
  qc: 'Lolos QC',
  shipped: 'Barang dikirim',
  delivered: 'Barang diterima',
  manual: 'Ditagih manual'
};

export const TERM_TRIGGERS = Object.keys(TERM_TRIGGER_LABELS) as TermTrigger[];

/**
 * The milestone an instalment waits for when none was chosen: the first is
 * the DP and is due at the deal (the SPK gate waits for it), the last is
 * settlement when the goods leave, anything between falls due at QC.
 */
export function defaultTrigger(index: number, count: number): TermTrigger {
  if (index === 0) return 'deal';
  if (index === count - 1) return 'shipped';
  return 'qc';
}

export function termTrigger(term: Partial<PaymentTerm>, index: number, count: number): TermTrigger {
  const chosen = term?.trigger;
  return chosen && TERM_TRIGGERS.includes(chosen) ? chosen : defaultTrigger(index, count);
}

/**
 * The agreed part of a schedule: label, share and milestone. Billing state
 * belongs to one invoice, so a repeat order copying an old order's schedule,
 * or a fresh invoice built from the order, never inherits it.
 */
export function planTerms(terms: PaymentTerm[] | undefined | null): PaymentTerm[] {
  if (!Array.isArray(terms)) return [];
  return terms.map((term, index) => ({
    id: String(term.id || `term-${index + 1}`),
    label: String(term.label || '').trim() || `Termin ${index + 1}`,
    percentage: Number(term.percentage) || 0,
    amount: Number(term.amount) || 0,
    trigger: termTrigger(term, index, terms.length)
  }));
}

/** Why a schedule cannot be saved, or null when it can. */
export function scheduleError(terms: unknown): string | null {
  if (terms === undefined || terms === null) return null;
  if (!Array.isArray(terms)) return 'Format termin pembayaran tidak valid.';
  if (terms.length === 0) return null;
  const ids = new Set<string>();
  for (const [index, term] of terms.entries()) {
    const percentage = Number(term?.percentage);
    if (!Number.isFinite(percentage) || percentage <= 0) {
      return `Persentase termin ${index + 1} harus lebih dari 0%.`;
    }
    if (term?.trigger !== undefined && !TERM_TRIGGERS.includes(term.trigger)) {
      return `Pemicu tagihan termin ${index + 1} tidak dikenal.`;
    }
    const id = String(term?.id || '');
    if (id && ids.has(id)) return 'Dua termin memakai nomor yang sama. Hapus salah satunya lalu tambah lagi.';
    ids.add(id);
  }
  const total = terms.reduce((sum: number, term: any) => sum + (Number(term?.percentage) || 0), 0);
  if (total !== 100) return `Total persentase termin harus 100% (saat ini ${total}%).`;
  return null;
}

/** Name of an instalment on a payment: DP, Pelunasan, or Cicilan between them. */
export function paymentTypeForTerm(index: number, count: number): 'DP' | 'Pelunasan' | 'Cicilan' {
  if (index === 0 && count > 1) return 'DP';
  if (index === count - 1) return 'Pelunasan';
  return 'Cicilan';
}

// ------------------------------------------------------ due dates & money

/** Days a customer has to pay a tagihan once it is billed. */
export const DEFAULT_TERM_DUE_DAYS = 7;

/** YYYY-MM-DD in local time, the format due dates are stored in. */
export function localDate(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate.slice(0, 10)}T00:00:00`);
  date.setDate(date.getDate() + days);
  return localDate(date);
}

/** Whole days a billed, unpaid instalment is past its due date; 0 when it is not late. */
export function termDaysLate(term: Partial<PaymentTerm>, today: string = localDate()): number {
  if (!term?.dueDate || !term.billedAt || term.status === 'Lunas') return 0;
  const due = new Date(`${term.dueDate.slice(0, 10)}T00:00:00`).getTime();
  const now = new Date(`${today}T00:00:00`).getTime();
  return Math.max(0, Math.round((now - due) / 86400000));
}

export const DEDUCTION_TYPES = ['PPh 23', 'Biaya Transfer', 'Pembulatan', 'Lainnya'] as const;

/** Money that actually arrived: verified, and not a deduction or saldo moved between invoices. */
export function isCashIn(payment: { status?: string; adjustmentType?: string }): boolean {
  return payment?.status === 'Verified' && !payment.adjustmentType;
}

/** Sample work under way or done: from here a cancelled order owes the sample fee. */
export const SAMPLE_MADE_STATUSES = ['In Progress', 'Sent to Customer', 'Revision', 'Approved', 'Rejected'];

/** The sample has reached the customer (and maybe come back with notes, or been approved). */
export const SAMPLE_SENT_STATUSES = ['Sent to Customer', 'Revision', 'Approved', 'Rejected'];
