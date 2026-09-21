import React from 'react';
import { AlertCircle, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

/*
 * Form vocabulary shared by every form in the app: one label style, one control
 * height, one focus ring, one way to show a hint or an error.
 */

const controlBase =
  'w-full h-10 rounded-lg border border-border bg-white px-3 text-sm font-medium text-foreground transition-colors placeholder:text-muted-foreground placeholder:font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal focus-visible:border-brand-teal disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-brand-red aria-invalid:ring-brand-red/30';

interface FieldLabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
  /** Small note on the right, e.g. "Opsional". */
  aside?: React.ReactNode;
}

export const FieldLabel: React.FC<FieldLabelProps> = ({ required, aside, className, children, ...props }) => (
  <div className="mb-1.5 flex items-baseline justify-between gap-2">
    <label className={cn('block text-sm font-semibold text-foreground', className)} {...props}>
      {children}
      {required && (
        <>
          <span aria-hidden="true" className="ml-0.5 text-brand-red">*</span>
          <span className="sr-only"> (wajib diisi)</span>
        </>
      )}
    </label>
    {aside && <span className="shrink-0 text-xs font-medium text-muted-foreground">{aside}</span>}
  </div>
);

export const FieldHint: React.FC<{ id?: string; className?: string; children: React.ReactNode }> = ({
  id,
  className,
  children
}) => (
  <p id={id} className={cn('mt-1.5 text-xs text-muted-foreground', className)}>
    {children}
  </p>
);

export const FieldError: React.FC<{ id?: string; children?: React.ReactNode }> = ({ id, children }) =>
  children ? (
    <p id={id} className="mt-1.5 flex items-start gap-1.5 text-xs font-semibold text-brand-red">
      <AlertCircle size={14} className="mt-px shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  ) : null;

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {}

/** Native select, themed to match Input (the OS arrow is replaced). */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(({ className, children, ...props }, ref) => (
  <div className="relative">
    <select ref={ref} className={cn(controlBase, 'appearance-none pr-9', className)} {...props}>
      {children}
    </select>
    <ChevronDown
      size={16}
      aria-hidden="true"
      className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
    />
  </div>
));
Select.displayName = 'Select';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(controlBase, 'h-auto py-2.5 leading-relaxed', className)} {...props} />
));
Textarea.displayName = 'Textarea';

interface CurrencyInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {}

/** Rupiah amount: prefixed, right-aligned, numeric keypad on phones. */
export const CurrencyInput = React.forwardRef<HTMLInputElement, CurrencyInputProps>(
  ({ className, ...props }, ref) => (
    <div className="relative">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground"
      >
        Rp
      </span>
      <input
        ref={ref}
        type="number"
        inputMode="numeric"
        min={0}
        step={500}
        className={cn(controlBase, 'pl-9 text-right font-semibold tabular-nums', className)}
        {...props}
      />
    </div>
  )
);
CurrencyInput.displayName = 'CurrencyInput';

interface FormSectionProps {
  /** Position in the form's sequence, shown when the order matters. */
  step?: number;
  title: string;
  description?: React.ReactNode;
  /** Status or count shown at the end of the section header. */
  aside?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

export const FormSection: React.FC<FormSectionProps> = ({
  step,
  title,
  description,
  aside,
  className,
  children
}) => (
  <section className={cn('rounded-2xl border border-border bg-white p-4 sm:p-5', className)}>
    <div className="mb-4 flex flex-wrap items-start justify-between gap-2 border-b border-border pb-3">
      <div className="flex min-w-0 items-start gap-2.5">
        {step !== undefined && (
          <span
            aria-hidden="true"
            className="mt-px flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-bold text-brand-teal-dark tabular-nums"
          >
            {step}
          </span>
        )}
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-foreground">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-muted-foreground text-pretty">{description}</p>}
        </div>
      </div>
      {aside && <div className="shrink-0">{aside}</div>}
    </div>
    <div className="space-y-4">{children}</div>
  </section>
);

interface ChipButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
}

/** Quick-fill suggestion. Selection is announced, not just coloured. */
export const ChipButton: React.FC<ChipButtonProps> = ({ selected, className, children, ...props }) => (
  <button
    type="button"
    aria-pressed={selected}
    className={cn(
      'inline-flex h-8 cursor-pointer items-center rounded-lg border px-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal focus-visible:ring-offset-1',
      selected
        ? 'border-brand-teal-dark bg-brand-teal-dark text-white'
        : 'border-border bg-muted/60 text-slate-700 hover:border-brand-teal/50 hover:bg-muted',
      className
    )}
    {...props}
  >
    {children}
  </button>
);

/** Form-level failure: what went wrong and what to do about it. */
export const FormError: React.FC<{ children?: React.ReactNode }> = ({ children }) =>
  children ? (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-xl border border-brand-red/30 bg-rose-50 px-3.5 py-3 text-sm font-medium text-foreground"
    >
      <AlertCircle size={18} className="mt-px shrink-0 text-brand-red" aria-hidden="true" />
      <span>{children}</span>
    </div>
  ) : null;

/** Neutral explanation at the top of a form. */
export const FormNotice: React.FC<{ icon?: React.ReactNode; title: string; children?: React.ReactNode }> = ({
  icon,
  title,
  children
}) => (
  <div className="flex items-start gap-3 rounded-xl border border-teal-200 bg-teal-50/70 px-3.5 py-3">
    {icon && (
      <span className="mt-px shrink-0 text-brand-teal-dark" aria-hidden="true">
        {icon}
      </span>
    )}
    <div className="min-w-0">
      <p className="text-sm font-semibold text-teal-950">{title}</p>
      {children && <p className="mt-0.5 text-xs leading-relaxed text-teal-900/90 text-pretty">{children}</p>}
    </div>
  </div>
);
