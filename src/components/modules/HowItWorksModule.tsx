import React from 'react';
import {
  ArrowRight,
  Banknote,
  CheckCircle2,
  FileCheck,
  Layers,
  Ruler,
  ShieldCheck,
  Lock,
  Sparkles
} from 'lucide-react';
import { SOPModule } from '../../types';
import { REQUIREMENT_LABELS } from '../../lib/readiness';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { PageHeader } from '../ui/PageHeader';

interface HowItWorksProps {
  onNavigate: (module: SOPModule) => void;
  canOpen: (module: SOPModule) => boolean;
}

interface FlowStep {
  title: string;
  sop: string;
  module?: SOPModule;
  moduleLabel?: string;
  who: string;
  body: string;
  note?: string;
}

interface FlowPhase {
  title: string;
  steps: FlowStep[];
}

// Order of work follows SOP 01–20. Every sentence describes something the app actually does.
const PHASES: FlowPhase[] = [
  {
    title: 'Penawaran & Pesanan',
    steps: [
      {
        title: 'Penawaran Harga (Quotation)',
        sop: 'SOP 01A',
        module: 'Quotations',
        moduleLabel: 'Surat Penawaran',
        who: 'Admin Penjualan, Sales',
        body: 'Definisikan 4 Serangkai: Desain Mockup, Bahan/Material, Warna/Kuantitas (MOQ 100 pcs), dan Sablon/Bordir. Tentukan opsi Perlu Sampel Fisik atau Tanpa Sampel Fisik, lalu cetak Surat Penawaran resmi berstempel basah. Penawaran deal tetap dapat direvisi di tengah jalan jika ada penambahan kuantitas.',
        note: 'Kuantitas di bawah MOQ 100 pcs otomatis menerapkan penyesuaian tarif khusus.'
      },
      {
        title: 'Pesanan Masuk & Repeat Order (PO)',
        sop: 'SOP 01B',
        module: 'Orders',
        moduleLabel: 'Pesanan Masuk',
        who: 'Admin Penjualan, Supervisor Penjualan',
        body: 'Pesanan resmi dibuat otomatis dari Surat Penawaran yang deal. Khusus Repeat Order (pesanan berulang barang sama), pesanan dapat dibuat langsung secara manual tanpa perlu membuat penawaran baru terlebih dahulu.',
        note: 'SPK tidak wajib dipenuhi secara ketat untuk Repeat Order atau pesanan kuantitas < 50 pcs (jalur cepat SPK Manual/Opsional).'
      },
      {
        title: 'Pembayaran DP (Termin 1)',
        sop: 'SOP 20',
        module: 'Finance',
        moduleLabel: 'Keuangan',
        who: 'Admin Keuangan, Owner',
        body: 'Catat pembayaran DP 50% via rekening resmi PT Mandiri / BCA. Sistem mencatat pembayaran terverifikasi dan otomatis memperbarui syarat DP pesanan.',
        note: 'Pelanggan dengan termin khusus dapat lanjut produksi jika owner menyetujui di halaman Surat Perintah Kerja.'
      }
    ]
  },
  {
    title: 'Persiapan Produksi & Sampel',
    steps: [
      {
        title: 'Desain & Sampel Fisik (Gerbang Anti-Skip 1)',
        sop: 'SOP 02',
        module: 'Designs',
        moduleLabel: 'Desain & Sampel',
        who: 'Admin Desain, Desainer, Tim Sampel',
        body: 'Buat mockup dan tabel ukuran, lalu kirim ke pelanggan. Untuk pesanan yang mewajibkan sampel fisik, buat sampel, lakukan fitting, dan klik Setujui Sampel saat pelanggan ACC.',
        note: 'Gerbang Anti-Skip: SPK terkunci sampai desain pesanan disetujui. Sampel fisik ikut menahan hanya bila penawaran memintanya; repeat order melewatinya.'
      },
      {
        title: 'Pola & Grading Ukuran',
        sop: 'SOP 06',
        module: 'PatternGrading',
        moduleLabel: 'Size Chart',
        who: 'Pembuat Pola, QC Teknis, Kepala Produksi',
        body: 'Buat pola dasar di satu ukuran, grading ke semua ukuran (S, M, L, XL, XXL), lalu hubungkan ke pesanan. Klik Tandai Final setelah pola diverifikasi.',
        note: 'Hanya pola berstatus Final yang diizinkan untuk proses pemotongan kain.'
      },
      {
        title: 'Pengadaan Bahan',
        sop: 'SOP 04–05',
        module: 'Procurement',
        moduleLabel: 'Pengadaan Bahan',
        who: 'PPIC, Purchasing, Admin Gudang, QC Bahan',
        body: 'Cek stok di Gudang Aksesoris & Kain. Jika kurang, catat pembelian bahan di Pengadaan Bahan dan pilih pesanannya. Tiap catatan adalah pembelian yang sudah terjadi, lengkap dengan pemasok dan biayanya.',
        note: 'Bahan di bawah stok minimum otomatis ditandai peringatan Stok Menipis.'
      },
      {
        title: 'Penerbitan SPK Produksi (2 Halaman)',
        sop: 'SOP 03',
        module: 'PPIC',
        moduleLabel: 'Surat Perintah Kerja',
        who: 'PPIC, Kepala Produksi',
        body: 'Pesanan muncul di Pesanan Menunggu SPK beserta checklist syaratnya. Yang menahan hanya DP dan desain/sampel yang disetujui; bahan dan pola tampil sebagai informasi. Setelah keduanya lulus, PPIC menerbitkan SPK 2 halaman sesuai acuan resmi.',
        note: 'Dokumen SPK memuat PO, jadwal, target qty, instruksi teknis, dan PJ Cutting, Finishing, serta Kepala Produksi.'
      }
    ]
  },
  {
    title: 'Produksi Massal',
    steps: [
      {
        title: 'Pemotongan (Cutting)',
        sop: 'SOP 07',
        module: 'Cutting',
        moduleLabel: 'Pemotongan',
        who: 'Kepala Cutting, Operator Potong, QC Cutting',
        body: 'Gelar kain sesuai lot, susun marker dari pola final, lalu potong presisi. Catat jumlah lapisan kain, konsumsi bahan per pcs, dan sisa perca.'
      },
      {
        title: 'Bundel & Serah Terima (Barcode / QR)',
        sop: 'SOP 08',
        module: 'BundleTracking',
        moduleLabel: 'Lacak Bundel',
        who: 'WIP Controller, Leader Line',
        body: 'Ikat potongan per ukuran menjadi bundel dan cetak QR barcode. Scan setiap bundel berpindah stasiun: Cutting, Sewing, Obras, Finishing, QC, Packaging.',
        note: 'Progres SPK dan kalkulasi WIP otomatis terbarui real-time dari hasil pemindaian.'
      },
      {
        title: 'Penjahitan, Obras & Finishing',
        sop: 'SOP 09–10',
        module: 'Sewing',
        moduleLabel: 'Penjahitan',
        who: 'Leader Line, Operator Jahit, QC Jahit',
        body: 'Jahit sesuai instruksi SPK, obras rapi, dan bersihkan sisa benang. Catat output dan periksa kerapatan stik jahitan (SPI) serta uji ketahanan tarik.'
      }
    ]
  },
  {
    title: 'Kualitas, Pengemasan & Pengiriman',
    steps: [
      {
        title: 'Pemeriksaan QC Akhir (AQL 2.5 / 100%)',
        sop: 'SOP 12',
        module: 'QC',
        moduleLabel: 'Pemeriksaan QC',
        who: 'QC Akhir, Kepala QC',
        body: 'Inspeksi produk jadi menggunakan sampling standar AQL 2.5 atau pemeriksaan 100% Final. Catat temuan cacat minor, mayor, kritis hingga lot berstatus Accept.',
        note: 'Status Accept adalah syarat mutlak pembukaan gerbang pengiriman.'
      },
      {
        title: 'Setrika Uap & Pengemasan',
        sop: 'SOP 13',
        module: 'Packaging',
        moduleLabel: 'Pengemasan',
        who: 'Operator Setrika, Operator Packing',
        body: 'Produk yang lulus QC disetrika uap, dilipat rapi, dimasukkan polybag, dikelompokkan ke dalam box koli, dan ditempelkan label packing slip siap kirim.'
      },
      {
        title: 'Pengiriman & Surat Jalan (Gerbang Anti-Skip 2)',
        sop: 'SOP 16',
        module: 'Shipping',
        moduleLabel: 'Pengiriman',
        who: 'Admin Gudang, Admin Ekspedisi',
        body: 'Buat Surat Jalan resmi dengan rincian koli, berat total, kurir, dan nomor resi. Cetak dokumen Surat Jalan resmi dengan tanda tangan dan stempel basah HIJ.',
        note: 'Gerbang Anti-Skip: Surat Jalan terkunci dan tidak dapat diterbitkan jika pesanan belum memiliki hasil QC berstatus Accept.'
      }
    ]
  },
  {
    title: 'Pelunasan & Garansi Purnajual',
    steps: [
      {
        title: 'Faktur Pelunasan (End Payment)',
        sop: 'SOP 20',
        module: 'Finance',
        moduleLabel: 'Keuangan',
        who: 'Admin Keuangan',
        body: 'Terbitkan Invoice resmi dengan rincian Termin 1 (DP 50%) dan Termin 2 (Pelunasan). Dilengkapi terbilang Rupiah dan rekening resmi PT Mandiri / BCA.',
        note: 'Pengiriman barang memicu draf faktur pelunasan otomatis, dengan DP yang sudah dibayar langsung terpotong. Pesanan berstatus Selesai setelah barang diterima dan faktur lunas.'
      },
      {
        title: 'Retur & Garansi Kepuasan (RMA)',
        sop: 'SOP 15',
        module: 'Returns',
        moduleLabel: 'Retur & Garansi',
        who: 'Customer Service, Kepala QC',
        body: 'Tampung keluhan pelanggan dan bukti foto. Lakukan 5-Whys root cause analysis, lalu berikan solusi: perbaikan gratis, ganti baru, atau diskon khusus.'
      }
    ]
  }
];

