import React from 'react';
import { 
  FileSpreadsheet, 
  FileText, 
  Palette, 
  Factory, 
  CheckCircle2, 
  Truck, 
  Lock, 
  Check, 
  Clock, 
  AlertCircle,
  SkipForward
} from 'lucide-react';
import { cn } from '../../lib/utils';

export interface OrderFlowStepperProps {
  currentStep?: 1 | 2 | 3 | 4 | 5 | 6;
  hasQuotation?: boolean;
  isQuotationConverted?: boolean;
  needsSample?: boolean;
  sampleStatus?: string;
  isSampleApproved?: boolean;
  hasSpk?: boolean;
  isProductionFinished?: boolean;
  isQcPassed?: boolean;
  isShipped?: boolean;
  compact?: boolean;
  className?: string;
}

export const OrderFlowStepper: React.FC<OrderFlowStepperProps> = ({
  currentStep,
  hasQuotation = true,
  isQuotationConverted = true,
  needsSample = true,
  sampleStatus,
  isSampleApproved: explicitSampleApproved,
  hasSpk = false,
  isProductionFinished = false,
  isQcPassed = false,
  isShipped = false,
  compact = false,
  className = ''
}) => {
  const isSampleApproved = explicitSampleApproved ?? (sampleStatus === 'Approved');

  // Stage 1: Spesifikasi (Desain, Bahan, Warna, Qty, Sablon/Bordir)
  const stage1 = {
    title: '1. Spesifikasi',
    desc: 'Desain, Bahan, Warna, Qty',
    icon: FileSpreadsheet,
    status: 'completed' as const
  };

  // Stage 2: Penawaran (Quotation Deal)
  let stage2Status: 'completed' | 'current' = 'completed';
  if (currentStep === 1) {
    stage2Status = 'current';
  } else if (currentStep !== undefined) {
    stage2Status = currentStep > 2 ? 'completed' : 'current';
  } else {
    stage2Status = isQuotationConverted ? 'completed' : 'current';
  }

  const stage2 = {
    title: '2. Penawaran',
    desc: stage2Status === 'completed' ? 'Deal / Terbit Pesanan' : 'Estimasi Harga & Terms',
    icon: FileText,
    status: stage2Status
  };

  // Stage 3: Sampel Fisik (Opsional)
  let stage3Status: 'completed' | 'current' | 'locked' | 'waived' = 'locked';
  let stage3Desc = 'Persetujuan Sampel Fisik';

  if (!needsSample) {
    stage3Status = 'waived';
    stage3Desc = 'Dilewati (Tanpa Sampel)';
  } else if (isSampleApproved) {
    stage3Status = 'completed';
    stage3Desc = 'Sampel Disetujui (Approved)';
  } else if (currentStep === 3) {
    stage3Status = 'current';
    stage3Desc = 'Uji & Tunggu Approval Sampel';
  } else if (currentStep !== undefined && currentStep > 3) {
    stage3Status = 'completed';
    stage3Desc = 'Sampel ACC (Lulus)';
  } else if (stage2Status === 'completed') {
    stage3Status = 'current';
    stage3Desc = 'Menunggu Approval Sampel';
  } else {
    stage3Status = 'locked';
    stage3Desc = 'Terkunci (Belum Penawaran)';
  }

  const stage3 = {
    title: '3. Sampel (Opsional)',
    desc: stage3Desc,
    icon: Palette,
    status: stage3Status
  };

  // Stage 4: Produksi (SPK, Potong, Jahit)
  let stage4Status: 'completed' | 'current' | 'locked' = 'locked';
  let stage4Desc = 'Penerbitan SPK & Produksi';
  const sampleRequirementMet = !needsSample || isSampleApproved || (currentStep !== undefined && currentStep >= 4);

  if (currentStep === 4) {
    stage4Status = 'current';
    stage4Desc = 'SPK Aktif di Lini Produksi';
  } else if (currentStep !== undefined && currentStep > 4) {
    stage4Status = 'completed';
    stage4Desc = 'Produksi Selesai (100%)';
  } else if (isProductionFinished) {
    stage4Status = 'completed';
    stage4Desc = 'Selesai Jahit (100%)';
  } else if (hasSpk) {
    stage4Status = 'current';
    stage4Desc = 'SPK Aktif di Lini Produksi';
  } else if (stage2Status === 'completed' && sampleRequirementMet) {
    stage4Status = 'current';
    stage4Desc = 'Siap Terbitkan SPK';
  } else {
    stage4Status = 'locked';
    stage4Desc = needsSample && !isSampleApproved 
      ? 'Terkunci (Wajib Sampel Lulus)' 
      : 'Terkunci (Belum Siap)';
  }

  const stage4 = {
    title: '4. Produksi',
    desc: stage4Desc,
    icon: Factory,
    status: stage4Status
  };

  // Stage 5: QC (Kontrol Kualitas)
  let stage5Status: 'completed' | 'current' | 'locked' = 'locked';
  let stage5Desc = 'Pemeriksaan Kualitas';

  // Status "QC" means the inspection is passed, so the step reads done, not busy.
  if (currentStep === 5 && !isQcPassed) {
    stage5Status = 'current';
    stage5Desc = 'Inspeksi Kualitas (In-Line/Final)';
  } else if (currentStep !== undefined && currentStep > 5) {
    stage5Status = 'completed';
    stage5Desc = 'Lulus QC (Accept)';
  } else if (isQcPassed) {
    stage5Status = 'completed';
    stage5Desc = 'Lulus QC (Accept)';
  } else if (stage4Status === 'completed' || isProductionFinished) {
    stage5Status = 'current';
    stage5Desc = 'Menunggu Inspeksi QC';
  } else {
    stage5Status = 'locked';
    stage5Desc = 'Terkunci (Belum Selesai Produksi)';
  }

  const stage5 = {
    title: '5. QC',
    desc: stage5Desc,
    icon: CheckCircle2,
    status: stage5Status
  };

  // Stage 6: Pengiriman (Logistik & Surat Jalan)
  let stage6Status: 'completed' | 'current' | 'locked' = 'locked';
  let stage6Desc = 'Surat Jalan & Ekspedisi';

  if (currentStep === 6) {
    stage6Status = 'current';
    stage6Desc = isShipped ? 'Dalam Pengiriman' : 'Proses Terbit Surat Jalan';
  } else if (isShipped) {
    stage6Status = 'completed';
    stage6Desc = 'Dikirim / Selesai';
  } else if (stage5Status === 'completed' || isQcPassed) {
    stage6Status = 'current';
    stage6Desc = 'Siap Kirim (Lulus QC)';
  } else {
    stage6Status = 'locked';
    stage6Desc = 'Terkunci (Wajib QC Lulus)';
  }

  const stage6 = {
    title: '6. Pengiriman',
    desc: stage6Desc,
    icon: Truck,
    status: stage6Status
  };

  const steps = [stage1, stage2, stage3, stage4, stage5, stage6];

  if (compact) {
    return (
      <div className={cn("flex items-center gap-1 overflow-x-auto py-1", className)}>
        {steps.map((step, idx) => {
          const Icon = step.icon;
          return (
            <React.Fragment key={idx}>
              <div 
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all shrink-0",
                  step.status === 'completed' && "bg-emerald-50 text-emerald-700 border border-emerald-200",
                  step.status === 'current' && "bg-teal-50 text-teal-800 border border-teal-300 ring-2 ring-teal-500/20",
                  step.status === 'waived' && "bg-slate-100 text-slate-500 border border-dashed border-slate-300",
                  step.status === 'locked' && "bg-gray-100 text-gray-400 opacity-70"
                )}
                title={`${step.title}: ${step.desc}`}
              >
                {step.status === 'completed' ? (
                  <Check size={12} className="text-emerald-600 stroke-[3]" />
                ) : step.status === 'waived' ? (
                  <SkipForward size={12} className="text-slate-400" />
                ) : step.status === 'locked' ? (
                  <Lock size={11} className="text-gray-400" />
                ) : (
                  <Icon size={12} className="text-teal-600" />
                )}
                <span>{step.title.split('.')[1]?.trim() || step.title}</span>
              </div>
              {idx < steps.length - 1 && (
                <div className={cn(
                  "w-3 h-0.5 shrink-0",
                  steps[idx].status === 'completed' ? "bg-emerald-300" : "bg-gray-200"
                )} />
              )}
            </React.Fragment>
          );
        })}
      </div>
    );
  }

  return (
    <div className={cn("bg-white rounded-2xl border border-gray-100 p-4 sm:p-5 shadow-xs", className)}>
      <h4 className="mb-4 text-sm font-bold text-foreground">Alur pesanan</h4>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        {steps.map((step, idx) => {
          const Icon = step.icon;
          return (
            <div 
              key={idx}
              className={cn(
                "relative p-3 rounded-xl border flex flex-col justify-between transition-all",
                step.status === 'completed' && "bg-emerald-50/70 border-emerald-200 text-emerald-950",
                step.status === 'current' && "bg-teal-50/80 border-teal-300 ring-2 ring-teal-500/20 text-teal-950 shadow-xs",
                step.status === 'waived' && "bg-slate-50 border-dashed border-slate-300 text-slate-600",
                step.status === 'locked' && "bg-gray-50/70 border-gray-200 text-gray-400 opacity-80"
              )}
            >
              <div className="flex items-center justify-between mb-2">
                <div className={cn(
                  "w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs",
                  step.status === 'completed' && "bg-emerald-600 text-white shadow-xs",
                  step.status === 'current' && "bg-teal-700 text-white shadow-xs",
                  step.status === 'waived' && "bg-slate-200 text-slate-600",
                  step.status === 'locked' && "bg-gray-200 text-gray-400"
                )}>
                  {step.status === 'completed' ? (
                    <Check size={14} className="stroke-[3]" />
                  ) : step.status === 'waived' ? (
                    <SkipForward size={14} />
                  ) : step.status === 'locked' ? (
                    <Lock size={13} />
                  ) : (
                    <Icon size={14} />
                  )}
                </div>

                <span className={cn(
                  "text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded",
                  step.status === 'completed' && "bg-emerald-100 text-emerald-800",
                  step.status === 'current' && "bg-teal-100 text-teal-900 font-bold",
                  step.status === 'waived' && "bg-slate-200 text-slate-700",
                  step.status === 'locked' && "bg-gray-200 text-gray-500"
                )}>
                  {step.status === 'completed' ? 'Selesai' :
                   step.status === 'current' ? 'Proses' :
                   step.status === 'waived' ? 'Dilewati' : 'Terkunci'}
                </span>
              </div>

              <div>
                <p className={cn(
                  "text-xs font-bold leading-tight",
                  step.status === 'locked' ? "text-gray-500" : "text-gray-900"
                )}>
                  {step.title}
                </p>
                <p className="text-[10px] leading-tight text-gray-500 mt-1 line-clamp-2">
                  {step.desc}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
