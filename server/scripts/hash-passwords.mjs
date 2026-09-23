/*
 * One-time migration: replace every plaintext password in users.json and
 * customers.json with an scrypt hash.
 *
 * Logging in already upgrades an account's own password, but that leaves every
 * account that has not signed in yet readable in the file. Run this once after
 * deploying, with the server STOPPED — the server keeps tables in memory and
 * would write its stale copy back over the migrated file.
 *
 *   node server/scripts/hash-passwords.mjs
 *
 * Existing passwords keep working: the hash is derived from the current value.
 * Already-hashed rows are left alone, so running it twice is harmless.
 */
import fs from 'fs';
import path from 'path';
import { openStore } from './lib/table-store.mjs';
import crypto from 'crypto';

const DATA_DIR = path.join(process.cwd(), 'server', 'data');
const store = openStore(DATA_DIR, { readonly: true });
const TABLES = ['users', 'customers'];
const PREFIX = 'scrypt$';

function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(plain, salt, 64).toString('hex');
  return `${PREFIX}${salt}$${derived}`;
}

let totalChanged = 0;

for (const file of TABLES) {
  let rows;
  try {
    rows = store.read(file);
  } catch (e) {
    console.error(`! ${file}: gagal dibaca, dilewati —`, e.message);
    continue;
  }
  if (rows.length === 0) {
    console.log(`- ${file}: kosong, dilewati`);
    continue;
  }
  if (!Array.isArray(rows)) {
    console.log(`- ${file}: bukan daftar record, dilewati`);
    continue;
  }

  let changed = 0;
  let blank = 0;
  for (const row of rows) {
    const value = row?.password;
    if (typeof value !== 'string' || value.length === 0) {
      if (row && 'password' in row) blank++;
      continue;
    }
    if (value.startsWith(PREFIX)) continue;
    row.password = hashPassword(value);
    changed++;
  }

  if (changed > 0) {
    // Satu transaksi: sebuah jalannya yang terputus tidak bisa meninggalkan
    // tabel akun setengah jadi.
    store.write(file, rows);
  }

  totalChanged += changed;
  console.log(
    `- ${file}: ${changed} kata sandi di-hash, ` +
    `${rows.length - changed - blank} sudah aman, ${blank} tanpa kata sandi`
  );
}

console.log(
  totalChanged > 0
    ? `\nSelesai. ${totalChanged} kata sandi dipindahkan ke scrypt.`
    : '\nTidak ada yang perlu diubah — semua kata sandi sudah ter-hash.'
);

store.close();
