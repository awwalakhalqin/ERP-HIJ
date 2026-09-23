import Dexie, { type Table } from 'dexie';
import { 
  Order, 
  SPK, 
  WIPBundle, 
  Customer, 
  FabricRoll, 
  QCReport, 
  Shipment, 
  Invoice, 
  OfflineQueueItem,
  StoreProduct,
  StoreOrder
} from '../types';

export class KonveksiDatabase extends Dexie {
  orders!: Table<Order, string>;
  spks!: Table<SPK, string>;
  wipBundles!: Table<WIPBundle, string>;
  customers!: Table<Customer, string>;
  fabricRolls!: Table<FabricRoll, string>;
  qcReports!: Table<QCReport, string>;
  shipments!: Table<Shipment, string>;
  invoices!: Table<Invoice, string>;
  offlineQueue!: Table<OfflineQueueItem, number>;
  syncQueue!: Table<OfflineQueueItem, number>;
  storeProducts!: Table<StoreProduct, string>;
  storeOrders!: Table<StoreOrder, string>;

  constructor() {
    super('HIJKonveksiDB');
    this.version(2).stores({
      orders: 'id, customerId, status, deadline, po',
      spks: 'id, orderId, customerId, status',
      wipBundles: 'id, spkId, orderId, currentStage, status',
      customers: 'id, name, phone, email',
      fabricRolls: 'id, fabricName, color, rackLocation, status',
      qcReports: 'id, orderId, spkId, status',
      shipments: 'id, orderId, courier, status, trackingNumber',
      invoices: 'id, orderId, customerId, status',
      offlineQueue: '++id, table, action, synced',
      syncQueue: '++id, table, action, synced',
      storeProducts: 'id, sku, category, isAvailable',
      storeOrders: 'id, customerPhone, paymentStatus, orderStatus'
    });
  }
}

export const db = new KonveksiDatabase();

/** Tables that mirror server rows; the two queues hold unsent local writes and are kept. */
const QUEUE_TABLES = new Set(['offlineQueue', 'syncQueue']);

/*
 * Forget the previous user's cached rows. On a shared factory PC the next person
 * to log in must not see orders or invoices that were mirrored for someone else.
 */
export async function clearCachedMirror() {
  await Promise.all(
    db.tables
      .filter(table => !QUEUE_TABLES.has(table.name))
      .map(table => table.clear().catch(() => {}))
  );
}

export interface SyncFailure {
  id: number;
  error: string;
}

export interface SyncResult {
  syncedCount: number;
  failed: SyncFailure[];
}

/** Ids minted while offline; the server assigns the real one when the write is replayed. */
const isOfflineId = (id: unknown) => typeof id === 'string' && id.startsWith('OFF-');

// Sync offline queue with server
export async function syncOfflineQueue(): Promise<SyncResult> {
  /*
   * Items are queued with `synced: false`. A boolean is not a valid IndexedDB
   * key, so an indexed `where('synced').equals(0)` never matched anything and
   * the queue was never replayed. Filtering reads every row instead.
   */
  const pendingItems = await db.offlineQueue.filter(item => !item.synced).toArray();
  const failed: SyncFailure[] = [];
  if (pendingItems.length === 0) return { syncedCount: 0, failed };

  // Read directly rather than importing services/api, which imports this file.
  let token: string | null = null;
  try {
    token = localStorage.getItem('hij_auth_token');
  } catch {}

  let syncedCount = 0;
  for (const item of pendingItems) {
    if (item.id === undefined) continue;

    // A CREATE queued offline carries a placeholder id; the server issues the real one.
    let body: OfflineQueueItem = item;
    let placeholderId: string | undefined;
    if (item.action === 'CREATE' && isOfflineId(item.payload?.id)) {
      const { id: offId, ...payloadWithoutId } = item.payload;
      placeholderId = offId;
      body = { ...item, payload: payloadWithoutId };
    }

    let response: Response;
    try {
      response = await fetch(`/api/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(body)
      });
    } catch (err) {
      console.warn('Sync failed for item', item.id, err);
      break; // Pause until connectivity stabilizes
    }

    if (response.ok) {
      await db.offlineQueue.delete(item.id);
      // The placeholder row would otherwise sit beside the server's copy until the next full fetch.
      if (placeholderId) {
        try {
          const mirror = (db as any)[item.table.replace('-', '')];
          if (mirror) await mirror.delete(placeholderId);
        } catch {}
      }
      syncedCount++;
      continue;
    }

    /*
     * A 4xx is the server's final answer: the id is taken, the rule no longer
     * allows it, or the account lost access. Retrying would only fail the same
     * way, so the item is dropped and the reason reported instead.
     */
    if (response.status >= 400 && response.status < 500) {
      const data = await response.json().catch(() => ({} as any));
      failed.push({ id: item.id, error: data.error || `Server menolak (${response.status}).` });
      await db.offlineQueue.delete(item.id);
      continue;
    }

    // 5xx: the server is unwell; keep the item and try the rest later.
    console.warn('Sync deferred for item', item.id, response.status);
    break;
  }

  return { syncedCount, failed };
}