const SUPPORT: FlowStep[] = [
  {
    title: 'Penggajian Borongan & Insentif',
    sop: 'SOP 19',
    module: 'HRPayroll',
    moduleLabel: 'Penggajian',
    who: 'Admin HR, Kepala Produksi',
    body: 'Upah dihitung otomatis dari jumlah pcs yang lolos QC dikalikan tarif per potong. Termasuk bonus target 10% dan insentif kehadiran operator.'
  }
];

const REQUIREMENT_ITEMS = [
  { icon: Banknote, label: REQUIREMENT_LABELS.dp, hint: 'DP 50% terverifikasi di Keuangan atau termin khusus Owner' },
  { icon: Ruler, label: REQUIREMENT_LABELS.sizeChart, hint: 'Pesanan memilih template dari halaman Size Chart (standar HIJ / khusus pelanggan) — detailnya dicetak di SPK' },
  { icon: FileCheck, label: REQUIREMENT_LABELS.sample, hint: 'Desain/sampel disetujui — status pola final ikut tampil di baris ini, tapi tidak menahan' },
  { icon: Layers, label: REQUIREMENT_LABELS.material, hint: 'Pembelian bahan tercatat untuk pesanan, atau stok dikonfirmasi PPIC — informasi, tidak menahan' }
];

