import React from 'react';
import { Invoice, Order, Customer, PaymentTerm } from '../../types';
import { terbilangRupiah } from '../../lib/utils';
import { effectiveUnitPrice, parseSizeRows } from '../../lib/pricing';
import { INVOICE_BANK } from '../../config/contact';
import { DocumentPage } from './DocumentPage';

interface InvoiceDocumentProps {
  id: string;
  invoice: Invoice;
  order?: Order;
  customer?: Customer;
}

/** Formatter helper using Indonesian dot notation: e.g. 8.510.000 */
const formatNumberId = (val?: number | string | null): string => {
  if (val === undefined || val === null || isNaN(Number(val)) || Number(val) === 0) return '';
  return new Intl.NumberFormat('id-ID').format(Number(val));
};

/** Formats dates as Indonesian full date: e.g. 01 September 2026 */
const formatIndonesianDate = (dateString?: string | null): string => {
  if (!dateString) {
    return new Intl.DateTimeFormat('id-ID', {
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    }).format(new Date());
  }
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return dateString;
    return new Intl.DateTimeFormat('id-ID', {
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    }).format(d);
  } catch {
    return dateString;
  }
};

interface SummaryRow {
  key: string;
  label: string;
  amount: number;
  /** Paid instalments are marked so the customer can see what is still open. */
  paid?: boolean;
}

/*
 * The instalment rows come from the schedule agreed on the quotation. Which of
 * them count as paid is derived from the money actually received: it is
 * matched against the instalments in order, so a DP that has been transferred
 * shows as paid while later terms stay open.
 */
function scheduleRows(schedule: PaymentTerm[], subTotal: number, received: number): SummaryRow[] {
  let remaining = received;
  return schedule.map((term, index) => {
    const percentage = Number(term.percentage) || 0;
    const amount = Number(term.amount) || Math.round(subTotal * percentage / 100);
    const paidAmount = Number(term.paidAmount) || 0;
    const paid = paidAmount > 0 ? paidAmount >= amount : amount > 0 && remaining >= amount;
    if (paidAmount <= 0 && paid) remaining -= amount;
    const label = `${(term.label || `Termin ${index + 1}`).toUpperCase()}${percentage > 0 ? ` ${percentage}%` : ''}`;
    return { key: term.id || `term-${index}`, label, amount, paid };
  });
}

/**
 * Invoice Document Component
 * Strictly replicates the structure, layout, typography, borders, and colors
 * of the official template: reference/generate-form/Invoice_ORD-001.pdf
 */
