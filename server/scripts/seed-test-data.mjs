/*
 * Prepare the test dataset in server/data-test/.
 *
 * The test server reads that folder instead of server/data/, so anything typed
 * while testing — orders, SPKs, QC reports — stays out of the real tables.
 *
 *   node server/scripts/seed-test-data.mjs           salin dari data produksi
 *   node server/scripts/seed-test-data.mjs --empty   mulai dari nol
 *
 * Run with the test server stopped; it caches tables in memory and would write
 * its stale copy back over the fresh seed.
 */
import fs from 'fs';
import path from 'path';

const SOURCE = path.join(process.cwd(), 'server', 'data');
const TARGET = path.join(process.cwd(), 'server', 'data-test');
const empty = process.argv.includes('--empty');

if (!fs.existsSync(SOURCE)) {
  console.error(`Folder data produksi tidak ditemukan: ${SOURCE}`);
  console.error('Jalankan perintah ini dari folder Apps-HIJ.');
  process.exit(1);
}

// Replacing wholesale keeps a previous test run from leaving stray tables behind.
if (fs.existsSync(TARGET)) fs.rmSync(TARGET, { recursive: true, force: true });
fs.mkdirSync(TARGET, { recursive: true });

const files = fs.readdirSync(SOURCE).filter(f => f.endsWith('.json'));
let copied = 0;

for (const file of files) {
  if (empty) {
    fs.writeFileSync(path.join(TARGET, file), '[]', 'utf-8');
  } else {
    fs.copyFileSync(path.join(SOURCE, file), path.join(TARGET, file));
  }
  copied++;
}

/*
 * A marker the app can point at, and a reminder for anyone who opens the folder
 * wondering which of the two datasets they are looking at.
 */
fs.writeFileSync(
  path.join(TARGET, 'README.txt'),
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

console.log(`Dataset uji disiapkan di server/data-test/ (${copied} tabel).`);
console.log(
  empty
    ? 'Semua tabel dikosongkan. Admin pertama dibuat otomatis saat server uji dinyalakan — kata sandinya tampil sekali di log.'
    : 'Disalin dari data produksi, termasuk akun dan kata sandinya — jadi bisa langsung login dengan kredensial yang sama.'
);
console.log('');
console.log('Jalankan:  npm run dev:test');
