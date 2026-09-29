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

/*
 * The SIZE CHART box on Halaman1.png: about 333 x 150 px under its title bar.
 * The chart is printed the way HIJ's own size charts are — sizes across, one
 * measurement per row — because the box is wide and short.
 */
const PANEL_WIDTH_PX = 333;
const PANEL_HEIGHT_PX = 150;
/** Width of the first column, which names the measurement. */
const LABEL_COL_PX = 46;
/** Narrowest a size column may get before the sizes wrap onto a second table. */
const MIN_SIZE_COL_PX = 26;

/** Fonts tried from largest to smallest until the chart fits the box. */
const SIZE_SCALE = [
  { font: 10, padY: 3 },
  { font: 9, padY: 2 },
  { font: 8, padY: 2 },
  { font: 7, padY: 1 },
  { font: 6, padY: 1 }
];

const SizeChartPanel: React.FC<{ table: SizeTable }> = ({ table }) => {
  const { columns, rows, caption, legend } = table;
  const [sizeCol, ...valueCols] = columns;

  const totals = valueCols
    .filter(col => col.numeric && COUNT_COLUMNS.has(col.key) && rows.some(row => row[col.key] !== ''))
    .map(col => ({ label: col.label, sum: rows.reduce((sum, row) => sum + (Number(row[col.key]) || 0), 0) }));

  // Sizes run across; more than fit in one band of columns wrap onto a second table.
  const perTable = Math.max(1, Math.floor((PANEL_WIDTH_PX - LABEL_COL_PX) / MIN_SIZE_COL_PX));
  const tableCount = Math.ceil(rows.length / perTable);
  const perChunk = Math.ceil(rows.length / tableCount);
  const chunks = Array.from({ length: tableCount }, (_, i) => rows.slice(i * perChunk, (i + 1) * perChunk));

  const infoText = [
    caption.map(item => `${item.label}: ${item.value}`).join(' · '),
    totals.map(t => `Total ${t.label}: ${t.sum}`).join(' · ')
  ].filter(Boolean);
  const tableRows = tableCount * (valueCols.length + 1);
  // The widest entry in a size column ("55/110") must fit without clipping.
  const sizeColWidth = (PANEL_WIDTH_PX - LABEL_COL_PX) / perChunk;
  const widestValue = Math.max(1, ...rows.flatMap(row => columns.map(col => (row[col.key] || '').length)));

  const scale =
    SIZE_SCALE.find(({ font, padY }) => {
      const textLine = font * 1.3;
      const legendLines = legend ? Math.ceil((legend.length * font * 0.52) / PANEL_WIDTH_PX) : 0;
      const rowHeight = font * 1.2 + padY * 2 + 1;
      const height = (Math.min(infoText.length, 1) + legendLines) * textLine + tableRows * rowHeight + (tableCount - 1) * 3 + 4;
      return height <= PANEL_HEIGHT_PX && widestValue * font * 0.58 + 4 <= sizeColWidth;
    }) || SIZE_SCALE[SIZE_SCALE.length - 1];

  const cell: React.CSSProperties = {
    border: '1px solid #64748b',
    padding: `${scale.padY}px 2px`,
    lineHeight: 1.2,
    textAlign: 'center',
    verticalAlign: 'middle',
    whiteSpace: 'nowrap',
    overflow: 'hidden'
  };
  const empty: React.CSSProperties = { ...cell, border: 'none' };
  const labelCell: React.CSSProperties = { ...cell, textAlign: 'left', paddingLeft: '4px', fontWeight: 700, background: '#f1f5f9' };
  const headCell: React.CSSProperties = { ...cell, fontWeight: 700, background: '#e2e8f0' };

  return (
    <div className="flex flex-col text-black" style={{ fontSize: `${scale.font}px` }}>
      {infoText.length > 0 && (
        <div className="flex justify-between gap-2 font-semibold text-slate-700" style={{ lineHeight: 1.3 }}>
          {infoText.map(text => (
            <span key={text} className="truncate">{text}</span>
          ))}
        </div>
      )}
      <div className="mt-0.5 flex flex-col" style={{ gap: '3px' }}>
        {chunks.map((chunk, chunkIndex) => (
          <table key={chunkIndex} className="w-full border-collapse" style={{ tableLayout: 'fixed', borderSpacing: 0 }}>
            <colgroup>
              <col style={{ width: `${LABEL_COL_PX}px` }} />
              {Array.from({ length: perChunk }, (_, i) => <col key={i} />)}
            </colgroup>
            <thead>
              <tr>
                <th style={{ ...headCell, textAlign: 'left', paddingLeft: '4px' }}>{sizeCol.label}</th>
                {Array.from({ length: perChunk }, (_, i) => (
                  <th key={i} style={chunk[i] ? headCell : empty}>{chunk[i]?.[sizeCol.key] || ''}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {valueCols.map(col => (
                <tr key={col.key}>
                  <td style={labelCell}>{col.label}</td>
                  {Array.from({ length: perChunk }, (_, i) => (
                    <td key={i} className="tabular-nums" style={chunk[i] ? cell : empty}>
                      {chunk[i] ? chunk[i][col.key] || '-' : ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
      {legend && (
        <p className="mt-0.5 text-slate-600" style={{ lineHeight: 1.3 }}>{legend}</p>
      )}
    </div>
  );
};

/** The two sides of the approved design, as printed on the SPK. */
export interface SpkMockups {
  front?: string;
  back?: string;
}

interface SpkDocumentProps {
  spk: SPK;
  /** Ids the PDF exporter captures. */
  page1Id: string;
  page2Id: string;
  /** Mockups resolved from the order's design; each side falls back to the SPK's own copy. */
  mockups?: SpkMockups;
  /** The order's size breakdown, printed when the SPK carries no chart of its own. */
  sizeChart?: string;
  /** The live chart from the Size Chart page that the SPK's order names. */
  template?: SizeChart;
}

const isArtwork = (url?: string): url is string => !!url && !url.startsWith('/templates/');

export const SpkDocumentPage1: React.FC<{ spk: SPK; id: string; mockups?: SpkMockups; sizeChart?: string; template?: SizeChart }> = ({
  spk,
  id,
  mockups,
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
   * The design page is the source of truth, so a side uploaded or replaced
   * after the SPK was issued still prints. The copy taken at issue time only
   * fills a side the design no longer has.
   */
  const sides = [
    { label: 'Tampak Depan', url: [mockups?.front, spk.mockupDepan].find(isArtwork) },
    { label: 'Tampak Belakang', url: [mockups?.back, spk.mockupBelakang].find(isArtwork) }
  ].filter((side, index, all): side is { label: string; url: string } =>
    // Older SPKs copied the back view into mockupDepan when the front was missing.
    !!side.url && all.findIndex(other => other.url === side.url) === index
  );

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
      <div
        className="absolute overflow-hidden"
        style={{ left: '53.2%', top: '15.3%', width: `${PANEL_WIDTH_PX}px`, height: `${PANEL_HEIGHT_PX}px` }}
      >
        {sizeTable ? (
          <SizeChartPanel table={sizeTable} />
        ) : (
          <p className="text-[11px] italic text-slate-500">Template size chart belum dipilih di pesanan.</p>
        )}
      </div>

      {/* MOCKUP / LAYOUT PRODUCT: front and back side by side */}
      <div
        className="absolute flex overflow-hidden rounded-lg border border-dashed border-slate-300"
        style={{ left: '4%', top: '35.2%', width: '92%', height: '56%' }}
      >
        {sides.length > 0 ? (
          sides.map((side, index) => (
            <figure
              key={side.label}
              className={`flex min-w-0 flex-1 flex-col ${index > 0 ? 'border-l border-dashed border-slate-300' : ''}`}
            >
              {sides.length > 1 && (
                <figcaption className="pt-2 text-center text-[12px] font-bold uppercase tracking-wide text-slate-700">
                  {side.label}
                </figcaption>
              )}
              <div className="min-h-0 flex-1 p-2">
                <img src={side.url} alt="" aria-hidden="true" className="h-full w-full object-contain" />
              </div>
            </figure>
          ))
        ) : (
          <span className="m-auto text-[12px] italic text-slate-400">Mockup belum dilampirkan</span>
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
export const SpkDocument: React.FC<SpkDocumentProps> = ({ spk, page1Id, page2Id, mockups, sizeChart, template }) => (
  <>
    <SpkDocumentPage1 spk={spk} id={page1Id} mockups={mockups} sizeChart={sizeChart} template={template} />
    <SpkDocumentPage2 spk={spk} id={page2Id} />
  </>
);
