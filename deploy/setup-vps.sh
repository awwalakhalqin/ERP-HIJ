#!/usr/bin/env bash
# Pasang ERP HIJ (erp. + portal.) di VPS Ubuntu 22.04/24.04 yang masih kosong.
#
#   ssh root@IP-VPS
#   curl -fsSL https://raw.githubusercontent.com/awwalakhalqin/ERP-HIJ/main/deploy/setup-vps.sh -o setup-vps.sh
#   bash setup-vps.sh
#
# Yang dilakukan: Node 20 + pm2 + Caddy, clone repo ke /opt/hij-erp, folder data
# di /var/lib/hij-data (di luar repo, aman saat kode diperbarui), .env produksi,
# build, jalankan lewat pm2, dan Caddy dengan HTTPS otomatis untuk kedua host.
# Jalankan ulang aman: langkah yang sudah ada dilewati.
set -euo pipefail

REPO="${REPO:-https://github.com/awwalakhalqin/ERP-HIJ.git}"
APP_DIR="${APP_DIR:-/opt/hij-erp}"
DATA_DIR="${DATA_DIR:-/var/lib/hij-data}"
ERP_HOST="${ERP_HOST:-erp.hasilintijualan.com}"
PORTAL_HOST="${PORTAL_HOST:-portal.hasilintijualan.com}"
SITE_HOST="${SITE_HOST:-hasilintijualan.com}"
PORT="${PORT:-3001}"

if [ "$(id -u)" -ne 0 ]; then echo "Jalankan sebagai root (sudo bash setup-vps.sh)."; exit 1; fi

echo "== 1/6 Paket dasar"
apt-get update -y
apt-get install -y curl git ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https

if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 20 ]; then
  echo "== Node.js 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
command -v pm2 >/dev/null || npm install -g pm2

if ! command -v caddy >/dev/null; then
  echo "== Caddy"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi

echo "== 2/6 Kode"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone "$REPO" "$APP_DIR"
fi
cd "$APP_DIR"
npm ci

echo "== 3/6 Data di luar repo: $DATA_DIR"
mkdir -p "$DATA_DIR"   # unggahan (bukti, mockup) tersimpan di $APP_DIR/uploads (di-gitignore, aman saat git pull)
if [ -z "$(ls -A "$DATA_DIR"/*.json 2>/dev/null)" ]; then
  # Data awal hanya dari salinan yang Anda unggah sendiri (server/data tidak ada di git).
  if ls server/data/*.json >/dev/null 2>&1; then
    cp server/data/*.json "$DATA_DIR/"
    echo "   data awal disalin dari server/data"
  else
    echo "   (kosong) unggah berkas JSON dari backup ke $DATA_DIR sebelum menjalankan aplikasi, atau biarkan: server membuat tabel kosong + admin awal."
  fi
fi

echo "== 4/6 .env produksi"
if [ ! -f .env ]; then
  cat > .env <<EOF
PORT=$PORT
NODE_ENV=production
AUTH_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
ALLOWED_ORIGINS=https://$SITE_HOST,https://www.$SITE_HOST,https://$ERP_HOST,https://$PORTAL_HOST
DATA_DIR=$DATA_DIR
VITE_PORTAL_HOST=$PORTAL_HOST
VITE_PORTAL_URL=https://$PORTAL_HOST
STOREFRONT_ENABLED=0
EOF
  chmod 600 .env
  echo "   .env dibuat (AUTH_SECRET acak). Simpan salinannya di tempat aman."
else
  echo "   .env sudah ada, tidak diubah"
fi

echo "== 5/6 Build & jalankan"
set -a; . ./.env; set +a
npm run build:all
pm2 startOrReload deploy/ecosystem.config.cjs --update-env
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

echo "== 6/6 Caddy (HTTPS otomatis)"
sed -e "s/erp.hasilintijualan.com/$ERP_HOST/g" -e "s/portal.hasilintijualan.com/$PORTAL_HOST/g" -e "s/localhost:3001/localhost:$PORT/g" \
  deploy/Caddyfile > /etc/caddy/Caddyfile
systemctl enable --now caddy
systemctl reload caddy

echo
echo "Selesai. Pastikan DNS A record $ERP_HOST dan $PORTAL_HOST mengarah ke IP VPS ini, lalu buka:"
echo "  https://$ERP_HOST     (staf)"
echo "  https://$PORTAL_HOST  (pelanggan)"
echo "Log: pm2 logs hij-erp   |  Backup: cd $APP_DIR && npm run backup"
