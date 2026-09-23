// Size breakdown and MOQ pricing, shared by the quotation form and the manual
// repeat-order form so both write the same shape and reach the same total.

export interface SizeRow {
  size: string;
  qty: number;
}

/**
 * "S: 20, M: 50" <-> rows. The stored string stays the format the PDFs read.
 * A string with no ':' anywhere ("All Size", "Custom") is a description, not a
 * breakdown: it yields no rows so the quantity field stays editable.
 */
export function parseSizeRows(text?: string): SizeRow[] {
  if (!text || !text.includes(':')) return [];
  return text
    .split(',')
    .map(part => {
      const [size, qty] = part.split(':');
      const label = (size || '').trim();
      if (!label) return null;
      return { size: label, qty: Number(String(qty || '').replace(/[^0-9]/g, '')) || 0 };
    })
    .filter((row): row is SizeRow => row !== null);
}

export function serializeSizeRows(rows: SizeRow[]): string {
  return rows
    .filter(row => row.size.trim())
    .map(row => `${row.size.trim()}: ${row.qty || 0}`)
    .join(', ');
}

export const sizeRowsTotal = (rows: SizeRow[]) =>
  rows.reduce((sum, row) => sum + (Number(row.qty) || 0), 0);

/*
 * Two rates are quoted side by side on the surat penawaran: one at or above
 * MOQ and one below it. Which of them actually prices the job depends on the
 * quantity, and the invoice reads the same rule.
 */
export function effectiveUnitPrice(form: {
  quantity?: number;
  price?: number;
  moq?: number;
  priceBelowMoq?: number;
}): number {
  const qty = Number(form.quantity) || 0;
  const moq = Number(form.moq) || 0;
  const below = Number(form.priceBelowMoq) || 0;
  if (moq > 0 && qty > 0 && qty < moq && below > 0) return below;
  return Number(form.price) || 0;
}

export const isBelowMoq = (form: { quantity?: number; moq?: number }) =>
  Number(form.quantity) > 0 && Number(form.moq) > 0 && Number(form.quantity) < Number(form.moq);
