import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import cors from 'cors';
import multer from 'multer';
import crypto from 'crypto';
import { 
  readTable, 
  writeTable, 
  insertItem, 
  updateItem, 
  deleteItem, 
  findById,
  HIJ_MODE,
  DATA_DIR,
  beginTransaction,
  commitTransaction,
  rollbackTransaction,
  inTransaction
} from './db.js';
import { getOrderReadiness, verifiedPaidForOrder, designForOrder } from '../../src/lib/readiness.js';
import {
  nextId,
  activeInvoiceFor,
  activeInvoiceForOrder,
  verifiedPaidForInvoice,
  invoiceStatusFor,
  withAmounts,
  syncOrderStatus,
  syncAllOrderStatuses,
  sampleSettled,
  nextRevision,
  reconcileInvoice,
  createInvoiceForOrder,
  reviseInvoice,
  syncInvoiceTerms,
  syncTermsForOrder,
  openTermFor,
  syncCreditFor,
  creditForInvoice,
  creditOwedFor,
  creditUsed,
  overdueTermsForCustomer
} from './flow.js';
import {
  planTerms,
  scheduleError,
  paymentTypeForTerm,
  termTrigger,
  TERM_TRIGGER_LABELS,
  DEFAULT_TERM_DUE_DAYS,
  DEDUCTION_TYPES,
  addDays,
  localDate,
  SAMPLE_MADE_STATUSES
} from '../../src/lib/terms.js';
import {
  hashPassword,
  verifyPassword,
  issueToken,
  attachActor,
  requireAuth,
  requireStaff,
  requireSelfOrStaff,
  stripSensitive,
  passwordVersion
} from './auth.js';
import { requireModule, writeBlockReason, readBlockReason, usersWriteBlockReason, STAFF_ROLE_MODULES, canOpen, isFullAdmin } from './access.js';
import { recomputeSpk, recomputeAllSpks, completeSpkForOrder, spkQcAccepted, SPK_SOURCE_TABLES } from './spk.js';
import { canApproveSpecialTerms } from '../../src/lib/readiness.js';
import { designMockups, isArtwork } from '../../src/lib/mockups.js';
import { dailyCashRouter } from './dailyCash.js';
import { COMPANY_CONTACT } from '../../src/config/contact.js';
import { STANDARD_SIZE_CHARTS, SIZE_CHART_COMMON_NOTES } from '../../src/config/sizeChartTemplates.js';
import dotenv from 'dotenv';
dotenv.config();

const app = express();

/*
 * Hosting panels (Hostinger, pm2 behind Caddy) put a reverse proxy in front of
 * Node, so req.ip is the proxy and every visitor would share one login
 * throttle. Forwarded addresses are trusted only when the direct peer is a
 * private or loopback address — a client on the internet cannot spoof them.
 * TRUST_PROXY overrides this (e.g. "1" or "false").
 */
const trustProxy = process.env.TRUST_PROXY;
app.set(
  'trust proxy',
  trustProxy === undefined || trustProxy === ''
    ? 'loopback, linklocal, uniquelocal'
    : trustProxy === 'false' ? false : /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy
);
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;

/*
 * ALLOWED_ORIGINS names the sites that may call this API, comma separated, e.g.
 *   ALLOWED_ORIGINS=https://hijkonveksi.com,https://www.hijkonveksi.com
 * Left empty the API answers every origin, which is fine on a closed network and
 * wrong the moment the address is reachable from the internet — so a public
 * deployment without it gets a loud warning at boot rather than silent exposure.
 */
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

