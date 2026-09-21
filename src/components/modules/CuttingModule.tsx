import React, { useState, useEffect } from 'react';
import { Scissors, Search, Plus, Download, CalendarDays } from 'lucide-react';
import { CuttingBatch, SPK } from '../../types';
import { fetchResource, createResource, updateResource } from '../../services/api';
import { formatDate, exportTableToExcel, generateId } from '../../lib/utils';
import { Badge, StatusBadge } from '../ui/Badge';
import { Modal } from '../ui/Modal';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import {
  FieldLabel,
  FieldHint,
  FieldError,
  FormError,
  FormNotice,
  FormSection,
  Select
} from '../ui/Field';
import { PageHeader } from '../ui/PageHeader';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell, TableRowActions, TableEmptyRow, TableSkeletonRows } from '../ui/Table';
import { DetailDrawer, DetailSection, DetailField, DetailStats, RowDetailButton } from '../ui/DetailDrawer';
import { newestFirst } from '../../lib/ordering';

// Order the first invalid field is focused in, matching the form's reading order.
const CUT_FIELD_IDS: Record<string, string> = {
  spkId: 'cut-spk',
  layersCount: 'cut-layers',
  markerLengthMeters: 'cut-marker',
  totalFabricUsedMeters: 'cut-used',
  totalPiecesCut: 'cut-pieces',
  cuttingYieldPercentage: 'cut-yield'
};

