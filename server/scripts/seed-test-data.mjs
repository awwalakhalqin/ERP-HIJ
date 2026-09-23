/*
 * Prepare the test dataset in server/data-test/.
 *
 * The test server reads that folder instead of server/data/, so anything typed
 * while testing — orders, SPKs, QC reports — stays out of the real tables.
 *
 *   node server/scripts/seed-test-data.mjs           salin dari data produksi
 *   node server/scripts/seed-test-data.mjs --empty   mulai dari nol
 *
 * Run with the test server stopped; it keeps tables open and would hold on to
 * the copy it replaced.
 */
import fs from 'fs';
import path from 'path';
import { openStore } from './lib/table-store.mjs';

const SOURCE_DIR = path.join(process.cwd(), 'server', 'data');
const TARGET_DIR = path.join(process.cwd(), 'server', 'data-test');
const SOURCE_DB = path.join(SOURCE_DIR, 'hij.db');
const TARGET_DB = path.join(TARGET_DIR, 'hij.db');
const empty = process.argv.includes('--empty');

if (!empty && !fs.existsSync(SOURCE_DB)) {
  console.error(`Basis data produksi tidak ditemukan: ${SOURCE_DB}`);
  console.error('Jalankan dulu:  node server/scripts/migrate-to-sqlite.mjs');
  console.error('Atau mulai dari nol:  node server/scripts/seed-test-data.mjs --empty');
  process.exit(1);
}

// Replacing wholesale keeps a previous test run from leaving stray tables behind.
if (fs.existsSync(TARGET_DIR)) fs.rmSync(TARGET_DIR, { recursive: true, force: true });
fs.mkdirSync(TARGET_DIR, { recursive: true });

let tables = 0;
let rows = 0;

if (empty) {
  // Tabel dibuat kosong dengan nama yang sama seperti produksi, supaya struktur
  // yang dilihat saat uji coba sama persis.
  const names = fs.existsSync(SOURCE_DB)
    ? (() => {
        const source = openStore(SOURCE_DIR, { readonly: true });
        const list = source.listTables();
        source.close();
        return list;
      })()
    : [];
  const target = openStore(TARGET_DIR);
  for (const name of names) {
    target.write(name, []);
    tables += 1;
  }
  target.close();
} else {
  const source = openStore(SOURCE_DIR, { readonly: true });
  const size = source.copyTo(TARGET_DB);
  tables = source.listTables().length;
  rows = source.listTables().reduce((sum, name) => sum + source.count(name), 0);
  source.close();
  console.log(`Disalin: hij.db ${(size / 1024).toFixed(0)} KB`);
}

/*
 * A marker the app can point at, and a reminder for anyone who opens the folder
 * wondering which of the two datasets they are looking at.
 */
fs.writeFileSync(
  path.join(TARGET_DIR, 'README.txt'),
  [
    'Dataset UJI COBA — bukan data produksi.',
    '',
    'Folder ini dibaca oleh `npm run dev:test` (API di port 3002).',
    'Data produksi ada di server/data/ dan tidak tersentuh dari sini.',
    '',
    'Isi ulang kapan saja:',
    '  node server/scripts/seed-test-data.mjs          (salin ulang dari produksi)',
    '  node server/scripts/seed-test-data.mjs --empty  (kosongkan semua tabel)',
    '',
    'Jangan pernah mengunggah folder ini ke hosting.'
  ].join('\n'),
  'utf-8'
);

console.log(`Dataset uji disiapkan di server/data-test/ (${tables} tabel${rows ? `, ${rows} baris` : ''}).`);
console.log(
  empty
    ? 'Semua tabel dikosongkan. Admin pertama dibuat otomatis saat server uji dinyalakan — kata sandinya tampil sekali di log.'
    : 'Disalin dari data produksi, termasuk akun dan kata sandinya — jadi bisa langsung login dengan kredensial yang sama.'
);
console.log('');
console.log('Jalankan:  npm run dev:test');
