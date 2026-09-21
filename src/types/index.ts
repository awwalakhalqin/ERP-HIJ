// =========================================================
// TYPES & CONTRACTS: HIJ KONVEKSI PWA (SOP 01 - 20)
// =========================================================

export type SOPModule = 
  | 'Dashboard'
  | 'Customers'
  | 'Quotations'
  | 'Orders'
  | 'Designs'
  | 'PPIC'
  | 'Procurement'
  | 'RawMaterial'
  | 'PatternGrading'
  | 'Cutting'
  | 'BundleTracking'
  | 'Sewing'
  | 'QC'
  | 'Packaging'
  | 'Returns'
  | 'Shipping'
  | 'HRPayroll'
  | 'Finance'
  | 'Accounts'
  | 'HowItWorks';

export type StaffRole = 
  | 'Super Admin' 
  | 'Owner' 
  | 'Design' 
  | 'Pengadaan' 
  | 'Produksi';

export const STAFF_ROLE_MODULES: Record<StaffRole, (SOPModule | '*')[]> = {
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
    'HRPayroll'
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
    'Orders'
  ],
  'Produksi': [
    'Dashboard', 
    'HowItWorks', 
    'PPIC', 
    'Cutting', 
    'BundleTracking', 
    'Sewing', 
    'QC', 
    'Packaging', 
    'Shipping', 
    'Returns'
  ]
};

export interface User {
  id: string;
  username: string;
  password?: string;
  name: string;
  role: StaffRole | string;
  avatar?: string;
  allowedModules: (SOPModule | '*')[];
  timestamp?: string;
  user?: string;
}

export interface CustomerSession {
  id: string;
  name: string;
  company?: string;
  contact?: string;
  phone?: string;
  email?: string;
  address?: string;
  status?: string;
  username?: string;
  selectedSpkId?: string;
  selectedOrderId?: string;
}

export type AuthSession = 
  | { type: 'internal'; user: User }
  | { type: 'customer'; customer: CustomerSession };

// 1. SOP-01 & 20: Customers & Orders
export interface Customer {
  id: string;
  name: string;
  company?: string;
  contact?: string;
  email?: string;
  phone?: string;
  address?: string;
  status?: 'Active' | 'Inactive';
  username?: string; // Dibuat oleh staf
  password?: string; // Dibuat oleh staf
  portalAccessActive?: boolean; // Dibuat oleh staf
  user?: string;
  timestamp?: string;
  updatedAt?: string;
}

export interface OrderItemSize {
  model?: string;
  warna?: string;
  size: string;
  qty: number;
  readyHIJ?: number;
  belanja?: number;
  panjang?: string;
  dada?: string;
  lengan?: string;
}

/**
 * One agreed installment. Terms are negotiated when the quotation is made and
 * are printed on the invoice.
 */
export interface PaymentTerm {
  id: string;
  /** "DP", "Termin 2", "Pelunasan" — printed as the invoice row label. */
  label: string;
  percentage: number;
  amount: number;
  /** When it falls due, e.g. "Saat deal", "Sebelum pengiriman". */
  dueRule?: string;
  dueDate?: string;
  paidAmount?: number;
  paidAt?: string;
}

export interface Quotation {
  id: string;
  customerId: string;
  customerName: string;
  productType: string;
  quantity: number;
  price: number;
  totalPrice: number;
  deadline: string;
  status: 'Draft' | 'Sent' | 'Approved' | 'Rejected';
  material?: string;
  color?: string;
  size?: string;
  accessories?: string;
  needsProcurement?: string;
  notes?: string;
  orderId?: string;
  approvedAt?: string;
  timestamp?: string;
  user?: string;

  // Spesifikasi 4 Serangkai & Dokumen Acuan Penawaran QUO-001
  designId?: string;
  designName?: string;
  designUrl?: string;
  sablonBordir?: string;
  moq?: number;
  priceBelowMoq?: number;
  needsSample?: boolean;
  sampleStatus?: string;
  isRepeatOrder?: boolean;
  /** Installments agreed with the customer (SOP-20). */
  paymentSchedule?: PaymentTerm[];

