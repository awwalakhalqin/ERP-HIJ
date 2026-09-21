import React, { useState, useEffect } from 'react';
import { Factory, Search, Plus, Download, CheckCircle2, AlertTriangle } from 'lucide-react';
import { SewingDailyLog, SPK, Operator } from '../../types';
import { fetchResource, createResource, updateResource } from '../../services/api';
import { formatDate, exportTableToExcel, generateId, cn } from '../../lib/utils';
import { Badge } from '../ui/Badge';
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
  ChipButton
} from '../ui/Field';
import { PageHeader } from '../ui/PageHeader';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell, TableRowActions, TableEmptyRow, TableSkeletonRows } from '../ui/Table';
import { DetailDrawer, DetailSection, DetailField, DetailStats, RowDetailButton } from '../ui/DetailDrawer';
import { newestFirst } from '../../lib/ordering';

// Order the first invalid field is focused in, matching the form's reading order.
const SEW_FIELD_IDS: Record<string, string> = {
  date: 'sew-date',
  operatorName: 'sew-operator',
  spkId: 'sew-spk',
  outputPieces: 'sew-output',
  defectPieces: 'sew-defect'
};

// Display labels only; stored operation values stay unchanged.
const OPERATION_LABELS: Record<string, string> = {
  'Jahit Utama': 'Jahit Utama',
  'Obras': 'Obras 4 Benang',
  'Pasang Kerah': 'Pasang Kerah / Rib',
  'Kelim Bawah': 'Kelim Bawah',
  'Finishing Detail': 'Finishing'
};

