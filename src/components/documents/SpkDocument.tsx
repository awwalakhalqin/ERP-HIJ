import React from 'react';
import { SPK, SizeChart } from '../../types';
import { formatDate } from '../../lib/utils';
import { parseSizeRows } from '../../lib/pricing';
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

/*
 * The SIZE CHART panel accepts what the records actually hold:
 *  - "S: 20, M: 40" — pieces per size (the order's breakdown);
 *  - a JSON array of rows such as {size, panjang, dada, lengan, pcsWarna} or
 *    {model, warna, size, qty} — a measurement/colour chart.
 * Both become one table with a header row, so the cutting room reads columns,
 * not a run of "key: value" text. Entries in the text form are separated by
 * commas or line breaks only; a '-' inside a value ("68 - 48") is kept.
 */
interface SizeTable {
  columns: { key: string; label: string; numeric: boolean }[];
  rows: Record<string, string>[];
  /** Values shared by every row, printed once above the table. */
  caption: { label: string; value: string }[];
  /** What the column codes stand for, e.g. "LD = Lebar Dada". */
  legend?: string;
}

/** The chart copied onto the SPK when it was issued (a subset of SizeChart). */
type SizeChartTemplate = Pick<SizeChart, 'measurements' | 'rows'> & Partial<Pick<SizeChart, 'name' | 'scope' | 'customerName'>>;

function parseTemplate(raw?: string): SizeChartTemplate | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return parsed && Array.isArray(parsed.rows) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/*
 * The Size Chart page's template, printed row for row: every size the chart
 * lists with its measurements, plus the pieces ordered per size when the
 * order's breakdown names them. The columns are the chart's own codes
 * (LD, PB, …) with a legend underneath.
 */
function templateTable(template: SizeChartTemplate | undefined, breakdown?: string): SizeTable | null {
  if (!template || !Array.isArray(template.rows) || template.rows.length === 0) return null;
  const measurements = Array.isArray(template.measurements) ? template.measurements : [];
  const pcs = new Map(parseSizeRows(breakdown).map(r => [r.size.trim().toUpperCase(), r.qty]));
  const rows = template.rows.map(row => {
    const ordered = pcs.get(String(row.size).trim().toUpperCase());
    return {
      size: String(row.size),
      ...Object.fromEntries(measurements.map(m => [m.key, String(row.values?.[m.key] ?? '')])),
      ...(pcs.size > 0 ? { qty: ordered ? String(ordered) : '' } : {})
    };
  });
  const columns = [
    { key: 'size', label: 'Ukuran', numeric: false },
    ...measurements.map(m => ({
      key: m.key,
      label: m.code || m.label,
      numeric: rows.every(row => row[m.key] === '' || /^\d+$/.test(row[m.key].trim()))
    })),
    ...(pcs.size > 0 ? [{ key: 'qty', label: 'Pcs', numeric: true }] : [])
  ];
  const scopeLabel = template.scope === 'customer' ? `khusus ${template.customerName || 'pelanggan'}` : 'standar HIJ';
  const legend = measurements
    .filter(m => m.code && m.label && m.code !== m.label)
    .map(m => `${m.code} = ${m.label}`)
    .join(' · ');
  return {
    columns,
    rows,
    caption: [{ label: 'Template', value: `${template.name || '-'} (${scopeLabel})` }],
    legend: legend || undefined
  };
}

const COLUMN_LABELS: Record<string, string> = {
  size: 'Ukuran',
  ukuran: 'Ukuran',
  qty: 'Pcs',
  pcs: 'Pcs',
  jumlah: 'Pcs',
  panjang: 'Panjang',
  dada: 'Dada',
  lengan: 'Lengan',
  pinggang: 'Pinggang',
  pcsWarna: 'Pcs / Warna',
  warna: 'Warna',
  model: 'Model',
  cutting: 'Potong',
  sewing: 'Jahit',
  finishing: 'Finishing',
  readyHIJ: 'Stok HIJ',
  belanja: 'Belanja'
};

/** Columns that count pieces — the only ones worth a TOTAL row. */
const COUNT_COLUMNS = new Set(['qty', 'pcs', 'jumlah', 'cutting', 'sewing', 'finishing', 'readyHIJ', 'belanja']);

