import * as XLSX from 'xlsx';

/*
 * Reading the factory's monthly workbook.
 *
 * The file is a working spreadsheet, not an export: merged cells, two tables on
 * one sheet, and seven different detail-sheet shapes. So this parser recognises
 * the shapes it can vouch for and reports everything else as skipped — an
 * import that quietly guesses would put wrong numbers into production.
 *
 * Nothing here writes anything. It produces a plan for a human to approve.
 */

export interface ImportSizeRow {
  size: string;
  qty: number;
}

export interface ImportProduct {
  model: string;
  material?: string;
  color?: string;
  sizes: ImportSizeRow[];
  quantity: number;
}

export interface ImportOrder {
  /** Row number in the register, for tracing back to the file. */
  sourceRow: number;
  brand: string;
  pic?: string;
  masuk?: string;
  deadline?: string;
  quantity: number;
  estimasi?: string;
  /** Per stage: true when ticked, or the vendor name when outsourced. */
  stages: Record<'pengadaan' | 'cutting' | 'jahit' | 'finishing', boolean | string>;
  payment?: 'DP' | 'LUNAS' | 'BELUM BAYAR';
  notes?: string;
  /** Detail sheet matched to this order, when one exists. */
  detailSheet?: string;
  products: ImportProduct[];
  /** Sum of the detail sheet, for cross-checking against the queue figure. */
  detailTotal?: number;
  /*
   * Set when the detail sheet disagrees with the queue. The queue is the number
   * the owner sub-totals and tracks, so it wins — and the breakdown is held
   * back for review rather than written in on a guess.
   */
  detailWarning?: string;
}

export interface ImportSample {
  sourceRow: number;
  brand: string;
  model?: string;
  quantity: number;
  notes?: string;
}

export interface SkippedSheet {
  sheet: string;
  reason: string;
}

export interface ImportPlan {
  monthLabel: string;
  orders: ImportOrder[];
  samples: ImportSample[];
  skipped: SkippedSheet[];
  matchedSheets: string[];
  totalQuantity: number;
  /** Orders whose detail sheet did not reconcile with the queue figure. */
  needsReview: number;
}

type Grid = string[][];

const text = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();
const upper = (value: unknown) => text(value).toUpperCase();

/** Strip everything but letters and digits so "KAOS IBU ARIYANI" can meet "IBU ARIYANI". */
export const normaliseName = (value: unknown) => upper(value).replace(/[^A-Z0-9]/g, '');

const toNumber = (value: unknown): number => {
  const digits = text(value).replace(/[^0-9]/g, '');
  return digits ? parseInt(digits, 10) : 0;
};

/*
 * Dates print as M/D/YY in this workbook — "8/20/26" can only be August 20th.
 * Real Date cells are preferred when the sheet carries them.
 */
const toIsoDate = (value: unknown): string | undefined => {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toISOString().split('T')[0];
  }
  const raw = text(value);
  const match = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!match) return undefined;
  const month = Number(match[1]);
  const day = Number(match[2]);
  let year = Number(match[3]);
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

/** Wingdings tick used across the stage columns. */
const TICK = 'þ';

const readStage = (value: unknown): boolean | string => {
  const raw = text(value);
  if (!raw) return false;
  if (raw === TICK || raw === '✓' || upper(raw) === 'V' || upper(raw) === 'OK') return true;
  // Anything else in a stage column names who did it instead — "FENDOR BU YATI".
  return raw;
};

const readPayment = (value: unknown): ImportOrder['payment'] => {
  const raw = upper(value);
  if (raw.includes('LUNAS')) return 'LUNAS';
  if (raw.includes('BELUM')) return 'BELUM BAYAR';
  if (raw.includes('DP')) return 'DP';
  return undefined;
};

const sheetGrid = (wb: XLSX.WorkBook, name: string): Grid =>
  XLSX.utils.sheet_to_json<string[]>(wb.Sheets[name], { header: 1, raw: false, defval: '' });

const rowHasText = (row: string[]) => row.some(cell => text(cell));

// --------------------------------------------------------------- register

