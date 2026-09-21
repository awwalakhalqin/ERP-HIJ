/**
 * Official Company Contact Configuration
 * Kontak Resmi PT Hasil Inti Jualan (HIJ Konveksi)
 */
export const COMPANY_CONTACT = {
  name: 'PT Hasil Inti Jualan (HIJ Konveksi)',
  shortName: 'HIJ Konveksi',
  whatsappNumber: '6287778899719', // Format nomor internasional tanpa simbol (6287778899719)
  whatsappFormatted: '+62 877-7889-9719', // Format tampilan internasional (+62 877-7889-9719)
  whatsappDisplay: '0877-7889-9719', // Format tampilan lokal
  email: 'halo@hij.co.id',
  address: 'Kawasan Industri Tekstil, Bandung, Jawa Barat',
  website: 'https://konveksi.hij.co.id'
};

/**
 * Generate a WhatsApp URL using the official company contact number
 */
export function getWhatsAppUrl(message?: string): string {
  const base = `https://wa.me/${COMPANY_CONTACT.whatsappNumber}`;
  if (!message) return base;
  return `${base}?text=${encodeURIComponent(message)}`;
}