const columnLabel = (key: string) =>
  COLUMN_LABELS[key] || key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());

function parseSizeChart(raw?: string): SizeTable | null {
  if (!raw || !raw.trim()) return null;
  const text = raw.trim();

  if (text.startsWith('[') || text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      const list: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
      const objects = list.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object');
      if (objects.length === 0) return null;
      const keys: string[] = [];
      for (const row of objects) for (const key of Object.keys(row)) if (!keys.includes(key)) keys.push(key);
      // Size first, then everything else in the order it was recorded.
      keys.sort((x, y) => (x === 'size' || x === 'ukuran' ? -1 : y === 'size' || y === 'ukuran' ? 1 : 0));
      const rows = objects.map(row =>
        Object.fromEntries(keys.map(key => [key, row[key] === undefined || row[key] === null ? '' : String(row[key])]))
      );
      const filled = keys.filter(key => rows.some(row => row[key].trim() !== ''));
      const constant = filled.filter(
        key => key !== 'size' && key !== 'ukuran' && rows.length > 1 && rows.every(row => row[key] === rows[0][key])
      );
      const columns = filled
        .filter(key => !constant.includes(key))
        .map(key => ({
          key,
          label: columnLabel(key),
          numeric: rows.every(row => row[key] === '' || /^\d+$/.test(row[key].trim()))
        }));
      if (columns.length === 0) return null;
      return { columns, rows, caption: constant.map(key => ({ label: columnLabel(key), value: rows[0][key] })) };
    } catch {
      // Not JSON after all; fall through to the text form.
    }
  }

  const rows = text
    .split(/\r?\n|,/)
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const sep = part.search(/[:=]/);
      return sep > 0
        ? { size: part.slice(0, sep).trim().toUpperCase(), qty: part.slice(sep + 1).trim() }
        : { size: part.toUpperCase(), qty: '' };
    });
  if (rows.length === 0) return null;
  const hasQty = rows.some(row => row.qty !== '');
  return {
    columns: [
      { key: 'size', label: 'Ukuran', numeric: false },
      ...(hasQty ? [{ key: 'qty', label: 'Pcs', numeric: rows.every(row => row.qty === '' || /^\d+$/.test(row.qty)) }] : [])
    ],
    rows,
    caption: []
  };
}

/** Beyond this many rows the chart is split into side-by-side blocks. */
const SIZE_ROWS_SINGLE_COLUMN = 8;

interface SpkDocumentProps {
  spk: SPK;
  /** Ids the PDF exporter captures. */
  page1Id: string;
  page2Id: string;
  /** Mockup resolved from the approved design, when the SPK has none of its own. */
  mockupUrl?: string;
  /** The order's size breakdown, printed when the SPK carries no chart of its own. */
  sizeChart?: string;
  /** The live chart from the Size Chart page that the SPK's order names. */
  template?: SizeChart;
}

