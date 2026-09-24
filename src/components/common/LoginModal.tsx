import React, { useState } from 'react';
import {
  Eye,
  EyeOff,
  AlertCircle,
  Loader2,
  ArrowRight,
  MessageCircle
} from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { AuthSession } from '../../types';
import { unifiedLoginApi, setAuthToken } from '../../services/api';
import { isPortalSite } from '../../lib/site';
import { COMPANY_CONTACT, getWhatsAppUrl } from '../../config/contact';

interface LoginModalProps {
  onLoginSuccess: (session: AuthSession) => void;
}

/*
 * The login page names no roles, no other door and no account types: anything
 * shown here is shown to whoever finds the address. Help goes through WhatsApp.
 */
const WRONG_DOOR = 'Akun ini tidak memiliki akses ke halaman ini.';

export const LoginModal: React.FC<LoginModalProps> = ({ onLoginSuccess }) => {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();

  /*
   * One form for everyone: the server looks the account up and answers with
   * its role and menus, so there is nothing to pick here. Roles are assigned
   * in Akun & Hak Akses, never at the door.
   */
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const idToUse = identifier.trim();
    const passToUse = password.trim();

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
      /*
       * Each door admits one kind of account. The token was already issued,
       * so it is dropped again here rather than left in storage.
       */
      if (session.type !== (isPortalSite ? 'customer' : 'internal')) {
        setAuthToken(undefined);
        throw new Error(WRONG_DOOR);
      }
      onLoginSuccess(session);
    } catch (err: any) {
      setError(err.message || 'Login gagal. Periksa kembali kredensial Anda.');
    } finally {
      setLoading(false);
    }
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
                Masuk
              </h2>
              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                Gunakan akun yang diberikan oleh HIJ.
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
