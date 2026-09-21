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
  DATA_DIR
} from './db.js';
import { getOrderReadiness, verifiedPaidForOrder } from '../../src/lib/readiness.js';
import {
  hashPassword,
  verifyPassword,
  issueToken,
  attachActor,
  requireAuth,
  requireStaff,
  requireSelfOrStaff,
  stripSensitive
} from './auth.js';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
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
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(attachActor);

// Directories
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
const TEMPLATES_DIR = path.join(process.cwd(), 'public', 'templates');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(TEMPLATES_DIR)) fs.mkdirSync(TEMPLATES_DIR, { recursive: true });

app.use('/uploads', express.static(UPLOADS_DIR));
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
    const cleanName = base.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) || 'file';
    cb(null, `${cleanName}_${Date.now()}${ext}`);
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
    // Forward slashes so the banner reads the same on Windows and Linux.
    dataDir: (path.relative(process.cwd(), DATA_DIR) || 'server/data').split(path.sep).join('/')
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

// Preset modules for the 5 staff roles
const STAFF_ROLE_MODULES: Record<string, string[]> = {
  'Super Admin': ['*'],
  'Owner': [
    'Dashboard', 
    'HowItWorks', 
    'Quotations',
    'Orders', 
    'Customers', 
    'PPIC', 
    'QC', 
    'Shipping', 
    'Finance', 
    'HRPayroll', 
    'Storefront'
  ],
  'Design': [
    'Dashboard', 
    'HowItWorks', 
    'Designs', 
    'Quotations',
    'PatternGrading', 
    'Orders', 
    'Customers'
  ],
  'Pengadaan': [
    'Dashboard', 
    'HowItWorks', 
    'Quotations',
    'Procurement', 
    'RawMaterial', 
    'Trims', 
    'Orders'
  ],
  'Produksi': [
    'Dashboard', 
    'HowItWorks', 
    'PPIC', 
    'Cutting', 
    'BundleTracking', 
    'Sewing', 
    'Trims', 
    'QC', 
    'Packaging', 
    'Shipping', 
    'Returns', 
    'Machines', 
    'Safety'
  ]
};

// Unified Smart Login: Auto-detects Staff (5 roles) vs Customer (1 role)
/*
 * One message for every failed attempt. Saying "username tidak ditemukan"
 * versus "password salah" tells an attacker which half they got right.
 */
const LOGIN_FAILED = 'Username atau kata sandi salah.';

/** Identifiers are matched exactly. Substring matching let one guess hit any account. */
function findStaff(users: any[], ident: string) {
  return users.find(u =>
    String(u.username || '').toLowerCase() === ident ||
    String(u.id || '').toLowerCase() === ident ||
    (u.email && String(u.email).toLowerCase() === ident)
  );
}

function findCustomer(customers: any[], ident: string, digits: string) {
  return customers.find(c =>
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
    token: issueToken({ sub: String(user.id), type: 'internal', role: user.role }),
    user: safeUser
  };
}

function customerSession(customer: any) {
  return {
    success: true,
    type: 'customer' as const,
    token: issueToken({ sub: String(customer.id), type: 'customer' }),
    customer: stripSensitive(customer)
  };
}

