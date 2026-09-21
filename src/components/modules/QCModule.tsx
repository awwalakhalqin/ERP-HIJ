import React, { useState, useEffect } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  Search,
  Plus,
  Download,
  ShieldCheck,
  ClipboardCheck
} from 'lucide-react';
import { QCReport, SPK } from '../../types';
import { fetchResource, createResource, updateResource } from '../../services/api';
import { formatDate, formatDateTime, getAQLStandard, exportTableToExcel, statusLabel } from '../../lib/utils';
import { StatusBadge } from '../ui/Badge';
import { Modal } from '../ui/Modal';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import {
  FieldLabel,
  FieldHint,
  FieldError,
  FormError,
  FormSection,
  Select,
  Textarea
} from '../ui/Field';
import { PageHeader } from '../ui/PageHeader';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell, TableRowActions, TableEmptyRow, TableSkeletonRows } from '../ui/Table';
import { DetailDrawer, DetailSection, DetailField, DetailStats, DetailBlock, RowDetailButton } from '../ui/DetailDrawer';
import { newestFirst } from '../../lib/ordering';

// Display labels only; stored inspection type values stay unchanged.
const INSPECTION_LABELS: Record<string, string> = {
  'AQL 2.5 Sampling': 'Sampling AQL 2.5',
  '100% Final': 'Periksa Semua (100%)'
};

const totalDefects = (r: QCReport) =>
  (Number(r.defectsMinor) || 0) + (Number(r.defectsMajor) || 0) + (Number(r.defectsCritical) || 0);

/** Number inputs must never hand NaN to the saved report. */
const toCount = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const splitUrls = (value?: string) =>
  (value || '').split(',').map(u => u.trim()).filter(Boolean);

