import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
// Paket ini CommonJS: hanya default import yang bekerja saat bundel ESM
// dijalankan Node. Named import gagal dengan "Named export not found".
import sqlite from 'node-sqlite3-wasm';

const { Database } = sqlite;

/*
 * Penyimpanan: satu berkas SQLite, bukan 30 berkas JSON.
 *
 * Sebelumnya tiap simpan menulis ulang seluruh tabel ke disk lewat debounce
 * 100 ms, dan satu request yang menyentuh beberapa tabel bisa berhenti di
 * tengah — faktur tercatat, pesanan tidak. Tabel-tabel itu memegang uang
 * pelanggan, jadi keutuhannya lebih penting daripada kesederhanaan berkas.
 *
 * Yang berubah hanya berkas ini. Bentuk datanya tetap sama (satu baris = satu
 * objek JSON bebas-skema), API-nya tetap sama, jadi index.ts dan seluruh modul
 * tidak perlu tahu.
 *
 * Driver: node-sqlite3-wasm (SQLite dikompilasi ke WebAssembly). Driver native
 * yang lazim, better-sqlite3, butuh compiler saat install — di hosting tanpa
 * `make` pemasangannya gagal, dan aplikasi ini harus bisa dipasang di sana.
 */

export const HIJ_MODE = process.env.HIJ_MODE === 'test' ? 'test' : 'production';

