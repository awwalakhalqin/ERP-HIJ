import React, { useState, useEffect } from 'react';
import {
  QrCode,
  Search,
  Plus,
  Scan,
  Printer,
  ArrowRight
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { WIPBundle, SPK } from '../../types';
import { fetchResource, createResource, scanWIPBundle } from '../../services/api';
import { formatDate, formatDateTime } from '../../lib/utils';
import { StatusBadge } from '../ui/Badge';
import { Toast, useToast } from '../ui/Toast';
import { Modal } from '../ui/Modal';
import { ScannerModal } from '../common/ScannerModal';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import {
  FieldLabel,
  FieldHint,
  FieldError,
  FormError,
  FormSection,
  Select
} from '../ui/Field';
import { PageHeader } from '../ui/PageHeader';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  TableRowActions,
  TableEmptyRow,
  TableSkeletonRows,
  TableSortHead,
  sortRows,
  useTablePage,
  TablePagination,
  type SortState
} from '../ui/Table';
import {
  DetailDrawer,
  DetailSection,
  DetailBlock,
  DetailField,
  DetailStats,
  RowDetailButton
} from '../ui/DetailDrawer';

/** Number inputs must never hand NaN to the bundles being created. */
const toCount = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

// Display labels only; stored stage/component values stay unchanged.
const STAGE_LABELS: Record<string, string> = {
  'Cutting': 'Pemotongan',
  'Sewing': 'Penjahitan',
  'Obras': 'Obras',
  'Finishing Detail': 'Finishing',
  'QC': 'QC',
  'Packing': 'Pengemasan'
};

const COMPONENT_LABELS: Record<string, string> = {
  'Full Set': 'Satu Set',
  'Badan Depan/Belakang': 'Badan Depan & Belakang',
  'Lengan': 'Lengan',
  'Kerah/Rib': 'Kerah / Rib'
};

const stageLabel = (stage: string) => STAGE_LABELS[stage] ?? stage;

const componentLabel = (component: string) => COMPONENT_LABELS[component] ?? component;

/** A bundle is judged by when it last moved, so the newest scan drives the date column. */
const lastScanAt = (bundle: WIPBundle) => bundle.scanHistory?.[bundle.scanHistory.length - 1]?.timestamp || '';

// Next stage transition sequence per SOP-08 to 13
const STAGE_SEQUENCE = ['Cutting', 'Sewing', 'Obras', 'Finishing Detail', 'QC', 'Packing'];

const nextStageOf = (currentStage: string) => {
  const currentIndex = STAGE_SEQUENCE.indexOf(currentStage);
  return currentIndex < STAGE_SEQUENCE.length - 1 ? STAGE_SEQUENCE[currentIndex + 1] : 'Packing';
};

const MAX_BUNDLES_PER_BATCH = 20;

