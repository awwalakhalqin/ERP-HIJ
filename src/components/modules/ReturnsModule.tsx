import React, { useState, useEffect } from 'react';
import { Search, Download, RotateCcw, Wrench } from 'lucide-react';
import { CustomerReturnComplaint } from '../../types';
import { fetchResource, updateResource } from '../../services/api';
import { formatDate, exportTableToExcel, statusLabel } from '../../lib/utils';
import { Badge, StatusBadge } from '../ui/Badge';
import { Modal } from '../ui/Modal';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { FormError } from '../ui/Field';
import { PageHeader } from '../ui/PageHeader';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell, TableRowActions, RowActionButton, TableEmptyRow, TableSkeletonRows } from '../ui/Table';
import { DetailDrawer, DetailSection, DetailField, DetailStats, DetailBlock, RowDetailButton } from '../ui/DetailDrawer';
import { newestFirst } from '../../lib/ordering';

const labelClass = 'block text-sm font-medium text-slate-700 mb-1.5';
const fieldClass = 'w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600';

const evidenceUrls = (c: CustomerReturnComplaint) =>
  (c.customerEvidenceUrls || '').split(',').map(u => u.trim()).filter(Boolean);

// wa.me needs the international format: 0812… becomes 62812…
const waNumber = (phone?: string) => {
  const digits = (phone || '').replace(/[^0-9]/g, '');
  return digits.startsWith('0') ? `62${digits.slice(1)}` : digits;
};

