/*
 * One build, two doors.
 *
 * The same bundle is served on two hosts: the ERP for staff
 * (erp.hasilintijualan.com) and the customer portal (portal.hasilintijualan.com).
 * Which door the visitor came through decides what the login screen accepts
 * and what a restored session is allowed to be — a customer account never
 * lands in the ERP, and a staff account never signs in on the portal.
 *
 * Locally, /portal on the dev server opens the portal door.
 */
export type SiteMode = 'erp' | 'portal';

export function detectSiteMode(): SiteMode {
  if (typeof window === 'undefined') return 'erp';
  const host = window.location.hostname.toLowerCase();
  const configured = String(import.meta.env.VITE_PORTAL_HOST || '').toLowerCase();
  if (configured && host === configured) return 'portal';
  if (/^portal\./.test(host)) return 'portal';
  if (/^\/portal(\/|$)/.test(window.location.pathname)) return 'portal';
  return 'erp';
}

export const SITE_MODE: SiteMode = detectSiteMode();
export const isPortalSite = SITE_MODE === 'portal';