const REGISTER_SHEET_HINTS = ['ANTRIAN', 'LIST'];

/** The month sheet holds the queue and, lower down, the sampling agenda. */
function findRegisterSheet(wb: XLSX.WorkBook): string | null {
  for (const name of wb.SheetNames) {
    const grid = sheetGrid(wb, name).slice(0, 6);
    const flat = grid.flat().map(upper);
    if (REGISTER_SHEET_HINTS.some(h => flat.includes(h)) && flat.includes('BRAND')) {
      return name;
    }
  }
  return null;
}

function parseRegister(grid: Grid): { orders: ImportOrder[]; samples: ImportSample[] } {
  const orders: ImportOrder[] = [];
  const samples: ImportSample[] = [];

  const subTotalAt = grid.findIndex(r => upper(r[1]) === 'SUB TOTAL' || upper(r[0]) === 'SUB TOTAL');
  const samplingAt = grid.findIndex(r => r.some(c => upper(c).includes('AGENDA SAMPLING')));

  const queueEnd = subTotalAt !== -1 ? subTotalAt : samplingAt !== -1 ? samplingAt : grid.length;

  for (let i = 0; i < queueEnd; i++) {
    const row = grid[i];
    const brand = text(row[3]);
    const qty = toNumber(row[6]);
    // A real queue line always names a brand and carries a queue number.
    if (!brand || !text(row[1])) continue;
    if (upper(brand) === 'BRAND') continue;

    orders.push({
      sourceRow: i + 1,
      brand,
      pic: text(row[2]) || undefined,
      masuk: toIsoDate(row[4]),
      deadline: toIsoDate(row[5]),
      quantity: qty,
      estimasi: text(row[7]) || undefined,
      stages: {
        pengadaan: readStage(row[8]),
        cutting: readStage(row[9]),
        jahit: readStage(row[10]),
        finishing: readStage(row[11])
      },
      payment: readPayment(row[12]),
      notes: text(row[13]) || undefined,
      products: []
    });
  }

  if (samplingAt !== -1) {
    for (let i = samplingAt + 1; i < grid.length; i++) {
      const row = grid[i];
      const brand = text(row[3]);
      if (!brand || upper(brand) === 'BRAND') continue;
      samples.push({
        sourceRow: i + 1,
        brand,
        model: text(row[4]) || undefined,
        quantity: toNumber(row[5]) || 1,
        notes: text(row[6]) || undefined
      });
    }
  }

  return { orders, samples };
}

// ----------------------------------------------------------- detail sheets

interface ColumnGroup {
  project?: number;
  bahan?: number;
  model?: number;
  warna?: number;
  size?: number;
  /** Candidate quantity columns, most trustworthy first. */
  qty: number[];
}

interface HeaderMap {
  rowIndex: number;
  groups: ColumnGroup[];
}

const ALIASES = {
  project: ['PROJECT'],
  bahan: ['BAHAN'],
  model: ['MODEL', 'ITEM'],
  warna: ['WARNA'],
  size: ['SIZE'],
  // QUANTITY first; TOTAL and CUTTING only stand in when no real count column
  // exists — in the fabric-planning sheets TOTAL holds "1 1/2 ROLL" and the
  // piece count sits under CUTTING.
  qtyPrimary: ['QUANTITY', 'QUANTTY', 'ORDERAN', 'QTY'],
  qtyFallback: ['TOTAL', 'CUTTING']
} as const;

const matches = (cell: string, list: readonly string[]) => list.some(a => cell === a);

/*
 * Some sheets place two independent tables side by side, repeating the whole
 * header. Each repeat of the leading column starts a new group, so both halves
 * get read instead of only the leftmost.
 */
