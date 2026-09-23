# Deploy: 3 host, 2 tempat

| Host | Isi | Tempat |
|---|---|---|
| `hasilintijualan.com` | Situs profil + lacak pesanan publik (`Compro-HIJ`, statis) | Web hosting (public_html) |
| `erp.hasilintijualan.com` | ERP staf | VPS — proses Node ini |
| `portal.hasilintijualan.com` | Portal pelanggan | VPS — **proses yang sama**, hanya host berbeda |

ERP dan portal **tidak bisa** di shared/web hosting: butuh proses Node yang hidup
terus, port sendiri, dan folder data yang bisa ditulis.

## A. VPS (Ubuntu 22.04/24.04, 1 vCPU / 1 GB cukup)

1. DNS di panel domain: A record `erp` dan `portal` → IP VPS.
2. Di VPS sebagai root:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/awwalakhalqin/ERP-HIJ/main/deploy/setup-vps.sh -o setup-vps.sh
   bash setup-vps.sh
   ```
   Skrip memasang Node 20, pm2, Caddy; clone ke `/opt/hij-erp`; data di
   `/var/lib/hij-data`; membuat `.env` (AUTH_SECRET acak, ALLOWED_ORIGINS
   ketiga host, VITE_PORTAL_HOST/URL); build; jalankan lewat pm2; Caddy dengan
   HTTPS otomatis untuk kedua host.
3. Data awal: unggah berkas JSON dari backup ke `/var/lib/hij-data/` **sebelum**
   aplikasi pertama kali dijalankan (atau jalankan skrip setelah menaruh
   `server/data/*.json` di repo lokal VPS). Start pertama menyelaraskan status
   pesanan sekali (log `Status N pesanan disesuaikan`).
4. Cek: `https://erp.hasilintijualan.com` (login staf), `https://portal.hasilintijualan.com`
   (hanya akun pelanggan). Alamat portal diberikan ke pelanggan lewat WhatsApp,
   tidak ditautkan dari situs.

Perintah harian di VPS:
```bash
pm2 logs hij-erp                      # log
cd /opt/hij-erp && npm run backup     # backup → backups/<tanggal>/ (jadwalkan di cron)
cd /opt/hij-erp && git pull && npm ci && npm run build:all && pm2 reload hij-erp   # update
```
Memulihkan backup: `pm2 stop hij-erp` → salin JSON ke `/var/lib/hij-data` → `pm2 start hij-erp`
(server memegang tabel di memori; berkas yang diganti saat hidup tertimpa).

## B. Situs profil (web hosting)

Di komputer Anda:
```bash
cd Compro-HIJ
NEXT_PUBLIC_API_URL=https://erp.hasilintijualan.com/api npm run build:static
```
Unggah seluruh isi `out/` (termasuk `.htaccess`) ke `public_html` domain utama.
Halaman lacak memanggil API di `erp.` — pastikan host itu sudah hidup dan
`ALLOWED_ORIGINS` memuat `https://hasilintijualan.com`.

## C. Deploy dari GitHub di panel hosting (Hostinger Node.js app)

| Pengaturan | Nilai |
| --- | --- |
| Node version | **20** (Tailwind v4 butuh Node ≥ 20) |
| Install command | `npm ci --omit=dev` |
| Build command | `npm run build` (sudah mencakup tampilan **dan** server) |
| Start command | `npm start` |
| Environment | `NODE_ENV=production`, `AUTH_SECRET=<64 hex acak>`, `ALLOWED_ORIGINS=https://hasilintijualan.com,https://www.hasilintijualan.com,https://erp.hasilintijualan.com`, `STOREFRONT_ENABLED=0`, `DATA_DIR=/home/<user>/hij-data` |

`.env` tidak ikut di git, jadi variabel di atas wajib diisi di panel — tanpa
`AUTH_SECRET` server produksi menolak jalan (disengaja).

**Data harus di luar folder aplikasi.** Deploy dari Git menimpa folder repo, jadi
`DATA_DIR` ditaruh di folder lain (mis. `/home/<user>/hij-data`) supaya pesanan,
faktur, dan akun tidak hilang saat deploy ulang. Salin isi backup ke sana sekali
di awal, saat aplikasi berhenti.

**Kalau build gagal dengan `Cannot find native binding` / gagal memuat
`vite.config.ts`**: itu bug npm pada optional dependencies (npm/cli#4828) —
biner native Linux (`@tailwindcss/oxide-*`, `@rollup/*`, `@esbuild/*`) tidak
terpasang. Repo ini sudah menyebut biner Linux itu di `optionalDependencies`,
jadi cukup deploy ulang dari commit terbaru. Bila masih terjadi, hapus
`node_modules` dan `package-lock.json` di server lalu `npm install --omit=dev`.

**Portal pelanggan**: bila panel hanya mengizinkan satu domain per aplikasi,
pakai `https://erp.hasilintijualan.com/portal` — aplikasi mengenali path itu
sebagai pintu pelanggan. Bila `portal.hasilintijualan.com` bisa diarahkan ke
aplikasi yang sama, pakai itu dan isi `VITE_PORTAL_HOST` sebelum build.

**Tidak ada database.** Semua data disimpan sebagai berkas JSON di `DATA_DIR`
(30 tabel, ±150 KB untuk data awal) — tidak perlu membuat MySQL/PostgreSQL di
panel hosting. Konsekuensinya: folder `DATA_DIR` adalah satu-satunya salinan
data, jadi taruh di luar folder aplikasi dan jadwalkan `npm run backup`.
Jalankan hanya **satu proses** aplikasi (tabel dipegang di memori); jangan
mengaktifkan mode cluster/multi-instance.

**Aplikasi 503 setelah deploy?** Cek log start. Paling sering karena
`AUTH_SECRET` belum diisi: server produksi sengaja berhenti dengan pesan
`FATAL: AUTH_SECRET belum disetel (minimal 16 karakter)`.
