import React from 'react';
import { Payment, Invoice, Order, Customer } from '../../types';
import { terbilangRupiah } from '../../lib/utils';
import { DocumentPage } from './DocumentPage';

interface ReceiptDocumentProps {
  id: string;
  payment: Payment;
  invoice?: Invoice;
  order?: Order;
  customer?: Customer;
}

const formatNumberId = (val?: number | string | null): string =>
  new Intl.NumberFormat('id-ID').format(Number(val) || 0);

const formatIndonesianDate = (dateString?: string | null): string => {
  const d = dateString ? new Date(dateString) : new Date();
  if (isNaN(d.getTime())) return String(dateString || '');
  return new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'long', year: 'numeric' }).format(d);
};

/** KW-024 for PAY-024: the receipt carries the payment's own number. */
export const receiptNumber = (payment: Payment) => `KW-${String(payment.id).replace(/^PAY-/i, '')}`;

/*
 * Kwitansi: proof that HIJ received a payment. Printed on the invoice
 * letterhead with its banner word covered, since there is no kwitansi
 * template; one per verified payment that brought money in.
 */
export const ReceiptDocument: React.FC<ReceiptDocumentProps> = ({ id, payment, invoice, order, customer }) => {
  const payer = customer?.company || customer?.name || payment.customerName || '-';
  const term = payment.termId ? (invoice?.paymentSchedule || []).find(t => t.id === payment.termId) : undefined;
  const what = payment.termLabel || payment.type;
  const product = order?.productType ? ` ${order.productType}${order.quantity ? ` ${order.quantity} pcs` : ''}` : '';
  const references = [
    term?.billNo ? `Tagihan ${term.billNo}` : invoice ? `Faktur ${invoice.invoiceNo || invoice.revisionOf || invoice.id}` : '',
    order?.po ? `PO ${order.po}` : ''
  ].filter(Boolean).join(' · ');

  const rows: { label: string; value: React.ReactNode }[] = [
    { label: 'Telah terima dari', value: <span className="font-bold uppercase tracking-wide">{payer}</span> },
    {
      label: 'Uang sejumlah',
      value: <span className="font-bold italic text-[#ea2027]">{terbilangRupiah(Number(payment.amount) || 0)}</span>
    },
    {
      label: 'Untuk pembayaran',
      value: (
        <>
          {what} pesanan{product}
          {references && <span className="block text-[11px]">{references}</span>}
        </>
      )
    },
    { label: 'Cara bayar', value: payment.paymentMethod || payment.bankAccount || '-' },
    { label: 'Tanggal diterima', value: formatIndonesianDate(payment.date) }
  ];

  return (
    <DocumentPage id={id} template="/templates/Invoice.png">
      {/* The letterhead's banner reads INVOICE; this document is a kwitansi. */}
      <div
        aria-hidden="true"
        className="absolute flex items-center justify-end"
        style={{ top: 22, right: 18, width: 220, height: 50, backgroundColor: '#66c4bf' }}
      >
        <span
          className="pr-3 text-[34px] font-black tracking-wide text-[#ea2027]"
          style={{ textShadow: '2px 2px 0 #fff, -1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff' }}
        >
          KWITANSI
        </span>
      </div>

      <div className="mb-6 flex justify-end">
        <p className="text-[13px] font-bold tracking-wide text-black">No : {receiptNumber(payment)}</p>
      </div>

      <table className="w-full border-collapse text-[12px] text-black">
        <tbody>
          {rows.map(row => (
            <tr key={row.label} className="align-top">
              <td className="w-[150px] py-2.5 pr-2 font-bold">{row.label}</td>
              <td className="w-[14px] py-2.5">:</td>
              <td className="border-b border-dotted border-[#9a9a9a] py-2.5 leading-[1.5]">{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-8 flex items-end justify-between gap-6">
        <div>
          <div className="inline-flex items-center gap-3 border-2 border-[#55b3b5] bg-[#e9f6f6] px-5 py-3">
            <span className="text-[13px] font-bold text-black">Rp</span>
            <span className="text-[24px] font-black tabular-nums text-black">{formatNumberId(payment.amount)}</span>
          </div>
          <p className="mt-3 max-w-[320px] text-[10px] leading-[1.5] text-black">
            Kwitansi ini sah sebagai bukti penerimaan pembayaran. Pembayaran lewat transfer dianggap sah setelah dana
            diterima di rekening PT Hasil Inti Jualan.
          </p>
        </div>

        <div className="w-[260px] text-center text-[12px] text-black">
          <p className="mb-1">Depok, {formatIndonesianDate(payment.date)}</p>
          <p className="text-[11px]">Penerima,</p>
          <div className="relative flex h-[130px] items-center justify-center">
            <img
              src="/templates/HIJ Logo Stamp Basah.png"
              alt=""
              aria-hidden="true"
              className="absolute h-[124px] w-auto object-contain opacity-90"
            />
            <img src="/templates/ttd basah.png" alt="" aria-hidden="true" className="relative h-[104px] w-auto object-contain" />
          </div>
          <p className="mt-1 font-bold tracking-wider">PT HASIL INTI JUALAN</p>
        </div>
      </div>
    </DocumentPage>
  );
};