  /*
   * Revisions. A deal whose quantity changes mid-flight is never overwritten:
   * the old figures stay readable so a customer who already transferred against
   * them can be answered. `id` stays unique per revision (QUO-001-R1) while
   * `quotationNo` keeps the number everyone quotes on the phone (QUO-001).
   */
  revision?: number;
  quotationNo?: string;
  revisionOf?: string;
  revisionNote?: string;
  revisedBy?: string;
  supersededBy?: string;
  supersededAt?: string;
}

export interface Order {
  id: string;
  po?: string;
  quotationId?: string;
  isRepeatOrder?: boolean;
  repeatFromOrderId?: string;
  customerId: string;
  customerName: string;
  productType: string;
  quantity: number;
  price: number;
  totalPrice: number;
  downPayment?: number;
  dpPercent?: number;
  discount?: number;
  discountPercent?: number;
  deadline: string;
  status: 'Quotation' | 'Order' | 'Sample' | 'In Production' | 'QC' | 'Shipping' | 'Completed' | 'Cancelled';
  material?: string;
  color?: string;
  size?: string;
  accessories?: string;
  sizeChart?: string; // JSON string of OrderItemSize[]
  needsProcurement?: 'Perlu Pengadaan' | 'Tanpa Pengadaan' | string;
  paymentTerms?: string;
  notes?: string;
  user?: string;
  timestamp?: string;
  updatedAt?: string;

  // Spesifikasi 4 Serangkai & Dokumen Acuan Invoice / SPK
  designId?: string;
  designName?: string;
  designUrl?: string;
  sablonBordir?: string;
  moq?: number;
  priceBelowMoq?: number;
  needsSample?: boolean;
  sampleStatus?: string;

  // Production requirements before an SPK may be issued (SOP-01, 02, 03, 04, 06, 20).
  // downPayment holds the amount actually paid; dpRequired is the DP agreed at approval.
  dpRequired?: number;
  specialTermsApprovedBy?: string; // owner-approved special payment terms (SOP-20)
  specialTermsApprovedAt?: string;
  sampleWaivedReferenceOrderId?: string; // repeat order reusing an approved sample
  sampleWaivedBy?: string;
  sampleWaivedAt?: string;
  materialConfirmedBy?: string; // PPIC confirmed warehouse stock covers this order
  materialConfirmedAt?: string;
  /** Installments carried over from the approved quotation. */
  paymentSchedule?: PaymentTerm[];
}

// 2. SOP-02: Designs & Samples
export interface Design {
  id: string;
  orderId?: string;
  customerId?: string;
  name: string;
  category?: string;
  status: 'Draft' | 'Pending Review' | 'Approved' | 'Revision Requested' | 'Rejected';
  description?: string;
  mockupFront?: string;
  mockupBack?: string;
  mockupDetail?: string;
  revisionNotes?: string;
  approvedBy?: string;
  approvedAt?: string;
  user?: string;
  timestamp?: string;
}

export interface Sample {
  id: string;
  orderId?: string;
  customerId: string;
  customerName?: string;
  productName: string;
  /** Fitting size this sample was cut to, e.g. "L" or "All Size". */
  size?: string;
  quantity?: number;
  vendor?: string;
  notes?: string;
  approvedAt?: string;
  status: 'Development' | 'In Progress' | 'Sent to Customer' | 'Approved' | 'Revision' | 'Rejected';
  qcNote?: string;
  feedback?: string;
  trackingNumber?: string;
  user?: string;
  timestamp?: string;
}

// 3. SOP-03: PPIC & SPK Produksi
export interface SPK {
  id: string;
  orderId: string;
  po?: string;
  customerId: string;
  customerName: string;
  productName: string;
  targetQty: number;
  material?: string;
  sablonBordir?: string;
  tanggalMasuk: string;
  tanggalSelesai: string;
  deadline?: string;
  notes?: string;
  pjFinishing?: string;
  pjCutting?: string;
  pjKepalaProduksi?: string;
  mockupDepan?: string;
  mockupBelakang?: string;
  cutting: number;
  sewing: number;
  finishing: number;
  qc: number;
  progress: number;
  status: 'Queued' | 'In Progress' | 'Finishing' | 'QC Passed' | 'Completed';
  sizeChart?: string;
  employeeProgress?: string;
  user?: string;
  timestamp?: string;
  updatedAt?: string;
}

