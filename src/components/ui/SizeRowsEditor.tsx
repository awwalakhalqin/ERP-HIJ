import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { sizeRowsTotal, type SizeRow } from '../../lib/pricing';
import { Button } from './Button';
import { Input } from './Input';

interface SizeRowsEditorProps {
  rows: SizeRow[];
  onChange: (rows: SizeRow[]) => void;
  /** Read by screen readers as the table's caption. */
  caption: string;
  /** Text under the "Tambah Ukuran" button, e.g. what the total feeds. */
  hint?: string;
  idPrefix?: string;
}

/*
 * One editor for "pcs per size", shared by the quotation form, the manual
 * order form and the deal revision. The stored string ("S: 20, M: 40") is what
 * every document prints, and the row total is the only source of quantity.
 */
export const SizeRowsEditor: React.FC<SizeRowsEditorProps> = ({ rows, onChange, caption, hint, idPrefix = 'size' }) => (
  <div>
    <div className="overflow-hidden rounded-xl border border-border">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-muted/60 text-xs font-semibold text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 text-left">Ukuran</th>
            <th scope="col" className="px-3 py-2 text-right">Jumlah (Pcs)</th>
            <th scope="col" className="w-12 px-3 py-2 text-right">
              <span className="sr-only">Hapus</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={3} className="px-3 py-4 text-center text-xs text-muted-foreground">
                Belum ada rincian ukuran. Tanpa rincian, kuantitas diisi manual di bawah.
              </td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr key={index}>
                <td className="px-2 py-1.5">
                  <Input
                    id={`${idPrefix}-name-${index}`}
                    aria-label={`Nama ukuran baris ${index + 1}`}
                    value={row.size}
                    onChange={e => onChange(rows.map((r, i) => (i === index ? { ...r, size: e.target.value } : r)))}
                    placeholder="S / M / L / XL"
                    className="h-9"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <Input
                    id={`${idPrefix}-qty-${index}`}
                    type="number"
                    min={0}
                    inputMode="numeric"
                    aria-label={`Jumlah ukuran ${row.size || index + 1}`}
                    value={row.qty || ''}
                    onChange={e =>
                      onChange(rows.map((r, i) => (i === index ? { ...r, qty: Number(e.target.value) || 0 } : r)))
                    }
                    className="h-9 text-right tabular-nums"
                  />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Hapus ukuran ${row.size || index + 1}`}
                    onClick={() => onChange(rows.filter((_, i) => i !== index))}
                    className="size-8 text-brand-red hover:bg-rose-50"
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </Button>
                </td>
              </tr>
            ))
          )}
        </tbody>
        {rows.length > 0 && (
          <tfoot className="border-t border-border bg-muted/40 text-sm font-semibold">
            <tr>
              <td className="px-3 py-2">Total</td>
              <td className="px-3 py-2 text-right tabular-nums">{sizeRowsTotal(rows)} Pcs</td>
              <td />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...rows, { size: '', qty: 0 }])}>
        <Plus size={14} aria-hidden="true" /> Tambah Ukuran
      </Button>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  </div>
);
