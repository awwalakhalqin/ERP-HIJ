import React from 'react';
import { SPK } from '../../types';
import { formatDate } from '../../lib/utils';
import { DocumentPage } from './DocumentPage';

/*
 * The SPK letterhead (Halaman1.png / Halaman2.png) already prints the boxes and
 * their labels, so the app only places values inside them. Positions are a
 * percentage of the A4 page, measured from the template artwork.
 */

interface FieldSlotProps {
  left: string;
  top: string;
  width: string;
  children: React.ReactNode;
}

/** Two lines of 13px fit the value area of a template box. */
const FieldSlot: React.FC<FieldSlotProps> = ({ left, top, width, children }) => (
  <div
    className="absolute font-bold text-black"
    style={{
      left,
      top,
      width,
      height: '26px',
      overflow: 'hidden',
      fontSize: '11px',
      lineHeight: '13px'
    }}
  >
    {children}
  </div>
);

/** "S: 10, M: 20" or "S 68 - 48" become rows in the SIZE CHART panel. */
function parseSizeChart(raw?: string): { label: string; value: string }[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .split(/\r?\n|,|;/)
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const match = part.match(/^([A-Za-z0-9\s./]+?)\s*[:=-]\s*(.+)$/);
      if (match) return { label: match[1].trim().toUpperCase(), value: match[2].trim() };
      const spaced = part.match(/^(\S+)\s+(.+)$/);
      if (spaced) return { label: spaced[1].toUpperCase(), value: spaced[2].trim() };
      return { label: part.toUpperCase(), value: '' };
    })
    .slice(0, 6);
}

interface SpkDocumentProps {
  spk: SPK;
  /** Ids the PDF exporter captures. */
  page1Id: string;
  page2Id: string;
}

export const SpkDocumentPage1: React.FC<{ spk: SPK; id: string }> = ({ spk, id }) => {
  const sizeRows = parseSizeChart(spk.sizeChart);
  const mockup = spk.mockupDepan || spk.mockupBelakang;

  return (
    <DocumentPage id={id} template="/templates/Halaman1.png" padded={false}>
      {/* Left column: customer, print/embroidery, material */}
      <FieldSlot left="4.6%" top="13.9%" width="21.5%">{spk.customerName || '-'}</FieldSlot>
      <FieldSlot left="4.6%" top="20.1%" width="21.5%">{spk.sablonBordir || '-'}</FieldSlot>
      <FieldSlot left="4.6%" top="26.3%" width="21.5%">{spk.material || '-'}</FieldSlot>

      {/* Right column: PO and dates */}
      <FieldSlot left="28.8%" top="13.9%" width="21.5%">{spk.po || spk.orderId || '-'}</FieldSlot>
      <FieldSlot left="28.8%" top="20.1%" width="21.5%">{formatDate(spk.tanggalMasuk)}</FieldSlot>
      <FieldSlot left="28.8%" top="26.3%" width="21.5%">{formatDate(spk.tanggalSelesai)}</FieldSlot>

      {/* SIZE CHART panel */}
      <div className="absolute" style={{ left: '53.4%', top: '14.8%', width: '42%', height: '13.6%' }}>
        {sizeRows.length > 0 ? (
          <table className="w-full border-collapse text-[11px]">
            <tbody>
              {sizeRows.map(row => (
                <tr key={row.label}>
                  <td className="py-[3px] pr-2 font-bold text-black">{row.label}</td>
                  <td className="py-[3px] text-right font-semibold text-black tabular-nums">{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-[11px] italic text-slate-500">Size chart belum dicatat.</p>
        )}
      </div>

      {/* MOCKUP / LAYOUT PRODUCT */}
      <div
        className="absolute flex items-center justify-center overflow-hidden rounded-lg border border-dashed border-slate-300"
        style={{ left: '4%', top: '35.2%', width: '92%', height: '56%' }}
      >
        {mockup ? (
          <img src={mockup} alt="" aria-hidden="true" className="h-full w-full object-contain p-2" />
        ) : (
          <span className="text-[12px] italic text-slate-400">Mockup belum dilampirkan</span>
        )}
      </div>
    </DocumentPage>
  );
};

export const SpkDocumentPage2: React.FC<{ spk: SPK; id: string }> = ({ spk, id }) => (
  <DocumentPage id={id} template="/templates/Halaman2.png" padded={false}>
    {/* CATATAN */}
    <div
      className="absolute whitespace-pre-line text-[12px] leading-[1.7] text-black"
      style={{ left: '5.9%', top: '16%', width: '88%', height: '55%', overflow: 'hidden' }}
    >
      {spk.notes || 'Pastikan jahitan rapi, obras presisi, dan buang benang sebelum QC.'}
    </div>

    {/* PENANGGUNG JAWAB names, printed inside the teal boxes */}
    <div
      className="absolute text-center text-[12px] font-bold text-white"
      style={{ left: '5.7%', top: '81.5%', width: '27.9%' }}
    >
      {spk.pjFinishing || '-'}
    </div>
    <div
      className="absolute text-center text-[12px] font-bold text-white"
      style={{ left: '35.9%', top: '81.5%', width: '28.1%' }}
    >
      {spk.pjCutting || '-'}
    </div>
    <div
      className="absolute text-center text-[12px] font-bold text-white"
      style={{ left: '66.3%', top: '81.5%', width: '28.1%' }}
    >
      {spk.pjKepalaProduksi || '-'}
    </div>
  </DocumentPage>
);

/** Both SPK pages, stacked for preview and for the PDF exporter. */
export const SpkDocument: React.FC<SpkDocumentProps> = ({ spk, page1Id, page2Id }) => (
  <>
    <SpkDocumentPage1 spk={spk} id={page1Id} />
    <SpkDocumentPage2 spk={spk} id={page2Id} />
  </>
);