// 4. SOP-04: Procurement & Supplier Management (Khusus Kebutuhan Bahan Tiap Proyek)
export interface Procurement {
  id: string;
  itemName: string;
  supplierName?: string;
  supplierContact?: string;
  intendedFor: string; // e.g. ORD-001 (Wajib terikat ke proyek/pesanan)
  orderId?: string;
  projectName?: string;
  customerName?: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
  purchaseDate: string;
  estimatedDelivery?: string;
  category: 'Kain Utama' | 'Furing' | 'Kain Kombinasi' | 'Rib / Kerah' | 'Sablon/Bordir Khusus' | 'Aksesoris Khusus' | string;
  status: 'Requested' | 'PO Created' | 'Paid' | 'Shipped' | 'Received';
  notes?: string;
  user?: string;
  timestamp?: string;
}

// 5. SOP-05: Raw Material Warehouse & Accessories Inventory (Stok Aksesoris & Stock Opname)
export interface FabricRoll {
  id: string; // LOT / Roll ID
  fabricName: string;
  color: string;
  rollNumber: string;
  lengthMeters: number;
  remainingMeters: number;
  grammage?: number;
  widthCm?: number;
  defectCountPerRoll: number;
  defectNotes?: string;
  rackLocation: string;
  supplier: string;
  status: 'Available' | 'Reserved' | 'In Cutting' | 'Depleted';
  receivedDate: string;
  user?: string;
}

export interface InventoryItem {
  id: string; // e.g. ACC-KNC-001
  name: string;
  stock: number;
  unit: string; // pcs, roll, lusin, meter, gross, pack, cones
  minStock: number; // batas minimum stok / safety stock
  price: number;
  category: 'Kancing & Resleting' | 'Benang' | 'Label & Hangtag' | 'Karet & Tali' | 'Aksesoris Metal/Plastik' | 'Kemasan & Penunjang' | string;
  location?: string; // e.g. RAK-AKSESORIS-A1
  supplier?: string;
  user?: string;
  timestamp?: string;
  lastOpnameDate?: string;
  lastOpnameNotes?: string;
}

export interface StockOpnameRecord {
  id: string; // e.g. OPN-2026-001
  itemId: string;
  itemName: string;
  category?: string;
  systemStock: number;
  physicalStock: number;
  difference: number; // physicalStock - systemStock
  unit: string;
  reason?: string;
  auditor: string;
  opnameDate: string;
  timestamp?: string;
}

// 6. SOP-06: Pattern & Grading Size Charts
/*
 * A size chart as the factory publishes it.
 *
 * Columns differ per garment — a jersey lists short-sleeve length, a vest lists
 * shoulder width, a plain tee only two measurements — so the measurements are
 * declared per chart rather than fixed in the type. Values stay strings because
 * the printed charts write chest as "50/100" (width over circumference).
 */
export interface SizeChartMeasurement {
  key: string;
  label: string;
  /** Short code printed on the diagram, e.g. LD, PB, LP. */
  code?: string;
}

export interface SizeChartRow {
  size: string;
  values: Record<string, string>;
}

export interface SizeChart {
  id: string;
  name: string;
  garment: string;
  /** 'standard' is HIJ's own chart; 'customer' belongs to one client. */
  scope: 'standard' | 'customer';
  customerId?: string;
  customerName?: string;
  measurements: SizeChartMeasurement[];
  rows: SizeChartRow[];
  notes?: string;
  /** Path under public/ to the published artwork this was transcribed from. */
  referenceImage?: string;
  user?: string;
  timestamp?: string;
}

export interface PatternGrading {
  id: string;
  category: 'Kaos' | 'Kemeja' | 'Jaket' | 'Celana' | 'Baju Koko' | 'Rompi';
  size: 'XS' | 'S' | 'M' | 'L' | 'XL' | 'XXL' | '3XL' | 'Custom';
  panjangBadan: number; // cm
  lebarDada: number; // cm
  panjangLengan: number; // cm
  lebarBahu: number; // cm
  kerungLengan: number; // cm
  toleransi: number; // +/- cm
  markerEfficiencyExpected: number; // e.g. 85%
}

