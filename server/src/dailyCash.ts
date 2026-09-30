import { Router, Request, Response, NextFunction } from 'express';
import { readTable, insertItem, updateItem, findById, rollbackTransaction } from './db.js';
import { nextId } from './flow.js';
import { requireModule } from './access.js';
import { canonicalPayerName, distinctNames, isOpenTalangan } from '../../src/lib/dailyCash.js';

/*
 * Catatan Keuangan Harian.
 *
 * One person, the PJ, records every day's spending and pays back what staff
 * fronted. Everyone else may only look. The generic CRUD routes refuse these
 * tables outright (see DEDICATED_TABLES in access.ts), so every write passes
 * through here, where the PJ is checked and the warehouse and the surat jalan
 * stay consistent with the entry.
 */

const ENTRIES = 'daily_cash_entries';
const RECEIPTS = 'stock_receipts';
const SETTINGS = 'daily_cash_settings';
const SETTINGS_ID = 'pj';
/** The PJ the client named, used until a Super Admin appoints someone else. */
const DEFAULT_PJ_USERNAME = 'admin.dani';

const TYPES = ['Pengiriman', 'Stok Gudang', 'Lainnya'];
const PAID_WITH = ['Kas Kantor', 'Ditalangi'];
const SETTLE_METHODS = ['Transfer', 'Tunai'];

class EntryError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** Today in Jakarta: the server may run in UTC, the factory does not. */
const todayJakarta = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
const isDate = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const text = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ');

const actor = (req: Request) => (req.actor?.type === 'internal' ? findById('users', req.actor.sub) : null);
const actorName = (user: any) => String(user?.name || user?.username || 'PJ');

export function currentPjUserId(): string {
  const saved = findById(SETTINGS, SETTINGS_ID);
  if (saved?.pjUserId && findById('users', saved.pjUserId)) return String(saved.pjUserId);
  const fallback = readTable('users').find(
    (u: any) => String(u.username || '').toLowerCase() === DEFAULT_PJ_USERNAME
  );
  return fallback ? String(fallback.id) : '';
}

const isPj = (user: any) => !!user && String(user.id).toLowerCase() === currentPjUserId().toLowerCase();

/** Every write on this page: the PJ, and nobody else, Super Admin included. */
function requirePj(req: Request, res: Response, next: NextFunction) {
  const user = actor(req);
  if (!user) return res.status(403).json({ error: 'Akses ini khusus staf HIJ.' });
  if (!isPj(user)) {
    const pj = findById('users', currentPjUserId());
    return res.status(403).json({
      error: `Hanya PJ Catatan Harian (${pj?.name || pj?.username || 'belum ditunjuk'}) yang bisa mengubah catatan ini. Akun Anda hanya bisa melihat.`
    });
  }
  next();
}

const isStockItem = (r: any) =>
  typeof r?.name === 'string' && r?.stock !== undefined && r?.stock !== null && !Number.isNaN(Number(r.stock));

const knownPayers = (excludeId?: string) =>
  distinctNames(readTable(ENTRIES).filter((e: any) => e.id !== excludeId).map((e: any) => e.payerName));

