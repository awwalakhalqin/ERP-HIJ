import { db } from '../db/dexie';
import type { Payment, Sample, Procurement, Pattern, Design, SPK, Order, AuthSession, User, CustomerSession } from '../types';
import { STAFF_ROLE_MODULES } from '../types';
import type { ReadinessData } from '../lib/readiness';

const API_BASE = '/api';

/*
 * The server now signs a session token at login and requires it on every call.
 * It lives beside the session App.tsx already persists, and apiFetch attaches it
 * so no individual call site has to remember to.
 */
const TOKEN_KEY = 'hij_auth_token';

export function setAuthToken(token?: string) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private browsing can refuse storage; the session simply won't survive a reload.
  }
}

export function getAuthToken(): string | undefined {
  try {
    return localStorage.getItem(TOKEN_KEY) || undefined;
  } catch {
    return undefined;
  }
}

/** Raised when the server rejects the session, so callers can tell it apart from being offline. */
export class AuthExpiredError extends Error {
  constructor() {
    super('Sesi Anda sudah berakhir. Silakan masuk lagi.');
    this.name = 'AuthExpiredError';
  }
}

export const AUTH_EXPIRED_EVENT = 'hij:auth-expired';

/*
 * A 401 is not a network problem. Falling back to cached data on one would show
 * a half-empty app to someone whose session has simply lapsed — which is what
 * happened to the design dropdown: the request was rejected, the error was
 * swallowed, and the list rendered empty as if no designs existed.
 */
function handleUnauthorized() {
  setAuthToken(undefined);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
  }
}

async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = getAuthToken();
  const headers = new Headers(init.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(input, { ...init, headers });
  if (res.status === 401) handleUnauthorized();
  return res;
}

/** Loads everything getOrderReadiness() needs, in one round of requests. */
export async function fetchReadinessData(): Promise<ReadinessData> {
  const [payments, samples, procurements, patterns, designs] = await Promise.all([
    fetchResource<Payment>('payments'),
    fetchResource<Sample>('samples'),
    fetchResource<Procurement>('procurements'),
    fetchResource<Pattern>('patterns'),
    fetchResource<Design>('designs')
  ]);
  return { payments, samples, procurements, patterns, designs };
}

export interface StaffDirectoryEntry {
  id: string;
  name: string;
  role: string;
}

/** Staff accounts by name and role, for naming a PIC on quotations and orders. */
export async function fetchStaffDirectory(): Promise<StaffDirectoryEntry[]> {
  const res = await apiFetch(`${API_BASE}/staff-directory`);
  if (!res.ok) return [];
  return res.json();
}

/** SOP-20: the order's PIC confirms a transfer proof received over WhatsApp; the payment lands verified. */
export async function approveDpApi(
  orderId: string,
  body: { amount: number; date?: string; bankAccount?: string; paymentMethod?: string; notes?: string }
): Promise<{ message: string; payment: Payment; order: Order; invoice: unknown }> {
  const res = await apiFetch(`${API_BASE}/orders/${orderId}/approve-dp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Gagal menyetujui DP. Coba lagi.');
  return data;
}

/** SOP-03: asks the server to issue the SPK. Throws with the server's reason when requirements are unmet. */
export async function issueSpkApi(
  orderId: string,
  body: { plannedStart?: string; notes?: string; user?: string } = {}
): Promise<{ message: string; spk: SPK; order: Order }> {
  const res = await apiFetch(`${API_BASE}/orders/${orderId}/issue-spk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Gagal menerbitkan SPK. Coba lagi.');
  }
  return data;
}

export async function fetchResource<T = any>(resource: string): Promise<T[]> {
  try {
    const res = await apiFetch(`${API_BASE}/${resource}`);
    if (res.ok) {
      const data = await res.json();
      // Cache in Dexie if table exists
      try {
        const tableName = resource.replace('-', '');
        if ((db as any)[tableName]) {
          await (db as any)[tableName].clear();
          await (db as any)[tableName].bulkPut(data);
        }
      } catch (err) {
        // dexie table might not match exact name, ignore
      }
      return data;
    }
    if (res.status === 401 || res.status === 403) throw new AuthExpiredError();
    throw new Error(`HTTP error ${res.status}`);
  } catch (err) {
    // An expired session must surface; only a genuine network failure falls back.
    if (err instanceof AuthExpiredError) throw err;
    console.warn(`Network fetch failed for ${resource}, trying Dexie fallback...`);
    try {
      const tableName = resource.replace('-', '');
      if ((db as any)[tableName]) {
        return await (db as any)[tableName].toArray();
      }
    } catch {}
    return [];
  }
}