app.use(
  cors(
    allowedOrigins.length > 0
      ? {
          origin(origin, callback) {
            // No Origin header means same-origin or a non-browser client (curl,
            // the PWA itself); those were never the cross-site risk.
            if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
            // Withhold the header rather than throwing: the browser blocks the
            // read either way, and a 500 would turn every probe into noise in
            // the logs and leak that the origin check exists.
            callback(null, false);
          }
        }
      : {}
  )
);
app.disable('x-powered-by');
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), payment=()');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  }
  next();
});
// Only the workbook import and the offline replay carry big bodies; a 49 MB
// "notes" field on a public route used to be accepted and persisted.
app.use(['/api/import/commit', '/api/sync'], express.json({ limit: '50mb' }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(attachActor((type, id) => findById(type === 'internal' ? 'users' : 'customers', id)));

/*
 * Satu request = satu transaksi.
 *
 * Beberapa aksi menyentuh banyak tabel sekaligus — menyetujui penawaran
 * menulis pesanan, penawaran, dan faktur; revisi deal menulis enam tabel.
 * Dulu tiap penulisan berdiri sendiri, jadi proses yang mati di tengah urutan
 * meninggalkan faktur tanpa pesanan yang cocok. Sekarang transaksi ditutup
 * sebelum jawaban dikirim, dan apa pun yang gagal membatalkan seluruh aksi.
 *
 * Hanya jalur /api yang dibungkus: berkas statis tidak menyentuh basis data.
 */
app.use('/api', (_req: Request, res: Response, next: NextFunction) => {
  beginTransaction();
  let settled = false;
  const settle = (ok: boolean) => {
    if (settled || !inTransaction()) return;
    settled = true;
    if (ok) commitTransaction();
    else rollbackTransaction();
  };

  // Commit sebelum badan jawaban terkirim, supaya klien tidak pernah menerima
  // "berhasil" untuk penulisan yang ternyata gagal disimpan.
  const json = res.json.bind(res);
  res.json = (body?: any) => {
    try {
      settle(res.statusCode < 500);
    } catch (err) {
      console.error('Commit gagal:', err);
      if (!res.headersSent) return json({ error: 'Perubahan tidak bisa disimpan. Coba lagi.' });
    }
    return json(body);
  };
  const send = res.send.bind(res);
  res.send = (body?: any) => {
    settle(res.statusCode < 500);
    return send(body);
  };

  // Jaring pengaman: jawaban yang tidak lewat json()/send(), atau koneksi putus.
  res.on('finish', () => settle(res.statusCode < 500));
  res.on('close', () => settle(false));
  next();
});

/*
 * The storefront, payment gateway and top-up integrations are a separate
 * product the factory does not run. Their routes take unauthenticated writes
 * (checkout, webhooks), so they stay switched off unless STOREFRONT_ENABLED=1.
 */
const STOREFRONT_ENABLED = ['1', 'true', 'yes'].includes(String(process.env.STOREFRONT_ENABLED || '').toLowerCase());
app.use(['/api/store', '/api/payment', '/api/digiflazz'], (_req: Request, res: Response, next: NextFunction) => {
  if (STOREFRONT_ENABLED) return next();
  res.status(404).json({ error: 'Fitur toko online tidak diaktifkan di server ini.' });
});

// Directories
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
const TEMPLATES_DIR = path.join(process.cwd(), 'public', 'templates');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(TEMPLATES_DIR)) fs.mkdirSync(TEMPLATES_DIR, { recursive: true });

app.use('/uploads', express.static(UPLOADS_DIR), (_req: Request, res: Response) => {
  res.status(404).json({ error: 'Berkas tidak ditemukan.' });
});
app.use('/templates', express.static(TEMPLATES_DIR));

// Multer storage
/*
 * Only the formats the app actually produces: mockups and payment proofs. The
 * extension comes from the accepted MIME type rather than the filename, so
 * "bukti.png.html" cannot land on disk as HTML — uploads are served straight
 * back from this same origin.
 */
const ALLOWED_UPLOAD_TYPES: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'application/pdf': '.pdf'
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = ALLOWED_UPLOAD_TYPES[file.mimetype] || '.bin';
    const base = path.basename(file.originalname, path.extname(file.originalname));
    const cleanName = base.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'file';
    // Payment proofs and designs are served without login; a guessable name
    // (original name + timestamp) let anyone enumerate them.
    cb(null, `${cleanName}_${crypto.randomBytes(9).toString('base64url')}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_UPLOAD_TYPES[file.mimetype]) return cb(null, true);
    cb(new Error('Jenis berkas tidak didukung. Unggah PNG, JPG, WebP, atau PDF.'));
  }
});

// Health check
app.get('/api/health', (_req: Request, res: Response) => {
  // `mode` drives the banner in the UI: nobody should be able to type trial data
  // for ten minutes before noticing which dataset they were on.
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    version: '1.0.0',
    mode: HIJ_MODE,
    // Forward slashes so the banner reads the same on Windows and Linux. Public
    // route: the server's folder layout is nobody's business in production.
    ...(process.env.NODE_ENV === 'production'
      ? {}
      : { dataDir: (path.relative(process.cwd(), DATA_DIR) || 'server/data').split(path.sep).join('/') })
  });
});

// File upload endpoint
app.post(
  '/api/upload',
  requireAuth,
  // Multer rejects by throwing; without this the refusal surfaces as a 500.
  (req: Request, res: Response, next: NextFunction) => {
    upload.single('file')(req, res, (err: unknown) => {
      if (err) {
        return res.status(400).json({ error: err instanceof Error ? err.message : 'Unggahan ditolak.' });
      }
      next();
    });
  },
  (req: Request, res: Response) => {
    if (!req.file) {
      return res.status(400).json({ error: 'Tidak ada file yang diunggah.' });
    }
    const url = `/uploads/${req.file.filename}`;
    res.json({ success: true, url, filename: req.file.filename });
  }
);

// ---------------------------------------------------------
// AUTHENTICATION (UNIFIED SINGLE-PAGE LOGIN)
// ---------------------------------------------------------

// The role → menu defaults live in access.ts, shared with the permission checks.

// Unified Smart Login: Auto-detects Staff (5 roles) vs Customer (1 role)
/*
 * One message for every failed attempt. Saying "username tidak ditemukan"
 * versus "password salah" tells an attacker which half they got right.
 */
const LOGIN_FAILED = 'Username atau kata sandi salah.';

/** Identifiers are matched exactly. Substring matching let one guess hit any account. */
function findStaff(users: any[], ident: string) {
  return users.filter(u => u.status !== 'Inactive').find(u =>
    String(u.username || '').toLowerCase() === ident ||
    String(u.id || '').toLowerCase() === ident ||
    (u.email && String(u.email).toLowerCase() === ident)
  );
}

function findCustomer(customers: any[], ident: string, digits: string) {
  return customers.filter(c => c.portalAccessActive !== false && c.status !== 'Inactive').find(c =>
    String(c.username || '').toLowerCase() === ident ||
    String(c.id || '').toLowerCase() === ident ||
    (c.email && String(c.email).toLowerCase() === ident) ||
    (digits.length >= 8 && String(c.phone || '').replace(/\D/g, '') === digits) ||
    (digits.length >= 8 && String(c.contact || '').replace(/\D/g, '') === digits)
  );
}

/*
 * Records were seeded with plaintext passwords. The first correct login
 * replaces the stored value with a scrypt hash, so the file heals itself as
 * people sign in instead of needing a migration everyone has to wait for.
 */
function upgradeStoredPassword(table: string, id: string, plain: string, needsUpgrade: boolean) {
  if (!needsUpgrade) return;
  try {
    updateItem(table, id, { password: hashPassword(plain) });
  } catch (e) {
    console.warn(`Gagal memperbarui hash kata sandi untuk ${table}/${id}:`, e);
  }
}

function staffSession(user: any) {
  const allowed = (user.allowedModules && user.allowedModules.length > 0)
    ? user.allowedModules
    : (STAFF_ROLE_MODULES[user.role] || ['*']);
  const safeUser = stripSensitive({ ...user, allowedModules: allowed });
  return {
    success: true,
    type: 'internal' as const,
    token: issueToken({ sub: String(user.id), type: 'internal', role: user.role, pv: passwordVersion(user.password) }),
    user: safeUser
  };
}

function customerSession(customer: any) {
  return {
    success: true,
    type: 'customer' as const,
    token: issueToken({ sub: String(customer.id), type: 'customer', pv: passwordVersion(customer.password) }),
    customer: stripSensitive(customer)
  };
}

/*
 * Login throttle. Passwords are twelve random characters, but the customer
 * usernames are guessable brand names, so an attacker with a word list gets
 * ten tries per address per quarter hour and then waits. In memory: a restart
 * clears it, which is fine for a single-process app.
 */
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;
/*
 * The per-account key alone let one address try a common password against
 * every username in turn (spraying). This second key caps the address itself.
 */
const LOGIN_MAX_FAILURES_PER_IP = 30;
const loginFailures = new Map<string, { count: number; first: number }>();

function loginThrottleKey(req: Request) {
  return `${req.ip || 'ip'}|${String(req.body?.identifier || req.body?.username || req.body?.customerId || '').trim().toLowerCase()}`;
}
const loginIpKey = (req: Request) => `ip:${req.ip || 'ip'}`;

function throttleHit(key: string, max: number): boolean {
  const entry = loginFailures.get(key);
  if (!entry) return false;
  if (Date.now() - entry.first > LOGIN_WINDOW_MS) {
    loginFailures.delete(key);
    return false;
  }
  return entry.count >= max;
}
function loginBlocked(req: Request): boolean {
  return throttleHit(loginThrottleKey(req), LOGIN_MAX_FAILURES) || throttleHit(loginIpKey(req), LOGIN_MAX_FAILURES_PER_IP);
}
function bumpFailure(key: string) {
  const entry = loginFailures.get(key);
  if (!entry || Date.now() - entry.first > LOGIN_WINDOW_MS) loginFailures.set(key, { count: 1, first: Date.now() });
  else entry.count += 1;
}
function noteLoginFailure(req: Request) {
  bumpFailure(loginThrottleKey(req));
  bumpFailure(loginIpKey(req));
  // Keep the map from growing without bound under a scan.
  if (loginFailures.size > 5000) {
    for (const [k, v] of loginFailures) if (Date.now() - v.first > LOGIN_WINDOW_MS) loginFailures.delete(k);
  }
}
const LOGIN_THROTTLED = 'Terlalu banyak percobaan masuk. Tunggu 15 menit lalu coba lagi.';

/*
 * An unknown username answered instantly while a known one paid for scrypt, so
 * response time told an attacker which usernames exist. Unknown names now pay
 * the same cost against a throwaway hash.
 */
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));
const burnPasswordCheck = (password: string) => { verifyPassword(password, DUMMY_HASH); };

app.post('/api/auth/unified-login', (req: Request, res: Response) => {
  const identifier = String(req.body.identifier || req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (loginBlocked(req)) return res.status(429).json({ success: false, error: LOGIN_THROTTLED });

  if (!identifier || !password) {
    return res.status(400).json({ success: false, error: 'Username dan kata sandi wajib diisi.' });
  }

  const ident = identifier.toLowerCase();
  const digits = identifier.replace(/\D/g, '');

  const matchedUser = findStaff(readTable('users'), ident);
  if (matchedUser) {
    const check = verifyPassword(password, matchedUser.password);
    if (!check.ok) {
      noteLoginFailure(req);
      return res.status(401).json({ success: false, error: LOGIN_FAILED });
    }
    loginFailures.delete(loginThrottleKey(req));
    upgradeStoredPassword('users', matchedUser.id, password, check.needsUpgrade);
    return res.json(staffSession(matchedUser));
  }

  const matchedCustomer = findCustomer(readTable('customers'), ident, digits);
  if (matchedCustomer) {
    const check = verifyPassword(password, matchedCustomer.password);
    if (!check.ok) {
      noteLoginFailure(req);
      return res.status(401).json({ success: false, error: LOGIN_FAILED });
    }
    loginFailures.delete(loginThrottleKey(req));
    upgradeStoredPassword('customers', matchedCustomer.id, password, check.needsUpgrade);
    return res.json(customerSession(matchedCustomer));
  }
  burnPasswordCheck(password);
  noteLoginFailure(req);

  /*
   * An SPK or PO number used to grant a full customer session with no password
   * at all. Tracking by document number now goes through GET /api/quick-track,
   * which is public but read-only.
   */
  return res.status(401).json({ success: false, error: LOGIN_FAILED });
});

// Backward-compatible endpoints — same rules, no shortcuts.
app.post('/api/login', (req: Request, res: Response) => {
  const identifier = String(req.body.username || req.body.identifier || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (loginBlocked(req)) return res.status(429).json({ success: false, error: LOGIN_THROTTLED });
  if (!identifier || !password) {
    return res.status(400).json({ success: false, error: 'Username dan kata sandi wajib diisi.' });
  }

  const user = findStaff(readTable('users'), identifier);
  if (!user) burnPasswordCheck(password);
  const check = user ? verifyPassword(password, user.password) : { ok: false, needsUpgrade: false };
  if (!user || !check.ok) {
    noteLoginFailure(req);
    return res.status(401).json({ success: false, error: LOGIN_FAILED });
  }
  loginFailures.delete(loginThrottleKey(req));
  upgradeStoredPassword('users', user.id, password, check.needsUpgrade);
  return res.json(staffSession(user));
});

app.post('/api/customer-login', (req: Request, res: Response) => {
  const identifier = String(
    req.body.customerId || req.body.spkId || req.body.identifier || ''
  ).trim().toLowerCase();
  const password = String(req.body.password || '');

  // This route used to return a customer record for an id alone.
  if (!identifier || !password) {
    return res.status(400).json({ success: false, error: 'ID pelanggan dan kata sandi wajib diisi.' });
  }

  if (loginBlocked(req)) return res.status(429).json({ success: false, error: LOGIN_THROTTLED });
  const matched = findCustomer(readTable('customers'), identifier, identifier.replace(/\D/g, ''));
  if (!matched) burnPasswordCheck(password);
  const check = matched ? verifyPassword(password, matched.password) : { ok: false, needsUpgrade: false };
  if (!matched || !check.ok) {
    noteLoginFailure(req);
    return res.status(401).json({ success: false, error: LOGIN_FAILED });
  }
  loginFailures.delete(loginThrottleKey(req));
  upgradeStoredPassword('customers', matched.id, password, check.needsUpgrade);
  return res.json(customerSession(matched));
});

// ---------------------------------------------------------
// CUSTOMER PORTAL DATA AGGREGATION
// ---------------------------------------------------------
app.get(
  '/api/customer-portal/data/:customerId',
  requireSelfOrStaff(req => {
    /*
     * The path may carry a username while the token carries the id, so resolve
     * the parameter to a customer id before comparing the two.
     */
    const raw = String(req.params.customerId || '').toLowerCase();
    const match = readTable('customers').find(c =>
      String(c.id || '').toLowerCase() === raw || String(c.username || '').toLowerCase() === raw
    );
    return match ? String(match.id) : raw;
  }),
  (req: Request, res: Response) => {
  const cleanQuery = String(req.params.customerId).toLowerCase();
  const customers = readTable('customers');
  const matchedCustomer = customers.find(c => 
    String(c.id).toLowerCase() === cleanQuery || 
    String(c.username || '').toLowerCase() === cleanQuery
  );
  const targetId = matchedCustomer ? String(matchedCustomer.id).toLowerCase() : cleanQuery;

  /*
   * A record is this customer's when it carries their id, or hangs off one of
   * their orders. The name is only a fallback for rows with no customerId at
   * all, and must match exactly: a substring match showed "PT Alina" records to
   * a customer called "Ali".
   */
  const ownName = String(matchedCustomer?.name || '').trim().toLowerCase();
  const ownsById = (item: any) => {
    const itemCustId = String(item.customerId || '').toLowerCase();
    if (itemCustId) return itemCustId === targetId || itemCustId === cleanQuery;
    return !!ownName && String(item.customerName || '').trim().toLowerCase() === ownName;
  };
  const orders = readTable('orders').filter(ownsById);
  const orderIds = new Set(orders.map((o: any) => o.id));
  const matchFilter = (item: any) => ownsById(item) || (!!item.orderId && orderIds.has(item.orderId));

  const spks = readTable('spk_produksi').filter(matchFilter);
  const designs = readTable('designs').filter(matchFilter);
  const samples = readTable('samples').filter(matchFilter);
  // A draft has not been checked by Keuangan yet, and a superseded revision is
  // no longer what the customer owes.
  const invoices = readTable('invoices').filter(
    (i: any) => matchFilter(i) && i.reviewStatus !== 'Draft' && !i.supersededBy
  );
  const shipments = readTable('shipments').filter(matchFilter);
  const returns = readTable('returns_complaints').filter(matchFilter);

  res.json(stripSensitive({
    orders,
    spks,
    designs,
    samples,
    invoices,
    shipments,
    returns
  }));
});

// Quick Track by SPK ID, Order ID, PO number, or Tracking Resi (Public tracking)
/*
 * Public, so it is throttled: order numbers are sequential and a scan could
 * otherwise read every customer's product and quantity in minutes.
 */
const trackHits = new Map<string, { count: number; first: number }>();
function trackThrottled(req: Request): boolean {
  const key = req.ip || 'ip';
  const now = Date.now();
  const entry = trackHits.get(key);
  if (!entry || now - entry.first > 15 * 60 * 1000) {
    trackHits.set(key, { count: 1, first: now });
    if (trackHits.size > 5000) for (const [k, v] of trackHits) if (now - v.first > 15 * 60 * 1000) trackHits.delete(k);
    return false;
  }
  entry.count += 1;
  return entry.count > 60;
}

/** Four unambiguous characters (no 0/O/1/I) appended to customer-facing numbers. */
function poTail(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(4);
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
}

/** Contact details the public site prints — one source with the ERP's invoices. */
app.get('/api/public/company-info', (_req: Request, res: Response) => {
  res.json({
    name: COMPANY_CONTACT.name,
    shortName: COMPANY_CONTACT.shortName,
    whatsappNumber: COMPANY_CONTACT.whatsappNumber,
    whatsappFormatted: COMPANY_CONTACT.whatsappFormatted,
    email: COMPANY_CONTACT.email,
    address: COMPANY_CONTACT.address,
    bankAccounts: COMPANY_CONTACT.bankAccounts
  });
});

app.get('/api/quick-track/:query', (req: Request, res: Response) => {
  const query = String(req.params.query || '').trim().toLowerCase();
  if (trackThrottled(req)) {
    return res.status(429).json({ success: false, error: 'Terlalu banyak pencarian. Coba lagi beberapa menit lagi.' });
  }
  if (!query) {
    return res.status(400).json({ success: false, error: 'Nomor pelacakan wajib diisi.' });
  }

  const spks = readTable('spk_produksi');
  const orders = readTable('orders');
  const shipments = readTable('shipments');

  // Match SPK by ID or PO
  const spk = spks.find(s => 
    String(s.id).toLowerCase() === query || 
    String(s.po || '').toLowerCase() === query ||
    String(s.orderId || '').toLowerCase() === query
  );

  // Match Order by ID or customer PO
  const order = spk 
    ? orders.find(o => o.id === spk.orderId)
    : orders.find(o =>
        String(o.id).toLowerCase() === query ||
        String(o.po || o.poNumber || '').toLowerCase() === query
      );

  // Match Shipment by SPK, Order, or Tracking Number (resi). With more than
  // one surat jalan, the one that has got furthest tells the customer most.
  const SHIPMENT_RANK: Record<string, number> = { Delivered: 4, 'In Transit': 3, 'Picked Up': 2 };
  const shipment = shipments
    .filter(sh =>
      (spk && sh.spkId === spk.id) ||
      (order && sh.orderId === order.id) ||
      String(sh.trackingNumber || '').toLowerCase() === query ||
      String(sh.id).toLowerCase() === query
    )
    .sort((a, b) => (SHIPMENT_RANK[b.status] || 0) - (SHIPMENT_RANK[a.status] || 0))[0];

  if (!spk && !order && !shipment) {
    return res.status(404).json({ 
      success: false, 
      found: false, 
      error: 'Data pesanan tidak ditemukan. Periksa kembali nomor SPK atau PO Anda.' 
    });
  }

  /*
   * The stage is read from what actually happened — counters, QC result,
   * shipment — never from a percentage. The old lookup keyed on fields that
   * do not exist (spk.stage) and fell back to a made-up 50%.
   */
  const target = Number(spk?.targetQty) || Number(order?.quantity) || 0;
  const delivered = shipment?.status === 'Delivered';
  const shipped = !!shipment && ['Picked Up', 'In Transit', 'Delivered'].includes(shipment.status);
  const qcPassed = spk?.status === 'QC Passed' || spk?.status === 'Completed';
  let stage = 'Menunggu SPK';
  let stageKey = 'queue';
  if (delivered) { stage = 'Selesai — sudah diterima'; stageKey = 'done'; }
  else if (shipped) { stage = 'Dalam pengiriman'; stageKey = 'shipping'; }
  else if (qcPassed) { stage = 'Lolos QC — pengemasan'; stageKey = 'packing'; }
  else if (spk && target > 0 && Number(spk.finishing) >= target) { stage = 'Pemeriksaan QC'; stageKey = 'qc'; }
  else if (spk && Number(spk.finishing) > 0) { stage = 'Finishing'; stageKey = 'finishing'; }
  else if (spk && Number(spk.sewing) > 0) { stage = 'Penjahitan'; stageKey = 'sewing'; }
  else if (spk && Number(spk.cutting) > 0) { stage = 'Pemotongan'; stageKey = 'cutting'; }
  else if (spk) { stage = 'Antrean produksi'; stageKey = 'queued'; }
  else if (order?.status === 'Sample') { stage = 'Desain & sampel'; stageKey = 'design'; }

  const progressPercent = delivered ? 100 : typeof spk?.progress === 'number' ? spk.progress : 0;

  /*
   * The public answer is what a courier's tracking page shows: how far along,
   * when, and whether it has shipped. Never the customer's name, product or
   * quantities — order numbers are printed on documents that pass through
   * many hands. Those details live behind the customer portal login.
   */
  const publicData = {
    trackingQuery: req.params.query,
    orderId: order?.id || spk?.orderId || null,
    spkId: spk?.id || null,
    po: order?.po || null,
    stage,
    stageKey,
    hasSpk: !!spk,
    spkStatus: spk?.status || null,
    progressPercent,
    deadline: order?.deadline || spk?.tanggalSelesai || null,
    createdAt: order?.timestamp || spk?.tanggalMasuk || null,
    shipment: shipment ? {
      id: shipment.id,
      courier: shipment.courier || shipment.expedition || null,
      trackingNumber: shipment.trackingNumber || shipment.resi || null,
      status: shipment.status,
      shippedAt: shipment.shippedAt || shipment.createdAt || null,
      estimatedDelivery: shipment.estimatedDelivery || null
    } : null
  };

  res.json({ success: true, found: true, data: publicData });
});

/*
 * Who can be named as PIC on a quotation or order: every staff account, by
 * name and role. The accounts table itself stays behind the Akun menu; this
 * exposes nothing that could log in.
 */
app.get('/api/staff-directory', requireModule(), (_req: Request, res: Response) => {
  const staff = readTable('users')
    .map((u: any) => ({ id: u.id, name: u.name || u.username, role: u.role || '' }))
    .sort((a: any, b: any) => String(a.name).localeCompare(String(b.name), 'id'));
  res.json(staff);
});

// ---------------------------------------------------------
// DOMAIN-SPECIFIC ENDPOINTS
// ---------------------------------------------------------

// Catatan Keuangan Harian: must sit before the generic /api/:resource/:id routes.
app.use('/api', dailyCashRouter);

// SOP-08: Scan WIP Bundle Handover & Stage Transition
app.post('/api/wip-bundles/scan', requireModule('BundleTracking', 'Cutting', 'Sewing', 'QC', 'Packaging'), (req: Request, res: Response) => {
  const { bundleId, nextStage, operatorName, status } = req.body;
  if (!bundleId) {
    return res.status(400).json({ error: 'ID bundel wajib diisi.' });
  }
  const BUNDLE_STAGES = ['Cutting', 'Sewing', 'Obras', 'Finishing Detail', 'QC', 'Packing'];
  const BUNDLE_STATUSES = ['In Progress', 'Passed', 'Repair Needed', 'Completed'];
  if (nextStage && !BUNDLE_STAGES.includes(String(nextStage))) {
    return res.status(400).json({ error: `Tahap "${nextStage}" tidak dikenal.` });
  }
  if (status && !BUNDLE_STATUSES.includes(String(status))) {
    return res.status(400).json({ error: `Status "${status}" tidak dikenal.` });
  }

  const bundles = readTable('wip_bundles');
  const bundle = bundles.find(b => String(b.id).toLowerCase() === String(bundleId).toLowerCase());

  if (!bundle) {
    return res.status(404).json({ error: 'Bundel tidak ditemukan.' });
  }

  const scanRecord = {
    stage: nextStage || bundle.currentStage,
    operator: operatorName || 'Operator',
    timestamp: new Date().toISOString()
  };

  const updatedBundle = {
    ...bundle,
    currentStage: nextStage || bundle.currentStage,
    status: status || bundle.status || 'In Progress',
    scanHistory: [...(bundle.scanHistory || []), scanRecord]
  };

  updateItem('wip_bundles', bundle.id, updatedBundle);

  // The SPK reads its progress from the bundles (and every other record) in one place.
  recomputeSpk(bundle.spkId);

  res.json({ success: true, bundle: updatedBundle });
});

// ---------------------------------------------------------
// SOP-01/02/03/04/06/20: PRODUCTION REQUIREMENTS BEFORE SPK
// ---------------------------------------------------------
function readinessForOrder(order: any) {
  return getOrderReadiness(order, {
    payments: readTable('payments'),
    samples: readTable('samples'),
    procurements: readTable('procurements'),
    designs: readTable('designs')
  });
}

/**
 * The size chart template the SPK is cut against, copied onto the SPK when it
 * is issued. The sheet keeps printing the numbers production was given even
 * if the chart is edited later; PPIC still shows the live chart when it exists.
 */
function sizeChartSnapshot(chartId: string | undefined) {
  if (!chartId) return {};
  const chart = findById('size_charts', chartId);
  if (!chart) return {};
  return {
    sizeChartId: chart.id,
    sizeChartName: chart.name,
    sizeChartTemplate: JSON.stringify({
      name: chart.name,
      garment: chart.garment,
      scope: chart.scope || 'standard',
      customerName: chart.customerName,
      measurements: chart.measurements || [],
      rows: chart.rows || []
    })
  };
}

/**
 * Production has started once any SPK of the order has work behind it, passed
 * QC, or shipped. Quantity revisions and cancellations stop here: the cut
 * fabric and the wages already booked cannot be revised away.
 */
function productionStartedReason(orderId: string): string | null {
  const spks = readTable('spk_produksi').filter((s: any) => s.orderId === orderId);
  const active = spks.find((s: any) => s.status !== 'Queued');
  if (active) return `SPK ${active.id} sudah ${String(active.status) === 'In Progress' ? 'dikerjakan' : 'berjalan'}.`;
  if (spks.some((s: any) => spkQcAccepted(s.id))) return 'Hasil QC sudah tercatat.';
  if (readTable('shipments').some((s: any) => s.orderId === orderId)) return 'Surat jalan sudah dibuat.';
  if (readTable('work_assignments').some((w: any) => w.orderId === orderId)) return 'Catatan kerja sudah ada.';
  return null;
}

/** The order another live record already uses this PO number for, if any. */
function poTakenBy(po: string | undefined, exceptId?: string): any | null {
  const wanted = String(po || '').trim().toLowerCase();
  if (!wanted) return null;
  return readTable('orders').find((o: any) => o.id !== exceptId && String(o.po || '').trim().toLowerCase() === wanted) || null;
}

/** Money still owed on the order: the live invoice's balance, else total minus verified payments. */
function outstandingForOrder(order: any): number | null {
  const invoice = activeInvoiceForOrder(order.id);
  if (invoice) return Math.max(0, Number(invoice.total) - verifiedPaidForInvoice(invoice));
  const total = Number(order.totalPrice) || 0;
  if (total <= 0) return null;
  return Math.max(0, total - verifiedPaidForOrder(order.id, readTable('payments')));
}

/** Returns why an SPK may not be created for this order, or null when it may. */
function spkBlockReason(orderId: string | undefined): string | null {
  if (!orderId) return 'SPK harus terhubung ke pesanan.';
  const order = findById('orders', orderId);
  if (!order) return 'Pesanan tidak ditemukan.';
  if (order.status === 'Cancelled') return `Pesanan ${order.id} sudah dibatalkan.`;
  if (readTable('spk_produksi').some(s => s.orderId === order.id)) {
    return `SPK untuk pesanan ${order.id} sudah ada.`;
  }
  /*
   * The artwork rule holds for every SPK, including the fast path below: the
   * SPK sheet is what the floor cuts and sews from, and one without a design
   * sends people to the machines with nothing to follow.
   */
  const design = designForOrder(order, readTable('designs') as any);
  if (!design) {
    return `SPK belum bisa diterbitkan. Desain belum dilampirkan ke pesanan ${order.id}.`;
  }
  if (design.status !== 'Approved') {
    return `SPK belum bisa diterbitkan. Desain ${design.id} masih berstatus ${design.status} — setujui dulu di menu Desain & Sampel.`;
  }
  // The sheet prints the size chart the garment is cut to; no template, no sheet.
  if (!order.sizeChartId) {
    return `SPK belum bisa diterbitkan. Template size chart belum dipilih di pesanan ${order.id} — buka Edit Pesanan, lalu pilih template standar HIJ atau khusus pelanggan.`;
  }
  if (!findById('size_charts', order.sizeChartId)) {
    return `SPK belum bisa diterbitkan. Template size chart ${order.sizeChartId} pada pesanan ${order.id} sudah tidak ada di halaman Size Chart — pilih template lain di Edit Pesanan.`;
  }

  // SPK tidak wajib dipenuhi untuk repeat order atau kuantitas di bawah 50 pcs (dibuat manual di tiap pesanan)
  if (order.isRepeatOrder || (Number(order.quantity) > 0 && Number(order.quantity) < 50)) {
    /*
     * The fast path trusts the customer to pay later. One who is already late
     * on another tagihan waits for the owner's approval (Termin Khusus).
     */
    const overdue = overdueTermsForCustomer(order.customerId, order.id);
    if (overdue.length > 0 && !order.specialTermsApprovedBy) {
      const worst = overdue.reduce((a: any, b: any) => (b.daysLate > a.daysLate ? b : a));
      return (
        `SPK jalur cepat ditahan: ${order.customerName} punya ${overdue.length} tagihan lewat jatuh tempo ` +
        `(mis. ${worst.term.billNo || worst.invoice.id}, telat ${worst.daysLate} hari). ` +
        'Tagih dulu, atau minta Owner menyetujui termin khusus di pesanan ini.'
      );
    }
    return null;
  }
  const readiness = readinessForOrder(order);
  if (!readiness.ready) {
    const unmet = readiness.requirements.filter(r => r.blocking && !r.met).map(r => r.label);
    return `SPK belum bisa diterbitkan. Belum terpenuhi: ${unmet.join(', ')}.`;
  }
  return null;
}

// Keeps the paid amount on orders created through the SOP flow in step with verified payments.
function reconcileOrderPayments(orderId: string | undefined) {
  if (!orderId) return;
  const order = findById('orders', orderId);
  if (!order || order.dpRequired === undefined) return; // older orders keep their recorded values
  const paid = verifiedPaidForOrder(order.id, readTable('payments'));
  updateItem('orders', order.id, {
    downPayment: paid,
    dpPercent: order.totalPrice > 0 ? Math.min(100, Math.round((paid / order.totalPrice) * 100)) : 0
  });
}

app.get('/api/orders/:id/readiness', requireStaff, (req: Request, res: Response) => {
  const order = findById('orders', req.params.id);
  if (!order) return res.status(404).json({ error: 'Pesanan tidak ditemukan.' });
  res.json(readinessForOrder(order));
});

// SOP-03: PPIC issues the SPK once every production requirement is met.
app.post('/api/orders/:id/issue-spk', requireModule('PPIC', 'Orders'), (req: Request, res: Response) => {
  const order = findById('orders', req.params.id);
  if (!order) return res.status(404).json({ error: 'Pesanan tidak ditemukan.' });

  const blockReason = spkBlockReason(order.id);
  if (blockReason) {
    return res.status(409).json({ error: blockReason, readiness: readinessForOrder(order) });
  }

  const { plannedStart, notes, user } = req.body || {};

  // Resolve mockup from order or linked design to forward to SPK
  // Same lookup the gate used, so the SPK prints the design that was approved —
  // never another customer's design that happens to share a name.
  const matchedDesign: any = designForOrder(order, readTable('designs') as any);

  // Every picture of the design, titled as on the Design page. order.designUrl
  // is a single picture, so it only stands in when no design record is linked.
  const mockups = matchedDesign
    ? designMockups(matchedDesign)
    : isArtwork(order.designUrl) ? [{ id: 'front', title: 'Tampak Depan', url: order.designUrl }] : [];
  const mockupDepan = mockups[0]?.url || '';
  const mockupBelakang = mockups[1]?.url || '';

  const spkPayload = {
    id: `SPK-${order.id}`,
    orderId: order.id,
    po: order.po || `PO-${order.id}`,
    customerId: order.customerId,
    customerName: order.customerName,
    productName: order.productType,
    targetQty: Number(order.quantity) || 1,
    material: order.material || '-',
    // sablonBordir is the spec; accessories is often just '-', which is truthy.
    sablonBordir: [order.sablonBordir, order.accessories].find(v => v && v !== '-') || '-',
    tanggalMasuk: plannedStart || new Date().toISOString().split('T')[0],
    tanggalSelesai: order.deadline,
    notes: notes ?? order.notes,
    // Quotation orders carry the breakdown in `size`; without it the SPK printed no sizes.
    sizeChart: order.sizeChart || order.size,
    ...sizeChartSnapshot(order.sizeChartId),
    mockups,
    mockupDepan,
    mockupBelakang,
    cutting: 0,
    sewing: 0,
    finishing: 0,
    qc: 0,
    progress: 0,
    status: 'Queued',
    user: user || 'PPIC'
  };

  const newSpk = insertItem('spk_produksi', spkPayload);
  syncOrderStatus(order.id);
  const updatedOrder = findById('orders', order.id);

  res.status(201).json({
    success: true,
    message: `SPK ${newSpk.id} diterbitkan dan masuk antrean produksi.`,
    spk: newSpk,
    order: updatedOrder
  });
});

/*
 * SOP-01 & SOP-20: money never enters through the portal. The customer sends
 * the transfer proof over WhatsApp and the order's PIC (or a full admin)
 * confirms it here, which records a verified payment in one step so the DP
 * gate, the invoice and the order all move together.
 */
app.post('/api/orders/:id/approve-dp', requireModule('Orders', 'Finance'), (req: Request, res: Response) => {
  const order = findById('orders', req.params.id);
  if (!order) return res.status(404).json({ error: 'Pesanan tidak ditemukan.' });

  const actor = actorUser(req);
  const isPic = !!order.picUserId && String(order.picUserId) === String(actor?.id);
  if (!isPic && !isFullAdmin(actor)) {
    return res.status(403).json({
      error: order.picName
        ? `Hanya PIC pesanan ini (${order.picName}) atau Super Admin yang bisa menyetujui DP.`
        : 'Pesanan ini belum punya PIC. Pilih PIC lewat Ubah Pesanan, atau minta Super Admin menyetujui DP.'
    });
  }

  const amount = Number(req.body?.amount);
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Nominal DP harus lebih dari 0.' });
  if (order.status === 'Cancelled') return res.status(409).json({ error: `Pesanan ${order.id} sudah dibatalkan.` });
  /*
   * The transfer is recorded as it arrived. Anything above what is owed
   * becomes a saldo pelanggan for Keuangan to refund or move, rather than
   * the PIC being made to type a smaller figure than the bank shows.
   */
  const owed = outstandingForOrder(order);
  const excess = owed !== null && amount > owed ? amount - owed : 0;

  const invoice = activeInvoiceForOrder(order.id);
  const paidSoFar = verifiedPaidForOrder(order.id, readTable('payments'));
  const required = Number(order.dpRequired) || 0;
  // The money lands in the oldest unsettled instalment and is named after it.
  const landing = invoice ? openTermFor(syncInvoiceTerms(invoice.id)) : null;
  // Without a schedule: once the agreed DP is covered, whatever follows is settlement.
  const type = landing
    ? paymentTypeForTerm(landing.index, landing.count)
    : required > 0 && paidSoFar >= required ? 'Pelunasan' : 'DP';
  const now = new Date().toISOString();
  const extraNote = String(req.body?.notes || '').trim();

  const payment = insertItem('payments', {
    id: nextId('payments', 'PAY'),
    orderId: order.id,
    invoiceId: invoice?.id || '',
    customerId: order.customerId || '',
    customerName: order.customerName || 'Klien',
    amount,
    type,
    ...(landing ? { termId: landing.term.id, termLabel: landing.term.label } : {}),
    date: req.body?.date || now.split('T')[0],
    paymentMethod: req.body?.paymentMethod || 'Transfer Bank',
    bankAccount: req.body?.bankAccount || '',
    proofImageUrl: '',
    status: 'Verified',
    notes: `Bukti transfer diterima via WhatsApp, disetujui ${actor?.name || 'PIC'}${extraNote ? ` — ${extraNote}` : ''}`,
    user: actor?.name || 'PIC',
    approvedBy: actor?.name || '',
    approvedById: actor?.id || '',
    timestamp: now
  });

  if (invoice) reconcileInvoice(invoice.id);
  reconcileOrderPayments(order.id);
  updateItem('orders', order.id, { dpApprovedBy: actor?.name || '', dpApprovedAt: now });

  res.status(201).json({
    success: true,
    message:
      `${type} Rp ${amount.toLocaleString('id-ID')} disetujui dan tercatat.` +
      (excess > 0 ? ` Kelebihan Rp ${excess.toLocaleString('id-ID')} menjadi saldo pelanggan di menu Keuangan.` : ''),
    payment,
    order: findById('orders', order.id),
    invoice: invoice ? findById('invoices', invoice.id) : null
  });
});

app.post('/api/quotations/:id/approve-to-order', requireModule('Quotations'), (req: Request, res: Response) => {
  const quotationId = req.params.id;
  const quotation = findById('quotations', quotationId);

  if (!quotation) {
    return res.status(404).json({ error: 'Penawaran tidak ditemukan.' });
  }
  // A second click, or a stale tab, used to create a second order for one deal.
  if (quotation.supersededBy) {
    return res.status(409).json({
      error: `Penawaran ${quotation.id} sudah diganti revisi ${quotation.supersededBy}. Proses dari dokumen terbaru.`
    });
  }
  if (quotation.orderId && findById('orders', quotation.orderId)) {
    return res.status(409).json({
      error: `Penawaran ${quotation.id} sudah deal dan menjadi pesanan ${quotation.orderId}.`
    });
  }
  if (quotation.status === 'Rejected') {
    return res.status(409).json({ error: `Penawaran ${quotation.id} sudah ditandai ditolak pelanggan. Buat penawaran baru.` });
  }

  const { downPayment, po, deadline, user } = req.body;
  const now = new Date();

  const orderId = nextId('orders', 'ORD');
  const orderNum = Number(orderId.split('-').pop()) || 1;
  // The PO number is what customers type into public tracking, so it carries
  // a random tail: a counted-up number let anyone walk through every order.
  const finalPo = po || `PO-${(quotation.customerName || 'HIJ').replace(/[^a-zA-Z0-9]/g, '').slice(0, 3).toUpperCase()}-${now.getFullYear()}-${String(orderNum).padStart(2, '0')}${poTail()}`;
  const poClash = poTakenBy(finalPo);
  if (poClash) {
    return res.status(409).json({ error: `Nomor PO ${finalPo} sudah dipakai pesanan ${poClash.id}. Pakai nomor lain.` });
  }
  const totalAmount = Number(quotation.totalPrice) || (Number(quotation.quantity) * Number(quotation.price));
  const termsProblem = scheduleError(quotation.paymentSchedule);
  if (termsProblem) {
    return res.status(409).json({ error: `Termin di penawaran ${quotation.id} belum benar: ${termsProblem} Perbaiki penawarannya dulu.` });
  }
  const designProblem = designReuseError(quotation.designId, { isRepeatOrder: quotation.isRepeatOrder });
  if (designProblem) return res.status(409).json({ error: designProblem });
  /*
   * Every deal is billed in instalments. A quotation that agreed none is the
   * old 50/50: DP at the deal, the rest when the goods leave.
   */
  let schedule = withAmounts(
    planTerms(
      Array.isArray(quotation.paymentSchedule) && quotation.paymentSchedule.length > 0
        ? quotation.paymentSchedule
        : [
            { id: 'term-dp', label: 'DP', percentage: 50, amount: 0 },
            { id: 'term-final', label: 'Pelunasan', percentage: 50, amount: 0 }
          ]
    ),
    totalAmount
  );
  // The first agreed instalment is the DP; 50% only when nothing was agreed.
  const scheduledDp = Number(schedule[0]?.amount) || Math.round(totalAmount * 0.5);
  const typedDp = downPayment !== undefined && downPayment !== null && downPayment !== '' ? Number(downPayment) : NaN;
  if (!Number.isNaN(typedDp) && (typedDp < 0 || (totalAmount > 0 && typedDp > totalAmount))) {
    return res.status(400).json({ error: `Uang muka harus antara Rp 0 dan Rp ${totalAmount.toLocaleString('id-ID')}.` });
  }
  const finalDp = Number.isNaN(typedDp) ? scheduledDp : typedDp;
  /*
   * A DP typed at deal time that differs from the agreed first instalment
   * becomes the first instalment: the invoice printed the schedule's figure
   * while the SPK gate waited for the typed one.
   */
  if (schedule.length >= 2 && totalAmount > 0 && finalDp !== Number(schedule[0].amount)) {
    const dpPct = Math.round((finalDp / totalAmount) * 100);
    const restPct = 100 - dpPct;
    const [first, ...rest] = schedule;
    const restTotal = rest.reduce((sum: number, t: any) => sum + (Number(t.percentage) || 0), 0) || 1;
    schedule = withAmounts(
      [
        { ...first, percentage: dpPct },
        ...rest.map((t: any) => ({ ...t, percentage: Math.round(((Number(t.percentage) || 0) / restTotal) * restPct) }))
      ],
      totalAmount
    );
    // Rounding may leave the percentages a point short; the last term absorbs it.
    const pctSum = schedule.reduce((sum: number, t: any) => sum + (Number(t.percentage) || 0), 0);
    if (pctSum !== 100) {
      schedule[schedule.length - 1].percentage += 100 - pctSum;
      schedule = withAmounts(schedule, totalAmount);
    }
  }

  // 1. Create the Order directly from agreed quotation
  const orderPayload = {
    id: orderId,
    quotationId: quotation.id,
    po: finalPo,
    customerId: quotation.customerId,
    customerName: quotation.customerName,
    productType: quotation.productType,
    quantity: Number(quotation.quantity) || 1,
    price: Number(quotation.price) || 0,
    totalPrice: totalAmount,
    dpRequired: finalDp,
    downPayment: 0,
    dpPercent: 0,
    deadline: deadline || quotation.deadline || new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
    status: quotation.needsSample === false ? 'Order' : 'Sample',
    material: quotation.material || '-',
    color: quotation.color || 'Custom',
    size: quotation.size || 'All Size',
    sizeChart: quotation.sizeChart,
    sizeChartId: quotation.sizeChartId || '',
    sizeChartName: quotation.sizeChartName || '',
    // The PIC who closed the deal stays on the order.
    picUserId: quotation.picUserId || '',
    picName: quotation.picName || '',
    picRole: quotation.picRole || '',
    accessories: quotation.accessories || '-',
    needsProcurement: quotation.needsProcurement || 'Perlu Pengadaan',
    notes: `Dibuat dari penawaran ${quotation.id}. ${quotation.notes || ''}`.trim(),
    user: user || quotation.picName || quotation.user || 'Sistem',
    timestamp: now.toISOString(),
    // Anti-Skip & Specifications mapping
    needsSample: quotation.needsSample !== undefined ? quotation.needsSample : true,
    sampleStatus: quotation.needsSample === false ? 'Approved' : 'Pending',
    ...(quotation.needsSample !== false ? { sampleFee: Number(quotation.sampleFee) || 0 } : {}),
    sablonBordir: quotation.sablonBordir || quotation.accessories || '-',
    designId: quotation.designId || '',
    designName: quotation.designName || quotation.productType,
    designUrl: quotation.designUrl || '',
    moq: quotation.moq || 100,
    priceBelowMoq: quotation.priceBelowMoq || quotation.price,
    discount: quotation.discount || 0,
    discountPercent: quotation.discountPercent || 0,
    // Installments agreed on the quotation follow the order into invoicing
    paymentSchedule: schedule
  };

  const newOrder = insertItem('orders', orderPayload);
  // Both links are used in practice; keep them in step so Desain shows the order too.
  if (orderPayload.designId) {
    const design = findById('designs', orderPayload.designId);
    if (design && !design.orderId) updateItem('designs', design.id, { orderId: orderId });
  }

  // 2. Update Quotation status to Approved with link to generated order
  const updatedQuotation = updateItem('quotations', quotation.id, {
    status: 'Approved',
    orderId: orderId,
    approvedAt: now.toISOString()
  });

  /*
   * 3. The deal is the "kejelasan" the sample waits for: its task opens now,
   * without waiting for DP (the DP is billed once the sample is sent).
   */
  let sampleTask = null;
  if (newOrder.needsSample === true) {
    const fee = Number(newOrder.sampleFee) || 0;
    sampleTask = insertItem('samples', {
      id: nextId('samples', 'SMP'),
      orderId,
      customerId: newOrder.customerId,
      customerName: newOrder.customerName,
      productName: `Sampel ${newOrder.productType}`,
      size: newOrder.size,
      quantity: 1,
      status: 'Development',
      notes:
        `Dari penawaran ${quotation.id}.` +
        (fee > 0 ? ` Biaya sampel Rp ${fee.toLocaleString('id-ID')}, gratis bila lanjut produksi.` : ''),
      user: orderPayload.user,
      timestamp: now.toISOString()
    });
  }

  // 4. The invoice is born with the order; each instalment falls due at its milestone.
  const invoice = createInvoiceForOrder(newOrder, {
    reviewStatus: 'Draft',
    notes: `Faktur dari penawaran ${quotation.id}. Termin ditagih sesuai tahap pesanan.`,
    user: orderPayload.user
  });

  res.json({
    success: true,
    message:
      `Penawaran ${quotation.id} disetujui. Pesanan ${orderId} dibuat dan menunggu syarat produksi.` +
      (sampleTask ? ` Tugas sampel ${sampleTask.id} dibuat di Desain & Sampel.` : '') +
      (invoice ? ` Faktur ${invoice.id} terbit.` : ''),
    quotation: updatedQuotation,
    order: newOrder,
    invoice,
    readiness: readinessForOrder(newOrder)
  });
});

// SOP-01A & SOP-20: Revisi Penawaran yang sudah Deal (Perubahan Qty/Harga di tengah jalan)
// Otomatis menyinkronkan Quotation -> Order -> Invoice

/*
 * SOP-01/20: a deal whose quantity changes mid-flight.
 * The agreed figures are never overwritten. A new revision is issued, the old
 * one is marked superseded, and money already received carries across so the
 * customer is never asked to pay twice.
 */
app.put('/api/quotations/:id/revise-deal', requireModule('Quotations'), (req: Request, res: Response) => {
  const quotation = findById('quotations', req.params.id);

  if (!quotation) {
    return res.status(404).json({ error: 'Penawaran tidak ditemukan.' });
  }
  if (quotation.supersededBy) {
    return res.status(409).json({
      error: `Penawaran ${quotation.id} sudah diganti revisi ${quotation.supersededBy}. Revisi dari dokumen terbaru.`
    });
  }

  const revisedOrder = readTable('orders').find((o: any) => o.quotationId === quotation.id || o.id === quotation.orderId);
  if (revisedOrder) {
    if (revisedOrder.status === 'Cancelled') {
      return res.status(409).json({ error: `Pesanan ${revisedOrder.id} sudah dibatalkan; buat penawaran baru.` });
    }
    const started = productionStartedReason(revisedOrder.id);
    if (started) {
      return res.status(409).json({ error: `Kuantitas tidak bisa direvisi: produksi pesanan ${revisedOrder.id} sudah berjalan (${started}) Sepakati pesanan tambahan sebagai pesanan baru.` });
    }
  }

  const { quantity, price, totalPrice, deadline, notes, paymentSchedule, user } = req.body;
  const termsProblem = scheduleError(paymentSchedule);
  if (termsProblem) return res.status(400).json({ error: termsProblem });
  const newQty = Number(quantity) || Number(quotation.quantity) || 1;
  const newPrice = Number(price) || Number(quotation.price) || 0;
  const newTotal = Number(totalPrice) || newQty * newPrice;
  const now = new Date().toISOString();
  const revisedBy = user || 'Staf Penjualan';

  // 1. Issue the next quotation revision; the old one becomes read-only history.
  const quoBase = quotation.revisionOf || quotation.id;
  const quoNext = nextRevision('quotations', quoBase);
  const newQuotation = insertItem('quotations', {
    ...quotation,
    id: quoNext.id,
    quotationNo: quotation.quotationNo || quoBase,
    revision: quoNext.revision,
    revisionOf: quoBase,
    revisionNote: notes || quotation.notes,
    revisedBy,
    supersededBy: undefined,
    supersededAt: undefined,
    quantity: newQty,
    price: newPrice,
    totalPrice: newTotal,
    deadline: deadline || quotation.deadline,
    notes: notes !== undefined ? notes : quotation.notes,
    // Same percentages, amounts recomputed: the old amounts described the old total.
    paymentSchedule: withAmounts(
      planTerms(Array.isArray(paymentSchedule) && paymentSchedule.length > 0 ? paymentSchedule : quotation.paymentSchedule),
      newTotal
    ),
    timestamp: now
  });
  updateItem('quotations', quotation.id, { supersededBy: newQuotation.id, supersededAt: now });

  // 2. Point the order at the new figures and the new document.
  const linkedOrder = readTable('orders').find(
    (o: any) => o.quotationId === quotation.id || o.id === quotation.orderId
  );
  let updatedOrder = null;
  let newInvoice = null;
  let invoiceReplaced = false;

  if (linkedOrder) {
    const revisedSchedule = newQuotation.paymentSchedule || [];
    updatedOrder = updateItem('orders', linkedOrder.id, {
      quotationId: newQuotation.id,
      quantity: newQty,
      price: newPrice,
      totalPrice: newTotal,
      /*
       * A DP sized for the old total could exceed the new one, and the DP gate
       * could then never pass. It follows the revised first instalment.
       */
      dpRequired: Number(revisedSchedule[0]?.amount) || Math.round(newTotal * 0.5),
      ...(req.body.size ? { size: req.body.size } : {}),
      deadline: deadline || linkedOrder.deadline,
      paymentSchedule: revisedSchedule,
      updatedAt: now
    });

    // The floor works to the SPK's target, so it follows the revised quantity.
    const linkedSpk = readTable('spk_produksi').find((spk: any) => spk.orderId === linkedOrder.id);
    if (linkedSpk) {
      updateItem('spk_produksi', linkedSpk.id, {
        targetQty: newQty,
        ...(deadline ? { tanggalSelesai: deadline } : {}),
        ...(req.body.size ? { sizeChart: req.body.size } : {})
      });
      recomputeSpk(linkedSpk.id);
      syncOrderStatus(linkedOrder.id);
    }

    // 3. Reissue the invoice, carrying over whatever has already been paid and billed.
    const activeInvoice = readTable('invoices').find(
      (inv: any) => !inv.supersededBy && (inv.orderId === linkedOrder.id || inv.quotationId === quotation.id)
    );

    invoiceReplaced = !!activeInvoice;
    newInvoice = activeInvoice
      ? reviseInvoice(activeInvoice, {
          total: newTotal,
          schedule: revisedSchedule,
          revisedBy,
          quotationId: newQuotation.id
        })
      // A deal closed before invoices were born with the order gets its invoice now.
      : createInvoiceForOrder(updatedOrder, { reviewStatus: 'Draft', user: revisedBy });
  }

  res.json({
    success: true,
    message:
      `Revisi ${quoNext.revision} diterbitkan: ${newQuotation.id}. ` +
      (newInvoice
        ? invoiceReplaced
          ? `Faktur ${newInvoice.id} menggantikan yang lama, pembayaran yang sudah masuk tetap terhitung.`
          : `Faktur ${newInvoice.id} diterbitkan untuk pesanan ini.`
        : 'Pesanan terkait sudah disinkronkan.'),
    quotation: newQuotation,
    order: updatedOrder,
    invoice: newInvoice
  });
});

// Dashboard Analytics KPIs
app.get('/api/dashboard/stats', requireStaff, (_req: Request, res: Response) => {
  const orders = readTable('orders');
  const spks = readTable('spk_produksi');
  const customers = readTable('customers');
  const invoices = readTable('invoices');
  const qcReports = readTable('qc_reports');
  const bundles = readTable('wip_bundles');

  const totalOrders = orders.length;
  const activeSpks = spks.filter(s => s.status !== 'Completed');
  const totalPcsInProduction = activeSpks.reduce((acc, s) => acc + (Number(s.targetQty) || 0), 0);
  
  // A superseded revision is history; counting it doubled piutang after every Revisi Qty.
  const liveInvoices = invoices.filter(i => !i.supersededBy);
  const totalRevenue = liveInvoices.reduce((acc, i) => acc + (Number(i.total) || 0), 0);
  // Owed now: instalments still waiting on production are not piutang yet.
  const pendingPayment = liveInvoices.reduce((acc, i) => acc + (Number(i.dueNow ?? i.balanceRemaining) || 0), 0);

  const totalInspected = qcReports.reduce((acc, q) => acc + (Number(q.totalInspected) || 0), 0);
  const totalPassed = qcReports.reduce((acc, q) => acc + (Number(q.passedQty) || 0), 0);
  const defectRate = totalInspected > 0 ? (((totalInspected - totalPassed) / totalInspected) * 100).toFixed(1) : '0';

  res.json({
    totalOrders,
    activeOrdersCount: activeSpks.length,
    totalPcsInProduction,
    totalRevenue,
    pendingPayment,
    defectRate: `${defectRate}%`,
    totalCustomers: customers.length,
    activeBundlesCount: bundles.length
  });
});

// ---------------------------------------------------------
// SOP-20: KAS MASUK & REKONSILIASI PIUTANG / INVOICE
// ---------------------------------------------------------

// Dedicated Endpoint: Record Kas Masuk / Payment with auto invoice & order reconciliation
app.post('/api/payments/record', requireModule('Finance'), (req: Request, res: Response) => {
  const {
    orderId,
    invoiceId,
    customerId,
    customerName,
    amount,
    type,
    date,
    paymentMethod,
    bankAccount,
    proofImageUrl,
    notes,
    user,
    status
  } = req.body;

  if (!amount || Number(amount) <= 0) {
    return res.status(400).json({ error: 'Nominal pembayaran harus lebih dari 0.' });
  }
  const recOrder = orderId ? findById('orders', orderId) : (invoiceId ? findById('orders', activeInvoiceFor(invoiceId)?.orderId) : null);
  // A cancelled order takes money only for the sample fee it still owes.
  const recInvoice = recOrder ? activeInvoiceForOrder(recOrder.id) : null;
  if (recOrder?.status === 'Cancelled' && !(Number(recInvoice?.cancellationFee) > 0 && Number(recInvoice?.balanceRemaining) > 0)) {
    return res.status(409).json({ error: `Pesanan ${recOrder.id} sudah dibatalkan; pembayaran tidak dicatat.` });
  }

  const paymentId = nextId('payments', 'PAY');

  // A payment against a replaced revision lands on the revision now in force.
  let targetInvoiceId = invoiceId ? (activeInvoiceFor(invoiceId)?.id || invoiceId) : invoiceId;
  let targetOrderId = orderId;
  let targetCustomerId = customerId;
  let targetCustomerName = customerName;

  // If invoiceId given, lookup details
  if (targetInvoiceId) {
    const inv = findById('invoices', targetInvoiceId);
    if (inv) {
      if (!targetOrderId) targetOrderId = inv.orderId;
      if (!targetCustomerId) targetCustomerId = inv.customerId;
      if (!targetCustomerName) targetCustomerName = inv.customerName;
    }
  } else if (targetOrderId) {
    const matched = activeInvoiceForOrder(targetOrderId);
    if (matched) {
      targetInvoiceId = matched.id;
      if (!targetCustomerId) targetCustomerId = matched.customerId;
      if (!targetCustomerName) targetCustomerName = matched.customerName;
    }
  }

  /*
   * Verified money lands in the oldest unsettled instalment; the payment keeps
   * its name so the history reads "DP", "Termin 2"... rather than whatever
   * was picked in the form.
   */
  // Finance records money it has seen, or parks a proof for checking; nothing else.
  const paymentStatus = status === 'Pending Verification' ? 'Pending Verification' : 'Verified';
  const landing = targetInvoiceId ? openTermFor(syncInvoiceTerms(targetInvoiceId)) : null;

  const paymentPayload = {
    id: paymentId,
    orderId: targetOrderId || '',
    invoiceId: targetInvoiceId || '',
    customerId: targetCustomerId || '',
    customerName: targetCustomerName || 'Klien',
    amount: Number(amount),
    type: landing ? paymentTypeForTerm(landing.index, landing.count) : type || 'DP',
    ...(landing ? { termId: landing.term.id, termLabel: landing.term.label } : {}),
    date: date || new Date().toISOString().split('T')[0],
    paymentMethod: paymentMethod || bankAccount || 'Transfer Bank BCA',
    bankAccount: bankAccount || paymentMethod || 'Transfer Bank BCA',
    proofImageUrl: proofImageUrl || '',
    status: paymentStatus,
    notes: notes || `Penerimaan kas masuk ${landing ? landing.term.label : type || 'pembayaran'}.`,
    user: user || 'Finance Staff',
    timestamp: new Date().toISOString()
  };

  const creditBefore = targetInvoiceId ? creditForInvoice(findById('invoices', targetInvoiceId))?.remaining || 0 : 0;
  const newPayment = insertItem('payments', paymentPayload);

  // Auto reconcile invoice balance
  let updatedInvoice = null;
  if (targetInvoiceId) {
    updatedInvoice = reconcileInvoice(targetInvoiceId);
  }
  reconcileOrderPayments(targetOrderId);
  const excess = updatedInvoice ? (creditForInvoice(updatedInvoice)?.remaining || 0) - creditBefore : 0;

  res.status(201).json({
    success: true,
    message:
      `Pembayaran Rp ${Number(amount).toLocaleString('id-ID')} berhasil dicatat.` +
      (excess > 0 ? ` Kelebihan Rp ${excess.toLocaleString('id-ID')} menjadi saldo pelanggan.` : ''),
    payment: newPayment,
    invoice: updatedInvoice
  });
});

// Endpoint to verify payment and trigger reconciliation
app.post('/api/payments/:id/verify', requireModule('Finance'), (req: Request, res: Response) => {
  const paymentId = req.params.id;
  const payment = findById('payments', paymentId);
  if (!payment) return res.status(404).json({ error: 'Pembayaran tidak ditemukan.' });

  const updatedPayment = updateItem('payments', paymentId, { status: 'Verified' });
  let updatedInvoice = null;
  if (payment.invoiceId) {
    updatedInvoice = reconcileInvoice(payment.invoiceId);
  }
  reconcileOrderPayments(payment.orderId);

  res.json({
    success: true,
    message: 'Pembayaran berhasil diverifikasi.',
    payment: updatedPayment,
    invoice: updatedInvoice
  });
});

/*
 * A payment recorded by mistake is voided, never deleted: the row stays as the
 * audit trail, the invoice and order are recomputed without it.
 */
app.post('/api/payments/:id/reject', requireModule('Finance', 'Orders'), (req: Request, res: Response) => {
  const payment = findById('payments', req.params.id);
  if (!payment) return res.status(404).json({ error: 'Pembayaran tidak ditemukan.' });
  if (payment.status === 'Rejected') return res.status(409).json({ error: 'Pembayaran ini sudah dibatalkan.' });
  /*
   * Saldo already refunded, forfeited or moved was backed by this money. A
   * void that would leave less than that is refused: undo the saldo step first.
   */
  const payInvoice = payment.invoiceId ? activeInvoiceFor(payment.invoiceId) : activeInvoiceForOrder(payment.orderId);
  const payCredit = payInvoice ? creditForInvoice(payInvoice) : null;
  if (payCredit && payment.status === 'Verified') {
    const paidAfter = verifiedPaidForInvoice(payInvoice) - (Number(payment.amount) || 0);
    const { owed } = creditOwedFor(payInvoice, paidAfter);
    if (creditUsed(payCredit) > owed) {
      return res.status(409).json({
        error: `Pembayaran ${payment.id} tidak bisa dibatalkan: saldo ${payCredit.id} dari pembayaran ini sudah dikembalikan atau dipindahkan.`
      });
    }
  }
  const actor = actorUser(req);
  const reason = String(req.body?.reason || '').trim();
  const updatedPayment = updateItem('payments', payment.id, {
    status: 'Rejected',
    rejectedBy: actor?.name || '',
    rejectedAt: new Date().toISOString(),
    notes: `${payment.notes ? payment.notes + ' | ' : ''}Dibatalkan ${actor?.name || 'staf'}${reason ? `: ${reason}` : ''}`
  });
  // Saldo moved onto this invoice goes back to where it came from.
  if (payment.adjustmentType === 'Pindahan Saldo' && payment.creditId) {
    const source = findById('customer_credits', payment.creditId);
    if (source) {
      updateItem('customer_credits', source.id, {
        history: (source.history || []).filter((h: any) => h.paymentId !== payment.id)
      });
      const sourceInvoice = activeInvoiceFor(source.invoiceId);
      if (sourceInvoice) syncCreditFor(sourceInvoice);
    }
  }
  const updatedInvoice = payment.invoiceId ? reconcileInvoice(payment.invoiceId) : null;
  reconcileOrderPayments(payment.orderId);
  res.json({ success: true, message: `Pembayaran ${payment.id} dibatalkan.`, payment: updatedPayment, invoice: updatedInvoice });
});

/*
 * A deduction the customer made instead of paying: PPh 23 withheld, a bank
 * fee taken off the transfer, rounding. It settles the invoice like money but
 * is not kas masuk. PPh 23 keeps the number of its bukti potong when known.
 */
app.post('/api/payments/adjust', requireModule('Finance'), (req: Request, res: Response) => {
  const { invoiceId, amount, adjustmentType, reference, notes, date } = req.body || {};
  const invoice = invoiceId ? activeInvoiceFor(String(invoiceId)) : null;
  if (!invoice) return res.status(404).json({ error: 'Faktur tidak ditemukan.' });
  if (invoice.status === 'Dibatalkan') return res.status(409).json({ error: `Faktur ${invoice.id} sudah dibatalkan.` });
  if (!(DEDUCTION_TYPES as readonly string[]).includes(String(adjustmentType))) {
    return res.status(400).json({ error: 'Pilih jenis potongan.' });
  }
  const value = Number(amount);
  if (!(value > 0)) return res.status(400).json({ error: 'Nominal potongan harus lebih dari 0.' });
  const balance = Math.max(0, (Number(invoice.total) || 0) - verifiedPaidForInvoice(invoice));
  if (value > balance) {
    return res.status(409).json({ error: `Potongan Rp ${value.toLocaleString('id-ID')} melebihi sisa tagihan Rp ${balance.toLocaleString('id-ID')}.` });
  }
  const actor = actorUser(req);
  const landing = openTermFor(syncInvoiceTerms(invoice.id));
  const payment = insertItem('payments', {
    id: nextId('payments', 'PAY'),
    orderId: invoice.orderId || '',
    invoiceId: invoice.id,
    customerId: invoice.customerId || '',
    customerName: invoice.customerName || 'Klien',
    amount: value,
    type: 'Custom',
    adjustmentType,
    reference: String(reference || '').trim(),
    ...(landing ? { termId: landing.term.id, termLabel: landing.term.label } : {}),
    date: date || localDate(),
    paymentMethod: `Potongan ${adjustmentType}`,
    status: 'Verified',
    notes: String(notes || '').trim() || `Potongan ${adjustmentType} oleh pelanggan.`,
    user: actor?.name || 'Admin Keuangan',
    timestamp: new Date().toISOString()
  });
  const updatedInvoice = reconcileInvoice(invoice.id);
  reconcileOrderPayments(invoice.orderId);
  res.status(201).json({
    success: true,
    message: `Potongan ${adjustmentType} Rp ${value.toLocaleString('id-ID')} dicatat pada ${invoice.id}.`,
    payment,
    invoice: updatedInvoice
  });
});

/*
 * Saldo pelanggan is settled one step at a time: refunded to the customer,
 * moved to another invoice of the same customer (recorded there as a
 * 'Pindahan Saldo' payment), or, for a cancelled order, declared forfeited.
 */
app.post('/api/credits/:id/resolve', requireModule('Finance'), (req: Request, res: Response) => {
  const credit = findById('customer_credits', req.params.id);
  if (!credit) return res.status(404).json({ error: 'Saldo pelanggan tidak ditemukan.' });
  const { action, targetInvoiceId, method, note } = req.body || {};
  const value = Number(req.body?.amount);
  if (!['Refund', 'Hangus', 'Pindah'].includes(action)) return res.status(400).json({ error: 'Pilih tindakan untuk saldo ini.' });
  if (!(value > 0)) return res.status(400).json({ error: 'Nominal harus lebih dari 0.' });
  if (value > Number(credit.remaining)) {
    return res.status(409).json({ error: `Nominal melebihi sisa saldo Rp ${Number(credit.remaining).toLocaleString('id-ID')}.` });
  }
  if (action === 'Hangus' && credit.source !== 'Pesanan Batal') {
    return res.status(409).json({ error: 'Hanya saldo dari pesanan batal yang bisa dinyatakan hangus. Kelebihan bayar dikembalikan atau dipindah.' });
  }
  const noteText = String(note || '').trim();
  if (action === 'Hangus' && !noteText) return res.status(400).json({ error: 'Tulis dasar DP hangus (mis. pasal di penawaran).' });

  const actor = actorUser(req);
  const now = new Date().toISOString();
  const entry: any = { at: now, by: actor?.name || 'Admin Keuangan', action, amount: value, ...(noteText ? { note: noteText } : {}) };

  if (action === 'Refund') {
    entry.method = String(method || '').trim() || 'Transfer Bank';
  }
  if (action === 'Pindah') {
    const target = targetInvoiceId ? activeInvoiceFor(String(targetInvoiceId)) : null;
    if (!target) return res.status(404).json({ error: 'Faktur tujuan tidak ditemukan.' });
    if ((target.revisionOf || target.id) === credit.invoiceId) return res.status(409).json({ error: 'Faktur tujuan sama dengan asal saldo.' });
    if (target.status === 'Dibatalkan') return res.status(409).json({ error: `Faktur ${target.id} sudah dibatalkan.` });
    if (String(target.customerId) !== String(credit.customerId)) {
      return res.status(409).json({ error: 'Saldo hanya bisa dipindah ke faktur pelanggan yang sama.' });
    }
    const targetBalance = Math.max(0, (Number(target.total) || 0) - verifiedPaidForInvoice(target));
    if (value > targetBalance) {
      return res.status(409).json({ error: `Nominal melebihi sisa tagihan ${target.id} (Rp ${targetBalance.toLocaleString('id-ID')}).` });
    }
    const landing = openTermFor(syncInvoiceTerms(target.id));
    const moved = insertItem('payments', {
      id: nextId('payments', 'PAY'),
      orderId: target.orderId || '',
      invoiceId: target.id,
      customerId: target.customerId || '',
      customerName: target.customerName || 'Klien',
      amount: value,
      type: landing ? paymentTypeForTerm(landing.index, landing.count) : 'Custom',
      adjustmentType: 'Pindahan Saldo',
      creditId: credit.id,
      reference: credit.id,
      ...(landing ? { termId: landing.term.id, termLabel: landing.term.label } : {}),
      date: localDate(),
      paymentMethod: `Saldo ${credit.id}`,
      status: 'Verified',
      notes: `Dipindah dari saldo ${credit.id} (${credit.source}, ${credit.invoiceId}).${noteText ? ` ${noteText}` : ''}`,
      user: actor?.name || 'Admin Keuangan',
      timestamp: now
    });
    entry.targetInvoiceId = target.id;
    entry.paymentId = moved.id;
  }

  updateItem('customer_credits', credit.id, { history: [...(credit.history || []), entry] });
  const sourceInvoice = activeInvoiceFor(credit.invoiceId);
  if (sourceInvoice) syncCreditFor(sourceInvoice);
  if (entry.targetInvoiceId) {
    reconcileInvoice(entry.targetInvoiceId);
    reconcileOrderPayments(findById('invoices', entry.targetInvoiceId)?.orderId);
  }
  const label = action === 'Refund' ? 'dikembalikan' : action === 'Hangus' ? 'dinyatakan hangus' : `dipindah ke ${entry.targetInvoiceId}`;
  res.json({
    success: true,
    message: `Rp ${value.toLocaleString('id-ID')} dari saldo ${credit.id} ${label}.`,
    credit: findById('customer_credits', credit.id)
  });
});

/*
 * Faktur dibuat dari menu Keuangan. A priced order's invoice is the order's:
 * its total and its instalments, never figures typed into the form. Paid,
 * balance and status always come from the verified payments.
 */
app.post('/api/invoices', requireModule('Finance', 'Orders'), (req: Request, res: Response) => {
  const data = req.body || {};
  const orderId = String(data.orderId || '').trim();
  const order = orderId ? findById('orders', orderId) : null;
  if (orderId && !order) return res.status(404).json({ error: `Pesanan ${orderId} tidak ditemukan.` });
  if (order?.status === 'Cancelled') return res.status(409).json({ error: `Pesanan ${order.id} sudah dibatalkan.` });
  /*
   * Two live invoices for one order split the payments between them: one stayed
   * "Belum Bayar" forever and omzet counted the order twice.
   */
  const existing = order ? activeInvoiceForOrder(order.id) : null;
  if (existing) {
    return res.status(409).json({
      error: `Pesanan ${order.id} sudah punya faktur ${existing.id}. Buka faktur itu, atau revisi lewat Surat Penawaran.`
    });
  }
  const actor = actorUser(req);

  if (order && Number(order.totalPrice) > 0) {
    const invoice = createInvoiceForOrder(order, {
      reviewStatus: 'Draft',
      notes: String(data.notes || '').trim() || undefined,
      user: actor?.name
    });
    return res.status(201).json(invoice);
  }

  // No order, or an imported order with no price: a plain invoice for the typed total.
  const amount = Number(data.amount) || Number(data.total) || 0;
  const tax = Number(data.tax) || 0;
  const total = Number(data.total) || amount + tax;
  if (total <= 0) return res.status(400).json({ error: 'Isi total tagihan faktur.' });

  const created = insertItem('invoices', {
    id: nextId('invoices', 'INV'),
    orderId: order?.id || '',
    customerId: order?.customerId || String(data.customerId || ''),
    customerName: order?.customerName || String(data.customerName || '').trim() || 'Klien',
    amount,
    tax,
    total,
    downPaymentReceived: 0,
    balanceRemaining: total,
    status: 'Belum Bayar',
    reviewStatus: 'Draft',
    notes: String(data.notes || '').trim() || 'Faktur manual.',
    user: actor?.name || 'Admin Keuangan',
    timestamp: new Date().toISOString()
  });
  res.status(201).json(reconcileInvoice(created.id) || created);
});

/*
 * Bills one instalment: stamps its number and date so it can be printed and
 * sent. An instalment is billed when its milestone is reached; billing one
 * earlier (the customer asks for it, or a deal made outside the usual flow)
 * needs a reason, which stays on the record.
 */
app.post('/api/invoices/:id/terms/:termId/bill', requireModule('Finance'), (req: Request, res: Response) => {
  const invoice = syncInvoiceTerms(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Faktur tidak ditemukan.' });
  if (invoice.supersededBy) {
    return res.status(409).json({ error: `Faktur ${invoice.id} sudah diganti ${invoice.supersededBy}. Tagih dari faktur terbaru.` });
  }
  const order = invoice.orderId ? findById('orders', invoice.orderId) : null;
  if (order?.status === 'Cancelled' && !(Number(invoice.cancellationFee) > 0)) {
    return res.status(409).json({ error: `Pesanan ${order.id} sudah dibatalkan.` });
  }

  const terms: any[] = Array.isArray(invoice.paymentSchedule) ? invoice.paymentSchedule : [];
  const index = terms.findIndex(t => String(t.id) === String(req.params.termId));
  if (index === -1) return res.status(404).json({ error: 'Termin tidak ditemukan di faktur ini.' });
  const term = terms[index];
  if (term.billedAt) {
    return res.status(409).json({ error: `${term.label} sudah ditagih dengan nomor ${term.billNo}.` });
  }
  if (term.status === 'Lunas') return res.status(409).json({ error: `${term.label} sudah lunas; tidak ada yang ditagih.` });

  const reason = String(req.body?.reason || '').trim();
  if (!term.readyAt && !reason) {
    const trigger = termTrigger(term, index, terms.length);
    return res.status(409).json({
      error: trigger === 'manual'
        ? `Tulis alasan menagih ${term.label} sekarang.`
        : `${term.label} baru jatuh tagih saat "${TERM_TRIGGER_LABELS[trigger]}". Tulis alasan bila memang ditagih lebih awal.`,
      needsReason: true
    });
  }

  const dueDays = req.body?.dueDays === undefined || req.body?.dueDays === '' ? DEFAULT_TERM_DUE_DAYS : Number(req.body.dueDays);
  if (!Number.isInteger(dueDays) || dueDays < 0 || dueDays > 90) {
    return res.status(400).json({ error: 'Jatuh tempo harus 0–90 hari.' });
  }

  const actor = actorUser(req);
  const now = new Date().toISOString();
  const baseNo = invoice.invoiceNo || invoice.revisionOf || invoice.id;
  const nextTerms = terms.map((t, i) =>
    i === index
      ? {
          ...t,
          billNo: `${baseNo}/T${index + 1}`,
          billedAt: now,
          billedBy: actor?.name || 'Admin Keuangan',
          dueDate: addDays(localDate(), dueDays),
          ...(!t.readyAt ? { billedEarlyReason: reason } : {})
        }
      : t
  );
  // A billed instalment has gone to the customer, so the invoice has too.
  updateItem('invoices', invoice.id, {
    paymentSchedule: nextTerms,
    ...(invoice.reviewStatus !== 'Sent' ? { reviewStatus: 'Sent', sentAt: now, sentBy: actor?.name || 'Admin Keuangan' } : {})
  });
  const updated = syncInvoiceTerms(invoice.id);
  const billed = updated.paymentSchedule[index];
  res.json({
    success: true,
    message: `${billed.label} ditagih dengan nomor ${billed.billNo}.`,
    invoice: updated,
    term: billed
  });
});

// SOP-20: finance has checked a draft invoice and sent it to the customer.
app.post('/api/invoices/:id/mark-sent', requireModule('Finance'), (req: Request, res: Response) => {
  const invoice = findById('invoices', req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Faktur tidak ditemukan.' });
  if (invoice.supersededBy) return res.status(409).json({ error: `Faktur ${invoice.id} sudah diganti ${invoice.supersededBy}.` });
  if (invoice.reviewStatus === 'Sent') return res.status(409).json({ error: `Faktur ${invoice.id} sudah ditandai terkirim.` });
  const actor = actorUser(req);
  const updated = updateItem('invoices', invoice.id, {
    reviewStatus: 'Sent',
    sentAt: new Date().toISOString(),
    sentBy: actor?.name || 'Admin Keuangan'
  });
  res.json({ success: true, message: `Faktur ${invoice.id} ditandai sudah dikirim.`, invoice: updated });
});

/*
 * A reminder sent over WhatsApp for a billed instalment. The message itself
 * leaves from the browser (wa.me); the server keeps when and by whom, so the
 * next person chasing the customer sees it was already done.
 */
app.post('/api/invoices/:id/terms/:termId/remind', requireModule('Finance'), (req: Request, res: Response) => {
  const invoice = findById('invoices', req.params.id);
  if (!invoice || invoice.supersededBy) return res.status(404).json({ error: 'Faktur aktif tidak ditemukan.' });
  const terms: any[] = Array.isArray(invoice.paymentSchedule) ? invoice.paymentSchedule : [];
  const index = terms.findIndex(t => String(t.id) === String(req.params.termId));
  if (index === -1) return res.status(404).json({ error: 'Termin tidak ditemukan di faktur ini.' });
  const term = terms[index];
  if (!term.billedAt) return res.status(409).json({ error: `${term.label} belum ditagih.` });
  if (term.status === 'Lunas') return res.status(409).json({ error: `${term.label} sudah lunas.` });
  const actor = actorUser(req);
  const reminder = { at: new Date().toISOString(), by: actor?.name || 'Admin Keuangan' };
  const updated = updateItem('invoices', invoice.id, {
    paymentSchedule: terms.map((t, i) => (i === index ? { ...t, reminders: [...(t.reminders || []), reminder] } : t))
  });
  res.json({ success: true, message: `Pengingat ${term.label} dicatat.`, invoice: updated });
});

// ---------------------------------------------------------
// SOP-16 → SOP-20: DRAFT INVOICE WHEN AN ORDER LEAVES THE WAREHOUSE
// ---------------------------------------------------------
const SHIPPED_STATUSES = ['Picked Up', 'In Transit', 'Delivered'];

/*
 * Orders from before invoices were born with the order reach the courier with
 * no invoice; they get their draft here. Every other order already has one,
 * and the shipment only makes its settlement instalment due.
 */
function ensureDraftInvoiceForShipment(shipment: any) {
  if (!shipment || !SHIPPED_STATUSES.includes(shipment.status) || !shipment.orderId) return null;
  const order = findById('orders', shipment.orderId);
  if (!order) return null;
  return createInvoiceForOrder(order, {
    reviewStatus: 'Draft',
    shipmentId: shipment.id,
    notes: `Draf otomatis dari surat jalan ${shipment.id}. Periksa sebelum dikirim ke pelanggan.`
  });
}

const SHIPMENT_STATUSES = ['Packing', 'Surat Jalan Dibuat', 'Picked Up', 'In Transit', 'Delivered'];

/*
 * SOP-16 gate, on the server this time: the browser checked for a QC Accept
 * before offering the form, but the API took any body. A surat jalan for an
 * order that failed QC, or for no order at all, drove the order to "Dikirim".
 */
function shipmentBlockReason(body: any, existing?: any): string | null {
  const orderId = body?.orderId ?? existing?.orderId;
  if (!orderId) return 'Surat jalan harus terhubung ke pesanan.';
  const order = findById('orders', orderId);
  if (!order) return `Pesanan ${orderId} tidak ditemukan.`;
  if (order.status === 'Cancelled') return `Pesanan ${orderId} sudah dibatalkan.`;
  if (!existing && order.status === 'Completed') return `Pesanan ${orderId} sudah selesai; tidak ada yang dikirim lagi.`;
  // Delivered is the proof a pelunasan rests on: who received the goods, and when.
  if (body?.status === 'Delivered' && existing?.status !== 'Delivered') {
    const receiver = String(body?.receivedBy ?? existing?.receivedBy ?? '').trim();
    if (!receiver) return 'Isi nama penerima barang sebelum menandai sampai tujuan.';
  }
  if (body?.status !== undefined && !SHIPMENT_STATUSES.includes(String(body.status))) {
    return `Status pengiriman "${body.status}" tidak dikenal.`;
  }
  if (existing && body?.status !== undefined && SHIPMENT_STATUSES.indexOf(String(body.status)) < SHIPMENT_STATUSES.indexOf(String(existing.status))) {
    return `Status pengiriman tidak bisa mundur dari "${existing.status}" ke "${body.status}".`;
  }
  const spks = readTable('spk_produksi').filter((s: any) => s.orderId === orderId);
  if (spks.length === 0) return `Pesanan ${orderId} belum punya SPK, jadi belum ada yang bisa dikirim.`;
  if (!spks.some((s: any) => spkQcAccepted(s.id))) {
    return `Hasil QC pesanan ${orderId} belum berstatus Accept. Selesaikan pemeriksaan QC dulu.`;
  }
  if (!existing) {
    const open = readTable('shipments').find((s: any) => s.orderId === orderId && s.status !== 'Delivered');
    if (open) return `Pesanan ${orderId} sudah punya surat jalan ${open.id} yang masih berjalan.`;
  }
  return null;
}

app.post('/api/shipments', requireModule('Shipping'), (req: Request, res: Response) => {
  const blocked = shipmentBlockReason(req.body);
  if (blocked) return res.status(409).json({ error: blocked });
  if (req.body?.id && findById('shipments', req.body.id)) {
    return res.status(409).json({ error: `Nomor surat jalan ${req.body.id} sudah dipakai.` });
  }
  const shipment = insertItem('shipments', { ...req.body, id: req.body?.id || nextId('shipments', 'SJ') });
  const draftInvoice = ensureDraftInvoiceForShipment(shipment);
  if (SHIPPED_STATUSES.includes(shipment.status)) completeSpkForOrder(shipment.orderId);
  syncOrderStatus(shipment.orderId);
  res.status(201).json({ ...shipment, draftInvoiceId: draftInvoice?.id });
});

app.put('/api/shipments/:id', requireModule('Shipping'), (req: Request, res: Response) => {
  const existing = findById('shipments', req.params.id);
  if (!existing) return res.status(404).json({ error: 'Data tidak ditemukan.' });
  const blocked = shipmentBlockReason(req.body, existing);
  if (blocked) return res.status(409).json({ error: blocked });
  const shipment = updateItem('shipments', req.params.id, req.body);
  const draftInvoice = ensureDraftInvoiceForShipment(shipment);
  if (SHIPPED_STATUSES.includes(shipment.status)) completeSpkForOrder(shipment.orderId);
  syncOrderStatus(shipment.orderId);
  res.json({ ...shipment, draftInvoiceId: draftInvoice?.id });
});

// ---------------------------------------------------------
// STOREFRONT: VOUCHER, REFERRAL, CHECKOUT & SYNC
// ---------------------------------------------------------

// Validate Discount Voucher
app.post('/api/store/discounts/validate', (req: Request, res: Response) => {
  const { code, subtotal } = req.body;
  if (!code) {
    return res.status(400).json({ valid: false, error: 'Masukkan kode voucher.' });
  }

  const discounts = readTable('store_discounts');
  const voucher = discounts.find(v => String(v.code).toUpperCase() === String(code).trim().toUpperCase());

  if (!voucher) {
    return res.status(404).json({ valid: false, error: 'Kode voucher tidak ditemukan.' });
  }

  if (!voucher.isActive) {
    return res.status(400).json({ valid: false, error: 'Voucher sudah tidak aktif.' });
  }

  const now = new Date().toISOString().split('T')[0];
  if (voucher.validUntil && voucher.validUntil < now) {
    return res.status(400).json({ valid: false, error: 'Voucher sudah kedaluwarsa.' });
  }

  if (voucher.quota && voucher.usedCount >= voucher.quota) {
    return res.status(400).json({ valid: false, error: 'Kuota voucher telah habis.' });
  }

  const currentSubtotal = Number(subtotal) || 0;
  if (voucher.minSpend && currentSubtotal < voucher.minSpend) {
    return res.status(400).json({ 
      valid: false, 
      error: `Minimal belanja Rp ${Number(voucher.minSpend).toLocaleString('id-ID')} untuk menggunakan voucher ini.` 
    });
  }

  let discountAmount = 0;
  if (voucher.type === 'percentage') {
    discountAmount = Math.round((currentSubtotal * voucher.value) / 100);
    if (voucher.maxDiscount && discountAmount > voucher.maxDiscount) {
      discountAmount = voucher.maxDiscount;
    }
  } else {
    discountAmount = Math.min(currentSubtotal, voucher.value);
  }

  res.json({
    valid: true,
    discountAmount,
    voucher
  });
});

// Validate Referral Code
app.post('/api/store/referrals/validate', (req: Request, res: Response) => {
  const { code } = req.body;
  if (!code) {
    return res.status(400).json({ valid: false, error: 'Masukkan kode referral.' });
  }

  const referrals = readTable('store_referrals');
  const referral = referrals.find(r => String(r.code).toUpperCase() === String(code).trim().toUpperCase());

  if (!referral) {
    return res.status(404).json({ valid: false, error: 'Kode referral tidak ditemukan.' });
  }

  if (referral.status !== 'Active') {
    return res.status(400).json({ valid: false, error: 'Kode referral sedang dinonaktifkan.' });
  }

  res.json({
    valid: true,
    referral: {
      id: referral.id,
      code: referral.code,
      referrerName: referral.referrerName,
      commissionRate: referral.commissionRate || 5,
      refereeDiscount: referral.refereeDiscount || 5
    }
  });
});

// Referral Payout / Disbursement
app.post('/api/store/referrals/:id/payout', requireModule('Accounts'), (req: Request, res: Response) => {
  const referral = findById('store_referrals', req.params.id);
  if (!referral) return res.status(404).json({ error: 'Mitra referral tidak ditemukan.' });

  const { amount, bankInfo, notes } = req.body;
  const payoutAmount = Number(amount) || 0;

  if (payoutAmount <= 0) {
    return res.status(400).json({ error: 'Nominal pencairan harus lebih dari 0.' });
  }

  if (payoutAmount > (referral.availableCommission || 0)) {
    return res.status(400).json({ error: 'Saldo komisi tidak mencukupi untuk dicairkan.' });
  }

  const payoutRecord = {
    id: `PAYOUT-${Date.now()}`,
    amount: payoutAmount,
    date: new Date().toISOString().split('T')[0],
    status: 'Paid',
    bankInfo: bankInfo || 'Transfer Bank',
    notes: notes || 'Pencairan komisi referral'
  };

  const updatedReferral = updateItem('store_referrals', referral.id, {
    withdrawnCommission: (referral.withdrawnCommission || 0) + payoutAmount,
    availableCommission: Math.max(0, (referral.availableCommission || 0) - payoutAmount),
    payoutHistory: [...(referral.payoutHistory || []), payoutRecord]
  });

  res.json({
    success: true,
    message: `Pencairan komisi Rp ${payoutAmount.toLocaleString('id-ID')} berhasil dicatat.`,
    referral: updatedReferral
  });
});

// Storefront Checkout: creates StoreOrder, ERP Order, Invoice, and payment instructions
app.post('/api/store/checkout', async (req: Request, res: Response) => {
  const {
    customerName,
    customerPhone,
    customerEmail,
    shippingAddress,
    notes,
    items,
    paymentMethod,
    voucherCode,
    referralCode,
    isDigital,
    digiflazzCustomerNo,
    digiflazzSku
  } = req.body;

  if (!customerName || !customerPhone || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Nama, nomor HP/WhatsApp, dan item belanja wajib diisi.' });
  }

  const storeOrders = readTable('store_orders');
  const nextOrderNum = storeOrders.length + 1;
  const storeOrderId = `ST-ORD-${Date.now().toString().slice(-4)}${String(nextOrderNum).padStart(2, '0')}`;

  // Calculate items subtotal and wholesale savings
  let calculatedSubtotal = 0;
  let totalWholesaleSavings = 0;
  const products = readTable('store_products');
  const flashSales = readTable('store_flashsales');
  const activeFlashSale = flashSales.find(f => f.isActive && f.status !== 'Ended');

  const processedItems = items.map((item: any) => {
    const product = products.find(p => p.id === item.productId);
    const qty = Math.max(1, Number(item.quantity) || 1);
    let unitPrice = Number(item.price) || 0;
    let basePrice = product ? Number(product.basePrice) : unitPrice;

    // Check if item is in active flash sale
    if (activeFlashSale) {
      const fsItem = activeFlashSale.items?.find((fi: any) => fi.productId === item.productId);
      if (fsItem && fsItem.quota > fsItem.sold) {
        unitPrice = fsItem.flashPrice;
      }
    }

    // Check wholesale tier pricing if not flash sale
    if (product && product.wholesaleTiers && (!activeFlashSale || !activeFlashSale.items?.some((fi: any) => fi.productId === item.productId))) {
      const matchedTier = [...product.wholesaleTiers]
        .sort((a, b) => b.minQty - a.minQty)
        .find(t => qty >= t.minQty && (!t.maxQty || qty <= t.maxQty));

      if (matchedTier) {
        unitPrice = matchedTier.price;
      }
    }

    // Add custom sablon add-on price if requested
    if (item.customNotes && product?.customSablonAvailable) {
      unitPrice += (product.sablonPriceAddon || 10000);
      basePrice += (product.sablonPriceAddon || 10000);
    }

    const itemSubtotal = unitPrice * qty;
    const itemOriginalTotal = basePrice * qty;
    const itemSavings = Math.max(0, itemOriginalTotal - itemSubtotal);

    calculatedSubtotal += itemSubtotal;
    totalWholesaleSavings += itemSavings;

    return {
      productId: item.productId,
      productName: item.productName || product?.name || 'Produk Konveksi',
      sku: item.sku || product?.sku || 'SKU-GEN',
      price: unitPrice,
      quantity: qty,
      size: item.size || 'All Size',
      color: item.color || 'Standard',
      customNotes: item.customNotes || '',
      subtotal: itemSubtotal
    };
  });

  // Calculate Voucher Discount
  let voucherDiscount = 0;
  let appliedVoucher: any = null;
  if (voucherCode) {
    const discounts = readTable('store_discounts');
    appliedVoucher = discounts.find(v => String(v.code).toUpperCase() === String(voucherCode).trim().toUpperCase());
    if (appliedVoucher && appliedVoucher.isActive && calculatedSubtotal >= (appliedVoucher.minSpend || 0)) {
      if (appliedVoucher.type === 'percentage') {
        voucherDiscount = Math.round((calculatedSubtotal * appliedVoucher.value) / 100);
        if (appliedVoucher.maxDiscount) {
          voucherDiscount = Math.min(voucherDiscount, appliedVoucher.maxDiscount);
        }
      } else {
        voucherDiscount = Math.min(calculatedSubtotal, appliedVoucher.value);
      }
      // Increment voucher used count
      updateItem('store_discounts', appliedVoucher.id, {
        usedCount: (appliedVoucher.usedCount || 0) + 1
      });
    }
  }

  // Calculate Referral Discount & Commission
  let referralDiscount = 0;
  let referralCommission = 0;
  let appliedReferral: any = null;
  if (referralCode) {
    const referrals = readTable('store_referrals');
    appliedReferral = referrals.find(r => String(r.code).toUpperCase() === String(referralCode).trim().toUpperCase());
    if (appliedReferral && appliedReferral.status === 'Active') {
      const refDiscountRate = appliedReferral.refereeDiscount || 5;
      const refCommRate = appliedReferral.commissionRate || 5;
      referralDiscount = Math.round((calculatedSubtotal * refDiscountRate) / 100);
      referralCommission = Math.round((calculatedSubtotal * refCommRate) / 100);

      // Update referral partner stats
      updateItem('store_referrals', appliedReferral.id, {
        totalOrdersCount: (appliedReferral.totalOrdersCount || 0) + 1,
        totalOrderAmount: (appliedReferral.totalOrderAmount || 0) + calculatedSubtotal,
        totalCommissionEarned: (appliedReferral.totalCommissionEarned || 0) + referralCommission,
        availableCommission: (appliedReferral.availableCommission || 0) + referralCommission
      });
    }
  }

  const grandTotal = Math.max(0, calculatedSubtotal - voucherDiscount - referralDiscount);

  // Generate Payment Gateway reference / QRIS string / Virtual Account
  const chosenMethod = paymentMethod || 'QRIS';
  let qrisData = '';
  let vaNumber = '';

  if (chosenMethod === 'QRIS') {
    // Dynamic QRIS payload string format compliant with standard Indonesian QRIS specifications
    qrisData = `00020101021226670016ID.CO.HIJ.WWW011893600911002${Date.now().toString().slice(-8)}52045812530336054${grandTotal}5802ID5920HIJ KONVEKSI BANDUNG6007BANDUNG62070703A016304${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
  } else if (chosenMethod.startsWith('VA_')) {
    const bankPrefix: Record<string, string> = {
      'VA_BCA': '80012',
      'VA_MANDIRI': '88708',
      'VA_BNI': '8277',
      'VA_BRI': '12888'
    };
    const prefix = bankPrefix[chosenMethod] || '88990';
    vaNumber = `${prefix}${customerPhone.replace(/\D/g, '').slice(-8)}`;
  }

  // Update flash sale quotas if any items sold
  if (activeFlashSale) {
    let fsUpdated = false;
    const updatedItems = activeFlashSale.items?.map((fi: any) => {
      const match = processedItems.find(pi => pi.productId === fi.productId);
      if (match) {
        fsUpdated = true;
        return { ...fi, sold: Math.min(fi.quota, (fi.sold || 0) + match.quantity) };
      }
      return fi;
    });
    if (fsUpdated) {
      updateItem('store_flashsales', activeFlashSale.id, { items: updatedItems });
    }
  }

  // Decrement product inventory stock
  processedItems.forEach(pi => {
    const p = products.find(prod => prod.id === pi.productId);
    if (p && p.stock !== undefined) {
      updateItem('store_products', p.id, {
        stock: Math.max(0, p.stock - pi.quantity)
      });
    }
  });

  // 1. Create linked ERP Customer & Order & Invoice so staff see it immediately
  let erpCustomerId = 'CUST-STORE';
  const existingCustomers = readTable('customers');
  const foundCust = existingCustomers.find(c => 
    String(c.contact || c.phone || '').replace(/\D/g, '') === customerPhone.replace(/\D/g, '')
  );
  if (foundCust) {
    erpCustomerId = foundCust.id;
  } else {
    const newCust = insertItem('customers', {
      id: `CUST-${Date.now().toString().slice(-4)}`,
      name: customerName,
      contact: customerPhone,
      phone: customerPhone,
      email: customerEmail || '',
      address: shippingAddress,
      status: 'Active',
      user: 'Storefront'
    });
    erpCustomerId = newCust.id;
  }

  const erpOrders = readTable('orders');
  const erpOrderId = `ORD-ST-${Date.now().toString().slice(-5)}`;
  const totalQty = processedItems.reduce((sum, item) => sum + item.quantity, 0);

  const newErpOrder = insertItem('orders', {
    id: erpOrderId,
    po: `PO-STORE-${Date.now().toString().slice(-6)}`,
    customerId: erpCustomerId,
    customerName: customerName,
    productType: processedItems.map(i => i.productName).slice(0, 2).join(', ') + (processedItems.length > 2 ? ' dll' : ''),
    quantity: totalQty,
    price: Math.round(grandTotal / (totalQty || 1)),
    totalPrice: grandTotal,
    dpRequired: grandTotal,
    downPayment: 0,
    dpPercent: 0,
    deadline: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
    status: 'Order',
    material: 'Katalog Storefront',
    color: processedItems.map(i => i.color).filter(Boolean).join(', '),
    size: processedItems.map(i => i.size).filter(Boolean).join(', '),
    notes: `Pesanan Toko Online #${storeOrderId}. Catatan: ${notes || '-'}. Pengiriman: ${shippingAddress}`,
    user: 'Storefront Online',
    timestamp: new Date().toISOString()
  });

  const erpInvoiceId = `INV-ST-${Date.now().toString().slice(-5)}`;
  const newErpInvoice = insertItem('invoices', {
    id: erpInvoiceId,
    orderId: erpOrderId,
    customerId: erpCustomerId,
    customerName: customerName,
    amount: grandTotal,
    tax: 0,
    total: grandTotal,
    downPaymentReceived: 0,
    balanceRemaining: grandTotal,
    status: 'Belum Bayar',
    paymentMethod: chosenMethod,
    reviewStatus: 'Sent',
    notes: `Tagihan Toko Online untuk order #${storeOrderId}`,
    user: 'Storefront Online'
  });

  // 2. Save Store Order
  const storeOrderPayload = {
    id: storeOrderId,
    customerName,
    customerPhone,
    customerEmail: customerEmail || '',
    shippingAddress,
    notes: notes || '',
    items: processedItems,
    subtotal: calculatedSubtotal,
    wholesaleSavings: totalWholesaleSavings,
    voucherCode: voucherCode || '',
    voucherDiscount,
    referralCode: referralCode || '',
    referralDiscount,
    referralCommission,
    totalAmount: grandTotal,
    paymentMethod: chosenMethod,
    paymentStatus: 'Pending',
    paymentRef: `PAY-REF-${Date.now()}`,
    qrisData,
    vaNumber,
    orderStatus: 'Menunggu Pembayaran',
    linkedOrderId: erpOrderId,
    linkedInvoiceId: erpInvoiceId,
    isDigital: !!isDigital,
    digiflazzCustomerNo: digiflazzCustomerNo || '',
    digiflazzSku: digiflazzSku || '',
    createdAt: new Date().toISOString()
  };

  const newStoreOrder = insertItem('store_orders', storeOrderPayload);

  res.status(201).json({
    success: true,
    message: 'Pesanan toko online berhasil dibuat!',
    order: newStoreOrder,
    erpOrder: newErpOrder,
    erpInvoice: newErpInvoice,
    paymentInstructions: {
      method: chosenMethod,
      totalAmount: grandTotal,
      qrisData,
      vaNumber,
      expiryMinutes: 15
    }
  });
});