// SOP-06: Pattern register. One pattern can serve several orders (repeat orders).
export interface Pattern {
  id: string; // Kode Pola, e.g. POL-KAOS-001
  productName: string;
  category?: string;
  baseSize: string; // e.g. 'M'
  sizes: string; // e.g. 'S, M, L, XL'
  revision: number;
  orderIds: string[];
  status: 'Draft' | 'Final' | 'Inactive';
  finalizedBy?: string;
  finalizedAt?: string;
  notes?: string;
  user?: string;
  timestamp?: string;
  updatedAt?: string;
}

// 7. SOP-07: Cutting Department
export interface CuttingBatch {
  id: string;
  spkId: string;
  fabricLotId: string;
  fabricName: string;
  color: string;
  layersCount: number; // Jumlah tumpukan kain
  markerLengthMeters: number; // Panjang bentangan kain
  totalFabricUsedMeters: number;
  cuttingYieldPercentage: number; // Realisasi efisiensi
  totalPiecesCut: number;
  defectRemnantsMeters: number;
  cuttingDate: string;
  operatorCutting: string;
  status: 'Spreading' | 'Cutting' | 'Completed';
  notes?: string;
}

// 8. SOP-08: WIP Bundle Ticketing (Barcode & QR)
export interface WIPBundle {
  id: string; // e.g. BND-SPK001-M-01
  spkId: string;
  orderId: string;
  bundleNumber: number;
  size: string;
  quantity: number;
  color: string;
  component: 'Badan Depan/Belakang' | 'Lengan' | 'Kerah/Rib' | 'Full Set';
  currentStage: 'Cutting' | 'Sewing' | 'Obras' | 'Finishing Detail' | 'QC' | 'Packing';
  assignedLine?: string;
  assignedOperator?: string;
  status: 'In Progress' | 'Passed' | 'Repair Needed' | 'Completed';
  scanHistory: {
    stage: string;
    operator: string;
    timestamp: string;
  }[];
}

// 9. SOP-09 & 10: Sewing Assembly & Overlock
export interface SewingDailyLog {
  id: string;
  date: string;
  lineId: string;
  spkId: string;
  operatorId: string;
  operatorName: string;
  operationType: 'Jahit Utama' | 'Obras' | 'Pasang Kerah' | 'Kelim Bawah' | 'Finishing Detail';
  outputPieces: number;
  defectPieces: number;
  spiCompliant: boolean; // Stitches per inch checked
  seamStrengthOk: boolean;
  notes?: string;
}

// 10. SOP-11: Trims & Accessories Station
export interface TrimsVerification {
  id: string;
  spkId: string;
  buttonAttached: boolean;
  zipperFunctional: boolean;
  brandLabelPositionOk: boolean;
  sizeLabelCorrect: boolean;
  careLabelAttached: boolean;
  hangtagAttached: boolean;
  inspectorName: string;
  timestamp: string;
  status: 'Verified' | 'Issues Found';
}

// 11. SOP-12: Quality Control & AQL
export interface QCReport {
  id: string;
  orderId: string;
  spkId?: string;
  product: string;
  inspectionType: '100% Final' | 'AQL 2.5 Sampling';
  totalInspected: number;
  passedQty: number;
  defectsMinor: number;
  defectsMajor: number;
  defectsCritical: number;
  repairable: number;
  nonRepairable: number;
  status: 'Accept' | 'Pending Repair' | 'Reject Lot';
  defectDetails?: string;
  imageUrls?: string;
  inspector: string;
  timestamp?: string;
}

// 12. SOP-13: Ironing, Folding & Packaging
export interface PackagingSlip {
  id: string;
  orderId: string;
  spkId: string;
  boxNumber: number;
  totalBoxes: number;
  itemsInBox: {
    size: string;
    color: string;
    qty: number;
  }[];
  totalQtyInBox: number;
  weightKg: number;
  steamedAndFoldedOk: boolean;
  polybagCleanOk: boolean;
  boxLabelAttached: boolean;
  packedBy: string;
  timestamp: string;
}

