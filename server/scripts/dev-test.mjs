/*
 * Start the whole app in test mode: API on 3002 reading server/data-test/, and
 * the Vite client on 5174 proxying to it.
 *
 * Both run beside the production pair (3001 / 5173) without colliding, so the
 * real dataset can stay up while trial data is being entered. Setting the
 * environment here rather than in the npm script keeps it working the same on
 * cmd, PowerShell and bash.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const DATA_DIR = 'server/data-test';
const API_PORT = process.env.PORT || '3002';
const CLIENT_PORT = process.env.CLIENT_PORT || '5174';

if (!fs.existsSync(path.join(process.cwd(), DATA_DIR, 'hij.db'))) {
  console.error(`Basis data uji belum ada di ${DATA_DIR}/hij.db.`);
  console.error('Jalankan dulu:  npm run seed:test');
  process.exit(1);
}

const env = {
  ...process.env,
  HIJ_MODE: 'test',
  DATA_DIR,
  PORT: API_PORT,
  // A fixed secret so sessions survive a restart while testing. Never used in
  // production: there AUTH_SECRET is required and the server refuses to boot
  // without one.
  AUTH_SECRET: process.env.AUTH_SECRET || 'hij-test-secret-local-only-do-not-deploy'
};

/*
 * Spawn the local binaries with node directly rather than through npx. Recent
 * Node refuses to spawn a .cmd shim without a shell on Windows (EINVAL), and
 * going through a shell would mean worrying about quoting instead.
 */
const TSX = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
const VITE = path.join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js');

for (const [name, file] of [['tsx', TSX], ['vite', VITE]]) {
  if (!fs.existsSync(file)) {
    console.error(`${name} tidak ditemukan di node_modules. Jalankan dulu: npm install`);
    process.exit(1);
  }
}

console.log('');
console.log('  MODE UJI COBA');
console.log(`  API     : http://localhost:${API_PORT}   (data: ${DATA_DIR})`);
console.log(`  Aplikasi: http://localhost:${CLIENT_PORT}`);
console.log('  Data produksi di server/data/ tidak tersentuh.');
console.log('');

const children = [
  spawn(process.execPath, [TSX, 'watch', 'server/index.ts'], { env, stdio: 'inherit' }),
  spawn(process.execPath, [VITE, '--port', CLIENT_PORT], { env, stdio: 'inherit' })
];

const stopAll = () => {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
};

process.on('SIGINT', () => { stopAll(); process.exit(0); });
process.on('SIGTERM', () => { stopAll(); process.exit(0); });

for (const child of children) {
  // If either half dies the pair is useless; take the other down with it rather
  // than leaving a half-running environment that looks fine.
  child.on('exit', code => {
    if (code !== 0 && code !== null) {
      stopAll();
      process.exit(code);
    }
  });
}