export const SpkDocumentPage1: React.FC<{ spk: SPK; id: string; mockupUrl?: string; sizeChart?: string; template?: SizeChart }> = ({
  spk,
  id,
  mockupUrl,
  sizeChart,
  template
}) => {
  /*
   * The live template wins, then the copy taken when the SPK was issued.
   * SPKs from before templates were required fall back to whatever chart
   * text they carry.
   */
  const sizeTable =
    templateTable(template || parseTemplate(spk.sizeChartTemplate), spk.sizeChart || sizeChart) ||
    parseSizeChart(spk.sizeChart) ||
    parseSizeChart(sizeChart);
  /*
   * The approved design lives on the design record, not on the SPK, so the
   * caller resolves it and passes it in. Anything explicitly attached to the
   * SPK still wins; the blank SPK template is never a mockup.
   */
  const ownMockup = [spk.mockupDepan, spk.mockupBelakang].find(
    url => url && !url.startsWith('/templates/')
  );
  const mockup = ownMockup || mockupUrl;

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

      {/* SIZE CHART panel: one ruled table the cutting room can read at a glance */}
      <div className="absolute overflow-hidden" style={{ left: '53.4%', top: '14.8%', width: '42%', height: '13.6%' }}>
        {sizeTable ? (() => {
          const { columns, rows, caption, legend } = sizeTable;
          // Long charts are split into side-by-side blocks, as many as the
          // panel width (~333px, ~40px per column) leaves room for.
          const wanted = Math.ceil(rows.length / SIZE_ROWS_SINGLE_COLUMN);
          const allowed = Math.max(1, Math.min(3, Math.floor(333 / (columns.length * 40))));
          const blockCount = Math.min(wanted, allowed);
          const perBlock = Math.ceil(rows.length / blockCount);
          const blocks = Array.from({ length: blockCount }, (_, i) => rows.slice(i * perBlock, (i + 1) * perBlock));
          const visibleRows = perBlock;
          // The panel is a fixed box on the template: about 125px of rows under
          // its title, so long charts print smaller rather than get cut off.
          const lines = visibleRows + 2 + (caption.length ? 1 : 0) + (legend ? 1 : 0);
          const fontSize = lines <= 8 ? '9px' : lines <= 11 ? '8px' : lines <= 14 ? '7px' : '6px';
          const cellPad = lines <= 8 ? '2px 5px' : lines <= 11 ? '1px 4px' : '0 3px';
          const totals = columns.map(col =>
            col.numeric && COUNT_COLUMNS.has(col.key) && rows.some(row => row[col.key] !== '')
              ? rows.reduce((sum, row) => sum + (Number(row[col.key]) || 0), 0)
              : null
          );
          const showTotal = totals.some(t => t !== null);
          const cell: React.CSSProperties = { border: '1px solid #94a3b8', padding: cellPad, lineHeight: 1.15, verticalAlign: 'middle' };
          const head: React.CSSProperties = { ...cell, background: '#e2e8f0', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.02em', whiteSpace: 'nowrap' };
          return (
            <div style={{ fontSize }}>
              {caption.length > 0 && (
                <p className="mb-0.5 font-semibold text-slate-700" style={{ lineHeight: 1.2 }}>
                  {caption.map(item => `${item.label}: ${item.value}`).join(' · ')}
                </p>
              )}
              {legend && (
                <p className="mb-0.5 text-slate-600" style={{ lineHeight: 1.2, fontSize: '0.92em' }}>
                  {legend}
                </p>
              )}
              <div className="flex items-start gap-1.5">
              {blocks.map((block, blockIndex) => (
                <table key={blockIndex} className="w-full border-collapse text-black" style={{ borderSpacing: 0 }}>
                  <thead>
                    <tr>
                      {columns.map(col => (
                        <th key={col.key} style={{ ...head, textAlign: col.numeric ? 'right' : 'left' }}>{col.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.map((row, rowIndex) => (
                      <tr key={`${blockIndex}-${rowIndex}`}>
                        {columns.map((col, colIndex) => (
                          <td
                            key={col.key}
                            className={col.numeric ? 'tabular-nums' : undefined}
                            style={{ ...cell, textAlign: col.numeric ? 'right' : 'left', fontWeight: colIndex === 0 ? 700 : 500 }}
                          >
                            {row[col.key] || '-'}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {showTotal && blockIndex === blocks.length - 1 && (
                      <tr>
                        {columns.map((col, colIndex) => (
                          <td key={col.key} className="tabular-nums" style={{ ...head, textAlign: col.numeric ? 'right' : 'left' }}>
                            {colIndex === 0 ? 'Total' : totals[colIndex] !== null ? totals[colIndex] : ''}
                          </td>
                        ))}
                      </tr>
                    )}
                  </tbody>
                </table>
              ))}
              </div>
            </div>
          );
        })() : (
          <p className="text-[11px] italic text-slate-500">Template size chart belum dipilih di pesanan.</p>
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
export const SpkDocument: React.FC<SpkDocumentProps> = ({ spk, page1Id, page2Id, mockupUrl, sizeChart, template }) => (
  <>
    <SpkDocumentPage1 spk={spk} id={page1Id} mockupUrl={mockupUrl} sizeChart={sizeChart} template={template} />
    <SpkDocumentPage2 spk={spk} id={page2Id} />
  </>
);
