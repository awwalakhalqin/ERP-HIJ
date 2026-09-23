/*
 * Copy every data table and every upload into a dated folder.
 *
 *   node server/scripts/backup.mjs                 → backups/2026-09-22_2015/
 *   node server/scripts/backup.mjs D:\backup-hij   → that folder instead
 *
 * The API caches tables in memory and writes them out within a fraction of a
 * second, so this can run while the server is up. Schedule it nightly (Task
 * Scheduler on Windows, cron elsewhere) and keep the folder off this machine.
 */
import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.cwd(), process.env.DATA_DIR)
  : path.join(process.cwd(), 'server', 'data');
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
const root = path.resolve(process.argv[2] || path.join(process.cwd(), 'backups'));

const stamp = new Date();
const pad = n => String(n).padStart(2, '0');
const name = `${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())}_${pad(stamp.getHours())}${pad(stamp.getMinutes())}`;
const target = path.join(root, name);

fs.mkdirSync(path.join(target, 'data'), { recursive: true });
let tables = 0;
for (const file of fs.readdirSync(DATA_DIR)) {
  if (!file.endsWith('.json')) continue;
  fs.copyFileSync(path.join(DATA_DIR, file), path.join(target, 'data', file));
  tables++;
}
let files = 0;
if (fs.existsSync(UPLOADS_DIR)) {
  fs.cpSync(UPLOADS_DIR, path.join(target, 'uploads'), { recursive: true });
  files = fs.readdirSync(UPLOADS_DIR).length;
}

console.log(`Backup selesai: ${target}`);
console.log(`  ${tables} tabel dari ${DATA_DIR}`);
console.log(`  ${files} berkas unggahan`);
console.log('Pulihkan dengan menyalin isi folder data/ ke DATA_DIR saat server berhenti.');