app.post('/api/auth/unified-login', (req: Request, res: Response) => {
  const identifier = String(req.body.identifier || req.body.username || '').trim();
  const password = String(req.body.password || '');

  if (!identifier || !password) {
    return res.status(400).json({ success: false, error: 'Username dan kata sandi wajib diisi.' });
  }

  const ident = identifier.toLowerCase();
  const digits = identifier.replace(/\D/g, '');

  const matchedUser = findStaff(readTable('users'), ident);
  if (matchedUser) {
    const check = verifyPassword(password, matchedUser.password);
    if (!check.ok) return res.status(401).json({ success: false, error: LOGIN_FAILED });
    upgradeStoredPassword('users', matchedUser.id, password, check.needsUpgrade);
    return res.json(staffSession(matchedUser));
  }

  const matchedCustomer = findCustomer(readTable('customers'), ident, digits);
  if (matchedCustomer) {
    const check = verifyPassword(password, matchedCustomer.password);
    if (!check.ok) return res.status(401).json({ success: false, error: LOGIN_FAILED });
    upgradeStoredPassword('customers', matchedCustomer.id, password, check.needsUpgrade);
    return res.json(customerSession(matchedCustomer));
  }

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
  if (!identifier || !password) {
    return res.status(400).json({ success: false, error: 'Username dan kata sandi wajib diisi.' });
  }

  const user = findStaff(readTable('users'), identifier);
  if (!user) return res.status(401).json({ success: false, error: LOGIN_FAILED });

  const check = verifyPassword(password, user.password);
  if (!check.ok) return res.status(401).json({ success: false, error: LOGIN_FAILED });
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

  const matched = findCustomer(readTable('customers'), identifier, identifier.replace(/\D/g, ''));
  if (!matched) return res.status(401).json({ success: false, error: LOGIN_FAILED });

  const check = verifyPassword(password, matched.password);
  if (!check.ok) return res.status(401).json({ success: false, error: LOGIN_FAILED });
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

  const matchFilter = (item: any) => {
    const itemCustId = String(item.customerId || '').toLowerCase();
    const itemCustName = String(item.customerName || '').toLowerCase();
    return itemCustId === targetId || itemCustId === cleanQuery || (matchedCustomer && itemCustName.includes(matchedCustomer.name?.toLowerCase()));
  };

  const orders = readTable('orders').filter(matchFilter);
  const spks = readTable('spk_produksi').filter(matchFilter);
  const designs = readTable('designs').filter(matchFilter);
  const samples = readTable('samples').filter(matchFilter);
  const invoices = readTable('invoices').filter(matchFilter);
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
app.get('/api/quick-track/:query', (req: Request, res: Response) => {
  const query = String(req.params.query || '').trim().toLowerCase();
  if (!query) {
    return res.status(400).json({ success: false, error: 'Nomor pelacakan wajib diisi.' });
  }

  const spks = readTable('spk_produksi');
  const orders = readTable('orders');
  const shipments = readTable('shipments');
  const samples = readTable('samples');

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
        String(o.poNumber || '').toLowerCase() === query
      );

  // Match Shipment by SPK, Order, or Tracking Number (resi)
  const shipment = shipments.find(sh => 
    (spk && sh.spkId === spk.id) ||
    (order && sh.orderId === order.id) ||
    String(sh.trackingNumber || '').toLowerCase() === query ||
    String(sh.id).toLowerCase() === query
  );

  const sample = (order || spk) ? samples.find(sm => 
    (order && sm.orderId === order.id) || 
    (spk && sm.spkId === spk.id)
  ) : null;

  if (!spk && !order && !shipment) {
    return res.status(404).json({ 
      success: false, 
      found: false, 
      error: 'Data pesanan tidak ditemukan. Periksa kembali nomor SPK atau PO Anda.' 
    });
  }

  // Calculate production stage and progress
  const stage = spk?.stage || order?.status || 'Antrean Produksi';
  const stageMap: Record<string, number> = {
    'Antrean': 10,
    'Antrean Produksi': 15,
    'Pola': 25,
    'Potong': 40,
    'Cutting': 40,
    'Sablon': 55,
    'Bordir': 55,
    'Jahit': 70,
    'Sewing': 70,
    'Finishing': 85,
    'QC': 90,
    'Packing': 95,
    'Selesai': 100,
    'Dikirim': 100
  };

  const progressPercent = typeof spk?.progress === 'number' 
    ? spk.progress 
    : (stageMap[stage] || (shipment ? 100 : 50));

  res.json({
    success: true,
    found: true,
    data: {
      trackingQuery: req.params.query,
      orderId: order?.id || spk?.orderId || 'ORD-UNKNOWN',
      spkId: spk?.id || 'SPK-UNKNOWN',
      customerName: order?.customerName || spk?.customerName || 'Pelanggan HIJ',
      productName: order?.productName || spk?.productName || spk?.product || 'Custom Apparel',
      quantity: order?.quantity || spk?.targetQty || spk?.qty || 0,
      stage: spk?.status === 'In Progress' ? (spk.cutting > 0 ? 'Cutting / Potong' : 'Dalam Antrean') : stage,
      progressPercent,
      material: spk?.material || order?.material || '-',
      sablonBordir: spk?.sablonBordir || '-',
      deadline: order?.deadline || spk?.deadline || spk?.tanggalSelesai || spk?.targetDate || '-',
      createdAt: order?.createdAt || spk?.createdAt || spk?.tanggalMasuk || '-',
      cutting: spk?.cutting ?? 0,
      sewing: spk?.sewing ?? 0,
      finishing: spk?.finishing ?? 0,
      qc: spk?.qc ?? 0,
      notes: spk?.notes || order?.notes || '',
      shipment: shipment ? {
        id: shipment.id,
        courier: shipment.courier || shipment.expedition,
        trackingNumber: shipment.trackingNumber || shipment.resi,
        status: shipment.status,
        shippedAt: shipment.shippedAt || shipment.createdAt,
        estimatedDelivery: shipment.estimatedDelivery
      } : null,
      sample: sample ? {
        id: sample.id,
        status: sample.status,
        sampleType: sample.sampleType,
        photoUrl: sample.photoUrl
      } : null
    }
  });
});

// ---------------------------------------------------------
// DOMAIN-SPECIFIC ENDPOINTS
// ---------------------------------------------------------

// SOP-08: Scan WIP Bundle Handover & Stage Transition
app.post('/api/wip-bundles/scan', (req: Request, res: Response) => {
  const { bundleId, nextStage, operatorName, status } = req.body;
  if (!bundleId) {
    return res.status(400).json({ error: 'ID bundel wajib diisi.' });
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

  // Auto update SPK progress
  if (bundle.spkId) {
    const spk = findById('spk_produksi', bundle.spkId);
    if (spk) {
      const allSpkBundles = readTable('wip_bundles').filter(b => b.spkId === bundle.spkId);
      const totalBundles = allSpkBundles.length;
      if (totalBundles > 0) {
        const completedBundles = allSpkBundles.filter(b => b.currentStage === 'Packing' || b.currentStage === 'QC' || b.status === 'Completed').length;
        const progress = Math.min(100, Math.round((completedBundles / totalBundles) * 100));
        updateItem('spk_produksi', spk.id, { progress });
      }
    }
  }

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
    patterns: readTable('patterns'),
    designs: readTable('designs')
  });
}

/** Returns why an SPK may not be created for this order, or null when it may. */
function spkBlockReason(orderId: string | undefined): string | null {
  if (!orderId) return 'SPK harus terhubung ke pesanan.';
  const order = findById('orders', orderId);
  if (!order) return 'Pesanan tidak ditemukan.';
  if (readTable('spk_produksi').some(s => s.orderId === order.id)) {
    return `SPK untuk pesanan ${order.id} sudah ada.`;
  }
  // SPK tidak wajib dipenuhi untuk repeat order atau kuantitas di bawah 50 pcs (dibuat manual di tiap pesanan)
  if (order.isRepeatOrder || (Number(order.quantity) > 0 && Number(order.quantity) < 50)) {
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

app.get('/api/orders/:id/readiness', (req: Request, res: Response) => {
  const order = findById('orders', req.params.id);
  if (!order) return res.status(404).json({ error: 'Pesanan tidak ditemukan.' });
  res.json(readinessForOrder(order));
});

// SOP-03: PPIC issues the SPK once every production requirement is met.
app.post('/api/orders/:id/issue-spk', (req: Request, res: Response) => {
  const order = findById('orders', req.params.id);
  if (!order) return res.status(404).json({ error: 'Pesanan tidak ditemukan.' });

  const blockReason = spkBlockReason(order.id);
  if (blockReason) {
    return res.status(409).json({ error: blockReason, readiness: readinessForOrder(order) });
  }

  const { plannedStart, notes, user } = req.body || {};

  // Resolve mockup from order or linked design to forward to SPK
  const designs = readTable('designs');
  const matchedDesign = (order.designId && designs.find((d: any) => d.id === order.designId)) ||
    (order.designName && designs.find((d: any) => d.name === order.designName)) ||
    designs.find((d: any) => d.orderId === order.id);

  const mockupDepan = order.designUrl || matchedDesign?.mockupFront || '';
  const mockupBelakang = matchedDesign?.mockupBack || '';

  const spkPayload = {
    id: `SPK-${order.id}`,
    orderId: order.id,
    po: order.po || `PO-${order.id}`,
    customerId: order.customerId,
    customerName: order.customerName,
    productName: order.productType,
    targetQty: Number(order.quantity) || 1,
    material: order.material || '-',
    sablonBordir: order.accessories || order.sablonBordir || '-',
    tanggalMasuk: plannedStart || new Date().toISOString().split('T')[0],
    tanggalSelesai: order.deadline,
    notes: notes ?? order.notes,
    sizeChart: order.sizeChart,
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
  const updatedOrder = updateItem('orders', order.id, { status: 'In Production' });

  res.status(201).json({
    success: true,
    message: `SPK ${newSpk.id} diterbitkan dan masuk antrean produksi.`,
    spk: newSpk,
    order: updatedOrder
  });
});

// SOP-01: Create an order. SPKs are issued separately through PPIC.
app.post('/api/orders/with-spk', (req: Request, res: Response) => {
  const { order } = req.body;
  const newOrder = insertItem('orders', { ...order, status: order?.status || 'Order' });
  res.json({ success: true, order: newOrder, spk: null, readiness: readinessForOrder(newOrder) });
});

// Quotation approval (SOP-01): creates the order. Production waits for the SPK requirements.
app.post('/api/quotations/:id/approve-to-order', (req: Request, res: Response) => {
  const quotationId = req.params.id;
  const quotation = findById('quotations', quotationId);

  if (!quotation) {
    return res.status(404).json({ error: 'Penawaran tidak ditemukan.' });
  }

  const { downPayment, po, deadline, user } = req.body;
  const now = new Date();

  // Generate next sequential Order ID
  const orders = readTable('orders');
  const nextOrderNum = orders.length + 1;
  const orderId = `ORD-${String(nextOrderNum).padStart(3, '0')}`;
  const finalPo = po || `PO-${(quotation.customerName || 'HIJ').replace(/[^a-zA-Z0-9]/g, '').slice(0, 3).toUpperCase()}-${now.getFullYear()}-${String(nextOrderNum).padStart(2, '0')}`;
  const totalAmount = Number(quotation.totalPrice) || (Number(quotation.quantity) * Number(quotation.price));
  const finalDp = downPayment !== undefined ? Number(downPayment) : Math.round(totalAmount * 0.5);

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
    accessories: quotation.accessories || '-',
    needsProcurement: quotation.needsProcurement || 'Perlu Pengadaan',
    notes: `Dibuat dari penawaran ${quotation.id}. ${quotation.notes || ''}`.trim(),
    user: user || quotation.user || 'Sistem',
    timestamp: now.toISOString(),
    // Anti-Skip & Specifications mapping
    needsSample: quotation.needsSample !== undefined ? quotation.needsSample : true,
    sampleStatus: quotation.needsSample === false ? 'Approved' : 'Pending',
    sablonBordir: quotation.sablonBordir || quotation.accessories || '-',
    designId: quotation.designId || '',
    designName: quotation.designName || quotation.productType,
    designUrl: quotation.designUrl || '',
    moq: quotation.moq || 100,
    priceBelowMoq: quotation.priceBelowMoq || quotation.price,
    discount: quotation.discount || 0,
    discountPercent: quotation.discountPercent || 0,
    // Installments agreed on the quotation follow the order into invoicing
    paymentSchedule: Array.isArray(quotation.paymentSchedule) ? quotation.paymentSchedule : []
  };

  const newOrder = insertItem('orders', orderPayload);

  // 2. Update Quotation status to Approved with link to generated order
  const updatedQuotation = updateItem('quotations', quotation.id, {
    status: 'Approved',
    orderId: orderId,
    approvedAt: now.toISOString()
  });

  res.json({
    success: true,
    message: `Penawaran ${quotation.id} disetujui. Pesanan ${orderId} dibuat dan menunggu syarat produksi.`,
    quotation: updatedQuotation,
    order: newOrder,
    readiness: readinessForOrder(newOrder)
  });
});

// SOP-01A & SOP-20: Revisi Penawaran yang sudah Deal (Perubahan Qty/Harga di tengah jalan)
// Otomatis menyinkronkan Quotation -> Order -> Invoice
/** Next free revision number for a document family, and the id that carries it. */
function nextRevision(table: string, baseId: string) {
  const family = readTable(table).filter(
    (r: any) => r.id === baseId || r.revisionOf === baseId
  );
  const highest = family.reduce((max: number, r: any) => Math.max(max, Number(r.revision) || 0), 0);
  const revision = highest + 1;
  return { revision, id: `${baseId}-R${revision}` };
}

/*
 * SOP-01/20: a deal whose quantity changes mid-flight.
 * The agreed figures are never overwritten. A new revision is issued, the old
 * one is marked superseded, and money already received carries across so the
 * customer is never asked to pay twice.
 */
app.put('/api/quotations/:id/revise-deal', (req: Request, res: Response) => {
  const quotation = findById('quotations', req.params.id);

  if (!quotation) {
    return res.status(404).json({ error: 'Penawaran tidak ditemukan.' });
  }
  if (quotation.supersededBy) {
    return res.status(409).json({
      error: `Penawaran ${quotation.id} sudah diganti revisi ${quotation.supersededBy}. Revisi dari dokumen terbaru.`
    });
  }

  const { quantity, price, totalPrice, deadline, notes, paymentSchedule, user } = req.body;
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
    paymentSchedule: Array.isArray(paymentSchedule) ? paymentSchedule : quotation.paymentSchedule,
    timestamp: now
  });
  updateItem('quotations', quotation.id, { supersededBy: newQuotation.id, supersededAt: now });

  // 2. Point the order at the new figures and the new document.
  const linkedOrder = readTable('orders').find(
    (o: any) => o.quotationId === quotation.id || o.id === quotation.orderId
  );
  let updatedOrder = null;
  let newInvoice = null;

  if (linkedOrder) {
    updatedOrder = updateItem('orders', linkedOrder.id, {
      quotationId: newQuotation.id,
      quantity: newQty,
      price: newPrice,
      totalPrice: newTotal,
      deadline: deadline || linkedOrder.deadline,
      paymentSchedule: newQuotation.paymentSchedule,
      updatedAt: now
    });

    // 3. Reissue the invoice, carrying over whatever has already been paid.
    const activeInvoice = readTable('invoices').find(
      (inv: any) => !inv.supersededBy && (inv.orderId === linkedOrder.id || inv.quotationId === quotation.id)
    );

    if (activeInvoice) {
      const invBase = activeInvoice.revisionOf || activeInvoice.id;
      const invNext = nextRevision('invoices', invBase);
      const paid = Number(activeInvoice.downPaymentReceived) || 0;
      const balanceRemaining = Math.max(0, newTotal - paid);
      const status =
        newTotal > 0 && balanceRemaining <= 0 ? 'Lunas' : paid > 0 ? 'DP Dibayar' : 'Belum Bayar';

      newInvoice = insertItem('invoices', {
        ...activeInvoice,
        id: invNext.id,
        invoiceNo: activeInvoice.invoiceNo || invBase,
        revision: invNext.revision,
        revisionOf: invBase,
        revisedBy,
        supersededBy: undefined,
        supersededAt: undefined,
        quotationId: newQuotation.id,
        amount: newTotal,
        total: newTotal,
        downPaymentReceived: paid,
        balanceRemaining,
        status,
        paymentSchedule: newQuotation.paymentSchedule,
        timestamp: now
      });
      updateItem('invoices', activeInvoice.id, { supersededBy: newInvoice.id, supersededAt: now });
    }
  }

  res.json({
    success: true,
    message:
      `Revisi ${quoNext.revision} diterbitkan: ${newQuotation.id}. ` +
      (newInvoice
        ? `Faktur ${newInvoice.id} menggantikan yang lama, pembayaran yang sudah masuk tetap terhitung.`
        : 'Pesanan terkait sudah disinkronkan.'),
    quotation: newQuotation,
    order: updatedOrder,
    invoice: newInvoice
  });
});

// Dashboard Analytics KPIs
app.get('/api/dashboard/stats', (_req: Request, res: Response) => {
  const orders = readTable('orders');
  const spks = readTable('spk_produksi');
  const customers = readTable('customers');
  const invoices = readTable('invoices');
  const qcReports = readTable('qc_reports');
  const bundles = readTable('wip_bundles');

  const totalOrders = orders.length;
  const activeSpks = spks.filter(s => s.status !== 'Completed');
  const totalPcsInProduction = activeSpks.reduce((acc, s) => acc + (Number(s.targetQty) || 0), 0);
  
  const totalRevenue = invoices.reduce((acc, i) => acc + (Number(i.total) || 0), 0);
  const pendingPayment = invoices.reduce((acc, i) => acc + (Number(i.balanceRemaining) || 0), 0);

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
export function reconcileInvoice(invoiceId: string) {
  if (!invoiceId) return null;
  const invoice = findById('invoices', invoiceId);
  if (!invoice) return null;

  const payments = readTable('payments').filter(p => p.invoiceId === invoiceId && p.status !== 'Rejected');
  const totalPaid = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const invoiceTotal = Number(invoice.total) || Number(invoice.amount) || 0;
  const balanceRemaining = Math.max(0, invoiceTotal - totalPaid);
  
  let status: 'Belum Bayar' | 'DP Dibayar' | 'Lunas' = 'Belum Bayar';
  if (balanceRemaining <= 0 && invoiceTotal > 0) {
    status = 'Lunas';
  } else if (totalPaid > 0) {
    status = 'DP Dibayar';
  }

  const updatedInvoice = updateItem('invoices', invoiceId, {
    downPaymentReceived: totalPaid,
    balanceRemaining: balanceRemaining,
    status: status
  });

  // Also sync order downPayment if order exists
  if (invoice.orderId) {
    const order = findById('orders', invoice.orderId);
    if (order) {
      updateItem('orders', order.id, {
        downPayment: totalPaid,
        dpPercent: order.totalPrice > 0 ? Math.min(100, Math.round((totalPaid / order.totalPrice) * 100)) : 0
      });
    }
  }

  return updatedInvoice;
}

// Dedicated Endpoint: Record Kas Masuk / Payment with auto invoice & order reconciliation
app.post('/api/payments/record', (req: Request, res: Response) => {
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

  const payments = readTable('payments');
  const nextNum = payments.length + 1;
  const paymentId = `PAY-${String(nextNum).padStart(3, '0')}`;

  let targetInvoiceId = invoiceId;
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
    const invoices = readTable('invoices');
    const matched = invoices.find(i => i.orderId === targetOrderId);
    if (matched) {
      targetInvoiceId = matched.id;
      if (!targetCustomerId) targetCustomerId = matched.customerId;
      if (!targetCustomerName) targetCustomerName = matched.customerName;
    }
  }

  const paymentPayload = {
    id: paymentId,
    orderId: targetOrderId || '',
    invoiceId: targetInvoiceId || '',
    customerId: targetCustomerId || '',
    customerName: targetCustomerName || 'Klien',
    amount: Number(amount),
    type: type || 'DP',
    date: date || new Date().toISOString().split('T')[0],
    paymentMethod: paymentMethod || bankAccount || 'Transfer Bank BCA',
    bankAccount: bankAccount || paymentMethod || 'Transfer Bank BCA',
    proofImageUrl: proofImageUrl || '',
    status: status || 'Verified',
    notes: notes || `Penerimaan kas masuk ${type || 'pembayaran'}.`,
    user: user || 'Finance Staff',
    timestamp: new Date().toISOString()
  };

  const newPayment = insertItem('payments', paymentPayload);

  // Auto reconcile invoice balance
  let updatedInvoice = null;
  if (targetInvoiceId) {
    updatedInvoice = reconcileInvoice(targetInvoiceId);
  }
  reconcileOrderPayments(targetOrderId);

  res.status(201).json({
    success: true,
    message: `Pembayaran Rp ${Number(amount).toLocaleString('id-ID')} berhasil dicatat.`,
    payment: newPayment,
    invoice: updatedInvoice
  });
});

// Endpoint to verify payment and trigger reconciliation
app.post('/api/payments/:id/verify', (req: Request, res: Response) => {
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

// Specialized Invoice Creation Endpoint with auto balance calculations
app.post('/api/invoices', (req: Request, res: Response) => {
  const data = req.body;
  const invoices = readTable('invoices');
  const nextNum = invoices.length + 1;
  const invId = data.id || `INV-${String(nextNum).padStart(3, '0')}`;
  
  const amount = Number(data.amount) || Number(data.total) || 0;
  const tax = Number(data.tax) || 0;
  const total = Number(data.total) || (amount + tax);
  const downPayment = Number(data.downPaymentReceived) || 0;
  const balanceRemaining = Math.max(0, total - downPayment);
  const status = balanceRemaining <= 0 && total > 0 ? 'Lunas' : (downPayment > 0 ? 'DP Dibayar' : 'Belum Bayar');

  const invoicePayload = {
    ...data,
    id: invId,
    amount,
    tax,
    total,
    downPaymentReceived: downPayment,
    balanceRemaining,
    status: data.status || status,
    dueDate: data.dueDate || new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
    timestamp: data.timestamp || new Date().toISOString()
  };

  const newInvoice = insertItem('invoices', invoicePayload);
  res.status(201).json(newInvoice);
});

// ---------------------------------------------------------
// SOP-16 → SOP-20: DRAFT INVOICE WHEN AN ORDER LEAVES THE WAREHOUSE
// ---------------------------------------------------------
const SHIPPED_STATUSES = ['Picked Up', 'In Transit', 'Delivered'];

function nextInvoiceId(): string {
  let num = readTable('invoices').length + 1;
  let id = `INV-${String(num).padStart(3, '0')}`;
  while (findById('invoices', id)) {
    num += 1;
    id = `INV-${String(num).padStart(3, '0')}`;
  }
  return id;
}

/** Creates a draft invoice for the shipment's order once it is handed to the courier, unless one exists. */
function ensureDraftInvoiceForShipment(shipment: any) {
  if (!shipment || !SHIPPED_STATUSES.includes(shipment.status) || !shipment.orderId) return null;
  const order = findById('orders', shipment.orderId);
  if (!order) return null;
  if (readTable('invoices').some(i => i.orderId === order.id)) return null;

  const total = Number(order.totalPrice) || 0;
  const paid = verifiedPaidForOrder(order.id, readTable('payments'));
  const balanceRemaining = Math.max(0, total - paid);

  return insertItem('invoices', {
    id: nextInvoiceId(),
    orderId: order.id,
    customerId: order.customerId,
    customerName: order.customerName,
    amount: total,
    tax: 0,
    total,
    downPaymentReceived: paid,
    balanceRemaining,
    dueDate: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
    status: balanceRemaining <= 0 && total > 0 ? 'Lunas' : (paid > 0 ? 'DP Dibayar' : 'Belum Bayar'),
    reviewStatus: 'Draft',
    shipmentId: shipment.id,
    notes: `Draf otomatis dari surat jalan ${shipment.id}. Periksa sebelum dikirim ke pelanggan.`,
    user: 'Sistem'
  });
}

app.post('/api/shipments', (req: Request, res: Response) => {
  const shipment = insertItem('shipments', req.body);
  const draftInvoice = ensureDraftInvoiceForShipment(shipment);
  res.status(201).json({ ...shipment, draftInvoiceId: draftInvoice?.id });
});

app.put('/api/shipments/:id', (req: Request, res: Response) => {
  const shipment = updateItem('shipments', req.params.id, req.body);
  if (!shipment) return res.status(404).json({ error: 'Data tidak ditemukan.' });
  const draftInvoice = ensureDraftInvoiceForShipment(shipment);
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
app.post('/api/store/referrals/:id/payout', (req: Request, res: Response) => {
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
    dueDate: new Date(Date.now() + 1 * 86400000).toISOString().split('T')[0],
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

app.get('/api/payment/settings', (_req: Request, res: Response) => {
  const settings = readTable('store_settings');
  const paymentConfig = settings.find(s => s.id === 'PAYMENT_CONFIG') || {
    id: 'PAYMENT_CONFIG',
    activeGateway: 'built_in_simulator',
    qrisMerchantName: 'HIJ KONVEKSI PT HASIL INTI JUALAN',
    autoVerifySimulation: true,
    midtrans: { merchantId: '', clientKey: '', serverKey: '', isProduction: false },
    tripay: { merchantCode: '', apiKey: '', privateKey: '', isProduction: false }
  };
  res.json(paymentConfig);
});

app.post('/api/payment/settings', (req: Request, res: Response) => {
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
app.post('/api/payment/simulate-success', async (req: Request, res: Response) => {
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

app.get('/api/digiflazz/settings', (_req: Request, res: Response) => {
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
  res.json(digiConfig);
});

app.post('/api/digiflazz/settings', (req: Request, res: Response) => {
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
app.post('/api/digiflazz/balance', async (req: Request, res: Response) => {
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
app.post('/api/digiflazz/price-list', async (req: Request, res: Response) => {
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
app.post('/api/digiflazz/topup', async (req: Request, res: Response) => {
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
app.post('/api/import/commit', requireStaff, (req: Request, res: Response) => {
  const { monthLabel, orders = [], samples = [], applyBreakdown = true } = req.body || {};
  if (!Array.isArray(orders) || !Array.isArray(samples)) {
    return res.status(400).json({ error: 'Isi impor tidak dikenali.' });
  }

  const source = String(monthLabel || 'IMPOR').trim();
  const normalise = (value: unknown) => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  const customers = readTable('customers');
  const report = {
    customersCreated: [] as string[],
    ordersCreated: [] as string[],
    ordersUpdated: [] as string[],
    samplesCreated: [] as string[],
    breakdownApplied: 0,
    breakdownHeld: 0
  };

  /** Reuse a customer whose name contains the brand, or register a new one. */
  function resolveCustomer(brand: string): any {
    const key = normalise(brand);
    const existing = customers.find(c => {
      const a = normalise(c.company);
      const b = normalise(c.name);
      return (a && (a.includes(key) || key.includes(a))) || (b && (b.includes(key) || key.includes(b)));
    });
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
      updateItem('orders', existing.id, payload);
      report.ordersUpdated.push(existing.id);
    } else {
      const orderRows = readTable('orders');
      const created = insertItem('orders', {
        id: `ORD-IMP-${String(row.sourceRow).padStart(3, '0')}`,
        po: `PO-${normalise(brand).slice(0, 6)}-${String(row.sourceRow).padStart(3, '0')}`,
        status: 'Order',
        ...payload
      });
      void orderRows;
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
      const created = insertItem('samples', { id: `SMP-IMP-${String(row.sourceRow).padStart(3, '0')}`, ...payload });
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

app.post('/api/sync', (req: Request, res: Response) => {
  const { table, action, payload } = req.body;
  if (!table || !action || !payload) {
    return res.status(400).json({ error: 'Data sinkronisasi tidak valid.' });
  }

  const syncTable = TABLE_MAP[String(table).toLowerCase()] || String(table).toLowerCase();
  if (action === 'CREATE' && syncTable === 'spk_produksi') {
    const reason = spkBlockReason(payload.orderId);
    if (reason) return res.status(409).json({ error: reason });
  }

  try {
    if (action === 'CREATE') {
      insertItem(table, payload);
    } else if (action === 'UPDATE') {
      updateItem(table, payload.id, payload);
    } else if (action === 'DELETE') {
      deleteItem(table, payload.id);
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

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
    enums: { status: ['Approved', 'Revision', 'Revision Requested', 'Rejected'] }
  },
  invoices: {
    methods: ['PUT'],
    allow: ['proofUrl', 'updatedAt'],
    // The amount a customer claims to have paid is a claim, not a receipt.
    // Finance still records the real money through /api/payments/record.
    rename: { downPaymentReceived: 'proofAmountClaimed' },
    force: { status: 'Menunggu Verifikasi' }
  },
  returns_complaints: {
    methods: ['POST'],
    allow: ['orderId', 'category', 'quantity', 'description', 'photoUrl', 'createdAt'],
    force: { status: 'Diajukan' }
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

const ownsRecord = (record: any, customerId: string) =>
  String(record?.customerId || '').toLowerCase() === String(customerId).toLowerCase();

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

app.get('/api/:resource', requireStaff, (req: Request, res: Response) => {
  const tableName = TABLE_MAP[req.params.resource.toLowerCase()] || req.params.resource.toLowerCase();
  const data = readTable(tableName);
  res.json(stripSensitive(data));
});

app.get('/api/:resource/:id', requireStaff, (req: Request, res: Response) => {
  const tableName = TABLE_MAP[req.params.resource.toLowerCase()] || req.params.resource.toLowerCase();
  const item = findById(tableName, req.params.id);
  if (!item) return res.status(404).json({ error: 'Data tidak ditemukan.' });
  res.json(stripSensitive(item));
});

app.post('/api/:resource', requireAuth, (req: Request, res: Response) => {
  const tableName = TABLE_MAP[req.params.resource.toLowerCase()] || req.params.resource.toLowerCase();

  if (req.actor!.type === 'customer') {
    const result = customerWriteBody(tableName, 'POST', req.body, req.actor!.sub);
    if ('error' in result) return res.status(403).json({ error: result.error });
    return res.status(201).json(stripSensitive(insertItem(tableName, result.body)));
  }

  req.body = hashIncomingPassword(tableName, req.body);

  if (tableName === 'spk_produksi') {
    const reason = spkBlockReason(req.body?.orderId);
    if (reason) return res.status(409).json({ error: reason });
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
  res.status(201).json(item);
});

app.put('/api/:resource/:id', requireAuth, (req: Request, res: Response) => {
  const tableName = TABLE_MAP[req.params.resource.toLowerCase()] || req.params.resource.toLowerCase();

  if (req.actor!.type === 'customer') {
    const existing = findById(tableName, req.params.id);
    if (!existing) return res.status(404).json({ error: 'Data tidak ditemukan.' });
    if (!ownsRecord(existing, req.actor!.sub)) {
      return res.status(403).json({ error: 'Data ini bukan milik akun Anda.' });
    }
    const result = customerWriteBody(tableName, 'PUT', req.body, req.actor!.sub);
    if ('error' in result) return res.status(403).json({ error: result.error });
    const updated = updateItem(tableName, req.params.id, result.body);
    if (!updated) return res.status(404).json({ error: 'Data tidak ditemukan.' });
    return res.json(stripSensitive(updated));
  }

  req.body = hashIncomingPassword(tableName, req.body);

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
  res.json(stripSensitive(item));
});

app.delete('/api/:resource/:id', requireStaff, (req: Request, res: Response) => {
  const tableName = TABLE_MAP[req.params.resource.toLowerCase()] || req.params.resource.toLowerCase();
  const success = deleteItem(tableName, req.params.id);
  if (!success) return res.status(404).json({ error: 'Data tidak ditemukan.' });
  res.json({ success: true });
});

// Serve frontend in production
const DIST_DIR = path.join(process.cwd(), 'dist');
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get('*', (_req: Request, res: Response) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
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