/** The fields an entry gets from the form, checked and completed from the records it points at. */
function resolveEntry(body: any, existingId?: string) {
  const type = text(body?.type);
  if (!TYPES.includes(type)) throw new EntryError('Pilih jenis catatan: Pengiriman, Stok Gudang, atau Lainnya.');

  const amount = Math.round(Number(body?.amount));
  if (!(amount > 0)) throw new EntryError('Isi nominal lebih dari 0.');

  const paidWith = text(body?.paidWith);
  if (!PAID_WITH.includes(paidWith)) throw new EntryError('Pilih dibayar pakai Kas Kantor atau Ditalangi.');

  let payerName = '';
  if (paidWith === 'Ditalangi') {
    const typed = text(body?.payerName);
    if (!typed) throw new EntryError('Isi nama yang menalangi.');
    payerName = canonicalPayerName(typed, knownPayers(existingId));
  }

  const date = isDate(body?.date) ? String(body.date) : todayJakarta();
  const notes = text(body?.notes);

  let orderId = text(body?.orderId);
  let itemName = '';
  let category = '';
  let shipmentId = '';
  let stockItemId = '';
  let qty = 0;
  let unit = '';

  if (type === 'Pengiriman') {
    shipmentId = text(body?.shipmentId);
    const shipment = shipmentId ? findById('shipments', shipmentId) : null;
    if (!shipment) throw new EntryError('Pilih surat jalan yang ongkirnya dicatat.');
    if (shipment.paidBy !== 'Pengirim') {
      throw new EntryError(`Ongkir ${shipment.id} dibayar penerima (COD), jadi bukan pengeluaran HIJ.`);
    }
    const taken = readTable(ENTRIES).find(
      (e: any) => e.id !== existingId && e.shipmentId === shipment.id && e.status !== 'Dibatalkan'
    );
    if (taken) throw new EntryError(`Ongkir ${shipment.id} sudah dicatat di ${taken.id}.`, 409);
    shipmentId = shipment.id;
    orderId = shipment.orderId || '';
    itemName = `Ongkir ${text(shipment.courier) || 'kurir'} · ${shipment.id}`;
    category = 'Pengiriman';
  } else if (type === 'Stok Gudang') {
    stockItemId = text(body?.stockItemId);
    const item = stockItemId ? findById('inventory_bahan', stockItemId) : null;
    if (!item || !isStockItem(item)) throw new EntryError('Pilih barang stok gudang yang dibeli.');
    qty = Number(body?.qty);
    if (!(qty > 0)) throw new EntryError('Isi jumlah barang yang dibeli, lebih dari 0.');
    stockItemId = item.id;
    unit = text(item.unit) || 'pcs';
    itemName = `${text(item.name)} × ${qty.toLocaleString('id-ID')} ${unit}`;
    category = text(item.category) || 'Stok Gudang';
  } else {
    itemName = text(body?.itemName);
    category = text(body?.category);
    if (!itemName) throw new EntryError('Isi nama barang atau keperluannya.');
    if (!category) throw new EntryError('Isi kategori pengeluaran.');
  }

  if (orderId && !findById('orders', orderId)) throw new EntryError(`Pesanan ${orderId} tidak ditemukan.`);

  return { type, amount, paidWith, payerName, date, notes, orderId, itemName, category, shipmentId, stockItemId, qty, unit };
}

type Resolved = ReturnType<typeof resolveEntry>;

/** Moves a warehouse item's stock, refusing to go below what is physically left. */
function moveStock(itemId: string, delta: number, unitPrice?: number) {
  const item = findById('inventory_bahan', itemId);
  if (!item) throw new EntryError(`Barang gudang ${itemId} tidak ditemukan.`, 409);
  const next = Number(item.stock) + delta;
  if (next < 0) {
    throw new EntryError(
      `Stok ${item.name} tinggal ${Number(item.stock).toLocaleString('id-ID')} ${item.unit || ''}; sebagian sudah terpakai. Koreksi lewat stock opname di Gudang.`,
      409
    );
  }
  updateItem('inventory_bahan', itemId, {
    stock: next,
    ...(unitPrice !== undefined ? { price: unitPrice } : {})
  });
}

const unitPriceOf = (r: Resolved) => Math.round(r.amount / r.qty);

/*
 * Keeps the warehouse in step with an entry: a Stok Gudang entry adds its
 * quantity and leaves a line in the stock-in history; changing or cancelling
 * the entry takes the old quantity back out first.
 */
function syncStock(previous: any | null, next: Resolved | null, entryId: string, user: any): string {
  const wasStock = previous?.type === 'Stok Gudang' && previous?.status !== 'Dibatalkan' && previous?.stockItemId;
  const isStock = next?.type === 'Stok Gudang';

  if (wasStock) moveStock(previous.stockItemId, -Number(previous.qty || 0));

  const receiptId = previous?.stockReceiptId && findById(RECEIPTS, previous.stockReceiptId) ? previous.stockReceiptId : '';
  if (!isStock) {
    if (receiptId) updateItem(RECEIPTS, receiptId, { status: 'Dibatalkan' });
    return '';
  }

  const unitPrice = unitPriceOf(next!);
  moveStock(next!.stockItemId, next!.qty, unitPrice);
  const item = findById('inventory_bahan', next!.stockItemId);
  const receipt = {
    itemId: next!.stockItemId,
    itemName: text(item?.name),
    category: text(item?.category),
    qty: next!.qty,
    unit: next!.unit,
    unitPrice,
    total: next!.amount,
    date: next!.date,
    entryId,
    status: 'Aktif',
    user: actorName(user)
  };
  if (receiptId) {
    updateItem(RECEIPTS, receiptId, receipt);
    return receiptId;
  }
  return insertItem(RECEIPTS, { id: nextId(RECEIPTS, 'STM'), ...receipt }).id;
}