export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.cwd(), process.env.DATA_DIR)
  : path.join(process.cwd(), 'server', 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export const DB_PATH = path.join(DATA_DIR, 'hij.db');

const db = new Database(DB_PATH);
/*
 * WAL: penulis tidak memblokir pembaca, dan crash di tengah transaksi
 * dibatalkan sendiri saat berkas dibuka lagi. NORMAL cukup di bawah WAL —
 * commit tetap tahan crash aplikasi, yang berisiko hanya mati listrik mendadak.
 */
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA synchronous = NORMAL');
db.exec('PRAGMA busy_timeout = 5000');

/** Tabel yang sudah dipastikan ada di berkas ini. */
const ensured = new Set<string>();

/*
 * Cache baris per tabel. readTable() dipanggil berkali-kali dalam satu request
 * (index.ts memfilter di JS), jadi membaca ulang dari disk tiap kali akan jauh
 * lebih lambat daripada versi JSON. Cache memegang array yang sama yang
 * dikembalikan ke pemanggil, sehingga referensinya tetap hidup seperti dulu.
 */
const cache: Record<string, any[]> = {};

function safeName(tableName: string): string {
  return tableName.toLowerCase().replace(/[^a-z0-9_]/g, '');
}

function ensureTable(tableName: string): string {
  const table = safeName(tableName);
  if (ensured.has(table)) return table;
  db.exec(`CREATE TABLE IF NOT EXISTS "${table}" (id TEXT PRIMARY KEY, pos REAL NOT NULL, data TEXT NOT NULL)`);
  db.exec(`CREATE INDEX IF NOT EXISTS "${table}_pos" ON "${table}" (pos)`);
  ensured.add(table);
  return table;
}

/*
 * Pindah otomatis dari JSON saat pertama kali jalan.
 *
 * Sebelum ini, membuka aplikasi di folder yang masih berisi berkas JSON akan
 * membuat hij.db kosong dan berkas lamanya diabaikan diam-diam: seluruh
 * pelanggan dan pesanan seolah lenyap, lalu akun admin baru dibuat dengan kata
 * sandi baru. Yang menjalankannya tidak melihat pesan galat apa pun — kerugian
 * paling mahal justru yang tidak bersuara. Skrip migrate-to-sqlite.mjs tetap
 * ada untuk migrasi yang disengaja (ia menyalin cadangan dan memverifikasi
 * ulang); bagian ini jaring pengaman kalau skrip itu terlewat.
 *
 * Hanya berjalan saat berkas benar-benar masih kosong, jadi baris yang sengaja
 * dihapus lewat aplikasi tidak pernah hidup lagi di penyalaan berikutnya.
 */
(function importLegacyJson() {
  const tables = db.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'") as any[];
  if (tables.length > 0) return;

  const files = fs.readdirSync(DATA_DIR).filter(f => f.toLowerCase().endsWith('.json'));
  if (files.length === 0) return;

  console.log(`\n  Berkas JSON ditemukan di ${DATA_DIR} dan hij.db masih kosong.`);
  console.log('  Memindahkan isinya sekali ini saja...');

  let imported = 0;
  let rowCount = 0;
  db.exec('BEGIN');
  try {
    for (const file of files) {
      const parsed = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf-8'));
      // Berkas yang bukan array bukan tabel; lewati tanpa menggagalkan sisanya.
      if (!Array.isArray(parsed)) continue;

      const table = ensureTable(file.replace(/\.json$/i, ''));
      const insert = db.prepare(`INSERT OR REPLACE INTO "${table}" (id, pos, data) VALUES (?, ?, ?)`);
      try {
        parsed.forEach((row: any, index: number) => {
          const id = row?.id === undefined || row?.id === null || row?.id === ''
            ? `${table.toUpperCase()}-MIGRASI-${index + 1}`
            : String(row.id);
          insert.run([id, index, JSON.stringify({ ...row, id })]);
        });
      } finally {
        insert.finalize();
      }
      imported += 1;
      rowCount += parsed.length;
    }
    db.exec('COMMIT');
  } catch (err: any) {
    /*
     * Dibatalkan seluruhnya. Berhenti dengan pesan jelas lebih baik daripada
     * menyala dengan data separuh — orang akan menambah catatan baru di atas
     * dataset yang bolong dan itu jauh lebih sulit dibereskan.
     */
    db.exec('ROLLBACK');
    ensured.clear();
    console.error(`\n  GAGAL memindahkan JSON: ${err?.message || err}`);
    console.error('  Tidak ada yang tertulis; berkas JSON Anda tidak tersentuh.');
    console.error('  Perbaiki berkas yang rusak, atau jalankan: node server/scripts/migrate-to-sqlite.mjs\n');
    throw err;
  }

  console.log(`  Selesai: ${imported} tabel, ${rowCount} baris masuk ke hij.db.`);
  console.log('  Berkas JSON dibiarkan apa adanya sebagai cadangan.\n');
})();

/** Daftar tabel yang ada di berkas — dipakai skrip backup dan migrasi. */
export function listTables(): string[] {
  const rows = db.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name") as any[];
  return rows.map(r => String(r.name));
}

export function readTable(tableName: string): any[] {
  const table = ensureTable(tableName);
  if (cache[table]) return cache[table];
  const rows = db.all(`SELECT data FROM "${table}" ORDER BY pos ASC`) as any[];
  cache[table] = rows.map(r => JSON.parse(String(r.data)));
  return cache[table];
}

/**
 * Mengganti seluruh isi tabel. Dipakai jalur impor massal; satu transaksi,
 * jadi tabel tidak pernah terlihat separuh terisi.
 */
export function writeTable(tableName: string, data: any[]) {
  const table = ensureTable(tableName);
  const rows = Array.isArray(data) ? data : [];
  transaction(() => {
    db.run(`DELETE FROM "${table}"`);
    const insert = db.prepare(`INSERT OR REPLACE INTO "${table}" (id, pos, data) VALUES (?, ?, ?)`);
    try {
      rows.forEach((row, index) => {
        const id = row?.id === undefined || row?.id === null || row?.id === '' ? `ID-${Date.now()}-${index}` : String(row.id);
        insert.run([id, index, JSON.stringify({ ...row, id })]);
      });
    } finally {
      insert.finalize();
    }
  });
  cache[table] = rows;
}

/*
 * Transaksi. Satu request HTTP dibungkus satu transaksi oleh index.ts, jadi
 * penulisan ke beberapa tabel dalam satu aksi selesai semua atau tidak sama
 * sekali. Hitungan kedalaman membuat transaksi bersarang aman: hanya lapisan
 * terluar yang benar-benar BEGIN/COMMIT.
 */
let depth = 0;

export function beginTransaction() {
  if (depth === 0) db.exec('BEGIN');
  depth += 1;
}

export function commitTransaction() {
  if (depth === 0) return;
  depth -= 1;
  if (depth === 0) db.exec('COMMIT');
}

/**
 * Membatalkan transaksi, lalu melupakan apa yang sempat diingat proses ini.
 *
 * Cache dibuang karena isinya memuat perubahan yang barusan dibatalkan. Daftar
 * tabel juga dibuang: CREATE TABLE ikut di dalam transaksi, jadi tabel yang
 * baru lahir di dalamnya hilang lagi saat ROLLBACK — tanpa ini, query
 * berikutnya mencari tabel yang sudah tidak ada.
 */
export function rollbackTransaction() {
  if (depth === 0) return;
  depth = 0;
  try {
    db.exec('ROLLBACK');
  } finally {
    for (const key of Object.keys(cache)) delete cache[key];
    ensured.clear();
  }
}

export function inTransaction(): boolean {
  return depth > 0;
}

function transaction<T>(fn: () => T): T {
  beginTransaction();
  try {
    const result = fn();
    commitTransaction();
    return result;
  } catch (err) {
    rollbackTransaction();
    throw err;
  }
}

export function insertItem(tableName: string, item: any): any {
  const table = ensureTable(tableName);
  const records = readTable(tableName);
  const now = new Date().toISOString();
  const newItem = {
    ...item,
    id: item.id || `ID-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: item.timestamp || now,
    updatedAt: now
  };
  /*
   * Baris baru muncul paling atas, sama seperti versi JSON yang memakai
   * unshift(). Beberapa pencarian mengambil kecocokan pertama, jadi urutan ini
   * bagian dari perilaku, bukan selera.
   */
  const lowest = db.get(`SELECT MIN(pos) AS m FROM "${table}"`) as any;
  const pos = lowest?.m === null || lowest?.m === undefined ? 0 : Number(lowest.m) - 1;
  db.run(`INSERT INTO "${table}" (id, pos, data) VALUES (?, ?, ?)`, [String(newItem.id), pos, JSON.stringify(newItem)]);
  records.unshift(newItem);
  return newItem;
}

export function updateItem(tableName: string, id: string, updates: any): any | null {
  const table = ensureTable(tableName);
  const records = readTable(tableName);
  const index = records.findIndex(r => String(r.id).toLowerCase() === String(id).toLowerCase());
  if (index === -1) return null;

  // A key sent as undefined means "no change", not "erase" — re-running an
  // Excel import wiped values that had been fixed in the app.
  const changes = Object.fromEntries(Object.entries(updates || {}).filter(([, v]) => v !== undefined));
  const updated = {
    ...records[index],
    ...changes,
    id: records[index].id, // keep original ID
    updatedAt: new Date().toISOString()
  };
  db.run(`UPDATE "${table}" SET data = ? WHERE id = ?`, [JSON.stringify(updated), String(records[index].id)]);
  records[index] = updated;
  return updated;
}

export function deleteItem(tableName: string, id: string): boolean {
  const table = ensureTable(tableName);
  const records = readTable(tableName);
  const index = records.findIndex(r => String(r.id).toLowerCase() === String(id).toLowerCase());
  if (index === -1) return false;
  db.run(`DELETE FROM "${table}" WHERE id = ?`, [String(records[index].id)]);
  records.splice(index, 1);
  return true;
}

export function findById(tableName: string, id: string): any | null {
  const records = readTable(tableName);
  return records.find(r => String(r.id).toLowerCase() === String(id).toLowerCase()) || null;
}

/*
 * Menutup berkas dengan rapi saat proses berhenti. SQLite sudah menulis tiap
 * commit ke disk, jadi tidak ada yang perlu "dikuras" seperti dulu; ini hanya
 * memastikan WAL dilipat balik ke berkas utama supaya backup berupa satu
 * berkas tetap lengkap.
 */
let closed = false;
export function closeDatabase() {
  if (closed) return;
  closed = true;
  try {
    if (depth > 0) {
      depth = 0;
      db.exec('ROLLBACK');
    }
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    db.close();
  } catch {
    // Proses tetap berhenti; data yang sudah di-commit aman di berkas.
  }
}

process.on('exit', closeDatabase);
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    closeDatabase();
    process.exit(0);
  });
}
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception, menutup basis data sebelum keluar:', err);
  closeDatabase();
  process.exit(1);
});

// Ensure default Admin user exists
/*
 * First-run admin. The password comes from INITIAL_ADMIN_PASSWORD when set;
 * otherwise a random one is generated and printed once, because shipping a
 * known default means every fresh install starts with the same credentials.
 */
(function initAdmin() {
  const users = readTable('users');
  if (users.length === 0) {
    const plain = process.env.INITIAL_ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
    const salt = crypto.randomBytes(16).toString('hex');
    const hashed = `scrypt$${salt}$${crypto.scryptSync(plain, salt, 64).toString('hex')}`;
    if (!process.env.INITIAL_ADMIN_PASSWORD) {
      console.log('');
      console.log('  Akun admin pertama dibuat: admin.rezza');
      console.log(`  Kata sandi sementara: ${plain}`);
      console.log('  Catat sekarang lalu segera ganti — ini hanya ditampilkan sekali.');
      console.log('');
    }
    insertItem('users', {
      id: 'USR-001',
      username: 'admin.rezza',
      password: hashed,
      name: 'Rezza',
      role: 'Super Admin',
      avatar: 'https://picsum.photos/seed/rezza/100/100',
      allowedModules: ['*'],
      user: 'System'
    });
  }
})();
