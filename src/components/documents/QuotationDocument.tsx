import React from 'react';
import { Quotation, Customer } from '../../types';
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

/**
 * Quotation Document Component
 * Strictly replicates the structure, layout, typography, borders, and colors
 * of the official template: reference/generate-form/Surat_Penawaran_QUO-001.pdf
 */
export const QuotationDocument: React.FC<QuotationDocumentProps> = ({ id, quotation, customer }) => {
  const documentNo = quotation.id || 'QUO-001';
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

  return (
    <DocumentPage id={id} template="/templates/Quatation.png">
      {/* Top Document Number (Right Aligned under banner) */}
      <div className="flex justify-end mb-3.5">
        <p className="text-[13px] font-bold text-black tracking-wide">
          No : {documentNo}
        </p>
      </div>

      {/* Hal : Surat Penawaran Harga */}
      <p className="text-[12px] text-black mb-3.5">
        Hal : <span className="font-bold">Surat Penawaran Harga</span>
      </p>

      {/* Recipient */}
      <div className="text-[12px] text-black leading-[1.5] mb-3.5">
        <p>Kepada Yth,</p>
        <p className="font-bold uppercase tracking-wide">{recipient}</p>
        <p>di – {place}</p>
      </div>

      {/* Opening Paragraph */}
      <p className="text-[12px] text-black leading-[1.6] text-justify mb-4">
        Dalam rangka menindak-lanjuti pembicaraan sebelumnya perihal penawaran kerja sama untuk pembuatan{' '}
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
              HARGA DIBAWAH MOQ ({moq}PCS)
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
        </tbody>
      </table>

      {/* Closing Paragraph */}
      <p className="mt-4 text-[12px] leading-[1.6] text-justify text-black">
        Demikian surat penawaran harga ini kami buat, untuk informasi detail lebih lanjut bisa dibahas kemudian,
        besar harapan kami agar rencana kerjasama ini bisa berjalan dengan baik, atas perhatian dan kerjasamanya
        kami ucapkan banyak terima kasih.
      </p>

      {/* Signature Section */}
      <div className="mt-[56px] flex justify-end">
        <div className="w-[260px] text-center text-[12px] text-black">
          <p className="mb-1">Depok, {signatureDate}</p>
          <div className="relative flex h-[140px] items-center justify-center">
            <img
              src="/templates/HIJ Logo Stamp Basah.png"
              alt=""
              aria-hidden="true"
              className="absolute h-[134px] w-auto object-contain opacity-95"
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
