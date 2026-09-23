import React from 'react';
import { Quotation, Customer } from '../../types';
import { effectiveUnitPrice, isBelowMoq, parseSizeRows } from '../../lib/pricing';
import { DocumentPage } from './DocumentPage';

interface QuotationDocumentProps {
  id: string;
  quotation: Quotation;
  customer?: Customer;
}

/** Formatter helper using Indonesian dot notation: e.g. 115.000 */
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

const cellClass = 'border border-black px-2 py-1 text-[10px]';

/**
 * Quotation Document Component
 * Strictly replicates the structure, layout, typography, borders, and colors
 * of the official template: reference/generate-form/Surat_Penawaran_QUO-001.pdf
 */
export const QuotationDocument: React.FC<QuotationDocumentProps> = ({ id, quotation, customer }) => {
  const documentNo = quotation.quotationNo || quotation.id || '-';
  const moq = Number(quotation.moq) || 100;
  const recipient = customer?.company || customer?.name || quotation.customerName || '-';

  // Normalize recipient city / address line
  let place = customer?.address || '-';
  if (place.startsWith('di – ') || place.startsWith('di - ')) {
    place = place.replace(/^di\s*[-–]\s*/, '');
  }

  const productName = quotation.designName || quotation.productType || 'produk';
  const issuedAt = quotation.timestamp || new Date().toISOString();
  const signatureDate = formatIndonesianDate(issuedAt);

  // Price formatting
  const priceSesuaiMoq = quotation.price && quotation.price > 0 ? formatNumberId(quotation.price) : '-';
  const priceBelowMoq =
    quotation.priceBelowMoq && quotation.priceBelowMoq > 0
      ? formatNumberId(quotation.priceBelowMoq)
      : '-';

  /*
   * The total follows the same rule the form and the invoice use: below MOQ
   * the below-MOQ rate applies, so the printed total never contradicts the
   * order it turns into.
   */
  const quantity = Number(quotation.quantity) || 0;
  const unitPrice = effectiveUnitPrice(quotation);
  const total = quantity * unitPrice;
  const belowMoq = isBelowMoq(quotation) && unitPrice !== (Number(quotation.price) || 0);

  const sizeRows = parseSizeRows(quotation.size);
  const sizeTotal = sizeRows.reduce((sum, row) => sum + (Number(row.qty) || 0), 0);

  const schedule = Array.isArray(quotation.paymentSchedule) ? quotation.paymentSchedule : [];
  const revisionLabel = quotation.revision ? `Revisi ${quotation.revision}` : '';
  const superseded = !!quotation.supersededBy;

  return (
    <DocumentPage id={id} template="/templates/Quatation.png">
      {/* A replaced quotation is still readable, but never mistaken for the live one. */}
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
      <div className="mb-3 flex items-start justify-end">
        <div className="text-right">
          <p className="text-[13px] font-bold tracking-wide text-black">
            No : {documentNo}
            {revisionLabel && <span className="ml-2 rounded-sm bg-[#ea2027] px-1.5 py-px text-[10px] text-white">{revisionLabel}</span>}
          </p>
          {quotation.revisionOf && (
            <p className="text-[10px] text-black">Menggantikan {quotation.revisionOf}</p>
          )}
        </div>
      </div>

      {superseded && (
        <p className="mb-2.5 border border-[#ea2027] bg-[#fdecec] px-2 py-1 text-[11px] font-bold text-[#ea2027]">
          DIGANTI oleh {quotation.supersededBy} — penawaran ini tidak berlaku lagi.
        </p>
      )}

      {/* Hal : Surat Penawaran Harga */}
      <p className="text-[12px] text-black mb-3">
        Hal : <span className="font-bold">Surat Penawaran Harga</span>
      </p>

      {/* Recipient */}
      <div className="text-[12px] text-black leading-[1.5] mb-3">
        <p>Kepada Yth,</p>
        <p className="font-bold uppercase tracking-wide">{recipient}</p>
        <p>di – {place}</p>
      </div>

      {/* Opening Paragraph */}
      <p className="text-[12px] text-black leading-[1.6] text-justify mb-3">
        Dalam rangka menindaklanjuti pembicaraan sebelumnya perihal penawaran kerja sama untuk pembuatan{' '}
        {productName.toLowerCase()} maka bersamaan dengan ini, perkenankan kami untuk mengajukan surat penawaran harga sebagai berikut;
      </p>

      {/* Quotation Table */}
      <table className="w-full border-collapse table-fixed text-[11px] text-black border border-black">
        <thead>
          <tr className="bg-[#55b3b5] text-black text-[10px] font-bold">
            <th className="border border-black py-2 px-1 text-center w-[32px]">NO</th>
            <th className="border border-black py-2 px-2 text-center w-[110px]">ITEM</th>
            <th className="border border-black py-2 px-2 text-center w-[122px]">BAHAN</th>
            <th className="border border-black py-2 px-1 text-center w-[58px]">QTY</th>
            <th className="border border-black py-2 px-2 text-center w-[192px]">
              HARGA SESUAI MOQ ({moq}PCS)
            </th>
            <th className="border border-black py-2 px-2 text-center w-[192px]">
              HARGA DI BAWAH MOQ ({moq}PCS)
            </th>
          </tr>
        </thead>
        <tbody className="text-[11px] text-black">
          <tr className="align-middle">
            <td className="border border-black px-1 py-3 text-center font-bold">1</td>
            <td className="border border-black px-2 py-3 text-center leading-tight">
              {quotation.designName || quotation.productType || '-'}
            </td>
            <td className="border border-black px-2 py-3 text-center leading-tight">
              {quotation.material || '-'}
            </td>
            <td className="border border-black px-1 py-3 text-center whitespace-nowrap">
              {quotation.quantity} Pcs
            </td>
            <td className="border border-black px-3 py-3">
              <div className="flex items-center justify-between w-full">
                <span>Rp</span>
                <span className="tabular-nums">{priceSesuaiMoq}</span>
              </div>
            </td>
            <td className="border border-black px-3 py-3">
              <div className="flex items-center justify-between w-full">
                <span>Rp</span>
                <span className="tabular-nums">{priceBelowMoq}</span>
              </div>
            </td>
          </tr>

          {/* Total line: which rate applies is decided by the quantity against MOQ. */}
          <tr className="bg-[#e0e0e0] font-bold">
            <td colSpan={4} className="border border-black px-2 py-1.5 text-[10px] text-left">
              TOTAL ({quantity} Pcs &times; Rp {formatNumberId(unitPrice) || '-'})
              {belowMoq && <span className="ml-1 font-normal italic">— harga di bawah MOQ berlaku</span>}
            </td>
            <td colSpan={2} className="border border-black px-3 py-1.5">
              <div className="flex items-center justify-between w-full">
                <span>Rp</span>
                <span className="tabular-nums">{formatNumberId(total) || '-'}</span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      {/* Size breakdown, sample requirement and payment terms — one block, same table style */}
      <div className="mt-3 grid grid-cols-2 gap-3 text-[10px] text-black">
        <div>
          <p className="mb-1 font-bold">Rincian ukuran</p>
          {sizeRows.length > 0 ? (
            <table className="w-full border-collapse border border-black">
              <thead>
                <tr className="bg-[#55b3b5] font-bold">
                  <th className={`${cellClass} text-left`}>UKURAN</th>
                  <th className={`${cellClass} text-right`}>QTY (PCS)</th>
                </tr>
              </thead>
              <tbody>
                {sizeRows.map((row, index) => (
                  <tr key={`${row.size}-${index}`}>
                    <td className={cellClass}>{row.size}</td>
                    <td className={`${cellClass} text-right tabular-nums`}>{row.qty}</td>
                  </tr>
                ))}
                <tr className="bg-[#e0e0e0] font-bold">
                  <td className={cellClass}>TOTAL</td>
                  <td className={`${cellClass} text-right tabular-nums`}>{sizeTotal}</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <p className="border border-black px-2 py-1">{quotation.size || 'Sesuai kesepakatan'}</p>
          )}
          <p className="mt-2">
            <span className="font-bold">Sampel : </span>
            {quotation.needsSample ? 'Perlu sampel fisik sebelum produksi' : 'Tanpa sampel fisik'}
          </p>
        </div>

        <div>
          <p className="mb-1 font-bold">Termin pembayaran</p>
          {schedule.length > 0 ? (
            <table className="w-full border-collapse border border-black">
              <thead>
                <tr className="bg-[#55b3b5] font-bold">
                  <th className={`${cellClass} text-left`}>TERMIN</th>
                  <th className={`${cellClass} text-right`}>%</th>
                  <th className={`${cellClass} text-right`}>JUMLAH (RP)</th>
                </tr>
              </thead>
              <tbody>
                {schedule.map((term, index) => {
                  const percentage = Number(term.percentage) || 0;
                  const amount = Number(term.amount) || Math.round(total * percentage / 100);
                  return (
                    <tr key={term.id || index}>
                      <td className={cellClass}>
                        {term.label || `Termin ${index + 1}`}
                      </td>
                      <td className={`${cellClass} text-right tabular-nums`}>{percentage}%</td>
                      <td className={`${cellClass} text-right tabular-nums`}>{formatNumberId(amount) || '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="border border-black px-2 py-1">Sesuai kesepakatan.</p>
          )}
        </div>
      </div>

      {/* Closing Paragraph */}
      <p className="mt-3 text-[12px] leading-[1.6] text-justify text-black">
        Demikian surat penawaran harga ini kami buat, untuk informasi detail lebih lanjut bisa dibahas kemudian,
        besar harapan kami agar rencana kerjasama ini bisa berjalan dengan baik, atas perhatian dan kerjasamanya
        kami ucapkan banyak terima kasih.
      </p>

      {/* Signature Section */}
      <div className="mt-auto flex justify-end">
        <div className="w-[260px] text-center text-[12px] text-black">
          <p className="mb-1">Depok, {signatureDate}</p>
          <div className="relative flex h-[120px] items-center justify-center">
            <img
              src="/templates/HIJ Logo Stamp Basah.png"
              alt=""
              aria-hidden="true"
              className="absolute h-[116px] w-auto object-contain opacity-95"
            />
            <img
              src="/templates/ttd basah.png"
              alt=""
              aria-hidden="true"
              className="relative h-[96px] w-auto object-contain"
            />
          </div>
          <p className="font-bold tracking-wider mt-1">PT HASIL INTI JUALAN</p>
        </div>
      </div>
    </DocumentPage>
  );
};
