import React, { useState, useEffect, useRef } from 'react';
import {
  Palette, Plus, Download, CheckCircle2, FlaskConical,
  Link2, RefreshCw, Check, Ruler, UploadCloud, FolderOpen, Trash2, Loader2, Pencil,
  ChevronDown, ChevronUp, Maximize2
} from 'lucide-react';
import { Design, Sample, Order, Customer } from '../../types';
import { fetchResource, createResource, updateResource, uploadMedia } from '../../services/api';
import { formatDate, formatDateTime, generateId, statusLabel } from '../../lib/utils';
import { StatusBadge } from '../ui/Badge';
import { Modal } from '../ui/Modal';
import { Toast, useToast } from '../ui/Toast';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import {
  FieldLabel,
  FieldHint,
  FieldError,
  FormError,
  FormSection,
  Select,
  Textarea,
  ChipButton
} from '../ui/Field';
import { PageHeader } from '../ui/PageHeader';
import { Tabs, TabsList, TabsTrigger } from '../ui/Tabs';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  TableRowActions,
  TableEmptyRow,
  TableSkeletonRows,
  TableSortHead,
  sortRows,
  type SortState
} from '../ui/Table';
import {
  DetailDrawer,
  DetailSection,
  DetailBlock,
  DetailField,
  RowDetailButton
} from '../ui/DetailDrawer';

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal focus-visible:ring-offset-2';

// Sample status flow (SOP-02). Values stay in English; labels come from statusLabel.
const SAMPLE_STATUSES: Sample['status'][] = [
  'Development',
  'In Progress',
  'Sent to Customer',
  'Approved',
  'Revision',
  'Rejected'
];

const orderLabel = (o: Order) => `${o.po || o.id} (${o.customerName})`;

type SubTab = 'designs' | 'samples';
const SUB_TABS: SubTab[] = ['designs', 'samples'];

const DESIGN_CATEGORIES = [
  'Kaos / Polo',
  'Kemeja PDL',
  'Jaket / Outer',
  'Hoodie / Sweater',
  'Rompi',
  'Sportswear'
];

const SAMPLE_SIZE_CHIPS = ['S', 'M', 'L', 'XL', 'XXL', 'All Size'];

const defaultQcNote = (size?: string) =>
  size
    ? `Sampel fitting ukuran ${size} disesuaikan dengan standar size chart HIJ.`
    : 'Sampel dijahit sesuai pola fitting dan gramasi bahan.';

/*
 * Picking a size used to overwrite whatever the user had typed into the QC note.
 * It may only be regenerated while it is still one this form wrote itself.
 */
const isGeneratedQcNote = (note?: string) => {
  if (!note || !note.trim()) return true;
  if (note === defaultQcNote()) return true;
  return SAMPLE_SIZE_CHIPS.some(size => note === defaultQcNote(size));
};

const SAMPLE_PRODUCT_PRESETS = [
  'Sample Kaos Cotton Combed 24s',
  'Sample Kemeja PDL Ripstop Lapangan',
  'Sample Jaket Taslan Waterproof',
  'Sample Polo CVC Pique Bordir',
  'Sample Rompi Drill 4 Saku'
];

const SAMPLING_VENDORS = [
  'Sampling Room HIJ (Internal)',
  'Penjahit Sampel External (Subkon)',
  'Workshop Partner'
];

const ACCEPTED_IMAGE_TYPES = 'image/png,image/jpeg,image/jpg,image/webp';
const MAX_UPLOAD_MB = 25;

interface MockupSlotProps {
  /** "Tampak Depan" / "Tampak Belakang" */
  label: string;
  value?: string;
  uploading: boolean;
  dragOver: boolean;
  onDragOverChange: (over: boolean) => void;
  onFile: (file: File) => void;
  onPick: () => void;
  onClear: () => void;
  onPreview: () => void;
}

/** One mockup image: drop target when empty, preview with actions once filled. */
const MockupSlot: React.FC<MockupSlotProps> = ({
  label,
  value,
  uploading,
  dragOver,
  onDragOverChange,
  onFile,
  onPick,
  onClear,
  onPreview
}) => {
  const lower = label.toLowerCase();

  if (uploading) {
    return (
      <div className="space-y-2">
        <span className="block text-xs font-bold text-slate-700">{label}</span>
        <div
          role="status"
          className="flex aspect-[3/4] flex-col items-center justify-center rounded-xl border-2 border-dashed border-brand-teal bg-teal-50/60 p-3 text-center"
        >
          <Loader2 className="mb-2 size-7 animate-spin text-brand-teal-dark motion-reduce:animate-none" aria-hidden="true" />
          <span className="text-xs font-semibold text-teal-950">Mengunggah {lower}…</span>
        </div>
      </div>
    );
  }

  if (value) {
    return (
      <div className="space-y-2">
        <span className="flex items-center justify-between text-xs font-bold text-slate-700">
          <span>{label}</span>
          <span className="inline-flex items-center gap-1 font-semibold text-brand-teal-dark">
            <Check size={13} aria-hidden="true" /> Siap
          </span>
        </span>
        <div className="relative flex aspect-[3/4] items-center justify-center overflow-hidden rounded-xl border border-border bg-white">
          <img
            src={value}
            alt={`Mockup ${lower}`}
            loading="lazy"
            className="h-full w-full object-contain p-1.5"
            onError={(e) => {
              (e.target as HTMLImageElement).src = '/logo.png';
            }}
          />
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onPreview}
            aria-label={`Perbesar mockup ${lower}`}
            className="h-8 flex-1 px-2 text-xs"
          >
            <Maximize2 size={13} aria-hidden="true" /> Perbesar
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onPick}
            aria-label={`Ganti file mockup ${lower}`}
            className="h-8 flex-1 px-2 text-xs"
          >
            <FolderOpen size={13} aria-hidden="true" /> Ganti
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClear}
            aria-label={`Hapus mockup ${lower}`}
            title="Hapus gambar"
            className="h-8 w-9 px-0 text-brand-red hover:border-brand-red/40 hover:bg-rose-50 hover:text-brand-red"
          >
            <Trash2 size={14} aria-hidden="true" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <span className="block text-xs font-bold text-slate-700">{label}</span>
      <button
        type="button"
        onClick={onPick}
        onDragOver={(e) => {
          e.preventDefault();
          onDragOverChange(true);
        }}
        onDragLeave={() => onDragOverChange(false)}
        onDrop={(e) => {
          e.preventDefault();
          onDragOverChange(false);
          const file = e.dataTransfer.files?.[0];
          if (file) onFile(file);
        }}
        className={`flex aspect-[3/4] w-full cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-3 text-center transition-colors ${focusRing} ${
          dragOver
            ? 'border-brand-teal-dark bg-teal-50/80'
            : 'border-slate-300 bg-white hover:border-brand-teal hover:bg-teal-50/30'
        }`}
      >
        <span className="mb-2 flex size-10 items-center justify-center rounded-full bg-teal-50 text-brand-teal-dark">
          <UploadCloud size={20} aria-hidden="true" />
        </span>
        <span className="text-xs font-bold leading-tight text-slate-800">Unggah {lower}</span>
        <span className="mt-1 text-[11px] leading-tight text-slate-500">
          Tarik file ke sini atau klik untuk memilih
        </span>
        <span className="mt-1.5 text-[11px] text-slate-400">PNG, JPG, WebP, maks {MAX_UPLOAD_MB}MB</span>
      </button>
    </div>
  );
};