function readHeaderRow(row: string[]): ColumnGroup[] {
  const cells = row.map(upper);
  const groups: ColumnGroup[] = [];
  let current: ColumnGroup | null = null;

  const startsGroup = (cell: string) =>
    matches(cell, ALIASES.project) || matches(cell, ALIASES.model);

  cells.forEach((cell, index) => {
    if (!cell) return;
    /*
     * Only split when the block in hand is already complete — otherwise
     * "PROJECT | BAHAN | MODEL" would be read as two blocks and the material
     * column would be dropped on the floor.
     */
    if (startsGroup(cell) && current && (current.size !== undefined || current.qty.length > 0)) {
      groups.push(current);
      current = { qty: [] };
    }
    if (!current) current = { qty: [] };

    if (matches(cell, ALIASES.project) && current.project === undefined) current.project = index;
    else if (matches(cell, ALIASES.bahan) && current.bahan === undefined) current.bahan = index;
    else if (matches(cell, ALIASES.model) && current.model === undefined) current.model = index;
    else if (matches(cell, ALIASES.warna) && current.warna === undefined) current.warna = index;
    else if (matches(cell, ALIASES.size) && current.size === undefined) current.size = index;
    else if (matches(cell, ALIASES.qtyPrimary)) current.qty.unshift(index);
    else if (matches(cell, ALIASES.qtyFallback)) current.qty.push(index);
  });

  if (current && (current.size !== undefined || current.qty.length > 0)) groups.push(current);
  return groups.filter(g => g.qty.length > 0 || g.size !== undefined);
}

function findHeader(grid: Grid): HeaderMap | null {
  for (let i = 0; i < Math.min(grid.length, 12); i++) {
    const groups = readHeaderRow(grid[i]);
    // A usable block needs something to count and something to name.
    const usable = groups.filter(g => g.qty.length > 0 && (g.model !== undefined || g.project !== undefined || g.size !== undefined));
    if (usable.length > 0) return { rowIndex: i, groups: usable };
  }
  return null;
}

/** First quantity column on this row that actually holds a number. */
function readQty(row: string[], group: ColumnGroup): number {
  for (const index of group.qty) {
    const raw = text(row[index]);
    if (!raw) continue;
    // "1 1/2 ROLL" is a fabric amount, not a piece count.
    if (/[A-Za-z]/.test(raw)) continue;
    const value = toNumber(raw);
    if (value > 0) return value;
  }
  return 0;
}

/*
 * Blocks are separated by merged cells: PROJECT/BAHAN/MODEL/WARNA are written
 * once and left blank down the rows below, so each value carries forward until
 * a new one appears. A TOTAL line closes a block.
 *
 * Sheets without a SIZE column list one line per colour or per item instead;
 * those become products with a quantity and no size breakdown.
 */
function parseGroup(grid: Grid, header: HeaderMap, group: ColumnGroup): ImportProduct[] {
  const products: ImportProduct[] = [];
  let current: ImportProduct | null = null;
  const carry = { model: '', material: '', color: '' };

  for (let i = header.rowIndex + 1; i < grid.length; i++) {
    const row = grid[i];
    if (!rowHasText(row)) continue;

    const firstCell = upper(row[0]);
    const secondCell = upper(row[1]);
    if (firstCell === 'TOTAL' || secondCell === 'TOTAL') {
      current = null;
      continue;
    }
    if (group.size !== undefined && upper(row[group.size]) === 'SIZE') {
      current = null;
      continue;
    }
    if (group.model !== undefined && matches(upper(row[group.model]), ALIASES.model)) {
      current = null;
      continue;
    }

    const model = group.model !== undefined ? text(row[group.model]) : '';
    const material = group.bahan !== undefined ? text(row[group.bahan]) : '';
    const color = group.warna !== undefined ? text(row[group.warna]) : '';
    if (model) carry.model = model;
    if (material) carry.material = material;
    if (color) carry.color = color;

    const size = group.size !== undefined ? text(row[group.size]) : '';
    const qty = readQty(row, group);
    if (!qty) continue;

    if (group.size !== undefined) {
      // One product per model; sizes accumulate beneath it.
      if (!current || (model && current.model !== carry.model)) {
        current = {
          model: carry.model || text(row[group.project ?? -1]) || 'Produk',
          material: carry.material || undefined,
          color: carry.color || undefined,
          sizes: [],
          quantity: 0
        };
        products.push(current);
      }
      // A colour change inside a sized block is a separate line of the chart.
      const label = color && color !== current.color ? `${size} (${color})` : size;
      current.sizes.push({ size: label || size, qty });
      current.quantity += qty;
    } else {
      // No size column: each row stands on its own.
      products.push({
        model: carry.model || 'Produk',
        material: carry.material || undefined,
        color: carry.color || undefined,
        sizes: [],
        quantity: qty
      });
      current = null;
    }
  }

  return products.filter(p => p.quantity > 0);
}

