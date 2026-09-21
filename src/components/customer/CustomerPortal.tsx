import React, { useState, useEffect, useRef } from 'react';
import {
  CustomerSession,
  Order,
  SPK,
  Design,
  Sample,
  Invoice,
  Shipment,
  CustomerReturnComplaint
} from '../../types';
import {
  fetchCustomerPortalDataApi,
  createResource,
  updateResource,
  uploadMedia
} from '../../services/api';
import {
  formatCurrency,
  formatDate
} from '../../lib/utils';
import { StatusBadge } from '../ui/Badge';
import {
  Package,
  Clock,
  CheckCircle2,
  FileText,
  Upload,
  Truck,
  Palette,
  ShieldAlert,
  LogOut,
  RefreshCw,
  Check,
  ExternalLink,
  History,
  RotateCcw,
  MessageCircle,
  Search,
  Layers,
  TrendingUp,
  Calendar,
  ShoppingBag,
  ArrowRight,
  ArrowLeft,
  Loader2,
  Sparkles
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { COMPANY_CONTACT, getWhatsAppUrl } from '../../config/contact';

interface CustomerPortalProps {
  customer: CustomerSession;
  onLogout: () => void;
  onBackToStaff?: () => void;
}

const fieldClass = 'w-full h-10 px-3 bg-white border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-teal';
const fileClass = 'w-full text-sm text-muted-foreground file:mr-3 file:h-10 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-muted file:text-brand-teal-dark hover:file:bg-accent cursor-pointer';
const labelClass = 'block text-sm font-semibold text-foreground mb-1.5';
const panelFocusClass = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal';

type PortalTab = 'timeline' | 'mockup' | 'invoice' | 'shipping' | 'complaint' | 'history';

export const CustomerPortal: React.FC<CustomerPortalProps> = ({ customer, onLogout, onBackToStaff }) => {
  const [data, setData] = useState<{
    orders: Order[];
    spks: SPK[];
    designs: Design[];
    samples: Sample[];
    invoices: Invoice[];
    shipments: Shipment[];
    returns: CustomerReturnComplaint[];
  }>({
    orders: [],
    spks: [],
    designs: [],
    samples: [],
    invoices: [],
    shipments: [],
    returns: []
  });

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<PortalTab>('timeline');
  const tabRefs = useRef<Partial<Record<PortalTab, HTMLButtonElement | null>>>({});
  const [historySearch, setHistorySearch] = useState('');
  const [historyFilter, setHistoryFilter] = useState<'ALL' | 'ACTIVE' | 'COMPLETED'>('ALL');

  // Complaint form state
  const [complaintCategory, setComplaintCategory] = useState<any>('Jahitan Lepas/Cacat');
  const [complaintQty, setComplaintQty] = useState(1);
  const [complaintDesc, setComplaintDesc] = useState('');
  const [complaintUploading, setComplaintUploading] = useState(false);
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [complaintSubmitted, setComplaintSubmitted] = useState(false);

  // Payment upload state
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paymentProofUrl, setPaymentProofUrl] = useState<string>('');
  const [paymentUploading, setPaymentUploading] = useState(false);
  const [paymentSubmitted, setPaymentSubmitted] = useState(false);

  const loadData = async () => {
    try {
      setRefreshing(true);
      const res = await fetchCustomerPortalDataApi(customer.id);
      setData(res);
      if (res.orders.length > 0 && !selectedOrderId) {
        setSelectedOrderId(customer.selectedOrderId || res.orders[0].id);
      }
    } catch (err) {
      console.error('Failed to load customer data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [customer.id]);

  const activeOrder = data.orders.find(o => o.id === selectedOrderId) || data.orders[0];
  const activeSpk = data.spks.find(s => s.orderId === activeOrder?.id);
  const activeInvoice = data.invoices.find(i => i.orderId === activeOrder?.id);
  const activeShipment = data.shipments.find(s => s.orderId === activeOrder?.id);
  const activeDesign = data.designs.find(d => d.orderId === activeOrder?.id || d.customerId === customer.id);
  const activeSample = data.samples.find(s => s.orderId === activeOrder?.id);

  // Next steps for an approved order that is still waiting for its SPK (customer-relevant items only)
  const awaitingProduction = !!activeOrder && !activeSpk && activeOrder.status === 'Order';
  const dpRequired = Number(activeOrder?.dpRequired) || 0;
  const dpPaid = Number(activeOrder?.downPayment) || 0;
  const hasSpecialTerms = !!activeOrder?.specialTermsApprovedBy;
  const showDpStep = dpRequired > 0 || hasSpecialTerms;
  const dpDone = hasSpecialTerms || dpRequired <= 0 || dpPaid >= dpRequired;
  const orderSamples = data.samples.filter(s => s.orderId === activeOrder?.id);
  const sampleDone = orderSamples.some(s => s.status === 'Approved') || !!activeOrder?.sampleWaivedBy;
  const sampleSent = orderSamples.some(s => s.status === 'Sent to Customer');
  // Overall customer history metrics
  const totalOrdersCount = data.orders.length;
  const totalPcsProduced = data.orders.reduce((acc, o) => acc + (Number(o.quantity) || 0), 0);
  const totalLtvSpend = data.orders.reduce((acc, o) => acc + (Number(o.totalPrice) || 0), 0);
  const completedOrdersCount = data.orders.filter(o => o.status === 'Completed').length;
  const inProgressOrdersCount = data.orders.filter(o => o.status !== 'Completed').length;

  const filteredHistoryOrders = data.orders.filter(order => {
    const query = historySearch.toLowerCase().trim();
    const matchesSearch = !query ||
      (order.po || order.id).toLowerCase().includes(query) ||
      (order.productType || '').toLowerCase().includes(query) ||
      (order.material || '').toLowerCase().includes(query) ||
      (order.color || '').toLowerCase().includes(query);

    if (!matchesSearch) return false;
    if (historyFilter === 'ACTIVE') return order.status !== 'Completed';
    if (historyFilter === 'COMPLETED') return order.status === 'Completed';
    return true;
  });

  const createRepeatOrderWaUrl = (order: Order) => {
    const text = 
`Halo Admin HIJ Konveksi!
Saya ingin mengajukan *REPEAT ORDER* untuk akun:
*${customer.name}* ${customer.company ? `(${customer.company})` : ''}

*Referensi Pesanan Sebelumnya:*
• Nomor PO: ${order.po || order.id}
• Artikel / Produk: ${order.productType}
• Bahan: ${order.material || '-'}
• Warna: ${order.color || '-'}
• Jumlah Sebelumnya: ${order.quantity || 0} Pcs
• Nilai Pesanan Sebelumnya: ${formatCurrency(order.totalPrice)}

*Rencana Repeat Order:*
• Estimasi Jumlah Baru: ${order.quantity || 0} Pcs (dapat disesuaikan)
• Ukuran / Warna: (Sama seperti sebelumnya / Ada variasi baru)

Mohon informasi ketersediaan slot antrean produksi dan penawaran invoice terbarunya. Terima kasih!`;

    return getWhatsAppUrl(text);
  };

  // Compute production progress percentage
  const getProgressPercentage = () => {
    if (!activeSpk) {
      if (activeOrder?.status === 'Completed') return 100;
      return 15;
    }
    return activeSpk.progress || 20;
  };

  const handleApproveDesign = async () => {
    if (!activeDesign) return;
    try {
      await updateResource('designs', activeDesign.id, {
        status: 'Approved',
        approvedBy: customer.name,
        approvedAt: new Date().toISOString()
      });
      confetti({ particleCount: 60, spread: 70, origin: { y: 0.6 } });
      loadData();
    } catch (err) {
      alert('Gagal menyetujui desain. Coba lagi.');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'complaint' | 'payment') => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (type === 'complaint') setComplaintUploading(true);
    if (type === 'payment') setPaymentUploading(true);

    try {
      const url = await uploadMedia(file);
      if (type === 'complaint') setEvidenceUrl(url);
      if (type === 'payment') setPaymentProofUrl(url);
    } catch (err) {
      alert('Gagal mengunggah foto. Gunakan file JPG, PNG, atau WebP.');
    } finally {
      if (type === 'complaint') setComplaintUploading(false);
      if (type === 'payment') setPaymentUploading(false);
    }
  };

  const handleSubmitComplaint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!complaintDesc.trim()) {
      alert('Tuliskan rincian masalahnya terlebih dahulu.');
      return;
    }

    try {
      await createResource('returns_complaints', {
        id: `RMA-${Date.now().toString().slice(-5)}`,
        orderId: activeOrder?.id || 'ORD-GEN',
        customerId: customer.id,
        customerName: customer.name,
        contactPhone: customer.contact || customer.phone || '-',
        complaintDate: new Date().toISOString().split('T')[0],
        defectCategory: complaintCategory,
        defectQty: complaintQty,
        description: complaintDesc,
        customerEvidenceUrls: evidenceUrl,
        actionTaken: 'Perbaikan Gratis',
        status: 'Submitted'
      });
      setComplaintSubmitted(true);
      setComplaintDesc('');
      setEvidenceUrl('');
      loadData();
    } catch (err) {
      alert('Gagal mengirim keluhan. Coba lagi.');
    }
  };

  const handleSubmitPaymentProof = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentProofUrl) {
      alert('Unggah foto bukti transfer terlebih dahulu.');
      return;
    }

    try {
      await createResource('payments', {
        id: `PAY-${Date.now().toString().slice(-5)}`,
        orderId: activeOrder?.id || 'ORD-GEN',
        invoiceId: activeInvoice?.id,
        customerId: customer.id,
        customerName: customer.name,
        amount: paymentAmount || activeInvoice?.balanceRemaining || 1000000,
        type: activeInvoice?.status === 'DP Dibayar' ? 'Pelunasan' : 'Down Payment',
        date: new Date().toISOString().split('T')[0],
        bankAccount: 'BCA / Mandiri HIJ',
        proofImageUrl: paymentProofUrl,
        status: 'Pending Verification'
      });
      setPaymentSubmitted(true);
      setPaymentProofUrl('');
      loadData();
    } catch (err) {
      alert('Gagal mengirim bukti pembayaran. Coba lagi.');
    }
  };

  const productionStages = [
    { label: 'Pesanan Diterima', desc: 'Pesanan tercatat', completed: true },
    { label: 'Desain & Sampel', desc: 'Desain dan sampel disetujui', completed: activeSample?.status === 'Approved' || !!activeOrder?.sampleWaivedBy || activeDesign?.status === 'Approved' || getProgressPercentage() > 20 },
    { label: 'Pemotongan', desc: 'Kain dipotong', completed: getProgressPercentage() >= 30 },
    { label: 'Penjahitan', desc: 'Dijahit dan diobras', completed: getProgressPercentage() >= 65 },
    { label: 'Cek Kualitas', desc: 'Diperiksa dan dirapikan', completed: getProgressPercentage() >= 85 },
    { label: 'Dikemas & Dikirim', desc: 'Disetrika, dikemas, dikirim', completed: getProgressPercentage() === 100 || activeOrder?.status === 'Completed' }
  ];

  const portalTabs: { id: PortalTab; label: string; icon: React.ElementType }[] = [
    { id: 'timeline', label: 'Rincian Pesanan', icon: Package },
    { id: 'mockup', label: 'Desain', icon: Palette },
    { id: 'invoice', label: 'Pembayaran', icon: FileText },
    { id: 'shipping', label: 'Pengiriman', icon: Truck },
    { id: 'complaint', label: 'Garansi & Keluhan', icon: ShieldAlert },
    { id: 'history', label: `Riwayat Semua Pesanan (${data.orders.length})`, icon: History }
  ];

  // Roving focus for the tablist: arrow keys / Home / End move between tabs
  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = -1;
    if (e.key === 'ArrowRight') next = (index + 1) % portalTabs.length;
    else if (e.key === 'ArrowLeft') next = (index - 1 + portalTabs.length) % portalTabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = portalTabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const nextId = portalTabs[next].id;
    setActiveTab(nextId);
    tabRefs.current[nextId]?.focus();
  };

  const panelProps = (id: PortalTab) => ({
    role: 'tabpanel' as const,
    id: `portal-panel-${id}`,
    'aria-labelledby': `portal-tab-${id}`,
    tabIndex: 0
  });

  const hasOrders = data.orders.length > 0;

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans text-foreground pb-16">
      {/* STICKY CHROME: staff preview banner + portal header stack together so they never overlap */}
      <div className="sticky top-0 z-30">
        {/* STAFF PREVIEW BANNER (IF OPENED BY STAFF) */}
        {onBackToStaff && (
          <div className="bg-brand-teal-dark text-white px-4 py-2 text-xs flex items-center justify-between gap-3 shadow-xs border-b border-brand-teal/30">
            <div className="flex items-center gap-2 min-w-0">
              <span className="shrink-0 px-2 py-0.5 rounded-full bg-white/20 text-white font-bold uppercase tracking-wider text-[10px] border border-white/30">
                Mode Pratinjau
              </span>
              <span className="hidden sm:inline min-w-0">Anda sedang melihat tampilan portal pelanggan <strong>{customer.name}</strong> sebagai staf operasional.</span>
            </div>
            <button
              type="button"
              onClick={onBackToStaff}
              className="h-10 px-3 bg-white/15 hover:bg-white/25 text-white font-bold rounded-lg transition-colors inline-flex items-center gap-1.5 cursor-pointer text-xs shrink-0 whitespace-nowrap"
            >
              <ArrowLeft size={14} aria-hidden="true" />
              Kembali ke ERP Staf
            </button>
          </div>
        )}

        {/* HEADER */}
        <header className="bg-card border-b border-border shadow-xs">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-2 sm:gap-3">
            <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
              <img src="/logo.png" alt="Logo HIJ" width={40} height={40} className="w-10 h-10 object-contain rounded-xl border border-border p-1 shrink-0" />
              <div className="min-w-0">
                <h1 className="text-base sm:text-lg font-bold text-foreground truncate">Portal Pelanggan</h1>
                <p className="text-sm text-muted-foreground truncate">
                  Halo, <span className="text-foreground font-semibold">{customer.name}</span>
                  {customer.company && ` · ${customer.company}`}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 sm:gap-2 shrink-0">
              <a
                href={getWhatsAppUrl(`Halo CS HIJ Konveksi, saya ${customer.name} ingin menanyakan info atau bantuan pesanan saya.`)}
                target="_blank"
                rel="noopener noreferrer"
                className="h-10 min-w-10 px-2.5 sm:px-3 text-xs sm:text-sm font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-xl transition-colors flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
                title={`Hubungi CS WhatsApp (${COMPANY_CONTACT.whatsappFormatted})`}
              >
                <MessageCircle size={16} className="text-emerald-600 shrink-0" aria-hidden="true" />
                <span className="sr-only sm:not-sr-only">CS WA:</span>
                <span className="sr-only sm:not-sr-only font-mono font-bold text-emerald-900 whitespace-nowrap">{COMPANY_CONTACT.whatsappDisplay}</span>
              </a>

              <button
                type="button"
                onClick={loadData}
                disabled={refreshing}
                title="Muat ulang data"
                aria-label="Muat ulang data"
                className="size-10 inline-flex items-center justify-center text-muted-foreground hover:text-brand-teal-dark hover:bg-muted rounded-lg transition-colors cursor-pointer disabled:cursor-wait"
              >
                <RefreshCw size={18} aria-hidden="true" className={refreshing ? 'animate-spin text-brand-teal-dark' : ''} />
              </button>

              {onBackToStaff ? (
                // On phones the preview banner above already carries this action
                <button
                  type="button"
                  onClick={onBackToStaff}
                  className="hidden sm:flex h-10 px-3.5 text-sm font-semibold text-brand-teal-dark bg-muted hover:bg-accent rounded-lg transition-colors items-center gap-1.5 border border-border cursor-pointer"
                >
                  Kembali ke ERP
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onLogout}
                  title="Keluar"
                  className="h-10 min-w-10 px-2.5 sm:px-3.5 text-sm font-semibold text-slate-700 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors flex items-center justify-center gap-1.5 border border-slate-200 cursor-pointer"
                >
                  <LogOut size={16} className="shrink-0" aria-hidden="true" />
                  <span className="sr-only sm:not-sr-only">Keluar</span>
                </button>
              )}
            </div>
          </div>
        </header>
      </div>

      {/* MAIN CONTAINER */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 w-full space-y-6 flex-1">
        {loading && (
          <div
            role="status"
            className="bg-white rounded-3xl p-10 border border-slate-100 shadow-xs flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground"
          >
            <Loader2 size={24} className="animate-spin text-brand-teal-dark" aria-hidden="true" />
            Memuat data pesanan…
          </div>
        )}

        {!loading && !hasOrders && (
          <div className="bg-white rounded-3xl p-10 border border-slate-100 shadow-xs text-center space-y-2">
            <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center mx-auto">
              <Package size={20} aria-hidden="true" />
            </div>
            <h2 className="text-base font-bold text-slate-900">Belum ada pesanan</h2>
            <p className="text-sm text-slate-600 max-w-sm mx-auto">
              Pesanan Anda akan tampil di sini setelah dicatat oleh tim kami.
            </p>
          </div>
        )}

        {!loading && hasOrders && (
          <>
            {/* ORDER SELECTOR PILLS */}
            {data.orders.length > 1 && (
              <div
                role="group"
                aria-labelledby="portal-order-picker-label"
                className="bg-white p-4 rounded-3xl border border-slate-200/80 shadow-xs space-y-2.5"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <History size={16} className="text-teal-700 shrink-0" />
                    <span id="portal-order-picker-label" className="text-xs font-bold uppercase tracking-wider text-slate-700">
                      Histori Pesanan ({data.orders.length} Pesanan Tercatat)
                    </span>
                  </div>
                  <span className="text-xs text-slate-400 hidden sm:inline">Klik untuk melihat detail atau progres pesanan lain</span>
                </div>
                <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
                  {data.orders.map(order => {
                    const isCompleted = order.status === 'Completed';
                    const isSelected = order.id === activeOrder?.id;
                    return (
                      <button
                        key={order.id}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => setSelectedOrderId(order.id)}
                        className={`min-h-10 px-3.5 py-2.5 rounded-2xl text-xs font-semibold transition-all flex items-center gap-2 flex-shrink-0 cursor-pointer ${
                          isSelected
                            ? 'bg-teal-700 text-white shadow-md shadow-teal-700/20'
                            : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200'
                        }`}
                      >
                        <span className="font-bold font-mono">{order.po || order.id}</span>
                        <span className="opacity-85 truncate max-w-[140px] font-normal">{order.productType}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${
                          isSelected
                            ? 'bg-white/20 text-white'
                            : isCompleted
                            ? 'bg-brand-teal-dark text-white border border-brand-teal-dark'
                            : 'bg-teal-50 text-brand-teal-dark border border-teal-200'
                        }`}>
                          {isCompleted ? 'Selesai' : order.status || 'Aktif'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* NEXT STEPS: order approved, production not scheduled yet */}
            {awaitingProduction && (
              <section
                aria-labelledby="next-steps-title"
                className="bg-white rounded-3xl p-5 sm:p-6 shadow-xs border border-teal-200 space-y-4"
              >
                <h2 id="next-steps-title" className="text-base font-bold text-slate-900">Langkah Berikutnya</h2>

                <ul className="space-y-3">
                  {showDpStep && (
                    <li className="flex items-start gap-3">
                      {dpDone
                        ? <CheckCircle2 size={20} className="text-brand-teal shrink-0 mt-0.5" />
                        : <Clock size={20} className="text-brand-teal-dark shrink-0 mt-0.5" />}
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900">
                          {hasSpecialTerms
                            ? 'Pembayaran sesuai termin yang disepakati'
                            : dpDone
                              ? 'DP diterima'
                              : `Bayar DP ${formatCurrency(dpRequired - dpPaid)}`}
                        </p>
                        {!dpDone && (
                          <p className="text-sm text-slate-600 mt-0.5">
                            Transfer lalu kirim buktinya di tab{' '}
                            <button
                              type="button"
                              onClick={() => setActiveTab('invoice')}
                              className="font-semibold text-teal-700 underline underline-offset-2 hover:text-teal-800"
                            >
                              Pembayaran
                            </button>.
                          </p>
                        )}
                      </div>
                    </li>
                  )}

                  <li className="flex items-start gap-3">
                    {sampleDone
                      ? <CheckCircle2 size={20} className="text-brand-teal shrink-0 mt-0.5" />
                      : <Clock size={20} className="text-brand-teal-dark shrink-0 mt-0.5" />}
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">
                        {sampleDone ? 'Sampel disetujui' : sampleSent ? 'Periksa dan setujui sampel' : 'Sampel sedang dibuat'}
                      </p>
                      {!sampleDone && (
                        <p className="text-sm text-slate-600 mt-0.5">
                          {sampleSent
                            ? 'Kabari admin kami jika sampel sudah sesuai.'
                            : 'Kami kabari saat sampel siap diperiksa.'}
                        </p>
                      )}
                    </div>
                  </li>
                </ul>

                {dpDone && sampleDone && (
                  <p className="text-sm font-medium text-teal-800 pt-3 border-t border-slate-100">
                    Pesanan sedang dijadwalkan untuk produksi.
                  </p>
                )}
              </section>
            )}

            {/* HERO ORDER CARD */}
            <div className="bg-white rounded-3xl p-5 sm:p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-5 pb-6 border-b border-slate-100">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1.5">
                    <span className="text-sm font-semibold text-teal-700 font-mono">{activeOrder?.po || activeOrder?.id}</span>
                    <StatusBadge status={activeOrder?.status || 'In Production'} />
                  </div>
                  <h2 className="text-xl sm:text-2xl font-bold text-slate-900 break-words">{activeOrder?.productType}</h2>
                  <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-500 mt-2">
                    <span>Jumlah <span className="text-slate-800 font-semibold">{activeOrder?.quantity || 0} Pcs</span></span>
                    <span>Bahan <span className="text-slate-800 font-semibold">{activeOrder?.material || '-'}</span></span>
                    <span>Deadline <span className="text-slate-800 font-semibold">{formatDate(activeOrder?.deadline)}</span></span>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
                  <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 flex items-center gap-5">
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">Total Pesanan</p>
                      <p className="text-lg font-bold text-foreground whitespace-nowrap tabular-nums">{formatCurrency(activeOrder?.totalPrice)}</p>
                    </div>
                    <div className="w-px h-10 bg-border shrink-0" aria-hidden="true" />
                    <div className="shrink-0">
                      <p className="text-xs text-muted-foreground">Progres</p>
                      <p className="text-lg font-bold text-brand-teal-dark tabular-nums">{getProgressPercentage()}%</p>
                    </div>
                  </div>

                  <a
                    href={getWhatsAppUrl(
                      `Halo Admin HIJ Konveksi, saya ingin konsultasi Repeat Order untuk akun ${customer.name}.\nBerdasarkan pesanan sebelumnya:\n- No. PO: ${activeOrder?.po || activeOrder?.id}\n- Produk: ${activeOrder?.productType}\n- Bahan: ${activeOrder?.material || '-'}\nMohon informasi ketersediaan slot produksi dan penawarannya. Terima kasih!`
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-bold text-xs shadow-sm transition-colors shrink-0"
                    title={`Hubungi Admin WA (${COMPANY_CONTACT.whatsappFormatted}) untuk pesan kembali dengan spesifikasi ini`}
                  >
                    <RotateCcw size={15} aria-hidden="true" />
                    <span>Repeat Order via WA</span>
                  </a>
                </div>
              </div>

              {/* PROGRESS BAR */}
              <div className="pt-6">
                <div
                  role="progressbar"
                  aria-label="Progres produksi"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={getProgressPercentage()}
                  aria-valuetext={`${getProgressPercentage()}%`}
                  className="w-full bg-muted h-3 rounded-full overflow-hidden mb-6 relative"
                >
                  <div
                    className="bg-gradient-to-r from-brand-teal to-brand-teal-dark h-full rounded-full transition-all duration-700 ease-out"
                    style={{ width: `${getProgressPercentage()}%` }}
                  />
                </div>

                {/* STAGES TIMELINE GRID */}
                <ol aria-label="Tahapan produksi" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {productionStages.map((stage, idx) => (
                    <li
                      key={idx}
                      className={`p-4 rounded-2xl border transition-all ${
                        stage.completed
                          ? 'bg-muted border-border text-brand-teal-dark'
                          : 'bg-muted/40 border-border/60 text-muted-foreground'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        {stage.completed ? (
                          <CheckCircle2 size={18} className="text-brand-teal-dark shrink-0" aria-hidden="true" />
                        ) : (
                          <Clock size={18} className="text-muted-foreground/60 shrink-0" aria-hidden="true" />
                        )}
                        <span className="text-sm font-semibold">
                          <span className="sr-only">{stage.completed ? 'Selesai: ' : 'Belum selesai: '}</span>
                          {stage.label}
                        </span>
                      </div>
                      <p className="text-sm opacity-80 pl-[26px]">{stage.desc}</p>
                    </li>
                  ))}
                </ol>
              </div>
            </div>

            {/* TABS NAVIGATION */}
            <div
              role="tablist"
              aria-label="Informasi pesanan"
              className="flex items-center gap-1 border-b border-border overflow-x-auto no-scrollbar"
            >
              {portalTabs.map((tab, index) => {
                const Icon = tab.icon;
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    ref={(el) => { tabRefs.current[tab.id] = el; }}
                    type="button"
                    role="tab"
                    id={`portal-tab-${tab.id}`}
                    aria-selected={active}
                    aria-controls={`portal-panel-${tab.id}`}
                    tabIndex={active ? 0 : -1}
                    onClick={() => setActiveTab(tab.id)}
                    onKeyDown={(e) => handleTabKeyDown(e, index)}
                    className={`h-11 px-3.5 text-sm font-semibold border-b-2 transition-all flex items-center gap-2 flex-shrink-0 whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-teal ${
                      active
                        ? 'border-brand-teal-dark text-brand-teal-dark'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Icon size={16} aria-hidden="true" />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* TAB 1: ORDER DETAILS */}
            {activeTab === 'timeline' && (
              <div {...panelProps('timeline')} className={`grid grid-cols-1 md:grid-cols-2 gap-6 rounded-3xl ${panelFocusClass}`}>
                <div className="bg-white rounded-3xl p-5 sm:p-6 shadow-xs border border-slate-100 space-y-4">
                  <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <Package size={18} className="text-teal-600" />
                    Spesifikasi Produk
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="p-3.5 bg-slate-50 rounded-xl">
                      <p className="text-xs text-slate-500">Produk</p>
                      <p className="text-sm font-semibold text-slate-900 mt-0.5 break-words">{activeOrder?.productType}</p>
                    </div>
                    <div className="p-3.5 bg-slate-50 rounded-xl">
                      <p className="text-xs text-slate-500">Bahan Utama</p>
                      <p className="text-sm font-semibold text-slate-900 mt-0.5 break-words">{activeOrder?.material || '-'}</p>
                    </div>
                    <div className="p-3.5 bg-slate-50 rounded-xl">
                      <p className="text-xs text-slate-500">Warna</p>
                      <p className="text-sm font-semibold text-slate-900 mt-0.5 break-words">{activeOrder?.color || '-'}</p>
                    </div>
                    <div className="p-3.5 bg-slate-50 rounded-xl">
                      <p className="text-xs text-slate-500">Aksesoris</p>
                      <p className="text-sm font-semibold text-slate-900 mt-0.5 break-words">{activeOrder?.accessories || '-'}</p>
                    </div>
                  </div>

                  {activeOrder?.notes && (
                    <div className="p-3.5 bg-teal-50/60 border border-teal-200 rounded-xl text-sm text-brand-teal-dark">
                      <span className="font-semibold block mb-1">Catatan</span>
                      {activeOrder.notes}
                    </div>
                  )}
                </div>

                {/* SIZE BREAKDOWN */}
                <div className="bg-white rounded-3xl p-5 sm:p-6 shadow-xs border border-slate-100 space-y-4">
                  <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <FileText size={18} className="text-teal-600" />
                    Rincian Ukuran
                  </h3>
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">
                    {activeOrder?.size || 'Belum ada rincian ukuran.'}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: MOCKUP & DESIGN APPROVAL */}
            {activeTab === 'mockup' && (
              <div {...panelProps('mockup')} className={`bg-white rounded-3xl p-5 sm:p-8 shadow-xs border border-slate-100 space-y-6 ${panelFocusClass}`}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">Persetujuan Desain</h3>
                    <p className="text-sm text-slate-500 mt-0.5">
                      Periksa desain sebelum produksi dimulai.
                    </p>
                  </div>

                  {activeDesign?.status === 'Approved' ? (
                    <div className="px-4 py-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-sm font-semibold flex items-center gap-2">
                      <CheckCircle2 size={18} aria-hidden="true" />
                      Desain Disetujui
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={handleApproveDesign}
                      className="h-11 px-5 bg-teal-600 hover:bg-teal-800 text-white font-semibold rounded-xl text-sm shadow-md transition-colors flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Check size={18} aria-hidden="true" />
                      Setujui Desain
                    </button>
                  )}
                </div>

                {/* MOCKUP VIEWER */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <figure className="border border-slate-200 rounded-2xl p-4 flex flex-col items-center bg-slate-50">
                    <figcaption className="text-sm font-medium text-slate-600 mb-3">Tampak Depan</figcaption>
                    <div className="w-full h-72 bg-white rounded-xl border border-slate-200 flex items-center justify-center overflow-hidden">
                      <img
                        src={activeDesign?.mockupFront || activeSpk?.mockupDepan || '/logo.png'}
                        alt={activeDesign?.mockupFront || activeSpk?.mockupDepan ? 'Desain tampak depan' : 'Desain tampak depan belum tersedia'}
                        loading="lazy"
                        decoding="async"
                        className="max-h-full max-w-full object-contain p-4"
                      />
                    </div>
                  </figure>

                  <figure className="border border-slate-200 rounded-2xl p-4 flex flex-col items-center bg-slate-50">
                    <figcaption className="text-sm font-medium text-slate-600 mb-3">Tampak Belakang</figcaption>
                    <div className="w-full h-72 bg-white rounded-xl border border-slate-200 flex items-center justify-center overflow-hidden">
                      <img
                        src={activeDesign?.mockupBack || activeSpk?.mockupBelakang || '/logo.png'}
                        alt={activeDesign?.mockupBack || activeSpk?.mockupBelakang ? 'Desain tampak belakang' : 'Desain tampak belakang belum tersedia'}
                        loading="lazy"
                        decoding="async"
                        className="max-h-full max-w-full object-contain p-4"
                      />
                    </div>
                  </figure>
                </div>
              </div>
            )}

            {/* TAB 3: INVOICE & PAYMENT */}
            {activeTab === 'invoice' && (
              <div {...panelProps('invoice')} className={`grid grid-cols-1 md:grid-cols-12 gap-6 rounded-3xl ${panelFocusClass}`}>
                {/* INVOICE CARD */}
                <div className="md:col-span-7 bg-white rounded-3xl p-5 sm:p-8 shadow-xs border border-slate-100 space-y-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <span className="text-sm text-slate-500">Faktur</span>
                      <h3 className="text-xl font-bold text-slate-900 font-mono break-words">{activeInvoice?.id || 'Belum terbit'}</h3>
                    </div>
                    <StatusBadge status={activeInvoice?.status || 'Belum Lunas'} />
                  </div>

                  <div className="p-4 bg-slate-50 rounded-2xl space-y-3 text-sm tabular-nums">
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-600">Nilai Pesanan</span>
                      <span className="font-semibold text-slate-900 whitespace-nowrap">{formatCurrency(activeInvoice?.amount || activeOrder?.totalPrice)}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-600">DP Diterima</span>
                      <span className="font-semibold text-emerald-700 whitespace-nowrap">
                        -{formatCurrency(activeInvoice?.downPaymentReceived || activeOrder?.downPayment || 0)}
                      </span>
                    </div>
                    <div className="pt-3 border-t border-slate-200 flex justify-between gap-3 text-base">
                      <span className="font-bold text-slate-900">Sisa Tagihan</span>
                      <span className="font-bold text-rose-700 whitespace-nowrap">
                        {formatCurrency(activeInvoice?.balanceRemaining || ((activeOrder?.totalPrice || 0) - (activeOrder?.downPayment || 0)))}
                      </span>
                    </div>
                  </div>

                  {/* PAYMENT ACCOUNT INFO */}
                  <div className="p-4 bg-teal-50/50 border border-teal-100 rounded-2xl text-sm space-y-3">
                    <p className="font-semibold text-teal-900">Transfer ke rekening berikut:</p>
                    <div className="bg-white p-4 rounded-xl border border-teal-200/60 space-y-2">
                      <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5">
                        <span className="text-slate-600">BCA</span>
                        <span className="font-mono font-semibold text-slate-900 whitespace-nowrap">829-082-1199</span>
                      </div>
                      <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5">
                        <span className="text-slate-600">Mandiri</span>
                        <span className="font-mono font-semibold text-slate-900 whitespace-nowrap">137-00-1928371-2</span>
                      </div>
                      <p className="pt-2 border-t border-slate-100 text-slate-600">
                        Atas nama <span className="font-semibold text-slate-900">PT Hasil Inti Jualan</span>
                      </p>
                      <div className="pt-2.5 border-t border-teal-100 flex flex-wrap items-center justify-between gap-x-2 text-xs">
                        <span className="text-teal-800">Butuh konfirmasi instan atau invoice manual?</span>
                        <a
                          href={getWhatsAppUrl(`Halo CS HIJ, saya ingin konfirmasi pembayaran untuk PO ${activeOrder?.po || activeOrder?.id || '-'} (${activeOrder?.productType || 'Pesanan'}). Mohon verifikasinya.`)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="min-h-10 inline-flex items-center gap-1 font-semibold text-teal-700 hover:text-teal-900 hover:underline whitespace-nowrap"
                        >
                          <MessageCircle size={14} className="text-teal-600" aria-hidden="true" />
                          WA CS: {COMPANY_CONTACT.whatsappFormatted}
                        </a>
                      </div>
                    </div>
                  </div>
                </div>

                {/* UPLOAD PAYMENT RECEIPT */}
                <div className="md:col-span-5 bg-white rounded-3xl p-5 sm:p-8 shadow-xs border border-slate-100 space-y-5">
                  <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <Upload size={18} className="text-teal-600" aria-hidden="true" />
                    Kirim Bukti Pembayaran
                  </h3>

                  {paymentSubmitted ? (
                    <div role="status" className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-800 flex items-start gap-2">
                      <CheckCircle2 size={18} className="shrink-0 mt-0.5" aria-hidden="true" />
                      <span>Bukti transfer terkirim. Tim keuangan kami akan memeriksanya.</span>
                    </div>
                  ) : (
                    <form onSubmit={handleSubmitPaymentProof} className="space-y-5">
                      <div>
                        <label htmlFor="payment-amount" className={labelClass}>Jumlah Transfer (Rp)</label>
                        <input
                          id="payment-amount"
                          type="number"
                          inputMode="numeric"
                          value={paymentAmount || ''}
                          onChange={(e) => setPaymentAmount(Number(e.target.value))}
                          placeholder="Contoh: 4000000"
                          className={`${fieldClass} font-mono`}
                        />
                      </div>

                      <div>
                        <label htmlFor="payment-proof" className={labelClass}>Foto Bukti Transfer</label>
                        <input
                          id="payment-proof"
                          type="file"
                          accept="image/*"
                          onChange={(e) => handleFileUpload(e, 'payment')}
                          aria-describedby="payment-proof-status"
                          className={fileClass}
                        />
                        <div id="payment-proof-status" aria-live="polite">
                          {paymentUploading && <p className="text-sm text-teal-700 mt-1.5">Mengunggah…</p>}
                          {paymentProofUrl && (
                            <p className="text-sm text-emerald-700 mt-1.5 flex items-center gap-1.5">
                              <CheckCircle2 size={16} aria-hidden="true" /> Foto siap dikirim
                            </p>
                          )}
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={!paymentProofUrl || paymentUploading}
                        className="w-full h-11 bg-teal-600 text-white font-semibold rounded-xl hover:bg-teal-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed text-sm cursor-pointer"
                      >
                        Kirim Bukti
                      </button>
                    </form>
                  )}
                </div>
              </div>
            )}

            {/* TAB 4: SHIPPING */}
            {activeTab === 'shipping' && (
              <div {...panelProps('shipping')} className={`bg-white rounded-3xl p-5 sm:p-8 shadow-xs border border-slate-100 space-y-6 ${panelFocusClass}`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-lg font-bold text-slate-900">Pengiriman</h3>
                  <StatusBadge status={activeShipment?.status || 'Packing'} />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div className="p-4 bg-slate-50 rounded-2xl min-w-0">
                    <p className="text-xs text-slate-500">Kurir</p>
                    <p className="text-sm font-semibold text-slate-900 mt-1 break-words">{activeShipment?.courier || 'Belum ditentukan'}</p>
                  </div>

                  <div className="p-4 bg-slate-50 rounded-2xl min-w-0">
                    <p className="text-xs text-slate-500">Nomor Resi</p>
                    {activeShipment?.trackingNumber ? (
                      <p className="text-sm font-mono font-semibold text-teal-700 mt-1 break-words">{activeShipment.trackingNumber}</p>
                    ) : (
                      <p className="text-sm text-slate-600 mt-1">Belum tersedia</p>
                    )}
                  </div>

                  <div className="p-4 bg-slate-50 rounded-2xl sm:col-span-2 lg:col-span-1 min-w-0">
                    <p className="text-xs text-slate-500">Alamat Pengiriman</p>
                    <p className="text-sm text-slate-800 mt-1 break-words">{activeShipment?.destinationAddress || customer.address || '-'}</p>
                  </div>
                </div>

                {activeShipment?.trackingNumber && (
                  <a
                    href={`https://cekresi.com/?noresi=${activeShipment.trackingNumber}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 h-10 px-4 bg-teal-600 text-white rounded-lg text-sm font-semibold hover:bg-teal-700 transition-colors shadow-sm"
                  >
                    <ExternalLink size={16} aria-hidden="true" />
                    Lacak Resi
                  </a>
                )}
              </div>
            )}

            {/* TAB 5: COMPLAINT */}
            {activeTab === 'complaint' && (
              <div {...panelProps('complaint')} className={`bg-white rounded-3xl p-5 sm:p-8 shadow-xs border border-slate-100 space-y-6 ${panelFocusClass}`}>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Garansi & Keluhan</h3>
                  <p className="text-sm text-slate-500 mt-0.5">
                    Jahitan cacat, ukuran salah, atau sablon rusak? Kami perbaiki atau ganti tanpa biaya.
                  </p>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3 p-3.5 bg-rose-50 border border-brand-red/30 rounded-2xl text-xs text-brand-red-cta">
                    <div className="flex items-center gap-2 min-w-0">
                      <ShieldAlert size={16} className="text-brand-red shrink-0" aria-hidden="true" />
                      <span>Kondisi mendesak untuk event atau kendala produksi kritis? Hubungi langsung Hotline CS via WhatsApp.</span>
                    </div>
                    <a
                      href={getWhatsAppUrl(`Halo CS HIJ, saya ada kendala garansi/kualitas mendesak terkait PO ${activeOrder?.po || activeOrder?.id || '-'} (${activeOrder?.productType || 'Pesanan'}). Mohon bantuan penanganan cepat.`)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-h-10 inline-flex items-center gap-1 font-bold text-white bg-brand-red-cta hover:bg-brand-red-cta/90 px-3 py-1.5 rounded-xl transition-colors shrink-0 shadow-xs whitespace-nowrap"
                    >
                      <MessageCircle size={13} className="text-white" aria-hidden="true" />
                      Hotline WA: {COMPANY_CONTACT.whatsappFormatted}
                    </a>
                  </div>
                </div>

                {complaintSubmitted ? (
                  <div role="status" className="p-6 bg-emerald-50 border border-emerald-200 rounded-3xl text-center space-y-2">
                    <CheckCircle2 size={36} className="text-emerald-600 mx-auto" aria-hidden="true" />
                    <h4 className="text-base font-bold text-emerald-900">Keluhan Terkirim</h4>
                    <p className="text-sm text-emerald-800 max-w-md mx-auto">
                      Kami akan memeriksa dan menghubungi Anda dalam 1×24 jam.
                    </p>
                    <button
                      type="button"
                      onClick={() => setComplaintSubmitted(false)}
                      className="mt-3 h-10 px-4 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 cursor-pointer"
                    >
                      Ajukan Keluhan Lain
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleSubmitComplaint} className="space-y-5 max-w-2xl">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="complaint-category" className={labelClass}>Jenis Masalah</label>
                        <select
                          id="complaint-category"
                          value={complaintCategory}
                          onChange={(e) => setComplaintCategory(e.target.value)}
                          className={fieldClass}
                        >
                          <option value="Jahitan Lepas/Cacat">Jahitan Lepas atau Cacat</option>
                          <option value="Ukuran Salah">Ukuran Tidak Sesuai</option>
                          <option value="Sablon/Bordir Rusak">Sablon atau Bordir Rusak</option>
                          <option value="Kain Cacat">Kain Bolong atau Bernoda</option>
                          <option value="Aksesoris Kurang">Kancing atau Resleting Rusak</option>
                        </select>
                      </div>

                      <div>
                        <label htmlFor="complaint-qty" className={labelClass}>Jumlah Bermasalah (Pcs)</label>
                        <input
                          id="complaint-qty"
                          type="number"
                          inputMode="numeric"
                          min={1}
                          value={complaintQty}
                          onChange={(e) => setComplaintQty(Number(e.target.value))}
                          className={fieldClass}
                        />
                      </div>
                    </div>

                    <div>
                      <label htmlFor="complaint-desc" className={labelClass}>Rincian Masalah</label>
                      <textarea
                        id="complaint-desc"
                        rows={4}
                        value={complaintDesc}
                        onChange={(e) => setComplaintDesc(e.target.value)}
                        placeholder="Contoh: jahitan lengan kiri lepas pada 3 kaos ukuran L"
                        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                      />
                    </div>

                    <div>
                      <label htmlFor="complaint-evidence" className={labelClass}>Foto Bukti</label>
                      <input
                        id="complaint-evidence"
                        type="file"
                        accept="image/*"
                        onChange={(e) => handleFileUpload(e, 'complaint')}
                        aria-describedby="complaint-evidence-status"
                        className={fileClass}
                      />
                      <div id="complaint-evidence-status" aria-live="polite">
                        {complaintUploading && <p className="text-sm text-teal-700 mt-1.5">Mengunggah…</p>}
                        {evidenceUrl && (
                          <p className="text-sm text-emerald-700 mt-1.5 flex items-center gap-1.5">
                            <CheckCircle2 size={16} aria-hidden="true" /> Foto terlampir
                          </p>
                        )}
                      </div>
                    </div>

                    <button
                      type="submit"
                      className="h-11 px-6 bg-rose-700 text-white font-semibold rounded-xl hover:bg-rose-700/90 transition-colors shadow-sm text-sm cursor-pointer"
                    >
                      Kirim Keluhan
                    </button>
                  </form>
                )}
              </div>
            )}

            {/* TAB 6: TRACK HISTORY & REPEAT ORDER */}
            {activeTab === 'history' && (
              <div {...panelProps('history')} className={`space-y-6 rounded-3xl ${panelFocusClass}`}>
                {/* OVERALL STATISTICS METRICS: 2-up on phones, the currency + promo tiles span the row */}
                <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
                  <div className="bg-white rounded-3xl p-4 sm:p-5 border border-slate-100 shadow-[0_4px_20px_rgb(0,0,0,0.03)] flex items-center gap-4 min-w-0">
                    <div className="hidden sm:flex w-12 h-12 rounded-2xl bg-teal-50 text-teal-700 items-center justify-center shrink-0">
                      <Package size={24} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-slate-500 font-medium">Total Pesanan Tercatat</p>
                      <p className="text-2xl font-bold text-slate-900 tabular-nums">{totalOrdersCount} <span className="text-xs font-normal text-slate-400">PO</span></p>
                      <p className="text-[11px] text-teal-700 font-medium mt-0.5">{completedOrdersCount} Selesai • {inProgressOrdersCount} Aktif</p>
                    </div>
                  </div>

                  <div className="bg-white rounded-3xl p-4 sm:p-5 border border-slate-100 shadow-[0_4px_20px_rgb(0,0,0,0.03)] flex items-center gap-4 min-w-0">
                    <div className="hidden sm:flex w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-700 items-center justify-center shrink-0">
                      <Layers size={24} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-slate-500 font-medium">Total Pcs Diproduksi</p>
                      <p className="text-2xl font-bold text-slate-900 whitespace-nowrap tabular-nums">{totalPcsProduced.toLocaleString('id-ID')} <span className="text-xs font-normal text-slate-400">Pcs</span></p>
                      <p className="text-[11px] text-slate-500 mt-0.5">Akumulasi seluruh batch</p>
                    </div>
                  </div>

                  <div className="col-span-2 sm:col-span-1 bg-white rounded-3xl p-4 sm:p-5 border border-slate-100 shadow-[0_4px_20px_rgb(0,0,0,0.03)] flex items-center gap-4 min-w-0">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
                      <ShoppingBag size={24} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-slate-500 font-medium">Total Belanja / Investasi</p>
                      <p className="text-xl xl:text-lg font-bold text-slate-900 whitespace-nowrap tabular-nums">{formatCurrency(totalLtvSpend)}</p>
                      <p className="text-[11px] text-emerald-700 font-medium mt-0.5">Kemitraan Terverifikasi</p>
                    </div>
                  </div>

                  <div className="col-span-2 sm:col-span-1 bg-white rounded-3xl p-4 sm:p-5 border border-slate-100 shadow-[0_4px_20px_rgb(0,0,0,0.03)] flex items-center gap-4 min-w-0">
                    <div className="w-12 h-12 rounded-2xl bg-teal-50 text-brand-teal-dark flex items-center justify-center shrink-0">
                      <RotateCcw size={24} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-slate-500 font-medium">Repeat Order Cepat</p>
                      <p className="text-sm font-bold text-slate-900">WhatsApp 1-Klik</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">Template PO otomatis</p>
                    </div>
                  </div>
                </div>

                {/* QUICK REPEAT ORDER CONSULTATION BANNER */}
                <div className="relative overflow-hidden bg-black rounded-3xl p-6 sm:p-8 text-white shadow-lg border border-teal-800/40 flex flex-col md:flex-row md:items-center justify-between gap-6">
                  <div className="space-y-2 max-w-xl">
                    <div className="inline-flex items-center gap-2 px-3 py-1 bg-teal-500/20 text-teal-300 rounded-full text-xs font-semibold border border-teal-500/30">
                      <Sparkles size={14} className="text-teal-300" />
                      <span>Layanan Repeat Order Cepat & Prioritas</span>
                    </div>
                    <h3 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                      Ingin Pesan Ulang atau Tambah Batch Artikel Sebelumnya?
                    </h3>
                    <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                      Pola jahitan, data sablon/bordir, dan spesifikasi kain dari pesanan Anda sebelumnya tersimpan aman di database arsip HIJ Konveksi. Anda bisa langsung memesan ulang tanpa perlu membuat pola dari nol.
                    </p>
                  </div>

                  <a
                    href={getWhatsAppUrl(
                      `Halo Admin HIJ Konveksi! Saya ${customer.name} ingin konsultasi Repeat Order untuk batch baru. Mohon info ketersediaan slot produksi dan konsultasi spesifikasinya. Terima kasih!`
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2.5 px-6 py-3.5 bg-brand-teal hover:bg-teal-400 text-black rounded-2xl font-bold text-sm transition-colors shadow-md shadow-emerald-950/40 shrink-0"
                  >
                    <MessageCircle size={18} className="shrink-0" aria-hidden="true" />
                    <span>Konsultasi via WA <span className="whitespace-nowrap">({COMPANY_CONTACT.whatsappFormatted})</span></span>
                  </a>
                </div>

                {/* SEARCH & FILTER CONTROLS */}
                <div className="bg-white rounded-3xl p-4 sm:p-5 border border-slate-100 shadow-xs space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="relative flex-1 max-w-md">
                      <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" aria-hidden="true" />
                      <input
                        type="search"
                        aria-label="Cari pesanan"
                        placeholder="Cari nomor PO, nama artikel/produk, bahan..."
                        value={historySearch}
                        onChange={(e) => setHistorySearch(e.target.value)}
                        className="w-full h-10 pl-9 pr-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 transition-all"
                      />
                    </div>

                    <div role="group" aria-label="Filter status pesanan" className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
                      {[
                        { id: 'ALL', label: `Semua (${totalOrdersCount})` },
                        { id: 'ACTIVE', label: `Sedang Berjalan (${inProgressOrdersCount})` },
                        { id: 'COMPLETED', label: `Selesai (${completedOrdersCount})` }
                      ].map(f => (
                        <button
                          key={f.id}
                          type="button"
                          aria-pressed={historyFilter === f.id}
                          onClick={() => setHistoryFilter(f.id as any)}
                          className={`h-10 px-3.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                            historyFilter === f.id
                              ? 'bg-teal-700 text-white shadow-xs'
                              : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                          }`}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* ORDER HISTORY LIST */}
                {filteredHistoryOrders.length === 0 ? (
                  <div className="bg-white rounded-3xl p-12 text-center border border-slate-100 shadow-xs space-y-3">
                    <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
                      <Search size={20} aria-hidden="true" />
                    </div>
                    <h4 className="text-base font-bold text-slate-800">Tidak Ditemukan Pesanan</h4>
                    <p className="text-xs text-slate-500 max-w-sm mx-auto">
                      Tidak ada pesanan yang cocok dengan kata kunci atau filter saat ini.
                    </p>
                    {(historySearch || historyFilter !== 'ALL') && (
                      <button
                        type="button"
                        onClick={() => {
                          setHistorySearch('');
                          setHistoryFilter('ALL');
                        }}
                        className="min-h-10 px-3 text-xs text-teal-700 hover:underline font-semibold cursor-pointer"
                      >
                        Reset Pencarian & Filter
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {filteredHistoryOrders.map(order => {
                      const isCompleted = order.status === 'Completed';
                      const orderSpk = data.spks.find(s => s.orderId === order.id);
                      const isCurrentActive = order.id === activeOrder?.id;

                      return (
                        <div
                          key={order.id}
                          className={`bg-white rounded-3xl p-5 sm:p-6 border transition-all shadow-xs ${
                            isCurrentActive
                              ? 'border-teal-500/80 ring-2 ring-teal-500/10'
                              : 'border-slate-100 hover:border-teal-200 hover:shadow-md'
                          }`}
                        >
                          {/* CARD HEADER */}
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
                            <div className="flex flex-wrap items-center gap-2.5 min-w-0">
                              <span className="font-mono text-xs font-bold px-2.5 py-1 rounded-lg bg-teal-50 text-teal-800 border border-teal-100 break-words">
                                {order.po || order.id}
                              </span>
                              <StatusBadge status={order.status || 'In Production'} />
                              {isCurrentActive && (
                                <span className="text-[10px] font-bold uppercase tracking-wider text-teal-700 bg-teal-100/80 px-2 py-0.5 rounded-md">
                                  Sedang Dilihat
                                </span>
                              )}
                            </div>

                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                              {order.timestamp && (
                                <span className="flex items-center gap-1">
                                  <Calendar size={13} className="text-slate-400" aria-hidden="true" />
                                  Order: <strong className="text-slate-700 font-semibold whitespace-nowrap">{formatDate(order.timestamp)}</strong>
                                </span>
                              )}
                              {order.deadline && (
                                <span className="flex items-center gap-1">
                                  <Clock size={13} className="text-slate-400" aria-hidden="true" />
                                  Deadline: <strong className="text-slate-700 font-semibold whitespace-nowrap">{formatDate(order.deadline)}</strong>
                                </span>
                              )}
                            </div>
                          </div>

                          {/* CARD BODY */}
                          <div className="py-4 space-y-3">
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                              <h4 className="text-base sm:text-lg font-bold text-slate-900 break-words">
                                {order.productType}
                              </h4>
                              <span className="text-lg font-bold text-slate-900 whitespace-nowrap tabular-nums">
                                {formatCurrency(order.totalPrice)}
                              </span>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                              <div className="p-3 bg-slate-50 rounded-xl min-w-0">
                                <span className="text-[11px] text-slate-400 block font-medium">Kuantitas</span>
                                <span className="text-sm font-bold text-slate-800">{order.quantity || 0} Pcs</span>
                              </div>
                              <div className="p-3 bg-slate-50 rounded-xl min-w-0">
                                <span className="text-[11px] text-slate-400 block font-medium">Bahan</span>
                                <span className="text-sm font-semibold text-slate-800 truncate block">{order.material || '-'}</span>
                              </div>
                              <div className="p-3 bg-slate-50 rounded-xl min-w-0">
                                <span className="text-[11px] text-slate-400 block font-medium">Warna</span>
                                <span className="text-sm font-semibold text-slate-800 truncate block">{order.color || '-'}</span>
                              </div>
                              <div className="p-3 bg-slate-50 rounded-xl min-w-0">
                                <span className="text-[11px] text-slate-400 block font-medium">Progres SPK</span>
                                <span className="text-sm font-bold text-teal-700">
                                  {isCompleted ? '100% (Selesai)' : `${orderSpk?.progress || 15}%`}
                                </span>
                              </div>
                            </div>

                            {order.notes && (
                              <div className="p-2.5 bg-slate-50/70 rounded-xl text-xs text-slate-600 border border-slate-100">
                                <span className="font-semibold text-slate-700">Catatan Khusus:</span> {order.notes}
                              </div>
                            )}
                          </div>

                          {/* CARD FOOTER: ACTIONS */}
                          <div className="pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
                            <div className="text-xs text-slate-500">
                              {isCompleted ? (
                                <span className="inline-flex items-center gap-1.5 text-emerald-700 font-semibold">
                                  <CheckCircle2 size={14} /> Pesanan telah selesai & terkirim
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 text-teal-700 font-semibold">
                                  <Clock size={14} /> Sedang diproses di lini konveksi
                                </span>
                              )}
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                              {/* BUTTON 1: SWITCH TO THIS ORDER TIMELINE */}
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedOrderId(order.id);
                                  setActiveTab('timeline');
                                  window.scrollTo({ top: 0, behavior: 'smooth' });
                                }}
                                className="min-h-10 px-3.5 py-2 rounded-xl text-xs font-bold border border-slate-200 hover:border-teal-300 hover:bg-teal-50/60 text-slate-700 hover:text-teal-800 transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                                title="Buka rincian spesifikasi dan tahapan SPK pesanan ini"
                              >
                                <Package size={14} aria-hidden="true" />
                                <span>Lacak SPK</span>
                              </button>

                              {/* BUTTON 2: VIEW INVOICE */}
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedOrderId(order.id);
                                  setActiveTab('invoice');
                                  window.scrollTo({ top: 0, behavior: 'smooth' });
                                }}
                                className="min-h-10 px-3.5 py-2 rounded-xl text-xs font-bold border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                                title="Buka invoice dan bukti pembayaran pesanan ini"
                              >
                                <FileText size={14} aria-hidden="true" />
                                <span>Faktur</span>
                              </button>

                              {/* BUTTON 3: REPEAT ORDER VIA WHATSAPP */}
                              <a
                                href={createRepeatOrderWaUrl(order)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="min-h-10 px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors inline-flex items-center gap-1.5 shadow-xs cursor-pointer"
                                title="Kirim pesan WhatsApp otomatis untuk pesan ulang artikel ini"
                              >
                                <RotateCcw size={14} aria-hidden="true" />
                                <span>Repeat Order via WA</span>
                                <MessageCircle size={14} className="opacity-90" aria-hidden="true" />
                              </a>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
};
