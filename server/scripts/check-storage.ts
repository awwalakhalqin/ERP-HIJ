/*
 * Memeriksa lapisan penyimpanan: transaksi benar-benar membatalkan perubahan,
 * dan perilaku yang diandalkan aplikasi tidak berubah sejak versi JSON.
 *
 * Jalankan di folder data terpisah, bukan data asli:
 *   DATA_DIR=.tmp-check npm run check:storage
 */
import {
  insertItem,
  updateItem,
  readTable,
  findById,
  beginTransaction,
  commitTransaction,
  rollbackTransaction
} from '../src/db.js';

let pass = 0;
let fail = 0;
const ok = (cond: boolean, label: string, extra?: unknown) => {
  if (cond) {
    pass += 1;
    console.log('  PASS', label);
  } else {
    fail += 1;
    console.log('  FAIL', label, extra ?? '');
  }
};

// 1. Aksi yang dibatalkan di tengah tidak meninggalkan perubahan separuh.
beginTransaction();
insertItem('orders', { id: 'ORD-TX-1', customerName: 'Uji', totalPrice: 1000 });
insertItem('invoices', { id: 'INV-TX-1', orderId: 'ORD-TX-1', total: 1000 });
rollbackTransaction();
ok(findById('orders', 'ORD-TX-1') === null, 'rollback: pesanan tidak tersisa');
ok(findById('invoices', 'INV-TX-1') === null, 'rollback: faktur tidak tersisa (tidak ada data separuh)');

// 2. Aksi yang selesai tersimpan utuh di semua tabel yang tersentuh.
beginTransaction();
insertItem('orders', { id: 'ORD-TX-2', customerName: 'Uji', totalPrice: 2000 });
insertItem('invoices', { id: 'INV-TX-2', orderId: 'ORD-TX-2', total: 2000 });
commitTransaction();
ok(!!findById('orders', 'ORD-TX-2') && !!findById('invoices', 'INV-TX-2'), 'commit: kedua tabel tersimpan');

// 3. Perilaku versi JSON yang harus tetap sama.
insertItem('orders', { id: 'ORD-TX-3', customerName: 'Terbaru' });
ok(readTable('orders')[0].id === 'ORD-TX-3', 'baris baru muncul paling atas (seperti unshift)');

updateItem('orders', 'ord-tx-3', { customerName: undefined, totalPrice: 5000 });
const row = findById('orders', 'ORD-TX-3');
ok(
  row.customerName === 'Terbaru' && row.totalPrice === 5000,
  'undefined tidak menimpa, id tidak peduli huruf besar/kecil',
  row
);

console.log(`\n${pass} lulus, ${fail} gagal`);
process.exit(fail ? 1 : 0);