/*
 * Only floor records may wait in the offline queue. Orders, money, SPKs,
 * shipments and accounts have gates on their live routes that a replay would
 * skip, so offline they fail loudly instead of pretending to be saved.
 */
const OFFLINE_QUEUE_BLOCKED = new Set([
  'orders', 'quotations', 'customers', 'invoices', 'payments', 'shipments',
  'spk', 'spk_produksi', 'users', 'qc-reports', 'qc_reports', 'designs', 'samples', 'size-charts', 'size_charts'
]);
const OFFLINE_REFUSED = 'Tidak ada koneksi ke server. Data ini tidak bisa disimpan offline — coba lagi saat terhubung.';

export async function createResource<T = any>(resource: string, payload: any): Promise<T> {
  try {
    const res = await apiFetch(`${API_BASE}/${resource}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      const created = await res.json();
      try {
        const tableName = resource.replace('-', '');
        if ((db as any)[tableName]) {
          await (db as any)[tableName].put(created);
        }
      } catch {}
      return created;
    }
    const errData = await res.json().catch(() => ({}));
    const errorMsg = errData.error || `Server error (${res.status})`;
    if (res.status >= 400 && res.status < 500) {
      throw new Error(errorMsg);
    }
    throw new Error(errorMsg.startsWith('Server error') ? 'Server sedang bermasalah. Coba lagi sebentar.' : errorMsg);
  } catch (err: any) {
    /*
     * Only a request that never reached the server is queued for later. A 5xx
     * did reach it and failed there; reporting that as saved-offline showed a
     * success toast over an error and a queue item the server would reject.
     */
    if (err.message && !err.message.includes('Failed to fetch') && !err.message.includes('NetworkError')) {
      throw err;
    }
    if (OFFLINE_QUEUE_BLOCKED.has(resource.toLowerCase())) throw new Error(OFFLINE_REFUSED);
    console.warn(`Server unreachable, saving locally in Dexie offline queue...`);
    const fallbackItem = {
      ...payload,
      id: payload.id || `OFF-${Date.now()}`,
      timestamp: new Date().toISOString()
    };
    try {
      const tableName = resource.replace('-', '');
      if ((db as any)[tableName]) {
        await (db as any)[tableName].put(fallbackItem);
      }
      await db.offlineQueue.add({
        table: resource,
        action: 'CREATE',
        payload: fallbackItem,
        timestamp: new Date().toISOString(),
        synced: false
      });
    } catch {}
    return fallbackItem as T;
  }
}

export async function updateResource<T = any>(resource: string, id: string, payload: any): Promise<T> {
  try {
    const res = await apiFetch(`${API_BASE}/${resource}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      const updated = await res.json();
      try {
        const tableName = resource.replace('-', '');
        if ((db as any)[tableName]) {
          await (db as any)[tableName].put(updated);
        }
      } catch {}
      return updated;
    }
    const errData = await res.json().catch(() => ({}));
    const errorMsg = errData.error || `Server error (${res.status})`;
    if (res.status >= 400 && res.status < 500) {
      throw new Error(errorMsg);
    }
    throw new Error(errorMsg.startsWith('Server error') ? 'Server sedang bermasalah. Coba lagi sebentar.' : errorMsg);
  } catch (err: any) {
    /*
     * Only a request that never reached the server is queued for later. A 5xx
     * did reach it and failed there; reporting that as saved-offline showed a
     * success toast over an error and a queue item the server would reject.
     */
    if (err.message && !err.message.includes('Failed to fetch') && !err.message.includes('NetworkError')) {
      throw err;
    }
    if (OFFLINE_QUEUE_BLOCKED.has(resource.toLowerCase())) throw new Error(OFFLINE_REFUSED);
    console.warn(`Server unreachable, updating offline queue...`);
    const queuedPatch = { ...payload, id };
    /*
     * Most updates send only the changed fields. Writing that patch over the
     * cached full row would leave a stub with no customer, quantity or price
     * until the next fetch; merge onto what is already cached instead.
     */
    let fallbackItem: any = queuedPatch;
    try {
      const tableName = resource.replace('-', '');
      const mirror = (db as any)[tableName];
      if (mirror) {
        const existing = await mirror.get(id).catch(() => undefined);
        fallbackItem = { ...(existing || {}), ...queuedPatch };
        await mirror.put(fallbackItem);
      }
      await db.offlineQueue.add({
        table: resource,
        action: 'UPDATE',
        payload: queuedPatch,
        timestamp: new Date().toISOString(),
        synced: false
      });
    } catch {}
    return fallbackItem as T;
  }
}

