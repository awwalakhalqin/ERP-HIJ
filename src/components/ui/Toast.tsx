import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, AlertCircle } from 'lucide-react';
import { cn } from '../../lib/utils';

/*
 * One transient message at a time, bottom-right. Success and failure look
 * different, so a red outcome is never mistaken for a green one — which is what
 * happened while every module reported failures through window.alert.
 */

export type ToastTone = 'success' | 'error';

export interface ToastState {
  message: string;
  tone: ToastTone;
}

export const Toast: React.FC<{ toast: ToastState | null }> = ({ toast }) =>
  toast ? (
    <div
      role="status"
      className={cn(
        'fixed bottom-6 right-6 z-50 flex max-w-sm items-start gap-3 rounded-2xl border bg-popover px-4 py-3 text-sm font-medium text-popover-foreground shadow-lg animate-in fade-in slide-in-from-bottom-2',
        toast.tone === 'error' ? 'border-brand-red/40' : 'border-border'
      )}
    >
      {toast.tone === 'error' ? (
        <AlertCircle size={18} className="mt-px shrink-0 text-brand-red" aria-hidden="true" />
      ) : (
        <Sparkles size={18} className="mt-px shrink-0 text-brand-teal" aria-hidden="true" />
      )}
      <span>{toast.message}</span>
    </div>
  ) : null;

export function useToast(durationMs = 4500) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<number | null>(null);

  const showToast = useCallback(
    (message: string, tone: ToastTone = 'success') => {
      // Without clearing, a second message inherits the first one's countdown
      // and disappears early.
      if (timer.current !== null) window.clearTimeout(timer.current);
      setToast({ message, tone });
      timer.current = window.setTimeout(() => setToast(null), durationMs);
    },
    [durationMs]
  );

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    []
  );

  return { toast, showToast };
}
