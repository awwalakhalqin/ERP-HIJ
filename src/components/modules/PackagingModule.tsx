import React, { useState, useEffect } from 'react';
import { Package, Search, Plus, Download, CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react';
import { PackagingSlip, SPK, QCReport } from '../../types';
import { fetchResource, createResource } from '../../services/api';
import { formatDate, formatDateTime, exportTableToExcel, generateId } from '../../lib/utils';
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
  FormNotice,
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
  TableSortHead,
  sortRows,
  TableRowActions,
  TableEmptyRow,
  TableSkeletonRows,
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

/** Packing checklist (SOP-13): the three checks recorded on every box. */
const PACKING_CHECKS: {
  key: 'steamedAndFoldedOk' | 'polybagCleanOk' | 'boxLabelAttached';
  id: string;
  label: string;
}[] = [
  { key: 'steamedAndFoldedOk', id: 'pkg-check-steamed', label: 'Setrika & lipat sudah sesuai standar' },
  { key: 'polybagCleanOk', id: 'pkg-check-polybag', label: 'Polybag bersih, rapat, dan tidak sobek' },
  { key: 'boxLabelAttached', id: 'pkg-check-label', label: 'Label box sudah ditempel' }
];

// Icon is decorative; the text label carries the result.
const CheckValue: React.FC<{ ok: boolean; okText: string; notOkText: string }> = ({ ok, okText, notOkText }) => (
  ok ? (
    <span className="font-semibold text-emerald-700 inline-flex items-center gap-1">
      <CheckCircle2 size={15} className="shrink-0" aria-hidden="true" /> {okText}
    </span>
  ) : (
    <span className="font-semibold text-brand-red inline-flex items-center gap-1">
      <AlertTriangle size={15} className="shrink-0" aria-hidden="true" /> {notOkText}
    </span>
  )
);

/*
 * A box is only ready to leave once all three SOP-13 checks pass, so the table
 * carries one roll-up status and the drawer keeps each check on its own line.
 */
const packingStatus = (slip: PackagingSlip) =>
  slip.steamedAndFoldedOk && slip.polybagCleanOk && slip.boxLabelAttached ? 'Compliant' : 'Needs Attention';

export const PackagingModule: React.FC = () => {
  const [slips, setSlips] = useState<PackagingSlip[]>([]);
  const [spks, setSpks] = useState<SPK[]>([]);
  const [qcReports, setQcReports] = useState<QCReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<SortState>({ key: 'timestamp', direction: 'desc' });
  const [detailSlip, setDetailSlip] = useState<PackagingSlip | null>(null);

  const [formData, setFormData] = useState<Partial<PackagingSlip>>({
    spkId: '',
    boxNumber: 1,
    totalBoxes: 2,
    totalQtyInBox: 25,
    weightKg: 6.5,
    steamedAndFoldedOk: true,
    polybagCleanOk: true,
    boxLabelAttached: true,
    packedBy: ''
  });

  const loadData = async () => {
    try {
      setLoading(true);
      const [packRes, spkRes, qcRes] = await Promise.all([
        fetchResource<PackagingSlip>('packaging-slips'),
        fetchResource<SPK>('spk_produksi'),
        fetchResource<QCReport>('qc-reports')
      ]);
      setSlips(packRes);
      setSpks(spkRes);
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

  /*
   * SOP-13: only a lot QC has accepted may be boxed. The server enforces the
   * same rule; filtering here keeps the dropdown honest about what it offers.
   */
  const acceptedSpkIds = new Set(
    qcReports.filter(r => r.status === 'Accept').map(r => String(r.spkId || '').toLowerCase())
  );
  const packableSpks = spks.filter(s => acceptedSpkIds.has(String(s.id).toLowerCase()));
  const selectedSpk = packableSpks.find(s => s.id === formData.spkId);

  const handleCreatePacking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    const boxNo = Number(formData.boxNumber);
    const boxTotal = Number(formData.totalBoxes);
    const qtyInBox = Number(formData.totalQtyInBox);
    const weight = Number(formData.weightKg);
    const spk = selectedSpk;

    const errors: Record<string, string> = {};
    if (!formData.spkId) errors.spkId = 'Pilih SPK yang isinya dikemas di box ini.';
    else if (!spk) errors.spkId = 'SPK ini belum lolos QC (Accept), jadi belum boleh dikemas.';
    if (!(boxNo > 0)) errors.boxNumber = 'Nomor box minimal 1.';
    else if (boxTotal > 0 && boxNo > boxTotal) {
      errors.boxNumber = `Nomor box tidak boleh melebihi total ${boxTotal} box.`;
    }
    if (!(boxTotal > 0)) errors.totalBoxes = 'Total box minimal 1.';
    if (!(qtyInBox > 0)) errors.totalQtyInBox = 'Isi box minimal 1 pcs.';
    if (!(weight > 0)) errors.weightKg = 'Berat box harus lebih dari 0 Kg.';

    if (Object.keys(errors).length > 0 || !spk) {
      setFieldErrors(errors);
      setFormError('Lengkapi isian yang ditandai merah, lalu simpan lagi.');
      const fieldIds: Record<string, string> = {
        spkId: 'pkg-spk',
        boxNumber: 'pkg-box-number',
        totalBoxes: 'pkg-total-boxes',
        totalQtyInBox: 'pkg-qty',
        weightKg: 'pkg-weight'
      };
      const firstField = ['spkId', 'boxNumber', 'totalBoxes', 'totalQtyInBox', 'weightKg']
        .find(key => errors[key]);
      if (firstField) document.getElementById(fieldIds[firstField])?.focus();
      return;
    }

    setFieldErrors({});
    setFormError(null);
    setSaving(true);

    // The box belongs to the SPK's real order; there is no generic fallback.
    const slip: PackagingSlip = {
      id: generateId('BOX'),
      orderId: spk.orderId,
      spkId: spk.id,
      boxNumber: Number(formData.boxNumber) || 1,
      totalBoxes: Number(formData.totalBoxes) || 1,
      itemsInBox: [{ size: 'All Size', color: 'Mix', qty: Number(formData.totalQtyInBox) || 10 }],
      totalQtyInBox: Number(formData.totalQtyInBox) || 10,
      weightKg: Number(formData.weightKg) || 1,
      steamedAndFoldedOk: formData.steamedAndFoldedOk ?? true,
      polybagCleanOk: formData.polybagCleanOk ?? true,
      boxLabelAttached: formData.boxLabelAttached ?? true,
      packedBy: formData.packedBy || 'Packing Team',
      timestamp: new Date().toISOString()
    };

    try {
      await createResource('packaging-slips', slip);
      setIsModalOpen(false);
      loadData();
    } catch (err: any) {
      setFormError(err?.message || 'Data box gagal disimpan. Periksa koneksi ke server, lalu simpan lagi.');
    } finally {
      setSaving(false);
    }
  };

  const handleOpenModal = () => {
    setFieldErrors({});
    setFormError(null);
    setIsModalOpen(true);
  };

  const filteredSlips = slips.filter(slip =>
    slip.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
    slip.spkId.toLowerCase().includes(searchQuery.toLowerCase()) ||
    slip.packedBy.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Every sortable column maps straight onto a stored field.
  const sortedSlips = sortRows(filteredSlips, sort, (slip, key) => (slip as any)[key]);

  const { pageRows: pagedSlips, pagination } = useTablePage(sortedSlips);

  const isSearching = searchQuery.trim() !== '';

  // Headline numbers echoed in the modal footer while the staff types.
  const formQtyInBox = Number(formData.totalQtyInBox) || 0;
  const formWeightKg = Number(formData.weightKg) || 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pengemasan"
        description="Catat isi, berat, dan kelengkapan setiap box sebelum dikirim."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportTableToExcel(slips, 'Packing_List_Box_HIJ')}
            >
              <Download size={16} aria-hidden="true" /> Unduh Excel
            </Button>
            <Button size="sm" onClick={() => handleOpenModal()}>
              <Plus size={16} aria-hidden="true" /> Tambah Box
            </Button>
          </>
        }
      />

      {/* FILTER & SEARCH */}
      <Card className="p-4 flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
        <div className="relative w-full sm:w-80">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <Input
            type="search"
            aria-label="Cari box"
            placeholder="Cari box, SPK, atau petugas…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <p role="status" className="text-sm text-slate-600 tabular-nums">
          {loading && slips.length === 0
            ? 'Memuat…'
            : isSearching
              ? `${filteredSlips.length} dari ${slips.length} box`
              : `${slips.length} box`}
        </p>
      </Card>

      {/* PACKAGING BOXES TABLE */}
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableSortHead sortKey="id" sort={sort} onSortChange={setSort} className="cell-sticky-start">
                No. Box
              </TableSortHead>
              <TableSortHead sortKey="spkId" sort={sort} onSortChange={setSort} className="hidden md:table-cell">
                SPK
              </TableSortHead>
              <TableSortHead sortKey="packedBy" sort={sort} onSortChange={setSort} className="hidden md:table-cell">
                Petugas
              </TableSortHead>
              <TableSortHead
                sortKey="boxNumber"
                sort={sort}
                onSortChange={setSort}
                align="right"
                className="hidden sm:table-cell tabular-nums"
              >
                Box ke-
              </TableSortHead>
              <TableSortHead
                sortKey="totalQtyInBox"
                sort={sort}
                onSortChange={setSort}
                align="right"
                className="hidden sm:table-cell tabular-nums"
              >
                Isi (Pcs)
              </TableSortHead>
              <TableSortHead
                sortKey="weightKg"
                sort={sort}
                onSortChange={setSort}
                align="right"
                className="hidden sm:table-cell tabular-nums"
              >
                Berat (Kg)
              </TableSortHead>
              <TableSortHead sortKey="timestamp" sort={sort} onSortChange={setSort} className="hidden lg:table-cell">
                Tanggal
              </TableSortHead>
              <TableHead className="text-center">Kelengkapan</TableHead>
              <TableHead className="cell-sticky-end text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && slips.length === 0 ? (
              <TableSkeletonRows columns={9} />
            ) : sortedSlips.length === 0 ? (
              <TableEmptyRow
                colSpan={9}
                icon={<Package size={20} />}
                title={isSearching ? 'Tidak ada box yang cocok' : 'Belum ada data box'}
                description={
                  isSearching
                    ? 'Coba cari dengan nomor box, SPK, atau nama petugas lain.'
                    : 'Tambahkan box setelah produk lulus QC, disetrika, dan dikemas.'
                }
                action={
                  isSearching ? (
                    <Button variant="outline" size="sm" onClick={() => setSearchQuery('')}>
                      Hapus Pencarian
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => handleOpenModal()}>
                      <Plus size={16} aria-hidden="true" /> Tambah Box
                    </Button>
                  )
                }
              />
            ) : (
              pagedSlips.map(slip => (
                <TableRow key={slip.id}>
                  <TableCell className="cell-sticky-start font-mono font-bold text-slate-900">
                    {slip.id}
                  </TableCell>
                  <TableCell className="hidden md:table-cell font-mono text-teal-700">
                    {slip.spkId || '—'}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <span className="block max-w-[180px] truncate" title={slip.packedBy}>
                      {slip.packedBy || '—'}
                    </span>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-right tabular-nums">
                    {slip.boxNumber}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-right tabular-nums font-bold text-slate-900">
                    {slip.totalQtyInBox}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-right tabular-nums">
                    {slip.weightKg}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {formatDate(slip.timestamp)}
                  </TableCell>
                  <TableCell className="text-center">
                    <StatusBadge status={packingStatus(slip)} size="sm" solid />
                  </TableCell>
                  <TableCell className="cell-sticky-end text-right">
                    <TableRowActions>
                      <RowDetailButton label={slip.id} onClick={() => setDetailSlip(slip)} />
                    </TableRowActions>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <TablePagination {...pagination} label="box" />
      </Card>

      <DetailDrawer
        isOpen={!!detailSlip}
        onClose={() => setDetailSlip(null)}
        title={detailSlip && `Box ${detailSlip.boxNumber} dari ${detailSlip.totalBoxes}`}
        subtitle={detailSlip && (
          <span className="font-mono">{detailSlip.id} · {formatDate(detailSlip.timestamp)}</span>
        )}
        status={detailSlip && <StatusBadge status={packingStatus(detailSlip)} size="sm" solid />}
      >
        {detailSlip && (
          <>
            <DetailStats
              items={[
                { label: 'Isi box', value: `${detailSlip.totalQtyInBox} Pcs`, tone: 'accent' },
                { label: 'Berat', value: `${detailSlip.weightKg} Kg` }
              ]}
            />
            <DetailSection title="Box">
              <DetailField label="No. box" mono>{detailSlip.id}</DetailField>
              <DetailField label="Box ke-">{detailSlip.boxNumber} dari {detailSlip.totalBoxes}</DetailField>
              <DetailField label="No. pesanan" mono>{detailSlip.orderId}</DetailField>
              <DetailField label="SPK" mono>{detailSlip.spkId}</DetailField>
            </DetailSection>
            <DetailSection title="Checklist Pengemasan">
              <DetailField label="Setrika & lipat">
                <CheckValue ok={detailSlip.steamedAndFoldedOk} okText="Sesuai standar" notOkText="Belum sesuai" />
              </DetailField>
              <DetailField label="Polybag">
                <CheckValue ok={detailSlip.polybagCleanOk} okText="Bersih & rapat" notOkText="Belum bersih" />
              </DetailField>
              <DetailField label="Label box">
                <CheckValue ok={detailSlip.boxLabelAttached} okText="Sudah ditempel" notOkText="Belum ditempel" />
              </DetailField>
            </DetailSection>
            {(detailSlip.itemsInBox?.length ?? 0) > 0 && (
              <DetailBlock title="Rincian Isi Box">
                <ul role="list" className="divide-y divide-border rounded-xl border border-border">
                  {detailSlip.itemsInBox.map((item, i) => (
                    <li
                      key={`${item.size}-${item.color}-${i}`}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                    >
                      <span className="min-w-0 break-words font-medium text-foreground">
                        {item.size} · {item.color}
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums text-foreground">{item.qty} Pcs</span>
                    </li>
                  ))}
                </ul>
              </DetailBlock>
            )}
            <DetailSection title="Riwayat Data">
              <DetailField label="Dikemas oleh">{detailSlip.packedBy}</DetailField>
              <DetailField label="Dicatat pada">{formatDateTime(detailSlip.timestamp)}</DetailField>
            </DetailSection>
          </>
        )}
      </DetailDrawer>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Tambah Box"
        subtitle="Catat isi, berat, dan kelengkapan box sebelum box ditutup."
        maxWidth="2xl"
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <span className="block text-xs font-medium text-muted-foreground">Isi box ini</span>
              <span className="block text-lg font-bold tabular-nums text-foreground" aria-live="polite">
                {formQtyInBox} Pcs · {formWeightKg} Kg
              </span>
              <span className="block text-xs text-muted-foreground tabular-nums">
                Box {Number(formData.boxNumber) || 0} dari {Number(formData.totalBoxes) || 0}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => setIsModalOpen(false)}
              >
                Batal
              </Button>
              <Button type="submit" form="packaging-form" disabled={saving}>
                {saving ? 'Menyimpan…' : 'Simpan Box'}
              </Button>
            </div>
          </div>
        }
      >
        <form id="packaging-form" noValidate onSubmit={handleCreatePacking} className="space-y-5">
          <FormError>{formError}</FormError>

          <FormSection step={1} title="Pesanan & box" description="Box ini milik SPK mana, dan nomor berapa dari total kiriman.">
            <FormNotice icon={<ShieldCheck size={18} />} title="Hanya SPK yang sudah lolos QC (Accept) yang bisa dikemas">
              Lot yang ditolak atau masih diperbaiki tidak muncul di daftar. Catat hasil QC Accept dulu di halaman
              Pemeriksaan QC.
            </FormNotice>

            <div>
              <FieldLabel htmlFor="pkg-spk" required>SPK</FieldLabel>
              <Select
                id="pkg-spk"
                value={formData.spkId}
                aria-invalid={!!fieldErrors.spkId}
                aria-describedby={fieldErrors.spkId ? 'pkg-spk-error' : 'pkg-spk-hint'}
                onChange={(e) => {
                  setFieldErrors(prev => ({ ...prev, spkId: '' }));
                  setFormData({ ...formData, spkId: e.target.value });
                }}
              >
                <option value="">Pilih SPK yang lolos QC</option>
                {packableSpks.map(s => (
                  <option key={s.id} value={s.id}>{s.id} - {s.productName} ({s.targetQty} Pcs)</option>
                ))}
              </Select>
              {fieldErrors.spkId ? (
                <FieldError id="pkg-spk-error">{fieldErrors.spkId}</FieldError>
              ) : packableSpks.length === 0 ? (
                <FieldHint id="pkg-spk-hint">
                  {spks.length === 0
                    ? 'Belum ada SPK produksi. Minta PPIC menerbitkan SPK dulu.'
                    : 'Belum ada SPK yang lolos QC. Box baru bisa dicatat setelah ada hasil QC Accept.'}
                </FieldHint>
              ) : (
                <FieldHint id="pkg-spk-hint">
                  {selectedSpk
                    ? `Pesanan ${selectedSpk.po || selectedSpk.orderId} · ${selectedSpk.customerName}`
                    : `${packableSpks.length} SPK lolos QC dan siap dikemas.`}
                </FieldHint>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <FieldLabel htmlFor="pkg-box-number" required>Box ke-</FieldLabel>
                <Input
                  id="pkg-box-number"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={formData.boxNumber}
                  aria-invalid={!!fieldErrors.boxNumber}
                  aria-describedby={fieldErrors.boxNumber ? 'pkg-box-number-error' : undefined}
                  onChange={(e) => {
                    setFieldErrors(prev => ({ ...prev, boxNumber: '' }));
                    setFormData({ ...formData, boxNumber: Number(e.target.value) });
                  }}
                  className="text-right font-semibold tabular-nums"
                />
                <FieldError id="pkg-box-number-error">{fieldErrors.boxNumber}</FieldError>
              </div>
              <div>
                <FieldLabel htmlFor="pkg-total-boxes" required>Total box</FieldLabel>
                <Input
                  id="pkg-total-boxes"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={formData.totalBoxes}
                  aria-invalid={!!fieldErrors.totalBoxes}
                  aria-describedby={fieldErrors.totalBoxes ? 'pkg-total-boxes-error' : undefined}
                  onChange={(e) => {
                    setFieldErrors(prev => ({ ...prev, totalBoxes: '', boxNumber: '' }));
                    setFormData({ ...formData, totalBoxes: Number(e.target.value) });
                  }}
                  className="text-right font-semibold tabular-nums"
                />
                <FieldError id="pkg-total-boxes-error">{fieldErrors.totalBoxes}</FieldError>
              </div>
            </div>
          </FormSection>

          <FormSection step={2} title="Isi & berat" description="Jumlah potong di dalam box dan berat timbangannya.">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <FieldLabel htmlFor="pkg-qty" required>Isi box (Pcs)</FieldLabel>
                <Input
                  id="pkg-qty"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={formData.totalQtyInBox}
                  aria-invalid={!!fieldErrors.totalQtyInBox}
                  aria-describedby={fieldErrors.totalQtyInBox ? 'pkg-qty-error' : undefined}
                  onChange={(e) => {
                    setFieldErrors(prev => ({ ...prev, totalQtyInBox: '' }));
                    setFormData({ ...formData, totalQtyInBox: Number(e.target.value) });
                  }}
                  className="text-right font-semibold tabular-nums"
                />
                <FieldError id="pkg-qty-error">{fieldErrors.totalQtyInBox}</FieldError>
              </div>
              <div>
                <FieldLabel htmlFor="pkg-weight" required>Berat box (Kg)</FieldLabel>
                <div className="relative">
                  <Input
                    id="pkg-weight"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.1"
                    value={formData.weightKg}
                    aria-invalid={!!fieldErrors.weightKg}
                    aria-describedby={fieldErrors.weightKg ? 'pkg-weight-error' : 'pkg-weight-hint'}
                    onChange={(e) => {
                      setFieldErrors(prev => ({ ...prev, weightKg: '' }));
                      setFormData({ ...formData, weightKg: Number(e.target.value) });
                    }}
                    className="pr-10 text-right font-semibold tabular-nums"
                  />
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground"
                  >
                    Kg
                  </span>
                </div>
                {fieldErrors.weightKg ? (
                  <FieldError id="pkg-weight-error">{fieldErrors.weightKg}</FieldError>
                ) : (
                  <FieldHint id="pkg-weight-hint">Berat timbangan dalam kilogram, boleh desimal (contoh 6.5 Kg).</FieldHint>
                )}
              </div>
            </div>
          </FormSection>

          <FormSection step={3} title="Checklist pengemasan" description="Centang yang sudah diperiksa sebelum box ditutup dan disegel.">
            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-foreground">Kelengkapan box</legend>
              <div className="space-y-2">
                {PACKING_CHECKS.map(item => (
                  <label
                    key={item.id}
                    htmlFor={item.id}
                    className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border bg-muted/40 p-3 transition-colors hover:border-brand-teal/50"
                  >
                    <input
                      id={item.id}
                      type="checkbox"
                      checked={formData[item.key] ?? true}
                      onChange={(e) => setFormData({ ...formData, [item.key]: e.target.checked })}
                      className="size-5 shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal focus-visible:ring-offset-2"
                    />
                    <span className="text-sm font-medium text-slate-800">{item.label}</span>
                  </label>
                ))}
              </div>
              <FieldHint>Checklist yang tidak dicentang tetap tersimpan dan ditandai belum sesuai di daftar box.</FieldHint>
            </fieldset>

            <div>
              <FieldLabel htmlFor="pkg-packed-by">Nama petugas</FieldLabel>
              <Input
                id="pkg-packed-by"
                type="text"
                placeholder="Contoh: Dewi & Maya"
                value={formData.packedBy}
                onChange={(e) => setFormData({ ...formData, packedBy: e.target.value })}
              />
            </div>
          </FormSection>
        </form>
      </Modal>
    </div>
  );
};