export const SewingModule: React.FC = () => {
  const [logs, setLogs] = useState<SewingDailyLog[]>([]);
  const [spks, setSpks] = useState<SPK[]>([]);
  const [operators, setOperators] = useState<Operator[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [detailLog, setDetailLog] = useState<SewingDailyLog | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [formData, setFormData] = useState<Partial<SewingDailyLog>>({
    date: new Date().toISOString().split('T')[0],
    lineId: 'Line 1 (Kaos/Polo)',
    spkId: '',
    operatorId: 'OPR-001',
    operatorName: 'Siti Aminah',
    operationType: 'Jahit Utama',
    outputPieces: 35,
    defectPieces: 1,
    spiCompliant: true,
    seamStrengthOk: true,
    notes: 'Kerapihan jahitan dan benang sesuai standar SOP-09.'
  });

  const loadData = async () => {
    try {
      setLoading(true);
      const [logRes, spkRes, oprRes] = await Promise.all([
        fetchResource<SewingDailyLog>('sewing-logs'),
        fetchResource<SPK>('spk_produksi'),
        fetchResource<Operator>('operators')
      ]);
      setLogs(logRes.length > 0 ? logRes : [
        {
          id: 'SEW-001',
          date: '2026-09-02',
          lineId: 'Line 1 (Kaos)',
          spkId: 'SPK-ORD-002',
          operatorId: 'OPR-001',
          operatorName: 'Siti Aminah',
          operationType: 'Jahit Utama',
          outputPieces: 37,
          defectPieces: 0,
          spiCompliant: true,
          seamStrengthOk: true,
          notes: 'Standar SPI 10-12 jarum ganda lulus uji tarik.'
        },
        {
          id: 'SEW-002',
          date: '2026-09-03',
          lineId: 'Line 2 (Jaket)',
          spkId: 'SPK-ORD-001',
          operatorId: 'OPR-002',
          operatorName: 'Ahmad Fauzi',
          operationType: 'Obras',
          outputPieces: 40,
          defectPieces: 1,
          spiCompliant: true,
          seamStrengthOk: true,
          notes: 'Obras 4 benang tepi rapi.'
        }
      ]);
      setSpks(spkRes);
      setOperators(oprRes);
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

  const handleCreateLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    const today = new Date().toISOString().split('T')[0];
    const output = Number(formData.outputPieces);
    const defects = Number(formData.defectPieces);

    const errors: Record<string, string> = {};
    if (!formData.date) {
      errors.date = 'Isi tanggal output jahit.';
    } else if (formData.date > today) {
      errors.date = `Tanggal output tidak boleh melewati hari ini (${formatDate(today)}).`;
    }
    if (!formData.operatorName?.trim()) errors.operatorName = 'Isi nama penjahit yang mengerjakan.';
    if (!formData.spkId) errors.spkId = 'Pilih SPK yang dikerjakan.';
    if (!(output > 0)) errors.outputPieces = 'Jumlah selesai minimal 1 pcs.';
    if (!(defects >= 0)) {
      errors.defectPieces = 'Jumlah cacat tidak boleh kurang dari 0 pcs.';
    } else if (output > 0 && defects > output) {
      errors.defectPieces = `Jumlah cacat ${defects} pcs melebihi jumlah selesai ${output} pcs. Periksa lagi kedua angka.`;
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setFormError('Lengkapi isian yang ditandai merah, lalu simpan lagi.');
      const firstField = Object.keys(SEW_FIELD_IDS).find(key => errors[key]);
      if (firstField) document.getElementById(SEW_FIELD_IDS[firstField])?.focus();
      return;
    }

    setFieldErrors({});
    setFormError(null);
    setSaving(true);

    const log: SewingDailyLog = {
      id: generateId('SEW'),
      date: formData.date || new Date().toISOString().split('T')[0],
      lineId: formData.lineId || 'Line 1',
      spkId: formData.spkId || 'SPK-GEN',
      operatorId: formData.operatorId || 'OPR-001',
      operatorName: formData.operatorName || 'Penjahit',
      operationType: formData.operationType as any || 'Jahit Utama',
      outputPieces: Number(formData.outputPieces) || 1,
      defectPieces: Number(formData.defectPieces) || 0,
      spiCompliant: formData.spiCompliant ?? true,
      seamStrengthOk: formData.seamStrengthOk ?? true,
      notes: formData.notes
    };

    try {
      await createResource('sewing-logs', log);
      // Auto update SPK sewing progress
      const spk = spks.find(s => s.id === log.spkId);
      if (spk) {
        await updateResource('spk_produksi', spk.id, {
          sewing: (spk.sewing || 0) + log.outputPieces
        });
      }
      setIsModalOpen(false);
      loadData();
    } catch (err) {
      setFormError('Output jahit gagal disimpan. Periksa koneksi ke server, lalu simpan lagi.');
    } finally {
      setSaving(false);
    }
  };

  const filteredLogs = newestFirst(logs.filter(l =>
    l.operatorName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    l.spkId.toLowerCase().includes(searchQuery.toLowerCase()) ||
    l.lineId.toLowerCase().includes(searchQuery.toLowerCase())
  ));

  const isQualityOk = (log: SewingDailyLog) => log.spiCompliant && log.seamStrengthOk;

  // Headline numbers shown in the modal footer while the operator types.
  const formOutput = Number(formData.outputPieces) || 0;
  const formDefects = Number(formData.defectPieces) || 0;
  const todayIso = new Date().toISOString().split('T')[0];
  const activeOperators = operators.filter(o => o.status === 'Active');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Penjahitan"
        description="Catat output harian penjahit per line dan periksa mutu jahitan."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportTableToExcel(logs, 'Laporan_Jahit_Harian_HIJ')}
            >
              <Download size={16} aria-hidden="true" /> Unduh Excel
            </Button>
            <Button size="sm" onClick={handleOpenModal}>
              <Plus size={16} aria-hidden="true" /> Catat Output Jahit
            </Button>
          </>
        }
      />

      <Card className="p-4">
        <div className="relative w-full sm:w-80">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <Input
            type="search"
            aria-label="Cari output jahit"
            placeholder="Cari operator, line, atau SPK…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </Card>

      {/* SEWING LOGS TABLE */}
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="cell-sticky-start">No. Catatan</TableHead>
              <TableHead>Operator</TableHead>
              <TableHead className="hidden md:table-cell">Lini</TableHead>
              <TableHead className="hidden md:table-cell">SPK</TableHead>
              <TableHead className="hidden xl:table-cell">Pekerjaan</TableHead>
              <TableHead className="hidden sm:table-cell text-right">Output</TableHead>
              <TableHead className="hidden sm:table-cell text-right">Cacat</TableHead>
              <TableHead className="hidden lg:table-cell">Tanggal</TableHead>
              <TableHead className="text-center">Mutu</TableHead>
              <TableHead className="cell-sticky-end text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableSkeletonRows columns={10} />
            ) : filteredLogs.length === 0 ? (
              <TableEmptyRow
                colSpan={10}
                icon={<Factory size={20} />}
                title={searchQuery ? 'Tidak ada output jahit yang cocok' : 'Belum ada output jahit'}
                description={searchQuery ? 'Coba kata kunci lain.' : 'Catat output jahit setiap penjahit di akhir shift.'}
              />
            ) : (
              filteredLogs.map(log => (
                <TableRow key={log.id}>
                  <TableCell className="cell-sticky-start whitespace-nowrap font-mono font-bold text-slate-900">
                    {log.id}
                  </TableCell>
                  <TableCell className="font-semibold text-slate-900 break-words">{log.operatorName}</TableCell>
                  <TableCell className="hidden md:table-cell whitespace-nowrap">{log.lineId}</TableCell>
                  <TableCell className="hidden md:table-cell whitespace-nowrap font-mono font-semibold text-slate-900">
                    {log.spkId}
                  </TableCell>
                  <TableCell className="hidden xl:table-cell whitespace-nowrap">
                    {OPERATION_LABELS[log.operationType] ?? log.operationType}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-right whitespace-nowrap font-bold text-slate-900">
                    {log.outputPieces} Pcs
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-right whitespace-nowrap">
                    <span className={log.defectPieces > 0 ? 'font-semibold text-brand-red' : 'text-slate-500'}>
                      {log.defectPieces} Pcs
                    </span>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell whitespace-nowrap">{formatDate(log.date)}</TableCell>
                  <TableCell className="text-center whitespace-nowrap">
                    {isQualityOk(log) ? (
                      <Badge variant="emerald">Sesuai</Badge>
                    ) : (
                      <Badge variant="rose">Perlu cek</Badge>
                    )}
                  </TableCell>
                  <TableCell className="cell-sticky-end text-right">
                    <TableRowActions>
                      <RowDetailButton label={log.id} onClick={() => setDetailLog(log)} />
                    </TableRowActions>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <DetailDrawer
        isOpen={!!detailLog}
        onClose={() => setDetailLog(null)}
        title={detailLog?.operatorName}
        subtitle={detailLog && <span className="font-mono">{detailLog.id} · {formatDate(detailLog.date)}</span>}
        status={detailLog && (
          isQualityOk(detailLog)
            ? <Badge variant="emerald">Mutu sesuai</Badge>
            : <Badge variant="rose">Mutu perlu cek</Badge>
        )}
      >
        {detailLog && (
          <>
            <DetailStats
              items={[
                { label: 'Output', value: `${detailLog.outputPieces} Pcs`, tone: 'accent' },
                { label: 'Cacat', value: `${detailLog.defectPieces} Pcs`, tone: detailLog.defectPieces > 0 ? 'danger' : 'default' }
              ]}
            />
            <DetailSection title="Pekerjaan">
              <DetailField label="Tanggal">{formatDate(detailLog.date)}</DetailField>
              <DetailField label="Operator">{detailLog.operatorName}</DetailField>
              <DetailField label="ID operator" mono>{detailLog.operatorId}</DetailField>
              <DetailField label="Line">{detailLog.lineId}</DetailField>
              <DetailField label="SPK" mono>{detailLog.spkId}</DetailField>
              <DetailField label="Pekerjaan">{OPERATION_LABELS[detailLog.operationType] ?? detailLog.operationType}</DetailField>
            </DetailSection>
            <DetailSection title="Mutu Jahitan">
              <DetailField label="Kerapatan jahitan (SPI)">
                {detailLog.spiCompliant ? (
                  <Badge variant="emerald">
                    <CheckCircle2 size={14} aria-hidden="true" /> SPI Sesuai
                  </Badge>
                ) : (
                  <Badge variant="rose">
                    <AlertTriangle size={14} aria-hidden="true" /> SPI Tidak Sesuai
                  </Badge>
                )}
              </DetailField>
              <DetailField label="Uji tarik sambungan">
                {detailLog.seamStrengthOk ? (
                  <Badge variant="teal">
                    <CheckCircle2 size={14} aria-hidden="true" /> Lulus Uji Tarik
                  </Badge>
                ) : (
                  <Badge variant="rose">
                    <AlertTriangle size={14} aria-hidden="true" /> Sambungan Lemah
                  </Badge>
                )}
              </DetailField>
            </DetailSection>
            <DetailSection title="Catatan">
              <DetailField label="Catatan operator" full>{detailLog.notes}</DetailField>
            </DetailSection>
          </>
        )}
      </DetailDrawer>

      {/* MODAL INPUT SEWING */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Catat Output Jahit"
        subtitle="Output satu penjahit di akhir shift, beserta hasil periksa mutu jahitan."
        maxWidth="2xl"
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <span className="block text-xs font-medium text-muted-foreground">Output shift ini</span>
              <span className="block text-lg font-bold tabular-nums text-foreground" aria-live="polite">
                {formOutput} pcs selesai · {formDefects} pcs cacat
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" disabled={saving} onClick={() => setIsModalOpen(false)}>
                Batal
              </Button>
              <Button type="submit" form="sewing-form" disabled={saving}>
                {saving ? 'Menyimpan…' : 'Simpan'}
              </Button>
            </div>
          </div>
        }
      >
        <form id="sewing-form" noValidate onSubmit={handleCreateLog} className="space-y-5">
          <FormError>{formError}</FormError>
          <FormSection step={1} title="Pekerjaan">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <FieldLabel htmlFor="sew-date" required>Tanggal output</FieldLabel>
                <Input
                  id="sew-date"
                  type="date"
                  max={todayIso}
                  value={formData.date || ''}
                  aria-invalid={!!fieldErrors.date}
                  aria-describedby={fieldErrors.date ? 'sew-date-error' : undefined}
                  onChange={(e) => {
                    setFieldErrors(prev => ({ ...prev, date: '' }));
                    setFormData({ ...formData, date: e.target.value });
                  }}
                />
                <FieldError id="sew-date-error">{fieldErrors.date}</FieldError>
              </div>

              <div>
                <FieldLabel htmlFor="sew-operator" required>Nama penjahit</FieldLabel>
                <Input
                  id="sew-operator"
                  type="text"
                  placeholder="Contoh: Siti Aminah"
                  value={formData.operatorName || ''}
                  aria-invalid={!!fieldErrors.operatorName}
                  aria-describedby={fieldErrors.operatorName ? 'sew-operator-error' : undefined}
                  onChange={(e) => {
                    setFieldErrors(prev => ({ ...prev, operatorName: '' }));
                    setFormData({ ...formData, operatorName: e.target.value });
                  }}
                />
                <FieldError id="sew-operator-error">{fieldErrors.operatorName}</FieldError>
                {activeOperators.length > 0 && (
                  <>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {activeOperators.map(o => (
                        <ChipButton
                          key={o.id}
                          selected={formData.operatorId === o.id}
                          onClick={() => {
                            setFieldErrors(prev => ({ ...prev, operatorName: '' }));
                            setFormData({ ...formData, operatorId: o.id, operatorName: o.name });
                          }}
                        >
                          {o.name}
                        </ChipButton>
                      ))}
                    </div>
                    <FieldHint>Pilih penjahit terdaftar agar upah borongan terhitung ke ID yang benar.</FieldHint>
                  </>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <FieldLabel htmlFor="sew-line">Line</FieldLabel>
                <Select
                  id="sew-line"
                  value={formData.lineId || ''}
                  onChange={(e) => setFormData({ ...formData, lineId: e.target.value })}
                >
                  <option value="Line 1 (Kaos/Polo)">Line 1 – Kaos / Polo</option>
                  <option value="Line 2 (Jaket/Kemeja)">Line 2 – Jaket / Kemeja</option>
                  <option value="Line 3 (Koko/Gamis)">Line 3 – Koko / Gamis</option>
                </Select>
              </div>

              <div>
                <FieldLabel htmlFor="sew-spk" required>SPK</FieldLabel>
                <Select
                  id="sew-spk"
                  value={formData.spkId || ''}
                  aria-invalid={!!fieldErrors.spkId}
                  aria-describedby={fieldErrors.spkId ? 'sew-spk-error' : undefined}
                  onChange={(e) => {
                    setFieldErrors(prev => ({ ...prev, spkId: '' }));
                    setFormData({ ...formData, spkId: e.target.value });
                  }}
                >
                  <option value="">Pilih SPK yang dikerjakan</option>
                  {spks.map(s => (
                    <option key={s.id} value={s.id}>{s.id} - {s.productName}</option>
                  ))}
                </Select>
                <FieldError id="sew-spk-error">{fieldErrors.spkId}</FieldError>
              </div>
            </div>

            <div>
              <FieldLabel htmlFor="sew-operation">Pekerjaan</FieldLabel>
              <Select
                id="sew-operation"
                value={formData.operationType || 'Jahit Utama'}
                onChange={(e) => setFormData({ ...formData, operationType: e.target.value as any })}
              >
                <option value="Jahit Utama">{OPERATION_LABELS['Jahit Utama']}</option>
                <option value="Obras">{OPERATION_LABELS['Obras']}</option>
                <option value="Pasang Kerah">{OPERATION_LABELS['Pasang Kerah']}</option>
                <option value="Kelim Bawah">{OPERATION_LABELS['Kelim Bawah']}</option>
                <option value="Finishing Detail">{OPERATION_LABELS['Finishing Detail']}</option>
              </Select>
            </div>
          </FormSection>

          <FormSection step={2} title="Hasil">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <FieldLabel htmlFor="sew-output" required>Jumlah selesai (pcs)</FieldLabel>
                <Input
                  id="sew-output"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={formData.outputPieces ?? ''}
                  aria-invalid={!!fieldErrors.outputPieces}
                  aria-describedby={fieldErrors.outputPieces ? 'sew-output-error' : undefined}
                  onChange={(e) => {
                    setFieldErrors(prev => ({ ...prev, outputPieces: '', defectPieces: '' }));
                    setFormData({ ...formData, outputPieces: Number(e.target.value) });
                  }}
                  className="text-right font-semibold tabular-nums"
                />
                <FieldError id="sew-output-error">{fieldErrors.outputPieces}</FieldError>
              </div>

              <div>
                <FieldLabel htmlFor="sew-defect" required>Jumlah cacat (pcs)</FieldLabel>
                <Input
                  id="sew-defect"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={formData.defectPieces ?? ''}
                  aria-invalid={!!fieldErrors.defectPieces}
                  aria-describedby={
                    fieldErrors.defectPieces ? 'sew-defect-error sew-defect-hint' : 'sew-defect-hint'
                  }
                  onChange={(e) => {
                    setFieldErrors(prev => ({ ...prev, defectPieces: '' }));
                    setFormData({ ...formData, defectPieces: Number(e.target.value) });
                  }}
                  className="text-right font-semibold tabular-nums"
                />
                <FieldError id="sew-defect-error">{fieldErrors.defectPieces}</FieldError>
                <FieldHint id="sew-defect-hint">Bagian dari jumlah selesai, jadi tidak boleh lebih besar.</FieldHint>
              </div>
            </div>
          </FormSection>

          <FormSection step={3} title="Mutu jahitan">
            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-foreground">
                Hasil periksa mutu (SOP-09)
              </legend>
              <div className="space-y-3">
                <label
                  htmlFor="sew-spi"
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors',
                    formData.spiCompliant
                      ? 'border-brand-teal-dark bg-teal-50/70'
                      : 'border-border bg-white hover:border-brand-teal/50'
                  )}
                >
                  <input
                    type="checkbox"
                    id="sew-spi"
                    checked={formData.spiCompliant ?? true}
                    onChange={(e) => setFormData({ ...formData, spiCompliant: e.target.checked })}
                    className="size-5 shrink-0 rounded text-teal-600 focus:ring-teal-500"
                  />
                  <span className="text-sm font-medium text-slate-800">Kerapatan jahitan (SPI) sesuai</span>
                </label>

                <label
                  htmlFor="sew-seam"
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors',
                    formData.seamStrengthOk
                      ? 'border-brand-teal-dark bg-teal-50/70'
                      : 'border-border bg-white hover:border-brand-teal/50'
                  )}
                >
                  <input
                    type="checkbox"
                    id="sew-seam"
                    checked={formData.seamStrengthOk ?? true}
                    onChange={(e) => setFormData({ ...formData, seamStrengthOk: e.target.checked })}
                    className="size-5 shrink-0 rounded text-teal-600 focus:ring-teal-500"
                  />
                  <span className="text-sm font-medium text-slate-800">Sambungan lulus uji tarik</span>
                </label>
              </div>
              <FieldHint>
                Centang hanya bila hasil periksa lulus; batch tanpa centang ditandai “Perlu cek” di daftar output.
              </FieldHint>
            </fieldset>
          </FormSection>
        </form>
      </Modal>
    </div>
  );
};