export const InvoiceDocument: React.FC<InvoiceDocumentProps> = ({ id, invoice, order, customer }) => {
  const documentNo = invoice.invoiceNo || invoice.id;
  const poNumber = order?.po || invoice.orderId || order?.id;
  const recipient = customer?.company || customer?.name || invoice.customerName || '-';

  // Normalize recipient city / address line
  let place = customer?.address || '-';
  if (place.startsWith('di – ') || place.startsWith('di - ')) {
    place = place.replace(/^di\s*[-–]\s*/, '');
  }

  // Product specifications
  const productName = order?.productType || '-';

  /*
   * Sizes are stored as "S: 40, M: 50" on the order. Each size goes on its own
   * line in the SIZE column; a plain description ("All Size") prints as is.
   */
  const sizeRows = parseSizeRows(order?.size);
  const sizesText = sizeRows.length > 0
    ? sizeRows.map(row => `${row.size}: ${row.qty}`).join('\n')
    : order?.size || '-';

  const quantity = Number(order?.quantity) || 0;
  /*
   * Below MOQ the agreed rate is the below-MOQ one, so the printed unit price has
   * to follow the same rule that produced the total on the quotation.
   */
  const agreedUnitPrice = order ? effectiveUnitPrice(order) : 0;
  const unitPrice = agreedUnitPrice || (quantity > 0 ? Math.round(Number(invoice.amount) / quantity) : 0);
  const subTotal = Number(invoice.amount) || Number(order?.totalPrice) || quantity * unitPrice;
  const sampleDiscount = Number(order?.discount) || 0;
  const discountPercent = Number(order?.discountPercent) || 0;
  const received = Number(invoice.downPaymentReceived) || Number(order?.downPayment) || 0;
  const endPayment = Number(invoice.balanceRemaining) || Math.max(0, subTotal - sampleDiscount - received);
  const moq = Number(order?.moq) || 0;
  const isUnderMoq = moq > 0 && quantity > 0 && quantity < moq;

  const schedule = Array.isArray(invoice.paymentSchedule) && invoice.paymentSchedule.length > 0
    ? invoice.paymentSchedule
    : Array.isArray(order?.paymentSchedule) && order.paymentSchedule.length > 0
      ? order.paymentSchedule
      : [];
  const instalmentRows: SummaryRow[] = schedule.length > 0
    ? scheduleRows(schedule, subTotal, received)
    : [{ key: 'received', label: 'UANG MUKA DITERIMA', amount: received, paid: received > 0 }];

  const summaryRows: SummaryRow[] = [
    ...(sampleDiscount > 0
      ? [{ key: 'discount', label: `DISKON${discountPercent > 0 ? ` (${discountPercent}%)` : ''}`, amount: sampleDiscount }]
      : []),
    ...instalmentRows
  ];

  const revisionLabel = invoice.revision ? `Revisi ${invoice.revision}` : '';
  const superseded = !!invoice.supersededBy;

  // Invoice signature date
  const invoiceDate = formatIndonesianDate(invoice.timestamp || order?.timestamp);

  return (
    <DocumentPage id={id} template="/templates/Invoice.png">
      {/* A replaced invoice is still readable, but never mistaken for the live one. */}
      {superseded && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          <span
            className="select-none border-[6px] border-[#ea2027] px-10 py-3 text-[72px] font-black tracking-[0.2em] text-[#ea2027] opacity-25"
            style={{ transform: 'rotate(-28deg)' }}
          >
            DIGANTI
          </span>
        </div>
      )}

      {/* Top Document Number (Right Aligned under banner) */}
      <div className="mb-3.5 flex items-start justify-end">
        <div className="text-right">
          <p className="text-[13px] font-bold tracking-wide text-black">
            No : {documentNo}
            {revisionLabel && <span className="ml-2 rounded-sm bg-[#ea2027] px-1.5 py-px text-[10px] text-white">{revisionLabel}</span>}
          </p>
          {poNumber && poNumber !== documentNo && (
            <p className="text-[11px] text-black">Ref. PO : {poNumber}</p>
          )}
          {invoice.revisionOf && (
            <p className="text-[10px] text-black">Menggantikan {invoice.revisionOf}</p>
          )}
        </div>
      </div>

      {superseded && (
        <p className="mb-3 border border-[#ea2027] bg-[#fdecec] px-2 py-1 text-[11px] font-bold text-[#ea2027]">
          DIGANTI oleh {invoice.supersededBy} — invoice ini tidak berlaku lagi.
        </p>
      )}

      {/* Hal : Invoice */}
      <p className="text-[12px] text-black mb-3">
        Hal : <span className="font-bold">Invoice</span>
      </p>

      {/* Recipient */}
      <div className="text-[12px] text-black leading-[1.5] mb-3.5">
        <p>Kepada Yth,</p>
        <p className="font-bold uppercase tracking-wide">{recipient}</p>
        <p>di – {place}</p>
      </div>

      {/* Introductory Sentence */}
      <p className="text-[12px] text-black leading-[1.6] mb-4">
        Berikut adalah invoice produksi {productName === '-' ? 'pesanan' : productName.toLowerCase()} dengan total produksi sebanyak {quantity} pcs
        {isUnderMoq ? ` (di bawah MOQ ${moq} pcs)` : ''}.
      </p>

      {/* Main Table */}
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-[#55b3b5] text-black text-[10px] font-bold">
            <th className="py-1.5 px-1 text-center w-[34px]">NO</th>
            <th className="py-1.5 px-2 text-center">ITEM</th>
            <th className="py-1.5 px-1 text-center w-[65px]">SIZE</th>
            <th className="py-1.5 px-1 text-center w-[92px]" colSpan={2}>QTY</th>
            <th className="py-1.5 px-1 text-center w-[170px]" colSpan={2}>PRICE/ PCS</th>
            <th className="py-1.5 px-1 text-center w-[184px]" colSpan={2}>SUB TOTAL</th>
          </tr>
        </thead>
        <tbody className="text-[11px] text-black">
          {/* Data Row 1 */}
          <tr>
            <td className="border border-[#c0c0c0] px-1 py-2 text-center align-middle">1</td>
            <td className="border border-[#c0c0c0] px-2.5 py-2 text-left align-middle">{productName}</td>
            <td className="border border-[#c0c0c0] px-1 py-2 text-center align-middle whitespace-pre-line text-[10px] leading-tight">{sizesText}</td>
            <td className="border border-[#c0c0c0] px-1 py-2 text-center align-middle tabular-nums w-[46px]">{quantity}</td>
            <td className="border border-[#c0c0c0] px-1 py-2 text-center align-middle w-[46px]">PCS</td>
            <td className="border border-[#c0c0c0] px-1 py-2 text-center align-middle w-[34px]">Rp</td>
            <td className="border border-[#c0c0c0] px-2 py-2 text-right align-middle tabular-nums w-[136px]">
              {formatNumberId(unitPrice)}
            </td>
            <td className="border border-[#c0c0c0] px-1 py-2 text-center align-middle w-[34px]">Rp</td>
            <td className="border border-[#c0c0c0] px-2 py-2 text-right align-middle tabular-nums w-[150px]">
              {formatNumberId(subTotal)}
            </td>
          </tr>

          {/* Summary Row 1: TOTAL QUANTITY PRODUKSI */}
          <tr className="bg-[#e0e0e0]">
            <td colSpan={3} className="px-2.5 py-1.5 text-[11px] font-bold text-left">
              TOTAL QUANTITY PRODUKSI
            </td>
            <td className="px-1 py-1.5 text-center text-[11px] font-bold tabular-nums">
              {quantity}
            </td>
            <td className="px-1 py-1.5 text-center text-[11px] font-bold">
              PCS
            </td>
            <td colSpan={4} className="px-2 py-1.5" />
          </tr>

          {/* Summary Row 2: SUB TOTAL */}
          <tr className="bg-white">
            <td colSpan={7} className="px-2.5 py-1.5 text-[11px] font-bold text-left">
              SUB TOTAL
            </td>
            <td className="px-1 py-1.5 text-center text-[11px] font-bold">
              Rp
            </td>
            <td className="px-2 py-1.5 text-right text-[11px] font-bold tabular-nums">
              {formatNumberId(subTotal)}
            </td>
          </tr>

          {/* Discount (only when agreed) and the instalments from the payment schedule */}
          {summaryRows.map((row, index) => (
            <tr key={row.key} className={index % 2 === 0 ? 'bg-[#e0e0e0]' : 'bg-white'}>
              <td colSpan={7} className="px-2.5 py-1.5 text-[11px] font-bold text-left">
                {row.label}
                {row.paid && (
                  <span className="ml-2 rounded-sm border border-[#1b7f3b] px-1 py-px text-[9px] font-bold text-[#1b7f3b]">
                    LUNAS
                  </span>
                )}
              </td>
              <td className="px-1 py-1.5 text-center text-[11px] font-bold">
                {row.amount > 0 ? 'Rp' : ''}
              </td>
              <td className="px-2 py-1.5 text-right text-[11px] font-bold tabular-nums">
                {row.amount > 0 ? formatNumberId(row.amount) : ''}
              </td>
            </tr>
          ))}

          {/* Final Row: END PAYMENT */}
          <tr className={summaryRows.length % 2 === 0 ? 'bg-[#e0e0e0]' : 'bg-white'}>
            <td colSpan={7} className="px-2.5 py-1.5 text-[11px] font-bold text-[#ea2027] text-left">
              END PAYMENT
            </td>
            <td className="px-1 py-1.5 text-center text-[11px] font-bold text-[#ea2027]">
              Rp
            </td>
            <td className="px-2 py-1.5 text-right text-[11px] font-bold text-[#ea2027] tabular-nums">
              {formatNumberId(endPayment)}
            </td>
          </tr>
        </tbody>
      </table>

      {/* Terbilang Section */}
      <p className="mt-2 text-[11px] text-black">
        <span className="font-bold">Terbilang </span>
        <span className="font-bold text-[#ea2027]">(END PAYMENT)</span>
        <span className="font-bold"> : </span>
        <span className="font-bold italic text-[#ea2027]">{terbilangRupiah(endPayment)}</span>
      </p>

      {/* Bank Transfer Details */}
      <div className="mt-4 text-[11px] leading-[1.8] text-black">
        <p className="font-bold mb-0.5">Transfer ke:</p>
        <div className="flex">
          <span className="font-bold w-[96px]">Bank</span>
          <span className="font-bold">: {INVOICE_BANK.bank}</span>
        </div>
        <div className="flex">
          <span className="font-bold w-[96px]">No Rekening</span>
          <span className="font-bold">: {INVOICE_BANK.accountNumber}</span>
        </div>
        <div className="flex">
          <span className="font-bold w-[96px]">Atas Nama</span>
          <span className="font-bold">: {INVOICE_BANK.accountName}</span>
        </div>
      </div>

      {/* Closing Statement */}
      <p className="mt-4 text-[12px] leading-[1.6] text-black">
        Demikian surat ini kami buat, atas perhatian dan kerjasamanya kami ucapkan terima kasih.
      </p>

      {/* Signature Section */}
      <div className="mt-[48px] flex justify-end">
        <div className="w-[260px] text-center text-[12px] text-black">
          <p className="mb-1">Depok, {invoiceDate}</p>
          <div className="relative flex h-[140px] items-center justify-center">
            <img
              src="/templates/HIJ Logo Stamp Basah.png"
              alt=""
              aria-hidden="true"
              className="absolute h-[134px] w-auto object-contain opacity-90"
            />
            <img
              src="/templates/ttd basah.png"
              alt=""
              aria-hidden="true"
              className="relative h-[112px] w-auto object-contain"
            />
          </div>
          <p className="font-bold tracking-wider mt-1">PT HASIL INTI JUALAN</p>
        </div>
      </div>
    </DocumentPage>
  );
};
