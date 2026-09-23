/*
 * The SPK's progress figures, computed in one place from the records the floor
 * actually writes.
 *
 * Five screens used to write cutting/sewing/finishing/qc/progress/status onto
 * the SPK with five different rules — the PPIC modal saved a whole stale
 * snapshot, Cutting and Sewing added to a number read minutes earlier, the
 * bundle scanner counted "at QC" as done, and a work record could downgrade a
 * QC-passed job to "In Progress". Now every one of those writes ends here,
 * and the SPK says the same thing whichever screen last touched it.
 */
import { readTable, findById, updateItem } from './db.js';

const sum = (rows: any[], pick: (row: any) => number) =>
  rows.reduce((total, row) => total + (Number(pick(row)) || 0), 0);

/** Tables whose rows feed an SPK's progress, by the field that names the SPK. */
export const SPK_SOURCE_TABLES = ['work_assignments', 'cutting_batches', 'sewing_logs', 'wip_bundles', 'qc_reports'];

export function latestQcReport(spkId: string): any | null {
  const reports = readTable('qc_reports').filter((r: any) => r.spkId === spkId);
  if (reports.length === 0) return null;
  const stamp = (r: any) => new Date(r.timestamp || r.inspectionDate || r.date || 0).getTime() || 0;
  return reports.reduce((latest: any, r: any) => (stamp(r) >= stamp(latest) ? r : latest), reports[0]);
}

/**
 * The latest report decides. An SPK from before reports were kept, stored as
 * "QC Passed"/"Completed" with no report at all, keeps that word.
 */
export function spkQcAccepted(spkId: string): boolean {
  const latest = latestQcReport(spkId);
  if (latest) return latest.status === 'Accept';
  const spk = findById('spk_produksi', spkId);
  return spk?.status === 'QC Passed' || spk?.status === 'Completed';
}

/** Rows on the floor tables that name this SPK — none means a legacy record typed by hand. */
function hasSourceRecords(spkId: string): boolean {
  return SPK_SOURCE_TABLES.some(table => readTable(table).some((r: any) => r.spkId === spkId));
}

export function recomputeSpk(spkId: string | undefined): any | null {
  if (!spkId) return null;
  const spk = findById('spk_produksi', spkId);
  if (!spk) return null;

  // Nothing recorded yet: the figures and status typed on the SPK stand as
  // they are, so the first start with this code never rewrites history.
  if (!hasSourceRecords(spkId)) return spk;

  const target = Number(spk.targetQty) || 0;
  const cap = (n: number) => (target > 0 ? Math.min(n, target) : n);
  /*
   * Hand-typed floors live in manual* (set by the PPIC edit); the stored
   * counters themselves are outputs. Reading the outputs back as floors made
   * every counter ratchet: deleting a work record could never lower it.
   */
  const manual = (key: string) => {
    const typed = spk[`manual${key[0].toUpperCase()}${key.slice(1)}`];
    return typed !== undefined ? Number(typed) || 0 : 0;
  };

  // Worker records: pieces each person finished per task.
  const work = readTable('work_assignments').filter((w: any) => w.spkId === spkId);
  const byTask = (task: string) => sum(work.filter((w: any) => w.task === task), w => w.qty);

  // Floor logs that carry a piece count of their own.
  const cutBatches = readTable('cutting_batches').filter((b: any) => b.spkId === spkId);
  const sewingLogs = readTable('sewing_logs').filter((l: any) => l.spkId === spkId);
  const sewn = sum(sewingLogs.filter((l: any) => l.operationType !== 'Finishing Detail'), l => l.outputPieces);
  const finishedByLog = sum(sewingLogs.filter((l: any) => l.operationType === 'Finishing Detail'), l => l.outputPieces);

  // Bundles: a bundle exists once its pieces are cut; its stage says how far they got.
  const bundles = readTable('wip_bundles').filter((b: any) => b.spkId === spkId);
  const atOrPast = (stages: string[]) => sum(bundles.filter((b: any) => stages.includes(b.currentStage)), b => b.quantity);
  const bundleCut = sum(bundles, b => b.quantity);
  const bundleSewn = atOrPast(['Finishing Detail', 'QC', 'Packing']);
  const bundleFinished = atOrPast(['QC', 'Packing']);
  const bundlePassed = sum(bundles.filter((b: any) => b.status === 'Passed' || b.status === 'Completed'), b => b.quantity);

  const accepted = spkQcAccepted(spkId);

  // Records are a floor under whatever was typed by hand; nothing goes above the target.
  const cutting = cap(Math.max(manual('cutting'), byTask('Cutting'), sum(cutBatches, b => b.totalPiecesCut), bundleCut));
  const sewing = cap(Math.max(manual('sewing'), byTask('Jahit'), sewn, bundleSewn));
  const finishing = cap(Math.max(manual('finishing'), byTask('Finishing'), finishedByLog, bundleFinished));
  const qc = accepted ? target || Number(spk.qc) || 0 : cap(Math.max(manual('qc'), byTask('QC'), bundlePassed));

  const pct = Math.round(((cutting + sewing + finishing + qc) / ((target || 1) * 4)) * 100);
  const progress = Math.min(100, Math.max(0, Number.isFinite(pct) ? pct : 0));

  /*
   * Status follows events, not percentages. "QC Passed" needs an Accept report;
   * a job that is 75% along is still in progress. "Completed" is set when the
   * order ships and is never taken back here.
   */
  let status: string = spk.status === 'Completed' ? 'Completed' : 'Queued';
  if (status !== 'Completed') {
    if (accepted) status = 'QC Passed';
    else if (target > 0 && finishing >= target) status = 'Finishing';
    else if (cutting + sewing + finishing + qc > 0) status = 'In Progress';
  }

  const changed =
    cutting !== spk.cutting || sewing !== spk.sewing || finishing !== spk.finishing ||
    qc !== spk.qc || progress !== spk.progress || status !== spk.status;
  if (!changed) return spk;
  return updateItem('spk_produksi', spk.id, { cutting, sewing, finishing, qc, progress, status });
}

/** Marks the SPK finished once its order has left the factory. */
export function completeSpkForOrder(orderId: string | undefined) {
  if (!orderId) return;
  for (const spk of readTable('spk_produksi').filter((s: any) => s.orderId === orderId)) {
    if (spk.status !== 'Completed') updateItem('spk_produksi', spk.id, { status: 'Completed', progress: 100 });
  }
}

export function recomputeAllSpks(): number {
  let moved = 0;
  for (const spk of readTable('spk_produksi')) {
    const before = JSON.stringify([spk.cutting, spk.sewing, spk.finishing, spk.qc, spk.progress, spk.status]);
    const after = recomputeSpk(spk.id);
    if (after && JSON.stringify([after.cutting, after.sewing, after.finishing, after.qc, after.progress, after.status]) !== before) moved += 1;
  }
  return moved;
}