function parseDetailSheet(grid: Grid): ImportProduct[] {
  const header = findHeader(grid);
  if (!header) return [];
  return header.groups.flatMap(group => parseGroup(grid, header, group));
}

// ------------------------------------------------------------------ plan

export function buildImportPlan(wb: XLSX.WorkBook, monthLabel = ''): ImportPlan {
  const registerName = findRegisterSheet(wb);
  const skipped: SkippedSheet[] = [];

  if (!registerName) {
    return {
      monthLabel,
      orders: [],
      samples: [],
      skipped: wb.SheetNames.map(s => ({ sheet: s, reason: 'Sheet antrian tidak ditemukan di berkas ini.' })),
      matchedSheets: [],
      totalQuantity: 0,
      needsReview: 0
    };
  }

  const { orders, samples } = parseRegister(sheetGrid(wb, registerName));
  const matchedSheets: string[] = [];

  for (const name of wb.SheetNames) {
    if (name === registerName) continue;

    const grid = sheetGrid(wb, name);
    if (!grid.some(rowHasText)) {
      skipped.push({ sheet: name, reason: 'Sheet kosong.' });
      continue;
    }

    const products = parseDetailSheet(grid);
    if (products.length === 0) {
      skipped.push({
        sheet: name,
        reason: 'Bentuk sheet tidak dikenali (bukan rincian ukuran) — perlu input manual.'
      });
      continue;
    }

    /*
     * Attach to the queue line whose brand contains the sheet name, or vice
     * versa. Several sheets share a stem — three ALINA sheets, and both a
     * "JAKET ARKATO" and a "KAOS ARAKTO" line — so when more than one candidate
     * fits, the one whose quantity equals this sheet's total wins. Failing
     * that, the first line not already claimed by another sheet.
     */
    const key = normaliseName(name);
    const detailTotalForMatch = products.reduce((sum, p) => sum + p.quantity, 0);
    const candidates = orders.filter(o => {
      const brand = normaliseName(o.brand);
      return key.length >= 3 && (brand.includes(key) || key.includes(brand));
    });
    const order =
      candidates.find(o => o.quantity === detailTotalForMatch) ||
      candidates.find(o => !o.detailSheet) ||
      candidates[0];

    if (!order) {
      skipped.push({ sheet: name, reason: 'Tidak ada baris antrian yang cocok dengan nama sheet ini.' });
      continue;
    }

    const detailTotal = products.reduce((sum, p) => sum + p.quantity, 0);
    order.detailSheet = name;
    order.products = products;
    order.detailTotal = detailTotal;
    if (order.quantity > 0 && detailTotal !== order.quantity) {
      order.detailWarning =
        `Rincian di sheet berjumlah ${detailTotal} pcs, sementara antrian mencatat ${order.quantity} pcs. ` +
        'Jumlah pesanan memakai angka antrian; rincian ukuran perlu diperiksa sebelum dipakai.';
    }
    matchedSheets.push(name);
  }

  return {
    monthLabel,
    orders,
    samples,
    skipped,
    matchedSheets,
    totalQuantity: orders.reduce((sum, o) => sum + o.quantity, 0),
    needsReview: orders.filter(o => o.detailWarning).length
  };
}

export function parseWorkbookData(data: ArrayBuffer, monthLabel = ''): ImportPlan {
  const wb = XLSX.read(data, { type: 'array', cellDates: true });
  return buildImportPlan(wb, monthLabel);
}

/** "S: 4, M: 21, L: 27" — the shape the order form already stores. */
export function serialiseSizes(sizes: ImportSizeRow[]): string {
  return sizes.map(s => `${s.size}: ${s.qty}`).join(', ');
}
