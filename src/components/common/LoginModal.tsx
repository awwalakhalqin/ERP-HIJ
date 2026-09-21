import React, { useState } from 'react';
import {
  Lock,
  User as UserIcon,
  Eye,
  EyeOff,
  AlertCircle,
  Loader2,
  ArrowRight,
  MessageCircle,
  ChevronDown,
  ChevronUp,
  Info
} from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { AuthSession } from '../../types';
import { unifiedLoginApi } from '../../services/api';
import { COMPANY_CONTACT, getWhatsAppUrl } from '../../config/contact';

interface LoginModalProps {
  onLoginSuccess: (session: AuthSession) => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({ onLoginSuccess }) => {
  const [identifier, setIdentifier] = useState('admin.rezza');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showDemoList, setShowDemoList] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();

  const handleLogin = async (e?: React.FormEvent, customIdent?: string, customPass?: string) => {
    if (e) e.preventDefault();
    const idToUse = (customIdent !== undefined ? customIdent : identifier).trim();
    const passToUse = (customPass !== undefined ? customPass : password).trim();

    if (!idToUse) {
      setError('Masukkan username, nomor WhatsApp, atau ID akun Anda.');
      return;
    }
    if (!passToUse) {
      setError('Masukkan kata sandi Anda.');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const session = await unifiedLoginApi(idToUse, passToUse);
      onLoginSuccess(session);
    } catch (err: any) {
      setError(err.message || 'Login gagal. Periksa kembali kredensial Anda.');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectQuickDemo = (demoId: string, demoPass: string) => {
    setIdentifier(demoId);
    setPassword(demoPass);
    setError(null);
    handleLogin(undefined, demoId, demoPass);
  };

  return (
    // In-flow (not a fixed overlay) so the PWA install banner rendered above it in App stays visible
    <div className="relative flex-1 w-full bg-slate-50 flex flex-col items-center justify-center p-4 sm:p-6">
      {/* Subtle minimalist grid texture */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none opacity-40"
        style={{
          backgroundImage: 'radial-gradient(#cbd5e1 1px, transparent 1px)',
          backgroundSize: '24px 24px'
        }}
      />

      <motion.main
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full max-w-[400px] my-auto"
      >
        {/* Main Minimalist Card */}
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-[0_4px_24px_rgba(0,0,0,0.04)] p-6 sm:p-8 space-y-6">
          {/* Brand & Header */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <img
                src="/logo.png"
                alt="Logo PT Hasil Inti Jualan"
                width={40}
                height={40}
                className="w-10 h-10 object-contain rounded-xl border border-slate-100 p-1 shadow-xs shrink-0"
              />
              <div>
                <h1 className="text-base font-bold text-slate-900 tracking-tight leading-tight">
                  HIJ Konveksi
                </h1>
                <p className="text-xs text-slate-500 font-normal">
                  PT Hasil Inti Jualan
                </p>
              </div>
            </div>

            <div className="pt-1">
              <h2 className="text-lg font-semibold text-slate-900 tracking-tight">
                ERP Operasional Pabrik
              </h2>
              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                Khusus staf internal HIJ (Super Admin, Owner, Design, Pengadaan, Produksi).
              </p>
            </div>
          </div>

          {/* Customer Notice Link to Compro */}
          <div className="p-3 bg-muted border border-border rounded-xl flex items-start gap-2.5 text-xs text-brand-teal-dark leading-relaxed">
            <Info size={15} className="shrink-0 text-brand-teal-dark mt-0.5" aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-semibold text-foreground">Pelanggan ingin melacak pesanan?</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Gunakan <a href="http://localhost:3000/portal" target="_blank" rel="noopener noreferrer" className="underline font-semibold text-brand-teal-dark hover:text-foreground">Portal Klien & Lacak Pesanan</a> di website profil HIJ Konveksi.
              </p>
            </div>
          </div>

          {/* Inline Error Alert */}
          {error && (
            <motion.div
              id="login-error"
              role="alert"
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-3 bg-rose-50 border border-rose-100 rounded-xl flex items-start gap-2.5 text-xs text-brand-red-cta leading-relaxed"
            >
              <AlertCircle size={15} className="shrink-0 mt-0.5 text-brand-red" aria-hidden="true" />
              <span className="min-w-0 break-words">{error}</span>
            </motion.div>
          )}

          {/* Login Form */}
          <form onSubmit={handleLogin} aria-busy={loading} className="space-y-4">
            <div>
              <label
                htmlFor="login-identifier"
                className="block text-xs font-semibold text-foreground mb-1.5"
              >
                Username atau Nomor WhatsApp
              </label>
              <div className="relative">
                <input
                  id="login-identifier"
                  name="username"
                  type="text"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="admin.rezza atau arkato"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? 'login-error' : undefined}
                  className="w-full h-11 px-3.5 bg-muted/40 hover:bg-muted/70 focus:bg-white border border-border focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20 rounded-xl text-sm text-foreground placeholder:text-muted-foreground transition-all outline-none"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="login-password"
                className="block text-xs font-semibold text-foreground mb-1.5"
              >
                Kata Sandi
              </label>
              <div className="relative">
                <input
                  id="login-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Masukkan kata sandi"
                  autoComplete="current-password"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? 'login-error' : undefined}
                  className="w-full h-11 pl-3.5 pr-12 bg-muted/40 hover:bg-muted/70 focus:bg-white border border-border focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20 rounded-xl text-sm text-foreground placeholder:text-muted-foreground transition-all outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label="Tampilkan kata sandi"
                  aria-pressed={showPassword}
                  aria-controls="login-password"
                  title={showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
                  className="absolute right-0.5 top-1/2 -translate-y-1/2 size-10 inline-flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal"
                >
                  {showPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 bg-brand-teal hover:bg-[#249ea2] text-[#000000] rounded-xl text-sm font-bold transition-all active:scale-[0.99] disabled:opacity-70 disabled:cursor-wait flex items-center justify-center gap-2 cursor-pointer shadow-md"
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin text-[#000000]" aria-hidden="true" />
                  <span>Memverifikasi...</span>
                </>
              ) : (
                <>
                  <span>Masuk</span>
                  <ArrowRight size={15} className="text-[#000000]" aria-hidden="true" />
                </>
              )}
            </button>
          </form>

          {/* Demo accounts: development builds only — see import.meta.env.DEV. */}
          {import.meta.env.DEV && (
          <div className="pt-2 border-t border-border">
            <button
              type="button"
              onClick={() => setShowDemoList(!showDemoList)}
              aria-expanded={showDemoList}
              aria-controls="login-demo-accounts"
              className="w-full min-h-10 flex items-center justify-between text-xs text-muted-foreground hover:text-foreground py-1 transition-colors cursor-pointer"
            >
              <span className="font-medium">Akun Demo Pengujian</span>
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                {showDemoList ? 'Tutup' : 'Pilih Akun'}
                {showDemoList ? <ChevronUp size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
              </span>
            </button>

            <AnimatePresence>
              {showDemoList && (
                <motion.div
                  id="login-demo-accounts"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: reduceMotion ? 0 : 0.2 }}
                  className="overflow-hidden pt-2 space-y-1.5"
                >
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => handleSelectQuickDemo('admin.rezza', 'password123')}
                      className="px-2.5 py-2 text-left bg-muted/50 hover:bg-muted border border-border rounded-lg transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-wait"
                    >
                      <div className="text-xs font-semibold text-foreground">Super Admin</div>
                      <div className="text-[10px] text-muted-foreground">Semua Akses</div>
                    </button>

                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => handleSelectQuickDemo('owner.hij', 'password123')}
                      className="px-2.5 py-2 text-left bg-muted/50 hover:bg-muted border border-border rounded-lg transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-wait"
                    >
                      <div className="text-xs font-semibold text-foreground">Owner</div>
                      <div className="text-[10px] text-muted-foreground">Eksekutif / Fin</div>
                    </button>

                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => handleSelectQuickDemo('desain.dina', 'password123')}
                      className="px-2.5 py-2 text-left bg-muted/50 hover:bg-muted border border-border rounded-lg transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-wait"
                    >
                      <div className="text-xs font-semibold text-foreground">Design</div>
                      <div className="text-[10px] text-muted-foreground">Desain & Sampel</div>
                    </button>

                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => handleSelectQuickDemo('pengadaan.budi', 'password123')}
                      className="px-2.5 py-2 text-left bg-muted/50 hover:bg-muted border border-border rounded-lg transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-wait"
                    >
                      <div className="text-xs font-semibold text-foreground">Pengadaan</div>
                      <div className="text-[10px] text-muted-foreground">Bahan & Trims</div>
                    </button>

                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => handleSelectQuickDemo('produksi.agus', 'password123')}
                      className="px-2.5 py-2 text-left bg-muted/50 hover:bg-muted border border-border rounded-lg transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-wait"
                    >
                      <div className="text-xs font-semibold text-foreground">Produksi</div>
                      <div className="text-[10px] text-muted-foreground">Pabrik & QC</div>
                    </button>

                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => handleSelectQuickDemo('arkato', 'klien123')}
                      className="px-2.5 py-2 text-left bg-muted hover:bg-accent border border-brand-teal/40 rounded-lg transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-wait"
                    >
                      <div className="text-xs font-semibold text-brand-teal-dark">Pelanggan</div>
                      <div className="text-[10px] text-brand-teal-dark">Portal Klien</div>
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          )}
        </div>

        {/* Minimal Footer Support */}
        <footer className="mt-5 text-center space-y-2">
          <a
            href={getWhatsAppUrl('Halo CS HIJ, saya membutuhkan bantuan akun atau login ke sistem.')}
            target="_blank"
            rel="noopener noreferrer"
            className="min-h-10 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-brand-teal-dark transition-colors"
          >
            <MessageCircle size={13} className="text-brand-teal-dark shrink-0" aria-hidden="true" />
            <span>Butuh bantuan akun? Hubungi WhatsApp CS: <strong className="text-foreground font-semibold whitespace-nowrap">{COMPANY_CONTACT.whatsappFormatted}</strong></span>
          </a>

          <p className="text-[11px] text-muted-foreground font-normal">
            (c) {new Date().getFullYear()} PT Hasil Inti Jualan. Developed with{' '}
            <a
              href="https://karyalo.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-brand-teal-dark font-medium transition-colors"
            >
              KaryaLo Digital Solution
            </a>
            .
          </p>
        </footer>
      </motion.main>
    </div>
  );
};
