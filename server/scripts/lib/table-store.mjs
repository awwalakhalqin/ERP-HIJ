/*
 * Akses tabel dari luar aplikasi, untuk skrip perawatan.
 *
 * Skrip tidak boleh mengimpor server/src/db.ts: modul itu membuat akun admin
 * pertama begitu dimuat. Helper ini membuka berkas yang sama dengan aturan
 * baris yang sama (id, pos, data) tanpa efek samping.
 */
import fs from 'fs';
import path from 'path';
import sqlite from 'node-sqlite3-wasm';

const { Database } = sqlite; // paket CommonJS: named import tidak tersedia

export function resolveDataDir(preferred) {
  return path.resolve(process.cwd(), preferred || process.env.DATA_DIR || 'server/data');
}

export function openStore(dataDir, { readonly = false } = {}) {
  const dir = resolveDataDir(dataDir);
  const dbPath = path.join(dir, 'hij.db');
  if (readonly && !fs.existsSync(dbPath)) {
    throw new Error(`Basis data belum ada: ${dbPath}\nJalankan dulu: node server/scripts/migrate-to-sqlite.mjs`);
  }
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(dbPath);
  db.exec('PRAGMA journal_mode = WAL');

  const safe = (name) => String(name).toLowerCase().replace(/[^a-z0-9_]/g, '');
  const ensure = (name) => {
    const table = safe(name);
    db.exec(`CREATE TABLE IF NOT EXISTS "${table}" (id TEXT PRIMARY KEY, pos REAL NOT NULL, data TEXT NOT NULL)`);
    db.exec(`CREATE INDEX IF NOT EXISTS "${table}_pos" ON "${table}" (pos)`);
    return table;
  };

  return {
    db,
    dbPath,
    dataDir: dir,
    listTables() {
      return db
        .all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .map(row => String(row.name));
    },
    count(name) {
      return db.get(`SELECT COUNT(*) AS c FROM "${ensure(name)}"`).c;
    },
    read(name) {
      return db.all(`SELECT data FROM "${ensure(name)}" ORDER BY pos ASC`).map(row => JSON.parse(String(row.data)));
    },
    write(name, rows) {
      const table = ensure(name);
      db.exec('BEGIN');
      try {
        db.run(`DELETE FROM "${table}"`);
        const insert = db.prepare(`INSERT INTO "${table}" (id, pos, data) VALUES (?, ?, ?)`);
        try {
          rows.forEach((row, index) => {
            const id = row?.id ? String(row.id) : `${table.toUpperCase()}-${index + 1}`;
            insert.run([id, index, JSON.stringify({ ...row, id })]);
          });
        } finally {
          insert.finalize();
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    /** Salinan konsisten ke berkas lain, aman walau aplikasi sedang jalan. */
    copyTo(targetPath) {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.rmSync(targetPath, { force: true });
      db.run('VACUUM INTO ?', [targetPath]);
      return fs.statSync(targetPath).size;
    },
    close() {
      try {
        db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      } catch {
        // Berkas tetap sah; checkpoint hanya merapikan.
      }
      db.close();
    }
  };
}
