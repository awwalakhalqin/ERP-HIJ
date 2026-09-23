import React, { useState, useEffect } from 'react';
import { Truck, Search, Plus, Download, Printer, ExternalLink, CheckCircle2, ArrowRight } from 'lucide-react';
import { Shipment, Order, QCReport } from '../../types';
import { fetchResource, createResource, updateResource } from '../../services/api';
import { formatDate, formatDateTime, exportTableToExcel, generateId, formatCurrency, statusLabel } from '../../lib/utils';
import { StatusBadge } from '../ui/Badge';
import { Modal } from '../ui/Modal';
import { exportElementToPdf } from '../../services/pdfGenerator';
import { Card } from '../ui/Card';
import { COMPANY_CONTACT } from '../../config/contact';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { FormError } from '../ui/Field';
import { PageHeader } from '../ui/PageHeader';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell, TableRowActions, RowActionButton, TableEmptyRow, TableSkeletonRows } from '../ui/Table';
import { DetailDrawer, DetailSection, DetailField, DetailStats, RowDetailButton } from '../ui/DetailDrawer';
import { OrderFlowStepper } from '../ui/OrderFlowStepper';
import { newestFirst } from '../../lib/ordering';

// Next step a shipment can move to (SOP-16). Handing over to the courier triggers a draft invoice (SOP-20).
const NEXT_STEP: Partial<Record<Shipment['status'], { next: Shipment['status']; label: string }>> = {
  'Packing': { next: 'Picked Up', label: 'Serahkan ke Kurir' },
  'Surat Jalan Dibuat': { next: 'Picked Up', label: 'Serahkan ke Kurir' },
  'Picked Up': { next: 'In Transit', label: 'Dalam Perjalanan' },
  'In Transit': { next: 'Delivered', label: 'Sampai Tujuan' }
};

