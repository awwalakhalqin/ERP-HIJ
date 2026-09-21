Dataset UJI COBA — bukan data produksi.

Folder ini dibaca oleh `npm run dev:test` (API di port 3002).
Data produksi ada di server/data/ dan tidak tersentuh dari sini.

Isi ulang kapan saja:
  node server/scripts/seed-test-data.mjs          (salin ulang dari produksi)
  node server/scripts/seed-test-data.mjs --empty  (kosongkan semua tabel)

Jangan pernah mengunggah folder ini ke hosting.