// 13. SOP-14: Finished Goods Warehouse
export interface FinishedGoodItem {
  id: string;
  orderId: string;
  customerName: string;
  productName: string;
  totalPcs: number;
  binLocation: string; // e.g. RAK-FG-A1
  readyForShipment: boolean;
  dispatchStagingDate?: string;
  notes?: string;
}

// 14. SOP-15: Customer Returns & RMA
export interface CustomerReturnComplaint {
  id: string; // RMA-001
  orderId: string;
  customerId: string;
  customerName: string;
  contactPhone: string;
  complaintDate: string;
  defectCategory: 'Ukuran Salah' | 'Jahitan Lepas/Cacat' | 'Sablon/Bordir Rusak' | 'Kain Cacat' | 'Aksesoris Kurang';
  defectQty: number;
  description: string;
  customerEvidenceUrls?: string; // photo proof
  rootCauseAnalysis?: string; // 5 Whys
  actionTaken: 'Perbaikan Gratis' | 'Produksi Ulang' | 'Diskon/Credit Note' | 'Ditolak';
  status: 'Submitted' | 'Investigating' | 'In Repair' | 'Resolved';
  assignedTo?: string;
  resolvedAt?: string;
}

// 15. SOP-16: Shipping & Logistics
export interface Shipment {
  id: string; // SJ-001 (Surat Jalan)
  orderId: string;
  customerId: string;
  customerName: string;
  destinationAddress: string;
  courier: string; // JNE, J&T, Cargo, Kurir Internal
  serviceType?: string;
  trackingNumber?: string; // No Resi
  packageWeightKg: number;
  koliCount: number;
  shippingCost: number;
  paidBy: 'Pengirim' | 'Penerima (COD Ongkir)';
  estimatedArrival?: string;
  status: 'Packing' | 'Surat Jalan Dibuat' | 'Picked Up' | 'In Transit' | 'Delivered';
  user?: string;
  timestamp?: string;
}

// 16. SOP-17: Machine Maintenance
export interface Machine {
  id: string; // MCH-001
  name: string;
  brand: string;
  type: 'Jahit Single Needle' | 'Obras 4 Benang' | 'Overdeck' | 'Kansai' | 'Bartek' | 'Lubang Kancing' | 'Pasang Kancing' | 'Setrika Uap' | 'Mesin Potong Tegak';
  serialNumber?: string;
  locationLine: string;
  status: 'Running' | 'Under Maintenance' | 'Broken' | 'Standby';
  lastMaint: string;
  nextScheduledMaint: string;
  health: number; // 0 - 100%
  assignedMechanic?: string;
  maintenanceLog?: {
    date: string;
    issue: string;
    partsReplaced?: string;
    technician: string;
  }[];
}

// 17. SOP-18: K3 & 5S Workplace Safety
export interface SafetyChecklist {
  id: string;
  date: string;
  inspector: string;
  lineArea: string;
  ringkasOk: boolean;
  rapiOk: boolean;
  resikOk: boolean;
  rawatOk: boolean;
  rajinOk: boolean;
  apdMaskerOk: boolean;
  pelindungJarumOk: boolean;
  aparInspectionOk: boolean;
  jalurEvakuasiClear: boolean;
  nearMissDescription?: string;
  correctiveAction?: string;
  status: 'Compliant' | 'Needs Attention';
}

// 18. SOP-19: Operator HR & Borongan Payroll
/*
 * Who did which production task on an SPK, and how many pieces.
 *
 * Payroll used to need the piece count typed in again per operator per period.
 * Recording it where the work happens — on the work order — means the slip can
 * be added up instead of remembered.
 */
export type ProductionTask = 'Cutting' | 'Obras' | 'Jahit' | 'Finishing' | 'QC' | 'Packing';

export const PRODUCTION_TASKS: ProductionTask[] = ['Cutting', 'Obras', 'Jahit', 'Finishing', 'QC', 'Packing'];