export const ShippingModule: React.FC = () => {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  // What the server said when a write was refused, shown where the action was taken.
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [qcReports, setQcReports] = useState<QCReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  // Keep the id so the drawer reflects the reloaded record after a status change.
  const [detailId, setDetailId] = useState<string | null>(null);

  // Print Surat Jalan Preview
  const [printShipment, setPrintShipment] = useState<Shipment | null>(null);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);

  const [formData, setFormData] = useState<Partial<Shipment>>({
    orderId: '',
    customerId: '',
    customerName: '',
    destinationAddress: '',
    courier: '',
    trackingNumber: '',
    packageWeightKg: 8.5,
    koliCount: 1,
    shippingCost: 0,
    paidBy: 'Penerima (COD Ongkir)',
    status: 'Surat Jalan Dibuat'
  });

  const loadData = async () => {
    try {
      setLoading(true);
      const [shipRes, orderRes, qcRes] = await Promise.all([
        fetchResource<Shipment>('shipments'),
        fetchResource<Order>('orders'),
        fetchResource<QCReport>('qc-reports')
      ]);
      // Show what is really there; an empty table is the honest state.
      setShipments(shipRes);
      setOrders(orderRes);
      setQcReports(qcRes || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 5000);
  };

  const handleAdvanceStatus = async (s: Shipment) => {
    const step = NEXT_STEP[s.status];
    if (!step) return;
    try {
      setUpdatingId(s.id);
      setActionError(null);
      const updated = await updateResource<Shipment & { draftInvoiceId?: string }>('shipments', s.id, { status: step.next });
      showToast(
        updated?.draftInvoiceId
          ? `Draf faktur ${updated.draftInvoiceId} dibuat untuk Keuangan.`
          : `${s.id}: ${statusLabel(step.next)}.`
      );
      await loadData();
    } catch (err: any) {
      // The server explains why it refused (e.g. QC gate); relay that, not a generic line.
      setActionError(err?.message || 'Gagal memperbarui status pengiriman. Coba lagi.');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleCreateShipment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!formData.orderId) {
      setFormError('Pilih pesanan terlebih dahulu.');
      return;
    }

    // Client pre-check of the QC gate (SOP-16). The server enforces the same
    // rule and its message is shown if it still refuses.
    const orderQC = qcReports.filter(q => q.orderId === formData.orderId);
    const hasPassedQC = orderQC.some(q => q.status === 'Accept');
    if (!hasPassedQC) {
      setFormError('Pesanan belum lolos QC. Hanya pesanan dengan hasil QC "Accept" yang dapat dibuatkan Surat Jalan.');
      return;
    }

    const shipment: Shipment = {
      id: generateId('SJ'),
      orderId: formData.orderId,
      customerId: formData.customerId || 'CUST-GEN',
      customerName: formData.customerName || 'Klien',
      destinationAddress: formData.destinationAddress || 'Alamat Tujuan',
      courier: formData.courier || '-',
      trackingNumber: formData.trackingNumber || '',
      packageWeightKg: Number(formData.packageWeightKg) || 1,
      koliCount: Number(formData.koliCount) || 1,
      shippingCost: Number(formData.shippingCost) || 0,
      paidBy: formData.paidBy as any || 'Pengirim',
      status: formData.status as any || 'Surat Jalan Dibuat',
      timestamp: new Date().toISOString()
    };

    try {
      setSaving(true);
      setFormError(null);
      const created = await createResource<Shipment & { draftInvoiceId?: string }>('shipments', shipment);
      setIsModalOpen(false);
      if (created?.draftInvoiceId) {
        showToast(`Draf faktur ${created.draftInvoiceId} dibuat untuk Keuangan.`);
      }
      loadData();
    } catch (err: any) {
      setFormError(err?.message || 'Gagal membuat surat jalan. Coba lagi.');
    } finally {
      setSaving(false);
    }
  };

  const openCreateModal = () => {
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleDownloadSuratJalan = async () => {
    if (!printShipment) return;
    try {
      await exportElementToPdf('surat-jalan-doc', `SuratJalan_${printShipment.id}`);
    } catch (err) {
      alert('Gagal membuat PDF surat jalan. Coba lagi.');
    }
  };

  const fieldClass = 'w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600';
  const labelClass = 'block text-sm font-medium text-slate-700 mb-1.5';

  const openPrint = (s: Shipment) => {
    setPrintShipment(s);
    setIsPrintModalOpen(true);
  };

  const query = searchQuery.trim().toLowerCase();
  const filteredShipments = newestFirst(shipments.filter(s =>
    !query ||
    s.id.toLowerCase().includes(query) ||
    s.orderId.toLowerCase().includes(query) ||
    s.customerName.toLowerCase().includes(query) ||
    s.courier.toLowerCase().includes(query) ||
    (s.trackingNumber || '').toLowerCase().includes(query)
  ));

  const detailShipment = detailId ? shipments.find(s => s.id === detailId) ?? null : null;
  const detailStep = detailShipment ? NEXT_STEP[detailShipment.status] : undefined;

  const trackingLink = (trackingNumber: string, className: string) => (
    <a
      href={`https://cekresi.com/?noresi=${trackingNumber}`}
      target="_blank"
      rel="noreferrer"
      className={className}
    >
      {trackingNumber} <ExternalLink size={12} aria-hidden="true" />
      <span className="sr-only">(lacak resi, buka tab baru)</span>
    </a>
  );

  return (
    <div className="space-y-6">
      {toastMessage && (
        <div className="fixed top-5 left-4 right-4 sm:left-auto sm:right-5 z-50 sm:max-w-sm bg-slate-900 text-white px-4 py-3 rounded-2xl shadow-xl border border-teal-500/50 flex items-center gap-2.5 text-sm font-semibold" role="status">
          <CheckCircle2 size={18} className="text-teal-400 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">{toastMessage}</span>
        </div>
      )}

      <PageHeader
        title="Pengiriman"
        description="Buat surat jalan dan pantau status kiriman ke pelanggan."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportTableToExcel(shipments, 'Log_Pengiriman_Ekspedisi')}
            >
              <Download size={16} aria-hidden="true" /> Unduh Excel
            </Button>
            <Button size="sm" onClick={openCreateModal}>
              <Plus size={16} aria-hidden="true" /> Buat Surat Jalan
            </Button>
          </>
        }
      />

      <Card className="p-4">
        <div className="relative w-full sm:w-96">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <Input
            type="search"
            aria-label="Cari pengiriman"
            placeholder="Cari surat jalan, pesanan, pelanggan, atau resi…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </Card>

      {/* SHIPMENTS TABLE */}
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="cell-sticky-start">No. Surat Jalan</TableHead>
              <TableHead className="hidden md:table-cell">No. Pesanan</TableHead>
              <TableHead className="hidden md:table-cell">Pelanggan</TableHead>
              <TableHead className="hidden xl:table-cell">Tujuan</TableHead>
              <TableHead className="hidden xl:table-cell">Kurir</TableHead>
              <TableHead className="hidden xl:table-cell">No. Resi</TableHead>
              <TableHead className="text-center">Status</TableHead>
              <TableHead className="cell-sticky-end text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableSkeletonRows columns={8} />
            ) : filteredShipments.length === 0 ? (
              <TableEmptyRow
                colSpan={8}
                icon={<Truck size={20} />}
                title={query ? 'Tidak ada pengiriman yang cocok' : 'Belum ada pengiriman'}
                description={query ? 'Coba kata kunci lain.' : 'Buat surat jalan setelah pesanan lolos QC dan siap dikirim.'}
                action={
                  query ? (
                    <Button variant="outline" size="sm" onClick={() => setSearchQuery('')}>
                      Hapus Pencarian
                    </Button>
                  ) : (
                    <Button size="sm" onClick={openCreateModal}>
                      <Plus size={16} aria-hidden="true" /> Buat Surat Jalan
                    </Button>
                  )
                }
              />
            ) : (
              filteredShipments.map(s => (
                <TableRow key={s.id}>
                  <TableCell className="cell-sticky-start whitespace-nowrap">
                    <span className="font-mono font-bold text-slate-900">{s.id}</span>
                  </TableCell>
                  <TableCell className="hidden md:table-cell whitespace-nowrap font-mono text-teal-700">
                    {s.orderId}
                  </TableCell>
                  <TableCell className="hidden md:table-cell font-medium text-slate-900">
                    <span className="block max-w-[180px] truncate" title={s.customerName}>
                      {s.customerName}
                    </span>
                  </TableCell>
                  <TableCell className="hidden xl:table-cell text-slate-500">
                    <span className="block max-w-[180px] truncate" title={s.destinationAddress}>
                      {s.destinationAddress}
                    </span>
                  </TableCell>
                  <TableCell className="hidden xl:table-cell whitespace-nowrap font-medium text-slate-800">
                    {s.courier}
                  </TableCell>
                  <TableCell className="hidden xl:table-cell whitespace-nowrap">
                    {s.trackingNumber ? (
                      trackingLink(
                        s.trackingNumber,
                        'font-mono text-sm font-semibold text-teal-700 hover:underline inline-flex items-center gap-1'
                      )
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell className="text-center whitespace-nowrap">
                    <StatusBadge status={s.status} size="sm" solid />
                  </TableCell>
                  <TableCell className="cell-sticky-end text-right">
                    <TableRowActions>
                      <RowActionButton
                        label="Cetak"
                        icon={Printer}
                        display="labeled"
                        onClick={() => openPrint(s)}
                        ariaLabel={`Cetak surat jalan ${s.id}`}
                        title="Cetak surat jalan"
                      />
                      <RowDetailButton label={s.id} onClick={() => setDetailId(s.id)} />
                    </TableRowActions>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <DetailDrawer
        isOpen={!!detailShipment}
        onClose={() => {
          setDetailId(null);
          setActionError(null);
        }}
        title={detailShipment?.customerName}
        subtitle={detailShipment && (
          <span className="font-mono">{detailShipment.id} · {formatDate(detailShipment.timestamp)}</span>
        )}
        status={detailShipment && <StatusBadge status={detailShipment.status} />}
        footer={detailShipment && (
          <>
            {detailStep && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleAdvanceStatus(detailShipment)}
                disabled={updatingId === detailShipment.id}
              >
                <ArrowRight size={16} aria-hidden="true" /> {detailStep.label}
              </Button>
            )}
            <Button type="button" size="sm" onClick={() => openPrint(detailShipment)}>
              <Printer size={16} aria-hidden="true" /> Cetak Surat Jalan
            </Button>
          </>
        )}
      >
        {detailShipment && (() => {
          const linkedOrder = orders.find(o => o.id === detailShipment.orderId || o.po === detailShipment.orderId);
          return (
            <>
              {actionError && <div className="mb-4"><FormError>{actionError}</FormError></div>}
              <OrderFlowStepper
                currentStep={6}
                needsSample={linkedOrder?.needsSample !== false}
                sampleStatus={linkedOrder?.sampleStatus || 'Approved'}
                isSampleApproved={true}
                hasSpk={true}
                isProductionFinished={true}
                isQcPassed={true}
                isShipped={detailShipment.status === 'Delivered' || detailShipment.status === 'In Transit' || detailShipment.status === 'Picked Up'}
                compact
                className="mb-4"
              />
              <DetailStats
                items={[
                  { label: 'Koli', value: `${detailShipment.koliCount} Koli`, tone: 'accent' },
                  { label: 'Berat', value: `${detailShipment.packageWeightKg} Kg` }
                ]}
              />
              <DetailSection title="Pengiriman">
                <DetailField label="No. surat jalan" mono>{detailShipment.id}</DetailField>
                <DetailField label="No. pesanan" mono>{detailShipment.orderId}</DetailField>
                <DetailField label="Tanggal surat jalan">{detailShipment.timestamp && formatDate(detailShipment.timestamp)}</DetailField>
                <DetailField label="Estimasi tiba">{detailShipment.estimatedArrival && formatDate(detailShipment.estimatedArrival)}</DetailField>
                <DetailField label="Status"><StatusBadge status={detailShipment.status} /></DetailField>
              </DetailSection>
              <DetailSection title="Penerima">
                <DetailField label="Nama">{detailShipment.customerName}</DetailField>
                <DetailField label="ID pelanggan" mono>{detailShipment.customerId}</DetailField>
                <DetailField label="Alamat tujuan" full>{detailShipment.destinationAddress}</DetailField>
              </DetailSection>
              <DetailSection title="Ekspedisi">
                <DetailField label="Kurir">{detailShipment.courier}</DetailField>
                <DetailField label="Layanan">{detailShipment.serviceType}</DetailField>
                <DetailField label="No. resi" mono full>
                  {detailShipment.trackingNumber &&
                    trackingLink(
                      detailShipment.trackingNumber,
                      'inline-flex items-center gap-1 text-teal-700 hover:underline'
                    )}
                </DetailField>
                <DetailField label="Ongkos kirim">
                  <span className="whitespace-nowrap">{formatCurrency(detailShipment.shippingCost)}</span>
                </DetailField>
                <DetailField label="Ongkir dibayar">{detailShipment.paidBy}</DetailField>
              </DetailSection>
              <DetailSection title="Riwayat Data">
                <DetailField label="Dicatat oleh">{detailShipment.user}</DetailField>
                <DetailField label="Dicatat pada">{detailShipment.timestamp && formatDateTime(detailShipment.timestamp)}</DetailField>
              </DetailSection>
            </>
          );
        })()}
      </DetailDrawer>

      {/* CREATE MODAL */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Buat Surat Jalan">
        {(() => {
          const selectedOrder = orders.find(o => o.id === formData.orderId);
          const orderQC = qcReports.filter(q => q.orderId === formData.orderId);
          const hasPassedQC = formData.orderId ? orderQC.some(q => q.status === 'Accept') : false;

          return (
            <form onSubmit={handleCreateShipment} className="space-y-5">
              <FormError>{formError}</FormError>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="ship-order" className={labelClass}>No. Pesanan</label>
                  <select
                    id="ship-order"
                    value={formData.orderId}
                    onChange={(e) => {
                      const ord = orders.find(o => o.id === e.target.value);
                      setFormError(null);
                      setFormData({
                        ...formData,
                        orderId: e.target.value,
                        customerId: ord?.customerId,
                        customerName: ord?.customerName
                      });
                    }}
                    required
                    className={fieldClass}
                  >
                    <option value="">Pilih pesanan</option>
                    {orders.map(o => {
                      const isQcOk = qcReports.some(q => q.orderId === o.id && q.status === 'Accept');
                      return (
                        <option key={o.id} value={o.id}>
                          {o.po || o.id} - {o.customerName} {isQcOk ? '(✅ QC Accept)' : '(⏳ Belum QC)'}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div>
                  <label htmlFor="ship-customer" className={labelClass}>Pelanggan</label>
                  <input
                    id="ship-customer"
                    type="text"
                    value={formData.customerName}
                    onChange={(e) => setFormData({ ...formData, customerName: e.target.value })}
                    className={fieldClass}
                  />
                </div>
              </div>

              {/* QC Verification & Anti-Skip Banner */}
              {selectedOrder && (
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span className="text-slate-600">Status Quality Control (QC):</span>
                    {hasPassedQC ? (
                      <span className="text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200 flex items-center gap-1 font-bold">
                        <CheckCircle2 size={13} className="text-emerald-600" aria-hidden="true" /> Lolos QC (Accept)
                      </span>
                    ) : orderQC.length > 0 ? (
                      <span className="text-rose-700 bg-rose-50 px-2.5 py-0.5 rounded-full border border-rose-200 font-bold">
                        ⚠️ QC: {orderQC[0].status}
                      </span>
                    ) : (
                      <span className="text-amber-700 bg-amber-50 px-2.5 py-0.5 rounded-full border border-amber-200 font-bold">
                        ⏳ Menunggu Inspeksi QC
                      </span>
                    )}
                  </div>
                  {!hasPassedQC && (
                    <p className="text-xs text-rose-700 bg-rose-50 p-2.5 rounded-lg border border-rose-200 leading-relaxed font-medium">
                      <strong>Gerbang Anti-Skip:</strong> Pesanan ini belum lolos QC. Hanya pesanan dengan hasil inspeksi berstatus <strong>"Accept"</strong> yang dapat dibuatkan Surat Jalan pengiriman.
                    </p>
                  )}
                </div>
              )}

              <div>
                <label htmlFor="ship-address" className={labelClass}>Alamat Tujuan</label>
                <textarea
                  id="ship-address"
                  rows={3}
                  value={formData.destinationAddress}
                  onChange={(e) => setFormData({ ...formData, destinationAddress: e.target.value })}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="ship-courier" className={labelClass}>Kurir</label>
                  <input
                    id="ship-courier"
                    type="text"
                    value={formData.courier}
                    onChange={(e) => setFormData({ ...formData, courier: e.target.value })}
                    className={fieldClass}
                  />
                </div>
                <div>
                  <label htmlFor="ship-tracking" className={labelClass}>No. Resi</label>
                  <input
                    id="ship-tracking"
                    type="text"
                    value={formData.trackingNumber}
                    onChange={(e) => setFormData({ ...formData, trackingNumber: e.target.value })}
                    className={`${fieldClass} font-mono`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="ship-koli" className={labelClass}>Jumlah Koli</label>
                  <input
                    id="ship-koli"
                    type="number"
                    min={1}
                    value={formData.koliCount}
                    onChange={(e) => setFormData({ ...formData, koliCount: Number(e.target.value) })}
                    className={`${fieldClass} font-mono`}
                  />
                </div>
                <div>
                  <label htmlFor="ship-weight" className={labelClass}>Berat Total (Kg)</label>
                  <input
                    id="ship-weight"
                    type="number"
                    step="0.1"
                    value={formData.packageWeightKg}
                    onChange={(e) => setFormData({ ...formData, packageWeightKg: Number(e.target.value) })}
                    className={`${fieldClass} font-mono`}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
                <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>
                  Batal
                </Button>
                <Button type="submit" disabled={saving || !formData.orderId || !hasPassedQC}>
                  {saving ? 'Menyimpan…' : 'Buat Surat Jalan'}
                </Button>
              </div>
            </form>
          );
        })()}
      </Modal>

      {/* SURAT JALAN PRINT PREVIEW */}
      <Modal isOpen={isPrintModalOpen} onClose={() => setIsPrintModalOpen(false)} title={`Surat Jalan ${printShipment?.id ?? ''}`} maxWidth="2xl">
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={handleDownloadSuratJalan}>
              <Download size={16} aria-hidden="true" /> Unduh PDF
            </Button>
          </div>

          {/* DOKUMEN SURAT JALAN CONTAINER */}
          <div id="surat-jalan-doc" className="p-8 bg-white border border-slate-200 rounded-2xl space-y-6 text-sm text-slate-900">
            <div className="flex justify-between items-start gap-4 border-b-2 border-slate-900 pb-4">
              <div className="flex items-center gap-3">
                <img src="/logo.png" alt="HIJ Logo" className="h-12 w-auto object-contain rounded-lg p-1 border border-slate-100" />
                <div>
                  <h2 className="text-xl font-black text-teal-800">PT HASIL INTI JUALAN (HIJ)</h2>
                  <p className="text-xs text-slate-500">Konveksi & Garmen</p>
                  <p className="text-xs text-slate-500 mt-1">WA: {COMPANY_CONTACT.whatsappDisplay} • {COMPANY_CONTACT.website.replace('https://', '').replace('http://', '')}</p>
                </div>
              </div>
              <div className="text-right">
                <h3 className="text-lg font-black text-slate-900">SURAT JALAN</h3>
                <p className="font-mono font-bold text-slate-700">{printShipment?.id}</p>
                <p className="text-xs text-slate-500">{formatDate(printShipment?.timestamp)}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 bg-slate-50 rounded-xl">
                <p className="text-xs font-semibold text-slate-500">Kepada Yth.</p>
                <p className="font-bold text-slate-900 mt-0.5">{printShipment?.customerName}</p>
                <p className="text-slate-600 mt-1">{printShipment?.destinationAddress}</p>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl space-y-1">
                <p className="text-xs font-semibold text-slate-500">Detail Pengiriman</p>
                <p>Kurir: <strong>{printShipment?.courier}</strong></p>
                <p>No. Resi: <strong className="font-mono">{printShipment?.trackingNumber || '-'}</strong></p>
                <p>Jumlah: <strong>{printShipment?.koliCount} Koli</strong> ({printShipment?.packageWeightKg} Kg)</p>
              </div>
            </div>

            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-100 font-semibold text-slate-700">
                  <tr>
                    <th className="p-2.5">No</th>
                    <th className="p-2.5">No. Pesanan</th>
                    <th className="p-2.5">Deskripsi Barang</th>
                    <th className="p-2.5 text-right">Kemasan</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="p-2.5">1</td>
                    <td className="p-2.5 font-mono font-bold">{printShipment?.orderId}</td>
                    <td className="p-2.5">Paket garmen lolos QC</td>
                    <td className="p-2.5 text-right font-bold">{printShipment?.koliCount} Koli</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-3 gap-4 text-center pt-6 text-sm font-semibold">
              <div>
                <p>Penerima,</p>
                <div className="h-20" />
                <p className="border-t border-slate-300 pt-1 mx-4">( ................................ )</p>
              </div>
              <div>
                <p>Kurir,</p>
                <div className="h-20" />
                <p className="border-t border-slate-300 pt-1 mx-4">( {printShipment?.courier} )</p>
              </div>
              <div className="relative flex flex-col items-center">
                <p>Hormat Kami,</p>
                <div className="h-20 relative w-full flex items-center justify-center">
                  <img
                    src="/templates/HIJ Logo Stamp Basah.png"
                    alt="Stempel Basah HIJ"
                    className="h-20 w-auto object-contain absolute opacity-85 pointer-events-none"
                  />
                  <img
                    src="/templates/ttd basah.png"
                    alt="Tanda Tangan Basah"
                    className="h-14 w-auto object-contain relative z-10"
                  />
                </div>
                <p className="font-bold text-teal-800 border-t border-slate-300 pt-1 w-full">PT HASIL INTI JUALAN</p>
              </div>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
};
