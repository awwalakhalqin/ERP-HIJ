// Pieces the Keuangan panels share: reading instalments, and the WhatsApp reminder text.
import { Invoice, PaymentTerm, Customer, Order } from '../../../types';
import { INVOICE_BANK } from '../../../config/contact';
import { termDaysLate } from '../../../lib/terms';
import { formatCurrency, formatDate } from '../../../lib/utils';

export const labelClass = 'block text-sm font-medium text-slate-700 mb-1.5';
export const selectClass =
  'w-full h-10 px-3 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-600';

export const invoiceTerms = (inv?: Invoice | null): PaymentTerm[] =>
  Array.isArray(inv?.paymentSchedule) ? inv!.paymentSchedule! : [];

export const termBalance = (term: PaymentTerm) =>
  Math.max(0, (Number(term.amount) || 0) - (Number(term.paidAmount) || 0));

/** Billed, unpaid instalments past their due date, across the live invoices. */
export function overdueTagihan(invoices: Invoice[]) {
  return invoices
    .filter(inv => !inv.supersededBy && inv.status !== 'Dibatalkan')
    .flatMap(inv => invoiceTerms(inv).map(term => ({ inv, term, daysLate: termDaysLate(term) })))
    .filter(row => row.daysLate > 0)
    .sort((a, b) => b.daysLate - a.daysLate);
}

/** 08xx / +62 8xx / 62 8xx → 628xx, as wa.me wants it. Empty when there is no usable number. */
export function whatsappNumber(raw?: string): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('62')) return digits;
  if (digits.startsWith('0')) return `62${digits.slice(1)}`;
  if (digits.startsWith('8')) return `62${digits}`;
  return digits;
}

export function reminderMessage(inv: Invoice, term: PaymentTerm, customer?: Customer, order?: Order): string {
  const late = termDaysLate(term);
  const name = customer?.company || customer?.name || inv.customerName;
  return [
    `Yth. ${name},`,
    '',
    `Kami mengingatkan tagihan ${term.billNo || inv.id} (${term.label}) sebesar ${formatCurrency(termBalance(term))}` +
      `${order?.po ? ` untuk pesanan ${order.po}` : ''}` +
      `${term.dueDate ? `, jatuh tempo ${formatDate(term.dueDate)}` : ''}` +
      `${late > 0 ? ` (lewat ${late} hari)` : ''}.`,
    '',
    `Mohon transfer ke ${INVOICE_BANK.bank} ${INVOICE_BANK.accountNumber} a.n. ${INVOICE_BANK.accountName}, lalu kirim bukti transfernya ke nomor ini.`,
    'Abaikan pesan ini bila sudah membayar. Terima kasih.',
    '',
    'PT Hasil Inti Jualan'
  ].join('\n');
}