// ---------------------------------------------------------
// PAYMENT GATEWAY: CONFIG, INSTANT SIMULATION & WEBHOOKS
// ---------------------------------------------------------

app.get('/api/payment/settings', requireModule('Accounts'), (_req: Request, res: Response) => {
  const settings = readTable('store_settings');
  const paymentConfig = settings.find(s => s.id === 'PAYMENT_CONFIG') || {
    id: 'PAYMENT_CONFIG',
    activeGateway: 'built_in_simulator',
    qrisMerchantName: 'HIJ KONVEKSI PT HASIL INTI JUALAN',
    autoVerifySimulation: true,
    midtrans: { merchantId: '', clientKey: '', serverKey: '', isProduction: false },
    tripay: { merchantCode: '', apiKey: '', privateKey: '', isProduction: false }
  };
  res.json(stripSensitive(paymentConfig));
});

app.post('/api/payment/settings', requireModule('Accounts'), (req: Request, res: Response) => {
  const existing = findById('store_settings', 'PAYMENT_CONFIG');
  const payload = { ...req.body, id: 'PAYMENT_CONFIG' };
  let updated;
  if (existing) {
    updated = updateItem('store_settings', 'PAYMENT_CONFIG', payload);
  } else {
    updated = insertItem('store_settings', payload);
  }
  res.json({ success: true, settings: updated });
});

