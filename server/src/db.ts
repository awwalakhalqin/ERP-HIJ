import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/*
 * Which dataset this process serves.
 *
 * DATA_DIR lets a test instance run against its own copy of the JSON tables, so
 * filling in trial orders never touches the real ones. Unset, it stays exactly
 * where it always was, so production is unaffected by the option existing.
 */
export const HIJ_MODE = process.env.HIJ_MODE === 'test' ? 'test' : 'production';

export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.cwd(), process.env.DATA_DIR)
  : path.join(process.cwd(), 'server', 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Memory Cache with Debounced File Persistence
const memoryCache: Record<string, any[]> = {};
const pendingWrites: Record<string, NodeJS.Timeout> = {};

function getFilePath(tableName: string): string {
  const safeName = tableName.toLowerCase().replace(/[^a-z0-9_]/g, '');
  return path.join(DATA_DIR, `${safeName}.json`);
}

export function readTable(tableName: string): any[] {
  const key = tableName.toLowerCase();
  if (memoryCache[key]) {
    return memoryCache[key];
  }

  const filePath = getFilePath(tableName);
  if (fs.existsSync(filePath)) {
    try {
      const data = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(data);
      memoryCache[key] = Array.isArray(parsed) ? parsed : [];
      return memoryCache[key];
    } catch (e) {
      /*
       * Carrying on with an empty table would persist that emptiness over the
       * real data on the next write — and for users.json, initAdmin would then
       * create a fresh admin and every login would be gone. Set the damaged
       * file aside and stop, so someone restores it from backup.
       */
      const aside = `${filePath}.corrupt-${Date.now()}`;
      try {
        fs.renameSync(filePath, aside);
      } catch {
        // If even the rename fails the original stays where it is.
      }
      console.error(`
Tabel ${tableName} rusak dan tidak bisa dibaca: ${e}
Berkasnya dipindahkan ke ${aside}.
Pulihkan dari backup lalu jalankan server lagi.
`);
      process.exit(1);
    }
  }

  memoryCache[key] = [];
  return [];
}

/*
 * Write through a temp file and rename. A rename is atomic on the same volume,
 * so a crash mid-write leaves the previous table intact instead of a truncated
 * one — writing straight over the destination could lose the whole table.
 */
function persist(tableName: string, data: any[]) {
  const filePath = getFilePath(tableName);
  const tempPath = `${filePath}.tmp`;
  try {
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tempPath, filePath);
  } catch (e) {
    console.error(`Failed to persist ${tableName} to disk:`, e);
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {
      // A leftover temp file is harmless; the next write replaces it.
    }
  }
}

export function writeTable(tableName: string, data: any[]) {
  const key = tableName.toLowerCase();
  memoryCache[key] = data;

  // Debounced write to disk for high-performance throughput
  if (pendingWrites[key]) {
    clearTimeout(pendingWrites[key]);
  }

  pendingWrites[key] = setTimeout(() => {
    delete pendingWrites[key];
    persist(tableName, data);
  }, 100);
}

/*
 * Shared hosting stops an idle app without warning, and the 100 ms debounce
 * means the most recent writes may still be in memory when that happens. Every
 * exit path drains them first.
 */
export function flushPendingWrites() {
  for (const key of Object.keys(pendingWrites)) {
    clearTimeout(pendingWrites[key]);
    delete pendingWrites[key];
    const data = memoryCache[key];
    if (Array.isArray(data)) persist(key, data);
  }
}

let flushed = false;
function flushOnce() {
  if (flushed) return;
  flushed = true;
  flushPendingWrites();
}

process.on('exit', flushOnce);
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    flushOnce();
    process.exit(0);
  });
}
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception, flushing data before exit:', err);
  flushOnce();
  process.exit(1);
});

export function insertItem(tableName: string, item: any): any {
  const records = readTable(tableName);
  const now = new Date().toISOString();
  const newItem = {
    ...item,
    id: item.id || `ID-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
    timestamp: item.timestamp || now,
    updatedAt: now
  };
  records.unshift(newItem);
  writeTable(tableName, records);
  return newItem;
}

export function updateItem(tableName: string, id: string, updates: any): any | null {
  const records = readTable(tableName);
  const index = records.findIndex(r => String(r.id).toLowerCase() === String(id).toLowerCase());
  if (index === -1) return null;

  // A key sent as undefined means "no change", not "erase" — re-running an
  // Excel import wiped values that had been fixed in the app.
  const changes = Object.fromEntries(Object.entries(updates || {}).filter(([, v]) => v !== undefined));
  records[index] = {
    ...records[index],
    ...changes,
    id: records[index].id, // keep original ID
    updatedAt: new Date().toISOString()
  };
  writeTable(tableName, records);
  return records[index];
}

export function deleteItem(tableName: string, id: string): boolean {
  const records = readTable(tableName);
  const filtered = records.filter(r => String(r.id).toLowerCase() !== String(id).toLowerCase());
  if (filtered.length === records.length) return false;
  writeTable(tableName, filtered);
  return true;
}

export function findById(tableName: string, id: string): any | null {
  const records = readTable(tableName);
  return records.find(r => String(r.id).toLowerCase() === String(id).toLowerCase()) || null;
}

// Ensure default Admin user exists in users.json
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
