/*
 * Give every account its own password.
 *
 * Every staff account shared one password and every customer account shared
 * another, so hashing protected the file but not a guess. This assigns a unique
 * random password per account, stores only the scrypt hash, and writes the
 * plaintext ONCE to a local handover file that is never part of the build.
 *
 * Run with the server STOPPED — it keeps tables in memory and would write its
 * stale copy back over the result.
 *
 *   node server/scripts/reset-passwords.mjs            # semua akun
 *   node server/scripts/reset-passwords.mjs --staff    # akun staf saja
 *   node server/scripts/reset-passwords.mjs --customers
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const DATA_DIR = path.join(process.cwd(), 'server', 'data');
const OUT_FILE = path.join(process.cwd(), 'KREDENSIAL-AWAL.md');

// No 0/O/1/l/i — these get typed by hand off a phone screen.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

function makePassword() {
  const pick = () =>
    Array.from({ length: 4 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
  return `${pick()}-${pick()}-${pick()}`;
}

function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt$${salt}$${crypto.scryptSync(plain, salt, 64).toString('hex')}`;
}

function readTable(file) {
  const p = path.join(DATA_DIR, file);
  if (!fs.existsSync(p)) return null;
  const rows = JSON.parse(fs.readFileSync(p, 'utf-8'));
  return Array.isArray(rows) ? rows : null;
}

function writeTable(file, rows) {
  const p = path.join(DATA_DIR, file);
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2), 'utf-8');
  fs.renameSync(tmp, p);
}

const args = process.argv.slice(2);
const doStaff = args.length === 0 || args.includes('--staff');
const doCustomers = args.length === 0 || args.includes('--customers');

const issued = { staff: [], customers: [] };

if (doStaff) {
  const rows = readTable('users.json');
  if (rows) {
    for (const row of rows) {
      const plain = makePassword();
      row.password = hashPassword(plain);
      issued.staff.push({ id: row.id, username: row.username, name: row.name, role: row.role, plain });
    }
    writeTable('users.json', rows);
  }
}

if (doCustomers) {
  const rows = readTable('customers.json');
  if (rows) {
    for (const row of rows) {
      const plain = makePassword();
      row.password = hashPassword(plain);
      issued.customers.push({
        id: row.id,
        username: row.username || row.phone || row.id,
        name: row.company || row.name,
        plain
      });
    }
    writeTable('customers.json', rows);
  }
}

// ------------------------------------------------------------- handover file
const stamp = new Date().toISOString().slice(0, 10);
const lines = [
  '# Kredensial Awal — HIJ Konveksi',
  '',
  `Dibuat ${stamp}. **Berkas ini berisi kata sandi asli.**`,
  '',
  '- Jangan diunggah ke hosting, jangan ditaruh di `public/`, jangan dikirim ke grup.',
  '- Kirim ke tiap orang hanya barisnya sendiri, lewat jalur pribadi.',
  '- Hapus berkas ini setelah semua kredensial terkirim.',
  '- Sistem hanya menyimpan hash-nya; kalau berkas ini hilang, kata sandi harus di-reset ulang.',
  ''
];

if (issued.staff.length) {
  lines.push('## Akun Staf', '');
  lines.push('| Nama | Peran | Username | Kata sandi |');
  lines.push('|---|---|---|---|');
  for (const a of issued.staff) {
    lines.push(`| ${a.name || '-'} | ${a.role || '-'} | \`${a.username}\` | \`${a.plain}\` |`);
  }
  lines.push('');
}

if (issued.customers.length) {
  lines.push('## Akun Pelanggan', '');
  lines.push('| Pelanggan | ID | Username | Kata sandi |');
  lines.push('|---|---|---|---|');
  for (const a of issued.customers) {
    lines.push(`| ${a.name || '-'} | ${a.id} | \`${a.username}\` | \`${a.plain}\` |`);
  }
  lines.push('');
}

fs.writeFileSync(OUT_FILE, lines.join('\n'), 'utf-8');

console.log(`Staf     : ${issued.staff.length} kata sandi baru`);
console.log(`Pelanggan: ${issued.customers.length} kata sandi baru`);
console.log('');
console.log(`Daftar lengkap ditulis ke: ${OUT_FILE}`);
console.log('Kirim per orang, lalu hapus berkas itu.');
