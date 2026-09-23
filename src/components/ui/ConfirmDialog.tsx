import React, { useCallback, useRef, useState } from 'react';
import { AlertTriangle, HelpCircle } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';
import { FieldLabel, FieldHint, Textarea } from './Field';

/*
 * Konfirmasi dan pertanyaan singkat, memakai Modal aplikasi sendiri.
 *
 * Sebelumnya layar-layar memakai window.confirm dan window.prompt: kotak itu
 * membekukan seluruh halaman, tidak bisa ditata, dan di ponsel menampilkan
 * alamat domain di atas pertanyaannya — terlihat seperti peringatan browser,
 * bukan bagian dari aplikasi. Kotak bawaan juga tidak bisa menampilkan angka
 * atau nama yang sedang dipertaruhkan dengan penekanan.
 *
 * Pemakaian sejajar dengan useToast:
 *
 *   const { confirm, ask, confirmDialog } = useConfirm();
 *   if (!(await confirm({ title: 'Hapus pesanan ini?', tone: 'danger' }))) return;
 *   ...
 *   return (<> ... {confirmDialog} </>);
 */

export interface ConfirmOptions {
  title: string;
  /** Penjelasan singkat: akibat tindakan ini, dan apa yang tidak bisa dibatalkan. */
  message?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
}

export interface AskOptions extends ConfirmOptions {
  inputLabel: string;
  placeholder?: string;
  hint?: string;
  required?: boolean;
}

type PendingState =
  | ({ kind: 'confirm' } & ConfirmOptions)
  | ({ kind: 'ask' } & AskOptions);

export function useConfirm() {
  const [pending, setPending] = useState<PendingState | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Janji yang sedang menunggu jawaban; disimpan di ref supaya render ulang
  // tidak pernah kehilangan penyelesaiannya.
  const resolver = useRef<((result: any) => void) | null>(null);

  const settle = useCallback((result: boolean | string | null) => {
    const resolve = resolver.current;
    resolver.current = null;
    setPending(null);
    setValue('');
    setError(null);
    resolve?.(result);
  }, []);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>(resolve => {
      resolver.current = resolve as (result: any) => void;
      setValue('');
      setError(null);
      setPending({ kind: 'confirm', ...options });
    });
  }, []);

  /** Konfirmasi yang sekalian meminta keterangan; null bila dibatalkan. */
  const ask = useCallback((options: AskOptions): Promise<string | null> => {
    return new Promise<string | null>(resolve => {
      resolver.current = resolve as (result: any) => void;
      setValue('');
      setError(null);
      setPending({ kind: 'ask', ...options });
    });
  }, []);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!pending) return;
    if (pending.kind === 'ask') {
      const answer = value.trim();
      if (pending.required && !answer) {
        setError(`${pending.inputLabel} wajib diisi.`);
        return;
      }
      settle(answer);
      return;
    }
    settle(true);
  };

  const cancel = () => settle(pending?.kind === 'ask' ? null : false);

  const danger = pending?.tone === 'danger';
  const Icon = danger ? AlertTriangle : HelpCircle;

  const confirmDialog = (
    <Modal
      isOpen={!!pending}
      onClose={cancel}
      title={pending?.title}
      maxWidth="md"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button type="button" variant="outline" onClick={cancel}>
            {pending?.cancelLabel || 'Batal'}
          </Button>
          <Button
            type="submit"
            form="confirm-dialog-form"
            className={danger ? 'bg-brand-red text-white hover:bg-brand-red-hover' : undefined}
          >
            {pending?.confirmLabel || 'Lanjutkan'}
          </Button>
        </div>
      }
    >
      {pending && (
        <form id="confirm-dialog-form" onSubmit={handleSubmit} className="space-y-4">
          <div className="flex items-start gap-3">
            <span
              className={
                danger
                  ? 'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-rose-50 text-brand-red'
                  : 'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-brand-teal-dark'
              }
            >
              <Icon size={18} aria-hidden="true" />
            </span>
            {pending.message ? (
              <div className="min-w-0 text-sm leading-relaxed text-muted-foreground">{pending.message}</div>
            ) : (
              <div className="min-w-0 text-sm leading-relaxed text-muted-foreground">
                Tindakan ini langsung berlaku.
              </div>
            )}
          </div>

          {pending.kind === 'ask' && (
            <div>
              <FieldLabel htmlFor="confirm-dialog-input" required={pending.required}>
                {pending.inputLabel}
              </FieldLabel>
              <Textarea
                id="confirm-dialog-input"
                rows={3}
                autoFocus
                value={value}
                placeholder={pending.placeholder}
                aria-invalid={!!error}
                onChange={event => {
                  setValue(event.target.value);
                  if (error) setError(null);
                }}
              />
              {error ? (
                <p role="alert" className="mt-1 text-xs font-medium text-brand-red">
                  {error}
                </p>
              ) : (
                pending.hint && <FieldHint>{pending.hint}</FieldHint>
              )}
            </div>
          )}
        </form>
      )}
    </Modal>
  );

  return { confirm, ask, confirmDialog };
}