// Simulate Instant Payment Success (Sandbox / Live Demo)
app.post('/api/payment/simulate-success', requireModule('Accounts'), async (req: Request, res: Response) => {
  const { storeOrderId, paymentMethod } = req.body;
  const storeOrder = findById('store_orders', storeOrderId);

  if (!storeOrder) {
    return res.status(404).json({ error: 'Pesanan toko online tidak ditemukan.' });
  }

  // Mark store order as Paid
  const updatedStoreOrder = updateItem('store_orders', storeOrder.id, {
    paymentStatus: 'Paid',
    orderStatus: storeOrder.isDigital ? 'Selesai' : 'Dalam Produksi',
    paidAt: new Date().toISOString()
  });

  // Reconcile ERP Invoice & Order
  if (storeOrder.linkedInvoiceId) {
    const inv = findById('invoices', storeOrder.linkedInvoiceId);
    if (inv) {
      // Record in payments table
      const paymentRecord = insertItem('payments', {
        id: `PAY-${Date.now().toString().slice(-6)}`,
        orderId: storeOrder.linkedOrderId || '',
        invoiceId: storeOrder.linkedInvoiceId,
        customerId: inv.customerId,
        customerName: storeOrder.customerName,
        amount: storeOrder.totalAmount,
        type: 'Pelunasan',
        date: new Date().toISOString().split('T')[0],
        paymentMethod: paymentMethod || storeOrder.paymentMethod || 'QRIS Gateway',
        status: 'Verified',
        notes: `Pembayaran otomatis via Gateway untuk Storefront #${storeOrder.id}`,
        user: 'Payment Gateway',
        timestamp: new Date().toISOString()
      });

      reconcileInvoice(storeOrder.linkedInvoiceId);
      reconcileOrderPayments(storeOrder.linkedOrderId);
    }
  }

  // If order contains Digiflazz digital goods, execute digital topup
  let digiResult = null;
  if (storeOrder.isDigital && storeOrder.digiflazzSku && storeOrder.digiflazzCustomerNo) {
    const digiTrxId = `DIGI-${Date.now().toString().slice(-6)}`;
    const snNumber = `SN-${Date.now()}${Math.floor(1000 + Math.random() * 9000)}`;
    
    digiResult = insertItem('digiflazz_transactions', {
      id: digiTrxId,
      ref_id: storeOrder.id,
      customer_no: storeOrder.digiflazzCustomerNo,
      buyer_sku_code: storeOrder.digiflazzSku,
      product_name: storeOrder.items?.[0]?.productName || 'Produk Digital',
      amount: storeOrder.totalAmount,
      sellingPrice: storeOrder.totalAmount,
      status: 'Sukses',
      message: `Topup berhasil diproses. SN: ${snNumber}`,
      sn: snNumber,
      timestamp: new Date().toISOString()
    });

    updateItem('store_orders', storeOrder.id, {
      digiflazzTrxId: digiTrxId,
      digiflazzSn: snNumber
    });
  }

  res.json({
    success: true,
    message: `Pembayaran pesanan ${storeOrder.id} senilai Rp ${storeOrder.totalAmount.toLocaleString('id-ID')} berhasil diverifikasi!`,
    storeOrder: updatedStoreOrder,
    digiflazz: digiResult
  });
});

