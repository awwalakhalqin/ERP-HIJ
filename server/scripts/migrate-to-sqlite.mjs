#!/usr/bin/env node
/*
 * Memindahkan tabel JSON ke satu berkas SQLite (hij.db).
 *
 * Dijalankan sekali per dataset, saat aplikasi berhenti:
 *
 *   node server/scripts/migrate-to-sqlite.mjs                  (server/data)
 *   node server/scripts/migrate-to-sqlite.mjs --data-dir server/data-test
 *   DATA_DIR=/home/user/hij-data node server/scripts/migrate-to-sqlite.mjs
 *
 * Berkas JSON tidak dihapus — disalin ke json-backup-<waktu>/ lalu ditinggal
 * apa adanya, supaya Anda bisa kembali kapan saja hanya dengan menghapus
 * hij.db. Skrip ini sengaja tidak mengimpor server/src/db.ts: modul itu
 * membuat akun admin pertama saat dimuat, dan itu akan berjalan sebelum
 * tabel users sempat dipindahkan.
 */
import fs from 'fs';
import path from 'path';
import sqlite from 'node-sqlite3-wasm';

const { Database } = sqlite; // paket CommonJS: named import tidak tersedia

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1] ?? true;
};
const force = args.includes('--force');

const DATA_DIR = path.resolve(process.cwd(), flag('--data-dir') || process.env.DATA_DIR || 'server/data');
const DB_PATH = path.join(DATA_DIR, 'hij.db');

if (!fs.existsSync(DATA_DIR)) {
  console.error(`Folder data tidak ada: ${DATA_DIR}`);
  process.exit(1);
}

const jsonFiles = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json')).sort();
if (jsonFiles.length === 0) {
  console.error(`Tidak ada berkas .json di ${DATA_DIR}. Tidak ada yang dipindahkan.`);
  process.exit(1);
}

console.log(`\nSumber : ${DATA_DIR} (${jsonFiles.length} tabel JSON)`);
console.log(`Tujuan : ${DB_PATH}\n`);

const db = new Database(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');

// Berkas yang sudah berisi data tidak ditimpa tanpa diminta.
const existing = db.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
const filled = existing.filter(t => db.get(`SELECT COUNT(*) AS c FROM "${t.name}"`).c > 0);
if (filled.length > 0 && !force) {
  console.error(`hij.db sudah berisi ${filled.length} tabel terisi (mis. ${filled[0].name}).`);
  console.error('Jalankan lagi dengan --force kalau memang mau menimpanya.\n');
  db.close();
  process.exit(1);
}

// Salinan pengaman sebelum menyentuh apa pun.
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backupDir = path.join(DATA_DIR, `json-backup-${stamp}`);
fs.mkdirSync(backupDir, { recursive: true });
for (const file of jsonFiles) fs.copyFileSync(path.join(DATA_DIR, file), path.join(backupDir, file));
console.log(`Salinan JSON  : ${backupDir}\n`);

const report = [];
let problems = 0;

db.exec('BEGIN');
try {
  for (const file of jsonFiles) {
    const table = file.replace(/\.json$/, '').toLowerCase().replace(/[^a-z0-9_]/g, '');
    const raw = fs.readFileSync(path.join(DATA_DIR, file), 'utf-8');

    let rows;
    try {
      rows = JSON.parse(raw);
    } catch (err) {
      throw new Error(`${file} bukan JSON yang sah: ${err.message}`);
    }
    if (!Array.isArray(rows)) {
      report.push({ table, rows: 0, note: 'dilewati (bukan array)' });
      continue;
    }

    db.exec(`CREATE TABLE IF NOT EXISTS "${table}" (id TEXT PRIMARY KEY, pos REAL NOT NULL, data TEXT NOT NULL)`);
    db.exec(`CREATE INDEX IF NOT EXISTS "${table}_pos" ON "${table}" (pos)`);
    db.run(`DELETE FROM "${table}"`);

    const seen = new Map();
    let generated = 0;
    let duplicates = 0;
    const insert = db.prepare(`INSERT INTO "${table}" (id, pos, data) VALUES (?, ?, ?)`);
    try {
      rows.forEach((row, index) => {
        let id = row?.id === undefined || row?.id === null || row?.id === '' ? '' : String(row.id);
        if (!id) {
          id = `${table.toUpperCase()}-MIGRASI-${index + 1}`;
          generated += 1;
        }
        // Id kembar tidak bisa jadi kunci utama; yang kedua diberi akhiran agar
        // barisnya tetap terbawa, bukan hilang diam-diam.
        const key = id.toLowerCase();
        if (seen.has(key)) {
          duplicates += 1;
          id = `${id}-DUP${seen.get(key) + 1}`;
          seen.set(key, seen.get(key) + 1);
        } else {
          seen.set(key, 0);
        }
        insert.run([id, index, JSON.stringify({ ...row, id })]);
      });
    } finally {
      insert.finalize();
    }

    const notes = [];
    if (generated) notes.push(`${generated} tanpa id`);
    if (duplicates) notes.push(`${duplicates} id kembar`);
    if (notes.length) problems += 1;
    report.push({ table, rows: rows.length, note: notes.join(', ') });
  }
  db.exec('COMMIT');
} catch (err) {
  db.exec('ROLLBACK');
  console.error(`\nGAGAL: ${err.message}`);
  console.error('Tidak ada yang tertulis; berkas JSON Anda tidak tersentuh.\n');
  db.close();
  process.exit(1);
}

// Verifikasi: baca balik dari SQLite dan bandingkan dengan JSON sumbernya.
let mismatches = 0;
for (const entry of report) {
  if (entry.note === 'dilewati (bukan array)') continue;
  const back = db.all(`SELECT data FROM "${entry.table}" ORDER BY pos ASC`).map(r => JSON.parse(r.data));
  const source = JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${entry.table}.json`), 'utf-8'));
  if (back.length !== source.length) {
    console.error(`  BEDA JUMLAH ${entry.table}: JSON ${source.length} vs SQLite ${back.length}`);
    mismatches += 1;
    continue;
  }
  // Urutan dan isi tiap baris harus sama persis, kecuali id yang sengaja dibetulkan.
  for (let i = 0; i < source.length; i += 1) {
    const a = { ...source[i] };
    const b = { ...back[i] };
    delete a.id;
    delete b.id;
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      console.error(`  BEDA ISI ${entry.table} baris ${i + 1}`);
      mismatches += 1;
      break;
    }
  }
}

db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
const size = fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).size : 0;
db.close();

console.log('tabel                 baris  catatan');
for (const entry of report.sort((a, b) => b.rows - a.rows)) {
  console.log(`  ${entry.table.padEnd(22)}${String(entry.rows).padStart(5)}  ${entry.note || ''}`);
}
const total = report.reduce((sum, entry) => sum + entry.rows, 0);
console.log(`\n${report.length} tabel, ${total} baris  ->  hij.db ${(size / 1024).toFixed(0)} KB`);

if (mismatches > 0) {
  console.error(`\n${mismatches} ketidakcocokan saat verifikasi. Jangan pakai hasil ini; laporkan.\n`);
  process.exit(1);
}
console.log('Verifikasi: isi SQLite sama persis dengan JSON sumbernya.');
if (problems > 0) console.log('Ada catatan id di atas — periksa tabel yang ditandai.');
console.log('\nSelesai. Jalankan aplikasi seperti biasa; berkas JSON lama boleh ditinggal sebagai cadangan.\n');
