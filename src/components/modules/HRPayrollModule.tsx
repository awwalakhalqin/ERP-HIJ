import React, { useState, useEffect, useMemo } from 'react';
import { Users, Plus, Download, Calculator, Phone, MessageCircle } from 'lucide-react';
import { Operator, BoronganSalarySlip, SewingDailyLog, WorkAssignment, SPK } from '../../types';
import { fetchResource, createResource } from '../../services/api';
import { formatCurrency, formatDate, calculateBoronganPay, exportTableToExcel, generateId, todayLocal } from '../../lib/utils';
import { StatusBadge } from '../ui/Badge';
import { Modal } from '../ui/Modal';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { PageHeader } from '../ui/PageHeader';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell, TableRowActions, TableEmptyRow, TableSkeletonRows } from '../ui/Table';
import { DetailDrawer, DetailSection, DetailField, DetailStats, DetailBlock, RowDetailButton } from '../ui/DetailDrawer';
import { newestFirst } from '../../lib/ordering';

const labelClass = 'block text-sm font-medium text-slate-700 mb-1.5';
const fieldClass = 'w-full h-10 px-3 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-600';
const linkClass = 'inline-flex min-h-10 items-center gap-1.5 font-semibold text-brand-teal-dark underline underline-offset-4 hover:text-slate-900';

// 0812… → 62812… for wa.me links
const toWhatsAppNumber = (phone: string) => {
  const digits = phone.replace(/\D/g, '');
  return digits.startsWith('0') ? `62${digits.slice(1)}` : digits;
};