export async function deleteResource(resource: string, id: string): Promise<boolean> {
  let res: Response;
  try {
    res = await apiFetch(`${API_BASE}/${resource}/${id}`, { method: 'DELETE' });
  } catch (err) {
    if (OFFLINE_QUEUE_BLOCKED.has(resource.toLowerCase())) throw new Error(OFFLINE_REFUSED);
    try {
      const tableName = resource.replace('-', '');
      if ((db as any)[tableName]) {
        await (db as any)[tableName].delete(id);
      }
      await db.offlineQueue.add({
        table: resource,
        action: 'DELETE',
        payload: { id },
        timestamp: new Date().toISOString(),
        synced: false
      });
    } catch {}
    return true;
  }

  /*
   * A refusal is not a success. The server declines to delete an order that
   * already has an SPK or payments, and callers used to toast "berhasil
   * dihapus" over it because this returned false instead of throwing.
   */
  if (!res.ok) {
    const data = await res.json().catch(() => ({} as any));
    throw new Error(data.error || `Gagal menghapus (${res.status}).`);
  }
  try {
    const tableName = resource.replace('-', '');
    if ((db as any)[tableName]) {
      await (db as any)[tableName].delete(id);
    }
  } catch {}
  return true;
}

/** fetch with the session token attached, for the few routes outside the generic CRUD helpers. */
export const authFetch = apiFetch;

export async function scanWIPBundle(bundleId: string, nextStage: string, operatorName: string, status?: string) {
  const res = await apiFetch(`${API_BASE}/wip-bundles/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bundleId, nextStage, operatorName, status })
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to scan bundle');
  }
  return await res.json();
}

export async function uploadMedia(file: File): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await apiFetch(`${API_BASE}/upload`, {
    method: 'POST',
    body: formData
  });
  // The server says why it refused (type, size); that reason is the useful message.
  const data = await res.json().catch(() => ({} as any));
  if (!res.ok) throw new Error(data.error || `Gagal mengunggah file (${res.status}).`);
  if (!data.url) throw new Error('Server tidak mengembalikan alamat file.');
  return data.url;
}

/*
 * The client-side login fallback that used to live here is gone. It granted a
 * Super Admin session for the identifier "admin" with no password and no server
 * involved, so hardening the API would not have closed it. A login now succeeds
 * only when the server says so.
 */
export async function unifiedLoginApi(identifier: string, password?: string): Promise<AuthSession> {
  const cleanId = (identifier || '').trim();
  const cleanPass = (password || '').trim();

  if (!cleanId || !cleanPass) {
    throw new Error('Username dan kata sandi wajib diisi.');
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/auth/unified-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: cleanId, password: cleanPass })
    });
  } catch {
    throw new Error('Tidak bisa menghubungi server. Periksa koneksi, lalu coba lagi.');
  }

  /*
   * Only the server's own 401 means the credentials were wrong. A dead API
   * behind the dev proxy (502/504, HTML body) or a crashed server (500) used
   * to fall through to the same "salah" message, sending people to retype a
   * correct password.
   */
  const data = await res.json().catch(() => null);
  if (data === null || (res.status >= 500 && !data?.error)) {
    throw new Error(`Server ERP tidak bisa dihubungi (kode ${res.status}). Pastikan server API berjalan, lalu coba lagi.`);
  }
  if (!res.ok || !data.success) {
    throw new Error(data.error || (res.status === 401 ? 'Username atau kata sandi salah.' : `Login gagal (kode ${res.status}).`));
  }

  setAuthToken(data.token);

  if (data.type === 'internal' && data.user) {
    return { type: 'internal', user: data.user };
  }
  if (data.type === 'customer' && data.customer) {
    return { type: 'customer', customer: data.customer };
  }

  throw new Error('Jawaban server tidak dikenali. Hubungi staf HIJ.');
}

/** Commit a reviewed Excel import plan. */
export async function commitExcelImportApi(payload: unknown) {
  const res = await apiFetch(`${API_BASE}/import/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({} as any));
  if (!res.ok) throw new Error(data.error || 'Impor gagal disimpan.');
  return data;
}

export function logoutApi() {
  setAuthToken(undefined);
}

export async function loginInternalApi(username: string, password: string) {
  const res = await apiFetch(`${API_BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Login gagal.');
  }
  setAuthToken(data.token);
  return data.user;
}

export async function loginCustomerApi(query: string, password: string) {
  // This endpoint used to accept an id alone; it now requires a password.
  const res = await apiFetch(`${API_BASE}/customer-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customerId: query, password })
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Data pesanan atau pelanggan tidak ditemukan.');
  }
  setAuthToken(data.token);
  return data.customer;
}

