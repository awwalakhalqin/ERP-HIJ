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
    throw new Error(`Server returned status ${res.status}`);
  } catch (err: any) {
    if (err.message && !err.message.includes('Failed to fetch') && !err.message.includes('NetworkError') && !err.message.includes('Server returned status 5')) {
      throw err;
    }
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
    throw new Error(`Server returned status ${res.status}`);
  } catch (err: any) {
    if (err.message && !err.message.includes('Failed to fetch') && !err.message.includes('NetworkError') && !err.message.includes('Server returned status 5')) {
      throw err;
    }
    console.warn(`Server unreachable, updating offline queue...`);
    const fallbackItem = { ...payload, id };
    try {
      const tableName = resource.replace('-', '');
      if ((db as any)[tableName]) {
        await (db as any)[tableName].put(fallbackItem);
      }
      await db.offlineQueue.add({
        table: resource,
        action: 'UPDATE',
        payload: fallbackItem,
        timestamp: new Date().toISOString(),
        synced: false
      });
    } catch {}
    return fallbackItem as T;
  }
}

export async function deleteResource(resource: string, id: string): Promise<boolean> {
  try {
    const res = await apiFetch(`${API_BASE}/${resource}/${id}`, { method: 'DELETE' });
    if (res.ok) {
      try {
        const tableName = resource.replace('-', '');
        if ((db as any)[tableName]) {
          await (db as any)[tableName].delete(id);
        }
      } catch {}
      return true;
    }
    return false;
  } catch (err) {
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
}

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
  if (!res.ok) throw new Error('Failed to upload file');
  const data = await res.json();
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

  const data = await res.json().catch(() => ({} as any));

  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Username atau kata sandi salah.');
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

export async function fetchCustomerPortalDataApi(customerId: string) {
  try {
    const res = await apiFetch(`${API_BASE}/customer-portal/data/${customerId}`);
    if (res.ok) {
      const data = await res.json();
      if (data && (data.orders?.length > 0 || data.spks?.length > 0)) {
        return data;
      }
    }
  } catch (err) {
    console.warn('Customer portal API network error, falling back to local storage/resource fetch:', err);
  }

  // Graceful fallback from individual tables
  const [orders, spks, designs, samples, invoices, shipments, returns] = await Promise.all([
    fetchResource<any>('orders').catch(() => []),
    fetchResource<any>('spk_produksi').catch(() => []),
    fetchResource<any>('designs').catch(() => []),
    fetchResource<any>('samples').catch(() => []),
    fetchResource<any>('invoices').catch(() => []),
    fetchResource<any>('shipments').catch(() => []),
    fetchResource<any>('returns_complaints').catch(() => [])
  ]);

  const cleanId = String(customerId || '').toLowerCase();
  const filterByCust = (items: any[]) => {
    const filtered = items.filter(item => 
      String(item.customerId || '').toLowerCase() === cleanId || 
      String(item.customerName || '').toLowerCase().includes('arkato')
    );
    return filtered.length > 0 ? filtered : items.slice(0, 3);
  };

  return {
    orders: filterByCust(orders),
    spks: filterByCust(spks),
    designs: filterByCust(designs),
    samples: filterByCust(samples),
    invoices: filterByCust(invoices),
    shipments: filterByCust(shipments),
    returns: returns.filter(r => String(r.customerId || '').toLowerCase() === cleanId)
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