export const HRPayrollModule: React.FC = () => {
  const [operators, setOperators] = useState<Operator[]>([]);
  const [slips, setSlips] = useState<BoronganSalarySlip[]>([]);
  const [assignments, setAssignments] = useState<WorkAssignment[]>([]);
  // Only to show which SPK the work belongs to, and how far that SPK has got.
  const [spks, setSpks] = useState<SPK[]>([]);
  /** 0 = this week, -1 = last week. Borongan is settled weekly. */
  const [weekOffset, setWeekOffset] = useState(0);
  const [logs, setLogs] = useState<SewingDailyLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Modals
  const [isOprModalOpen, setIsOprModalOpen] = useState(false);
  const [isSlipModalOpen, setIsSlipModalOpen] = useState(false);
  const [detailOperator, setDetailOperator] = useState<Operator | null>(null);

  // Form State
  const [newOpr, setNewOpr] = useState<Partial<Operator>>({
    name: '',
    phone: '',
    joinDate: todayLocal(),
    status: 'Active'
  });

  const [newSlip, setNewSlip] = useState<{
    operatorId: string;
    periodStart: string;
    periodEnd: string;
    passedQty: number;
    rate: number;
    target: number;
    attendance: number;
  }>({
    operatorId: '',
    periodStart: '2026-09-01',
    periodEnd: '2026-09-07',
    passedQty: 250,
    rate: 5000,
    target: 200,
    attendance: 100000
  });

  const loadData = async () => {
    try {
      setLoading(true);
      const [oprRes, slipRes, logRes, assignRes, spkRes] = await Promise.all([
        fetchResource<Operator>('operators'),
        fetchResource<BoronganSalarySlip>('payroll'),
        fetchResource<SewingDailyLog>('sewing-logs'),
        fetchResource<WorkAssignment>('work-assignments'),
        fetchResource<SPK>('spk_produksi')
      ]);
      // Show what is really there; placeholder staff would read as real people.
      setOperators(oprRes);
      setSlips(slipRes);
      setLogs(logRes);
      setAssignments(assignRes || []);
      setSpks(spkRes || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateOperator = async (e: React.FormEvent) => {
    e.preventDefault();
    const item: Operator = {
      id: generateId('OPR'),
      name: (newOpr.name || '').trim(),
      phone: newOpr.phone?.trim() || undefined,
      joinDate: newOpr.joinDate || todayLocal(),
      status: 'Active'
    };
    if (!item.name) return;

    try {
      await createResource('operators', item);
      setIsOprModalOpen(false);
      setNewOpr({ name: '', phone: '', joinDate: todayLocal(), status: 'Active' });
      loadData();
    } catch (err) {
      alert('Gagal menyimpan petugas. Coba lagi.');
    }
  };

  /*
   * What this operator actually produced in the chosen period, taken from the
   * work recorded on each SPK. Payroll no longer depends on someone
   * remembering the piece count — it reads what production wrote down.
   */
  const assignmentsInPeriod = (operatorId: string, from: string, to: string) =>
    assignments.filter(a => {
      if (a.operatorId !== operatorId) return false;
      if (!a.date) return false;
      return (!from || a.date >= from) && (!to || a.date <= to);
    });

  const slipSource = newSlip.operatorId
    ? assignmentsInPeriod(newSlip.operatorId, newSlip.periodStart, newSlip.periodEnd)
    : [];
  const slipSourceQty = slipSource.reduce((sum, a) => sum + (Number(a.qty) || 0), 0);
  const slipSourceWage = slipSource.reduce((sum, a) => sum + (Number(a.qty) || 0) * (Number(a.ratePerPiece) || 0), 0);

  const handleUseProductionData = () => {
    if (slipSource.length === 0) return;
    // Rates are snapshotted per record; the average keeps the slip consistent
    // with the wage actually earned when they differ across tasks.
    const averageRate = slipSourceQty > 0 ? Math.round(slipSourceWage / slipSourceQty) : newSlip.rate;
    setNewSlip(prev => ({ ...prev, passedQty: slipSourceQty, rate: averageRate }));
  };

  /*
   * Weekly recap for production workers.
   *
   * Borongan is paid by the week, and a rate now varies per job rather than per
   * person, so the recap adds up what each person actually earned across every
   * SPK in the week instead of multiplying one rate by one total.
   */
  const weekRange = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    // Monday as the first day; getDay() calls Sunday 0.
    const dayOffset = (now.getDay() + 6) % 7;
    const start = new Date(now);
    start.setDate(now.getDate() - dayOffset + weekOffset * 7);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    /*
     * Format in local time. toISOString() converts to UTC first, which in
     * Indonesia shifts every boundary a day earlier — Sunday's work would fall
     * outside its own week and into the next one's pay.
     */
    const iso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { start: iso(start), end: iso(end) };
  }, [weekOffset]);

  const weeklyRecap = useMemo(() => {
    const rows = assignments.filter(
      a => a.date && a.date >= weekRange.start && a.date <= weekRange.end
    );
    const byOperator = new Map<string, {
      operatorId: string;
      operatorName: string;
      qty: number;
      wage: number;
      tasks: Map<string, number>;
      /** SPK id to pieces done on it, so the recap can be traced back per SPK. */
      spks: Map<string, number>;
    }>();

    for (const a of rows) {
      const entry = byOperator.get(a.operatorId) || {
        operatorId: a.operatorId,
        operatorName: a.operatorName,
        qty: 0,
        wage: 0,
        tasks: new Map<string, number>(),
        spks: new Map<string, number>()
      };
      const qty = Number(a.qty) || 0;
      entry.qty += qty;
      entry.wage += qty * (Number(a.ratePerPiece) || 0);
      entry.tasks.set(a.task, (entry.tasks.get(a.task) || 0) + qty);
      if (a.spkId) entry.spks.set(a.spkId, (entry.spks.get(a.spkId) || 0) + qty);
      byOperator.set(a.operatorId, entry);
    }

    const list = [...byOperator.values()].sort((x, y) => y.wage - x.wage);
    return {
      list,
      totalQty: list.reduce((sum, r) => sum + r.qty, 0),
      totalWage: list.reduce((sum, r) => sum + r.wage, 0),
      recordCount: rows.length
    };
  }, [assignments, weekRange]);

  const spkById = useMemo(() => new Map(spks.map(spk => [spk.id, spk])), [spks]);

  /** "SPK-ORD-019 · 45%" — id first, because that is what people track by. */
  const spkLabel = (spkId: string) => {
    const spk = spkById.get(spkId);
    return spk ? `${spkId} \u00b7 ${spk.progress || 0}%` : spkId;
  };

  const handleExportWeekly = () => {
    exportTableToExcel(
      weeklyRecap.list.map(r => ({
        Petugas: r.operatorName,
        'Periode mulai': weekRange.start,
        'Periode selesai': weekRange.end,
        'Total pcs': r.qty,
        'Total upah': r.wage,
        'Rincian tahap': [...r.tasks.entries()].map(([t, q]) => `${t} ${q}`).join(', '),
        'Rincian SPK': [...r.spks.entries()].map(([id, q]) => `${id} (${q} pcs)`).join(', '),
        'Jumlah SPK': r.spks.size
      })),
      `Rekap_Mingguan_${weekRange.start}`
    );
  };

  const handleCreateSalarySlip = async (e: React.FormEvent) => {
    e.preventDefault();
    const opr = operators.find(o => o.id === newSlip.operatorId);
    if (!opr) return;

    const calc = calculateBoronganPay(newSlip.passedQty, newSlip.rate, newSlip.target, newSlip.attendance);

    const slip: BoronganSalarySlip = {
      id: `SLIP-${Date.now().toString().slice(-5)}`,
      operatorId: opr.id,
      operatorName: opr.name,
      periodStart: newSlip.periodStart,
      periodEnd: newSlip.periodEnd,
      totalPiecesProduced: newSlip.passedQty,
      totalPiecesPassedQC: newSlip.passedQty,
      ratePerPiece: newSlip.rate,
      baseBoronganWage: calc.baseWage,
      attendanceIncentive: calc.attendanceIncentive,
      productivityBonus: calc.bonus,
      deductions: 0,
      netPay: calc.grossPay,
      status: 'Paid',
      paidAt: new Date().toISOString().split('T')[0]
    };

    try {
      await createResource('payroll', slip);
      setIsSlipModalOpen(false);
      loadData();
    } catch (err) {
      alert('Gagal menyimpan slip gaji. Coba lagi.');
    }
  };

  // Drawer action: open the slip form with this person already chosen.
  const handleOpenSlipForOperator = (opr: Operator) => {
    setNewSlip({ ...newSlip, operatorId: opr.id });
    setIsSlipModalOpen(true);
  };

  const detailSlips = detailOperator ? slips.filter(s => s.operatorId === detailOperator.id) : [];

  // Everything this person has been recorded doing, across all SPKs.
  const detailWork = useMemo(() => {
    const rows = detailOperator ? assignments.filter(a => a.operatorId === detailOperator.id) : [];
    return {
      qty: rows.reduce((sum, a) => sum + (Number(a.qty) || 0), 0),
      wage: rows.reduce((sum, a) => sum + (Number(a.qty) || 0) * (Number(a.ratePerPiece) || 0), 0),
      spkCount: new Set(rows.map(a => a.spkId).filter(Boolean)).size
    };
  }, [assignments, detailOperator]);

  const sortedOperators = newestFirst(operators);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Penggajian"
        description="Data petugas, rekap borongan mingguan, dan slip gaji."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportTableToExcel(operators, 'Data_Petugas_HIJ')}
            >
              <Download size={16} aria-hidden="true" /> Unduh Excel
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsSlipModalOpen(true)}
            >
              <Calculator size={16} aria-hidden="true" /> Hitung Slip Gaji
            </Button>
            <Button size="sm" onClick={() => setIsOprModalOpen(true)}>
              <Plus size={16} aria-hidden="true" /> Tambah Petugas
            </Button>
          </>
        }
      />

      {/* REKAP MINGGUAN PETUGAS PRODUKSI */}
      <section aria-labelledby="hr-weekly-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="hr-weekly-heading" className="text-base font-bold text-slate-900">
              Rekap Mingguan Petugas Produksi
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Dihitung dari catatan petugas di tiap SPK, memakai tarif yang disepakati per pekerjaan.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button variant="outline" size="sm" onClick={() => setWeekOffset(w => w - 1)} aria-label="Minggu sebelumnya">
              &larr;
            </Button>
            <span className="rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
              {formatDate(weekRange.start)} &ndash; {formatDate(weekRange.end)}
              {weekOffset === 0 && <span className="ml-1.5 text-brand-teal-dark">(minggu ini)</span>}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={weekOffset >= 0}
              onClick={() => setWeekOffset(w => Math.min(0, w + 1))}
              aria-label="Minggu berikutnya"
            >
              &rarr;
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={weeklyRecap.list.length === 0}
              onClick={handleExportWeekly}
            >
              <Download size={16} aria-hidden="true" /> Unduh Rekap
            </Button>
          </div>
        </div>

        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="cell-sticky-start">Petugas</TableHead>
                <TableHead className="hidden md:table-cell">Rincian tahap</TableHead>
                <TableHead className="hidden sm:table-cell">SPK dikerjakan</TableHead>
                <TableHead className="text-right">Total Pcs</TableHead>
                <TableHead className="cell-sticky-end text-right">Total Upah</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {weeklyRecap.list.length === 0 ? (
                <TableEmptyRow
                  colSpan={5}
                  icon={<Users size={20} />}
                  title="Belum ada pekerjaan tercatat minggu ini"
                  description="Catat petugas di menu Surat Perintah Kerja; rekapnya muncul di sini sendiri."
                />
              ) : (
                weeklyRecap.list.map(r => (
                  <TableRow key={r.operatorId}>
                    <TableCell className="cell-sticky-start whitespace-nowrap font-semibold text-slate-900">
                      {r.operatorName}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                      {[...r.tasks.entries()].map(([t, q]) => `${t} ${q} pcs`).join(' \u00b7 ')}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {[...r.spks.entries()].map(([id, q]) => {
                          const spk = spkById.get(id);
                          const done = (spk?.progress || 0) >= 100;
                          return (
                            <span
                              key={id}
                              title={spk ? `${spk.productName} \u2014 ${spk.status}, ${q} pcs dikerjakan` : `${q} pcs`}
                              className={`inline-flex h-7 items-center gap-1.5 rounded-lg border px-2 font-mono text-xs font-semibold ${
                                done
                                  ? 'border-emerald-600/30 bg-emerald-50 text-emerald-800'
                                  : 'border-border bg-white text-slate-700'
                              }`}
                            >
                              {spkLabel(id)}
                            </span>
                          );
                        })}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{r.qty}</TableCell>
                    <TableCell className="cell-sticky-end text-right font-bold tabular-nums text-foreground">
                      {formatCurrency(r.wage)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {weeklyRecap.list.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/40 px-4 py-2.5 text-sm">
              <span className="text-xs text-muted-foreground">
                {weeklyRecap.list.length} petugas &middot; {weeklyRecap.recordCount} catatan kerja
              </span>
              <span className="font-bold text-foreground">
                {weeklyRecap.totalQty} pcs &middot; {formatCurrency(weeklyRecap.totalWage)}
              </span>
            </div>
          )}
        </Card>
      </section>

      {/* OPERATORS TABLE */}
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="cell-sticky-start">ID</TableHead>
              <TableHead className="hidden md:table-cell">Nama</TableHead>
              <TableHead className="hidden sm:table-cell">No. HP</TableHead>
              <TableHead className="hidden xl:table-cell">Tanggal masuk</TableHead>
              <TableHead className="text-center">Status</TableHead>
              <TableHead className="cell-sticky-end text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && operators.length === 0 ? (
              <TableSkeletonRows columns={6} />
            ) : operators.length === 0 ? (
              <TableEmptyRow
                colSpan={6}
                icon={<Users size={20} />}
                title="Belum ada petugas"
                description="Tambah petugas dulu agar bisa dipilih saat mencatat pekerjaan di SPK."
              />
            ) : (
              sortedOperators.map(opr => (
                <TableRow key={opr.id}>
                  <TableCell className="cell-sticky-start whitespace-nowrap">
                    <span className="font-mono font-bold text-slate-900">{opr.id}</span>
                  </TableCell>
                  <TableCell className="hidden md:table-cell font-semibold text-slate-900 break-words">
                    {opr.name}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell whitespace-nowrap font-mono text-slate-800">
                    {opr.phone || '\u2014'}
                  </TableCell>
                  <TableCell className="hidden xl:table-cell whitespace-nowrap text-muted-foreground">
                    {opr.joinDate ? formatDate(opr.joinDate) : '\u2014'}
                  </TableCell>
                  <TableCell className="text-center whitespace-nowrap">
                    <StatusBadge status={opr.status} />
                  </TableCell>
                  <TableCell className="cell-sticky-end text-right">
                    <TableRowActions>
                      <RowDetailButton label={opr.name} onClick={() => setDetailOperator(opr)} />
                    </TableRowActions>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {/* OPERATOR DETAIL */}
      <DetailDrawer
        isOpen={!!detailOperator}
        onClose={() => setDetailOperator(null)}
        title={detailOperator?.name}
        subtitle={detailOperator && <span className="font-mono">{detailOperator.id}</span>}
        status={detailOperator && <StatusBadge status={detailOperator.status} />}
        footer={
          detailOperator && (
            <Button onClick={() => handleOpenSlipForOperator(detailOperator)}>
              <Calculator size={16} aria-hidden="true" /> Hitung Slip Gaji
            </Button>
          )
        }
      >
        {detailOperator && (
          <>
            <DetailStats
              items={[
                { label: 'SPK dikerjakan', value: `${detailWork.spkCount}` },
                { label: 'Total pcs', value: `${detailWork.qty} Pcs` },
                { label: 'Total upah borongan', value: formatCurrency(detailWork.wage), tone: 'accent' }
              ]}
            />
            <DetailSection title="Data Petugas">
              <DetailField label="ID petugas" mono>{detailOperator.id}</DetailField>
              <DetailField label="Nama">{detailOperator.name}</DetailField>
              <DetailField label="Status"><StatusBadge status={detailOperator.status} /></DetailField>
              <DetailField label="Tanggal masuk">{detailOperator.joinDate && formatDate(detailOperator.joinDate)}</DetailField>
            </DetailSection>
            <DetailSection title="Kontak">
              <DetailField label="No. HP">
                {detailOperator.phone && (
                  <a href={`tel:${detailOperator.phone.replace(/[^\d+]/g, '')}`} className={`${linkClass} font-mono`}>
                    <Phone size={14} aria-hidden="true" /> {detailOperator.phone}
                  </a>
                )}
              </DetailField>
              <DetailField label="WhatsApp">
                {detailOperator.phone && (
                  <a
                    href={`https://wa.me/${toWhatsAppNumber(detailOperator.phone)}`}
                    target="_blank"
                    rel="noreferrer"
                    className={linkClass}
                  >
                    <MessageCircle size={14} aria-hidden="true" /> Chat WhatsApp
                  </a>
                )}
              </DetailField>
            </DetailSection>
            <DetailBlock title={`Slip Gaji (${detailSlips.length})`}>
              {detailSlips.length === 0 ? (
                <p className="text-sm text-muted-foreground">Belum ada slip gaji untuk operator ini.</p>
              ) : (
                <ul className="divide-y divide-border rounded-xl border border-border">
                  {detailSlips.map(s => (
                    <li key={s.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="font-mono text-[13px] font-medium text-foreground">{s.id}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground break-words">
                          {formatDate(s.periodStart)} – {formatDate(s.periodEnd)} · {s.totalPiecesPassedQC} Pcs lolos QC
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-bold text-foreground tabular-nums whitespace-nowrap">{formatCurrency(s.netPay)}</p>
                        <div className="mt-1">
                          <StatusBadge status={s.status} />
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </DetailBlock>
          </>
        )}
      </DetailDrawer>

      {/* CREATE OPERATOR MODAL */}
      <Modal isOpen={isOprModalOpen} onClose={() => setIsOprModalOpen(false)} title="Tambah Petugas">
        <form onSubmit={handleCreateOperator} className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="hr-opr-name" className={labelClass}>Nama Lengkap</label>
              <input
                id="hr-opr-name"
                type="text"
                required
                value={newOpr.name}
                onChange={(e) => setNewOpr({ ...newOpr, name: e.target.value })}
                className={fieldClass}
              />
            </div>
            <div>
              <label htmlFor="hr-opr-phone" className={labelClass}>No. HP / WhatsApp</label>
              <input
                id="hr-opr-phone"
                type="tel"
                value={newOpr.phone}
                onChange={(e) => setNewOpr({ ...newOpr, phone: e.target.value })}
                placeholder="Contoh: 0812xxxxxxxx"
                className={fieldClass}
              />
            </div>
          </div>

          <div>
            <label htmlFor="hr-opr-join" className={labelClass}>Tanggal Masuk</label>
            <input
              id="hr-opr-join"
              type="date"
              value={newOpr.joinDate}
              onChange={(e) => setNewOpr({ ...newOpr, joinDate: e.target.value })}
              className={`${fieldClass} sm:max-w-[16rem]`}
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              Tugas dan tarif tidak dicatat di sini &mdash; keduanya diisi per pekerjaan di SPK.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
            <Button type="button" variant="outline" onClick={() => setIsOprModalOpen(false)}>
              Batal
            </Button>
            <Button type="submit">
              Simpan Petugas
            </Button>
          </div>
        </form>
      </Modal>

      {/* CALCULATE SALARY SLIP MODAL */}
      <Modal isOpen={isSlipModalOpen} onClose={() => setIsSlipModalOpen(false)} title="Hitung Slip Gaji">
        <form onSubmit={handleCreateSalarySlip} className="space-y-5">
          <div>
            <label htmlFor="hr-slip-operator" className={labelClass}>Operator</label>
            <select
              id="hr-slip-operator"
              required
              value={newSlip.operatorId}
              onChange={(e) => setNewSlip({ ...newSlip, operatorId: e.target.value })}
              className={fieldClass}
            >
              <option value="">Pilih operator</option>
              {operators.map(o => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>

          {/*
            * What production actually recorded for this operator in the chosen
            * period, so the slip can be filled from evidence rather than recall.
            */}
          {newSlip.operatorId && (
            <div className="rounded-xl border border-border bg-muted/40 p-3.5">
              {slipSource.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Belum ada pekerjaan tercatat untuk petugas ini pada periode tersebut. Catat petugas di menu{' '}
                  <b className="text-foreground">Surat Perintah Kerja</b> agar jumlahnya terisi sendiri.
                </p>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">
                      Tercatat di SPK: {slipSourceQty} pcs dari {slipSource.length} catatan
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Upah borongan {formatCurrency(slipSourceWage)} &middot;{' '}
                      {[...new Set(slipSource.map(a => a.task))].join(', ')}
                    </p>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={handleUseProductionData}>
                    Pakai angka ini
                  </Button>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="hr-slip-qty" className={labelClass}>Jumlah Lolos QC (Pcs)</label>
              <input
                id="hr-slip-qty"
                type="number"
                value={newSlip.passedQty}
                onChange={(e) => setNewSlip({ ...newSlip, passedQty: Number(e.target.value) })}
                className={`${fieldClass} font-mono font-semibold`}
              />
            </div>
            <div>
              <label htmlFor="hr-slip-rate" className={labelClass}>Tarif Borongan (Rp/Pcs)</label>
              <input
                id="hr-slip-rate"
                type="number"
                value={newSlip.rate}
                onChange={(e) => setNewSlip({ ...newSlip, rate: Number(e.target.value) })}
                className={`${fieldClass} font-mono font-semibold`}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="hr-slip-target" className={labelClass}>Target Periode (Pcs)</label>
              <input
                id="hr-slip-target"
                type="number"
                value={newSlip.target}
                onChange={(e) => setNewSlip({ ...newSlip, target: Number(e.target.value) })}
                className={`${fieldClass} font-mono`}
              />
            </div>
            <div>
              <label htmlFor="hr-slip-attendance" className={labelClass}>Insentif Kehadiran (Rp)</label>
              <input
                id="hr-slip-attendance"
                type="number"
                value={newSlip.attendance}
                onChange={(e) => setNewSlip({ ...newSlip, attendance: Number(e.target.value) })}
                className={`${fieldClass} font-mono`}
              />
            </div>
          </div>

          {/* TOTAL PREVIEW */}
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold text-emerald-900">Total Gaji Bersih</span>
            <span className="text-lg font-bold text-emerald-700 tabular-nums whitespace-nowrap">
              {formatCurrency(
                calculateBoronganPay(newSlip.passedQty, newSlip.rate, newSlip.target, newSlip.attendance).grossPay
              )}
            </span>
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
            <Button type="button" variant="outline" onClick={() => setIsSlipModalOpen(false)}>
              Batal
            </Button>
            <Button type="submit">
              Simpan Slip Gaji
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
