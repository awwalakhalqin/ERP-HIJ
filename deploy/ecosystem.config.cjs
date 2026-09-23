// pm2: satu proses ERP (erp. + portal.) yang hidup lagi setelah crash/restart VPS.
// Nilai .env dibaca server sendiri (dotenv), jadi tidak diulang di sini.
module.exports = {
  apps: [
    {
      name: 'hij-erp',
      cwd: __dirname + '/..',
      script: 'dist-server/server.js',
      instances: 1, // tabel dipegang di memori: jangan lebih dari satu proses
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '400M',
      env: { NODE_ENV: 'production' },
      out_file: '/var/log/hij-erp.out.log',
      error_file: '/var/log/hij-erp.err.log',
      time: true
    }
  ]
};
