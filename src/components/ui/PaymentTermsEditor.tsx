import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { PaymentTerm } from '../../types';
import { formatCurrency } from '../../lib/utils';
import { Button } from './Button';
import { Input } from './Input';
import { FieldLabel, FieldHint, FieldError, Select } from './Field';

/*
 * Installments are agreed with the customer on the quotation and then printed
 * on the invoice, so the split has to be explicit here rather than implied by a
 * single "DP 50%" field.
 */

export const DUE_RULES = [
  'Saat deal penawaran',
  'Sebelum produksi dimulai',
  'Setelah sampel disetujui',
  'Setelah produksi selesai',
  'Sebelum pengiriman',
  'Setelah barang diterima'
];

export const DEFAULT_PAYMENT_SCHEDULE: Omit<PaymentTerm, 'amount'>[] = [
  { id: 'term-dp', label: 'DP', percentage: 50, dueRule: 'Saat deal penawaran' },
  { id: 'term-final', label: 'Pelunasan', percentage: 50, dueRule: 'Sebelum pengiriman' }
];

/** Recalculate each installment's amount from the current total. */
export function withAmounts(terms: PaymentTerm[], total: number): PaymentTerm[] {
  const amounts = terms.map(term => Math.round((Number(total) || 0) * (Number(term.percentage) || 0) / 100));
  // Give any rounding remainder to the last installment so the parts equal the total.
  const sum = amounts.reduce((acc, value) => acc + value, 0);
  const totalPercent = terms.reduce((acc, term) => acc + (Number(term.percentage) || 0), 0);
  if (amounts.length > 0 && totalPercent === 100 && sum !== total) {
    amounts[amounts.length - 1] += (Number(total) || 0) - sum;
  }
  return terms.map((term, index) => ({ ...term, amount: amounts[index] }));
}

export function createDefaultSchedule(total: number): PaymentTerm[] {
  return withAmounts(DEFAULT_PAYMENT_SCHEDULE.map(term => ({ ...term, amount: 0 })), total);
}

export const totalPercentage = (terms: PaymentTerm[]) =>
  terms.reduce((acc, term) => acc + (Number(term.percentage) || 0), 0);

interface PaymentTermsEditorProps {
  terms: PaymentTerm[];
  total: number;
  onChange: (terms: PaymentTerm[]) => void;
  error?: string;
  idPrefix?: string;
}

export const PaymentTermsEditor: React.FC<PaymentTermsEditorProps> = ({
  terms,
  total,
  onChange,
  error,
  idPrefix = 'term'
}) => {
  const percent = totalPercentage(terms);
  const balanced = percent === 100;

  const update = (index: number, patch: Partial<PaymentTerm>) => {
    const next = terms.map((term, i) => (i === index ? { ...term, ...patch } : term));
    onChange(withAmounts(next, total));
  };

  const addTerm = () => {
    const remaining = Math.max(0, 100 - percent);
    const next = [
      ...terms,
      {
        id: `term-${Date.now()}`,
        label: `Termin ${terms.length + 1}`,
        percentage: remaining,
        amount: 0,
        dueRule: DUE_RULES[1]
      }
    ];
    onChange(withAmounts(next, total));
  };

  const removeTerm = (index: number) => {
    onChange(withAmounts(terms.filter((_, i) => i !== index), total));
  };

  return (
    <div className="space-y-3">
      <div className="space-y-3">
        {terms.map((term, index) => (
          <div
            key={term.id}
            className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-muted/30 p-3 sm:grid-cols-[1fr_92px_1fr_auto]"
          >
            <div>
              <FieldLabel htmlFor={`${idPrefix}-label-${index}`} className="text-xs">
                Nama termin
              </FieldLabel>
              <Input
                id={`${idPrefix}-label-${index}`}
                type="text"
                value={term.label}
                placeholder="Contoh: DP"
                onChange={e => update(index, { label: e.target.value })}
              />
            </div>

            <div>
              <FieldLabel htmlFor={`${idPrefix}-percent-${index}`} className="text-xs">
                Persen
              </FieldLabel>
              <Input
                id={`${idPrefix}-percent-${index}`}
                type="number"
                inputMode="numeric"
                min={0}
                max={100}
                value={term.percentage}
                onChange={e => update(index, { percentage: Number(e.target.value) })}
                className="text-right font-semibold tabular-nums"
              />
            </div>

            <div>
              <FieldLabel htmlFor={`${idPrefix}-due-${index}`} className="text-xs">
                Jatuh tempo
              </FieldLabel>
              <Select
                id={`${idPrefix}-due-${index}`}
                value={term.dueRule || DUE_RULES[0]}
                onChange={e => update(index, { dueRule: e.target.value })}
              >
                {DUE_RULES.map(rule => (
                  <option key={rule} value={rule}>{rule}</option>
                ))}
              </Select>
            </div>

            <div className="flex items-end justify-between gap-2 sm:flex-col sm:items-end">
              <span className="text-sm font-bold tabular-nums text-foreground">
                {formatCurrency(term.amount)}
              </span>
              {terms.length > 1 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => removeTerm(index)}
                  aria-label={`Hapus termin ${term.label || index + 1}`}
                  className="h-8 w-9 px-0 text-brand-red hover:border-brand-red/40 hover:bg-rose-50 hover:text-brand-red"
                >
                  <Trash2 size={14} aria-hidden="true" />
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="outline" size="sm" onClick={addTerm}>
          <Plus size={14} aria-hidden="true" /> Tambah termin
        </Button>
        <span
          className={`text-sm font-bold tabular-nums ${balanced ? 'text-status-done' : 'text-status-critical'}`}
          aria-live="polite"
        >
          Total {percent}%
        </span>
      </div>

      {error ? (
        <FieldError>{error}</FieldError>
      ) : (
        <FieldHint>
          Termin ini disepakati bersama pelanggan dan dicetak di invoice.
        </FieldHint>
      )}
    </div>
  );
};
