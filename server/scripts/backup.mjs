/*
 * Salin basis data dan seluruh unggahan ke folder bertanggal.
 *
 *   node server/scripts/backup.mjs                 → backups/2026-09-24_2015/
 *   node server/scripts/backup.mjs D:\backup-hij   → folder itu
 *
 * Aman dijalankan saat aplikasi hidup: salinannya dibuat lewat VACUUM INTO,
 * yang menghasilkan satu berkas utuh pada satu titik waktu — bukan menyalin
 * berkas yang sedang ditulis. Jadwalkan tiap malam (Task Scheduler di Windows,
 * cron di Linux) dan simpan hasilnya di mesin lain.
 */
import fs from 'fs';
import path from 'path';
import { openStore } from './lib/table-store.mjs';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
const root = path.resolve(process.argv[2] || path.join(process.cwd(), 'backups'));

const stamp = new Date();
const pad = n => String(n).padStart(2, '0');
const name = `${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())}_${pad(stamp.getHours())}${pad(stamp.getMinutes())}`;
const target = path.join(root, name);

let store;
try {
  store = openStore(undefined, { readonly: true });
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

fs.mkdirSync(target, { recursive: true });
const dbCopy = path.join(target, 'hij.db');
const size = store.copyTo(dbCopy);
const tables = store.listTables();
const rows = tables.reduce((sum, table) => sum + store.count(table), 0);
store.close();

let files = 0;
if (fs.existsSync(UPLOADS_DIR)) {
  fs.cpSync(UPLOADS_DIR, path.join(target, 'uploads'), { recursive: true });
  files = fs.readdirSync(UPLOADS_DIR).length;
}

console.log(`Backup selesai: ${target}`);
console.log(`  hij.db ${(size / 1024).toFixed(0)} KB — ${tables.length} tabel, ${rows} baris`);
console.log(`  ${files} berkas unggahan`);
console.log('Pulihkan dengan menyalin hij.db ke DATA_DIR saat aplikasi berhenti.');
