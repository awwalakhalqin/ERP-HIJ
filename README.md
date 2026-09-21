# ERP HIJ Konveksi

Sistem manajemen produksi untuk PT Hasil Inti Jualan (HIJ Konveksi) — dari surat
penawaran masuk sampai barang dikirim, plus portal pelacakan untuk pelanggan.

Dua puluh menu mengikuti urutan kerja pabrik, bukan urutan abjad: Penawaran →
Pesanan → Desain & Sampel → SPK → Potong/Jahit → QC → Kemas → Kirim.

## Tumpukan teknologi

| Bagian | Dipakai |
| --- | --- |
| Tampilan | React 19 · TypeScript 5.8 · Vite 6 · Tailwind v4 |
| Server | Express 4 dijalankan lewat `tsx`, dibundel dengan esbuild |
| Penyimpanan | Berkas JSON di `server/data/` — tanpa SQL |
| Autentikasi | scrypt untuk sandi, token HMAC-SHA256 berlaku 12 jam (modul `crypto` bawaan Node) |
| Lain-lain | PWA (installable, jalan saat offline) · `xlsx` untuk impor & ekspor · jsPDF untuk dokumen cetak |

## Menjalankan di komputer sendiri

Butuh Node.js 18 atau lebih baru.

```bash
npm install
cp .env.example .env          # isi AUTH_SECRET dengan kunci sendiri
npm run seed:test             # menyiapkan data contoh
npm run dev:test              # server API + tampilan, memakai server/data-test
```

Buka `http://localhost:5174`. Perintah `dev:test` sengaja memakai dataset
terpisah (`server/data-test/`) supaya percobaan tidak pernah menyentuh data
produksi; banner kuning di atas halaman menandakan mode uji.

Untuk menjalankan mode produksi di lokal:

```bash
npm run dev:server            # API di :3001, dataset server/data
npm run dev:client            # tampilan di :5173
```

### Perintah lain

| Perintah | Kegunaan |
| --- | --- |
| `npm run lint` | Memeriksa tipe, tampilan dan server sekaligus |
| `npm run build:all` | Build tampilan ke `dist/` dan server ke `dist-server/` |
| `npm start` | Menjalankan hasil build |

## Datanya tidak ada di repositori ini

`server/data/` memuat nama pelanggan, nomor telepon, alamat, harga, tagihan, dan
hash sandi akun — jadi isinya tidak pernah ikut di-commit. Repositori ini publik;
data itu tinggal di server. Jalankan `npm run seed:test` untuk mendapat dataset
yang bisa dipakai bekerja.

Hal yang sama berlaku untuk `uploads/` (foto desain milik pelanggan) dan berkas
kredensial awal yang dibagikan sekali per orang lalu dihapus.

## Akun pertama

Belum ada akun bawaan di repositori. Setelah `npm run seed:test`, buat akun lewat
skrip di `server/scripts/`:

```bash
node server/scripts/reset-passwords.mjs    # menyetel sandi baru per akun
```

Skrip itu mencetak sandi yang dihasilkan ke layar sekali saja — simpan sendiri,
jangan di-commit.

## Struktur

```
src/
  components/modules/   satu berkas per menu (20 modul)
  components/ui/        komponen bersama: tabel, modal, panel detail, form
  lib/                  aturan bisnis: kesiapan SPK, impor Excel, hitungan upah
  services/             pemanggil API dan pembuat PDF
  types/                satu sumber tipe data untuk seluruh aplikasi
server/
  src/index.ts          seluruh API
  src/auth.ts           hash sandi, token, middleware izin
  scripts/              seed, reset sandi, penjalan mode uji
```

## Catatan produk

Beberapa aturan yang mudah salah dibaca dari kodenya:

- **Yang menahan penerbitan SPK hanya dua hal**: DP sudah masuk dan desain sudah
  disetujui. Kesiapan bahan baku ditampilkan tapi tidak mengunci.
- **Progres SPK dijumlahkan dari catatan petugas produksi**, bukan diketik
  terpisah — supaya angka progres dan angka upah tidak bisa berbeda.
- **Tarif borongan diisi per pekerjaan**, bukan per orang, karena tarif mengikuti
  kesulitan proyek dan tidak ada yang punya jobdesk tetap. Tarif tersimpan
  melekat pada catatannya, jadi perubahan tarif tidak mengubah upah yang lalu.
- **Kuantitas penawaran dihitung dari rincian ukuran**, jadi total tidak mungkin
  berbeda dari jumlah per ukuran.
