import React, { useMemo, useState } from 'react';
import { PiggyBank } from 'lucide-react';
import { CustomerCredit, Invoice } from '../../../types';
import { authFetch } from '../../../services/api';
import { formatCurrency, formatDate, formatDateTime } from '../../../lib/utils';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { FormError } from '../../ui/Field';
import { Modal } from '../../ui/Modal';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell, TableRowActions, RowActionButton, TableEmptyRow } from '../../ui/Table';
import { labelClass, selectClass } from './shared';

/*
 * Saldo pelanggan: money HIJ holds that no invoice is owed — an overpayment,
 * or what a cancelled order had paid. Each one is settled here, step by step:
 * refunded, moved to another invoice of the same customer, or (cancelled
 * orders only) declared forfeited.
 */

type Action = 'Refund' | 'Pindah' | 'Hangus';

const ACTION_LABEL: Record<Action, string> = {
  Refund: 'Kembalikan (refund)',
  Pindah: 'Pindahkan ke faktur lain',
  Hangus: 'Nyatakan hangus'
};

interface CreditsPanelProps {
  credits: CustomerCredit[];
  invoices: Invoice[];
  onChanged: (message: string) => Promise<void> | void;
}

export const CreditsPanel: React.FC<CreditsPanelProps> = ({ credits, invoices, onChanged }) => {
  const [active, setActive] = useState<CustomerCredit | null>(null);
  const [action, setAction] = useState<Action>('Refund');
  const [amount, setAmount] = useState(0);
  const [targetInvoiceId, setTargetInvoiceId] = useState('');
  const [method, setMethod] = useState('Transfer Bank');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const sorted = useMemo(
    () => [...credits].sort((a, b) => (a.status === b.status ? String(b.timestamp).localeCompare(String(a.timestamp)) : a.status === 'Terbuka' ? -1 : 1)),
    [credits]
  );

  // Invoices the saldo may go to: same customer, still owing, not the one it came from.
  const targets = useMemo(
    () =>
      active
        ? invoices.filter(
            i =>
              !i.supersededBy &&
              i.status !== 'Dibatalkan' &&
              String(i.customerId) === String(active.customerId) &&
              (i.revisionOf || i.id) !== active.invoiceId &&
              Number(i.balanceRemaining) > 0
          )
        : [],
    [active, invoices]
  );

  const open = (credit: CustomerCredit) => {
    setActive(credit);
    setAction('Refund');
    setAmount(credit.remaining);
    setTargetInvoiceId('');
    setMethod('Transfer Bank');
    setNote('');
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!active) return;
    setError(null);
    if (!(amount > 0)) return setError('Isi nominal yang valid.');
    if (action === 'Pindah' && !targetInvoiceId) return setError('Pilih faktur tujuan.');
    if (action === 'Hangus' && !note.trim()) return setError('Tulis dasar DP hangus.');
    try {
      setSaving(true);
      const res = await authFetch(`/api/credits/${active.id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, amount, targetInvoiceId, method, note })
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(data.error || 'Gagal memproses saldo. Coba lagi.');
      setActive(null);
      await onChanged(data.message || 'Saldo diperbarui.');
    } catch (err: any) {
      setError(err?.message || 'Gagal memproses saldo. Coba lagi.');
    } finally {
      setSaving(false);
    }
  };

  const selectedTarget = targets.find(t => t.id === targetInvoiceId);

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="cell-sticky-start">No. Saldo</TableHead>
            <TableHead className="hidden md:table-cell">Pelanggan</TableHead>
            <TableHead className="hidden sm:table-cell">Asal</TableHead>
            <TableHead className="hidden lg:table-cell text-right tabular-nums">Jumlah</TableHead>
            <TableHead className="text-right tabular-nums">Sisa</TableHead>
            <TableHead className="hidden xl:table-cell">Riwayat</TableHead>
            <TableHead className="cell-sticky-end text-right">Aksi</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.length === 0 ? (
            <TableEmptyRow
              colSpan={7}
              icon={<PiggyBank size={20} />}
              title="Tidak ada saldo pelanggan"
              description="Saldo muncul saat pelanggan membayar lebih, atau pesanan yang sudah dibayar dibatalkan."
            />
          ) : (
            sorted.map(credit => (
              <TableRow key={credit.id}>
                <TableCell className="cell-sticky-start whitespace-nowrap">
                  <span className="font-mono font-bold text-slate-900">{credit.id}</span>
                  <span className="ml-1.5 text-xs text-slate-500 font-mono">{credit.invoiceId}</span>
                </TableCell>
                <TableCell className="hidden md:table-cell font-semibold text-slate-900">
                  <span className="block max-w-[180px] truncate" title={credit.customerName}>{credit.customerName}</span>
                </TableCell>
                <TableCell className="hidden sm:table-cell whitespace-nowrap">
                  <Badge variant={credit.source === 'Pesanan Batal' ? 'critical' : 'warning'} size="sm">{credit.source}</Badge>
                </TableCell>
                <TableCell className="hidden lg:table-cell text-right tabular-nums whitespace-nowrap">{formatCurrency(credit.amount)}</TableCell>
                <TableCell className="text-right tabular-nums whitespace-nowrap">
                  <span className={credit.remaining > 0 ? 'font-bold text-status-warning' : 'font-semibold text-slate-400'}>
                    {formatCurrency(credit.remaining)}
                  </span>
                </TableCell>
                <TableCell className="hidden xl:table-cell text-xs text-slate-600">
                  {(credit.history || []).length === 0
                    ? <span className="text-slate-400">Belum ada tindakan</span>
                    : (credit.history || []).map((h, i) => (
                        <span key={i} className="block whitespace-nowrap">
                          {formatDate(h.at)} · {h.action === 'Pindah' ? `Pindah ke ${h.targetInvoiceId}` : h.action} {formatCurrency(h.amount)}
                        </span>
                      ))}
                </TableCell>
                <TableCell className="cell-sticky-end text-right">
                  <TableRowActions>
                    {credit.status === 'Terbuka' ? (
                      <RowActionButton
                        display="labeled"
                        tone="primary"
                        icon={PiggyBank}
                        label="Tindak lanjut"
                        ariaLabel={`Tindak lanjut saldo ${credit.id}`}
                        title="Kembalikan, pindahkan, atau nyatakan hangus"
                        onClick={() => open(credit)}
                      />
                    ) : (
                      <Badge variant="done" size="sm">Selesai</Badge>
                    )}
                  </TableRowActions>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <Modal isOpen={!!active} onClose={() => setActive(null)} title={`Saldo ${active?.id ?? ''}`} subtitle={active ? `${active.customerName} · ${active.source} · sisa ${formatCurrency(active.remaining)}` : undefined} maxWidth="lg">
        {active && (
          <form onSubmit={submit} className="space-y-5">
            <FormError>{error}</FormError>

            <div>
              <label htmlFor="credit-action" className={labelClass}>Tindakan</label>
              <select
                id="credit-action"
                value={action}
                onChange={e => setAction(e.target.value as Action)}
                className={selectClass}
              >
                <option value="Refund">{ACTION_LABEL.Refund}</option>
                <option value="Pindah">{ACTION_LABEL.Pindah}</option>
                {active.source === 'Pesanan Batal' && <option value="Hangus">{ACTION_LABEL.Hangus}</option>}
              </select>
            </div>

            {action === 'Pindah' && (
              <div>
                <label htmlFor="credit-target" className={labelClass}>Faktur tujuan</label>
                <select
                  id="credit-target"
                  value={targetInvoiceId}
                  onChange={e => {
                    setTargetInvoiceId(e.target.value);
                    const inv = targets.find(t => t.id === e.target.value);
                    if (inv) setAmount(Math.min(active.remaining, Number(inv.balanceRemaining) || 0));
                  }}
                  className={selectClass}
                >
                  <option value="">Pilih faktur {active.customerName}</option>
                  {targets.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.id} — sisa {formatCurrency(t.balanceRemaining)}
                    </option>
                  ))}
                </select>
                {targets.length === 0 && (
                  <p className="mt-1.5 text-xs text-slate-500">Pelanggan ini tidak punya faktur lain yang masih ada sisa tagihannya.</p>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="credit-amount" className={labelClass}>Nominal (Rp)</label>
                <Input
                  id="credit-amount"
                  type="number"
                  min={1}
                  max={active.remaining}
                  required
                  value={amount || ''}
                  onChange={e => setAmount(Number(e.target.value))}
                  className="font-bold tabular-nums"
                />
                <p className="mt-1.5 text-xs text-slate-500">
                  Maks. {formatCurrency(selectedTarget ? Math.min(active.remaining, Number(selectedTarget.balanceRemaining) || 0) : active.remaining)}
                </p>
              </div>
              {action === 'Refund' && (
                <div>
                  <label htmlFor="credit-method" className={labelClass}>Dikembalikan lewat</label>
                  <Input id="credit-method" value={method} onChange={e => setMethod(e.target.value)} placeholder="Mis. Transfer BCA ke rek. pelanggan" />
                </div>
              )}
            </div>

            <div>
              <label htmlFor="credit-note" className={labelClass}>
                {action === 'Hangus' ? 'Dasar DP hangus' : 'Catatan'}
              </label>
              <Input
                id="credit-note"
                value={note}
                onChange={e => setNote(e.target.value)}
                required={action === 'Hangus'}
                placeholder={action === 'Hangus' ? 'Mis. ketentuan pembatalan di Surat Penawaran' : 'Mis. no. referensi transfer'}
              />
            </div>

            {(active.history || []).length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                <p className="mb-1 font-semibold text-slate-800">Riwayat</p>
                {(active.history || []).map((h, i) => (
                  <p key={i}>
                    {formatDateTime(h.at)} · {h.by} · {h.action === 'Pindah' ? `Pindah ke ${h.targetInvoiceId}` : h.action} {formatCurrency(h.amount)}
                    {h.note ? ` — ${h.note}` : ''}
                  </p>
                ))}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
              <Button type="button" variant="outline" onClick={() => setActive(null)}>Batal</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Menyimpan…' : 'Simpan'}</Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
};