export const ReturnsModule: React.FC = () => {
  const [complaints, setComplaints] = useState<CustomerReturnComplaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedComplaint, setSelectedComplaint] = useState<CustomerReturnComplaint | null>(null);
  const [isInvestigationModalOpen, setIsInvestigationModalOpen] = useState(false);
  const [detailComplaint, setDetailComplaint] = useState<CustomerReturnComplaint | null>(null);

  // Investigation form
  /** Galat penyimpanan, ditampilkan di dalam modal supaya isian tetap terlihat. */
  const [formError, setFormError] = useState<string | null>(null);
  const [rootCause, setRootCause] = useState('');
  const [actionTaken, setActionTaken] = useState<any>('Perbaikan Gratis');
  const [status, setStatus] = useState<any>('In Repair');

  const loadData = async () => {
    try {
      setLoading(true);
      const res = await fetchResource<CustomerReturnComplaint>('returns');
      // Show what is really there; an empty table is the honest state.
      setComplaints(res || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleOpenInvestigate = (complaint: CustomerReturnComplaint) => {
    setSelectedComplaint(complaint);
    setFormError(null);
    setRootCause(complaint.rootCauseAnalysis || '');
    setActionTaken(complaint.actionTaken || 'Perbaikan Gratis');
    // A complaint filed from the portal arrives as 'Submitted'; opening it
    // means handling has begun, so the form starts at 'Investigating'.
    setStatus(complaint.status && complaint.status !== 'Submitted' ? complaint.status : 'Investigating');
    setIsInvestigationModalOpen(true);
  };

  const handleSaveInvestigation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedComplaint) return;
    setFormError(null);
    try {
      await updateResource('returns', selectedComplaint.id, {
        rootCauseAnalysis: rootCause,
        actionTaken,
        status,
        resolvedAt: status === 'Resolved' ? new Date().toISOString().split('T')[0] : undefined
      });
      setIsInvestigationModalOpen(false);
      loadData();
    } catch (err: any) {
      setFormError(err?.message || 'Gagal menyimpan penanganan retur. Coba lagi.');
    }
  };

  // Portal complaints may arrive without every field; never call methods on a missing one.
  const query = searchQuery.trim().toLowerCase();
  const filteredComplaints = newestFirst(complaints.filter(c =>
    !query ||
    String(c.id || '').toLowerCase().includes(query) ||
    String(c.customerName || '').toLowerCase().includes(query) ||
    String(c.orderId || '').toLowerCase().includes(query) ||
    String(c.defectCategory || '').toLowerCase().includes(query)
  ));

  const openInvestigateFromDetail = (complaint: CustomerReturnComplaint) => {
    setDetailComplaint(null);
    handleOpenInvestigate(complaint);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Retur & Garansi"
        description="Tangani keluhan dan retur pelanggan sampai selesai."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportTableToExcel(complaints, 'Log_Retur_Komplain_HIJ')}
          >
            <Download size={16} aria-hidden="true" /> Unduh Excel
          </Button>
        }
      />

      <Card className="p-4">
        <div className="relative w-full sm:w-96">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <Input
            type="search"
            aria-label="Cari retur"
            placeholder="Cari tiket, pelanggan, atau pesanan…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </Card>

      {/* COMPLAINTS TABLE */}
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="cell-sticky-start">No. Tiket</TableHead>
              <TableHead className="hidden md:table-cell">No. Pesanan</TableHead>
              <TableHead className="hidden md:table-cell">Pelanggan</TableHead>
              <TableHead className="hidden xl:table-cell">Kontak</TableHead>
              <TableHead className="hidden lg:table-cell">Masalah</TableHead>
              <TableHead className="text-center">Status</TableHead>
              <TableHead className="cell-sticky-end text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableSkeletonRows columns={7} />
            ) : filteredComplaints.length === 0 ? (
              <TableEmptyRow
                colSpan={7}
                icon={<RotateCcw size={20} />}
                title={searchQuery ? 'Tidak ada retur yang cocok' : 'Belum ada retur'}
                description={
                  searchQuery
                    ? 'Coba kata kunci lain.'
                    : 'Keluhan yang dikirim pelanggan lewat portal akan muncul di sini.'
                }
              />
            ) : (
              filteredComplaints.map(c => (
                <TableRow key={c.id}>
                  <TableCell className="cell-sticky-start whitespace-nowrap">
                    <span className="font-mono font-bold text-slate-900">{c.id}</span>
                  </TableCell>
                  <TableCell className="hidden md:table-cell whitespace-nowrap font-mono text-slate-700">
                    {c.orderId || '—'}
                  </TableCell>
                  <TableCell className="hidden md:table-cell font-semibold text-slate-900">
                    <span className="block max-w-[180px] truncate" title={c.customerName || ''}>
                      {c.customerName || '—'}
                    </span>
                  </TableCell>
                  <TableCell className="hidden xl:table-cell whitespace-nowrap font-mono text-slate-700">
                    {c.contactPhone || '—'}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell whitespace-nowrap">
                    <Badge variant="idle" size="sm">
                      <span className="block max-w-[160px] truncate" title={c.defectCategory || ''}>
                        {c.defectCategory || '—'}
                      </span>
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center whitespace-nowrap">
                    <StatusBadge status={c.status} size="sm" solid />
                  </TableCell>
                  <TableCell className="cell-sticky-end text-right">
                    <TableRowActions>
                      <RowActionButton
                        label="Tangani"
                        icon={Wrench}
                        display="labeled"
                        tone="primary"
                        onClick={() => handleOpenInvestigate(c)}
                        ariaLabel={`Tangani ${c.id}`}
                        title="Tangani retur"
                      />
                      <RowDetailButton label={c.id} onClick={() => setDetailComplaint(c)} />
                    </TableRowActions>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <DetailDrawer
        isOpen={!!detailComplaint}
        onClose={() => setDetailComplaint(null)}
        title={detailComplaint?.customerName}
        subtitle={detailComplaint && (
          <span className="font-mono">{detailComplaint.id} · {formatDate(detailComplaint.complaintDate)}</span>
        )}
        status={detailComplaint && <StatusBadge status={detailComplaint.status} />}
        footer={detailComplaint && (
          <Button size="sm" onClick={() => openInvestigateFromDetail(detailComplaint)}>
            Tangani
          </Button>
        )}
      >
        {detailComplaint && (
          <>
            <DetailStats
              items={[
                { label: 'Jumlah', value: `${Number(detailComplaint.defectQty) || 0} Pcs`, tone: 'danger' },
                { label: 'Tanggal keluhan', value: formatDate(detailComplaint.complaintDate) }
              ]}
            />
            <DetailSection title="Keluhan">
              <DetailField label="Masalah">
                {detailComplaint.defectCategory && <Badge variant="rose">{detailComplaint.defectCategory}</Badge>}
              </DetailField>
              <DetailField label="Jumlah">{Number(detailComplaint.defectQty) || 0} Pcs</DetailField>
              <DetailField label="Deskripsi" full>{detailComplaint.description}</DetailField>
            </DetailSection>
            {evidenceUrls(detailComplaint).length > 0 && (
              <DetailBlock title="Foto Bukti">
                <div className="grid grid-cols-3 gap-2">
                  {evidenceUrls(detailComplaint).map((url, i) => (
                    <a
                      key={url + i}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block overflow-hidden rounded-lg border border-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal"
                    >
                      <img
                        src={url}
                        alt={`Foto bukti ${i + 1} untuk ${detailComplaint.id}`}
                        className="aspect-square w-full object-cover"
                      />
                    </a>
                  ))}
                </div>
              </DetailBlock>
            )}
            <DetailSection title="Penanganan">
              <DetailField label="Tindakan">{detailComplaint.actionTaken}</DetailField>
              <DetailField label="Status"><StatusBadge status={detailComplaint.status} /></DetailField>
              <DetailField label="Penyebab masalah" full>{detailComplaint.rootCauseAnalysis}</DetailField>
              <DetailField label="Ditangani oleh">{detailComplaint.assignedTo}</DetailField>
              <DetailField label="Selesai pada">
                {detailComplaint.resolvedAt && formatDate(detailComplaint.resolvedAt)}
              </DetailField>
            </DetailSection>
            <DetailSection title="Pelanggan">
              <DetailField label="Nama" full>{detailComplaint.customerName}</DetailField>
              <DetailField label="ID pelanggan" mono>{detailComplaint.customerId}</DetailField>
              <DetailField label="Kontak">
                {waNumber(detailComplaint.contactPhone) && (
                  <a
                    href={`https://wa.me/${waNumber(detailComplaint.contactPhone)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-[13px] text-brand-teal-dark underline underline-offset-2 hover:no-underline"
                  >
                    {detailComplaint.contactPhone}
                  </a>
                )}
              </DetailField>
              <DetailField label="No. pesanan" mono>{detailComplaint.orderId}</DetailField>
            </DetailSection>
          </>
        )}
      </DetailDrawer>

      {/* INVESTIGATION & RESOLUTION MODAL */}
      <Modal
        isOpen={isInvestigationModalOpen}
        onClose={() => setIsInvestigationModalOpen(false)}
        title={`Tangani Retur ${selectedComplaint?.id ?? ''}`}
        maxWidth="lg"
      >
        <form onSubmit={handleSaveInvestigation} className="space-y-5">
          <FormError>{formError}</FormError>

          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-1.5 text-sm">
            <p className="font-bold text-slate-900">{selectedComplaint?.customerName || '—'} · {selectedComplaint?.orderId || '—'}</p>
            <p className="text-slate-700">Keluhan: <strong>{selectedComplaint?.defectCategory || '—'}</strong> ({Number(selectedComplaint?.defectQty) || 0} Pcs)</p>
            {selectedComplaint?.description && (
              <p className="text-slate-600">"{selectedComplaint.description}"</p>
            )}
          </div>

          <div>
            <label htmlFor="ret-root-cause" className={labelClass}>Penyebab Masalah</label>
            <textarea
              id="ret-root-cause"
              rows={3}
              required
              value={rootCause}
              onChange={(e) => setRootCause(e.target.value)}
              placeholder="Jelaskan penyebab cacat, misalnya mesin atau operator."
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="ret-action" className={labelClass}>Tindakan</label>
              <select
                id="ret-action"
                value={actionTaken}
                onChange={(e) => setActionTaken(e.target.value as any)}
                className={fieldClass}
              >
                <option value="Perbaikan Gratis">Perbaikan Gratis</option>
                <option value="Produksi Ulang">Produksi Ulang</option>
                <option value="Diskon/Credit Note">Diskon / Nota Kredit</option>
                <option value="Ditolak">Ditolak (bukan cacat pabrik)</option>
              </select>
            </div>
            <div>
              <label htmlFor="ret-status" className={labelClass}>Status</label>
              <select
                id="ret-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
                className={fieldClass}
              >
                <option value="Investigating">{statusLabel('Investigating')}</option>
                <option value="In Repair">{statusLabel('In Repair')}</option>
                <option value="Resolved">{statusLabel('Resolved')}</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
            <Button type="button" variant="outline" onClick={() => setIsInvestigationModalOpen(false)}>
              Batal
            </Button>
            <Button type="submit">
              Simpan Keputusan
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