const FIELD_LABELS: Record<string, string> = {
  type: 'jenis',
  amount: 'nominal',
  paidWith: 'dibayar pakai',
  payerName: 'penalang',
  date: 'tanggal',
  notes: 'catatan',
  orderId: 'pesanan',
  itemName: 'barang',
  category: 'kategori',
  shipmentId: 'surat jalan',
  stockItemId: 'barang gudang',
  qty: 'jumlah'
};

function describeChanges(before: any, after: Resolved): string {
  return Object.keys(FIELD_LABELS)
    .filter(key => String(before?.[key] ?? '') !== String((after as any)[key] ?? ''))
    .map(key => FIELD_LABELS[key])
    .join(', ');
}

const historyItem = (user: any, action: string, note?: string) => ({
  at: new Date().toISOString(),
  by: actorName(user),
  action,
  ...(note ? { note } : {})
});

/** Paid by the office: settled the moment it is written down. */
const officeSettlement = (user: any, date: string) => ({
  status: 'Lunas',
  settleMethod: 'Kas Kantor',
  settledAt: date,
  settledBy: actorName(user)
});

const openTalangan = { status: 'Belum Diganti', settleMethod: '', settledAt: '', settledBy: '' };

/*
 * A refusal can come after some rows were already written (the old stock taken
 * back out, then the new item refusing to go negative), so it undoes the whole
 * request rather than letting the 4xx answer commit half of it.
 */
function send(res: Response, run: () => unknown, status = 200) {
  try {
    res.status(status).json(run());
  } catch (err: any) {
    if (!(err instanceof EntryError)) throw err;
    rollbackTransaction();
    res.status(err.status).json({ error: err.message });
  }
}

export const dailyCashRouter = Router();

dailyCashRouter.get('/daily-cash/settings', requireModule(), (req: Request, res: Response) => {
  const user = actor(req);
  const pjUserId = currentPjUserId();
  const pj = pjUserId ? findById('users', pjUserId) : null;
  res.json({
    pjUserId,
    pjName: pj ? actorName(pj) : '',
    isPj: isPj(user),
    canChangePj: user?.role === 'Super Admin'
  });
});

/*
 * Appointing the PJ is the one thing a Super Admin does here, so the page is
 * never locked for good when the PJ leaves. It grants no power over entries.
 */
dailyCashRouter.put('/daily-cash/settings', requireModule(), (req: Request, res: Response) => {
  const user = actor(req);
  if (user?.role !== 'Super Admin') {
    return res.status(403).json({ error: 'Hanya Super Admin yang bisa mengganti PJ Catatan Harian.' });
  }
  const target = findById('users', text(req.body?.pjUserId));
  if (!target) return res.status(400).json({ error: 'Pilih akun staf yang akan menjadi PJ.' });
  const saved = findById(SETTINGS, SETTINGS_ID)
    ? updateItem(SETTINGS, SETTINGS_ID, { pjUserId: target.id, changedBy: actorName(user) })
    : insertItem(SETTINGS, { id: SETTINGS_ID, pjUserId: target.id, changedBy: actorName(user) });
  res.json({ pjUserId: saved.pjUserId, pjName: actorName(target) });
});

dailyCashRouter.post('/daily-cash/entries', requirePj, (req: Request, res: Response) =>
  send(res, () => {
    const user = actor(req);
    const resolved = resolveEntry(req.body);
    const id = nextId(ENTRIES, 'CKH');
    const stockReceiptId = syncStock(null, resolved, id, user);
    return insertItem(ENTRIES, {
      id,
      ...resolved,
      stockReceiptId,
      ...(resolved.paidWith === 'Kas Kantor' ? officeSettlement(user, resolved.date) : openTalangan),
      cancelReason: '',
      createdBy: actorName(user),
      history: [historyItem(user, 'Dicatat')]
    });
  }, 201)
);

