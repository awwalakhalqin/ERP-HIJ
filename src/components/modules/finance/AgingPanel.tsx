import React, { useMemo } from 'react';
import { BellRing, Clock } from 'lucide-react';
import { Invoice, PaymentTerm } from '../../../types';
import { formatCurrency, formatDate } from '../../../lib/utils';
import { termDaysLate } from '../../../lib/terms';
import { Badge } from '../../ui/Badge';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell, TableRowActions, RowActionButton, TableEmptyRow, TableFooter } from '../../ui/Table';
import { RowDetailButton as DetailButton } from '../../ui/DetailDrawer';
import { invoiceTerms, termBalance, overdueTagihan } from './shared';

/*
 * Umur piutang: what each customer owes on billed tagihan, by how late it is.
 * Instalments not yet billed are not piutang and stay out; old invoices with
 * no schedule carry no due date and get their own column.
 */

const BUCKETS = [
  { key: 'current', label: 'Belum jatuh tempo' },
  { key: 'd30', label: '1–30 hari' },
  { key: 'd60', label: '31–60 hari' },
  { key: 'd90', label: '61–90 hari' },
  { key: 'd90plus', label: '> 90 hari' },
  { key: 'nodate', label: 'Tanpa jatuh tempo' }
] as const;
type BucketKey = (typeof BUCKETS)[number]['key'];

function bucketFor(term: PaymentTerm): BucketKey {
  const late = termDaysLate(term);
  if (late <= 0) return 'current';
  if (late <= 30) return 'd30';
  if (late <= 60) return 'd60';
  if (late <= 90) return 'd90';
  return 'd90plus';
}

type Row = { customer: string; total: number } & Record<BucketKey, number>;

interface AgingPanelProps {
  invoices: Invoice[];
  onOpenInvoice: (id: string) => void;
  onRemind: (inv: Invoice, term: PaymentTerm) => void;
}

