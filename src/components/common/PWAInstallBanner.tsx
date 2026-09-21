import React, { useState, useEffect } from 'react';
import { Download, X, Smartphone } from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';

const DISMISS_KEY = 'hij_pwa_dismissed';

export const PWAInstallBanner: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showBanner, setShowBanner] = useState(false);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      // Check if user previously dismissed (storage can throw in private mode)
      let dismissed: string | null = null;
      try {
        dismissed = localStorage.getItem(DISMISS_KEY);
      } catch {
        dismissed = null;
      }
      if (!dismissed) {
        setShowBanner(true);
      }
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setShowBanner(false);
    }
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setShowBanner(false);
    try {
      localStorage.setItem(DISMISS_KEY, 'true');
    } catch {
      // Ignore: the banner simply shows again next session
    }
  };

  return (
    <AnimatePresence>
      {showBanner && (
        // In-flow row at the top of the app's flex column: no sticky/z-index, so it never covers headers or dialogs
        <motion.section
          aria-labelledby="pwa-install-title"
          initial={reduceMotion ? { opacity: 0 } : { y: -50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { y: -50, opacity: 0 }}
          className="relative shrink-0 bg-brand-teal-dark text-white px-4 py-2.5 shadow-lg flex items-center justify-between gap-3 text-sm"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="hidden sm:flex w-9 h-9 rounded-xl bg-white/20 items-center justify-center shrink-0" aria-hidden="true">
              <Smartphone size={18} className="text-teal-100" />
            </div>
            <div className="min-w-0">
              <p id="pwa-install-title" className="font-bold">Pasang Aplikasi HIJ</p>
              <p className="text-teal-50/90 text-xs">
                Buka lebih cepat langsung dari layar utama.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={handleInstall}
              className="h-10 px-3 bg-white text-teal-800 font-semibold rounded-lg hover:bg-teal-50 transition-colors flex items-center gap-1.5 shadow-sm text-sm cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-brand-teal-dark"
            >
              <Download size={15} aria-hidden="true" />
              Pasang
            </button>
            <button
              type="button"
              onClick={handleDismiss}
              aria-label="Tutup ajakan pasang aplikasi"
              title="Tutup"
              className="size-10 inline-flex items-center justify-center hover:bg-white/10 rounded-lg text-teal-100 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
};