export interface WorkAssignment {
  id: string;
  spkId: string;
  orderId?: string;
  productName?: string;
  task: ProductionTask;
  operatorId: string;
  operatorName: string;
  /** Pieces this operator finished on this task. */
  qty: number;
  /*
   * The operator's rate at the moment the work was recorded. Kept on the record
   * so raising someone's rate later never rewrites what past work was worth.
   */
  ratePerPiece: number;
  date: string;
  user?: string;
  timestamp?: string;
}

/*
 * Just the person. Nobody here works one fixed task, and the piece rate is
 * agreed per job, so a position, a grade and a standing rate would only be
 * guesses recorded as facts. Both live on the work record instead.
 */
export interface Operator {
  id: string; // OPR-001
  name: string;
  phone?: string;
  joinDate: string;
  status: 'Active' | 'On Leave' | 'Resigned';
}

export interface BoronganSalarySlip {
  id: string;
  operatorId: string;
  operatorName: string;
  periodStart: string;
  periodEnd: string;
  totalPiecesProduced: number;
  totalPiecesPassedQC: number;
  ratePerPiece: number;
  baseBoronganWage: number;
  attendanceIncentive: number;
  productivityBonus: number;
  deductions: number;
  netPay: number;
  status: 'Draft' | 'Approved' | 'Paid';
  paidAt?: string;
}

// 19. SOP-20: Finance, Invoicing & Payments
export interface Invoice {
  id: string; // INV-2026-001
  orderId: string;
  customerId: string;
  customerName: string;
  amount: number;
  tax?: number;
  total: number;
  downPaymentReceived: number;
  balanceRemaining: number;
  dueDate: string;
  status: 'Belum Bayar' | 'DP Dibayar' | 'Lunas' | 'Jatuh Tempo' | 'Sebagian';
  paymentMethod?: string;
  notes?: string;
  user?: string;
  timestamp?: string;
  // Invoices created automatically from a shipment start as 'Draft' until finance reviews and sends them (SOP-20).
  reviewStatus?: 'Draft' | 'Sent';
  shipmentId?: string;
  sentAt?: string;
  sentBy?: string;
  /** Installments printed on the invoice document. */
  paymentSchedule?: PaymentTerm[];

  /** Revision trail — see Quotation. Payments already received carry over. */
  revision?: number;
  invoiceNo?: string;
  revisionOf?: string;
  revisedBy?: string;
  supersededBy?: string;
  supersededAt?: string;
}

export interface Payment {
  id: string;
  orderId?: string;
  invoiceId?: string;
  customerId?: string;
  customerName: string;
  amount: number;
  type: 'Down Payment' | 'DP' | 'Pelunasan' | 'Cicilan' | 'Custom';
  date: string;
  bankAccount?: string;
  paymentMethod?: string;
  proofImageUrl?: string;
  status: 'Pending Verification' | 'Verified' | 'Pending' | 'Rejected';
  notes?: string;
  user?: string;
  timestamp?: string;
}

// Offline IndexedDB sync tracking
export interface OfflineQueueItem {
  id?: number;
  table: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  payload: any;
  timestamp: string;
  synced: boolean;
}

// =========================================================
// STOREFRONT, PRICING, FLASH SALE, DISCOUNTS & INTEGRATIONS
// =========================================================

export interface WholesaleTier {
  minQty: number;
  maxQty?: number;
  price: number;
  label?: string;
}