export const DesignSampleModule: React.FC = () => {
  const [designs, setDesigns] = useState<Design[]>([]);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('designs');
  const { toast, showToast } = useToast();

  // Sorting per table
  const [designSort, setDesignSort] = useState<SortState>({ key: 'timestamp', direction: 'desc' });
  const [sampleSort, setSampleSort] = useState<SortState>({ key: 'timestamp', direction: 'desc' });

  // Row inspector. Kept by id so the drawer follows the record after a reload.
  const [detailDesignId, setDetailDesignId] = useState<string | null>(null);
  const [detailSampleId, setDetailSampleId] = useState<string | null>(null);

  // Preview Catalog / Mockup Modal State
  const [previewImage, setPreviewImage] = useState<{ title: string; path: string; desc?: string } | null>(null);

  // Modal State
  const [isDesignModalOpen, setIsDesignModalOpen] = useState(false);
  const [editingDesignId, setEditingDesignId] = useState<string | null>(null);
  const [isSampleModalOpen, setIsSampleModalOpen] = useState(false);

  // Design Image Upload & Drag-Drop States
  const [frontUploading, setFrontUploading] = useState(false);
  const [backUploading, setBackUploading] = useState(false);
  const [dragOverFront, setDragOverFront] = useState(false);
  const [dragOverBack, setDragOverBack] = useState(false);
  const [showManualUrl, setShowManualUrl] = useState(false);

  // Form submit state and messages
  const [savingDesign, setSavingDesign] = useState(false);
  const [designError, setDesignError] = useState<string | null>(null);
  const [designFieldErrors, setDesignFieldErrors] = useState<Record<string, string>>({});
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [savingSample, setSavingSample] = useState(false);
  const [sampleError, setSampleError] = useState<string | null>(null);
  const [sampleFieldErrors, setSampleFieldErrors] = useState<Record<string, string>>({});
  const frontFileInputRef = useRef<HTMLInputElement>(null);
  const backFileInputRef = useRef<HTMLInputElement>(null);

  const [newDesign, setNewDesign] = useState<Partial<Design>>({
    name: '',
    orderId: '',
    customerId: '',
    category: 'Kaos / Polo',
    status: 'Pending Review',
    description: '',
    mockupFront: '',
    mockupBack: ''
  });

  const SAMPLE_FORM_DEFAULTS: Partial<Sample> = {
    orderId: '',
    customerId: '',
    customerName: '',
    productName: '',
    size: 'L',
    quantity: 1,
    vendor: 'Sampling Room HIJ (Internal)',
    status: 'In Progress',
    qcNote: defaultQcNote('L'),
    feedback: '',
    notes: ''
  };

  const [newSample, setNewSample] = useState<Partial<Sample>>(SAMPLE_FORM_DEFAULTS);

  // Link an existing sample to an order
  const [linkSample, setLinkSample] = useState<Sample | null>(null);
  const [linkOrderId, setLinkOrderId] = useState('');

  // Change sample status
  const [statusSample, setStatusSample] = useState<Sample | null>(null);
  const [statusValue, setStatusValue] = useState<Sample['status']>('In Progress');
  const [statusFeedback, setStatusFeedback] = useState('');
  const [statusError, setStatusError] = useState<string | null>(null);

  const handleDesignImageUpload = async (file: File, side: 'front' | 'back') => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setUploadError('Format file tidak didukung. Pilih file gambar PNG, JPG, atau WebP.');
      return;
    }
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setUploadError(`Ukuran file ${(file.size / 1024 / 1024).toFixed(1)}MB melebihi batas ${MAX_UPLOAD_MB}MB. Kompres gambar lalu unggah lagi.`);
      return;
    }
    setUploadError(null);

    if (side === 'front') setFrontUploading(true);
    if (side === 'back') setBackUploading(true);

    try {
      const url = await uploadMedia(file);
      setNewDesign(prev => ({
        ...prev,
        [side === 'front' ? 'mockupFront' : 'mockupBack']: url
      }));
    } catch (err) {
      console.warn('Gagal upload ke server API, menggunakan fallback FileReader data URL:', err);
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        if (dataUrl) {
          setNewDesign(prev => ({
            ...prev,
            [side === 'front' ? 'mockupFront' : 'mockupBack']: dataUrl
          }));
        }
      };
      reader.readAsDataURL(file);
    } finally {
      if (side === 'front') setFrontUploading(false);
      if (side === 'back') setBackUploading(false);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>, side: 'front' | 'back') => {
    const file = e.target.files?.[0];
    if (file) {
      handleDesignImageUpload(file, side);
    }
    e.target.value = '';
  };

  const loadData = async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const [desRes, samRes, ordRes, custRes] = await Promise.all([
        fetchResource<Design>('designs'),
        fetchResource<Sample>('samples'),
        fetchResource<Order>('orders'),
        fetchResource<Customer>('customers')
      ]);
      setDesigns(desRes.length > 0 ? desRes : [
        {
          id: 'DSN-001',
          name: 'Jaket Taslan Arkato',
          orderId: 'ORD-001',
          customerId: 'CUST-001',
          category: 'Jaket',
          status: 'Approved',
          description: 'Bordir dada kiri 8cm & furing polar hitam.',
          mockupFront: '/templates/Halaman1.png',
          mockupBack: '/templates/Halaman2.png',
          approvedBy: 'Pak Rezza',
          approvedAt: '2026-09-02T10:00:00Z'
        }
      ]);
      setSamples(samRes.length > 0 ? samRes : [
        {
          id: 'SMP-001',
          orderId: 'ORD-001',
          customerId: 'CUST-001',
          productName: 'Sample Jaket Arkato Size L',
          quantity: 1,
          vendor: 'Sampling Room HIJ (Internal)',
          status: 'Approved',
          qcNote: 'Ukuran dada 54cm, resleting YKK lancar, jahitan rapi.',
          feedback: 'Klien puas dengan sampel bahan dan jahitan.'
        }
      ]);
      setOrders(ordRes);
      setCustomers(custRes);
    } catch (err) {
      // Silence here left the client dropdowns empty with no explanation.
      setLoadError('Data desain dan sampel gagal dimuat. Periksa koneksi ke server, lalu muat ulang halaman.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleOpenNewDesign = () => {
    setEditingDesignId(null);
    setNewDesign({
      name: '',
      orderId: '',
      customerId: '',
      category: 'Kaos / Polo',
      status: 'Pending Review',
      description: '',
      mockupFront: '',
      mockupBack: ''
    });
    setIsDesignModalOpen(true);
  };

  const handleEditDesign = (design: Design) => {
    setEditingDesignId(design.id);
    setNewDesign({
      name: design.name,
      orderId: design.orderId || '',
      customerId: design.customerId || '',
      category: design.category || 'Kaos / Polo',
      status: design.status,
      description: design.description || '',
      mockupFront: design.mockupFront || '',
      mockupBack: design.mockupBack || '',
      approvedAt: design.approvedAt || ''
    });
    setIsDesignModalOpen(true);
  };

  const handleSaveDesign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingDesign) return;

    const errors: Record<string, string> = {};
    if (!newDesign.customerId) errors.customerId = 'Pilih klien pemilik desain ini.';
    if (!newDesign.name?.trim()) errors.name = 'Isi nama desain agar mudah dicari.';

    if (Object.keys(errors).length > 0) {
      setDesignFieldErrors(errors);
      setDesignError('Lengkapi isian yang ditandai merah, lalu simpan lagi.');
      document.getElementById(errors.customerId ? 'dsn-customer' : 'dsn-name')?.focus();
      return;
    }

    setDesignFieldErrors({});
    setDesignError(null);
    setSavingDesign(true);
    try {
      /*
       * Approval is what lets a design be pulled into a penawaran, so the moment
       * it happens is recorded. Moving the status back clears the stamp rather
       * than leaving a stale approval date behind.
       */
      const status = (newDesign.status as Design['status']) || 'Pending Review';
      const approvalStamp = status === 'Approved'
        ? { approvedAt: newDesign.approvedAt || new Date().toISOString() }
        : { approvedAt: '' };

      if (editingDesignId) {
        await updateResource('designs', editingDesignId, {
          name: newDesign.name.trim(),
          orderId: newDesign.orderId || undefined,
          customerId: newDesign.customerId || undefined,
          category: newDesign.category || 'Kaos / Polo',
          status,
          description: newDesign.description?.trim(),
          mockupFront: newDesign.mockupFront || undefined,
          mockupBack: newDesign.mockupBack || undefined,
          ...approvalStamp
        });
      } else {
        const item: Design = {
          id: generateId('DSN'),
          orderId: newDesign.orderId || undefined,
          customerId: newDesign.customerId || undefined,
          name: newDesign.name.trim(),
          category: newDesign.category || 'Kaos / Polo',
          status,
          description: newDesign.description?.trim(),
          mockupFront: newDesign.mockupFront || undefined,
          mockupBack: newDesign.mockupBack || undefined,
          ...approvalStamp,
          timestamp: new Date().toISOString()
        };
        await createResource('designs', item);
      }

      setIsDesignModalOpen(false);
      setEditingDesignId(null);
      setNewDesign({
        name: '',
        orderId: '',
        customerId: '',
        category: 'Kaos / Polo',
        status: 'Pending Review',
        description: '',
        mockupFront: '',
        mockupBack: ''
      });
      showToast(editingDesignId ? `Desain ${editingDesignId} diperbarui.` : 'Desain baru tersimpan.');
      loadData();
    } catch (err) {
      setDesignError('Desain gagal disimpan. Periksa koneksi ke server, lalu coba simpan lagi.');
    } finally {
      setSavingDesign(false);
    }
  };

  const handleCreateSample = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingSample) return;

    const errors: Record<string, string> = {};
    if (!newSample.customerId) errors.customerId = 'Pilih klien yang meminta sampel ini.';
    if (!newSample.productName?.trim()) errors.productName = 'Isi nama sampel produk.';
    if (!(Number(newSample.quantity) > 0)) errors.quantity = 'Jumlah sampel minimal 1 pcs.';

    if (Object.keys(errors).length > 0) {
      setSampleFieldErrors(errors);
      setSampleError('Lengkapi isian yang ditandai merah, lalu simpan lagi.');
      const firstId = errors.customerId ? 'smp-customer' : errors.productName ? 'smp-product' : 'smp-quantity';
      document.getElementById(firstId)?.focus();
      return;
    }

    setSampleFieldErrors({});
    setSampleError(null);
    setSavingSample(true);
    const cust = customers.find(c => c.id === newSample.customerId);
    const resolvedCustomerName = newSample.customerName || cust?.name || (cust?.company ? `${cust.company}` : undefined);

    const item: Sample = {
      id: generateId('SMP'),
      orderId: newSample.orderId || undefined,
      customerId: newSample.customerId || '',
      customerName: resolvedCustomerName,
      productName: newSample.productName?.trim() || 'Sampel Produk',
      size: newSample.size?.trim() || 'All Size',
      quantity: Number(newSample.quantity) || 1,
      vendor: newSample.vendor || 'Sampling Room HIJ (Internal)',
      status: (newSample.status as any) || 'In Progress',
      qcNote: newSample.qcNote?.trim(),
      feedback: newSample.feedback?.trim(),
      notes: newSample.notes?.trim(),
      timestamp: new Date().toISOString()
    };

    try {
      await createResource('samples', item);
      setIsSampleModalOpen(false);
      setNewSample(SAMPLE_FORM_DEFAULTS);
      showToast(`Permintaan sampel ${item.id} tersimpan.`);
      loadData();
    } catch (err) {
      setSampleError('Sampel gagal disimpan. Periksa koneksi ke server, lalu coba simpan lagi.');
    } finally {
      setSavingSample(false);
    }
  };

  const handleOpenLink = (sample: Sample) => {
    setLinkSample(sample);
    setLinkOrderId('');
  };

  const handleLinkSample = async (e: React.FormEvent) => {
    e.preventDefault();
    const ord = orders.find(o => o.id === linkOrderId);
    if (!linkSample || !ord) return;
    try {
      await updateResource('samples', linkSample.id, {
        orderId: ord.id,
        customerId: ord.customerId,
        customerName: ord.customerName
      });
      setLinkSample(null);
      showToast(`Sampel ${linkSample.id} dihubungkan ke ${ord.po || ord.id}.`);
      loadData();
    } catch (err) {
      showToast('Gagal menghubungkan sampel. Periksa koneksi ke server, lalu coba lagi.', 'error');
    }
  };

  const handleApproveSample = async (sample: Sample) => {
    if (!window.confirm(`Setujui sampel ${sample.id}? Sampel ini menjadi acuan produksi massal.`)) return;
    try {
      await updateResource('samples', sample.id, {
        status: 'Approved',
        approvedAt: new Date().toISOString()
      });
      // Anti-Skip: Auto-sync status pesanan terkait menjadi 'Order' dan sampleStatus: 'Approved'
      if (sample.orderId) {
        try {
          await updateResource('orders', sample.orderId, {
            sampleStatus: 'Approved',
            status: 'Order'
          });
        } catch (syncErr) {
          console.warn('Auto-sync order status failed:', syncErr);
        }
      }
      showToast(`Sampel ${sample.id} disetujui dan menjadi acuan produksi.`);
      loadData();
    } catch (err) {
      showToast('Gagal menyetujui sampel. Periksa koneksi ke server, lalu coba lagi.', 'error');
    }
  };

  const handleOpenStatus = (sample: Sample) => {
    setStatusSample(sample);
    setStatusValue(sample.status);
    setStatusFeedback(sample.feedback || '');
    setStatusError(null);
  };

  const handleSaveStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!statusSample) return;
    const updates: Partial<Sample> = { status: statusValue, feedback: statusFeedback };
    if (statusValue === 'Approved' && statusSample.status !== 'Approved') {
      updates.approvedAt = new Date().toISOString();
    }
    if (statusValue !== 'Approved') {
      updates.approvedAt = '';
    }
    try {
      await updateResource('samples', statusSample.id, updates);
      // Anti-Skip: Auto-sync status pesanan jika status berubah menjadi Approved
      if (statusValue === 'Approved' && statusSample.orderId) {
        try {
          await updateResource('orders', statusSample.orderId, {
            sampleStatus: 'Approved',
            status: 'Order'
          });
        } catch (syncErr) {
          console.warn('Auto-sync order status failed:', syncErr);
        }
      }
      setStatusSample(null);
      showToast(`Status ${statusSample.id} diubah menjadi ${statusLabel(statusValue)}.`);
      loadData();
    } catch (err) {
      setStatusError('Gagal mengubah status sampel. Periksa koneksi ke server, lalu coba lagi.');
    }
  };

  // Arrow/Home/End move between sub-tabs (WAI-ARIA tabs pattern, automatic activation).
  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const idx = SUB_TABS.indexOf(activeSubTab);
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = (idx + 1) % SUB_TABS.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + SUB_TABS.length) % SUB_TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = SUB_TABS.length - 1;
    if (next === null) return;
    e.preventDefault();
    setActiveSubTab(SUB_TABS[next]);
    document.getElementById(`dsn-tab-${SUB_TABS[next]}`)?.focus();
  };

  const tabProps = (tab: SubTab) => ({
    value: tab,
    id: `dsn-tab-${tab}`,
    'aria-controls': activeSubTab === tab ? `dsn-panel-${tab}` : undefined,
    tabIndex: activeSubTab === tab ? 0 : -1
  });

  const mockupButtonClass = `relative aspect-square bg-white rounded-lg p-1 border border-slate-200 flex items-center justify-center overflow-hidden cursor-pointer transition-colors hover:border-brand-teal/60 ${focusRing}`;
  const mockupLabelClass = 'absolute bottom-1.5 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-black/80 text-white text-xs rounded font-semibold';

  const sortedDesigns = sortRows(designs, designSort, (design, key) => (design as any)[key]);
  const sortedSamples = sortRows(samples, sampleSort, (sample, key) => (sample as any)[key]);

  const detailDesign = detailDesignId ? designs.find(d => d.id === detailDesignId) ?? null : null;
  const detailSample = detailSampleId ? samples.find(s => s.id === detailSampleId) ?? null : null;

  const customerOf = (customerId?: string) => customers.find(c => c.id === customerId);
  const orderRef = (orderId?: string) => (orderId ? orders.find(o => o.id === orderId)?.po || orderId : '');

  return (
    <div className="space-y-6">
      <Toast toast={toast} />

      <PageHeader
        title="Desain & Sampel"
        description="Desain produk dan persetujuan sampel sebelum produksi."
        actions={
          activeSubTab === 'designs' ? (
            <Button size="sm" onClick={handleOpenNewDesign}>
              <Plus size={16} aria-hidden="true" /> Tambah Desain
            </Button>
          ) : activeSubTab === 'samples' ? (
            <Button size="sm" onClick={() => setIsSampleModalOpen(true)}>
              <Plus size={16} aria-hidden="true" /> Tambah Sampel
            </Button>
          ) : undefined
        }
      />

      <FormError>{loadError}</FormError>

      {/* SUB TABS */}
      <Tabs value={activeSubTab} onValueChange={(val) => setActiveSubTab(val as SubTab)}>
        <TabsList aria-label="Bagian desain dan sampel" onKeyDown={handleTabKeyDown}>
          <TabsTrigger {...tabProps('designs')}>
            Desain ({designs.length})
          </TabsTrigger>
          <TabsTrigger {...tabProps('samples')}>
            Sampel ({samples.length})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* TAB 1: DESIGNS */}
      {activeSubTab === 'designs' && (
        <div role="tabpanel" id="dsn-panel-designs" aria-labelledby="dsn-tab-designs">
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableSortHead className="cell-sticky-start" sortKey="id" sort={designSort} onSortChange={setDesignSort}>
                    Kode Desain
                  </TableSortHead>
                  {/* Staff recognise a design by its mockup, so a thumbnail sits beside the code. */}
                  <TableHead className="hidden sm:table-cell">Mockup</TableHead>
                  <TableSortHead className="hidden md:table-cell" sortKey="name" sort={designSort} onSortChange={setDesignSort}>
                    Nama Desain
                  </TableSortHead>
                  <TableHead className="hidden md:table-cell">Klien</TableHead>
                  <TableHead className="hidden lg:table-cell">Pesanan</TableHead>
                  <TableSortHead className="hidden lg:table-cell" sortKey="timestamp" sort={designSort} onSortChange={setDesignSort}>
                    Tanggal
                  </TableSortHead>
                  <TableHead className="hidden xl:table-cell">Kategori</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="cell-sticky-end text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && designs.length === 0 ? (
                  <TableSkeletonRows columns={9} rows={3} />
                ) : sortedDesigns.length === 0 ? (
                  <TableEmptyRow
                    colSpan={9}
                    icon={<Palette size={20} />}
                    title="Belum ada desain"
                    description="Tambahkan desain dan mockup untuk pesanan yang sedang disiapkan."
                    action={
                      <Button size="sm" onClick={handleOpenNewDesign}>
                        <Plus size={16} aria-hidden="true" /> Tambah Desain
                      </Button>
                    }
                  />
                ) : sortedDesigns.map(design => {
                  const cust = customerOf(design.customerId);
                  return (
                    <TableRow key={design.id}>
                      <TableCell className="cell-sticky-start whitespace-nowrap font-mono font-bold text-slate-900">{design.id}</TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <img
                          src={design.mockupFront || '/logo.png'}
                          alt={`Mockup ${design.name}`}
                          loading="lazy"
                          className="size-9 rounded-md border border-slate-200 bg-white object-contain p-0.5"
                        />
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <span className="font-semibold text-slate-900 break-words">{design.name}</span>
                      </TableCell>
                      <TableCell className="hidden md:table-cell break-words">
                        {cust?.name || design.customerId || '—'}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell whitespace-nowrap font-mono text-teal-700">
                        {orderRef(design.orderId) || '—'}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell whitespace-nowrap">
                        {design.timestamp ? formatDate(design.timestamp) : '—'}
                      </TableCell>
                      <TableCell className="hidden xl:table-cell whitespace-nowrap text-slate-500">
                        {design.category || '—'}
                      </TableCell>
                      <TableCell className="text-center whitespace-nowrap">
                        <StatusBadge status={design.status} size="sm" solid />
                      </TableCell>
                      <TableCell className="cell-sticky-end text-right">
                        <TableRowActions>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleEditDesign(design)}
                            aria-label={`Edit desain ${design.id}`}
                            className="hidden sm:inline-flex h-8 gap-1.5 px-2.5 text-xs"
                          >
                            <Pencil size={14} aria-hidden="true" /> Edit
                          </Button>
                          <RowDetailButton label={design.id} onClick={() => setDetailDesignId(design.id)} />
                        </TableRowActions>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}

      {/* TAB 2: SAMPLES */}
      {activeSubTab === 'samples' && (
        <div role="tabpanel" id="dsn-panel-samples" aria-labelledby="dsn-tab-samples">
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableSortHead className="cell-sticky-start" sortKey="id" sort={sampleSort} onSortChange={setSampleSort}>
                    Kode Sampel
                  </TableSortHead>
                  <TableSortHead className="hidden md:table-cell" sortKey="productName" sort={sampleSort} onSortChange={setSampleSort}>
                    Nama Sampel
                  </TableSortHead>
                  {/* Fitting size is the point of a sample, so it earns its own column. */}
                  <TableSortHead className="hidden lg:table-cell" sortKey="size" sort={sampleSort} onSortChange={setSampleSort}>
                    Ukuran
                  </TableSortHead>
                  <TableHead className="hidden md:table-cell">Klien</TableHead>
                  <TableHead className="hidden lg:table-cell">Pesanan</TableHead>
                  <TableSortHead className="hidden sm:table-cell" align="right" sortKey="quantity" sort={sampleSort} onSortChange={setSampleSort}>
                    Jumlah
                  </TableSortHead>
                  <TableSortHead className="hidden lg:table-cell" sortKey="timestamp" sort={sampleSort} onSortChange={setSampleSort}>
                    Tanggal
                  </TableSortHead>
                  <TableHead className="hidden xl:table-cell">Pembuat</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="cell-sticky-end text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && samples.length === 0 ? (
                  <TableSkeletonRows columns={10} rows={3} />
                ) : sortedSamples.length === 0 ? (
                  <TableEmptyRow
                    colSpan={10}
                    icon={<FlaskConical size={20} />}
                    title="Belum ada sampel"
                    description="Tambahkan sampel fisik untuk uji fitting dan bahan kain sebelum penawaran disetujui."
                    action={
                      <Button size="sm" onClick={() => setIsSampleModalOpen(true)}>
                        <Plus size={16} aria-hidden="true" /> Tambah Sampel
                      </Button>
                    }
                  />
                ) : sortedSamples.map(sample => {
                  const cust = customerOf(sample.customerId);
                  return (
                    <TableRow key={sample.id}>
                      <TableCell className="cell-sticky-start whitespace-nowrap font-mono font-bold text-slate-900">{sample.id}</TableCell>
                      <TableCell className="hidden md:table-cell">
                        <span className="font-semibold text-slate-900 break-words">{sample.productName}</span>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell whitespace-nowrap font-semibold text-slate-700">
                        {sample.size || '—'}
                      </TableCell>
                      <TableCell className="hidden md:table-cell break-words">
                        {sample.customerName || cust?.name || '—'}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell whitespace-nowrap font-mono text-teal-700">
                        {orderRef(sample.orderId) || '—'}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-right font-semibold text-slate-900 whitespace-nowrap">
                        {sample.quantity || 1}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell whitespace-nowrap">
                        {sample.timestamp ? formatDate(sample.timestamp) : '—'}
                      </TableCell>
                      <TableCell className="hidden xl:table-cell break-words text-slate-500">
                        {sample.vendor || '—'}
                      </TableCell>
                      <TableCell className="text-center whitespace-nowrap">
                        <StatusBadge status={sample.status} size="sm" solid />
                      </TableCell>
                      <TableCell className="cell-sticky-end text-right">
                        <TableRowActions>
                          {sample.status !== 'Approved' && (
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => handleApproveSample(sample)}
                              aria-label={`Setujui sampel ${sample.id}`}
                              className="hidden sm:inline-flex h-8 gap-1.5 px-2.5 text-xs"
                            >
                              <CheckCircle2 size={14} aria-hidden="true" /> Setujui
                            </Button>
                          )}
                          <RowDetailButton label={sample.id} onClick={() => setDetailSampleId(sample.id)} />
                        </TableRowActions>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}

      {/* DESIGN ROW DETAIL */}
      <DetailDrawer
        isOpen={!!detailDesign}
        onClose={() => setDetailDesignId(null)}
        title={detailDesign?.name}
        subtitle={detailDesign && (
          <span className="font-mono">
            {detailDesign.id}{detailDesign.timestamp ? ` · ${formatDate(detailDesign.timestamp)}` : ''}
          </span>
        )}
        status={detailDesign && <StatusBadge status={detailDesign.status} size="sm" solid />}
        footer={detailDesign && (
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setDetailDesignId(null);
              handleEditDesign(detailDesign);
            }}
          >
            <Pencil size={16} aria-hidden="true" /> Edit / Ganti Gambar Mockup
          </Button>
        )}
      >
        {detailDesign && (() => {
          const cust = customerOf(detailDesign.customerId);
          return (
            <>
              <DetailBlock title="Mockup">
                <div className="grid grid-cols-2 gap-2 bg-slate-50 p-2 rounded-xl border border-slate-100">
                  <button
                    type="button"
                    onClick={() => setPreviewImage({ title: `${detailDesign.name}, tampak depan`, path: detailDesign.mockupFront || '/logo.png' })}
                    aria-label={`Perbesar tampak depan ${detailDesign.name}`}
                    className={mockupButtonClass}
                  >
                    <img
                      src={detailDesign.mockupFront || '/logo.png'}
                      alt={`${detailDesign.name} tampak depan`}
                      loading="lazy"
                      className="w-full h-full object-contain"
                    />
                    <span aria-hidden="true" className={mockupLabelClass}>Depan</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewImage({ title: `${detailDesign.name}, tampak belakang`, path: detailDesign.mockupBack || '/logo.png' })}
                    aria-label={`Perbesar tampak belakang ${detailDesign.name}`}
                    className={mockupButtonClass}
                  >
                    <img
                      src={detailDesign.mockupBack || '/logo.png'}
                      alt={`${detailDesign.name} tampak belakang`}
                      loading="lazy"
                      className="w-full h-full object-contain"
                    />
                    <span aria-hidden="true" className={mockupLabelClass}>Belakang</span>
                  </button>
                </div>
              </DetailBlock>
              <DetailSection title="Desain">
                <DetailField label="Kode desain" mono>{detailDesign.id}</DetailField>
                <DetailField label="Kategori">{detailDesign.category}</DetailField>
                <DetailField label="Nama desain" full>{detailDesign.name}</DetailField>
                <DetailField label="Status"><StatusBadge status={detailDesign.status} size="sm" solid /></DetailField>
                <DetailField label="Tanggal dibuat">{detailDesign.timestamp && formatDate(detailDesign.timestamp)}</DetailField>
              </DetailSection>
              <DetailSection title="Klien & Pesanan">
                <DetailField label="Klien">{cust?.name}</DetailField>
                <DetailField label="Perusahaan">{cust?.company}</DetailField>
                <DetailField label="ID klien" mono>{detailDesign.customerId}</DetailField>
                <DetailField label="Pesanan terkait" mono>{orderRef(detailDesign.orderId)}</DetailField>
              </DetailSection>
              <DetailSection title="Spesifikasi">
                <DetailField label="Instruksi sablon / bordir" full>{detailDesign.description}</DetailField>
                <DetailField label="Catatan revisi" full>{detailDesign.revisionNotes}</DetailField>
              </DetailSection>
              <DetailSection title="Persetujuan">
                <DetailField label="Disetujui oleh">{detailDesign.approvedBy}</DetailField>
                <DetailField label="Disetujui pada">{detailDesign.approvedAt && formatDate(detailDesign.approvedAt)}</DetailField>
              </DetailSection>
              <DetailSection title="Riwayat Data">
                <DetailField label="Dicatat oleh">{detailDesign.user}</DetailField>
                <DetailField label="Dicatat pada">{detailDesign.timestamp && formatDateTime(detailDesign.timestamp)}</DetailField>
              </DetailSection>
            </>
          );
        })()}
      </DetailDrawer>

      {/* SAMPLE ROW DETAIL */}
      <DetailDrawer
        isOpen={!!detailSample}
        onClose={() => setDetailSampleId(null)}
        title={detailSample?.productName}
        subtitle={detailSample && (
          <span className="font-mono">
            {detailSample.id}{detailSample.timestamp ? ` · ${formatDate(detailSample.timestamp)}` : ''}
          </span>
        )}
        status={detailSample && <StatusBadge status={detailSample.status} size="sm" solid />}
        footer={detailSample && (
          <>
            {!detailSample.orderId && (
              <Button type="button" variant="outline" size="sm" onClick={() => handleOpenLink(detailSample)}>
                <Link2 size={16} aria-hidden="true" /> Hubungkan Pesanan
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" onClick={() => handleOpenStatus(detailSample)}>
              <RefreshCw size={16} aria-hidden="true" /> Ubah Status
            </Button>
            {detailSample.status !== 'Approved' && (
              <Button type="button" size="sm" onClick={() => handleApproveSample(detailSample)}>
                <CheckCircle2 size={16} aria-hidden="true" /> Setujui Sampel
              </Button>
            )}
          </>
        )}
      >
        {detailSample && (() => {
          const cust = customerOf(detailSample.customerId);
          return (
            <>
              <DetailSection title="Sampel">
                <DetailField label="Kode sampel" mono>{detailSample.id}</DetailField>
                <DetailField label="Ukuran fitting">{detailSample.size}</DetailField>
                <DetailField label="Jumlah">{detailSample.quantity || 1} Pcs</DetailField>
                <DetailField label="Nama sampel" full>{detailSample.productName}</DetailField>
                <DetailField label="Unit pembuat">{detailSample.vendor}</DetailField>
                <DetailField label="Status"><StatusBadge status={detailSample.status} size="sm" solid /></DetailField>
              </DetailSection>
              <DetailSection title="Klien & Pesanan">
                <DetailField label="Klien">{detailSample.customerName || cust?.name}</DetailField>
                <DetailField label="Perusahaan">{cust?.company}</DetailField>
                <DetailField label="ID klien" mono>{detailSample.customerId}</DetailField>
                <DetailField label="Pesanan terkait" mono>{orderRef(detailSample.orderId)}</DetailField>
                <DetailField label="No. resi kiriman sampel" mono full>{detailSample.trackingNumber}</DetailField>
              </DetailSection>
              <DetailSection title="Catatan">
                <DetailField label="Catatan QC & fitting" full>{detailSample.qcNote}</DetailField>
                <DetailField label="Masukan klien" full>{detailSample.feedback}</DetailField>
                <DetailField label="Catatan lain" full>{detailSample.notes}</DetailField>
              </DetailSection>
              <DetailSection title="Riwayat Data">
                <DetailField label="Disetujui pada">{detailSample.approvedAt && formatDate(detailSample.approvedAt)}</DetailField>
                <DetailField label="Dicatat oleh">{detailSample.user}</DetailField>
                <DetailField label="Dicatat pada">{detailSample.timestamp && formatDateTime(detailSample.timestamp)}</DetailField>
              </DetailSection>
            </>
          );
        })()}
      </DetailDrawer>

      {/* CREATE / EDIT DESIGN MODAL */}
      <Modal
        isOpen={isDesignModalOpen}
        onClose={() => {
          setIsDesignModalOpen(false);
          setEditingDesignId(null);
        }}
        title={editingDesignId ? 'Edit Desain & Mockup' : 'Buat Desain & Mockup Baru'}
        subtitle="Mockup di sini ikut terpakai saat penawaran dan SPK dibuat."
        maxWidth="4xl"
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={savingDesign}
              onClick={() => {
                setIsDesignModalOpen(false);
                setEditingDesignId(null);
              }}
            >
              Batal
            </Button>
            <Button type="submit" form="design-form" disabled={savingDesign || frontUploading || backUploading}>
              {savingDesign ? 'Menyimpan…' : editingDesignId ? 'Simpan Perubahan' : 'Simpan Desain'}
            </Button>
          </div>
        }
      >
        <form id="design-form" noValidate onSubmit={handleSaveDesign} className="space-y-5">
          <FormError>{designError}</FormError>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            {/* Left: identity & specification */}
            <div className="space-y-4 lg:col-span-7">
              <div>
                <h3 className="flex items-center gap-1.5 text-sm font-bold text-foreground">
                  <Palette size={16} className="text-brand-teal-dark" aria-hidden="true" />
                  Identitas & spesifikasi desain
                </h3>
                <p className="mt-0.5 text-xs text-muted-foreground text-pretty">
                  Data ini yang tercetak di surat penawaran dan SPK produksi.
                </p>
              </div>

              <div>
                <FieldLabel htmlFor="dsn-customer" required>Klien / calon pelanggan</FieldLabel>
                <Select
                  id="dsn-customer"
                  value={newDesign.customerId}
                  aria-invalid={!!designFieldErrors.customerId}
                  aria-describedby={designFieldErrors.customerId ? 'dsn-customer-error' : 'dsn-customer-hint'}
                  onChange={(e) => {
                    const cust = customers.find(c => c.id === e.target.value);
                    setDesignFieldErrors(prev => ({ ...prev, customerId: '' }));
                    setNewDesign({
                      ...newDesign,
                      customerId: e.target.value,
                      name: newDesign.name || (cust ? `Desain ${newDesign.category || 'Garmen'} ${cust.name}` : '')
                    });
                  }}
                >
                  <option value="">Pilih klien / calon pelanggan</option>
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.company ? `(${c.company})` : ''} · {c.phone || c.id}
                    </option>
                  ))}
                </Select>
                {designFieldErrors.customerId ? (
                  <FieldError id="dsn-customer-error">{designFieldErrors.customerId}</FieldError>
                ) : (
                  <FieldHint id="dsn-customer-hint">
                    Desain tercatat atas nama klien ini dan siap ditarik saat penawaran dibuat.
                  </FieldHint>
                )}
              </div>

              <fieldset>
                <legend className="mb-1.5 block text-sm font-semibold text-foreground">
                  Kategori pakaian
                </legend>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {DESIGN_CATEGORIES.map(cat => (
                    <ChipButton
                      key={cat}
                      selected={newDesign.category === cat}
                      onClick={() => setNewDesign({ ...newDesign, category: cat })}
                    >
                      {cat}
                    </ChipButton>
                  ))}
                </div>
                <FieldLabel htmlFor="dsn-category" className="text-xs font-medium text-muted-foreground">
                  Atau ketik kategori lain
                </FieldLabel>
                <Input
                  id="dsn-category"
                  type="text"
                  placeholder="Contoh: Apron / Topi Rimba"
                  value={newDesign.category}
                  onChange={(e) => setNewDesign({ ...newDesign, category: e.target.value })}
                />
              </fieldset>

              <div>
                <FieldLabel htmlFor="dsn-name" required>Nama desain & mockup</FieldLabel>
                <Input
                  id="dsn-name"
                  type="text"
                  placeholder="Contoh: Kemeja PDL Ripstop Lapangan PT Adhi Karya"
                  value={newDesign.name}
                  aria-invalid={!!designFieldErrors.name}
                  aria-describedby={designFieldErrors.name ? 'dsn-name-error' : undefined}
                  onChange={(e) => {
                    setDesignFieldErrors(prev => ({ ...prev, name: '' }));
                    setNewDesign({ ...newDesign, name: e.target.value });
                  }}
                />
                <FieldError id="dsn-name-error">{designFieldErrors.name}</FieldError>
              </div>

              <div>
                <FieldLabel htmlFor="dsn-description" aside="Opsional">
                  Instruksi sablon / bordir & spesifikasi
                </FieldLabel>
                <Textarea
                  id="dsn-description"
                  rows={3}
                  placeholder="Contoh: Bordir komputer dada kiri 8 cm, sablon DTF punggung 28×10 cm, benang senada kain."
                  value={newDesign.description}
                  onChange={(e) => setNewDesign({ ...newDesign, description: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <FieldLabel htmlFor="dsn-status">Status desain</FieldLabel>
                  <Select
                    id="dsn-status"
                    value={newDesign.status}
                    aria-describedby="dsn-status-hint"
                    onChange={(e) => setNewDesign({ ...newDesign, status: e.target.value as any })}
                  >
                    <option value="Draft">Draf internal (R&D)</option>
                    <option value="Pending Review">Menunggu review klien</option>
                    <option value="Revision Requested">Perlu revisi</option>
                    <option value="Approved">Disetujui klien</option>
                    <option value="Rejected">Ditolak klien</option>
                  </Select>
                  <FieldHint id="dsn-status-hint">
                    Hanya desain berstatus disetujui yang bisa ditarik ke surat penawaran.
                  </FieldHint>
                </div>

                <div>
                  <FieldLabel htmlFor="dsn-order" aside="Opsional">Pesanan terkait</FieldLabel>
                  <Select
                    id="dsn-order"
                    value={newDesign.orderId}
                    onChange={(e) => {
                      const ord = orders.find(o => o.id === e.target.value);
                      setNewDesign({
                        ...newDesign,
                        orderId: e.target.value,
                        customerId: ord?.customerId || newDesign.customerId
                      });
                    }}
                  >
                    <option value="">Belum ada pesanan (pra-penawaran)</option>
                    {orders.map(o => (
                      <option key={o.id} value={o.id}>{o.po || o.id} · {o.customerName}</option>
                    ))}
                  </Select>
                </div>
              </div>
            </div>

            {/* Right: mockup upload */}
            <div className="lg:col-span-5">
              <div className="space-y-4 rounded-2xl border border-border bg-muted/30 p-4">
                <div>
                  <h3 className="flex items-center gap-1.5 text-sm font-bold text-foreground">
                    <UploadCloud size={16} className="text-brand-teal-dark" aria-hidden="true" />
                    Aset gambar mockup
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground text-pretty">
                    Unggah file mockup yang sudah dibuat di software desain (Corel, Photoshop, Illustrator, Canva, CLO 3D).
                  </p>
                </div>

                {/* Hidden native file inputs */}
                <input
                  type="file"
                  ref={frontFileInputRef}
                  accept={ACCEPTED_IMAGE_TYPES}
                  className="hidden"
                  onChange={(e) => handleFileInputChange(e, 'front')}
                />
                <input
                  type="file"
                  ref={backFileInputRef}
                  accept={ACCEPTED_IMAGE_TYPES}
                  className="hidden"
                  onChange={(e) => handleFileInputChange(e, 'back')}
                />

                <div className="grid grid-cols-2 gap-3">
                  <MockupSlot
                    label="Tampak Depan"
                    value={newDesign.mockupFront}
                    uploading={frontUploading}
                    dragOver={dragOverFront}
                    onDragOverChange={setDragOverFront}
                    onFile={(file) => handleDesignImageUpload(file, 'front')}
                    onPick={() => frontFileInputRef.current?.click()}
                    onClear={() => setNewDesign({ ...newDesign, mockupFront: '' })}
                    onPreview={() => setPreviewImage({ title: 'Mockup Tampak Depan', path: newDesign.mockupFront! })}
                  />
                  <MockupSlot
                    label="Tampak Belakang"
                    value={newDesign.mockupBack}
                    uploading={backUploading}
                    dragOver={dragOverBack}
                    onDragOverChange={setDragOverBack}
                    onFile={(file) => handleDesignImageUpload(file, 'back')}
                    onPick={() => backFileInputRef.current?.click()}
                    onClear={() => setNewDesign({ ...newDesign, mockupBack: '' })}
                    onPreview={() => setPreviewImage({ title: 'Mockup Tampak Belakang', path: newDesign.mockupBack! })}
                  />
                </div>

                <FieldError>{uploadError}</FieldError>

                {!newDesign.mockupFront && (
                  <FieldHint>
                    Tampak depan dipakai sebagai thumbnail di tabel desain dan pada surat penawaran.
                  </FieldHint>
                )}

                <div>
                  <button
                    type="button"
                    onClick={() => setShowManualUrl(!showManualUrl)}
                    aria-expanded={showManualUrl}
                    aria-controls="dsn-manual-url"
                    className={`-ml-1 inline-flex h-8 cursor-pointer items-center gap-1 rounded px-1 text-xs font-medium text-slate-600 transition-colors hover:text-brand-teal-dark ${focusRing}`}
                  >
                    {showManualUrl
                      ? <ChevronUp size={14} aria-hidden="true" />
                      : <ChevronDown size={14} aria-hidden="true" />}
                    <span>{showManualUrl ? 'Sembunyikan URL manual' : 'Atau masukkan URL gambar manual'}</span>
                  </button>

                  {showManualUrl && (
                    <div id="dsn-manual-url" className="mt-2 space-y-3 rounded-xl border border-border bg-white p-3">
                      <div>
                        <FieldLabel htmlFor="dsn-mockup-front" className="text-xs">URL tampak depan</FieldLabel>
                        <Input
                          id="dsn-mockup-front"
                          type="text"
                          className="h-9 font-mono text-xs"
                          placeholder="https://… atau /uploads/…"
                          value={newDesign.mockupFront || ''}
                          onChange={(e) => setNewDesign({ ...newDesign, mockupFront: e.target.value })}
                        />
                      </div>
                      <div>
                        <FieldLabel htmlFor="dsn-mockup-back" className="text-xs">URL tampak belakang</FieldLabel>
                        <Input
                          id="dsn-mockup-back"
                          type="text"
                          className="h-9 font-mono text-xs"
                          placeholder="https://… atau /uploads/…"
                          value={newDesign.mockupBack || ''}
                          onChange={(e) => setNewDesign({ ...newDesign, mockupBack: e.target.value })}
                        />
                      </div>
                    </div>
                  )}
                </div>

              </div>
            </div>
          </div>
        </form>
      </Modal>

      {/* CREATE SAMPLE MODAL */}
      <Modal
        isOpen={isSampleModalOpen}
        onClose={() => setIsSampleModalOpen(false)}
        title="Tambah Permintaan Sampel Fisik"
        subtitle="Prototipe untuk cek pola, bahan, dan jahitan sebelum produksi massal."
        maxWidth="3xl"
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="outline" disabled={savingSample} onClick={() => setIsSampleModalOpen(false)}>
              Batal
            </Button>
            <Button type="submit" form="sample-form" disabled={savingSample}>
              {savingSample ? 'Menyimpan…' : 'Simpan Sampel'}
            </Button>
          </div>
        }
      >
        <form id="sample-form" noValidate onSubmit={handleCreateSample} className="space-y-5">
          <FormError>{sampleError}</FormError>

          <FormSection step={1} title="Klien & produk sampel">
            <div>
              <FieldLabel htmlFor="smp-customer" required>Klien / calon pelanggan</FieldLabel>
              <Select
                id="smp-customer"
                value={newSample.customerId}
                aria-invalid={!!sampleFieldErrors.customerId}
                aria-describedby={sampleFieldErrors.customerId ? 'smp-customer-error' : undefined}
                onChange={(e) => {
                  const cust = customers.find(c => c.id === e.target.value);
                  setSampleFieldErrors(prev => ({ ...prev, customerId: '' }));
                  setNewSample({
                    ...newSample,
                    customerId: e.target.value,
                    customerName: cust?.name || (cust?.company ? `${cust.company}` : ''),
                    productName: newSample.productName || (cust ? `Sample ${cust.name}` : '')
                  });
                }}
              >
                <option value="">Pilih klien / calon pelanggan</option>
                {customers.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.company ? `(${c.company})` : ''} · {c.phone || c.id}
                  </option>
                ))}
              </Select>
              <FieldError id="smp-customer-error">{sampleFieldErrors.customerId}</FieldError>
            </div>

            <div>
              <FieldLabel htmlFor="smp-product" required>Nama sampel produk</FieldLabel>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {SAMPLE_PRODUCT_PRESETS.map(preset => (
                  <ChipButton
                    key={preset}
                    selected={newSample.productName === preset}
                    onClick={() => {
                      setSampleFieldErrors(prev => ({ ...prev, productName: '' }));
                      setNewSample({ ...newSample, productName: preset });
                    }}
                  >
                    {preset}
                  </ChipButton>
                ))}
              </div>
              <Input
                id="smp-product"
                type="text"
                placeholder="Contoh: Sample Kemeja PDL Ripstop Size L"
                value={newSample.productName}
                aria-invalid={!!sampleFieldErrors.productName}
                aria-describedby={sampleFieldErrors.productName ? 'smp-product-error' : undefined}
                onChange={(e) => {
                  setSampleFieldErrors(prev => ({ ...prev, productName: '' }));
                  setNewSample({ ...newSample, productName: e.target.value });
                }}
              />
              <FieldError id="smp-product-error">{sampleFieldErrors.productName}</FieldError>
            </div>
          </FormSection>

          <FormSection step={2} title="Ukuran & jumlah">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <fieldset>
                <legend className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  <Ruler size={14} className="text-brand-teal-dark" aria-hidden="true" />
                  Ukuran fitting sampel
                </legend>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {SAMPLE_SIZE_CHIPS.map(sz => (
                    <ChipButton
                      key={sz}
                      selected={newSample.size === sz}
                      onClick={() => setNewSample(prev => ({
                        ...prev,
                        size: sz,
                        qcNote: isGeneratedQcNote(prev.qcNote) ? defaultQcNote(sz) : prev.qcNote
                      }))}
                    >
                      {sz}
                    </ChipButton>
                  ))}
                </div>
                <FieldLabel htmlFor="smp-size" className="text-xs font-medium text-muted-foreground">
                  Atau ketik ukuran lain
                </FieldLabel>
                <Input
                  id="smp-size"
                  type="text"
                  placeholder="Contoh: 3XL / custom lingkar dada 56 cm"
                  value={newSample.size || ''}
                  onChange={(e) => setNewSample(prev => ({ ...prev, size: e.target.value }))}
                />
              </fieldset>

              <div>
                <FieldLabel htmlFor="smp-quantity" required>Jumlah sampel (pcs)</FieldLabel>
                <Input
                  id="smp-quantity"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={newSample.quantity || 1}
                  aria-invalid={!!sampleFieldErrors.quantity}
                  aria-describedby={sampleFieldErrors.quantity ? 'smp-quantity-error' : undefined}
                  onChange={(e) => {
                    setSampleFieldErrors(prev => ({ ...prev, quantity: '' }));
                    setNewSample({ ...newSample, quantity: parseInt(e.target.value, 10) || 1 });
                  }}
                  className="text-right font-semibold tabular-nums"
                />
                <FieldError id="smp-quantity-error">{sampleFieldErrors.quantity}</FieldError>
              </div>
            </div>
          </FormSection>

          <FormSection step={3} title="Pembuat, status & catatan">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <FieldLabel htmlFor="smp-vendor">Unit pembuat / sampling room</FieldLabel>
                <Select
                  id="smp-vendor"
                  value={newSample.vendor}
                  onChange={(e) => setNewSample({ ...newSample, vendor: e.target.value })}
                >
                  {SAMPLING_VENDORS.map(v => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </Select>
              </div>

              <div>
                <FieldLabel htmlFor="smp-status">Status awal sampel</FieldLabel>
                <Select
                  id="smp-status"
                  value={newSample.status}
                  onChange={(e) => setNewSample({ ...newSample, status: e.target.value as any })}
                >
                  <option value="In Progress">Sedang dijahit</option>
                  <option value="Development">Development (pola & kain)</option>
                  <option value="Sent to Customer">Dikirim ke klien</option>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <FieldLabel htmlFor="smp-qc-note">Catatan QC & standar fitting</FieldLabel>
                <Textarea
                  id="smp-qc-note"
                  rows={3}
                  placeholder="Contoh: Lebar dada 54 cm, toleransi ±1 cm, resleting YKK lancar, jahitan rantai rapi."
                  value={newSample.qcNote}
                  onChange={(e) => setNewSample({ ...newSample, qcNote: e.target.value })}
                />
              </div>

              <div>
                <FieldLabel htmlFor="smp-feedback" aside="Opsional">Masukan pelanggan</FieldLabel>
                <Textarea
                  id="smp-feedback"
                  rows={3}
                  placeholder="Contoh: Klien minta fitting saat meeting sebelum menyetujui penawaran."
                  value={newSample.feedback}
                  onChange={(e) => setNewSample({ ...newSample, feedback: e.target.value })}
                />
              </div>
            </div>

            <div>
              <FieldLabel htmlFor="smp-notes" aside="Opsional">Catatan lain</FieldLabel>
              <Textarea
                id="smp-notes"
                rows={2}
                placeholder="Contoh: Kain sisa roll lot 3, dijahit penjahit subkon Pak Dedi."
                value={newSample.notes || ''}
                onChange={(e) => setNewSample({ ...newSample, notes: e.target.value })}
              />
            </div>

            <div>
              <FieldLabel htmlFor="smp-order" aside="Opsional">Pesanan terkait</FieldLabel>
              <Select
                id="smp-order"
                value={newSample.orderId}
                onChange={(e) => {
                  const ord = orders.find(o => o.id === e.target.value);
                  setNewSample({
                    ...newSample,
                    orderId: e.target.value,
                    customerId: ord?.customerId || newSample.customerId,
                    customerName: ord?.customerName || newSample.customerName
                  });
                }}
              >
                <option value="">Belum ada pesanan (tahap pra-penawaran)</option>
                {orders.map(o => (
                  <option key={o.id} value={o.id}>{orderLabel(o)}</option>
                ))}
              </Select>
            </div>
          </FormSection>
        </form>
      </Modal>

      {/* LINK SAMPLE TO ORDER MODAL */}
      <Modal
        isOpen={!!linkSample}
        onClose={() => setLinkSample(null)}
        title={`Hubungkan ${linkSample?.id ?? ''} ke Pesanan`}
        maxWidth="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setLinkSample(null)}>
              Batal
            </Button>
            <Button type="submit" form="link-sample-form" disabled={!linkOrderId}>
              Hubungkan
            </Button>
          </div>
        }
      >
        <form id="link-sample-form" onSubmit={handleLinkSample} className="space-y-5">
          <div>
            <FieldLabel htmlFor="smp-link-order" required>Untuk pesanan</FieldLabel>
            <Select
              id="smp-link-order"
              required
              value={linkOrderId}
              onChange={(e) => setLinkOrderId(e.target.value)}
            >
              <option value="">Pilih pesanan</option>
              {orders.map(o => (
                <option key={o.id} value={o.id}>{orderLabel(o)}</option>
              ))}
            </Select>
          </div>
        </form>
      </Modal>

      {/* CHANGE SAMPLE STATUS MODAL */}
      <Modal
        isOpen={!!statusSample}
        onClose={() => setStatusSample(null)}
        title={`Ubah Status ${statusSample?.id ?? ''}`}
        maxWidth="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setStatusSample(null)}>
              Batal
            </Button>
            <Button type="submit" form="sample-status-form">
              Simpan
            </Button>
          </div>
        }
      >
        <form id="sample-status-form" noValidate onSubmit={handleSaveStatus} className="space-y-5">
          <FormError>{statusError}</FormError>

          <div>
            <FieldLabel htmlFor="smp-status-change">Status</FieldLabel>
            <Select
              id="smp-status-change"
              value={statusValue}
              onChange={(e) => {
                setStatusError(null);
                setStatusValue(e.target.value as Sample['status']);
              }}
            >
              {SAMPLE_STATUSES.map(s => (
                <option key={s} value={s}>{statusLabel(s)}</option>
              ))}
            </Select>
          </div>

          <div>
            <FieldLabel
              htmlFor="smp-status-feedback"
              aside={statusValue === 'Revision' || statusValue === 'Rejected' ? undefined : 'Opsional'}
            >
              Masukan pelanggan
            </FieldLabel>
            <Textarea
              id="smp-status-feedback"
              rows={3}
              value={statusFeedback}
              onChange={(e) => setStatusFeedback(e.target.value)}
              placeholder={statusValue === 'Revision' || statusValue === 'Rejected'
                ? 'Contoh: lengan terlalu panjang 2 cm, warna kurang gelap'
                : 'Contoh: pelanggan puas dengan jahitan'}
            />
          </div>
        </form>
      </Modal>

      {/* FULLSIZE IMAGE PREVIEW MODAL */}
      <Modal
        isOpen={!!previewImage}
        onClose={() => setPreviewImage(null)}
        title={previewImage?.title || 'Pratinjau Gambar'}
        subtitle={previewImage?.desc}
        maxWidth="4xl"
      >
        {previewImage && (
          <div className="space-y-4">
            <div className="max-h-[70vh] overflow-auto bg-slate-100 p-2 rounded-xl flex items-center justify-center">
              <img
                src={previewImage.path}
                alt={previewImage.title}
                className="max-w-full max-h-[65vh] object-contain rounded-lg shadow-md"
              />
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 pt-4 border-t border-slate-100">
              <Button
                type="button"
                variant="outline"
                onClick={() => setPreviewImage(null)}
              >
                Tutup
              </Button>
              <a
                href={previewImage.path}
                download
                className={`inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-lg bg-brand-teal text-[#000000] text-sm font-bold shadow-xs transition-colors hover:bg-[#249ea2] ${focusRing}`}
              >
                <Download size={16} aria-hidden="true" /> Unduh Gambar
              </a>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
