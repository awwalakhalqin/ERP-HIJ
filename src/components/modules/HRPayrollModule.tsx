import React, { useState, useEffect, useMemo } from 'react';
import { Users, Plus, Download, Calculator, Phone, MessageCircle, Pencil } from 'lucide-react';
import { Operator, BoronganSalarySlip, SewingDailyLog, WorkAssignment, SPK } from '../../types';
import { fetchResource, createResource, updateResource } from '../../services/api';
import { formatCurrency, formatDate, exportTableToExcel, generateId, todayLocal } from '../../lib/utils';
import { FormError } from '../ui/Field';
import { Badge, StatusBadge } from '../ui/Badge';
import { Modal } from '../ui/Modal';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { PageHeader } from '../ui/PageHeader';
import { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableRowActions, RowActionButton, TableEmptyRow, TableSkeletonRows, useTablePage, TablePagination } from '../ui/Table';
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

/*
 * Tasks that count as production progress, the same four stages PPIC tracks on
 * an SPK. Obras and Packing are still paid; they just are not a stage figure.
 */
const PRODUCTION_STAGE_TASKS = new Set<string>(['Cutting', 'Jahit', 'Finishing', 'QC']);

/** Monday–Sunday of the current week in local time; borongan is settled weekly. */
const currentWeek = () => {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const dayOffset = (now.getDay() + 6) % 7;
  const start = new Date(now);
  start.setDate(now.getDate() - dayOffset);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start: todayLocal(start), end: todayLocal(end) };
};

/*
 * Same arithmetic as calculateBoronganPay, but the base wage comes in already
 * summed: when it is read from the work records it is Σ(qty × rate per record),
 * which one averaged rate cannot reproduce once rates differ between tasks.
 */