export const BundleTrackingModule: React.FC = () => {
  const [bundles, setBundles] = useState<WIPBundle[]>([]);
  const [spks, setSpks] = useState<SPK[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [stageFilter, setStageFilter] = useState('ALL');
  const [bundleSort, setBundleSort] = useState<SortState>({ key: 'newest', direction: 'desc' });

  // Scanner & Modals
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  // Kept by id so the drawer follows the bundle after a scan reloads the list.
  const [detailId, setDetailId] = useState<string | null>(null);

  // New Bundle Generator state
  const [selectedSpkId, setSelectedSpkId] = useState('');
  const [bundleSize, setBundleSize] = useState('M');
  const [bundleQty, setBundleQty] = useState(20);
  const [bundleColor, setBundleColor] = useState('');
  const [bundleComponent, setBundleComponent] = useState<any>('Full Set');
  const [numberOfBundles, setNumberOfBundles] = useState(3);

  // Buat Bundel: submit state and validation messages
  const [savingBundles, setSavingBundles] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createFieldErrors, setCreateFieldErrors] = useState<Record<string, string>>({});

  // Stage update after a scan
  const [stageBundle, setStageBundle] = useState<WIPBundle | null>(null);
  const [stageOperator, setStageOperator] = useState('');
  const [savingStage, setSavingStage] = useState(false);
  /** Sedang memasang seluruh baris untuk dicetak; lihat handlePrintBundleTickets. */
  const [printingAll, setPrintingAll] = useState(false);
  const [stageError, setStageError] = useState<string | null>(null);
  const [stageFieldErrors, setStageFieldErrors] = useState<Record<string, string>>({});

  // Scan feedback shown on the page (the scanner closes itself after a read)
  const [scanError, setScanError] = useState<string | null>(null);
  const { toast, showToast } = useToast();

  const loadData = async () => {
    try {
      setLoading(true);
      const [bundleRes, spkRes] = await Promise.all([
        fetchResource<WIPBundle>('wip-bundles'),
        fetchResource<SPK>('spk_produksi')
      ]);
      setBundles(bundleRes);
      setSpks(spkRes);
      if (spkRes.length > 0 && !selectedSpkId) {
        setSelectedSpkId(spkRes[0].id);
      }
    } catch (err) {
      console.error('Failed to load bundles:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleOpenCreateModal = () => {
    setCreateError(null);
    setCreateFieldErrors({});
    setIsCreateModalOpen(true);
  };

  const handleCreateBundles = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingBundles) return;

    const spk = spks.find(s => s.id === selectedSpkId);

    const errors: Record<string, string> = {};
    if (!selectedSpkId || !spk) errors.spkId = 'Pilih SPK sumber potongan kain ini.';
    if (!bundleSize) errors.size = 'Pilih ukuran potongan bundel.';
    if (!(bundleQty > 0)) errors.quantity = 'Isi per bundel minimal 1 pcs.';
    if (!(numberOfBundles > 0)) {
      errors.count = 'Jumlah bundel minimal 1.';
    } else if (numberOfBundles > MAX_BUNDLES_PER_BATCH) {
      errors.count = `Maksimal ${MAX_BUNDLES_PER_BATCH} bundel sekali buat.`;
    }

    if (Object.keys(errors).length > 0) {
      setCreateFieldErrors(errors);
      setCreateError('Lengkapi isian yang ditandai merah, lalu buat bundel lagi.');
      const fieldIds: Record<string, string> = {
        spkId: 'bnd-spk',
        size: 'bnd-size',
        quantity: 'bnd-qty',
        count: 'bnd-count'
      };
      const firstField = ['spkId', 'size', 'quantity', 'count'].find(key => errors[key]);
      if (firstField) document.getElementById(fieldIds[firstField])?.focus();
      return;
    }

    setCreateFieldErrors({});
    setCreateError(null);
    setSavingBundles(true);

    try {
      /*
       * Ids run per SPK: `<SPK>-B001`, `<SPK>-B002`, … starting after the
       * bundles that SPK already has. A clock-based suffix collided when two
       * batches were made within the same second, so the number is checked
       * against every id in use (including the ones this loop just made).
       */
      const usedIds = new Set(bundles.map(b => String(b.id).toLowerCase()));
      let n = bundles.filter(b => b.spkId === spk.id).length + 1;
      for (let i = 1; i <= numberOfBundles; i++) {
        let bundleId = `${spk.id}-B${String(n).padStart(3, '0')}`;
        while (usedIds.has(bundleId.toLowerCase())) {
          n += 1;
          bundleId = `${spk.id}-B${String(n).padStart(3, '0')}`;
        }
        usedIds.add(bundleId.toLowerCase());
        const item: WIPBundle = {
          id: bundleId,
          spkId: spk.id,
          orderId: spk.orderId,
          bundleNumber: n,
          size: bundleSize,
          quantity: bundleQty,
          color: bundleColor,
          component: bundleComponent,
          currentStage: 'Cutting',
          status: 'In Progress',
          scanHistory: [
            {
              stage: 'Pemotongan Selesai',
              operator: 'Leader Cutting',
              timestamp: new Date().toISOString()
            }
          ]
        };
        await createResource('wip-bundles', item);
        n += 1;
      }
      setIsCreateModalOpen(false);
      showToast(`${numberOfBundles} bundel ukuran ${bundleSize} berhasil dibuat.`);
      loadData();
    } catch (err) {
      setCreateError('Bundel gagal dibuat. Periksa koneksi ke server, lalu coba lagi — sebagian bundel mungkin sudah tersimpan, cek daftar bundel dulu.');
    } finally {
      setSavingBundles(false);
    }
  };

  // A scan opens the stage-update form; nothing is saved until staff confirms.
  const handleScanCode = (decodedCode: string) => {
    const bundle = bundles.find(b => b.id.toLowerCase() === decodedCode.toLowerCase());
    if (!bundle) {
      setScanError(`Bundel "${decodedCode}" tidak ditemukan. Periksa kode pada tiket bundel, lalu scan ulang.`);
      return;
    }
    setScanError(null);
    setStageBundle(bundle);
    setStageOperator('');
    setStageError(null);
    setStageFieldErrors({});
  };

  const handleConfirmStage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingStage || !stageBundle) return;

    if (!stageOperator.trim()) {
      setStageFieldErrors({ operator: 'Isi nama operator yang memindai bundel ini.' });
      setStageError('Lengkapi isian yang ditandai merah, lalu simpan lagi.');
      document.getElementById('bnd-stage-operator')?.focus();
      return;
    }

    setStageFieldErrors({});
    setStageError(null);
    setSavingStage(true);

    const nextStage = nextStageOf(stageBundle.currentStage);
    try {
      await scanWIPBundle(
        stageBundle.id,
        nextStage,
        stageOperator.trim(),
        nextStage === 'Packing' ? 'Completed' : 'In Progress'
      );
      showToast(`Bundel ${stageBundle.id} pindah ke tahap ${stageLabel(nextStage)}.`);
      setStageBundle(null);
      loadData();
    } catch (err: any) {
      setStageError(err?.message || 'Tahap bundel gagal disimpan. Periksa koneksi ke server, lalu simpan lagi.');
    } finally {
      setSavingStage(false);
    }
  };

  /*
   * Tiket dicetak dari tabel yang sedang tampil, sedangkan tabelnya hanya
   * memuat 50 baris per halaman. Kalau dialog cetak dibuka begitu saja, yang
   * keluar cuma bundel di halaman yang sedang dilihat — dan itu tidak
   * kelihatan salah sampai tiketnya sudah dipotong dan ditempel. Jadi seluruh
   * baris hasil saringan dipasang dulu, baru dialog cetak dibuka.
   */
  const handlePrintBundleTickets = () => {
    setPrintingAll(true);
  };

  useEffect(() => {
    if (!printingAll) return;
    // Dua frame: yang pertama memasang barisnya, yang kedua memastikan browser
    // sudah menata ulang sebelum dialognya membekukan halaman.
    const frame = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        window.print();
        setPrintingAll(false);
      })
    );
    return () => cancelAnimationFrame(frame);
  }, [printingAll]);

  const filteredBundles = bundles.filter(bundle => {
    const matchesSearch =
      bundle.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      bundle.spkId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      bundle.size.toLowerCase().includes(searchQuery.toLowerCase());

    if (stageFilter === 'ALL') return matchesSearch;
    return matchesSearch && bundle.currentStage === stageFilter;
  });

  const sortedBundles = sortRows(filteredBundles, bundleSort, (bundle, key) => {
    // Default column: the bundle created last leads, same key `newestFirst` uses.
    // The server stamps `timestamp` on insert, so it is read off the stored record.
    if (key === 'newest') {
      const createdAt = (bundle as any).timestamp;
      return createdAt ? new Date(createdAt).getTime() : 0;
    }
    return key === 'lastScan' ? lastScanAt(bundle) : (bundle as any)[key];
  });

  const { pageRows: pagedBundles, pagination } = useTablePage(sortedBundles);

  const isFiltering = searchQuery.trim() !== '' || stageFilter !== 'ALL';

  const detailBundle = detailId ? bundles.find(b => b.id === detailId) ?? null : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Lacak Bundel"
        description="Scan QR bundel untuk pindah ke tahap berikutnya."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setScanError(null);
                setIsScannerOpen(true);
              }}
            >
              <Scan size={16} aria-hidden="true" /> Scan QR
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrintBundleTickets}
              title="Cetak tiket bundel"
              aria-label="Cetak tiket bundel"
            >
              <Printer size={16} aria-hidden="true" /> Cetak
            </Button>
            <Button size="sm" onClick={handleOpenCreateModal}>
              <Plus size={16} aria-hidden="true" /> Buat Bundel
            </Button>
          </>
        }
      />

      <FormError>{scanError}</FormError>

      {/* FILTER & SEARCH */}
      <Card className="p-4 flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
        <div className="relative w-full sm:w-80">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <Input
            type="search"
            aria-label="Cari bundel"
            placeholder="Cari bundel, SPK, atau ukuran…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          className="sm:w-auto"
          aria-label="Filter tahap bundel"
        >
          <option value="ALL">Semua Tahap</option>
          {STAGE_SEQUENCE.map(stage => (
            <option key={stage} value={stage}>{stageLabel(stage)}</option>
          ))}
        </Select>
      </Card>

      {/* BUNDLE TABLE */}
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableSortHead className="cell-sticky-start" sortKey="id" sort={bundleSort} onSortChange={setBundleSort}>
                Kode Bundel
              </TableSortHead>
              {/*
               * The QR stays on the page so Cetak keeps printing scannable bundle
               * tickets: it shows from `xl` on screen (a 40px code makes rows tall)
               * and always on paper, as does the size printed beside it.
               */}
              <TableHead className="hidden xl:table-cell print:table-cell text-center">QR</TableHead>
              <TableSortHead className="hidden md:table-cell" sortKey="spkId" sort={bundleSort} onSortChange={setBundleSort}>
                SPK
              </TableSortHead>
              <TableHead className="hidden md:table-cell print:table-cell">Ukuran</TableHead>
              <TableSortHead className="hidden sm:table-cell tabular-nums" align="right" sortKey="quantity" sort={bundleSort} onSortChange={setBundleSort}>
                Isi
              </TableSortHead>
              <TableSortHead className="hidden lg:table-cell" sortKey="lastScan" sort={bundleSort} onSortChange={setBundleSort}>
                Scan Terakhir
              </TableSortHead>
              <TableHead className="hidden md:table-cell">Tahap</TableHead>
              <TableHead className="text-center">Status</TableHead>
              <TableHead className="cell-sticky-end text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && bundles.length === 0 ? (
              <TableSkeletonRows columns={9} />
            ) : sortedBundles.length === 0 ? (
              <TableEmptyRow
                colSpan={9}
                icon={<QrCode size={20} />}
                title={bundles.length > 0 && isFiltering ? 'Tidak ada bundel yang cocok' : 'Belum ada bundel'}
                description={
                  bundles.length > 0 && isFiltering
                    ? 'Coba kata kunci lain atau pilih Semua Tahap.'
                    : 'Buat bundel dari SPK setelah kain dipotong, lalu cetak QR-nya.'
                }
                action={
                  !(bundles.length > 0 && isFiltering) && (
                    <Button size="sm" onClick={handleOpenCreateModal}>
                      <Plus size={16} aria-hidden="true" /> Buat Bundel
                    </Button>
                  )
                }
              />
            ) : (printingAll ? sortedBundles : pagedBundles).map(bundle => {
              const scannedAt = lastScanAt(bundle);
              return (
                <TableRow key={bundle.id}>
                  <TableCell className="cell-sticky-start font-mono font-bold text-slate-900">{bundle.id}</TableCell>
                  <TableCell className="hidden xl:table-cell print:table-cell text-center">
                    {/* Kept small so the row matches every other table; tickets print the large one. */}
                    <span className="inline-flex rounded border border-slate-200 bg-white p-0.5">
                      <QRCodeSVG
                        value={bundle.id}
                        size={28}
                        level="M"
                        role="img"
                        aria-label={`Kode QR bundel ${bundle.id}`}
                      />
                    </span>
                  </TableCell>
                  <TableCell className="hidden md:table-cell font-mono text-teal-700">{bundle.spkId}</TableCell>
                  <TableCell className="hidden md:table-cell print:table-cell font-semibold text-slate-800">{bundle.size}</TableCell>
                  <TableCell className="hidden sm:table-cell text-right tabular-nums font-bold text-slate-900">{bundle.quantity}</TableCell>
                  <TableCell className="hidden lg:table-cell">{scannedAt ? formatDate(scannedAt) : '—'}</TableCell>
                  <TableCell className="hidden md:table-cell font-semibold text-teal-700">{stageLabel(bundle.currentStage)}</TableCell>
                  <TableCell className="text-center">
                    <StatusBadge status={bundle.status} size="sm" solid />
                  </TableCell>
                  <TableCell className="cell-sticky-end text-right">
                    <TableRowActions>
                      <RowDetailButton label={bundle.id} onClick={() => setDetailId(bundle.id)} />
                    </TableRowActions>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <TablePagination {...pagination} label="bundel" />
      </Card>

      {/* BUNDLE ROW DETAIL */}
      <DetailDrawer
        isOpen={!!detailBundle}
        onClose={() => setDetailId(null)}
        title={detailBundle?.id}
        subtitle={detailBundle && <span className="font-mono">SPK {detailBundle.spkId}</span>}
        status={detailBundle && <StatusBadge status={detailBundle.status} size="sm" solid />}
      >
        {detailBundle && (() => {
          const spk = spks.find(s => s.id === detailBundle.spkId);
          const scanHistory = detailBundle.scanHistory || [];
          const scannedAt = lastScanAt(detailBundle);
          return (
            <>
              <DetailStats
                items={[
                  { label: 'Isi', value: `${detailBundle.quantity} Pcs` },
                  { label: 'Ukuran', value: detailBundle.size },
                  { label: 'Tahap', value: stageLabel(detailBundle.currentStage), tone: 'accent' }
                ]}
              />
              <DetailSection title="Bundel">
                <DetailField label="Kode bundel" mono full>{detailBundle.id}</DetailField>
                <DetailField label="Nomor bundel">{detailBundle.bundleNumber}</DetailField>
                <DetailField label="Isi per bundel">{detailBundle.quantity} Pcs</DetailField>
                <DetailField label="Ukuran">{detailBundle.size}</DetailField>
                <DetailField label="Warna kain">{detailBundle.color}</DetailField>
                <DetailField label="Bagian potongan" full>{componentLabel(detailBundle.component)}</DetailField>
              </DetailSection>
              <DetailSection title="Sumber Produksi">
                <DetailField label="SPK" mono>{detailBundle.spkId}</DetailField>
                <DetailField label="No. pesanan" mono>{detailBundle.orderId}</DetailField>
                <DetailField label="Produk" full>{spk?.productName}</DetailField>
                <DetailField label="Line jahit">{detailBundle.assignedLine}</DetailField>
                <DetailField label="Operator">{detailBundle.assignedOperator}</DetailField>
              </DetailSection>
              <DetailSection title="Tahap & Status">
                <DetailField label="Tahap sekarang">{stageLabel(detailBundle.currentStage)}</DetailField>
                <DetailField label="Tahap berikutnya">{stageLabel(nextStageOf(detailBundle.currentStage))}</DetailField>
                <DetailField label="Status"><StatusBadge status={detailBundle.status} size="sm" solid /></DetailField>
                <DetailField label="Scan terakhir">{scannedAt && formatDateTime(scannedAt)}</DetailField>
              </DetailSection>
              <DetailBlock title={`Riwayat Scan (${scanHistory.length})`}>
                {scanHistory.length > 0 ? (
                  <ol role="list" className="space-y-3">
                    {scanHistory.map((scan, idx) => (
                      <li key={idx} className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-start gap-3">
                        <span className="w-7 h-7 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center font-bold flex-shrink-0 text-xs" aria-hidden="true">
                          {idx + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-900 break-words">{stageLabel(scan.stage)}</p>
                          <p className="text-xs text-slate-500 mt-0.5 break-words">{scan.operator} · {formatDateTime(scan.timestamp)}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-sm text-slate-500">Belum ada riwayat scan untuk bundel ini.</p>
                )}
              </DetailBlock>
              <DetailBlock title="QR Bundel">
                <div className="flex items-center gap-3">
                  <span className="inline-flex rounded-lg border border-border bg-white p-2">
                    <QRCodeSVG
                      value={detailBundle.id}
                      size={96}
                      level="M"
                      role="img"
                      aria-label={`Kode QR bundel ${detailBundle.id}`}
                    />
                  </span>
                  <p className="text-sm text-muted-foreground text-pretty">
                    Scan QR ini di setiap tahap untuk mencatat perpindahan bundel.
                  </p>
                </div>
              </DetailBlock>
            </>
          );
        })()}
      </DetailDrawer>

      {/* CREATE BUNDLES MODAL */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="Buat Bundel"
        subtitle="Bundel bernomor dibuat dari SPK setelah kain dipotong, lengkap dengan QR-nya."
        maxWidth="lg"
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0" aria-live="polite">
              <span className="block text-xs font-medium text-muted-foreground">Akan dibuat</span>
              <span className="block text-sm font-bold tabular-nums text-foreground">
                {numberOfBundles} bundel × {bundleQty} pcs = {numberOfBundles * bundleQty} pcs
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={savingBundles}
                onClick={() => setIsCreateModalOpen(false)}
              >
                Batal
              </Button>
              <Button type="submit" form="bundle-create-form" disabled={savingBundles}>
                {savingBundles ? 'Menyimpan…' : 'Buat Bundel'}
              </Button>
            </div>
          </div>
        }
      >
        <form id="bundle-create-form" noValidate onSubmit={handleCreateBundles} className="space-y-5">
          <FormError>{createError}</FormError>

          <FormSection title="Sumber potongan">
            <div>
              <FieldLabel htmlFor="bnd-spk" required>SPK</FieldLabel>
              <Select
                id="bnd-spk"
                value={selectedSpkId}
                aria-invalid={!!createFieldErrors.spkId}
                aria-describedby={createFieldErrors.spkId ? 'bnd-spk-error' : undefined}
                onChange={(e) => {
                  setCreateFieldErrors(prev => ({ ...prev, spkId: '' }));
                  setSelectedSpkId(e.target.value);
                }}
              >
                <option value="">Pilih SPK sumber potongan</option>
                {spks.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.id} - {s.productName} ({s.targetQty} Pcs)
                  </option>
                ))}
              </Select>
              <FieldError id="bnd-spk-error">{createFieldErrors.spkId}</FieldError>
            </div>

            <div>
              <FieldLabel htmlFor="bnd-component">Bagian potongan</FieldLabel>
              <Select
                id="bnd-component"
                value={bundleComponent}
                onChange={(e) => setBundleComponent(e.target.value as any)}
              >
                <option value="Full Set">Satu Set (Badan, Lengan, Kerah)</option>
                <option value="Badan Depan/Belakang">Badan Depan & Belakang</option>
                <option value="Lengan">Lengan</option>
                <option value="Kerah/Rib">Kerah / Rib</option>
              </Select>
            </div>
          </FormSection>

          <FormSection title="Ukuran, warna & isi bundel">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <FieldLabel htmlFor="bnd-size" required>Ukuran</FieldLabel>
                <Select
                  id="bnd-size"
                  value={bundleSize}
                  aria-invalid={!!createFieldErrors.size}
                  aria-describedby={createFieldErrors.size ? 'bnd-size-error' : undefined}
                  onChange={(e) => {
                    setCreateFieldErrors(prev => ({ ...prev, size: '' }));
                    setBundleSize(e.target.value);
                  }}
                >
                  <option value="">Pilih ukuran</option>
                  <option value="S">S</option>
                  <option value="M">M</option>
                  <option value="L">L</option>
                  <option value="XL">XL</option>
                  <option value="XXL">XXL</option>
                  <option value="3XL">3XL</option>
                </Select>
                <FieldError id="bnd-size-error">{createFieldErrors.size}</FieldError>
              </div>

              <div>
                <FieldLabel htmlFor="bnd-color">Warna kain</FieldLabel>
                <Input
                  id="bnd-color"
                  type="text"
                  placeholder="Contoh: Hitam"
                  value={bundleColor}
                  onChange={(e) => setBundleColor(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <FieldLabel htmlFor="bnd-qty" required>Isi per bundel (pcs)</FieldLabel>
                <Input
                  id="bnd-qty"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={bundleQty}
                  aria-invalid={!!createFieldErrors.quantity}
                  aria-describedby={createFieldErrors.quantity ? 'bnd-qty-error' : undefined}
                  onChange={(e) => {
                    setCreateFieldErrors(prev => ({ ...prev, quantity: '' }));
                    setBundleQty(toCount(e.target.value));
                  }}
                  className="text-right font-semibold tabular-nums"
                />
                <FieldError id="bnd-qty-error">{createFieldErrors.quantity}</FieldError>
              </div>

              <div>
                <FieldLabel htmlFor="bnd-count" required>Jumlah bundel</FieldLabel>
                <Input
                  id="bnd-count"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={MAX_BUNDLES_PER_BATCH}
                  value={numberOfBundles}
                  aria-invalid={!!createFieldErrors.count}
                  aria-describedby={createFieldErrors.count ? 'bnd-count-error' : 'bnd-count-hint'}
                  onChange={(e) => {
                    setCreateFieldErrors(prev => ({ ...prev, count: '' }));
                    setNumberOfBundles(toCount(e.target.value));
                  }}
                  className="text-right font-semibold tabular-nums"
                />
                {createFieldErrors.count ? (
                  <FieldError id="bnd-count-error">{createFieldErrors.count}</FieldError>
                ) : (
                  <FieldHint id="bnd-count-hint">Maksimal {MAX_BUNDLES_PER_BATCH} bundel sekali buat.</FieldHint>
                )}
              </div>
            </div>
          </FormSection>
        </form>
      </Modal>

      {/* STAGE UPDATE MODAL (after a scan) */}
      <Modal
        isOpen={!!stageBundle}
        onClose={() => setStageBundle(null)}
        title="Pindah Tahap Bundel"
        subtitle={stageBundle ? `Bundel ${stageBundle.id} · SPK ${stageBundle.spkId}` : undefined}
        maxWidth="lg"
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0" aria-live="polite">
              <span className="block text-xs font-medium text-muted-foreground">Tahap</span>
              <span className="block text-sm font-bold text-foreground">
                {stageBundle
                  ? `${stageLabel(stageBundle.currentStage)} ke ${stageLabel(nextStageOf(stageBundle.currentStage))}`
                  : 'Belum ada bundel dipindai'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" disabled={savingStage} onClick={() => setStageBundle(null)}>
                Batal
              </Button>
              <Button type="submit" form="bundle-stage-form" disabled={savingStage}>
                {savingStage ? 'Menyimpan…' : 'Simpan Perpindahan'}
              </Button>
            </div>
          </div>
        }
      >
        {stageBundle && (
          <form id="bundle-stage-form" noValidate onSubmit={handleConfirmStage} className="space-y-5">
            <FormError>{stageError}</FormError>

            <div className="rounded-2xl border border-border bg-muted/30 p-4">
              <div className="flex items-start justify-between gap-3">
                <dl className="min-w-0 space-y-2 text-sm">
                  <div className="flex gap-2">
                    <dt className="text-muted-foreground">Kode bundel</dt>
                    <dd className="min-w-0 break-words font-mono font-semibold text-foreground">{stageBundle.id}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-muted-foreground">Ukuran & isi</dt>
                    <dd className="font-semibold text-foreground tabular-nums">
                      {stageBundle.size} · {stageBundle.quantity} pcs
                    </dd>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <dt className="text-muted-foreground">Perpindahan</dt>
                    <dd className="flex items-center gap-1.5 font-semibold text-foreground">
                      {stageLabel(stageBundle.currentStage)}
                      <ArrowRight size={14} className="text-brand-teal-dark" aria-hidden="true" />
                      <span className="sr-only">ke</span>
                      {stageLabel(nextStageOf(stageBundle.currentStage))}
                    </dd>
                  </div>
                </dl>
                <div className="shrink-0 rounded-lg border border-border bg-white p-2">
                  <QRCodeSVG
                    value={stageBundle.id}
                    size={56}
                    level="M"
                    role="img"
                    aria-label={`Kode QR bundel ${stageBundle.id}`}
                  />
                </div>
              </div>
            </div>

            <div>
              <FieldLabel htmlFor="bnd-stage-operator" required>Operator yang memindai</FieldLabel>
              <Input
                id="bnd-stage-operator"
                type="text"
                placeholder="Contoh: Operator Scan"
                value={stageOperator}
                aria-invalid={!!stageFieldErrors.operator}
                aria-describedby={stageFieldErrors.operator ? 'bnd-stage-operator-error' : 'bnd-stage-operator-hint'}
                onChange={(e) => {
                  setStageFieldErrors(prev => ({ ...prev, operator: '' }));
                  setStageOperator(e.target.value);
                }}
              />
              {stageFieldErrors.operator ? (
                <FieldError id="bnd-stage-operator-error">{stageFieldErrors.operator}</FieldError>
              ) : (
                <FieldHint id="bnd-stage-operator-hint">Nama ini tercatat di riwayat scan bundel.</FieldHint>
              )}
            </div>
          </form>
        )}
      </Modal>

      {/* SCANNER MODAL */}
      <ScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScanSuccess={handleScanCode}
        title="Scan QR Bundel"
        subtitle="Arahkan kamera ke QR pada tiket bundel."
      />

      <Toast toast={toast} />
    </div>
  );
};