// Midtrans / Tripay Webhook Receiver
app.post('/api/payment/webhook', (req: Request, res: Response) => {
  const payload = req.body;
  // Midtrans webhook
  const orderId = payload.order_id || payload.merchant_ref;
  const transactionStatus = payload.transaction_status || payload.status;

  if (!orderId) {
    return res.status(400).json({ error: 'Order ID tidak ditemukan dalam webhook payload.' });
  }

  const storeOrders = readTable('store_orders');
  const storeOrder = storeOrders.find(o => o.id === orderId || o.linkedOrderId === orderId);

  if (storeOrder) {
    const isSuccess = ['capture', 'settlement', 'PAID', 'success'].includes(transactionStatus);
    if (isSuccess) {
      updateItem('store_orders', storeOrder.id, {
        paymentStatus: 'Paid',
        orderStatus: 'Dalam Produksi',
        paidAt: new Date().toISOString()
      });
      if (storeOrder.linkedInvoiceId) {
        reconcileInvoice(storeOrder.linkedInvoiceId);
        reconcileOrderPayments(storeOrder.linkedOrderId);
      }
    }
  }

  res.json({ success: true, message: 'Webhook processed' });
});

// ---------------------------------------------------------
// DIGIFLAZZ PPOB & DIGITAL GOODS INTEGRATION
// ---------------------------------------------------------

