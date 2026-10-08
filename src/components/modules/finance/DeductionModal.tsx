import React, { useEffect, useState } from 'react';
import { DeductionType, Invoice } from '../../../types';
import { authFetch } from '../../../services/api';
import { formatCurrency } from '../../../lib/utils';
import { DEDUCTION_TYPES, localDate } from '../../../lib/terms';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { FormError } from '../../ui/Field';
import { Modal } from '../../ui/Modal';
import { labelClass, selectClass } from './shared';

/*
 * Potongan pelanggan: part of a tagihan the customer settled without paying
 * it — PPh 23 withheld by a corporate client, a bank fee taken off the
 * transfer, rounding. It closes the gap on the invoice but is not kas masuk.
 */
interface DeductionModalProps {
  invoice: Invoice | null;
  onClose: () => void;
  onSaved: (message: string) => Promise<void> | void;
}

export const DeductionModal: React.FC<DeductionModalProps> = ({ invoice, onClose, onSaved }) => {
  const [type, setType] = useState<DeductionType>('PPh 23');
  const [amount, setAmount] = useState(0);
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState(localDate());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!invoice) return;
    setType('PPh 23');
    setAmount(0);
    setReference('');
    setNotes('');
    setDate(localDate());
    setError(null);
  }, [invoice?.id]);

  const balance = Number(invoice?.balanceRemaining) || 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invoice) return;
    setError(null);
    if (!(amount > 0)) return setError('Isi nominal potongan.');
    if (amount > balance) return setError(`Potongan melebihi sisa tagihan ${formatCurrency(balance)}.`);
    try {
      setSaving(true);
      const res = await authFetch('/api/payments/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: invoice.id, amount, adjustmentType: type, reference, notes, date })
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(data.error || 'Gagal mencatat potongan. Coba lagi.');
      onClose();
      await onSaved(data.message || 'Potongan dicatat.');
    } catch (err: any) {
      setError(err?.message || 'Gagal mencatat potongan. Coba lagi.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={!!invoice}
      onClose={onClose}
      title="Catat Potongan Pelanggan"
      subtitle={invoice ? `${invoice.id} · ${invoice.customerName} · sisa ${formatCurrency(balance)}` : undefined}
      maxWidth="lg"
    >
      <form onSubmit={submit} className="space-y-5">
        <FormError>{error}</FormError>
        <p className="text-sm text-slate-600 text-pretty">
          Potongan menutup sisa tagihan tanpa uang masuk, jadi tidak dihitung sebagai kas masuk.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="ded-type" className={labelClass}>Jenis potongan</label>
            <select id="ded-type" value={type} onChange={e => setType(e.target.value as DeductionType)} className={selectClass}>
              {DEDUCTION_TYPES.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="ded-amount" className={labelClass}>Nominal (Rp)</label>
            <Input
              id="ded-amount"
              type="number"
              min={1}
              max={balance}
              required
              value={amount || ''}
              onChange={e => setAmount(Number(e.target.value))}
              className="font-bold tabular-nums"
            />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="ded-ref" className={labelClass}>{type === 'PPh 23' ? 'No. bukti potong' : 'Referensi'}</label>
            <Input
              id="ded-ref"
              value={reference}
              onChange={e => setReference(e.target.value)}
              placeholder={type === 'PPh 23' ? 'Boleh menyusul' : 'Opsional'}
            />
          </div>
          <div>
            <label htmlFor="ded-date" className={labelClass}>Tanggal</label>
            <Input id="ded-date" type="date" required value={date} onChange={e => setDate(e.target.value)} />
          </div>
        </div>
        <div>
          <label htmlFor="ded-notes" className={labelClass}>Catatan</label>
          <Input id="ded-notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Opsional" />
        </div>
        <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
          <Button type="button" variant="outline" onClick={onClose}>Batal</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Menyimpan…' : 'Catat Potongan'}</Button>
        </div>
      </form>
    </Modal>
  );
};
