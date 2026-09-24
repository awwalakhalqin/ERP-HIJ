import type { SizeChart, SizeChartMeasurement, SizeChartRow } from '../types';

/*
 * HIJ's published size charts, transcribed from the artwork in
 * public/templates/size chart/. Shared by the server, which inserts any that
 * are missing at boot, and by the size chart form, which starts every new
 * chart from one of these — same columns, same codes as the printed chart.
 *
 * Chest is printed as width over circumference ("50/100"), so it stays one
 * stored value; the form edits the two halves separately.
 */

const IMAGE_DIR = '/templates/size chart';

export const SIZE_CHART_COMMON_NOTES =
  'Pengukuran dalam centimeter (cm). Pada proses penjahitan dimungkinkan ada perbedaan 1–2 cm dari size chart.';

const LD: SizeChartMeasurement = { key: 'ld', label: 'Lebar / Lingkar Dada', code: 'LD' };
const PB: SizeChartMeasurement = { key: 'pb', label: 'Panjang Badan', code: 'PB' };
const PL: SizeChartMeasurement = { key: 'pl', label: 'Panjang Lengan', code: 'PL' };
const LP: SizeChartMeasurement = { key: 'lp', label: 'Lengan Pendek', code: 'LP' };
const BAHU: SizeChartMeasurement = { key: 'bahu', label: 'Bahu', code: 'B' };

const row = (size: string, values: Record<string, string>): SizeChartRow => ({ size, values });

export type StandardSizeChart = Omit<SizeChart, 'scope' | 'user' | 'timestamp'> & {
  referenceImage: string;
};