app.get('/api/digiflazz/settings', requireModule('Accounts'), (_req: Request, res: Response) => {
  const settings = readTable('store_settings');
  const digiConfig = settings.find(s => s.id === 'DIGIFLAZZ_CONFIG') || {
    id: 'DIGIFLAZZ_CONFIG',
    username: '',
    apiKey: '',
    webhookSecret: '',
    isProduction: false,
    autoMarkupType: 'fixed',
    autoMarkupValue: 1500
  };
  res.json(stripSensitive(digiConfig));
});

app.post('/api/digiflazz/settings', requireModule('Accounts'), (req: Request, res: Response) => {
  const existing = findById('store_settings', 'DIGIFLAZZ_CONFIG');
  const payload = { ...req.body, id: 'DIGIFLAZZ_CONFIG' };
  let updated;
  if (existing) {
    updated = updateItem('store_settings', 'DIGIFLAZZ_CONFIG', payload);
  } else {
    updated = insertItem('store_settings', payload);
  }
  res.json({ success: true, settings: updated });
});

// Digiflazz Cek Saldo Real-Time
app.post('/api/digiflazz/balance', requireModule('Accounts'), async (req: Request, res: Response) => {
  const settings = readTable('store_settings');
  const config = settings.find(s => s.id === 'DIGIFLAZZ_CONFIG');

  const username = config?.username || process.env.DIGIFLAZZ_USERNAME;
  const apiKey = config?.apiKey || process.env.DIGIFLAZZ_API_KEY;

  if (!username || !apiKey) {
    return res.json({
      success: true,
      mode: 'sandbox_simulation',
      deposit: 2450000,
      currency: 'IDR',
      message: 'Mode Simulasi Sandbox (Kredensial Digiflazz belum diatur di menu admin).'
    });
  }

  try {
    const sign = crypto.createHash('md5').update(`${username}${apiKey}depo`).digest('hex');
    const response = await fetch('https://api.digiflazz.com/v1/cek-saldo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cmd: 'deposit',
        username: username,
        sign: sign
      })
    });

    const result: any = await response.json();
    if (result && result.data) {
      return res.json({
        success: true,
        mode: config.isProduction ? 'production' : 'development',
        deposit: result.data.deposit || 0,
        currency: 'IDR',
        message: 'Saldo berhasil diperbarui dari Digiflazz.'
      });
    }

    // Fallback if Digiflazz returned test message
    res.json({
      success: true,
      mode: 'sandbox_fallback',
      deposit: 2450000,
      message: result?.data?.message || 'Berhasil terhubung ke endpoint Digiflazz Sandbox'
    });
  } catch (err: any) {
    res.json({
      success: true,
      mode: 'offline_cached',
      deposit: 2450000,
      error: err.message,
      message: 'Mode offline sandbox aktif.'
    });
  }
});

// Digiflazz Sync Price List
app.post('/api/digiflazz/price-list', requireModule('Accounts'), async (req: Request, res: Response) => {
  const settings = readTable('store_settings');
  const config = settings.find(s => s.id === 'DIGIFLAZZ_CONFIG');
  const cachedProducts = readTable('digiflazz_products');

  const username = config?.username;
  const apiKey = config?.apiKey;

  if (!username || !apiKey) {
    return res.json({
      success: true,
      source: 'local_cached',
      count: cachedProducts.length,
      products: cachedProducts,
      message: 'Menampilkan katalog digital prabayar lokal.'
    });
  }

  try {
    const sign = crypto.createHash('md5').update(`${username}${apiKey}pricelist`).digest('hex');
    const response = await fetch('https://api.digiflazz.com/v1/price-list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cmd: 'prepaid',
        username: username,
        sign: sign
      })
    });

    const result: any = await response.json();
    if (result && Array.isArray(result.data)) {
      const markupType = config.autoMarkupType || 'fixed';
      const markupValue = Number(config.autoMarkupValue) || 1500;

      const syncedList = result.data.map((item: any) => {
        const base = Number(item.price) || 0;
        let sellingPrice = base + markupValue;
        if (markupType === 'percentage') {
          sellingPrice = Math.round(base + (base * markupValue) / 100);
        }

        return {
          buyer_sku_code: item.buyer_sku_code,
          product_name: item.product_name,
          category: item.category,
          brand: item.brand,
          type: item.type,
          price: base,
          sellingPrice,
          buyer_product_status: item.buyer_product_status,
          seller_product_status: item.seller_product_status,
          unlimited_stock: item.unlimited_stock,
          stock: item.stock || 999,
          desc: item.desc
        };
      });

      writeTable('digiflazz_products', syncedList);
      return res.json({
        success: true,
        source: 'digiflazz_live',
        count: syncedList.length,
        products: syncedList,
        message: `${syncedList.length} produk berhasil disinkronkan dari Digiflazz.`
      });
    }

    res.json({
      success: true,
      source: 'local_cached',
      count: cachedProducts.length,
      products: cachedProducts,
      message: 'Katalog lokal diperbarui.'
    });
  } catch (err: any) {
    res.json({
      success: true,
      source: 'local_cached_fallback',
      count: cachedProducts.length,
      products: cachedProducts,
      error: err.message
    });
  }
});

