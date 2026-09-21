import React from 'react';
import {
  CheckCircle2,
  ClipboardCheck,
  Factory,
  FileText,
  Inbox,
  Palette,
  Truck,
  XCircle
} from 'lucide-react';
import { cn, statusLabel } from '../../lib/utils';

/*
 * Status colours carry urgency, so a glance separates "needs action today" from
 * "running normally". Five levels only:
 *   critical  red     — overdue, rejected, cancelled, failed
 *   warning   amber   — waiting on someone, due soon, partially paid
 *   progress  teal    — running as planned
 *   done      green   — finished, approved, paid
 *   idle      slate   — draft, inactive, nothing happening yet
 */
export type BadgeUrgency = 'critical' | 'warning' | 'progress' | 'done' | 'idle';

type BadgeVariant =
  | BadgeUrgency
  | 'outline'
  // Legacy names kept so existing screens keep working.
  | 'teal'
  | 'emerald'
  | 'amber'
  | 'rose'
  | 'slate'
  | 'neutral'
  | 'blue'
  | 'purple'
  | 'secondary';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
  /** Filled badge for dense tables, where a tint alone is too quiet to scan. */
  solid?: boolean;
  className?: string;
}

const urgencyStyles: Record<BadgeUrgency, string> = {
  critical: 'bg-status-critical-bg text-status-critical border-status-critical-border',
  warning: 'bg-status-warning-bg text-status-warning border-status-warning-border',
  progress: 'bg-status-progress-bg text-status-progress border-status-progress-border',
  done: 'bg-status-done-bg text-status-done border-status-done-border',
  idle: 'bg-status-idle-bg text-status-idle border-status-idle-border'
};

/* Solid fills: one glance separates the five states across a long table. */
const solidStyles: Record<BadgeUrgency, string> = {
  critical: 'bg-status-critical text-white border-status-critical',
  warning: 'bg-status-warning-strong text-black border-status-warning-strong',
  progress: 'bg-status-progress text-white border-status-progress',
  done: 'bg-status-done text-white border-status-done',
  idle: 'bg-status-idle text-white border-status-idle'
};

const legacyAliases: Record<string, BadgeUrgency> = {
  teal: 'progress',
  secondary: 'progress',
  blue: 'progress',
  emerald: 'done',
  amber: 'warning',
  rose: 'critical',
  slate: 'idle',
  neutral: 'idle',
  purple: 'idle'
};

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'progress',
  size = 'md',
  solid,
  className
}) => {
  const urgency = (legacyAliases[variant] ?? variant) as BadgeUrgency;
  const style =
    variant === 'outline'
      ? 'bg-white text-foreground border-border'
      : (solid ? solidStyles : urgencyStyles)[urgency];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border whitespace-nowrap font-sans font-semibold',
        size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-xs px-2.5 py-1',
        style,
        className
      )}
    >
      {children}
    </span>
  );
};

/** Urgency of a workflow status, from the status text the record stores. */
export function statusUrgency(status?: string | null): BadgeUrgency {
  const s = (status || '').toLowerCase();
  if (!s) return 'idle';

  if (
    /(reject|ditolak|cancel|batal|jatuh tempo|overdue|broken|rusak|gagal|failed|lot ditolak|repair|perbaikan|cacat)/.test(s)
  ) {
    return 'critical';
  }
  if (
    /(selesai|complete|lunas|approved|disetujui|verified|terverifikasi|accept|diterima|passed|lolos|delivered|sampai|resolved|compliant|sesuai standar|final|received)/.test(
      s
    )
  ) {
    return 'done';
  }
  if (
    /(pending|menunggu|tunda|queued|antre|draft|draf|revision|revisi|perlu|attention|belum|dp |dp dibayar|sebagian|requested|diajukan|submitted|investigating|diperiksa|standby|siaga|quotation|penawaran|leave|cuti)/.test(
      s
    )
  ) {
    return 'warning';
  }
  if (
    /(progress|dikerjakan|jahit|sewing|cutting|potong|running|beroperasi|active|aktif|production|diproduksi|transit|perjalanan|shipping|dikirim|packing|kemas|finishing|development|pengerjaan|spreading|gelar|maintenance|perawatan|qc|picked|diambil)/.test(
      s
    )
  ) {
    return 'progress';
  }
  return 'idle';
}

/*
 * Stages that share an urgency colour need a second signal, so the order
 * lifecycle carries an icon. Shape reads faster than a shade of teal when
 * Diproduksi, Tahap QC and Dikirim all sit in the same column. Statuses from
 * other modules fall through to text only.
 */
const statusIcons: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  Quotation: FileText,
  Order: Inbox,
  Sample: Palette,
  'In Production': Factory,
  QC: ClipboardCheck,
  Shipping: Truck,
  Completed: CheckCircle2,
  Cancelled: XCircle
};

export const StatusBadge: React.FC<{ status: string; size?: 'sm' | 'md'; solid?: boolean }> = ({
  status,
  size,
  solid
}) => {
  const Icon = statusIcons[status];
  return (
    <Badge variant={statusUrgency(status)} size={size} solid={solid}>
      {Icon && <Icon size={12} className="shrink-0" aria-hidden="true" />}
      {statusLabel(status)}
    </Badge>
  );
};

/** Days left against a deadline, coloured by how close it is. */
export const DeadlineBadge: React.FC<{
  deadline?: string | null;
  /** Done records stop counting down. */
  completed?: boolean;
  size?: 'sm' | 'md';
}> = ({ deadline, completed, size = 'sm' }) => {
  if (!deadline) return null;
  const due = new Date(deadline);
  if (isNaN(due.getTime())) return null;

  if (completed) {
    return (
      <Badge variant="done" size={size}>
        Selesai
      </Badge>
    );
  }

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const days = Math.round((due.setHours(0, 0, 0, 0) - startOfToday.getTime()) / 86400000);

  if (days < 0) {
    return (
      <Badge variant="critical" size={size}>
        Lewat {Math.abs(days)} hari
      </Badge>
    );
  }
  if (days === 0) {
    return (
      <Badge variant="critical" size={size}>
        Hari ini
      </Badge>
    );
  }
  if (days <= 3) {
    return (
      <Badge variant="warning" size={size}>
        Sisa {days} hari
      </Badge>
    );
  }
  return (
    <Badge variant="idle" size={size}>
      Sisa {days} hari
    </Badge>
  );
};