export const STANDARD_SIZE_CHARTS: StandardSizeChart[] = [
  {
    id: 'SZC-STD-JERSEY',
    name: 'Jersey',
    garment: 'Jersey',
    measurements: [LD, PB, PL, LP],
    rows: [
      row('S', { ld: '50/100', pb: '68', pl: '58', lp: '22' }),
      row('M', { ld: '52/104', pb: '70', pl: '60', lp: '24' }),
      row('L', { ld: '54/108', pb: '72', pl: '62', lp: '25' }),
      row('XL', { ld: '57/114', pb: '74', pl: '64', lp: '26' }),
      row('2XL', { ld: '60/120', pb: '76', pl: '66', lp: '27' }),
      row('3XL', { ld: '63/126', pb: '78', pl: '68', lp: '28' })
    ],
    referenceImage: `${IMAGE_DIR}/WhatsApp Image 2026-09-21 at 13.38.27.jpeg`
  },
  {
    id: 'SZC-STD-KEMEJA',
    name: 'Kemeja',
    garment: 'Kemeja',
    measurements: [LD, PB, PL, LP],
    rows: [
      row('XS', { ld: '47/94', pb: '66', pl: '55', lp: '21' }),
      row('S', { ld: '49/98', pb: '68', pl: '57', lp: '22' }),
      row('M', { ld: '52/104', pb: '72', pl: '57', lp: '23' }),
      row('L', { ld: '55/110', pb: '74', pl: '60', lp: '25' }),
      row('XL', { ld: '58/116', pb: '74', pl: '62', lp: '26' }),
      row('2XL', { ld: '61/122', pb: '78', pl: '62', lp: '27' })
    ],
    referenceImage: `${IMAGE_DIR}/WhatsApp Image 2026-09-21 at 13.38.27 (2).jpeg`
  },
  {
    id: 'SZC-STD-KAOS-DEWASA',
    name: 'Kaos Polos — Dewasa',
    garment: 'Kaos',
    measurements: [LD, PB],
    rows: [
      row('XS', { ld: '46/92', pb: '66' }),
      row('S', { ld: '49/98', pb: '69' }),
      row('M', { ld: '52/104', pb: '71' }),
      row('L', { ld: '55/110', pb: '73' }),
      row('XL', { ld: '58/116', pb: '77' }),
      row('2XL', { ld: '61/122', pb: '82' }),
      row('3XL', { ld: '64/128', pb: '84' }),
      row('4XL', { ld: '68/136', pb: '85' }),
      row('5XL', { ld: '72/144', pb: '86' })
    ],
    referenceImage: `${IMAGE_DIR}/WhatsApp Image 2026-09-21 at 13.38.27 (3).jpeg`
  },
  {
    id: 'SZC-STD-KAOS-ANAK',
    name: 'Kaos Polos — Anak',
    garment: 'Kaos',
    measurements: [{ key: 'ld', label: 'Lebar Dada', code: 'LD' }, PB],
    rows: [
      row('XS', { ld: '30/60', pb: '42' }),
      row('S', { ld: '33/66', pb: '45' }),
      row('M', { ld: '36/72', pb: '52' }),
      row('L', { ld: '39/78', pb: '55' }),
      row('XL', { ld: '42/84', pb: '60' })
    ],
    referenceImage: `${IMAGE_DIR}/WhatsApp Image 2026-09-21 at 13.38.27 (3).jpeg`
  },
  {
    id: 'SZC-STD-ROMPI',
    name: 'Rompi',
    garment: 'Rompi',
    measurements: [LD, { key: 'pr', label: 'Panjang Rompi', code: 'PR' }, BAHU],
    rows: [
      row('S', { ld: '50/100', pr: '66', bahu: '41' }),
      row('M', { ld: '53/106', pr: '68', bahu: '43' }),
      row('L', { ld: '56/112', pr: '70', bahu: '45' }),
      row('XL', { ld: '60/120', pr: '73', bahu: '48' }),
      row('2XL', { ld: '63/126', pr: '75', bahu: '50' }),
      row('3XL', { ld: '66/132', pr: '75', bahu: '52' }),
      row('4XL', { ld: '68/136', pr: '75', bahu: '54' })
    ],
    referenceImage: `${IMAGE_DIR}/WhatsApp Image 2026-09-21 at 13.38.27 (1).jpeg`
  },
  {
    id: 'SZC-STD-JAKET',
    name: 'Jaket',
    garment: 'Jaket',
    measurements: [LD, { key: 'pj', label: 'Panjang Jaket', code: 'PR' }, BAHU],
    rows: [
      row('S', { ld: '50/100', pj: '66', bahu: '41' }),
      row('M', { ld: '53/106', pj: '68', bahu: '43' }),
      row('L', { ld: '56/112', pj: '70', bahu: '45' }),
      row('XL', { ld: '60/120', pj: '73', bahu: '48' }),
      row('2XL', { ld: '63/126', pj: '75', bahu: '50' }),
      row('3XL', { ld: '66/132', pj: '75', bahu: '52' }),
      row('4XL', { ld: '68/136', pj: '75', bahu: '54' })
    ],
    // Flagged rather than silently corrected: the artwork's own column header
    // reads "Panjang Rompi" and its numbers match the vest chart exactly.
    notes:
      `${SIZE_CHART_COMMON_NOTES} CATATAN: pada gambar acuan, kolom panjang tertulis "Panjang Rompi" ` +
      'dan angkanya sama persis dengan size chart Rompi. Mohon dicek apakah ini memang ' +
      'ukuran jaket atau salah tempel di desain aslinya.',
    referenceImage: `${IMAGE_DIR}/WhatsApp Image 2026-09-21 at 13.38.27 (4).jpeg`
  }
];

/** The chest column holds "lebar/lingkar" and is edited as two numbers. */
export const isChestMeasurement = (m: SizeChartMeasurement) => m.key === 'ld';

export function splitChest(value?: string): [string, string] {
  const [width = '', around = ''] = String(value || '').split('/').map(s => s.trim());
  return [width, around];
}

export function joinChest(width: string, around: string): string {
  const w = width.trim();
  const a = around.trim();
  if (!w && !a) return '';
  return `${w}/${a}`;
}

/** The template a chart was built from, for its reference image and column codes. */
export function templateFor(chart: Pick<SizeChart, 'id' | 'garment' | 'name'> & { basedOn?: string }) {
  return (
    STANDARD_SIZE_CHARTS.find(t => t.id === chart.id || t.id === chart.basedOn) ||
    STANDARD_SIZE_CHARTS.find(t => t.name === chart.name) ||
    STANDARD_SIZE_CHARTS.find(t => t.garment === chart.garment) ||
    null
  );
}