/*
 * The two ways a customer buys. Written to match what the app enforces: the
 * repeat path skips the quotation, the DP gate and the sample, never the
 * approved design.
 */
const PURCHASE_PATTERNS = [
  {
    title: 'Pola 1 — Pesanan baru lewat Surat Penawaran',
    when: 'Model, bahan, atau desain baru.',
    steps: [
      'Surat Penawaran dibuat dan dikirim ke pelanggan.',
      'Deal: pesanan terbentuk otomatis, DP wajib = termin pertama.',
      'Pelanggan kirim bukti transfer lewat WhatsApp; PIC pesanan mencatat DP di Keuangan dan memverifikasinya.',
      'Desain disetujui; sampel fisik bila diminta penawaran.',
      'SPK terbit, produksi, QC.',
      'Surat jalan: draf faktur pelunasan otomatis, DP sudah terpotong.',
      'Pelunasan diterima + barang sampai → pesanan Selesai.'
    ]
  },
  {
    title: 'Pola 2 — Repeat Order',
    when: 'Pelanggan lama memesan ulang produk yang sama.',
    steps: [
      'Tambah Pesanan (Repeat Order) dari pesanan lamanya; ukuran & harga disalin.',
      'Draf faktur dibuat otomatis — Keuangan memeriksa lalu mengirimnya.',
      'SPK jalur cepat: DP dan sampel tidak menahan, desain tetap harus disetujui.',
      'Produksi, QC, surat jalan.',
      'DP/pelunasan dicatat di Keuangan → pesanan Selesai saat lunas dan barang sampai.'
    ]
  }
];

