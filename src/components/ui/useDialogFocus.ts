import { useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Open dialogs, topmost last. Only the topmost one handles Escape and Tab.
const dialogStack: HTMLElement[] = [];

/**
 * Shared behaviour for Modal and DetailDrawer: locks page scroll, moves focus
 * into the panel, keeps Tab inside it, closes on Escape, and returns focus to
 * the control that opened it.
 */
export function useDialogFocus(isOpen: boolean, onClose: () => void) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    let registered: HTMLElement | null = null;

    const frame = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      registered = panel;
      dialogStack.push(panel);
      document.body.style.overflow = 'hidden';
      if (panel.contains(document.activeElement)) return;
      const preferred = panel.querySelector<HTMLElement>('[data-autofocus]');
      (preferred ?? panel).focus({ preventScroll: true });
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      const panel = panelRef.current;
      if (!panel || dialogStack[dialogStack.length - 1] !== panel) return;

      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;

      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        el => el.getClientRects().length > 0
      );
      if (items.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      if (registered) {
        const index = dialogStack.indexOf(registered);
        if (index !== -1) dialogStack.splice(index, 1);
      }
      if (dialogStack.length === 0) document.body.style.overflow = '';
      if (previouslyFocused && previouslyFocused.isConnected) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [isOpen]);

  return panelRef;
}