export interface StoreProduct {
  id: string;
  sku: string;
  name: string;
  slug: string;
  category: string;
  description: string;
  basePrice: number;
  wholesaleTiers: WholesaleTier[];
  images: string[];
  sizes: string[];
  colors: string[];
  stock: number;
  minOrder: number;
  isAvailable: boolean;
  customSablonAvailable: boolean;
  sablonPriceAddon?: number;
  isFlashSale?: boolean;
  flashSalePrice?: number;
  flashSaleQuota?: number;
  flashSaleSold?: number;
  isDigital?: boolean;
  digiflazzSku?: string;
  rating?: number;
  reviewsCount?: number;
  featured?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface FlashSaleItem {
  productId: string;
  productName: string;
  originalPrice: number;
  flashPrice: number;
  quota: number;
  sold: number;
  discountPercentage: number;
}

export interface StoreFlashSale {
  id: string;
  title: string;
  tagline?: string;
  bannerUrl?: string;
  startTime: string;
  endTime: string;
  isActive: boolean;
  status: 'Upcoming' | 'Active' | 'Ended';
  items: FlashSaleItem[];
  createdAt?: string;
}

export interface StoreDiscountVoucher {
  id: string;
  code: string;
  title: string;
  description?: string;
  type: 'percentage' | 'fixed';
  value: number;
  minSpend: number;
  maxDiscount?: number;
  quota: number;
  usedCount: number;
  validUntil: string;
  isActive: boolean;
  createdAt?: string;
}

export interface ReferralPayout {
  id: string;
  amount: number;
  date: string;
  status: 'Pending' | 'Paid';
  bankInfo: string;
  notes?: string;
}

export interface StoreReferral {
  id: string;
  code: string;
  referrerName: string;
  referrerPhone: string;
  referrerEmail?: string;
  commissionRate: number; // percentage, e.g. 5
  refereeDiscount: number; // percentage, e.g. 5
  totalOrdersCount: number;
  totalOrderAmount: number;
  totalCommissionEarned: number;
  withdrawnCommission: number;
  availableCommission: number;
  status: 'Active' | 'Suspended';
  payoutHistory: ReferralPayout[];
  createdAt?: string;
}

export interface StoreOrderItem {
  productId: string;
  productName: string;
  sku?: string;
  price: number;
  quantity: number;
  size?: string;
  color?: string;
  customNotes?: string;
  subtotal: number;
}

export interface StoreOrder {
  id: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  shippingAddress: string;
  notes?: string;
  items: StoreOrderItem[];
  subtotal: number;
  wholesaleSavings: number;
  voucherCode?: string;
  voucherDiscount: number;
  referralCode?: string;
  referralDiscount: number;
  referralCommission: number;
  totalAmount: number;
  paymentMethod: 'QRIS' | 'VA_BCA' | 'VA_MANDIRI' | 'VA_BNI' | 'VA_BRI' | 'EWALLET_GOPAY' | 'EWALLET_OVO' | 'EWALLET_DANA' | 'TRANSFER_MANUAL';
  paymentStatus: 'Pending' | 'Paid' | 'Expired' | 'Failed';
  paymentRef?: string;
  qrisData?: string;
  vaNumber?: string;
  orderStatus: 'Menunggu Pembayaran' | 'Diproses' | 'Dalam Produksi' | 'Dikirim' | 'Selesai' | 'Dibatalkan';
  linkedOrderId?: string;
  linkedInvoiceId?: string;
  isDigital?: boolean;
  digiflazzTrxId?: string;
  digiflazzSn?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface PaymentGatewayConfig {
  activeGateway: 'built_in_simulator' | 'midtrans' | 'tripay';
  qrisMerchantName: string;
  autoVerifySimulation: boolean;
  midtrans: {
    merchantId: string;
    clientKey: string;
    serverKey: string;
    isProduction: boolean;
  };
  tripay: {
    merchantCode: string;
    apiKey: string;
    privateKey: string;
    isProduction: boolean;
  };
}

export interface DigiflazzConfig {
  username: string;
  apiKey: string;
  webhookSecret: string;
  isProduction: boolean;
  autoMarkupType: 'fixed' | 'percentage';
  autoMarkupValue: number;
}

export interface DigiflazzProduct {
  buyer_sku_code: string;
  product_name: string;
  category: string;
  brand: string;
  type?: string;
  price: number;
  sellingPrice: number;
  buyer_product_status: boolean;
  seller_product_status: boolean;
  unlimited_stock: boolean;
  stock: number;
  desc?: string;
}

export interface DigiflazzTransaction {
  id: string;
  ref_id: string;
  customer_no: string;
  buyer_sku_code: string;
  product_name: string;
  amount: number;
  sellingPrice: number;
  status: 'Pending' | 'Sukses' | 'Gagal';
  message: string;
  sn: string;
  timestamp: string;
}