// Step numbers run on across phases; each phase's <ol> starts where the previous one ended.
const PHASE_STARTS = PHASES.reduce<number[]>((starts, _phase, i) => {
  starts.push(i === 0 ? 1 : starts[i - 1] + PHASES[i - 1].steps.length);
  return starts;
}, []);

const sectionHeadingClass = 'text-lg font-bold text-slate-900 text-balance';

export const HowItWorksModule: React.FC<HowItWorksProps> = ({ onNavigate, canOpen }) => {
  const renderStep = (step: FlowStep, stepNumber?: number) => {
    const allowed = step.module ? canOpen(step.module) : false;

    return (
      <li key={step.title} className="relative flex gap-4">
        {stepNumber !== undefined && (
          <div className="flex flex-col items-center" aria-hidden="true">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-teal-dark text-sm font-extrabold text-white shadow-xs tabular-nums">
              {stepNumber}
            </span>
            <span className="mt-2 w-px flex-1 bg-slate-200" />
          </div>
        )}

        <div className="min-w-0 flex-1 pb-6">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h3 className="text-base font-bold text-slate-900">
              {stepNumber !== undefined && <span className="sr-only">Langkah {stepNumber}: </span>}
              {step.title}
            </h3>
            <span className="text-xs text-slate-500">{step.sop}</span>
          </div>

          <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-slate-700">{step.body}</p>
          {step.note && <p className="mt-1.5 max-w-prose text-sm text-slate-500">{step.note}</p>}

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="text-slate-500">
              Oleh: <span className="text-slate-700">{step.who}</span>
            </span>
            {step.module && step.moduleLabel && (
              allowed ? (
                <Button
                  variant="link"
                  onClick={() => onNavigate(step.module!)}
                  className="h-10 px-0"
                >
                  Buka {step.moduleLabel}
                  <ArrowRight size={14} aria-hidden="true" />
                </Button>
              ) : (
                <span className="inline-flex min-h-10 items-center text-slate-500">
                  Halaman {step.moduleLabel} (tidak ada akses)
                </span>
              )
            )}
          </div>
        </div>
      </li>
    );
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Panduan Alur"
        description="Urutan kerja dari penawaran sampai pelunasan, sesuai SOP 01–20."
      />

      {/* 6-STAGE ANTI-SKIP INTEGRITY HERO CARD */}
      <Card className="border-teal-300 bg-gradient-to-br from-teal-900 via-slate-900 to-slate-950 p-6 text-white shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-teal-500/30 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-teal-500/20 text-teal-300 border border-teal-400/30 shadow-inner">
              <ShieldCheck size={26} aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white tracking-wide">Sistem Integritas 6 Tahap (Anti-Skip Architecture)</h2>
              <p className="text-xs text-teal-200/80">Jaminan mutu operasional garmen standar industri PT Hasil Inti Jualan</p>
            </div>
          </div>
          <span className="rounded-full bg-teal-400/10 px-3 py-1 text-xs font-mono font-semibold text-teal-300 border border-teal-400/20">
            SOP 01 - SOP 20
          </span>
        </div>

        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          <div className="rounded-xl border border-teal-500/20 bg-slate-800/60 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-teal-500 text-xs font-bold text-slate-950">1</span>
              <span className="text-[11px] font-mono text-teal-300">Spesifikasi</span>
            </div>
            <p className="text-sm font-bold text-white">4 Serangkai Baku</p>
            <p className="text-xs text-slate-300 leading-relaxed">
              Desain mockup, bahan baku kain, warna/kuantitas, dan sablon/bordir wajib terdefinisi lengkap sebelum kalkulasi.
            </p>
          </div>

          <div className="rounded-xl border border-teal-500/20 bg-slate-800/60 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-teal-500 text-xs font-bold text-slate-950">2</span>
              <span className="text-[11px] font-mono text-teal-300">Penawaran</span>
            </div>
            <p className="text-sm font-bold text-white">Quotation &amp; Pilihan Sampel</p>
            <p className="text-xs text-slate-300 leading-relaxed">
              Penetapan MOQ 100 pcs, termin pembayaran (DP = termin pertama), serta pemilihan eksplisit: <em>Perlu Sampel Fisik</em> atau <em>Tanpa Sampel Fisik</em>.
            </p>
          </div>

          <div className="rounded-xl border border-amber-500/40 bg-slate-800/80 p-4 space-y-2 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-16 h-16 bg-amber-500/10 rounded-full blur-xl pointer-events-none" />
            <div className="flex items-center justify-between">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-400 text-xs font-bold text-slate-950">3</span>
              <span className="text-[11px] font-bold text-amber-300 flex items-center gap-1">
                <Lock size={12} aria-hidden="true" /> Gerbang 1
              </span>
            </div>
            <p className="text-sm font-bold text-amber-100">Sample Approval Gate</p>
            <p className="text-xs text-slate-300 leading-relaxed">
              SPK <strong>terkunci</strong> sampai desain pesanan <em>disetujui</em>. Sampel fisik ikut menahan hanya bila penawaran memintanya.
            </p>
          </div>

          <div className="rounded-xl border border-teal-500/20 bg-slate-800/60 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-teal-500 text-xs font-bold text-slate-950">4</span>
              <span className="text-[11px] font-mono text-teal-300">Produksi</span>
            </div>
            <p className="text-sm font-bold text-white">Penerbitan SPK 2 Hal</p>
            <p className="text-xs text-slate-300 leading-relaxed">
              PPIC menerbitkan SPK resmi (Hal 1: PO &amp; Jadwal, Hal 2: Target Qty, Instruksi &amp; PIC) setelah DP masuk dan desain disetujui.
            </p>
          </div>

          <div className="rounded-xl border border-teal-500/20 bg-slate-800/60 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-teal-500 text-xs font-bold text-slate-950">5</span>
              <span className="text-[11px] font-mono text-teal-300">Inspeksi</span>
            </div>
            <p className="text-sm font-bold text-white">Quality Control (QC)</p>
            <p className="text-xs text-slate-300 leading-relaxed">
              Pemeriksaan sampling AQL 2.5 atau 100% Final. Mengklasifikasikan cacat minor/mayor/kritis hingga status <em>Accept</em>.
            </p>
          </div>

          <div className="rounded-xl border border-amber-500/40 bg-slate-800/80 p-4 space-y-2 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-16 h-16 bg-amber-500/10 rounded-full blur-xl pointer-events-none" />
            <div className="flex items-center justify-between">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-400 text-xs font-bold text-slate-950">6</span>
              <span className="text-[11px] font-bold text-amber-300 flex items-center gap-1">
                <Lock size={12} aria-hidden="true" /> Gerbang 2
              </span>
            </div>
            <p className="text-sm font-bold text-amber-100">QC Shipping Gate</p>
            <p className="text-xs text-slate-300 leading-relaxed">
              Surat Jalan &amp; Pelunasan <strong>terkunci</strong>: paket garmen hanya bisa dikirim bila hasil QC berstatus <em>Accept</em>.
            </p>
          </div>
        </div>
      </Card>

      <Card className="p-5 sm:p-6">
        <h2 className={sectionHeadingClass}>Dua Pola Pembelian</h2>
        <p className="mt-1 max-w-prose text-sm text-slate-500">
          Keduanya bertemu di tabel pesanan yang sama, jadi setelah pesanan terbentuk langkahnya sama sampai Keuangan.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          {PURCHASE_PATTERNS.map(pattern => (
            <div key={pattern.title} className="rounded-xl border border-slate-200 p-4">
              <p className="text-sm font-bold text-slate-900">{pattern.title}</p>
              <p className="mt-0.5 text-xs text-slate-500">{pattern.when}</p>
              <ol role="list" className="mt-3 space-y-1.5">
                {pattern.steps.map((step, i) => (
                  <li key={step} className="flex gap-2 text-sm text-slate-700">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-teal-50 text-[11px] font-bold text-brand-teal-dark tabular-nums" aria-hidden="true">
                      {i + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
        <p className="mt-4 max-w-prose text-sm text-slate-600">
          Status pesanan maju sendiri: <b>Diproduksi</b> saat SPK terbit, <b>Tahap QC</b> saat QC Accept,
          <b> Dikirim</b> saat surat jalan diserahkan ke kurir, dan <b>Selesai</b> saat barang diterima dan
          faktur lunas.
        </p>
      </Card>

      <Card className="border-teal-200 bg-teal-50/60 p-5">
        <h2 className="text-lg font-bold text-teal-950 text-balance">Syarat Sebelum SPK Diterbitkan</h2>
        <p className="mt-1 max-w-prose text-sm text-teal-900/80">
          Produksi massal tidak dimulai sebelum DP dan desain/sampel terpenuhi. Bahan baku ditampilkan sebagai informasi.
        </p>
        <ul role="list" className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {REQUIREMENT_ITEMS.map(item => {
            const Icon = item.icon;
            return (
              <li key={item.label} className="flex items-start gap-3 rounded-lg border border-teal-100 bg-white p-3">
                <Icon size={20} className="mt-0.5 shrink-0 text-teal-600" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                    <CheckCircle2 size={14} className="shrink-0 text-emerald-600" aria-hidden="true" />
                    {item.label}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">{item.hint}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      {PHASES.map((phase, i) => (
        <Card key={phase.title} className="p-5 sm:p-6">
          <h2 className={`mb-5 ${sectionHeadingClass}`}>{phase.title}</h2>
          <ol role="list" start={PHASE_STARTS[i]}>
            {phase.steps.map((step, j) => renderStep(step, PHASE_STARTS[i] + j))}
          </ol>
        </Card>
      ))}

      <Card className="p-5 sm:p-6">
        <h2 className={sectionHeadingClass}>Berjalan Setiap Hari</h2>
        <p className="mb-5 mt-1 max-w-prose text-sm text-slate-500">Mendukung semua tahap di atas.</p>
        <ul role="list" className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          {SUPPORT.map(step => renderStep(step))}
        </ul>
      </Card>

      <Card className="p-5 sm:p-6">
        <h2 className={sectionHeadingClass}>Untuk Pelanggan</h2>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-slate-700">
          Pelanggan membuka Lacak Pesanan di halaman login dengan ID pelanggan, nomor HP, atau nomor pesanan.
          Mereka bisa melihat langkah berikutnya (bayar DP atau setujui sampel), progres produksi, tagihan, dan pengiriman.
        </p>
      </Card>
    </div>
  );
};