const boronganPay = (qty: number, baseWage: number, target: number, attendance: number) => {
  const bonus = target > 0 && qty >= target ? Math.round(baseWage * 0.1) : 0;
  return { baseWage, bonus, grossPay: baseWage + bonus + attendance };
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
  /** Set while the form is editing someone instead of adding a new person. */
  const [editingOperatorId, setEditingOperatorId] = useState<string | null>(null);
  const [oprError, setOprError] = useState<string | null>(null);
  const [isSlipModalOpen, setIsSlipModalOpen] = useState(false);
  const [slipError, setSlipError] = useState<string | null>(null);
  const [savingSlip, setSavingSlip] = useState(false);
  const [detailOperator, setDetailOperator] = useState<Operator | null>(null);

  // Form State
  const [newOpr, setNewOpr] = useState<Partial<Operator>>({
    name: '',
    phone: '',
    joinDate: todayLocal(),
    status: 'Active'
  });

  /*
   * No pre-filled quantity or rate: a slip saved on defaults would pay for
   * work nobody recorded. `fromRecords` marks a slip filled from the SPK work
   * records, whose wage is then Σ(qty × rate) rather than qty × one rate.
   */
  const emptySlip = () => {
    const week = currentWeek();
    return {
      operatorId: '',
      periodStart: week.start,
      periodEnd: week.end,
      passedQty: 0,
      rate: 0,
      target: 0,
      attendance: 0,
      fromRecords: false,
      recordWage: 0
    };
  };
  const [newSlip, setNewSlip] = useState<{
    operatorId: string;
    periodStart: string;
    periodEnd: string;
    passedQty: number;
    rate: number;
    target: number;
    attendance: number;
    fromRecords: boolean;
    recordWage: number;
  }>(emptySlip);

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

  const handleOpenAddOperator = () => {
    setEditingOperatorId(null);
    setOprError(null);
    setNewOpr({ name: '', phone: '', joinDate: todayLocal(), status: 'Active' });
    setIsOprModalOpen(true);
  };

  const handleOpenEditOperator = (opr: Operator) => {
    setEditingOperatorId(opr.id);
    setOprError(null);
    setNewOpr({
      name: opr.name,
      phone: opr.phone || '',
      joinDate: opr.joinDate || todayLocal(),
      status: opr.status || 'Active'
    });
    setDetailOperator(null);
    setIsOprModalOpen(true);
  };

  const handleSaveOperator = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = (newOpr.name || '').trim();
    if (!name) {
      setOprError('Nama petugas harus diisi.');
      return;
    }

    const fields = {
      name,
      phone: newOpr.phone?.trim() || undefined,
      joinDate: newOpr.joinDate || todayLocal(),
      status: (newOpr.status as Operator['status']) || 'Active'
    };

    try {
      setOprError(null);
      if (editingOperatorId) {
        /*
         * Only the fields on this form are sent. Work records reference the
         * person by id, so renaming someone never detaches their past work.
         */
        await updateResource('operators', editingOperatorId, fields);
      } else {
        await createResource('operators', { id: generateId('OPR'), ...fields } as Operator);
      }
      setIsOprModalOpen(false);
      setEditingOperatorId(null);
      setNewOpr({ name: '', phone: '', joinDate: todayLocal(), status: 'Active' });
      loadData();
    } catch (err) {
      setOprError('Gagal menyimpan petugas. Periksa koneksi ke server, lalu simpan lagi.');
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

  const spkById = useMemo(() => new Map(spks.map(spk => [spk.id, spk])), [spks]);

  /*
   * Pieces that count as production: the four stage tasks only, each capped at
   * the SPK's target per task the way PPIC caps the SPK counters, so a slip
   * can never claim more of an SPK than the SPK is for. Wages are never
   * capped — every recorded piece is still paid.
   */
  const productionPieces = (rows: WorkAssignment[]) => {
    const perSpkTask = new Map<string, { spkId: string; qty: number }>();
    for (const a of rows) {
      if (!PRODUCTION_STAGE_TASKS.has(a.task)) continue;
      const key = `${a.spkId}::${a.task}`;
      const entry = perSpkTask.get(key) || { spkId: a.spkId, qty: 0 };
      entry.qty += Number(a.qty) || 0;
      perSpkTask.set(key, entry);
    }
    let total = 0;
    for (const { spkId, qty } of perSpkTask.values()) {
      const target = Number(spkById.get(spkId)?.targetQty) || 0;
      total += target > 0 ? Math.min(qty, target) : qty;
    }
    return total;
  };

  const wageOf = (rows: WorkAssignment[]) =>
    rows.reduce((sum, a) => sum + (Number(a.qty) || 0) * (Number(a.ratePerPiece) || 0), 0);

  const slipSource = newSlip.operatorId
    ? assignmentsInPeriod(newSlip.operatorId, newSlip.periodStart, newSlip.periodEnd)
    : [];
  const slipSourceQty = productionPieces(slipSource);
  const slipSourceWage = wageOf(slipSource);

  const handleUseProductionData = () => {
    if (slipSource.length === 0) return;
    // The wage is the sum of every record at its own rate; the rate shown is
    // only the implied average, for reading.
    const averageRate = slipSourceQty > 0 ? Math.round(slipSourceWage / slipSourceQty) : 0;
    setSlipError(null);
    setNewSlip(prev => ({
      ...prev,
      passedQty: slipSourceQty,
      rate: averageRate,
      fromRecords: true,
      recordWage: slipSourceWage
    }));
  };

  /** Back to typing the figures by hand. */
  const handleManualSlip = () => {
    setNewSlip(prev => ({ ...prev, fromRecords: false, recordWage: 0 }));
  };

  const slipPay = boronganPay(
    newSlip.passedQty,
    newSlip.fromRecords ? newSlip.recordWage : newSlip.passedQty * newSlip.rate,
    newSlip.target,
    newSlip.attendance
  );

  /** Any change to who or when invalidates figures copied from the records. */
  const setSlipField = <K extends 'operatorId' | 'periodStart' | 'periodEnd'>(key: K, value: string) => {
    setSlipError(null);
    setNewSlip(prev => ({ ...prev, [key]: value, fromRecords: false, recordWage: 0 }));
  };

  const openSlipModal = (operatorId?: string) => {
    setSlipError(null);
    setNewSlip(prev => ({ ...prev, operatorId: operatorId ?? prev.operatorId, fromRecords: false, recordWage: 0 }));
    setIsSlipModalOpen(true);
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
      /** Production pieces (stage tasks, capped per SPK target); see productionPieces. */
      qty: number;
      wage: number;
      rows: WorkAssignment[];
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
        rows: [],
        tasks: new Map<string, number>(),
        spks: new Map<string, number>()
      };
      const qty = Number(a.qty) || 0;
      entry.rows.push(a);
      entry.wage += qty * (Number(a.ratePerPiece) || 0);
      entry.tasks.set(a.task, (entry.tasks.get(a.task) || 0) + qty);
      if (a.spkId) entry.spks.set(a.spkId, (entry.spks.get(a.spkId) || 0) + qty);
      byOperator.set(a.operatorId, entry);
    }
    for (const entry of byOperator.values()) entry.qty = productionPieces(entry.rows);

    const list = [...byOperator.values()].sort((x, y) => y.wage - x.wage);
    return {
      list,
      totalQty: list.reduce((sum, r) => sum + r.qty, 0),
      totalWage: list.reduce((sum, r) => sum + r.wage, 0),
      recordCount: rows.length
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignments, weekRange, spkById]);

  const { pageRows: pagedRecap, pagination: recapPagination } = useTablePage(weeklyRecap.list);

  /** "SPK-ORD-019 · 45%" — id first, because that is what people track by. */
  const spkLabel = (spkId: string) => {
    const spk = spkById.get(spkId);
    return spk ? `${spkId} · ${spk.progress || 0}%` : spkId;
  };

  const handleExportWeekly = () => {
    exportTableToExcel(
      weeklyRecap.list.map(r => ({
        Petugas: r.operatorName,
        'Periode mulai': weekRange.start,
        'Periode selesai': weekRange.end,
        'Pcs produksi': r.qty,
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
    if (savingSlip) return;
    const opr = operators.find(o => o.id === newSlip.operatorId);

    if (!opr) {
      setSlipError('Pilih operator yang digaji.');
      return;
    }
    if (!newSlip.periodStart || !newSlip.periodEnd || newSlip.periodStart > newSlip.periodEnd) {
      setSlipError('Periode slip tidak valid: tanggal mulai harus sebelum atau sama dengan tanggal selesai.');
      return;
    }
    if (!(newSlip.passedQty > 0)) {
      setSlipError('Isi jumlah pcs yang digaji, atau pakai angka dari catatan produksi.');
      return;
    }
    if (!newSlip.fromRecords && !(newSlip.rate > 0)) {
      setSlipError('Isi tarif borongan per pcs.');
      return;
    }

    const slip: BoronganSalarySlip = {
      id: `SLIP-${Date.now().toString().slice(-5)}`,
      operatorId: opr.id,
      operatorName: opr.name,
      periodStart: newSlip.periodStart,
      periodEnd: newSlip.periodEnd,
      totalPiecesProduced: newSlip.passedQty,
      totalPiecesPassedQC: newSlip.passedQty,
      // From records this is the implied average; the base wage is the exact sum.
      ratePerPiece: newSlip.fromRecords
        ? (newSlip.passedQty > 0 ? Math.round(newSlip.recordWage / newSlip.passedQty) : 0)
        : newSlip.rate,
      baseBoronganWage: slipPay.baseWage,
      attendanceIncentive: newSlip.attendance,
      productivityBonus: slipPay.bonus,
      deductions: 0,
      netPay: slipPay.grossPay,
      // A new slip is a draft; paying it is a separate decision.
      status: 'Draft'
    };

    try {
      setSavingSlip(true);
      setSlipError(null);
      await createResource('payroll', slip);
      setIsSlipModalOpen(false);
      setNewSlip(emptySlip());
      loadData();
    } catch (err: any) {
      setSlipError(err?.message || 'Gagal menyimpan slip gaji. Coba lagi.');
    } finally {
      setSavingSlip(false);
    }
  };

  // Drawer action: open the slip form with this person already chosen.
  const handleOpenSlipForOperator = (opr: Operator) => {
    openSlipModal(opr.id);
  };

  const detailSlips = detailOperator ? slips.filter(s => s.operatorId === detailOperator.id) : [];

  // Everything this person has been recorded doing, across all SPKs.
  const detailWork = useMemo(() => {
    const rows = detailOperator ? assignments.filter(a => a.operatorId === detailOperator.id) : [];
    return {
      qty: productionPieces(rows),
      wage: wageOf(rows),
      spkCount: new Set(rows.map(a => a.spkId).filter(Boolean)).size
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignments, detailOperator, spkById]);

  const sortedOperators = newestFirst(operators);

  const { pageRows: pagedOperators, pagination: operatorPagination } = useTablePage(sortedOperators);

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
              onClick={() => openSlipModal()}
            >
              <Calculator size={16} aria-hidden="true" /> Hitung Slip Gaji
            </Button>
            <Button size="sm" onClick={handleOpenAddOperator}>
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
                <TableHead className="hidden md:table-cell">SPK dikerjakan</TableHead>
                <TableHead className="text-right tabular-nums" title="Tahap Cutting, Jahit, Finishing, dan QC saja; dibatasi target SPK">
                  Pcs Produksi
                </TableHead>
                <TableHead className="cell-sticky-end text-right tabular-nums">Total Upah</TableHead>
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
                pagedRecap.map(r => {
                  const taskSummary = [...r.tasks.entries()].map(([t, q]) => `${t} ${q} pcs`).join(' · ');
                  const spkEntries = [...r.spks.entries()];
                  // One line per row: the first two SPKs, the rest folded into "+N".
                  const shownSpks = spkEntries.slice(0, 2);
                  const moreSpks = spkEntries.slice(2);
                  return (
                    <TableRow key={r.operatorId}>
                      <TableCell className="cell-sticky-start font-semibold text-slate-900">
                        <span className="block max-w-[180px] truncate" title={r.operatorName}>
                          {r.operatorName}
                        </span>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-muted-foreground">
                        <span className="block max-w-[200px] truncate" title={taskSummary}>
                          {taskSummary}
                        </span>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {spkEntries.length === 0 ? (
                          <span className="text-muted-foreground">{'—'}</span>
                        ) : (
                          <div className="flex items-center gap-1">
                            {shownSpks.map(([id, q]) => {
                              const spk = spkById.get(id);
                              const done = (spk?.progress || 0) >= 100;
                              return (
                                <span
                                  key={id}
                                  title={spk ? `${spk.productName} — ${spk.status}, ${q} pcs dikerjakan` : `${q} pcs`}
                                  className="inline-flex"
                                >
                                  <Badge variant={done ? 'idle' : 'progress'} size="sm" className="font-mono">
                                    {spkLabel(id)}
                                  </Badge>
                                </span>
                              );
                            })}
                            {moreSpks.length > 0 && (
                              <span
                                title={moreSpks.map(([id, q]) => `${spkLabel(id)} (${q} pcs)`).join(', ')}
                                className="inline-flex"
                              >
                                <Badge variant="outline" size="sm">+{moreSpks.length}</Badge>
                              </span>
                            )}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{r.qty}</TableCell>
                      <TableCell className="cell-sticky-end text-right font-bold tabular-nums text-foreground">
                        {formatCurrency(r.wage)}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
            {weeklyRecap.list.length > 0 && (
              <TableFooter>
                {/* Opaque like the header, so the sticky cells stay solid while the table scrolls. */}
                <TableRow className="border-b-0 bg-muted hover:bg-muted">
                  <TableCell className="cell-sticky-start font-bold text-foreground">
                    Total{' '}
                    <span className="font-medium text-muted-foreground">
                      &middot; {weeklyRecap.list.length} petugas
                    </span>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-muted-foreground">
                    {weeklyRecap.recordCount} catatan kerja
                  </TableCell>
                  <TableCell className="hidden md:table-cell" />
                  <TableCell className="text-right font-bold tabular-nums text-foreground">
                    {weeklyRecap.totalQty}
                  </TableCell>
                  <TableCell className="cell-sticky-end text-right font-bold tabular-nums text-foreground">
                    {formatCurrency(weeklyRecap.totalWage)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            )}
          </Table>
          <TablePagination {...recapPagination} label="petugas" />
        </Card>
      </section>

      {/* OPERATORS TABLE */}
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="cell-sticky-start">ID</TableHead>
              <TableHead className="hidden md:table-cell">Nama</TableHead>
              <TableHead className="hidden xl:table-cell">No. HP</TableHead>
              <TableHead className="hidden lg:table-cell">Tanggal masuk</TableHead>
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
                action={
                  <Button size="sm" onClick={handleOpenAddOperator}>
                    <Plus size={16} aria-hidden="true" /> Tambah Petugas
                  </Button>
                }
              />
            ) : (
              pagedOperators.map(opr => (
                <TableRow key={opr.id}>
                  <TableCell className="cell-sticky-start whitespace-nowrap">
                    <span className="font-mono font-bold text-slate-900">{opr.id}</span>
                  </TableCell>
                  <TableCell className="hidden md:table-cell font-semibold text-slate-900">
                    <span className="block max-w-[180px] truncate" title={opr.name}>
                      {opr.name}
                    </span>
                  </TableCell>
                  <TableCell className="hidden xl:table-cell whitespace-nowrap font-mono text-slate-800">
                    {opr.phone || '—'}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell whitespace-nowrap text-muted-foreground">
                    {opr.joinDate ? formatDate(opr.joinDate) : '—'}
                  </TableCell>
                  <TableCell className="text-center whitespace-nowrap">
                    <StatusBadge status={opr.status} size="sm" solid />
                  </TableCell>
                  <TableCell className="cell-sticky-end text-right">
                    <TableRowActions>
                      <RowActionButton
                        label="Ubah"
                        icon={Pencil}
                        onClick={() => handleOpenEditOperator(opr)}
                        ariaLabel={`Ubah data ${opr.name}`}
                        title="Ubah data petugas"
                      />
                      <RowDetailButton label={opr.name} onClick={() => setDetailOperator(opr)} />
                    </TableRowActions>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <TablePagination {...operatorPagination} label="petugas" />
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
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => handleOpenEditOperator(detailOperator)}>
                <Pencil size={16} aria-hidden="true" /> Ubah Data
              </Button>
              <Button onClick={() => handleOpenSlipForOperator(detailOperator)}>
                <Calculator size={16} aria-hidden="true" /> Hitung Slip Gaji
              </Button>
            </div>
          )
        }
      >
        {detailOperator && (
          <>
            <DetailStats
              items={[
                { label: 'SPK dikerjakan', value: `${detailWork.spkCount}` },
                { label: 'Pcs produksi', value: `${detailWork.qty} Pcs` },
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
      <Modal
        isOpen={isOprModalOpen}
        onClose={() => { setIsOprModalOpen(false); setEditingOperatorId(null); }}
        title={editingOperatorId ? `Ubah Petugas ${editingOperatorId}` : 'Tambah Petugas'}
      >
        <form onSubmit={handleSaveOperator} className="space-y-5">
          {oprError && (
            <div role="alert" className="rounded-xl border border-brand-red/40 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-900">
              {oprError}
            </div>
          )}
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="hr-opr-join" className={labelClass}>Tanggal Masuk</label>
              <input
                id="hr-opr-join"
                type="date"
                value={newOpr.joinDate}
                onChange={(e) => setNewOpr({ ...newOpr, joinDate: e.target.value })}
                className={fieldClass}
              />
            </div>
            <div>
              <label htmlFor="hr-opr-status" className={labelClass}>Status</label>
              <select
                id="hr-opr-status"
                value={newOpr.status}
                onChange={(e) => setNewOpr({ ...newOpr, status: e.target.value as Operator['status'] })}
                className={fieldClass}
              >
                <option value="Active">Aktif</option>
                <option value="On Leave">Cuti</option>
                <option value="Resigned">Berhenti</option>
              </select>
            </div>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">
            Tugas dan tarif tidak dicatat di sini &mdash; keduanya diisi per pekerjaan di SPK.
            Petugas berstatus <b>Berhenti</b> tidak lagi muncul saat mencatat pekerjaan, tapi catatan
            lamanya tetap utuh.
          </p>

          <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
            <Button type="button" variant="outline" onClick={() => { setIsOprModalOpen(false); setEditingOperatorId(null); }}>
              Batal
            </Button>
            <Button type="submit">
              {editingOperatorId ? 'Simpan Perubahan' : 'Simpan Petugas'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* CALCULATE SALARY SLIP MODAL */}
      <Modal isOpen={isSlipModalOpen} onClose={() => setIsSlipModalOpen(false)} title="Hitung Slip Gaji">
        <form onSubmit={handleCreateSalarySlip} noValidate className="space-y-5">
          <FormError>{slipError}</FormError>

          <div>
            <label htmlFor="hr-slip-operator" className={labelClass}>Operator</label>
            <select
              id="hr-slip-operator"
              required
              value={newSlip.operatorId}
              onChange={(e) => setSlipField('operatorId', e.target.value)}
              className={fieldClass}
            >
              <option value="">Pilih operator</option>
              {operators.map(o => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="hr-slip-start" className={labelClass}>Periode Mulai</label>
              <input
                id="hr-slip-start"
                type="date"
                value={newSlip.periodStart}
                onChange={(e) => setSlipField('periodStart', e.target.value)}
                className={fieldClass}
              />
            </div>
            <div>
              <label htmlFor="hr-slip-end" className={labelClass}>Periode Selesai</label>
              <input
                id="hr-slip-end"
                type="date"
                value={newSlip.periodEnd}
                onChange={(e) => setSlipField('periodEnd', e.target.value)}
                className={fieldClass}
              />
            </div>
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
                      Tercatat di SPK: {slipSourceQty} pcs produksi dari {slipSource.length} catatan
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Upah borongan {formatCurrency(slipSourceWage)} (semua tahap, tarif per catatan) &middot;{' '}
                      {[...new Set(slipSource.map(a => a.task))].join(', ')}
                    </p>
                  </div>
                  {newSlip.fromRecords ? (
                    <Button type="button" variant="outline" size="sm" onClick={handleManualSlip}>
                      Isi manual
                    </Button>
                  ) : (
                    <Button type="button" variant="outline" size="sm" onClick={handleUseProductionData}>
                      Pakai angka ini
                    </Button>
                  )}
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
                min={0}
                required
                readOnly={newSlip.fromRecords}
                placeholder="Wajib diisi"
                value={newSlip.passedQty || ''}
                onChange={(e) => {
                  setSlipError(null);
                  setNewSlip({ ...newSlip, passedQty: Number(e.target.value) || 0 });
                }}
                className={`${fieldClass} font-mono font-semibold ${newSlip.fromRecords ? 'bg-muted' : ''}`}
              />
            </div>
            <div>
              <label htmlFor="hr-slip-rate" className={labelClass}>
                {newSlip.fromRecords ? 'Tarif Rata-rata (Rp/Pcs)' : 'Tarif Borongan (Rp/Pcs)'}
              </label>
              <input
                id="hr-slip-rate"
                type="number"
                min={0}
                required={!newSlip.fromRecords}
                readOnly={newSlip.fromRecords}
                placeholder="Wajib diisi"
                value={newSlip.rate || ''}
                onChange={(e) => {
                  setSlipError(null);
                  setNewSlip({ ...newSlip, rate: Number(e.target.value) || 0 });
                }}
                className={`${fieldClass} font-mono font-semibold ${newSlip.fromRecords ? 'bg-muted' : ''}`}
              />
              {newSlip.fromRecords && (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Upah dasar {formatCurrency(newSlip.recordWage)} dijumlahkan per catatan, bukan dari tarif rata-rata ini.
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="hr-slip-target" className={labelClass}>Target Periode (Pcs)</label>
              <input
                id="hr-slip-target"
                type="number"
                min={0}
                value={newSlip.target || ''}
                placeholder="Opsional, bonus 10% bila tercapai"
                onChange={(e) => setNewSlip({ ...newSlip, target: Number(e.target.value) || 0 })}
                className={`${fieldClass} font-mono`}
              />
            </div>
            <div>
              <label htmlFor="hr-slip-attendance" className={labelClass}>Insentif Kehadiran (Rp)</label>
              <input
                id="hr-slip-attendance"
                type="number"
                min={0}
                value={newSlip.attendance || ''}
                placeholder="Opsional"
                onChange={(e) => setNewSlip({ ...newSlip, attendance: Number(e.target.value) || 0 })}
                className={`${fieldClass} font-mono`}
              />
            </div>
          </div>

          {/* TOTAL PREVIEW */}
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <span className="block text-sm font-semibold text-emerald-900">Total Gaji Bersih (draf)</span>
              <span className="block text-xs text-emerald-800 tabular-nums">
                Upah dasar {formatCurrency(slipPay.baseWage)}
                {slipPay.bonus > 0 && <> &middot; bonus {formatCurrency(slipPay.bonus)}</>}
                {newSlip.attendance > 0 && <> &middot; kehadiran {formatCurrency(newSlip.attendance)}</>}
              </span>
            </div>
            <span className="text-lg font-bold text-emerald-700 tabular-nums whitespace-nowrap">
              {formatCurrency(slipPay.grossPay)}
            </span>
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
            <Button type="button" variant="outline" disabled={savingSlip} onClick={() => setIsSlipModalOpen(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={savingSlip}>
              {savingSlip ? 'Menyimpan…' : 'Simpan Slip Gaji'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