export const CuttingModule: React.FC = () => {
  const [batches, setBatches] = useState<CuttingBatch[]>([]);
  const [spks, setSpks] = useState<SPK[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [detailBatch, setDetailBatch] = useState<CuttingBatch | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [formData, setFormData] = useState<Partial<CuttingBatch>>({
    spkId: '',
    fabricLotId: 'LOT-CC24S-001',
    fabricName: 'Cotton Combed 24s',
    color: 'Hitam Reaktif',
    layersCount: 25,
    markerLengthMeters: 4.2,
    totalFabricUsedMeters: 105,
    cuttingYieldPercentage: 88,
    totalPiecesCut: 50,
    defectRemnantsMeters: 2.5,
    operatorCutting: 'Budi Santoso',
    status: 'Completed',
    notes: 'Kain telah diistirahatkan (relaksasi) 12 jam sebelum potong.'
  });

  const loadData = async () => {
    try {
      setLoading(true);
      const [batchRes, spkRes] = await Promise.all([
        fetchResource<CuttingBatch>('cutting-batches'),
        fetchResource<SPK>('spk_produksi')
      ]);
      setBatches(batchRes.length > 0 ? batchRes : [
        {
          id: 'CUT-2026-001',
          spkId: 'SPK-ORD-001',
          fabricLotId: 'LOT-TASLAN-003',
          fabricName: 'Taslan Milky WP',
          color: 'Custom',
          layersCount: 23,
          markerLengthMeters: 3.8,
          totalFabricUsedMeters: 87.4,
          cuttingYieldPercentage: 86,
          totalPiecesCut: 46,
          defectRemnantsMeters: 1.8,
          cuttingDate: '2026-09-02',
          operatorCutting: 'Budi Santoso',
          status: 'Completed',
          notes: 'Potongan telah diikat per komponen dan diberi nomor tiket.'
        },
        {
          id: 'CUT-2026-002',
          spkId: 'SPK-ORD-002',
          fabricLotId: 'LOT-CC24S-002',
          fabricName: 'Cotton Combed 24s',
          color: 'Turquoise',
          layersCount: 37,
          markerLengthMeters: 2.1,
          totalFabricUsedMeters: 77.7,
          cuttingYieldPercentage: 90,
          totalPiecesCut: 37,
          defectRemnantsMeters: 0.9,
          cuttingDate: '2026-08-22',
          operatorCutting: 'Budi Santoso',
          status: 'Completed'
        }
      ]);
      setSpks(spkRes);
      if (spkRes.length > 0 && !formData.spkId) {
        setFormData(prev => ({ ...prev, spkId: spkRes[0].id }));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleOpenModal = () => {
    setFieldErrors({});
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleCreateBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    const layers = Number(formData.layersCount);
    const marker = Number(formData.markerLengthMeters);
    const fabricUsed = Number(formData.totalFabricUsedMeters);
    const pieces = Number(formData.totalPiecesCut);
    const yieldPct = Number(formData.cuttingYieldPercentage);

    const errors: Record<string, string> = {};
    if (!formData.spkId) errors.spkId = 'Pilih SPK yang kainnya dipotong.';
    if (!(layers > 0)) errors.layersCount = 'Tumpukan kain minimal 1 lembar.';
    if (!(marker > 0)) errors.markerLengthMeters = 'Panjang marker harus lebih dari 0 meter.';
    if (!(fabricUsed > 0)) errors.totalFabricUsedMeters = 'Kain terpakai harus lebih dari 0 meter.';
    if (!(pieces > 0)) errors.totalPiecesCut = 'Hasil potong minimal 1 pcs.';
    if (!(yieldPct >= 1 && yieldPct <= 100)) {
      errors.cuttingYieldPercentage = 'Efisiensi kain diisi antara 1% dan 100%.';
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setFormError('Lengkapi isian yang ditandai merah, lalu simpan lagi.');
      const firstField = Object.keys(CUT_FIELD_IDS).find(key => errors[key]);
      if (firstField) document.getElementById(CUT_FIELD_IDS[firstField])?.focus();
      return;
    }

    setFieldErrors({});
    setFormError(null);
    setSaving(true);

    const batch: CuttingBatch = {
      id: generateId('CUT'),
      spkId: formData.spkId || 'SPK-GEN',
      fabricLotId: formData.fabricLotId || 'LOT-GEN',
      fabricName: formData.fabricName || 'Kain',
      color: formData.color || '-',
      layersCount: Number(formData.layersCount) || 1,
      markerLengthMeters: Number(formData.markerLengthMeters) || 1,
      totalFabricUsedMeters: Number(formData.totalFabricUsedMeters) || 1,
      cuttingYieldPercentage: Number(formData.cuttingYieldPercentage) || 85,
      totalPiecesCut: Number(formData.totalPiecesCut) || 10,
      defectRemnantsMeters: Number(formData.defectRemnantsMeters) || 0,
      cuttingDate: new Date().toISOString().split('T')[0],
      operatorCutting: formData.operatorCutting || 'Tukang Potong',
      status: formData.status as any || 'Completed',
      notes: formData.notes
    };

    try {
      await createResource('cutting-batches', batch);
      // Auto update SPK cutting stage count
      const spk = spks.find(s => s.id === batch.spkId);
      if (spk) {
        await updateResource('spk_produksi', spk.id, {
          cutting: (spk.cutting || 0) + batch.totalPiecesCut
        });
      }
      setIsModalOpen(false);
      loadData();
    } catch (err) {
      setFormError('Data pemotongan gagal disimpan. Periksa koneksi ke server, lalu simpan lagi.');
    } finally {
      setSaving(false);
    }
  };

  const filteredBatches = newestFirst(batches.filter(b =>
    b.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
    b.spkId.toLowerCase().includes(searchQuery.toLowerCase()) ||
    b.fabricName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    b.operatorCutting.toLowerCase().includes(searchQuery.toLowerCase())
  ));

  // Headline numbers shown in the modal footer while the operator types.
  const formPieces = Number(formData.totalPiecesCut) || 0;
  const formYield = Number(formData.cuttingYieldPercentage) || 0;
  const formFabricUsed = Number(formData.totalFabricUsedMeters) || 0;
  const batchDate = new Date().toISOString().split('T')[0];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pemotongan"
        description="Catat hasil potong per batch kain dan pantau efisiensinya."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportTableToExcel(batches, 'Laporan_Cutting_HIJ')}
            >
              <Download size={16} aria-hidden="true" /> Unduh Excel
            </Button>
            <Button size="sm" onClick={handleOpenModal}>
              <Plus size={16} aria-hidden="true" /> Catat Pemotongan
            </Button>
          </>
        }
      />

      <Card className="p-4">
        <div className="relative w-full sm:w-80">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <Input
            type="search"
            aria-label="Cari pemotongan"
            placeholder="Cari batch, SPK, kain, atau operator…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </Card>

      {/* CUTTING DATA TABLE */}
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="cell-sticky-start">Batch</TableHead>
              <TableHead className="hidden md:table-cell">SPK</TableHead>
              <TableHead className="hidden md:table-cell">Kain</TableHead>
              <TableHead className="hidden xl:table-cell">Warna</TableHead>
              <TableHead className="hidden sm:table-cell text-right">Hasil Potong</TableHead>
              <TableHead className="hidden lg:table-cell">Tanggal</TableHead>
              <TableHead className="text-center">Status</TableHead>
              <TableHead className="cell-sticky-end text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableSkeletonRows columns={8} />
            ) : filteredBatches.length === 0 ? (
              <TableEmptyRow
                colSpan={8}
                icon={<Scissors size={20} />}
                title={searchQuery ? 'Tidak ada batch yang cocok' : 'Belum ada data pemotongan'}
                description={searchQuery ? 'Coba kata kunci lain.' : 'Catat batch pertama setelah kain selesai dipotong.'}
              />
            ) : (
              filteredBatches.map(b => (
                <TableRow key={b.id}>
                  <TableCell className="cell-sticky-start whitespace-nowrap">
                    <span className="font-mono font-bold text-slate-900">{b.id}</span>
                  </TableCell>
                  <TableCell className="hidden md:table-cell whitespace-nowrap">
                    <Badge variant="teal" className="font-mono">{b.spkId}</Badge>
                  </TableCell>
                  <TableCell className="hidden md:table-cell font-semibold text-slate-900">
                    {b.fabricName}
                  </TableCell>
                  <TableCell className="hidden xl:table-cell text-slate-600">
                    {b.color}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-right whitespace-nowrap font-bold text-slate-900">
                    {b.totalPiecesCut} Pcs
                  </TableCell>
                  <TableCell className="hidden lg:table-cell whitespace-nowrap text-slate-600">
                    {formatDate(b.cuttingDate)}
                  </TableCell>
                  <TableCell className="text-center whitespace-nowrap">
                    <StatusBadge status={b.status} />
                  </TableCell>
                  <TableCell className="cell-sticky-end text-right">
                    <TableRowActions>
                      <RowDetailButton label={b.id} onClick={() => setDetailBatch(b)} />
                    </TableRowActions>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <DetailDrawer
        isOpen={!!detailBatch}
        onClose={() => setDetailBatch(null)}
        title={detailBatch?.fabricName}
        subtitle={detailBatch && <span className="font-mono">{detailBatch.id} · {formatDate(detailBatch.cuttingDate)}</span>}
        status={detailBatch && <StatusBadge status={detailBatch.status} />}
      >
        {detailBatch && (
          <>
            <DetailStats
              items={[
                { label: 'Hasil potong', value: `${detailBatch.totalPiecesCut} Pcs`, tone: 'accent' },
                { label: 'Kain terpakai', value: `${detailBatch.totalFabricUsedMeters} m` },
                { label: 'Efisiensi', value: `${detailBatch.cuttingYieldPercentage}%` }
              ]}
            />
            <DetailSection title="Batch">
              <DetailField label="SPK" mono>{detailBatch.spkId}</DetailField>
              <DetailField label="Operator">{detailBatch.operatorCutting}</DetailField>
              <DetailField label="Tanggal potong">{formatDate(detailBatch.cuttingDate)}</DetailField>
              <DetailField label="Status"><StatusBadge status={detailBatch.status} /></DetailField>
            </DetailSection>
            <DetailSection title="Kain">
              <DetailField label="Jenis kain">{detailBatch.fabricName}</DetailField>
              <DetailField label="Warna">{detailBatch.color}</DetailField>
              <DetailField label="No. lot" mono full>{detailBatch.fabricLotId}</DetailField>
              <DetailField label="Tumpukan">{detailBatch.layersCount} lembar</DetailField>
              <DetailField label="Panjang marker">{detailBatch.markerLengthMeters} m</DetailField>
              <DetailField label="Sisa kain cacat">{detailBatch.defectRemnantsMeters} m</DetailField>
            </DetailSection>
            <DetailSection title="Catatan">
              <DetailField label="Catatan operator" full>{detailBatch.notes}</DetailField>
            </DetailSection>
          </>
        )}
      </DetailDrawer>

      {/* CREATE CUTTING BATCH MODAL */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Catat Pemotongan"
        subtitle="Hasil potong satu batch kain untuk SPK yang sedang berjalan."
        maxWidth="2xl"
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <span className="block text-xs font-medium text-muted-foreground">Hasil potong</span>
              <span className="block text-lg font-bold tabular-nums text-foreground" aria-live="polite">
                {formPieces} pcs · efisiensi {formYield}%
              </span>
              <span className="block text-xs text-muted-foreground tabular-nums">
                {formFabricUsed} m kain terpakai
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" disabled={saving} onClick={() => setIsModalOpen(false)}>
                Batal
              </Button>
              <Button type="submit" form="cutting-form" disabled={saving}>
                {saving ? 'Menyimpan…' : 'Simpan'}
              </Button>
            </div>
          </div>
        }
      >
        <form id="cutting-form" noValidate onSubmit={handleCreateBatch} className="space-y-5">
          <FormError>{formError}</FormError>

          <FormNotice icon={<CalendarDays size={18} />} title={`Tanggal batch: ${formatDate(batchDate)}`}>
            Tanggal potong terisi otomatis dari hari penyimpanan, jadi tidak perlu diisi manual.
          </FormNotice>

          <FormSection step={1} title="SPK & operator">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <FieldLabel htmlFor="cut-spk" required>SPK</FieldLabel>
                <Select
                  id="cut-spk"
                  value={formData.spkId || ''}
                  aria-invalid={!!fieldErrors.spkId}
                  aria-describedby={fieldErrors.spkId ? 'cut-spk-error' : undefined}
                  onChange={(e) => {
                    setFieldErrors(prev => ({ ...prev, spkId: '' }));
                    setFormData({ ...formData, spkId: e.target.value });
                  }}
                >
                  <option value="">Pilih SPK yang dipotong</option>
                  {spks.map(s => (
                    <option key={s.id} value={s.id}>{s.id} - {s.productName} ({s.targetQty} Pcs)</option>
                  ))}
                </Select>
                <FieldError id="cut-spk-error">{fieldErrors.spkId}</FieldError>
              </div>

              <div>
                <FieldLabel htmlFor="cut-operator">Operator</FieldLabel>
                <Input
                  id="cut-operator"
                  type="text"
                  placeholder="Contoh: Budi Santoso"
                  value={formData.operatorCutting || ''}
                  onChange={(e) => setFormData({ ...formData, operatorCutting: e.target.value })}
                />
              </div>
            </div>
          </FormSection>

          <FormSection
            step={2}
            title="Kain"
            description="Tumpukan dan panjang marker menentukan kain terpakai."
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <FieldLabel htmlFor="cut-fabric">Jenis kain</FieldLabel>
                <Input
                  id="cut-fabric"
                  type="text"
                  placeholder="Contoh: Cotton Combed 24s"
                  value={formData.fabricName || ''}
                  onChange={(e) => setFormData({ ...formData, fabricName: e.target.value })}
                />
              </div>
              <div>
                <FieldLabel htmlFor="cut-color">Warna kain</FieldLabel>
                <Input
                  id="cut-color"
                  type="text"
                  placeholder="Contoh: Hitam Reaktif"
                  value={formData.color || ''}
                  onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <FieldLabel htmlFor="cut-layers" required>Tumpukan kain (lembar)</FieldLabel>
                <Input
                  id="cut-layers"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={formData.layersCount ?? ''}
                  aria-invalid={!!fieldErrors.layersCount}
                  aria-describedby={fieldErrors.layersCount ? 'cut-layers-error' : undefined}
                  onChange={(e) => {
                    const ply = Number(e.target.value);
                    const len = Number(formData.markerLengthMeters || 1);
                    setFieldErrors(prev => ({ ...prev, layersCount: '', totalFabricUsedMeters: '' }));
                    setFormData({
                      ...formData,
                      layersCount: ply,
                      totalFabricUsedMeters: Math.round(ply * len * 10) / 10
                    });
                  }}
                  className="text-right font-semibold tabular-nums"
                />
                <FieldError id="cut-layers-error">{fieldErrors.layersCount}</FieldError>
              </div>

              <div>
                <FieldLabel htmlFor="cut-marker" required>Panjang marker (m)</FieldLabel>
                <Input
                  id="cut-marker"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.1"
                  value={formData.markerLengthMeters ?? ''}
                  aria-invalid={!!fieldErrors.markerLengthMeters}
                  aria-describedby={fieldErrors.markerLengthMeters ? 'cut-marker-error' : undefined}
                  onChange={(e) => {
                    const len = Number(e.target.value);
                    const ply = Number(formData.layersCount || 1);
                    setFieldErrors(prev => ({ ...prev, markerLengthMeters: '', totalFabricUsedMeters: '' }));
                    setFormData({
                      ...formData,
                      markerLengthMeters: len,
                      totalFabricUsedMeters: Math.round(ply * len * 10) / 10
                    });
                  }}
                  className="text-right font-semibold tabular-nums"
                />
                <FieldError id="cut-marker-error">{fieldErrors.markerLengthMeters}</FieldError>
              </div>
            </div>

            <div>
              <FieldLabel htmlFor="cut-used" required>Kain terpakai (m)</FieldLabel>
              <Input
                id="cut-used"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.1"
                value={formData.totalFabricUsedMeters ?? ''}
                aria-invalid={!!fieldErrors.totalFabricUsedMeters}
                aria-describedby={
                  fieldErrors.totalFabricUsedMeters ? 'cut-used-error cut-used-hint' : 'cut-used-hint'
                }
                onChange={(e) => {
                  setFieldErrors(prev => ({ ...prev, totalFabricUsedMeters: '' }));
                  setFormData({ ...formData, totalFabricUsedMeters: Number(e.target.value) });
                }}
                className="text-right font-semibold tabular-nums"
              />
              <FieldError id="cut-used-error">{fieldErrors.totalFabricUsedMeters}</FieldError>
              <FieldHint id="cut-used-hint">
                Dihitung otomatis dari tumpukan × panjang marker. Boleh ditimpa jika hasil timbang kain berbeda.
              </FieldHint>
            </div>
          </FormSection>

          <FormSection step={3} title="Hasil potong">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <FieldLabel htmlFor="cut-pieces" required>Hasil potong (pcs)</FieldLabel>
                <Input
                  id="cut-pieces"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={formData.totalPiecesCut ?? ''}
                  aria-invalid={!!fieldErrors.totalPiecesCut}
                  aria-describedby={fieldErrors.totalPiecesCut ? 'cut-pieces-error' : undefined}
                  onChange={(e) => {
                    setFieldErrors(prev => ({ ...prev, totalPiecesCut: '' }));
                    setFormData({ ...formData, totalPiecesCut: Number(e.target.value) });
                  }}
                  className="text-right font-semibold tabular-nums"
                />
                <FieldError id="cut-pieces-error">{fieldErrors.totalPiecesCut}</FieldError>
              </div>

              <div>
                <FieldLabel htmlFor="cut-yield" required>Efisiensi kain (%)</FieldLabel>
                <Input
                  id="cut-yield"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={100}
                  value={formData.cuttingYieldPercentage ?? ''}
                  aria-invalid={!!fieldErrors.cuttingYieldPercentage}
                  aria-describedby={
                    fieldErrors.cuttingYieldPercentage ? 'cut-yield-error cut-yield-hint' : 'cut-yield-hint'
                  }
                  onChange={(e) => {
                    setFieldErrors(prev => ({ ...prev, cuttingYieldPercentage: '' }));
                    setFormData({ ...formData, cuttingYieldPercentage: Number(e.target.value) });
                  }}
                  className="text-right font-semibold tabular-nums"
                />
                <FieldError id="cut-yield-error">{fieldErrors.cuttingYieldPercentage}</FieldError>
                <FieldHint id="cut-yield-hint">Isi 1–100 sesuai realisasi marker.</FieldHint>
              </div>
            </div>
          </FormSection>
        </form>
      </Modal>
    </div>
  );
};
