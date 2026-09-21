import React, { useId } from 'react';
import { X } from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { useDialogFocus } from './useDialogFocus';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  /** Accessible name when the modal has no visible title. */
  ariaLabel?: string;
  maxWidth?: ModalWidth;
  /** Alias of maxWidth. */
  size?: ModalWidth;
  /** Actions pinned to the bottom of the dialog; the body scrolls behind them. */
  footer?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

type ModalWidth = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl' | '6xl' | 'full';

const widthClasses: Record<ModalWidth, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl',
  '5xl': 'max-w-5xl',
  '6xl': 'max-w-6xl',
  full: 'max-w-[95vw]'
};

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  ariaLabel,
  maxWidth,
  size,
  footer,
  className = '',
  children
}) => {
  const width = maxWidth ?? size ?? '2xl';
  const titleId = useId();
  const subtitleId = useId();
  const reduceMotion = useReducedMotion();
  const panelRef = useDialogFocus(isOpen, onClose);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            aria-hidden="true"
            className="fixed inset-0 bg-[#0a1414]/50 backdrop-blur-xs"
          />

          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            aria-describedby={subtitle ? subtitleId : undefined}
            aria-label={title ? undefined : ariaLabel}
            tabIndex={-1}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 12 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className={`relative z-10 my-auto flex max-h-[calc(100dvh-1.5rem)] w-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl outline-none sm:max-h-[calc(100dvh-3rem)] ${widthClasses[width]} ${className}`}
          >
            {(title || subtitle) && (
              <div className="shrink-0 px-5 sm:px-6 py-4 border-b border-border flex items-start justify-between gap-4 bg-muted/40">
                <div className="min-w-0">
                  {title && (
                    <h2 id={titleId} className="text-lg font-bold text-foreground leading-snug text-balance">
                      {title}
                    </h2>
                  )}
                  {subtitle && (
                    <p id={subtitleId} className="text-sm text-muted-foreground mt-1">
                      {subtitle}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Tutup"
                  className="size-9 -mr-1.5 -mt-1 inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal"
                >
                  <X size={18} aria-hidden="true" />
                </button>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 sm:p-6 text-foreground">
              {children}
            </div>

            {footer && (
              <div className="shrink-0 border-t border-border bg-muted/40 px-5 py-3 sm:px-6 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