export const QCModule: React.FC = () => {
  const [reports, setReports] = useState<QCReport[]>([]);
  const [spks, setSpks] = useState<SPK[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [detailReport, setDetailReport] = useState<QCReport | null>(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedSpkId, setSelectedSpkId] = useState('');

  // Inspection form
  const [inspectionType, setInspectionType] = useState<'100% Final' | 'AQL 2.5 Sampling'>('AQL 2.5 Sampling');
  const [totalLotSize, setTotalLotSize] = useState(100);
  const [sampleSize, setSampleSize] = useState(20);
  const [passedQty, setPassedQty] = useState(18);
  const [defectsMinor, setDefectsMinor] = useState(1);
  const [defectsMajor, setDefectsMajor] = useState(1);
  const [defectsCritical, setDefectsCritical] = useState(0);
  const [repairableQty, setRepairableQty] = useState(2);
  const [defectDetails, setDefectDetails] = useState('Jahitan obras renggang di kerung lengan (2 pcs).');
  const [inspectorName, setInspectorName] = useState('QC Leader Rina');

  // Submit state and validation messages
  const [savingQC, setSavingQC] = useState(false);
  const [qcError, setQcError] = useState<string | null>(null);
  const [qcFieldErrors, setQcFieldErrors] = useState<Record<string, string>>({});

  const loadData = async () => {
    try {
      setLoading(true);
      const [qcRes, spkRes] = await Promise.all([
        fetchResource<QCReport>('qc-reports'),
        fetchResource<SPK>('spk_produksi')
      ]);
      setReports(qcRes);
      setSpks(spkRes);
      if (spkRes.length > 0 && !selectedSpkId) {
        setSelectedSpkId(spkRes[0].id);
        setTotalLotSize(spkRes[0].targetQty || 100);
      }
    } catch (err) {
      console.error('Failed to load QC reports:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Recalculate AQL sampling recommendation
  const handleSpkSelect = (spkId: string) => {
    setSelectedSpkId(spkId);
    const spk = spks.find(s => s.id === spkId);
    if (spk) {
      const lot = spk.targetQty || 100;
      setTotalLotSize(lot);
      const aql = getAQLStandard(lot);
      setSampleSize(inspectionType === '100% Final' ? lot : aql.sampleSize);
      setPassedQty(inspectionType === '100% Final' ? lot : aql.sampleSize);
    }
  };

  const aqlStandard = getAQLStandard(totalLotSize);

  // Auto determine Accept or Pending Repair
  const isAccepted = defectsCritical === 0 && defectsMajor <= aqlStandard.maxMajor && defectsMinor <= aqlStandard.maxMinor;

  // Mirrors the status saved in handleSubmitQC
  const resultLabel = isAccepted ? 'Lulus' : repairableQty > 0 ? 'Perlu Perbaikan' : 'Lot Ditolak';

  const selectedSpk = spks.find(s => s.id === selectedSpkId);
  const defectTotal = defectsMinor + defectsMajor + defectsCritical;

  const handleOpenQCModal = () => {
    setQcError(null);
    setQcFieldErrors({});
    setIsModalOpen(true);
  };

  /*
   * SPKs whose production has finished but that nobody has inspected yet.
   * Derived from the SPK list rather than stored, the same way the SPK page
   * derives its queue of orders — so finishing production puts the job in front
   * of QC on its own, instead of QC having to know which SPK to type in.
   */
  const inspectedSpkIds = new Set(reports.map(r => String(r.spkId || '').toLowerCase()));
  const awaitingQc = newestFirst(
    spks.filter(spk => {
      const finished = spk.status === 'Completed' || (Number(spk.progress) || 0) >= 100;
      return finished && !inspectedSpkIds.has(String(spk.id).toLowerCase());
    })
  );

  /** Opens the inspection form already pointed at this SPK. */
  const handleInspectSpk = (spkId: string) => {
    handleSpkSelect(spkId);
    handleOpenQCModal();
  };

  const handleSubmitQC = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingQC) return;

    const spk = selectedSpk;

    const errors: Record<string, string> = {};
    if (!selectedSpkId || !spk) errors.spkId = 'Pilih SPK yang diperiksa.';
    if (!(sampleSize > 0)) errors.sampleSize = 'Jumlah diperiksa minimal 1 pcs.';
    if (passedQty < 0) {
      errors.passedQty = 'Jumlah lulus tidak boleh minus.';
    } else if (sampleSize > 0 && passedQty > sampleSize) {
      errors.passedQty = `Jumlah lulus ${passedQty} pcs melebihi jumlah diperiksa ${sampleSize} pcs.`;
    }
    if (repairableQty < 0) errors.repairable = 'Jumlah bisa diperbaiki tidak boleh minus.';
    if (defectsMinor < 0) errors.defectsMinor = 'Jumlah cacat minor tidak boleh minus.';
    if (defectsMajor < 0) errors.defectsMajor = 'Jumlah cacat mayor tidak boleh minus.';
    if (defectsCritical < 0) errors.defectsCritical = 'Jumlah cacat kritis tidak boleh minus.';
    if (
      !errors.sampleSize && !errors.passedQty &&
      !errors.defectsMinor && !errors.defectsMajor && !errors.defectsCritical &&
      passedQty + defectTotal > sampleSize
    ) {
      errors.balance = `Lulus ${passedQty} pcs + cacat ${defectTotal} pcs = ${passedQty + defectTotal} pcs, melebihi ${sampleSize} pcs yang diperiksa.`;
    }
    if (!inspectorName.trim()) errors.inspector = 'Isi nama pemeriksa QC.';
    if (!isAccepted && !defectDetails.trim()) {
      errors.defectDetails = `Hasil "${resultLabel}" wajib disertai rincian cacat agar tim perbaikan tahu yang harus dikerjakan.`;
    }

    if (Object.keys(errors).length > 0) {
      setQcFieldErrors(errors);
      setQcError('Lengkapi isian yang ditandai merah, lalu simpan lagi.');
      const fieldIds: Record<string, string> = {
        spkId: 'qc-spk',
        sampleSize: 'qc-sample',
        passedQty: 'qc-passed',
        balance: 'qc-passed',
        repairable: 'qc-repairable',
        defectsMinor: 'qc-minor',
        defectsMajor: 'qc-major',
        defectsCritical: 'qc-critical',
        inspector: 'qc-inspector',
        defectDetails: 'qc-notes'
      };
      const firstField = [
        'spkId', 'sampleSize', 'passedQty', 'balance', 'repairable',
        'defectsMinor', 'defectsMajor', 'defectsCritical', 'inspector', 'defectDetails'
      ].find(key => errors[key]);
      if (firstField) document.getElementById(fieldIds[firstField])?.focus();
      return;
    }

    setQcFieldErrors({});
    setQcError(null);
    setSavingQC(true);

    const report: QCReport = {
      id: `QC-${Date.now().toString().slice(-5)}`,
      orderId: spk?.orderId || 'ORD-GEN',
      spkId: selectedSpkId,
      product: spk?.productName || 'Garmen HIJ',
      inspectionType,
      totalInspected: sampleSize,
      passedQty,
      defectsMinor,
      defectsMajor,
      defectsCritical,
      repairable: repairableQty,
      nonRepairable: Math.max(0, sampleSize - passedQty - repairableQty),
      status: isAccepted ? 'Accept' : repairableQty > 0 ? 'Pending Repair' : 'Reject Lot',
      defectDetails: defectDetails.trim(),
      inspector: inspectorName.trim(),
      timestamp: new Date().toISOString()
    };

    try {
      await createResource('qc-reports', report);
      // Auto update SPK QC count
      if (spk && isAccepted) {
        await updateResource('spk_produksi', spk.id, {
          qc: spk.targetQty,
          status: 'QC Passed'
        });
      }
      setIsModalOpen(false);
      loadData();
    } catch (err) {
      setQcError('Hasil QC gagal disimpan. Periksa koneksi ke server, lalu simpan lagi.');
    } finally {
      setSavingQC(false);
    }
  };

  const filteredReports = newestFirst(reports.filter(r => {
    const matchesSearch =
      r.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.product.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.inspector.toLowerCase().includes(searchQuery.toLowerCase());
    if (statusFilter === 'ALL') return matchesSearch;
    return matchesSearch && r.status === statusFilter;
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pemeriksaan QC"
        description="Catat hasil pemeriksaan mutu per SPK dan pantau jumlah cacat."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportTableToExcel(reports, 'Laporan_QC_HIJ')}
            >
              <Download size={16} aria-hidden="true" /> Unduh Excel
            </Button>
            <Button size="sm" onClick={handleOpenQCModal}>
              <Plus size={16} aria-hidden="true" /> Catat Hasil QC
            </Button>
          </>
        }
      />

      {/* ANTREAN: SPK SELESAI PRODUKSI YANG BELUM DIPERIKSA */}
      <section aria-labelledby="awaiting-qc-heading">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 id="awaiting-qc-heading" className="text-lg font-bold text-slate-900">
            1 &middot; Menunggu Pemeriksaan QC
          </h2>
          {awaitingQc.length > 0 && (
            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-status-warning-bg px-2 text-xs font-bold text-status-warning">
              {awaitingQc.length}
            </span>
          )}
        </div>
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="cell-sticky-start">No. SPK</TableHead>
                <TableHead className="hidden md:table-cell">Produk</TableHead>
                <TableHead className="hidden lg:table-cell">Pelanggan</TableHead>
                <TableHead className="hidden sm:table-cell text-right">Target</TableHead>
                <TableHead className="hidden lg:table-cell">Selesai Produksi</TableHead>
                <TableHead className="cell-sticky-end text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && spks.length === 0 ? (
                <TableSkeletonRows columns={6} rows={2} />
              ) : awaitingQc.length === 0 ? (
                <TableEmptyRow
                  colSpan={6}
                  icon={<ClipboardCheck size={20} />}
                  title="Tidak ada yang menunggu diperiksa"
                  description="SPK akan muncul di sini sendiri begitu produksinya selesai."
                />
              ) : (
                awaitingQc.map(spk => (
                  <TableRow key={spk.id}>
                    <TableCell className="cell-sticky-start whitespace-nowrap font-mono font-bold text-slate-900">
                      {spk.id}
                    </TableCell>
                    <TableCell className="hidden md:table-cell break-words">{spk.productName || '\u2014'}</TableCell>
                    <TableCell className="hidden lg:table-cell break-words">{spk.customerName || '\u2014'}</TableCell>
                    <TableCell className="hidden sm:table-cell text-right font-semibold tabular-nums">
                      {spk.targetQty || 0}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell whitespace-nowrap text-slate-500">
                      {spk.tanggalSelesai ? formatDate(spk.tanggalSelesai) : '\u2014'}
                    </TableCell>
                    <TableCell className="cell-sticky-end text-right">
                      <TableRowActions>
                        <Button
                          size="sm"
                          onClick={() => handleInspectSpk(spk.id)}
                          aria-label={`Periksa mutu ${spk.id}`}
                          className="h-8 gap-1.5 px-2.5 text-xs"
                        >
                          <ShieldCheck size={14} aria-hidden="true" /> Periksa
                        </Button>
                      </TableRowActions>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      </section>

      <h2 className="pt-2 text-lg font-bold text-slate-900">2 &middot; Riwayat Pemeriksaan</h2>

      {/* FILTER & SEARCH */}
      <Card className="p-4 flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
        <div className="relative w-full sm:w-80">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <Input
            type="search"
            aria-label="Cari hasil QC"
            placeholder="Cari no. QC, produk, atau pemeriksa…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="sm:w-auto"
          aria-label="Filter hasil QC"
        >
          <option value="ALL">Semua Hasil</option>
          <option value="Accept">{statusLabel('Accept')}</option>
          <option value="Pending Repair">{statusLabel('Pending Repair')}</option>
          <option value="Reject Lot">{statusLabel('Reject Lot')}</option>
        </Select>
      </Card>

      {/* QC REPORTS TABLE */}
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="cell-sticky-start">No. QC</TableHead>
              <TableHead className="hidden md:table-cell">Produk</TableHead>
              <TableHead className="hidden lg:table-cell">SPK</TableHead>
              <TableHead className="hidden sm:table-cell text-right">Lulus</TableHead>
              <TableHead className="hidden sm:table-cell text-right">Diperiksa</TableHead>
              <TableHead className="hidden sm:table-cell text-right">Cacat</TableHead>
              <TableHead className="hidden lg:table-cell">Tanggal</TableHead>
              <TableHead className="text-center">Hasil</TableHead>
              <TableHead className="cell-sticky-end text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableSkeletonRows columns={9} />
            ) : filteredReports.length === 0 ? (
              <TableEmptyRow
                colSpan={9}
                icon={<ShieldCheck size={20} />}
                title={searchQuery || statusFilter !== 'ALL' ? 'Tidak ada hasil QC yang cocok' : 'Belum ada hasil QC'}
                description={
                  searchQuery || statusFilter !== 'ALL'
                    ? 'Coba kata kunci lain atau pilih Semua Hasil.'
                    : 'Catat hasil QC setelah barang selesai diperiksa.'
                }
              />
            ) : (
              filteredReports.map(report => {
                const defects = totalDefects(report);
                return (
                  <TableRow key={report.id}>
                    <TableCell className="cell-sticky-start whitespace-nowrap font-mono font-bold text-slate-900">{report.id}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      <span className="font-semibold text-slate-900 break-words">{report.product}</span>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell font-mono text-slate-500 whitespace-nowrap">
                      {report.spkId || report.orderId || '—'}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-right font-bold text-slate-900 whitespace-nowrap">
                      {report.passedQty}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-right whitespace-nowrap">
                      {report.totalInspected}
                    </TableCell>
                    <TableCell className={`hidden sm:table-cell text-right whitespace-nowrap ${defects > 0 ? 'font-semibold text-brand-red' : ''}`}>
                      {defects}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell whitespace-nowrap">
                      {formatDate(report.timestamp)}
                    </TableCell>
                    <TableCell className="text-center whitespace-nowrap">
                      <StatusBadge status={report.status} />
                    </TableCell>
                    <TableCell className="cell-sticky-end text-right">
                      <TableRowActions>
                        <RowDetailButton label={report.id} onClick={() => setDetailReport(report)} />
                      </TableRowActions>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>

      <DetailDrawer
        isOpen={!!detailReport}
        onClose={() => setDetailReport(null)}
        title={detailReport?.product}
        subtitle={detailReport && (
          <span className="font-mono">
            {detailReport.id}{detailReport.timestamp ? ` · ${formatDate(detailReport.timestamp)}` : ''}
          </span>
        )}
        status={detailReport && <StatusBadge status={detailReport.status} />}
      >
        {detailReport && (
          <>
            <DetailStats
              items={[
                { label: 'Diperiksa', value: `${detailReport.totalInspected} Pcs` },
                { label: 'Lulus', value: `${detailReport.passedQty} Pcs`, tone: 'accent' },
                {
                  label: 'Cacat',
                  value: `${totalDefects(detailReport)} Pcs`,
                  tone: totalDefects(detailReport) > 0 ? 'danger' : 'default'
                }
              ]}
            />
            <DetailSection title="Pemeriksaan">
              <DetailField label="No. QC" mono>{detailReport.id}</DetailField>
              <DetailField label="Tanggal">{formatDateTime(detailReport.timestamp)}</DetailField>
              <DetailField label="SPK" mono>{detailReport.spkId}</DetailField>
              <DetailField label="No. pesanan" mono>{detailReport.orderId}</DetailField>
              <DetailField label="Produk" full>{detailReport.product}</DetailField>
              <DetailField label="Pemeriksa">{detailReport.inspector}</DetailField>
              <DetailField label="Hasil"><StatusBadge status={detailReport.status} /></DetailField>
            </DetailSection>
            <DetailSection title="Sampling & Cacat">
              <DetailField label="Cara periksa" full>
                {INSPECTION_LABELS[detailReport.inspectionType] ?? detailReport.inspectionType}
              </DetailField>
              <DetailField label="Cacat minor">{detailReport.defectsMinor} Pcs</DetailField>
              <DetailField label="Cacat mayor">{detailReport.defectsMajor} Pcs</DetailField>
              <DetailField label="Cacat kritis">{detailReport.defectsCritical} Pcs</DetailField>
              <DetailField label="Bisa diperbaiki">{detailReport.repairable} Pcs</DetailField>
              <DetailField label="Tidak bisa diperbaiki">{detailReport.nonRepairable} Pcs</DetailField>
            </DetailSection>
            <DetailSection title="Catatan Cacat">
              <DetailField label="Rincian cacat" full>{detailReport.defectDetails}</DetailField>
            </DetailSection>
            {splitUrls(detailReport.imageUrls).length > 0 && (
              <DetailBlock title="Foto Cacat">
                <div className="grid grid-cols-3 gap-2">
                  {splitUrls(detailReport.imageUrls).map((url, i) => (
                    <a
                      key={url + i}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block overflow-hidden rounded-lg border border-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal"
                    >
                      <img
                        src={url}
                        alt={`Foto cacat ${i + 1} untuk ${detailReport.id}`}
                        className="aspect-square w-full object-cover"
                      />
                    </a>
                  ))}
                </div>
              </DetailBlock>
            )}
          </>
        )}
      </DetailDrawer>

      {/* QC FORM MODAL */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Catat Hasil QC"
        subtitle="Hasil pemeriksaan mutu per SPK: jumlah lulus, cacat, dan catatan perbaikan."
        maxWidth="2xl"
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0" aria-live="polite">
              <span className="block text-xs font-medium text-muted-foreground">Lulus / diperiksa</span>
              <span className="block text-lg font-bold tabular-nums text-foreground">
                {passedQty} / {sampleSize} pcs
              </span>
              <span className="block text-xs text-muted-foreground tabular-nums">
                {defectTotal} pcs cacat · hasil {resultLabel}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" disabled={savingQC} onClick={() => setIsModalOpen(false)}>
                Batal
              </Button>
              <Button type="submit" form="qc-form" disabled={savingQC}>
                {savingQC ? 'Menyimpan…' : 'Simpan Hasil QC'}
              </Button>
            </div>
          </div>
        }
      >
        <form id="qc-form" noValidate onSubmit={handleSubmitQC} className="space-y-5">
          <FormError>{qcError}</FormError>

          <FormSection step={1} title="Pemeriksaan" description="SPK yang diperiksa, cara periksa, dan siapa pemeriksanya.">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <FieldLabel htmlFor="qc-spk" required>SPK / produk</FieldLabel>
                <Select
                  id="qc-spk"
                  value={selectedSpkId}
                  aria-invalid={!!qcFieldErrors.spkId}
                  aria-describedby={qcFieldErrors.spkId ? 'qc-spk-error' : 'qc-spk-hint'}
                  onChange={(e) => {
                    setQcFieldErrors(prev => ({ ...prev, spkId: '' }));
                    handleSpkSelect(e.target.value);
                  }}
                >
                  <option value="">Pilih SPK yang diperiksa</option>
                  {spks.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.id} - {s.productName} ({s.targetQty} Pcs)
                    </option>
                  ))}
                </Select>
                {qcFieldErrors.spkId ? (
                  <FieldError id="qc-spk-error">{qcFieldErrors.spkId}</FieldError>
                ) : (
                  <FieldHint id="qc-spk-hint">
                    {selectedSpk
                      ? `Produk: ${selectedSpk.productName}`
                      : 'Produk dan no. pesanan terisi otomatis dari SPK.'}
                  </FieldHint>
                )}
              </div>

              <div>
                <FieldLabel htmlFor="qc-type">Cara periksa</FieldLabel>
                <Select
                  id="qc-type"
                  value={inspectionType}
                  onChange={(e) => {
                    const type = e.target.value as QCReport['inspectionType'];
                    setInspectionType(type);
                    setQcFieldErrors(prev => ({ ...prev, sampleSize: '', balance: '' }));
                    setSampleSize(type === '100% Final' ? totalLotSize : aqlStandard.sampleSize);
                  }}
                >
                  <option value="AQL 2.5 Sampling">{INSPECTION_LABELS['AQL 2.5 Sampling']}</option>
                  <option value="100% Final">{INSPECTION_LABELS['100% Final']}</option>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <FieldLabel htmlFor="qc-lot">Total produksi (pcs)</FieldLabel>
                <Input
                  id="qc-lot"
                  type="number"
                  readOnly
                  value={totalLotSize}
                  aria-describedby="qc-lot-hint"
                  className="bg-muted text-right font-semibold tabular-nums"
                />
                <FieldHint id="qc-lot-hint">Target SPK, tidak diubah di sini.</FieldHint>
              </div>

              <div>
                <FieldLabel htmlFor="qc-sample" required>Jumlah diperiksa (pcs)</FieldLabel>
                <Input
                  id="qc-sample"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={sampleSize}
                  aria-invalid={!!qcFieldErrors.sampleSize}
                  aria-describedby={qcFieldErrors.sampleSize ? 'qc-sample-error' : 'qc-sample-hint'}
                  onChange={(e) => {
                    setQcFieldErrors(prev => ({ ...prev, sampleSize: '', balance: '', passedQty: '' }));
                    setSampleSize(toCount(e.target.value));
                  }}
                  className="text-right font-semibold tabular-nums"
                />
                {qcFieldErrors.sampleSize ? (
                  <FieldError id="qc-sample-error">{qcFieldErrors.sampleSize}</FieldError>
                ) : (
                  <FieldHint id="qc-sample-hint">
                    Standar AQL 2.5 untuk lot {totalLotSize} pcs: sampel {aqlStandard.sampleSize} pcs, batas cacat{' '}
                    {aqlStandard.maxMinor} minor · {aqlStandard.maxMajor} mayor · {aqlStandard.maxCritical} kritis.
                  </FieldHint>
                )}
              </div>
            </div>

            <div>
              <FieldLabel htmlFor="qc-inspector" required>Pemeriksa QC</FieldLabel>
              <Input
                id="qc-inspector"
                type="text"
                placeholder="Contoh: QC Leader Rina"
                value={inspectorName}
                aria-invalid={!!qcFieldErrors.inspector}
                aria-describedby={qcFieldErrors.inspector ? 'qc-inspector-error' : undefined}
                onChange={(e) => {
                  setQcFieldErrors(prev => ({ ...prev, inspector: '' }));
                  setInspectorName(e.target.value);
                }}
              />
              <FieldError id="qc-inspector-error">{qcFieldErrors.inspector}</FieldError>
            </div>
          </FormSection>

          <FormSection step={2} title="Hasil & cacat" description="Jumlah lulus dan rincian cacat dari pcs yang diperiksa.">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <FieldLabel htmlFor="qc-passed" required>Jumlah lulus (pcs)</FieldLabel>
                <Input
                  id="qc-passed"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={sampleSize}
                  value={passedQty}
                  aria-invalid={!!qcFieldErrors.passedQty || !!qcFieldErrors.balance}
                  aria-describedby={
                    [
                      qcFieldErrors.passedQty ? 'qc-passed-error' : null,
                      qcFieldErrors.balance ? 'qc-balance-error' : null
                    ].filter(Boolean).join(' ') || undefined
                  }
                  onChange={(e) => {
                    setQcFieldErrors(prev => ({ ...prev, passedQty: '', balance: '' }));
                    setPassedQty(toCount(e.target.value));
                  }}
                  className="text-right font-semibold tabular-nums"
                />
                <FieldError id="qc-passed-error">{qcFieldErrors.passedQty}</FieldError>
              </div>

              <div>
                <FieldLabel htmlFor="qc-repairable">Bisa diperbaiki (pcs)</FieldLabel>
                <Input
                  id="qc-repairable"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={repairableQty}
                  aria-invalid={!!qcFieldErrors.repairable}
                  aria-describedby={qcFieldErrors.repairable ? 'qc-repairable-error' : 'qc-repairable-hint'}
                  onChange={(e) => {
                    setQcFieldErrors(prev => ({ ...prev, repairable: '' }));
                    setRepairableQty(toCount(e.target.value));
                  }}
                  className="text-right font-semibold tabular-nums"
                />
                {qcFieldErrors.repairable ? (
                  <FieldError id="qc-repairable-error">{qcFieldErrors.repairable}</FieldError>
                ) : (
                  <FieldHint id="qc-repairable-hint">
                    Sisanya tercatat sebagai tidak bisa diperbaiki.
                  </FieldHint>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div>
                <FieldLabel htmlFor="qc-minor">Cacat minor (pcs)</FieldLabel>
                <Input
                  id="qc-minor"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={defectsMinor}
                  aria-invalid={!!qcFieldErrors.defectsMinor || !!qcFieldErrors.balance}
                  aria-describedby={
                    [
                      qcFieldErrors.defectsMinor ? 'qc-minor-error' : 'qc-minor-hint',
                      qcFieldErrors.balance ? 'qc-balance-error' : null
                    ].filter(Boolean).join(' ')
                  }
                  onChange={(e) => {
                    setQcFieldErrors(prev => ({ ...prev, defectsMinor: '', balance: '', defectDetails: '' }));
                    setDefectsMinor(toCount(e.target.value));
                  }}
                  className="text-right font-semibold tabular-nums"
                />
                {qcFieldErrors.defectsMinor ? (
                  <FieldError id="qc-minor-error">{qcFieldErrors.defectsMinor}</FieldError>
                ) : (
                  <FieldHint id="qc-minor-hint">Jahitan kurang rapi. Maks. {aqlStandard.maxMinor}</FieldHint>
                )}
              </div>

              <div>
                <FieldLabel htmlFor="qc-major">Cacat mayor (pcs)</FieldLabel>
                <Input
                  id="qc-major"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={defectsMajor}
                  aria-invalid={!!qcFieldErrors.defectsMajor || !!qcFieldErrors.balance}
                  aria-describedby={
                    [
                      qcFieldErrors.defectsMajor ? 'qc-major-error' : 'qc-major-hint',
                      qcFieldErrors.balance ? 'qc-balance-error' : null
                    ].filter(Boolean).join(' ')
                  }
                  onChange={(e) => {
                    setQcFieldErrors(prev => ({ ...prev, defectsMajor: '', balance: '', defectDetails: '' }));
                    setDefectsMajor(toCount(e.target.value));
                  }}
                  className="text-right font-semibold tabular-nums"
                />
                {qcFieldErrors.defectsMajor ? (
                  <FieldError id="qc-major-error">{qcFieldErrors.defectsMajor}</FieldError>
                ) : (
                  <FieldHint id="qc-major-hint">Salah ukuran, kain robek. Maks. {aqlStandard.maxMajor}</FieldHint>
                )}
              </div>

              <div className="col-span-2 sm:col-span-1">
                <FieldLabel htmlFor="qc-critical">Cacat kritis (pcs)</FieldLabel>
                <Input
                  id="qc-critical"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={defectsCritical}
                  aria-invalid={!!qcFieldErrors.defectsCritical || !!qcFieldErrors.balance}
                  aria-describedby={
                    [
                      qcFieldErrors.defectsCritical ? 'qc-critical-error' : 'qc-critical-hint',
                      qcFieldErrors.balance ? 'qc-balance-error' : null
                    ].filter(Boolean).join(' ')
                  }
                  onChange={(e) => {
                    setQcFieldErrors(prev => ({ ...prev, defectsCritical: '', balance: '', defectDetails: '' }));
                    setDefectsCritical(toCount(e.target.value));
                  }}
                  className="text-right font-semibold tabular-nums"
                />
                {qcFieldErrors.defectsCritical ? (
                  <FieldError id="qc-critical-error">{qcFieldErrors.defectsCritical}</FieldError>
                ) : (
                  <FieldHint id="qc-critical-hint">Patahan jarum tertinggal. Maks. {aqlStandard.maxCritical}</FieldHint>
                )}
              </div>
            </div>

            <FieldError id="qc-balance-error">{qcFieldErrors.balance}</FieldError>

            {/* STATUS MUTU SUMMARY — mirrors the status saved to the report */}
            <div role="status" className={`p-4 rounded-xl border flex flex-wrap items-center justify-between gap-3 ${
              isAccepted ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'
            }`}>
              <span className="text-sm font-medium">
                Hasil pemeriksaan · {defectTotal} pcs cacat dari {sampleSize} pcs
              </span>
              <span className="text-base font-bold flex items-center gap-1.5">
                {isAccepted ? <CheckCircle2 size={18} aria-hidden="true" /> : <AlertTriangle size={18} aria-hidden="true" />}
                {resultLabel}
              </span>
            </div>
          </FormSection>

          <FormSection step={3} title="Catatan">
            <div>
              <FieldLabel htmlFor="qc-notes" required={!isAccepted} aside={isAccepted ? 'Opsional' : undefined}>
                Catatan cacat
              </FieldLabel>
              <Textarea
                id="qc-notes"
                rows={3}
                placeholder="Contoh: Jahitan obras renggang di kerung lengan (2 pcs), perlu jahit ulang."
                value={defectDetails}
                aria-invalid={!!qcFieldErrors.defectDetails}
                aria-describedby={qcFieldErrors.defectDetails ? 'qc-notes-error' : 'qc-notes-hint'}
                onChange={(e) => {
                  setQcFieldErrors(prev => ({ ...prev, defectDetails: '' }));
                  setDefectDetails(e.target.value);
                }}
              />
              {qcFieldErrors.defectDetails ? (
                <FieldError id="qc-notes-error">{qcFieldErrors.defectDetails}</FieldError>
              ) : (
                <FieldHint id="qc-notes-hint">
                  Wajib diisi bila hasilnya perlu perbaikan atau lot ditolak.
                </FieldHint>
              )}
            </div>
          </FormSection>
        </form>
      </Modal>
    </div>
  );
};
