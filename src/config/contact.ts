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
  // Same values the company website (Compro-HIJ, lib/company-data.ts) publishes.
  email: 'konveksi@hasilintijualan.com',
  // Registered address (NIB), the same one the company website prints.
  address: 'Jl. Sadewa No. 28 RT 05 RW 08, Harjamukti, Kec. Cimanggis, Kota Depok, Jawa Barat 16454',
  website: 'https://hasilintijualan.com',
  /**
   * Customer portal: the ERP served on its own host. Handed to customers with
   * their login and never linked from the public website.
   */
  portalUrl: 'https://portal.hasilintijualan.com',
  /** Public order tracking (number only, no account) on the company website. */
  trackingUrl: 'https://hasilintijualan.com/portal',
  /*
   * Bank accounts printed on the invoice. The official invoice template
   * (reference/generate-form/Invoice_ORD-001.pdf) is the source of truth; the
   * first entry is the one the invoice prints under "Transfer ke".
   */
  bankAccounts: [
    {
      bank: 'MANDIRI',
      accountNumber: '1150011767581',
      accountName: 'PT HASIL INTI JUALAN'
    }
  ]
};

export type BankAccount = (typeof COMPANY_CONTACT)['bankAccounts'][number];

/** The account the invoice tells customers to transfer to. */
export const INVOICE_BANK: BankAccount = COMPANY_CONTACT.bankAccounts[0];

/**
 * Generate a WhatsApp URL using the official company contact number
 */
export function getWhatsAppUrl(message?: string): string {
  const base = `https://wa.me/${COMPANY_CONTACT.whatsappNumber}`;
  if (!message) return base;
  return `${base}?text=${encodeURIComponent(message)}`;
}