dailyCashRouter.put('/daily-cash/entries/:id', requirePj, (req: Request, res: Response) =>
  send(res, () => {
    const user = actor(req);
    const existing = findById(ENTRIES, req.params.id);
    if (!existing) throw new EntryError('Catatan tidak ditemukan.', 404);
    if (existing.status === 'Dibatalkan') throw new EntryError(`${existing.id} sudah dibatalkan dan tidak bisa diubah.`, 409);

    const resolved = resolveEntry(req.body, existing.id);
    const settledTalangan = existing.paidWith === 'Ditalangi' && existing.status === 'Lunas';
    if (
      settledTalangan &&
      (resolved.paidWith !== existing.paidWith ||
        resolved.amount !== Number(existing.amount) ||
        resolved.payerName !== existing.payerName)
    ) {
      throw new EntryError(
        `${existing.id} sudah diganti ke ${existing.payerName}. Kembalikan ke Belum Diganti dulu sebelum mengubah nominal, penalang, atau cara bayar.`,
        409
      );
    }

    const changes = describeChanges(existing, resolved);
    if (!changes) return existing;

    const stockReceiptId = syncStock(existing, resolved, existing.id, user);
    const statusChange =
      resolved.paidWith === existing.paidWith
        ? {}
        : resolved.paidWith === 'Kas Kantor'
          ? officeSettlement(user, resolved.date)
          : openTalangan;

    return updateItem(ENTRIES, existing.id, {
      ...resolved,
      stockReceiptId,
      ...statusChange,
      history: [...(existing.history || []), historyItem(user, 'Diubah', changes)]
    });
  })
);

dailyCashRouter.post('/daily-cash/entries/:id/cancel', requirePj, (req: Request, res: Response) =>
  send(res, () => {
    const user = actor(req);
    const existing = findById(ENTRIES, req.params.id);
    if (!existing) throw new EntryError('Catatan tidak ditemukan.', 404);
    if (existing.status === 'Dibatalkan') throw new EntryError(`${existing.id} sudah dibatalkan.`, 409);
    if (existing.paidWith === 'Ditalangi' && existing.status === 'Lunas') {
      throw new EntryError(
        `${existing.id} sudah diganti ke ${existing.payerName}. Kembalikan ke Belum Diganti dulu kalau catatan ini memang batal.`,
        409
      );
    }
    const reason = text(req.body?.reason);
    if (!reason) throw new EntryError('Tulis alasan pembatalan.');

    syncStock(existing, null, existing.id, user);
    return updateItem(ENTRIES, existing.id, {
      status: 'Dibatalkan',
      cancelReason: reason,
      history: [...(existing.history || []), historyItem(user, 'Dibatalkan', reason)]
    });
  })
);

/** Pays back one or more talangan at once, usually one person's in the afternoon. */
dailyCashRouter.post('/daily-cash/settle', requirePj, (req: Request, res: Response) =>
  send(res, () => {
    const user = actor(req);
    const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids.map((id: unknown) => text(id)).filter(Boolean) : [];
    if (ids.length === 0) throw new EntryError('Pilih catatan yang dilunasi.');
    const method = text(req.body?.method);
    if (!SETTLE_METHODS.includes(method)) throw new EntryError('Pilih cara pelunasan: Transfer atau Tunai.');
    const date = isDate(req.body?.date) ? String(req.body.date) : todayJakarta();

    const entries = ids.map(id => findById(ENTRIES, id));
    const missing = ids.filter((_, i) => !entries[i]);
    if (missing.length > 0) throw new EntryError(`Catatan ${missing.join(', ')} tidak ditemukan.`, 404);
    const notOpen = entries.filter(e => !isOpenTalangan(e));
    if (notOpen.length > 0) {
      throw new EntryError(`${notOpen.map(e => e.id).join(', ')} bukan talangan yang belum diganti. Muat ulang halaman.`, 409);
    }

    const note = `${method} ${date}`;
    return entries.map(entry =>
      updateItem(ENTRIES, entry.id, {
        status: 'Lunas',
        settleMethod: method,
        settledAt: date,
        settledBy: actorName(user),
        history: [...(entry.history || []), historyItem(user, 'Dilunasi', note)]
      })
    );
  })
);

/** Undoes a settlement recorded by mistake. The reason stays in the history. */
dailyCashRouter.post('/daily-cash/entries/:id/reopen', requirePj, (req: Request, res: Response) =>
  send(res, () => {
    const user = actor(req);
    const existing = findById(ENTRIES, req.params.id);
    if (!existing) throw new EntryError('Catatan tidak ditemukan.', 404);
    if (!(existing.paidWith === 'Ditalangi' && existing.status === 'Lunas')) {
      throw new EntryError(`${existing.id} bukan talangan yang sudah lunas.`, 409);
    }
    const reason = text(req.body?.reason);
    if (!reason) throw new EntryError('Tulis alasan mengembalikan ke Belum Diganti.');
    return updateItem(ENTRIES, existing.id, {
      ...openTalangan,
      history: [...(existing.history || []), historyItem(user, 'Dikembalikan ke Belum Diganti', reason)]
    });
  })
);