// Digiflazz Execute Digital Topup
app.post('/api/digiflazz/topup', requireModule('Accounts'), async (req: Request, res: Response) => {
  const { customer_no, buyer_sku_code, max_price } = req.body;

  if (!customer_no || !buyer_sku_code) {
    return res.status(400).json({ error: 'Nomor pelanggan/tujuan dan SKU produk wajib diisi.' });
  }

  const settings = readTable('store_settings');
  const config = settings.find(s => s.id === 'DIGIFLAZZ_CONFIG');
  const products = readTable('digiflazz_products');
  const product = products.find(p => p.buyer_sku_code === buyer_sku_code);

  const refId = `REF-DGF-${Date.now()}`;
  const username = config?.username;
  const apiKey = config?.apiKey;

  // Sandbox simulation if no credentials
  if (!username || !apiKey || !config.isProduction) {
    const snMock = `SN${Date.now()}${Math.floor(1000 + Math.random() * 9000)}`;
    const newTrx = insertItem('digiflazz_transactions', {
      id: `TRX-${Date.now().toString().slice(-6)}`,
      ref_id: refId,
      customer_no,
      buyer_sku_code,
      product_name: product?.product_name || buyer_sku_code,
      amount: product?.price || 10000,
      sellingPrice: product?.sellingPrice || 12000,
      status: 'Sukses',
      message: `Topup berhasil diproses [Sandbox Simulation]. SN: ${snMock}`,
      sn: snMock,
      timestamp: new Date().toISOString()
    });

    return res.json({
      success: true,
      mode: 'sandbox_simulation',
      transaction: newTrx
    });
  }

  try {
    const sign = crypto.createHash('md5').update(`${username}${apiKey}${refId}`).digest('hex');
    const response = await fetch('https://api.digiflazz.com/v1/transaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        buyer_sku_code,
        customer_no,
        ref_id: refId,
        sign,
        max_price: max_price || (product ? product.price * 1.05 : undefined)
      })
    });

    const result: any = await response.json();
    const data = result?.data || {};

    const newTrx = insertItem('digiflazz_transactions', {
      id: `TRX-${Date.now().toString().slice(-6)}`,
      ref_id: refId,
      customer_no,
      buyer_sku_code,
      product_name: product?.product_name || buyer_sku_code,
      amount: data.price || product?.price || 0,
      sellingPrice: product?.sellingPrice || 0,
      status: data.status === 'Sukses' ? 'Sukses' : (data.status === 'Gagal' ? 'Gagal' : 'Pending'),
      message: data.message || 'Transaksi terkirim',
      sn: data.sn || '',
      timestamp: new Date().toISOString()
    });

    res.json({
      success: data.status === 'Sukses' || data.status === 'Pending',
      mode: 'production',
      transaction: newTrx
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Digiflazz Webhook Receiver
app.post('/api/digiflazz/webhook', (req: Request, res: Response) => {
  const eventData = req.body?.data;
  if (!eventData || !eventData.ref_id) {
    return res.status(400).json({ error: 'Payload tidak valid' });
  }

  const transactions = readTable('digiflazz_transactions');
  const matched = transactions.find(t => t.ref_id === eventData.ref_id);

  if (matched) {
    updateItem('digiflazz_transactions', matched.id, {
      status: eventData.status,
      sn: eventData.sn || matched.sn,
      message: eventData.message || matched.message,
      updatedAt: new Date().toISOString()
    });
  }

  res.json({ success: true, message: 'Webhook Digiflazz diterima.' });
});

// Offline Sync Batch Handler
/*
 * Commit an approved Excel import.
 *
 * The client parses the workbook and shows a preview; this writes it. Every
 * created record carries an importKey naming the file and source row, so
 * running the same import twice updates rather than duplicates — the operator
 * will re-run it after fixing the spreadsheet.
 */
app.post('/api/import/commit', requireModule('Orders'), (req: Request, res: Response) => {
  const { monthLabel, orders = [], samples = [], applyBreakdown = true } = req.body || {};
  if (!Array.isArray(orders) || !Array.isArray(samples)) {
    return res.status(400).json({ error: 'Isi impor tidak dikenali.' });
  }

  const source = String(monthLabel || 'IMPOR').trim();
  const normalise = (value: unknown) => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const sourceSlug = normalise(source).slice(0, 8) || 'IMPOR';
  const freeId = (table: string, base: string) => {
    let id = base;
    let n = 2;
    while (findById(table, id)) id = `${base}-${n++}`;
    return id;
  };

  const customers = readTable('customers');
  const report = {
    customersCreated: [] as string[],
    ordersCreated: [] as string[],
    ordersUpdated: [] as string[],
    samplesCreated: [] as string[],
    breakdownApplied: 0,
    breakdownHeld: 0
  };

  /**
   * Reuse the customer whose name or company is the brand, or register a new
   * one. Exact after normalising: a substring match filed "ALI" under
   * "PT ALINA MANDIRI".
   */
  function resolveCustomer(brand: string): any {
    const key = normalise(brand);
    const existing = customers.find(c => normalise(c.company) === key || normalise(c.name) === key);
    if (existing) return existing;

    /*
     * Truncating the key made "…PO 059" and "…PO 061" collide into one id, so
     * the suffix grows until the id is free. Two near-identical customers can
     * be merged by hand; two records sharing an id cannot be told apart.
     */
    const base = `CUST-IMP-${normalise(brand).slice(0, 12) || Date.now().toString(36)}`;
    let candidate = base;
    let suffix = 2;
    while (customers.some(c => String(c.id).toUpperCase() === candidate.toUpperCase())) {
      candidate = `${base}-${suffix++}`;
    }

    const created = insertItem('customers', {
      id: candidate,
      name: brand,
      company: brand,
      status: 'Active',
      portalAccessActive: false,
      notes: `Dibuat otomatis dari impor ${source}.`,
      importSource: source,
      importKey: `${source}#customer#${key}`,
      user: 'Impor Excel'
    });
    /*
     * No manual push here: readTable hands back the live cached array, and
     * insertItem has already unshifted into it. Adding it again put the same
     * record in twice, id and all.
     */
    report.customersCreated.push(created.id);
    return created;
  }

  // --------------------------------------------------------------- orders
  for (const row of orders) {
    const brand = String(row.brand || '').trim();
    if (!brand) continue;

    const customer = resolveCustomer(brand);
    const importKey = `${source}#order#${row.sourceRow}`;
    const products = Array.isArray(row.products) ? row.products : [];
    const first = products[0] || {};

    /*
     * The queue quantity is authoritative — it is the figure the owner
     * sub-totals. A breakdown that does not add up to it is carried as a note
     * instead of as data, so nobody cuts against numbers nobody verified.
     */
    const reconciled = !row.detailWarning && products.length > 0;
    const sizeText = reconciled && applyBreakdown
      ? products
          .flatMap((p: any) => (p.sizes || []).map((sz: any) => `${sz.size}: ${sz.qty}`))
          .join(', ')
      : '';
    if (products.length > 0) {
      if (reconciled && applyBreakdown) report.breakdownApplied++;
      else report.breakdownHeld++;
    }

    const noteParts = [row.notes, row.pic ? `PIC: ${row.pic}` : '', row.detailWarning || '']
      .map((t: string) => String(t || '').trim())
      .filter(Boolean);

    const payload: Record<string, unknown> = {
      customerId: customer.id,
      customerName: customer.company || customer.name,
      productType: first.model || brand,
      quantity: Number(row.quantity) || 0,
      deadline: row.deadline || undefined,
      material: first.material || undefined,
      color: first.color || undefined,
      size: sizeText || undefined,
      notes: noteParts.join(' | ') || undefined,
      paymentLabel: row.payment || undefined,
      stageFlags: row.stages || undefined,
      importKey,
      importSource: source,
      importSheet: row.detailSheet || undefined,
      user: 'Impor Excel'
    };
    if (row.masuk) payload.timestamp = new Date(`${row.masuk}T00:00:00Z`).toISOString();

    const existing = readTable('orders').find((o: any) => o.importKey === importKey);
    if (existing) {
      /*
       * A re-run fills in what is still blank. Values already corrected in the
       * app — a deadline, a size breakdown, a note — are not put back to the
       * spreadsheet's version.
       */
      const fillOnly = Object.fromEntries(
        Object.entries(payload).filter(([field, value]) => {
          if (value === undefined) return false;
          const current = existing[field];
          return current === undefined || current === null || current === '' || current === 0;
        })
      );
      updateItem('orders', existing.id, fillOnly);
      report.ordersUpdated.push(existing.id);
    } else {
      // Row 12 of next month's file is not row 12 of this one: the id carries
      // the source, and is bumped if a hand-typed record already took it.
      const created = insertItem('orders', {
        id: freeId('orders', `ORD-IMP-${sourceSlug}-${String(row.sourceRow).padStart(3, '0')}`),
        po: `PO-${normalise(brand).slice(0, 6)}-${String(row.sourceRow).padStart(3, '0')}`,
        status: 'Order',
        ...payload
      });
      report.ordersCreated.push(created.id);
    }
  }

  // -------------------------------------------------------------- samples
  for (const row of samples) {
    const brand = String(row.brand || '').trim();
    if (!brand) continue;

    const customer = resolveCustomer(brand);
    const importKey = `${source}#sample#${row.sourceRow}`;
    const existing = readTable('samples').find((x: any) => x.importKey === importKey);
    const payload = {
      customerId: customer.id,
      customerName: customer.company || customer.name,
      productName: row.model ? `${row.model} ${brand}` : `Sampel ${brand}`,
      quantity: Number(row.quantity) || 1,
      status: 'In Progress',
      notes: row.notes || undefined,
      importKey,
      importSource: source,
      user: 'Impor Excel'
    };

    if (existing) {
      updateItem('samples', existing.id, payload);
    } else {
      const created = insertItem('samples', {
        id: freeId('samples', `SMP-IMP-${sourceSlug}-${String(row.sourceRow).padStart(3, '0')}`),
        ...payload
      });
      report.samplesCreated.push(created.id);
    }
  }

  res.json({
    success: true,
    source,
    ...report,
    message:
      `${report.ordersCreated.length} pesanan baru, ${report.ordersUpdated.length} diperbarui, ` +
      `${report.samplesCreated.length} sampel, ${report.customersCreated.length} pelanggan baru.`
  });
});

const OFFLINE_BLOCKED_TABLES = new Set([
  'orders', 'quotations', 'customers', 'invoices', 'payments', 'customer_credits', 'shipments',
  'spk_produksi', 'users', 'qc_reports', 'designs', 'samples', 'size_charts'
]);

app.post('/api/sync', requireStaff, (req: Request, res: Response) => {
  const { table, action, payload } = req.body;
  if (!table || !action || !payload) {
    return res.status(400).json({ error: 'Data sinkronisasi tidak valid.' });
  }

  const syncTable = TABLE_MAP[String(table).toLowerCase()] || String(table).toLowerCase();
  if (!KNOWN_TABLES.has(syncTable)) return res.status(404).json({ error: `Tabel "${table}" tidak dikenal.` });
  /*
   * These tables have gates and side effects on their live routes (QC before a
   * surat jalan, one invoice per order, derived statuses). A replay that skips
   * them would let an offline click land where a live one is refused.
   */
  if (OFFLINE_BLOCKED_TABLES.has(syncTable)) {
    return res.status(409).json({ error: `Data ${syncTable} tidak bisa disimpan dari antrean offline. Ulangi saat terhubung.` });
  }
  const syncBlocked = writeBlockReason(actorUser(req), syncTable) || gateFieldBlockReason(actorUser(req), payload);
  if (syncBlocked) return res.status(403).json({ error: syncBlocked });
  if (action === 'CREATE' && syncTable === 'spk_produksi') {
    const reason = spkBlockReason(payload.orderId);
    if (reason) return res.status(409).json({ error: reason });
  }

  try {
    // Replayed offline writes follow the same rules as live ones.
    if (action === 'CREATE') {
      if (payload.id && findById(syncTable, payload.id)) {
        return res.status(409).json({ error: `Nomor ${payload.id} sudah dipakai.` });
      }
      advanceOrderAfterWrite(syncTable, insertItem(syncTable, payload));
    } else if (action === 'UPDATE') {
      advanceOrderAfterWrite(syncTable, updateItem(syncTable, payload.id, payload));
    } else if (action === 'DELETE') {
      const blocked = deleteBlockReason(syncTable, payload.id);
      if (blocked) return res.status(409).json({ error: blocked });
      if (deleteItem(syncTable, payload.id)) cleanUpAfterDelete(syncTable, payload.id);
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/*
 * A quotation or order carries the agreed instalments only. They are checked
 * here (whole percentages adding up to 100) and stripped of billing state, so
 * a repeat order copying an old order's schedule starts unbilled.
 */
function scheduleWriteError(tableName: string, body: any): string | null {
  if (!['quotations', 'orders'].includes(tableName) || !body || body.paymentSchedule === undefined) return null;
  const problem = scheduleError(body.paymentSchedule);
  if (problem) return problem;
  if (Array.isArray(body.paymentSchedule)) body.paymentSchedule = planTerms(body.paymentSchedule);
  return null;
}

/*
 * A new model needs its own design. The same design may only be shared by a
 * repeat order of the same model; otherwise a revision for one order would
 * silently change the SPK of another.
 */
function ordersUsingDesign(designId: string | undefined, exceptOrderId?: string): any[] {
  if (!designId) return [];
  const design = findById('designs', designId);
  return readTable('orders').filter(
    (o: any) =>
      o.id !== exceptOrderId &&
      o.status !== 'Cancelled' &&
      (o.designId === designId || (design?.orderId && design.orderId === o.id))
  );
}

function designReuseError(designId: string | undefined, options: { isRepeatOrder?: boolean; exceptOrderId?: string }): string | null {
  if (!designId || options.isRepeatOrder) return null;
  const used = ordersUsingDesign(designId, options.exceptOrderId);
  if (used.length === 0) return null;
  return (
    `Desain ${designId} sudah dipakai pesanan ${used.map((o: any) => o.id).join(', ')}. ` +
    'Model baru perlu desain baru: buat desainnya di Desain & Sampel lalu ACC. Desain yang sama hanya untuk Repeat Order.'
  );
}

/** Rules a quotation write must meet beyond its schedule: sample fee, and a design of its own. */
function quotationWriteError(body: any, existing?: any): string | null {
  if (!body || typeof body !== 'object') return null;
  if (body.sampleFee !== undefined && body.sampleFee !== '' && !(Number(body.sampleFee) >= 0)) {
    return 'Biaya sampel tidak valid.';
  }
  const designId = body.designId !== undefined ? body.designId : existing?.designId;
  const designChanged = body.designId !== undefined && body.designId !== existing?.designId;
  if (!existing || designChanged) {
    return designReuseError(designId, {
      isRepeatOrder: body.isRepeatOrder ?? existing?.isRepeatOrder,
      exceptOrderId: existing?.orderId
    });
  }
  return null;
}

const scheduleKey = (terms: any) =>
  JSON.stringify(planTerms(terms).map(t => [t.id, t.label, t.percentage, t.trigger]));

/*
 * An order edited before production (Ubah Pesanan on a repeat order) can change
 * its price or instalments. Its invoice is then revised, never overwritten, so
 * the figures the customer was billed on stay readable.
 */
function reviseInvoiceAfterOrderEdit(before: any, after: any, revisedBy: string) {
  if (!before || !after) return;
  const priceChanged = Number(before.totalPrice) !== Number(after.totalPrice);
  const termsChanged = scheduleKey(before.paymentSchedule) !== scheduleKey(after.paymentSchedule);
  if (!priceChanged && !termsChanged) return;
  const active = activeInvoiceForOrder(after.id);
  if (!active) return;
  reviseInvoice(active, {
    total: Number(after.totalPrice) || 0,
    schedule: Array.isArray(after.paymentSchedule) && after.paymentSchedule.length > 0 ? after.paymentSchedule : undefined,
    revisedBy,
    notes: `Direvisi dari Ubah Pesanan ${after.id}.`
  });
}

// ---------------------------------------------------------
// GENERIC CRUD REST API FOR ALL 20 SOPS
// ---------------------------------------------------------
const TABLE_MAP: Record<string, string> = {
  customers: 'customers',
  orders: 'orders',
  quotations: 'quotations',
  designs: 'designs',
  samples: 'samples',
  spk: 'spk_produksi',
  spk_produksi: 'spk_produksi',
  procurements: 'procurements',
  'raw-materials': 'inventory_bahan',
  inventory: 'inventory_bahan',
  inventory_bahan: 'inventory_bahan',
  'stock-opname': 'stock_opname',
  stock_opname: 'stock_opname',
  inventory_produk_jadi: 'inventory_produk_jadi',
  'pattern-gradings': 'pattern_gradings',
  'size-charts': 'size_charts',
  'work-assignments': 'work_assignments',
  work_assignments: 'work_assignments',
  size_charts: 'size_charts',
  patterns: 'patterns',
  'cutting-batches': 'cutting_batches',
  'wip-bundles': 'wip_bundles',
  'sewing-logs': 'sewing_logs',
  trims: 'trims_checks',
  'qc-reports': 'qc_reports',
  'packaging-slips': 'packaging_slips',
  'finished-goods': 'inventory_produk_jadi',
  returns: 'returns_complaints',
  returns_complaints: 'returns_complaints',
  shipments: 'shipments',
  machines: 'machines',
  safety: 'safety_reports',
  operators: 'operators',
  payroll: 'borongan_salary_slips',
  invoices: 'invoices',
  payments: 'payments',
  'customer-credits': 'customer_credits',
  customer_credits: 'customer_credits',
  'daily-cash': 'daily_cash_entries',
  daily_cash_entries: 'daily_cash_entries',
  'stock-receipts': 'stock_receipts',
  stock_receipts: 'stock_receipts',
  users: 'users',
  'store-products': 'store_products',
  store_products: 'store_products',
  'store-flash-sales': 'store_flashsales',
  store_flashsales: 'store_flashsales',
  'store-discounts': 'store_discounts',
  store_discounts: 'store_discounts',
  'store-referrals': 'store_referrals',
  store_referrals: 'store_referrals',
  'store-orders': 'store_orders',
  store_orders: 'store_orders',
  'store-settings': 'store_settings',
  store_settings: 'store_settings',
  'digiflazz-products': 'digiflazz_products',
  digiflazz_products: 'digiflazz_products',
  'digiflazz-transactions': 'digiflazz_transactions',
  digiflazz_transactions: 'digiflazz_transactions'
};

/*
 * The generic CRUD routes cover every table, so opening them to customers would
 * hand the client portal the whole factory. Instead a customer may touch only
 * the three things the portal actually does, only on their own records, and
 * only through the fields listed here — anything else in the body is dropped
 * rather than rejected, so a stray field never becomes a silent write.
 */
interface CustomerWriteRule {
  methods: Array<'POST' | 'PUT'>;
  allow: string[];
  /** Move a client-supplied value onto a non-authoritative field. */
  rename?: Record<string, string>;
  /** Values the server decides, whatever the client sent. */
  force?: Record<string, unknown>;
  /** Restrict a field to a known set of values. */
  enums?: Record<string, string[]>;
}

const CUSTOMER_WRITE_RULES: Record<string, CustomerWriteRule> = {
  samples: {
    methods: ['PUT'],
    allow: ['status', 'notes', 'feedback', 'approvedAt'],
    enums: { status: ['Approved', 'Revision', 'Rejected'] }
  },
  returns_complaints: {
    methods: ['POST'],
    // The names the Retur screen reads; the old list ('category', 'photoUrl')
    // matched nothing the portal sent, so every complaint arrived empty.
    allow: ['orderId', 'defectCategory', 'defectQty', 'description', 'customerEvidenceUrls', 'complaintDate'],
    force: { status: 'Submitted', actionTaken: 'Perbaikan Gratis' }
  },
  /*
   * The portal's one step in the flow: ACC the mockup. Money never enters
   * through the portal — the customer sends transfer proof over WhatsApp and
   * the order's PIC records and verifies it in Keuangan, so there is no
   * payments or invoices rule here and a customer POST/PUT to either is 403.
   */
  designs: {
    methods: ['PUT'],
    allow: ['status', 'approvedBy', 'approvedAt', 'feedback', 'notes'],
    enums: { status: ['Approved', 'Revision Requested'] }
  }
};

/*
 * Accounts are also created and edited through the generic routes, so a
 * password arriving there has to be hashed on the way in — otherwise every new
 * account reintroduces the plaintext problem the login path just fixed.
 */
const ACCOUNT_TABLES = new Set(['users', 'customers']);

function hashIncomingPassword(table: string, body: any) {
  if (!ACCOUNT_TABLES.has(table) || !body || typeof body !== 'object') return body;
  const plain = body.password;
  if (typeof plain !== 'string' || plain.length === 0) return body;
  if (plain.startsWith('scrypt$')) return body;
  return { ...body, password: hashPassword(plain) };
}

const sameCustomer = (a: unknown, b: unknown) =>
  !!a && String(a).toLowerCase() === String(b).toLowerCase();

/** A design often carries no customerId of its own; the order it belongs to does. */
const ownsRecord = (record: any, customerId: string) => {
  if (sameCustomer(record?.customerId, customerId)) return true;
  if (record?.orderId) return sameCustomer(findById('orders', record.orderId)?.customerId, customerId);
  return false;
};

/** Returns the sanitised body, or an error string explaining the refusal. */
function customerWriteBody(
  table: string,
  method: 'POST' | 'PUT',
  body: any,
  customerId: string
): { body: Record<string, unknown> } | { error: string } {
  const rule = CUSTOMER_WRITE_RULES[table];
  if (!rule || !rule.methods.includes(method)) {
    return { error: 'Akun pelanggan tidak boleh mengubah data ini.' };
  }

  const clean: Record<string, unknown> = {};
  for (const field of rule.allow) {
    if (body?.[field] !== undefined) clean[field] = body[field];
  }
  for (const [from, to] of Object.entries(rule.rename || {})) {
    if (body?.[from] !== undefined) clean[to] = body[from];
  }
  for (const [field, values] of Object.entries(rule.enums || {})) {
    if (clean[field] !== undefined && !values.includes(String(clean[field]))) {
      return { error: `Nilai ${field} tidak diizinkan.` };
    }
  }
  Object.assign(clean, rule.force || {});

  // A complaint is always filed against the account that is signed in.
  if (method === 'POST') clean.customerId = customerId;

  return { body: clean };
}

/*
 * Stage records written through the generic routes (QC reports, SPK progress,
 * payments entered by hand) move the order along the same way the dedicated
 * routes do.
 */
function advanceOrderAfterWrite(tableName: string, item: any): any | null {
  if (!item) return null;
  let fresh: any = null;
  if (tableName === 'spk_produksi') {
    fresh = recomputeSpk(item.id);
  } else if (SPK_SOURCE_TABLES.includes(tableName)) {
    const spk = recomputeSpk(item.spkId);
    if (spk) syncOrderStatus(spk.orderId);
  }
  if (tableName === 'payments') {
    const invoice = item.invoiceId ? activeInvoiceFor(item.invoiceId) : activeInvoiceForOrder(item.orderId);
    if (invoice) reconcileInvoice(invoice.id);
    reconcileOrderPayments(item.orderId);
    return null;
  }
  if (tableName === 'invoices') {
    const reconciled = reconcileInvoice(item.id);
    if (item.orderId) syncOrderStatus(item.orderId);
    return reconciled;
  }
  if (item.orderId && ['spk_produksi', 'qc_reports', 'shipments', 'invoices'].includes(tableName)) {
    syncOrderStatus(item.orderId);
  }
  // An approved sample is noted on its order and moves a "Sample" order on.
  if (tableName === 'samples' && item.orderId) {
    const order = findById('orders', item.orderId);
    if (order && item.status === 'Approved' && order.sampleStatus !== 'Approved') {
      updateItem('orders', order.id, { sampleStatus: 'Approved' });
    }
    if (order && sampleSettled(findById('orders', order.id))) syncOrderStatus(order.id);
    // A sample sent to the customer makes a "Sampel dikirim" instalment due.
    syncTermsForOrder(item.orderId);
  }
  // An order re-pointed at another template hands its SPK the new chart.
  if (tableName === 'orders' && item.sizeChartId) {
    const spk = readTable('spk_produksi').find((s: any) => s.orderId === item.id);
    if (spk && spk.sizeChartId !== item.sizeChartId) {
      updateItem('spk_produksi', spk.id, sizeChartSnapshot(item.sizeChartId));
    }
  }
  return fresh;
}

/**
 * Why a record may not be deleted, or null. An order that already has an SPK,
 * money or a shipment behind it is history: removing it left invoices and
 * payments pointing at nothing, and the next order could inherit its id.
 */
function deleteBlockReason(tableName: string, id: string): string | null {
  if (tableName === 'spk_produksi') {
    const spk = findById('spk_produksi', id);
    if (spk) {
      if (spk.status === 'QC Passed' || spk.status === 'Completed' || spkQcAccepted(spk.id)) {
        return `SPK ${id} sudah lolos QC, jadi tidak bisa dihapus.`;
      }
      if (readTable('shipments').some((s: any) => s.orderId === spk.orderId)) {
        return `SPK ${id} sudah punya surat jalan, jadi tidak bisa dihapus.`;
      }
      const wages = readTable('work_assignments').filter((w: any) => w.spkId === id).length;
      if (wages > 0) {
        return `SPK ${id} punya ${wages} catatan kerja (upah petugas). Hapus catatannya di Surat Perintah Kerja dulu bila memang salah.`;
      }
    }
  }
  if (tableName === 'orders') {
    const spk = readTable('spk_produksi').find((s: any) => s.orderId === id);
    if (spk) {
      return `Pesanan ${id} sudah punya SPK ${spk.id}. Kalau pesanan ini memang batal, pakai "Batalkan Pesanan" di detail pesanan.`;
    }
    const payments = readTable('payments').filter((p: any) => p.orderId === id && p.status !== 'Rejected');
    if (payments.length > 0) {
      return `Pesanan ${id} sudah punya ${payments.length} pembayaran di Keuangan, jadi tidak bisa dihapus.`;
    }
    const shipment = readTable('shipments').find((s: any) => s.orderId === id);
    if (shipment) return `Pesanan ${id} sudah punya surat jalan ${shipment.id}, jadi tidak bisa dihapus.`;
  }
  if (tableName === 'shipments') {
    const shipment = findById('shipments', id);
    if (shipment?.status === 'Delivered') return `Surat jalan ${id} sudah diterima pelanggan; riwayatnya disimpan.`;
  }
  if (tableName === 'invoices') {
    const paid = readTable('payments').filter((p: any) => p.invoiceId === id && p.status !== 'Rejected').length;
    if (paid > 0) return `Faktur ${id} sudah punya ${paid} pembayaran, jadi tidak bisa dihapus. Revisi lewat Surat Penawaran.`;
  }
  if (tableName === 'qc_reports') {
    const report = findById('qc_reports', id);
    if (report?.orderId && readTable('shipments').some((s: any) => s.orderId === report.orderId)) {
      return `Laporan QC ${id} sudah dipakai surat jalan pesanan ${report.orderId}, jadi disimpan.`;
    }
  }
  if (tableName === 'size_charts') {
    const users = readTable('orders').filter((o: any) => o.sizeChartId === id && !readTable('spk_produksi').some((s: any) => s.orderId === o.id));
    if (users.length > 0) return `Template ini dipakai ${users.length} pesanan yang belum ber-SPK (mis. ${users[0].id}). Arahkan pesanannya ke template lain dulu.`;
  }
  if (tableName === 'customers') {
    const orders = readTable('orders').filter((o: any) => o.customerId === id);
    const quotations = readTable('quotations').filter((q: any) => q.customerId === id);
    if (orders.length > 0 || quotations.length > 0) {
      return `Pelanggan ${id} masih punya ${orders.length} pesanan dan ${quotations.length} penawaran. Nonaktifkan akunnya saja.`;
    }
  }
  if (tableName === 'quotations') {
    const quotation = findById('quotations', id);
    if (quotation?.supersededBy) {
      return `Penawaran ${id} adalah riwayat revisi yang sudah diganti ${quotation.supersededBy}, jadi disimpan.`;
    }
    if (quotation?.orderId && findById('orders', quotation.orderId)) {
      return `Penawaran ${id} sudah deal menjadi pesanan ${quotation.orderId}. Hapus pesanannya dulu kalau deal ini batal.`;
    }
  }
  return null;
}

/** What goes with a deleted record, so nothing is left pointing at it. */
function cleanUpAfterDelete(tableName: string, id: string) {
  if (tableName === 'spk_produksi') {
    for (const table of SPK_SOURCE_TABLES) {
      for (const row of readTable(table).filter((r: any) => r.spkId === id)) deleteItem(table, row.id);
    }
    return;
  }
  if (tableName !== 'orders') return;
  // Only unpaid invoices reach here (deleteBlockReason refuses paid orders).
  for (const invoice of readTable('invoices').filter((i: any) => i.orderId === id)) {
    deleteItem('invoices', invoice.id);
  }
  // The deal goes back to waiting instead of pointing at an order that is gone.
  for (const quotation of readTable('quotations').filter((q: any) => q.orderId === id)) {
    updateItem('quotations', quotation.id, { orderId: '', status: 'Sent' });
  }
  /*
   * Designs, samples and purchases stay (they are real work) but let go of the
   * order, so an order later given the same number never inherits them.
   */
  for (const table of ['designs', 'samples', 'procurements']) {
    for (const row of readTable(table).filter((r: any) => r.orderId === id)) {
      updateItem(table, row.id, { orderId: '' });
    }
  }
}

/*
 * Only known tables. Any name used to create a fresh JSON file in the data
 * folder; a typo in a client call quietly became a new table.
 */
const KNOWN_TABLES = new Set(Object.values(TABLE_MAP));
function resolveTable(req: Request, res: Response): string | null {
  const key = String(req.params.resource || '').toLowerCase();
  const tableName = TABLE_MAP[key] || key;
  if (!KNOWN_TABLES.has(tableName)) {
    res.status(404).json({ error: `Tabel "${key}" tidak dikenal.` });
    return null;
  }
  return tableName;
}

/** The staff record behind the request; the token alone is not trusted for permissions. */
const actorUser = (req: Request) => (req.actor?.type === 'internal' ? findById('users', req.actor.sub) : null);

/**
 * Fields that unlock the SPK gates. They are set through the checklist by
 * people whose role allows it; carried in an ordinary edit they would let a
 * production account wave its own DP through.
 */
const GATE_FIELDS: Record<string, string[]> = {
  specialTermsApprovedBy: [], // role-checked below
  specialTermsApprovedAt: [],
  sampleWaivedBy: ['PPIC'],
  sampleWaivedAt: ['PPIC'],
  sampleWaivedReferenceOrderId: ['PPIC', 'Orders'],
  materialConfirmedBy: ['PPIC'],
  materialConfirmedAt: ['PPIC']
};
function gateFieldBlockReason(user: any, body: any): string | null {
  if (!body || typeof body !== 'object') return null;
  if (user?.role === 'Super Admin') return null;
  for (const [field, modules] of Object.entries(GATE_FIELDS)) {
    if (body[field] === undefined) continue;
    if (field.startsWith('specialTerms')) {
      if (!canApproveSpecialTerms(user?.role)) return 'Termin khusus hanya bisa disetujui Owner atau Super Admin.';
      continue;
    }
    if (!modules.some(m => canOpen(user, m))) {
      return 'Syarat SPK hanya bisa diubah dari menu Surat Perintah Kerja oleh PPIC.';
    }
  }
  return null;
}

app.get('/api/:resource', requireStaff, (req: Request, res: Response) => {
  const tableName = resolveTable(req, res);
  if (!tableName) return;
  const blocked = readBlockReason(actorUser(req), tableName);
  if (blocked) return res.status(403).json({ error: blocked });
  const data = readTable(tableName);
  res.json(stripSensitive(data));
});

app.get('/api/:resource/:id', requireStaff, (req: Request, res: Response) => {
  const tableName = resolveTable(req, res);
  if (!tableName) return;
  const blocked = readBlockReason(actorUser(req), tableName);
  if (blocked) return res.status(403).json({ error: blocked });
  const item = findById(tableName, req.params.id);
  if (!item) return res.status(404).json({ error: 'Data tidak ditemukan.' });
  res.json(stripSensitive(item));
});

app.post('/api/:resource', requireAuth, (req: Request, res: Response) => {
  const tableName = resolveTable(req, res);
  if (!tableName) return;

  if (req.actor!.type === 'customer') {
    const result = customerWriteBody(tableName, 'POST', req.body, req.actor!.sub);
    if ('error' in result) return res.status(403).json({ error: result.error });
    const body: Record<string, unknown> = result.body;

    if (tableName === 'returns_complaints') {
      const order = body.orderId ? findById('orders', String(body.orderId)) : null;
      if (!order || !sameCustomer(order.customerId, req.actor!.sub)) {
        return res.status(403).json({ error: 'Pesanan ini bukan milik akun Anda.' });
      }
      if (!String(body.description || '').trim()) {
        return res.status(400).json({ error: 'Tuliskan rincian masalahnya.' });
      }
      const customer = findById('customers', req.actor!.sub);
      body.id = nextId('returns_complaints', 'RMA');
      body.customerName = customer?.name || order.customerName;
      body.contactPhone = customer?.contact || customer?.phone || '-';
      body.complaintDate = body.complaintDate || new Date().toISOString().split('T')[0];
      body.defectQty = Number(body.defectQty) || 0;
    }

    if (tableName === 'payments') {
      if (!(Number(body.amount) > 0)) {
        return res.status(400).json({ error: 'Isi nominal yang Anda transfer.' });
      }
      // Proof may only be filed against the customer's own order and invoice.
      const order = body.orderId ? findById('orders', String(body.orderId)) : null;
      if (!order || !sameCustomer(order.customerId, req.actor!.sub)) {
        return res.status(403).json({ error: 'Pesanan ini bukan milik akun Anda.' });
      }
      const invoice = body.invoiceId ? activeInvoiceFor(String(body.invoiceId)) : activeInvoiceForOrder(order.id);
      body.invoiceId = invoice && invoice.orderId === order.id ? invoice.id : '';
      body.customerName = order.customerName;
      body.id = nextId('payments', 'PAY');
    }

    return res.status(201).json(stripSensitive(insertItem(tableName, body)));
  }

  const staff = actorUser(req);
  const writeBlocked = writeBlockReason(staff, tableName) || gateFieldBlockReason(staff, req.body);
  if (writeBlocked) return res.status(403).json({ error: writeBlocked });

  req.body = hashIncomingPassword(tableName, req.body);

  // Re-using an id overwrote nothing but made every later lookup hit the wrong row.
  if (req.body?.id && findById(tableName, req.body.id)) {
    return res.status(409).json({ error: `Nomor ${req.body.id} sudah dipakai. Muat ulang halaman lalu simpan lagi.` });
  }

  if (tableName === 'spk_produksi') {
    const reason = spkBlockReason(req.body?.orderId);
    if (reason) return res.status(409).json({ error: reason });
    // Whatever the client typed, an SPK starts in the queue with the order's template.
    const order = findById('orders', req.body.orderId);
    req.body = {
      ...req.body,
      status: 'Queued', progress: 0, cutting: 0, sewing: 0, finishing: 0, qc: 0,
      ...sizeChartSnapshot(order?.sizeChartId)
    };
  }
  if (tableName === 'qc_reports') {
    const spk = req.body?.spkId ? findById('spk_produksi', req.body.spkId) : null;
    if (!spk) return res.status(409).json({ error: 'Laporan QC harus terhubung ke SPK yang ada.' });
    if (spk.status === 'Queued') {
      return res.status(409).json({ error: `SPK ${spk.id} belum punya catatan produksi; catat potong/jahit/finishing dulu sebelum QC.` });
    }
  }
  const postScheduleProblem =
    scheduleWriteError(tableName, req.body) ||
    (tableName === 'quotations' ? quotationWriteError(req.body) : null) ||
    (tableName === 'orders' ? designReuseError(req.body?.designId, { isRepeatOrder: req.body?.isRepeatOrder }) : null);
  if (postScheduleProblem) return res.status(400).json({ error: postScheduleProblem });
  if (tableName === 'orders') {
    const clash = poTakenBy(req.body?.po);
    if (clash) return res.status(409).json({ error: `Nomor PO ${req.body.po} sudah dipakai pesanan ${clash.id}. Pakai nomor lain.` });
  }
  if (tableName === 'payments') {
    const payOrder = req.body?.orderId ? findById('orders', req.body.orderId) : null;
    if (payOrder?.status === 'Cancelled') {
      return res.status(409).json({ error: `Pesanan ${payOrder.id} sudah dibatalkan; pembayaran tidak dicatat.` });
    }
  }

  // Strict validation for Customer portal security
  if (tableName === 'customers' && req.body?.username) {
    const uname = String(req.body.username).trim().toLowerCase();
    const disallowed = [
      'admin', 'superadmin', 'owner', 'klien', 'customer', 'pelanggan',
      'root', 'user', 'guest', 'test', 'staff', 'superuser',
      'operator', 'ppic', 'qc', 'design', 'desain', 'finance', 'pengadaan', 'produksi'
    ];
    if (uname.length < 5) {
      return res.status(400).json({ error: 'Username portal minimal 5 karakter agar aman dari pencurian/bruteforce.' });
    }
    if (!/^[a-z0-9._-]+$/.test(uname)) {
      return res.status(400).json({ error: 'Username hanya boleh mengandung huruf kecil, angka, titik (.), dan strip (-).' });
    }
    if (disallowed.includes(uname)) {
      return res.status(400).json({ error: `Username "${uname}" dilarang karena terlalu generik dan rentan hack. Gunakan pola aman seperti brand.4digitWA.` });
    }
    const existing = readTable('customers').find((c: any) => c.id !== req.body.id && String(c.username || '').toLowerCase() === uname);
    if (existing) {
      return res.status(400).json({ error: `Username "${uname}" sudah dipakai pelanggan lain. Pilih username unik.` });
    }
    const staffExisting = readTable('users').find((u: any) => String(u.username || '').toLowerCase() === uname);
    if (staffExisting) {
      return res.status(400).json({ error: `Username "${uname}" bertabrakan dengan akun staf internal.` });
    }
  }

  const item = insertItem(tableName, req.body);
  // An order typed straight into Pesanan Masuk is billed the same way as a closed quotation.
  if (tableName === 'orders') {
    createInvoiceForOrder(item, {
      reviewStatus: 'Draft',
      notes: `Faktur ${item.isRepeatOrder ? 'repeat order' : 'pesanan'} ${item.po || item.id}. Termin ditagih sesuai tahap pesanan.`,
      user: staff?.name
    });
  }
  const fresh = advanceOrderAfterWrite(tableName, item) || item;
  res.status(201).json(fresh);
});

app.put('/api/:resource/:id', requireAuth, (req: Request, res: Response) => {
  const tableName = resolveTable(req, res);
  if (!tableName) return;

  if (req.actor!.type === 'customer') {
    const existing = findById(tableName, req.params.id);
    if (!existing) return res.status(404).json({ error: 'Data tidak ditemukan.' });
    if (!ownsRecord(existing, req.actor!.sub)) {
      return res.status(403).json({ error: 'Data ini bukan milik akun Anda.' });
    }
    const result = customerWriteBody(tableName, 'PUT', req.body, req.actor!.sub);
    if ('error' in result) return res.status(403).json({ error: result.error });
    if (tableName === 'designs' && result.body.status !== undefined) {
      if (!['Pending Review', 'Revision Requested', 'Approved'].includes(String(existing.status))) {
        return res.status(409).json({ error: 'Desain ini belum dikirim untuk ditinjau.' });
      }
      const linkedOrders = readTable('orders').filter((o: any) => o.designId === existing.id || o.id === existing.orderId);
      const inProduction = linkedOrders.find((o: any) => readTable('spk_produksi').some((s: any) => s.orderId === o.id));
      if (result.body.status === 'Revision Requested' && inProduction) {
        return res.status(409).json({ error: `Desain ini sudah masuk produksi (pesanan ${inProduction.id}). Hubungi Admin HIJ lewat WhatsApp untuk perubahan.` });
      }
    }
    const updated = updateItem(tableName, req.params.id, result.body);
    if (!updated) return res.status(404).json({ error: 'Data tidak ditemukan.' });
    return res.json(stripSensitive(updated));
  }

  const staff = actorUser(req);
  const writeBlocked = writeBlockReason(staff, tableName) || gateFieldBlockReason(staff, req.body);
  if (writeBlocked) return res.status(403).json({ error: writeBlocked });
  if (tableName === 'users') {
    const usersBlocked = usersWriteBlockReason(req.actor!.sub, 'PUT', req.params.id, req.body, readTable('users'));
    if (usersBlocked) return res.status(403).json({ error: usersBlocked });
  }
  // The SPK's figures are owned by the recompute below; a stale status or
  // progress sent along with an edit must not win over the records.
  if (tableName === 'spk_produksi' && req.body && typeof req.body === 'object') {
    const { status: _status, progress: _progress, cutting, sewing, finishing, qc, ...rest } = req.body;
    req.body = {
      ...rest,
      ...(cutting !== undefined ? { manualCutting: Number(cutting) || 0 } : {}),
      ...(sewing !== undefined ? { manualSewing: Number(sewing) || 0 } : {}),
      ...(finishing !== undefined ? { manualFinishing: Number(finishing) || 0 } : {}),
      ...(qc !== undefined ? { manualQc: Number(qc) || 0 } : {})
    };
  }
  const orderBefore = tableName === 'orders' ? findById('orders', req.params.id) : null;
  const putScheduleProblem =
    scheduleWriteError(tableName, req.body) ||
    (tableName === 'quotations' ? quotationWriteError(req.body, findById('quotations', req.params.id)) : null) ||
    (tableName === 'orders' && req.body?.designId !== undefined && req.body.designId !== orderBefore?.designId
      ? designReuseError(req.body.designId, { isRepeatOrder: orderBefore?.isRepeatOrder, exceptOrderId: req.params.id })
      : null);
  if (putScheduleProblem) return res.status(400).json({ error: putScheduleProblem });

  req.body = hashIncomingPassword(tableName, req.body);

  /*
   * An order's status is derived from its records; the one thing a person may
   * set is "Cancelled", and only before production has started. A queued SPK
   * goes with the cancellation so PPIC's list does not keep it.
   */
  let cancelOrderId: string | null = null;
  if (tableName === 'orders' && req.body && typeof req.body === 'object') {
    const existing = findById('orders', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Data tidak ditemukan.' });
    const clash = poTakenBy(req.body.po, existing.id);
    if (clash) return res.status(409).json({ error: `Nomor PO ${req.body.po} sudah dipakai pesanan ${clash.id}. Pakai nomor lain.` });
    if (req.body.status === 'Cancelled' && existing.status !== 'Cancelled') {
      if (existing.status === 'Completed' || existing.status === 'Shipping') {
        return res.status(409).json({ error: `Pesanan ${existing.id} sudah ${existing.status === 'Completed' ? 'selesai' : 'dikirim'}; tidak bisa dibatalkan.` });
      }
      const started = productionStartedReason(existing.id);
      if (started) return res.status(409).json({ error: `Pesanan ${existing.id} tidak bisa dibatalkan: produksi sudah berjalan (${started})` });
      cancelOrderId = existing.id;
    } else if (req.body.status !== undefined && req.body.status !== existing.status) {
      const { status: _status, ...rest } = req.body;
      req.body = rest;
    }
    if (req.body.quantity !== undefined && Number(req.body.quantity) !== Number(existing.quantity)) {
      const started = productionStartedReason(existing.id);
      if (started) return res.status(409).json({ error: `Kuantitas pesanan ${existing.id} tidak bisa diubah: produksi sudah berjalan (${started})` });
    }
  }

  // Strict validation for Customer portal security on update
  if (tableName === 'customers' && req.body?.username) {
    const uname = String(req.body.username).trim().toLowerCase();
    const disallowed = [
      'admin', 'superadmin', 'owner', 'klien', 'customer', 'pelanggan',
      'root', 'user', 'guest', 'test', 'staff', 'superuser',
      'operator', 'ppic', 'qc', 'design', 'desain', 'finance', 'pengadaan', 'produksi'
    ];
    if (uname.length < 5) {
      return res.status(400).json({ error: 'Username portal minimal 5 karakter agar aman dari pencurian/bruteforce.' });
    }
    if (!/^[a-z0-9._-]+$/.test(uname)) {
      return res.status(400).json({ error: 'Username hanya boleh mengandung huruf kecil, angka, titik (.), dan strip (-).' });
    }
    if (disallowed.includes(uname)) {
      return res.status(400).json({ error: `Username "${uname}" dilarang karena terlalu generik dan rentan hack.` });
    }
    const existing = readTable('customers').find((c: any) => c.id !== req.params.id && String(c.username || '').toLowerCase() === uname);
    if (existing) {
      return res.status(400).json({ error: `Username "${uname}" sudah dipakai pelanggan lain. Pilih username unik.` });
    }
    const staffExisting = readTable('users').find((u: any) => String(u.username || '').toLowerCase() === uname);
    if (staffExisting) {
      return res.status(400).json({ error: `Username "${uname}" bertabrakan dengan akun staf internal.` });
    }
  }

  const item = updateItem(tableName, req.params.id, req.body);
  if (!item) return res.status(404).json({ error: 'Data tidak ditemukan.' });
  if (tableName === 'orders') reviseInvoiceAfterOrderEdit(orderBefore, item, staff?.name || 'Staf');
  if (cancelOrderId) {
    for (const spk of readTable('spk_produksi').filter((s: any) => s.orderId === cancelOrderId)) {
      deleteItem('spk_produksi', spk.id);
      cleanUpAfterDelete('spk_produksi', spk.id);
    }
    /*
     * The invoice closes as Dibatalkan and stops counting as piutang. Money
     * already received becomes a saldo pelanggan: refund, move or forfeit.
     */
    const paid = verifiedPaidForOrder(cancelOrderId, readTable('payments'));
    /*
     * Sampel dikenakan biaya, digratiskan bila lanjut produksi. Cancelled after
     * the sample was made, the invoice is revised to bill that fee; DP already
     * paid covers it first and only the rest becomes saldo.
     */
    const fee = Number(item.sampleFee) || 0;
    const sampleMade =
      item.needsSample === true &&
      readTable('samples').some((s: any) => s.orderId === cancelOrderId && SAMPLE_MADE_STATUSES.includes(s.status));
    const chargeFee = fee > 0 && sampleMade;
    let cancelInvoice =
      activeInvoiceForOrder(cancelOrderId) || (paid > 0 || chargeFee ? createInvoiceForOrder(item, { user: staff?.name }) : null);
    if (cancelInvoice && chargeFee) {
      const revised = reviseInvoice(cancelInvoice, {
        total: fee,
        schedule: [{ id: 'term-sample-fee', label: 'Biaya Sampel', percentage: 100, amount: fee, trigger: 'manual' }],
        revisedBy: staff?.name || 'Staf',
        notes: `Pesanan ${cancelOrderId} batal setelah sampel dibuat: ditagih biaya sampel.`
      });
      cancelInvoice = updateItem('invoices', revised.id, { cancellationFee: fee });
    }
    if (cancelInvoice) reconcileInvoice(cancelInvoice.id);
  }
  const fresh = advanceOrderAfterWrite(tableName, item) || item;
  res.json(stripSensitive(fresh));
});

app.delete('/api/:resource/:id', requireStaff, (req: Request, res: Response) => {
  const tableName = resolveTable(req, res);
  if (!tableName) return;
  const writeBlocked = writeBlockReason(actorUser(req), tableName);
  if (writeBlocked) return res.status(403).json({ error: writeBlocked });
  if (tableName === 'users') {
    const usersBlocked = usersWriteBlockReason(req.actor!.sub, 'DELETE', req.params.id, null, readTable('users'));
    if (usersBlocked) return res.status(403).json({ error: usersBlocked });
  }
  const blocked = deleteBlockReason(tableName, req.params.id);
  if (blocked) return res.status(409).json({ error: blocked });
  const victim = findById(tableName, req.params.id);
  const success = deleteItem(tableName, req.params.id);
  if (!success) return res.status(404).json({ error: 'Data tidak ditemukan.' });
  cleanUpAfterDelete(tableName, req.params.id);
  if (SPK_SOURCE_TABLES.includes(tableName)) recomputeSpk(victim?.spkId);
  // Without its SPK, report or surat jalan the order returns to where its records put it.
  if (['spk_produksi', 'qc_reports', 'shipments'].includes(tableName) && victim?.orderId) syncOrderStatus(victim.orderId);
  res.json({ success: true });
});

// Serve frontend in production
const DIST_DIR = path.join(process.cwd(), 'dist');
// An unknown API path is a 404, not the app shell.
app.all('/api/*', (_req: Request, res: Response) => {
  res.status(404).json({ error: 'Alamat API tidak dikenal.' });
});

if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get('*', (_req: Request, res: Response) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

/*
 * Anything a handler throws ends here as JSON the client can show, instead of
 * Express's HTML page with the stack trace in it.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err);
  // Aksi yang melempar tidak boleh meninggalkan separuh perubahan.
  rollbackTransaction();
  if (res.headersSent) return;
  const status = Number(err?.status || err?.statusCode) || 500;
  const message = err?.type === 'entity.parse.failed'
    ? 'Isi permintaan bukan JSON yang valid.'
    : status === 413
      ? 'Berkas atau data terlalu besar.'
      : 'Terjadi kesalahan di server. Coba lagi; kalau berulang, hubungi admin.';
  res.status(status).json({ error: message });
});

process.on('unhandledRejection', reason => {
  console.error('Unhandled rejection:', reason);
});

/*
 * Orders recorded before status followed the downstream stages sat at
 * "Diproduksi" however far they had got. Forward-only, so a status someone set
 * by hand is never pulled back.
 */
/*
 * HIJ's standard size charts come with the app. A fresh install (a hosting
 * panel with no terminal to run a seed script) would otherwise have none, and
 * no order can pass the size chart requirement. Only missing charts are added:
 * one already present, even edited, is left alone.
 */
{
  const present = new Set(readTable('size_charts').map((c: any) => String(c.id)));
  const missing = STANDARD_SIZE_CHARTS.filter(c => !present.has(c.id));
  const now = new Date().toISOString();
  for (const chart of missing) {
    insertItem('size_charts', {
      ...chart,
      scope: 'standard',
      notes: chart.notes || SIZE_CHART_COMMON_NOTES,
      user: 'System',
      timestamp: now
    });
  }
  if (missing.length > 0) console.log(`   ${missing.length} size chart standar HIJ ditambahkan.`);
}

/*
 * A fixed Super Admin for local testing, so every developer signs in to the
 * test dataset the same way. Test mode only: the credentials live in the
 * gitignored .env, and a production server ignores them even when set.
 */
(function ensureLocalTestAdmin() {
  const username = String(process.env.LOCAL_ADMIN_USERNAME || '').trim().toLowerCase();
  const plain = String(process.env.LOCAL_ADMIN_PASSWORD || '');
  if (!username || !plain) return;
  if (HIJ_MODE !== 'test') {
    console.warn('  LOCAL_ADMIN_* diabaikan: akun default hanya dibuat di mode uji (npm run dev:test).');
    return;
  }
  if (plain.length < 12) {
    console.warn('  LOCAL_ADMIN_PASSWORD diabaikan: minimal 12 karakter.');
    return;
  }
  const existing = readTable('users').find((u: any) => String(u.username || '').toLowerCase() === username);
  if (!existing) {
    insertItem('users', {
      id: nextId('users', 'USR'),
      username,
      password: hashPassword(plain),
      name: 'Admin HIJ (lokal)',
      role: 'Super Admin',
      allowedModules: ['*'],
      status: 'Active',
      user: 'System'
    });
    console.log(`   Akun uji lokal dibuat: ${username} (Super Admin).`);
    return;
  }
  // Keep it usable: the password from .env wins, and the account stays active.
  const passwordOk = verifyPassword(plain, existing.password).ok;
  if (!passwordOk || existing.status === 'Inactive' || existing.role !== 'Super Admin') {
    updateItem('users', existing.id, {
      ...(passwordOk ? {} : { password: hashPassword(plain) }),
      role: 'Super Admin',
      allowedModules: ['*'],
      status: 'Active'
    });
    console.log(`   Akun uji lokal ${username} disegarkan dari .env.`);
  }
})();

{
  const spks = recomputeAllSpks();
  if (spks > 0) console.log(`   Progres ${spks} SPK dihitung ulang dari catatan produksi.`);
  const moved = syncAllOrderStatuses();
  if (moved > 0) console.log(`   Status ${moved} pesanan disesuaikan dengan SPK/QC/pengiriman/pembayaran.`);
}

app.listen(PORT, () => {
  console.log(`🚀 HIJ Konveksi PWA Server running on port ${PORT}`);
  console.log(
    allowedOrigins.length > 0
      ? `   CORS dibatasi ke: ${allowedOrigins.join(', ')}`
      : '   CORS terbuka untuk semua origin (ALLOWED_ORIGINS belum disetel).'
  );
  console.log(
    fs.existsSync(DIST_DIR)
      ? '   Menyajikan antarmuka ERP dari dist/.'
      : '   dist/ tidak ditemukan — hanya API yang dilayani. Jalankan `npm run build` lebih dulu.'
  );
  if (process.env.NODE_ENV === 'production' && allowedOrigins.length === 0) {
    console.warn(
      '⚠️  PRODUKSI TANPA BATAS ORIGIN: situs mana pun di internet bisa memanggil API ini.\n' +
      '    Setel ALLOWED_ORIGINS ke domain compro, lalu jalankan ulang aplikasinya.'
    );
  }
});