export interface CustomerPortalData {
  orders: any[];
  spks: any[];
  designs: any[];
  samples: any[];
  invoices: any[];
  shipments: any[];
  returns: any[];
}

/*
 * The server scopes this to the signed-in customer. There is deliberately no
 * client-side fallback: the old one fetched every customer's orders and showed
 * the first three when nothing matched, which is another customer's data.
 */
export async function fetchCustomerPortalDataApi(customerId: string): Promise<CustomerPortalData> {
  let res: Response;
  try {
    res = await apiFetch(`${API_BASE}/customer-portal/data/${encodeURIComponent(customerId)}`);
  } catch {
    throw new Error('Tidak bisa menghubungi server. Periksa koneksi, lalu muat ulang.');
  }
  if (res.status === 401 || res.status === 403) throw new AuthExpiredError();
  const data = await res.json().catch(() => ({} as any));
  if (!res.ok) throw new Error(data.error || `Gagal memuat data pesanan (${res.status}).`);
  return {
    orders: data.orders || [],
    spks: data.spks || [],
    designs: data.designs || [],
    samples: data.samples || [],
    invoices: data.invoices || [],
    shipments: data.shipments || [],
    returns: data.returns || []
  };
}

export async function fetchDashboardStatsApi() {
  const res = await apiFetch(`${API_BASE}/dashboard/stats`);
  if (!res.ok) throw new Error('Failed to fetch stats');
  return await res.json();
}

// ---------------------------------------------------------
// STOREFRONT & INTEGRATIONS API CLIENT
// ---------------------------------------------------------

export async function validateDiscountVoucherApi(code: string, subtotal: number) {
  const res = await apiFetch(`${API_BASE}/store/discounts/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, subtotal })
  });
  const data = await res.json();
  if (!res.ok || !data.valid) {
    throw new Error(data.error || 'Voucher tidak valid.');
  }
  return data;
}

export async function validateReferralCodeApi(code: string) {
  const res = await apiFetch(`${API_BASE}/store/referrals/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code })
  });
  const data = await res.json();
  if (!res.ok || !data.valid) {
    throw new Error(data.error || 'Kode referral tidak ditemukan.');
  }
  return data;
}

export async function payoutReferralCommissionApi(referralId: string, amount: number, bankInfo?: string, notes?: string) {
  const res = await apiFetch(`${API_BASE}/store/referrals/${referralId}/payout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount, bankInfo, notes })
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Gagal mencairkan komisi.');
  }
  return data;
}

export async function storeCheckoutApi(payload: any) {
  const res = await apiFetch(`${API_BASE}/store/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Gagal memproses pesanan.');
  }
  return data;
}

export async function fetchPaymentSettingsApi() {
  const res = await apiFetch(`${API_BASE}/payment/settings`);
  if (!res.ok) throw new Error('Failed to fetch payment config');
  return await res.json();
}

export async function savePaymentSettingsApi(payload: any) {
  const res = await apiFetch(`${API_BASE}/payment/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Gagal menyimpan pengaturan payment');
  return data;
}

export async function simulatePaymentSuccessApi(storeOrderId: string, paymentMethod?: string) {
  const res = await apiFetch(`${API_BASE}/payment/simulate-success`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ storeOrderId, paymentMethod })
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Gagal simulasi pembayaran.');
  }
  return data;
}

export async function fetchDigiflazzSettingsApi() {
  const res = await apiFetch(`${API_BASE}/digiflazz/settings`);
  if (!res.ok) throw new Error('Failed to fetch digiflazz config');
  return await res.json();
}

export async function saveDigiflazzSettingsApi(payload: any) {
  const res = await apiFetch(`${API_BASE}/digiflazz/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Gagal menyimpan pengaturan digiflazz');
  return data;
}

export async function checkDigiflazzBalanceApi() {
  const res = await apiFetch(`${API_BASE}/digiflazz/balance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!res.ok) throw new Error('Gagal mengecek saldo');
  return await res.json();
}

export async function syncDigiflazzPriceListApi() {
  const res = await apiFetch(`${API_BASE}/digiflazz/price-list`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!res.ok) throw new Error('Gagal menyinkronkan daftar harga');
  return await res.json();
}

export async function createDigiflazzTopupApi(payload: { customer_no: string; buyer_sku_code: string; max_price?: number }) {
  const res = await apiFetch(`${API_BASE}/digiflazz/topup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Gagal melakukan transaksi produk digital.');
  }
  return data;
}

