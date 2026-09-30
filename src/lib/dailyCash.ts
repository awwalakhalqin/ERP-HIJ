import type { DailyCashEntry } from '../types';

/*
 * Rules shared by the Catatan Keuangan Harian page and the server, so both
 * agree on what counts as an open talangan and how a payer's name is matched.
 */

export const DAILY_CASH_TYPES = ['Pengiriman', 'Stok Gudang', 'Lainnya'] as const;

/** Money someone fronted that the office still owes them. */
export const isOpenTalangan = (entry: Pick<DailyCashEntry, 'paidWith' | 'status'>) =>
  entry.paidWith === 'Ditalangi' && entry.status === 'Belum Diganti';

/** Spent money: everything recorded except what was cancelled. */
export const isCounted = (entry: Pick<DailyCashEntry, 'status'>) => entry.status !== 'Dibatalkan';

/** "  asep   kurir " and "Asep Kurir" are one person. */
export const payerKey = (name?: string) => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();

/*
 * The spelling stored for a payer: the one already on record when the name
 * matches someone, so the suggestions never split one person into two.
 */
export function canonicalPayerName(name: string, known: string[]): string {
  const tidy = String(name || '').trim().replace(/\s+/g, ' ');
  const key = payerKey(tidy);
  return known.find(existing => payerKey(existing) === key) || tidy;
}

/** Whole days since the record was made, never negative. */
export function ageInDays(timestamp?: string, now: Date = new Date()): number {
  if (!timestamp) return 0;
  const made = new Date(timestamp);
  if (Number.isNaN(made.getTime())) return 0;
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.max(0, Math.round((startOf(now) - startOf(made)) / 86_400_000));
}

/** Distinct values of a field, keeping the first spelling seen. */
export function distinctNames(values: Array<string | undefined>): string[] {
  const seen = new Map<string, string>();
  for (const value of values) {
    const tidy = String(value || '').trim().replace(/\s+/g, ' ');
    if (tidy && !seen.has(payerKey(tidy))) seen.set(payerKey(tidy), tidy);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'id'));
}
