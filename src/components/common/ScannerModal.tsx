import React, { useEffect, useState } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { Check, AlertCircle } from 'lucide-react';
import { Modal } from '../ui/Modal';

interface ScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanSuccess: (decodedText: string) => void;
  title?: string;
  subtitle?: string;
}

export const ScannerModal: React.FC<ScannerModalProps> = ({
  isOpen,
  onClose,
  onScanSuccess,
  title = 'Scan QR / Barcode',
  subtitle = 'Arahkan kamera ke QR atau barcode.'
}) => {
  const [manualCode, setManualCode] = useState('');
  const [scanError, setScanError] = useState<string | null>(null);

  useEffect(() => {
    let scanner: Html5QrcodeScanner | null = null;

    if (isOpen) {
      // Allow DOM to mount the scanner element
      const timer = setTimeout(() => {
        try {
          scanner = new Html5QrcodeScanner(
            'qr-code-scanner-element',
            {
              fps: 10,
              qrbox: { width: 250, height: 250 },
              rememberLastUsedCamera: true
            },
            false
          );

          scanner.render(
            (decodedText) => {
              if (scanner) {
                scanner.clear().catch(() => {});
              }
              onScanSuccess(decodedText);
              onClose();
            },
            (errorMessage) => {
              // Ignore frequent scan errors while looking for code
            }
          );
        } catch (err: any) {
          setScanError('Kamera tidak bisa dibuka. Ketik kode secara manual di bawah.');
        }
      }, 300);

      return () => {
        clearTimeout(timer);
        if (scanner) {
          scanner.clear().catch(() => {});
        }
      };
    }
  }, [isOpen]);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCode.trim()) return;
    onScanSuccess(manualCode.trim());
    setManualCode('');
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} subtitle={subtitle} maxWidth="md">
      <div className="space-y-5">
        {scanError && (
          <div role="alert" className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2 text-sm text-amber-800">
            <AlertCircle size={16} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
            <span className="min-w-0">{scanError}</span>
          </div>
        )}

        <div
          role="region"
          aria-label="Kamera pemindai"
          className="w-full bg-[#092629] rounded-2xl overflow-hidden min-h-[260px] flex flex-col items-center justify-center relative p-2 border border-border"
        >
          <div id="qr-code-scanner-element" className="w-full text-white" />
        </div>

        {/* Manual Barcode / Ticket ID input */}
        <div className="pt-4 border-t border-border">
          <label htmlFor="manual-scan-code" className="block text-sm font-semibold text-foreground mb-1.5">
            Atau ketik kode
          </label>
          <form onSubmit={handleManualSubmit} className="flex gap-2">
            <input
              id="manual-scan-code"
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              placeholder="Contoh: BND-SPK-001-SZ-M-01"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              className="flex-1 min-w-0 h-10 px-3 bg-white border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-teal font-mono"
            />
            <button
              type="submit"
              className="h-10 px-4 bg-brand-teal text-[#000000] font-bold rounded-lg hover:bg-[#249ea2] transition-colors text-sm flex items-center gap-1.5 shrink-0 cursor-pointer shadow-xs"
            >
              <Check size={16} className="text-[#000000]" aria-hidden="true" />
              Buka
            </button>
          </form>
        </div>
      </div>
    </Modal>
  );
};
