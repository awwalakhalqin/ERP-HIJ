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

// Sync offline queue with server
export async function syncOfflineQueue() {
  const pendingItems = await db.offlineQueue.where('synced').equals(0).toArray();
  if (pendingItems.length === 0) return { syncedCount: 0 };

  let syncedCount = 0;
  for (const item of pendingItems) {
    try {
      const response = await fetch(`/api/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item)
      });
      if (response.ok) {
        if (item.id) {
          await db.offlineQueue.delete(item.id);
          syncedCount++;
        }
      }
    } catch (err) {
      console.warn('Sync failed for item', item.id, err);
      break; // Pause until connectivity stabilizes
    }
  }

  return { syncedCount };
}
