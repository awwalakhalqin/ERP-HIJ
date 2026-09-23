/*
 * The factory's published size charts, transcribed from the artwork in
 * public/templates/size chart/.
 *
 * These are HIJ's own standard. Charts belonging to a particular client are
 * added through the app and carry scope 'customer', so reseeding the standards
 * never disturbs them.
 *
 *   node server/scripts/seed-size-charts.mjs
 *   node server/scripts/seed-size-charts.mjs --data-dir server/data-test
 *
 * Run with the server stopped; it caches tables in memory.
 */
import fs from 'fs';
import path from 'path';
import { openStore } from './lib/table-store.mjs';

const argIndex = process.argv.indexOf('--data-dir');
const DATA_DIR = path.resolve(
  process.cwd(),
  argIndex !== -1 ? process.argv[argIndex + 1] : path.join('server', 'data')
);

const IMAGE_DIR = '/templates/size chart';
const COMMON_NOTES =
  'Pengukuran dalam centimeter (cm). Pada proses penjahitan dimungkinkan ada perbedaan 1–2 cm dari size chart.';

/** Chest is printed as width over circumference, so it is kept as one value. */
const LD = { key: 'ld', label: 'Lebar / Lingkar Dada', code: 'LD' };
const PB = { key: 'pb', label: 'Panjang Badan', code: 'PB' };
const PL = { key: 'pl', label: 'Panjang Lengan', code: 'PL' };
const LP = { key: 'lp', label: 'Lengan Pendek', code: 'LP' };
const BAHU = { key: 'bahu', label: 'Bahu', code: 'B' };

const row = (size, values) => ({ size, values });

const STANDARD_CHARTS = [
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
      `${COMMON_NOTES} CATATAN: pada gambar acuan, kolom panjang tertulis "Panjang Rompi" ` +
      'dan angkanya sama persis dengan size chart Rompi. Mohon dicek apakah ini memang ' +
      'ukuran jaket atau salah tempel di desain aslinya.',
    referenceImage: `${IMAGE_DIR}/WhatsApp Image 2026-09-21 at 13.38.27 (4).jpeg`
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
  }
];

if (!fs.existsSync(DATA_DIR)) {
  console.error(`Folder data tidak ditemukan: ${DATA_DIR}`);
  process.exit(1);
}

const store = openStore(DATA_DIR);
const existing = store.read('size_charts');

// Charts a client owns are never touched by reseeding the factory's own.
const customerCharts = existing.filter(c => c.scope === 'customer');
const now = new Date().toISOString();

const seeded = STANDARD_CHARTS.map(chart => ({
  ...chart,
  scope: 'standard',
  notes: chart.notes || COMMON_NOTES,
  user: 'System',
  timestamp: now
}));

const merged = [...seeded, ...customerCharts];
store.write('size_charts', merged);
store.close();

console.log(`Size chart standar HIJ: ${seeded.length} tersimpan.`);
for (const c of seeded) {
  console.log(`  - ${c.name.padEnd(22)} ${c.rows.length} ukuran, ${c.measurements.length} kolom`);
}
if (customerCharts.length) {
  console.log(`Size chart khusus pelanggan: ${customerCharts.length} dipertahankan.`);
}
console.log(`\nDitulis ke ${path.relative(process.cwd(), FILE).split(path.sep).join('/')}`);
