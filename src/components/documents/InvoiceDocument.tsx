import React from 'react';
import { Invoice, Order, Customer } from '../../types';
import { terbilangRupiah } from '../../lib/utils';
import { effectiveUnitPrice } from '../../lib/pricing';
import { DocumentPage } from './DocumentPage';

/** Bank account printed on the invoice, as on the official template. */
export const INVOICE_BANK = {
  bank: 'MANDIRI',
  accountNumber: '1150011767581',
  accountName: 'PT HASIL INTI JUALAN'
};

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

/**
 * Invoice Document Component
 * Strictly replicates the structure, layout, typography, borders, and colors
 * of the official template: reference/generate-form/Invoice_ORD-001.pdf
 */
export const InvoiceDocument: React.FC<InvoiceDocumentProps> = ({ id, invoice, order, customer }) => {
  const documentNo = invoice.orderId || order?.po || order?.id || invoice.id;
  const recipient = customer?.company || customer?.name || invoice.customerName || '-';

  // Normalize recipient city / address line
  let place = customer?.address || '-';
  if (place.startsWith('di – ') || place.startsWith('di - ')) {
    place = place.replace(/^di\s*[-–]\s*/, '');
  }

  // Product specifications
  const productName = order?.productType || invoice.notes || 'Jaket Arkato (Vendor Pak Daeng)';
  
  // Format size list
  let sizesText = order?.size || '-';
  if ((!sizesText || sizesText === '-') && order?.sizeChart) {
    try {
      const parsed = JSON.parse(order.sizeChart);
      if (Array.isArray(parsed) && parsed.length > 0) {
        sizesText = parsed.map((item: any) => item.size).filter(Boolean).join(', ');
      }
    } catch {
      // ignore
    }
  }

  const quantity = Number(order?.quantity) || 0;
  /*
   * Below MOQ the agreed rate is the below-MOQ one, so the printed unit price has
   * to follow the same rule that produced the total on the quotation.
   */
  const agreedUnitPrice = order ? effectiveUnitPrice(order) : 0;
  const unitPrice = agreedUnitPrice || (quantity > 0 ? Math.round(Number(invoice.amount) / quantity) : 0);
  const subTotal = Number(invoice.amount) || Number(order?.totalPrice) || quantity * unitPrice;
  const sampleDiscount = Number(order?.discount) || 0;
  const downPayment = Number(invoice.downPaymentReceived) || Number(order?.downPayment) || 0;
  const endPayment = Number(invoice.balanceRemaining) || Math.max(0, subTotal - sampleDiscount - downPayment);
  const moq = Number(order?.moq) || 100;
  const isUnderMoq = quantity > 0 && quantity < moq;

  // Invoice signature date
  const invoiceDate = formatIndonesianDate(invoice.timestamp || order?.timestamp);

  return (
    <DocumentPage id={id} template="/templates/Invoice.png">
      {/* Top Document Number (Right Aligned under banner) */}
      <div className="flex justify-end mb-3.5">
        <p className="text-[13px] font-bold text-black tracking-wide">
          No : {documentNo}
        </p>
      </div>

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
        Berikut adalah invoice produksi {productName.toLowerCase()} dengan total produksi sebanyak {quantity} pcs
        {isUnderMoq ? ' (dibawah MOQ)' : ''}.
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
            <td className="border border-[#c0c0c0] px-1 py-2 text-center align-middle whitespace-pre-line">{sizesText}</td>
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

          {/* Summary Row 3: DISCOUNT SAMPLE (50%) */}
          <tr className="bg-[#e0e0e0]">
            <td colSpan={7} className="px-2.5 py-1.5 text-[11px] font-bold text-left">
              DISCOUNT SAMPLE (50%)
            </td>
            <td className="px-1 py-1.5 text-center text-[11px] font-bold">
              {sampleDiscount > 0 ? 'Rp' : ''}
            </td>
            <td className="px-2 py-1.5 text-right text-[11px] font-bold tabular-nums">
              {sampleDiscount > 0 ? formatNumberId(sampleDiscount) : ''}
            </td>
          </tr>

          {/* Summary Row 4: DOWN PAYMENT 50% */}
          <tr className="bg-white">
            <td colSpan={7} className="px-2.5 py-1.5 text-[11px] font-bold text-left">
              DOWN PAYMENT 50%
            </td>
            <td className="px-1 py-1.5 text-center text-[11px] font-bold">
              {downPayment > 0 ? 'Rp' : ''}
            </td>
            <td className="px-2 py-1.5 text-right text-[11px] font-bold tabular-nums">
              {downPayment > 0 ? formatNumberId(downPayment) : ''}
            </td>
          </tr>

          {/* Summary Row 5: END PAYMENT */}
          <tr className="bg-[#e0e0e0]">
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
        Demikian surat ini kami buat, atas perhatiam dan kerjasamanya kami ucapkan terima kasih.
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