export const AgingPanel: React.FC<AgingPanelProps> = ({ invoices, onOpenInvoice, onRemind }) => {
  const live = useMemo(() => invoices.filter(i => !i.supersededBy && i.status !== 'Dibatalkan'), [invoices]);

  const rows = useMemo(() => {
    const byCustomer = new Map<string, Row>();
    const add = (name: string, key: BucketKey, amount: number) => {
      if (amount <= 0) return;
      const row = byCustomer.get(name) || ({ customer: name, total: 0, current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0, nodate: 0 } as Row);
      row[key] += amount;
      row.total += amount;
      byCustomer.set(name, row);
    };
    for (const inv of live) {
      const terms = invoiceTerms(inv);
      if (terms.length === 0) {
        add(inv.customerName, 'nodate', Number(inv.balanceRemaining) || 0);
        continue;
      }
      for (const term of terms) {
        if (!term.billedAt || term.status === 'Lunas') continue;
        add(inv.customerName, bucketFor(term), termBalance(term));
      }
    }
    return [...byCustomer.values()].sort((a, b) => b.total - a.total);
  }, [live]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => {
          for (const b of BUCKETS) acc[b.key] += row[b.key];
          acc.total += row.total;
          return acc;
        },
        { customer: 'Total', total: 0, current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0, nodate: 0 } as Row
      ),
    [rows]
  );

  const overdue = useMemo(() => overdueTagihan(invoices), [invoices]);

  return (
    <div className="space-y-6">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="cell-sticky-start">Pelanggan</TableHead>
            {BUCKETS.map(b => (
              <TableHead key={b.key} className="text-right tabular-nums whitespace-nowrap">{b.label}</TableHead>
            ))}
            <TableHead className="text-right tabular-nums">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableEmptyRow
              colSpan={BUCKETS.length + 2}
              icon={<Clock size={20} />}
              title="Tidak ada piutang"
              description="Semua tagihan yang sudah dikirim sudah lunas."
            />
          ) : (
            rows.map(row => (
              <TableRow key={row.customer}>
                <TableCell className="cell-sticky-start font-semibold text-slate-900">
                  <span className="block max-w-[200px] truncate" title={row.customer}>{row.customer}</span>
                </TableCell>
                {BUCKETS.map(b => (
                  <TableCell
                    key={b.key}
                    className={
                      'text-right tabular-nums whitespace-nowrap ' +
                      (row[b.key] === 0
                        ? 'text-slate-300'
                        : b.key === 'current' || b.key === 'nodate'
                          ? 'text-slate-700'
                          : 'font-semibold text-status-critical')
                    }
                  >
                    {row[b.key] === 0 ? '—' : formatCurrency(row[b.key])}
                  </TableCell>
                ))}
                <TableCell className="text-right tabular-nums font-bold text-slate-900 whitespace-nowrap">{formatCurrency(row.total)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
        {rows.length > 0 && (
          <TableFooter>
            <TableRow>
              <TableCell className="cell-sticky-start font-bold">Total</TableCell>
              {BUCKETS.map(b => (
                <TableCell key={b.key} className="text-right tabular-nums font-bold whitespace-nowrap">
                  {totals[b.key] === 0 ? '—' : formatCurrency(totals[b.key])}
                </TableCell>
              ))}
              <TableCell className="text-right tabular-nums font-bold whitespace-nowrap">{formatCurrency(totals.total)}</TableCell>
            </TableRow>
          </TableFooter>
        )}
      </Table>
      <p className="px-4 text-xs text-slate-500">
        Hanya tagihan yang sudah dikirim (ditagih). Termin yang belum ditagih tidak dihitung sebagai piutang.
      </p>

      <div>
        <h3 className="px-4 pb-2 text-sm font-bold text-slate-900">Tagihan lewat jatuh tempo ({overdue.length})</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="cell-sticky-start">Tagihan</TableHead>
              <TableHead className="hidden md:table-cell">Pelanggan</TableHead>
              <TableHead className="hidden sm:table-cell">Jatuh tempo</TableHead>
              <TableHead className="text-center">Telat</TableHead>
              <TableHead className="hidden sm:table-cell text-right tabular-nums">Sisa</TableHead>
              <TableHead className="hidden lg:table-cell">Pengingat terakhir</TableHead>
              <TableHead className="cell-sticky-end text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {overdue.length === 0 ? (
              <TableEmptyRow colSpan={7} icon={<BellRing size={20} />} title="Tidak ada tagihan yang telat" />
            ) : (
              overdue.map(({ inv, term, daysLate }) => {
                const last = (term.reminders || [])[(term.reminders || []).length - 1];
                return (
                  <TableRow key={`${inv.id}-${term.id}`}>
                    <TableCell className="cell-sticky-start whitespace-nowrap">
                      <span className="font-mono font-bold text-slate-900">{term.billNo || inv.id}</span>
                      <span className="ml-1.5 text-xs text-slate-500">{term.label}</span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell font-semibold text-slate-900">
                      <span className="block max-w-[180px] truncate" title={inv.customerName}>{inv.customerName}</span>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell whitespace-nowrap text-slate-600">
                      {term.dueDate && formatDate(term.dueDate)}
                    </TableCell>
                    <TableCell className="text-center whitespace-nowrap">
                      <Badge variant="critical" size="sm">{daysLate} hari</Badge>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-right tabular-nums font-bold whitespace-nowrap">
                      {formatCurrency(termBalance(term))}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell whitespace-nowrap text-slate-600">
                      {last ? `${formatDate(last.at)} · ${last.by} (${(term.reminders || []).length}×)` : <span className="text-slate-400">Belum pernah</span>}
                    </TableCell>
                    <TableCell className="cell-sticky-end text-right">
                      <TableRowActions>
                        <RowActionButton
                          display="labeled"
                          tone="primary"
                          icon={BellRing}
                          label="Ingatkan"
                          ariaLabel={`Kirim pengingat WhatsApp untuk ${term.billNo || inv.id}`}
                          title="Buka WhatsApp dengan pesan pengingat, dan catat pengingatnya"
                          onClick={() => onRemind(inv, term)}
                        />
                        <DetailButton label={inv.id} onClick={() => onOpenInvoice(inv.id)} />
                      </TableRowActions>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};
