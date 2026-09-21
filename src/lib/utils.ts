import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export { statusLabel } from './status';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number | string | undefined | null): string {
  if (amount === undefined || amount === null || isNaN(Number(amount))) {
    return 'Rp 0';
  }
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(num);
}

/*
 * Today's date on the wall clock, not in UTC. toISOString() converts first, so
 * in Indonesia every hour before 07:00 would record the previous day — and a
 * Monday morning entry would land in the wrong pay week.
 */
export function todayLocal(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function formatDate(dateString: string | undefined | null): string {
  if (!dateString) return '-';
  try {
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateString)) return dateString;
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    return new Intl.DateTimeFormat('id-ID', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(date);
  } catch {
    return dateString;
  }
}

export function formatDateTime(dateString: string | undefined | null): string {
  if (!dateString) return '-';
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    return new Intl.DateTimeFormat('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  } catch {
    return dateString;
  }
}

export function generateId(prefix: string): string {
  const randomStr = Math.random().toString(36).substring(2, 7).toUpperCase();
  const timestamp = Date.now().toString().slice(-4);
  return `${prefix}-${timestamp}-${randomStr}`;
}

// SOP-06 & 07: Fabric Consumption & Marker Efficiency Calculation
export function calculateFabricYield(
  piecesCount: number,
  averageConsumptionPerPieceMeters: number,
  markerEfficiencyPercentage: number
) {
  const theoreticalUsage = piecesCount * averageConsumptionPerPieceMeters;
  const actualUsageWithWaste = theoreticalUsage / (markerEfficiencyPercentage / 100);
  const wasteMeters = actualUsageWithWaste - theoreticalUsage;
  return {
    theoreticalUsage: Math.round(theoreticalUsage * 100) / 100,
    actualUsageWithWaste: Math.round(actualUsageWithWaste * 100) / 100,
    wasteMeters: Math.round(wasteMeters * 100) / 100
  };
}

// SOP-12: AQL 2.5 Sampling Limits (ISO 2859-1 Standard)
export function getAQLStandard(lotSize: number) {
  if (lotSize <= 50) return { sampleSize: Math.min(lotSize, 13), maxMinor: 1, maxMajor: 0, maxCritical: 0 };
  if (lotSize <= 150) return { sampleSize: 20, maxMinor: 2, maxMajor: 1, maxCritical: 0 };
  if (lotSize <= 500) return { sampleSize: 50, maxMinor: 3, maxMajor: 2, maxCritical: 0 };
  if (lotSize <= 1200) return { sampleSize: 80, maxMinor: 5, maxMajor: 3, maxCritical: 0 };
  return { sampleSize: 125, maxMinor: 7, maxMajor: 5, maxCritical: 0 };
}

// SOP-19: Borongan Wage Calculator
export function calculateBoronganPay(
  piecesPassedQC: number,
  ratePerPiece: number,
  targetQty: number = 0,
  attendanceIncentive: number = 0
) {
  const baseWage = piecesPassedQC * ratePerPiece;
  let bonus = 0;
  if (targetQty > 0 && piecesPassedQC >= targetQty) {
    // 10% bonus for reaching or exceeding target
    bonus = Math.round(baseWage * 0.1);
  }
  const grossPay = baseWage + bonus + attendanceIncentive;
  return {
    baseWage,
    bonus,
    attendanceIncentive,
    grossPay
  };
}

// Excel Export Utility (Dynamically imported to keep bundle lightweight)
export async function exportTableToExcel(data: any, fileName: string, sheetName: string = 'Sheet1') {
  const XLSX = await import('xlsx');
  let workbook;
  if (typeof data === 'string') {
    const el = document.getElementById(data);
    if (el) {
      workbook = XLSX.utils.table_to_book(el, { sheet: sheetName });
    } else {
      workbook = XLSX.utils.book_new();
    }
  } else if (Array.isArray(data)) {
    const worksheet = XLSX.utils.json_to_sheet(data);
    workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  } else {
    workbook = XLSX.utils.book_new();
  }
  XLSX.writeFile(workbook, `${fileName}.xlsx`);
}

export function terbilangRupiah(nominal: number | string | undefined | null): string {
  if (nominal === undefined || nominal === null || isNaN(Number(nominal))) return 'Nol Rupiah';
  const n = Math.floor(Math.abs(Number(nominal)));
  if (n === 0) return 'Nol Rupiah';

  const satuan = ['', 'Satu', 'Dua', 'Tiga', 'Empat', 'Lima', 'Enam', 'Tujuh', 'Delapan', 'Sembilan', 'Sepuluh', 'Sebelas'];

  function toWords(num: number): string {
    if (num < 12) return satuan[num];
    if (num < 20) return `${toWords(num - 10)} Belas`;
    if (num < 100) return `${toWords(Math.floor(num / 10))} Puluh${num % 10 > 0 ? ' ' + toWords(num % 10) : ''}`;
    if (num < 200) return `Seratus${num - 100 > 0 ? ' ' + toWords(num - 100) : ''}`;
    if (num < 1000) return `${toWords(Math.floor(num / 100))} Ratus${num % 100 > 0 ? ' ' + toWords(num % 100) : ''}`;
    if (num < 2000) return `Seribu${num - 1000 > 0 ? ' ' + toWords(num - 1000) : ''}`;
    if (num < 1000000) return `${toWords(Math.floor(num / 1000))} Ribu${num % 1000 > 0 ? ' ' + toWords(num % 1000) : ''}`;
    if (num < 1000000000) return `${toWords(Math.floor(num / 1000000))} Juta${num % 1000000 > 0 ? ' ' + toWords(num % 1000000) : ''}`;
    if (num < 1000000000000) return `${toWords(Math.floor(num / 1000000000))} Miliar${num % 1000000000 > 0 ? ' ' + toWords(num % 1000000000) : ''}`;
    return `${toWords(Math.floor(num / 1000000000000))} Triliun${num % 1000000000000 > 0 ? ' ' + toWords(num % 1000000000000) : ''}`;
  }

  return `${toWords(n).trim()} Rupiah`;
}
