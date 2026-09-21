import React, { useState, useEffect } from 'react';
import {
  Search,
  Plus,
  Download,
  AlertTriangle,
  Pencil,
  Package,
  Layers,
  ClipboardCheck,
  History,
  Trash2,
  CheckCircle2,
  AlertCircle,
  TrendingDown,
  Warehouse,
  Boxes,
  MapPin,
  Calendar
} from 'lucide-react';
import { FabricRoll, InventoryItem, StockOpnameRecord } from '../../types';
import { fetchResource, createResource, updateResource, deleteResource } from '../../services/api';
import { exportTableToExcel, formatCurrency, formatDate, formatDateTime, generateId } from '../../lib/utils';
import { Badge, StatusBadge } from '../ui/Badge';
import { Modal } from '../ui/Modal';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { PageHeader } from '../ui/PageHeader';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell, TableRowActions, TableEmptyRow, TableSkeletonRows } from '../ui/Table';
import { DetailDrawer, DetailSection, DetailField, DetailStats, RowDetailButton } from '../ui/DetailDrawer';
import { newestFirst } from '../../lib/ordering';

const ACCESSORY_CATEGORIES = [
  'Kancing & Resleting',
  'Benang',
  'Label & Hangtag',
  'Karet & Tali',
  'Aksesoris Metal/Plastik',
  'Kemasan & Penunjang'
] as const;

const DEFAULT_ACCESSORIES: InventoryItem[] = [
  {
    id: 'ACC-KNC-001',
    name: 'Kancing Kemeja 4 Lubang Putih 18L',
    category: 'Kancing & Resleting',
    stock: 12,
    unit: 'Gross',
    minStock: 5,
    price: 18000,
    location: 'RAK-AKS-A1',
    supplier: 'CV Kancing Jaya'
  },
  {
    id: 'ACC-RES-002',
    name: 'Resleting YKK Metal No. 5 Gigi Kuningan (65 cm)',
    category: 'Kancing & Resleting',
    stock: 8,
    unit: 'Pcs',
    minStock: 25, // LOW STOCK
    price: 12500,
    location: 'RAK-AKS-A2',
    supplier: 'PT Zipper Pratama'
  },
  {
    id: 'ACC-BNG-003',
    name: 'Benang Jahit Poliester Astra 40/2 Hitam',
    category: 'Benang',
    stock: 3,
    unit: 'Cones',
    minStock: 8, // LOW STOCK
    price: 24000,
    location: 'RAK-BNG-01',
    supplier: 'Toko Benang Sentosa'
  },
  {
    id: 'ACC-BNG-004',
    name: 'Benang Jahit Poliester Astra 40/2 Putih',
    category: 'Benang',
    stock: 16,
    unit: 'Cones',
    minStock: 6,
    price: 24000,
    location: 'RAK-BNG-02',
    supplier: 'Toko Benang Sentosa'
  },
  {
    id: 'ACC-LBL-005',
    name: 'Label Woven HIJ Apparel & Size Tag M',
    category: 'Label & Hangtag',
    stock: 150,
    unit: 'Pcs',
    minStock: 300, // LOW STOCK
    price: 650,
    location: 'LACI-LBL-01',
    supplier: 'Percetakan Label Prima'
  },
  {
    id: 'ACC-KRT-006',
    name: 'Karet Kolor Elastis 3 cm Putih Super',
    category: 'Karet & Tali',
    stock: 2,
    unit: 'Roll',
    minStock: 4, // LOW STOCK
    price: 95000,
    location: 'RAK-KRT-01',
    supplier: 'CV Elastik Makmur'
  },
  {
    id: 'ACC-HNG-007',
    name: 'Hangtag Tebal 310gsm + Tali Lock Pin',
    category: 'Label & Hangtag',
    stock: 850,
    unit: 'Pcs',
    minStock: 300,
    price: 500,
    location: 'LACI-HNG-02',
    supplier: 'Percetakan Label Prima'
  },
  {
    id: 'ACC-KMS-008',
    name: 'Plastik Opp Seal Bening 30 x 40 cm Sablon Logo',
    category: 'Kemasan & Penunjang',
    stock: 350,
    unit: 'Pcs',
    minStock: 500, // LOW STOCK
    price: 450,
    location: 'RAK-KMS-01',
    supplier: 'PT Anugerah Plastik'
  }
];

const isStockItem = (r: any): r is InventoryItem =>
  typeof r?.name === 'string' && r?.stock !== undefined && r?.stock !== null && !isNaN(Number(r.stock));

const isLowStock = (item: InventoryItem) =>
  item.minStock !== undefined && item.minStock !== null && !isNaN(Number(item.minStock)) &&
  Number(item.stock) <= Number(item.minStock);

const isOutOfStock = (item: InventoryItem) => Number(item.stock) <= 0;

const formatQty = (value: number | string | undefined | null) => Number(value).toLocaleString('id-ID');

export const RawMaterialModule: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'inventory' | 'opname' | 'fabric'>('inventory');
  const [records, setRecords] = useState<any[]>([]);
  const [opnameRecords, setOpnameRecords] = useState<StockOpnameRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [stockStatusFilter, setStockStatusFilter] = useState<'ALL' | 'LOW' | 'SAFE'>('ALL');

  // Modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isOpnameModalOpen, setIsOpnameModalOpen] = useState(false);
  const [isFabricModalOpen, setIsFabricModalOpen] = useState(false);

  // Selected for View / Edit / Opname
  const [detailStockId, setDetailStockId] = useState<string | null>(null);
  const [detailRollId, setDetailRollId] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);

  // Form State: Add/Edit Item
  const [itemForm, setItemForm] = useState<Partial<InventoryItem>>({
    id: '',
    name: '',
    category: 'Kancing & Resleting',
    stock: 10,
    unit: 'Pcs',
    minStock: 20,
    price: 15000,
    location: 'RAK-AKS-A1',
    supplier: ''
  });

  // Form State: Stock Opname
  const [opnameForm, setOpnameForm] = useState<{
    itemId: string;
    itemName: string;
    systemStock: number;
    physicalStock: number;
    unit: string;
    reason: string;
    auditor: string;
    opnameDate: string;
  }>({
    itemId: '',
    itemName: '',
    systemStock: 0,
    physicalStock: 0,
    unit: 'Pcs',
    reason: '',
    auditor: 'Staff Gudang Aksesoris',
    opnameDate: new Date().toISOString().split('T')[0]
  });

  // Form State: Fabric Roll
  const [rollForm, setRollForm] = useState<Partial<FabricRoll>>({
    fabricName: 'Cotton Combed 24s',
    color: 'Hitam Reaktif',
    rollNumber: 'ROLL-01',
    lengthMeters: 100,
    remainingMeters: 100,
    grammage: 180,
    widthCm: 180,
    defectCountPerRoll: 0,
    rackLocation: 'RAK-KAIN-A1',
    supplier: 'PT Toko Kain Mulia',
    status: 'Available'
  });

  const loadData = async () => {
    try {
      setLoading(true);
      const [matRes, opRes] = await Promise.all([
        fetchResource<any>('raw-materials'),
        fetchResource<StockOpnameRecord>('stock-opname')
      ]);

      // If database is completely fresh, seed with default accessories
      if (!matRes || matRes.length === 0) {
        setRecords(DEFAULT_ACCESSORIES);
        // Silently push seeds to server
        for (const item of DEFAULT_ACCESSORIES) {
          createResource('raw-materials', item).catch(() => {});
        }
      } else {
        setRecords(matRes);
      }

      setOpnameRecords(opRes || []);
    } catch (err) {
      console.error('Error loading raw material & opname data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const stockItems: InventoryItem[] = records.filter(isStockItem);
  const rollRecords: FabricRoll[] = records.filter(r => typeof r?.fabricName === 'string');

  // Low stock detection
  const lowStockItems = stockItems.filter(isLowStock);
  const outOfStockItems = stockItems.filter(isOutOfStock);

  // Filters for Accessories
  const filteredStockItems = newestFirst(stockItems.filter(item => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      String(item.name || '').toLowerCase().includes(q) ||
      String(item.category || '').toLowerCase().includes(q) ||
      String(item.location || '').toLowerCase().includes(q) ||
      String(item.id || '').toLowerCase().includes(q);

    const matchesCategory = categoryFilter === 'ALL' || item.category === categoryFilter;

    let matchesStatus = true;
    if (stockStatusFilter === 'LOW') {
      matchesStatus = isLowStock(item);
    } else if (stockStatusFilter === 'SAFE') {
      matchesStatus = !isLowStock(item);
    }

    return matchesSearch && matchesCategory && matchesStatus;
  }));

  // Filters for Fabric Rolls
  const filteredRolls = newestFirst(rollRecords.filter(r => {
    const q = searchQuery.toLowerCase();
    return (
      String(r.id || '').toLowerCase().includes(q) ||
      String(r.fabricName || '').toLowerCase().includes(q) ||
      String(r.color || '').toLowerCase().includes(q) ||
      String(r.rackLocation || '').toLowerCase().includes(q)
    );
  }));

  // Filters for Stock Opname Records
  const filteredOpnames = newestFirst(opnameRecords.filter(r => {
    const q = searchQuery.toLowerCase();
    return (
      String(r.id || '').toLowerCase().includes(q) ||
      String(r.itemName || '').toLowerCase().includes(q) ||
      String(r.auditor || '').toLowerCase().includes(q) ||
      String(r.reason || '').toLowerCase().includes(q)
    );
  }));

  // --- Handlers: Accessories CRUD ---
  const handleOpenAdd = () => {
    setItemForm({
      id: generateId('ACC'),
      name: '',
      category: 'Kancing & Resleting',
      stock: 50,
      unit: 'Pcs',
      minStock: 25,
      price: 1500,
      location: 'RAK-AKS-A1',
      supplier: ''
    });
    setIsAddModalOpen(true);
  };

  const handleOpenEdit = (item: InventoryItem) => {
    setSelectedItem(item);
    setItemForm({ ...item });
    setIsEditModalOpen(true);
  };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemForm.name?.trim()) {
      alert('Nama aksesoris wajib diisi.');
      return;
    }

    try {
      if (selectedItem) {
        await updateResource('raw-materials', selectedItem.id, {
          ...itemForm,
          timestamp: new Date().toISOString()
        });
      } else {
        await createResource('raw-materials', {
          ...itemForm,
          timestamp: new Date().toISOString()
        });
      }
      setIsAddModalOpen(false);
      setIsEditModalOpen(false);
      loadData();
    } catch (err) {
      alert('Gagal menyimpan data aksesoris.');
    }
  };

  const handleDeleteItem = async (id: string, name: string) => {
    if (window.confirm(`Hapus item aksesoris "${name}" (${id})?`)) {
      try {
        await deleteResource('raw-materials', id);
        loadData();
      } catch (err) {
        alert('Gagal menghapus item.');
      }
    }
  };

  // --- Handlers: Stock Opname ---
  const handleOpenOpname = (item?: InventoryItem) => {
    const targetItem = item || (stockItems.length > 0 ? stockItems[0] : null);
    if (!targetItem) {
      alert('Belum ada data aksesoris untuk di-opname.');
      return;
    }

    setOpnameForm({
      itemId: targetItem.id,
      itemName: targetItem.name,
      systemStock: Number(targetItem.stock) || 0,
      physicalStock: Number(targetItem.stock) || 0,
      unit: targetItem.unit || 'Pcs',
      reason: '',
      auditor: 'Staff Gudang Aksesoris',
      opnameDate: new Date().toISOString().split('T')[0]
    });
    setIsOpnameModalOpen(true);
  };

  const handleOpnameItemChange = (itemId: string) => {
    const item = stockItems.find(i => i.id === itemId);
    if (item) {
      setOpnameForm(prev => ({
        ...prev,
        itemId: item.id,
        itemName: item.name,
        systemStock: Number(item.stock) || 0,
        physicalStock: Number(item.stock) || 0,
        unit: item.unit || 'Pcs'
      }));
    }
  };

  const handleSaveOpname = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetItem = stockItems.find(i => i.id === opnameForm.itemId);
    if (!targetItem) {
      alert('Item aksesoris tidak valid.');
      return;
    }

    const difference = opnameForm.physicalStock - opnameForm.systemStock;
    if (difference !== 0 && !opnameForm.reason.trim()) {
      alert('Karena terdapat selisih stok fisik dan sistem, mohon isi alasan/keterangan selisih.');
      return;
    }

    try {
      const opnameRecord: StockOpnameRecord = {
        id: generateId('OPN'),
        itemId: targetItem.id,
        itemName: targetItem.name,
        category: targetItem.category,
        systemStock: opnameForm.systemStock,
        physicalStock: opnameForm.physicalStock,
        difference: difference,
        unit: opnameForm.unit,
        reason: opnameForm.reason || (difference === 0 ? 'Stok fisik sesuai' : 'Penyesuaian audit opname'),
        auditor: opnameForm.auditor,
        opnameDate: opnameForm.opnameDate,
        timestamp: new Date().toISOString()
      };

      // 1. Save Opname audit history
      await createResource('stock-opname', opnameRecord);

      // 2. Adjust item system stock to physical stock & update last opname info
      await updateResource('raw-materials', targetItem.id, {
        stock: Number(opnameForm.physicalStock),
        lastOpnameDate: opnameForm.opnameDate,
        lastOpnameNotes: opnameRecord.reason,
        timestamp: new Date().toISOString()
      });

      setIsOpnameModalOpen(false);
      alert(`Stock Opname "${targetItem.name}" berhasil dicatat!\nStok sistem disesuaikan menjadi ${opnameForm.physicalStock} ${opnameForm.unit} (Selisih: ${difference > 0 ? '+' : ''}${difference} ${opnameForm.unit}).`);
      loadData();
    } catch (err) {
      console.error(err);
      alert('Gagal menyimpan hasil stock opname.');
    }
  };

  // --- Handlers: Fabric Rolls ---
  const handleCreateRoll = async (e: React.FormEvent) => {
    e.preventDefault();
    const newRoll: FabricRoll = {
      id: generateId('LOT'),
      fabricName: rollForm.fabricName || 'Kain',
      color: rollForm.color || '-',
      rollNumber: rollForm.rollNumber || 'R-01',
      lengthMeters: Number(rollForm.lengthMeters) || 100,
      remainingMeters: Number(rollForm.lengthMeters) || 100,
      grammage: Number(rollForm.grammage) || 180,
      widthCm: Number(rollForm.widthCm) || 180,
      defectCountPerRoll: Number(rollForm.defectCountPerRoll) || 0,
      rackLocation: rollForm.rackLocation || 'RAK-A1',
      supplier: rollForm.supplier || '-',
      status: 'Available',
      receivedDate: new Date().toISOString().split('T')[0]
    };

    try {
      await createResource('raw-materials', newRoll);
      setIsFabricModalOpen(false);
      loadData();
    } catch (err) {
      alert('Gagal menyimpan roll kain.');
    }
  };

  // Export handlers
  const handleExportStock = () => {
    const rows = filteredStockItems.map(i => ({
      'Kode Item': i.id,
      'Nama Aksesoris': i.name,
      'Kategori': i.category || '-',
      'Stok Sekarang': i.stock,
      'Satuan': i.unit,
      'Stok Minimum': i.minStock,
      'Status Stok': isOutOfStock(i) ? 'Stok Habis' : (isLowStock(i) ? 'Stok Menipis' : 'Aman'),
      'Lokasi Rak': i.location || '-',
      'Harga Satuan': i.price || 0,
      'Pemasok': i.supplier || '-',
      'Opname Terakhir': i.lastOpnameDate ? formatDate(i.lastOpnameDate) : '-'
    }));
    exportTableToExcel(rows, 'Laporan_Stok_Aksesoris_HIJ');
  };

  const handleExportOpname = () => {
    const rows = filteredOpnames.map(o => ({
      'No. Opname': o.id,
      'Tanggal': formatDate(o.opnameDate),
      'Nama Aksesoris': o.itemName,
      'Stok Sistem': o.systemStock,
      'Stok Fisik': o.physicalStock,
      'Selisih': o.difference,
      'Satuan': o.unit,
      'Alasan': o.reason || '-',
      'Auditor': o.auditor
    }));
    exportTableToExcel(rows, 'Laporan_Riwayat_Stock_Opname_HIJ');
  };

  // Drawer Detail items
  const detailStock = detailStockId ? stockItems.find(i => i.id === detailStockId) ?? null : null;
  const detailRoll = detailRollId ? rollRecords.find(r => r.id === detailRollId) ?? null : null;
  const detailStockLow = detailStock ? isLowStock(detailStock) : false;
  const detailStockGap = detailStock ? Number(detailStock.stock) - Number(detailStock.minStock) : 0;

  // Calculated Opname Difference in Modal
  const calculatedDiff = opnameForm.physicalStock - opnameForm.systemStock;

  const labelClass = 'block text-sm font-medium text-slate-700 mb-1.5';
  const fieldClass = 'w-full h-10 px-3 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-600';
  const filterClass = 'h-10 w-full md:w-auto text-sm bg-white border border-slate-300 rounded-lg px-3 text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-600';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Gudang Aksesoris & Kain"
        description="Stok aksesoris, sisa roll kain proyek, dan riwayat stock opname fisik — lengkap dengan peringatan stok menipis."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={activeTab === 'opname' ? handleExportOpname : handleExportStock}
            >
              <Download size={16} aria-hidden="true" /> Unduh Excel
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleOpenOpname()}
              className="border-teal-600 text-teal-700 hover:bg-teal-50"
            >
              <ClipboardCheck size={16} aria-hidden="true" /> Stock Opname
            </Button>
            <Button size="sm" onClick={handleOpenAdd}>
              <Plus size={16} aria-hidden="true" /> Tambah Aksesoris
            </Button>
          </div>
        }
      />

      {/* LOW STOCK ALERT BANNER (CRITICAL NOTIFICATION) */}
      {lowStockItems.length > 0 && (
        <div
          className="p-4 bg-gradient-to-r from-rose-50 via-amber-50 to-rose-50 border-2 border-rose-300 rounded-xl shadow-sm space-y-3"
          role="alert"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-rose-100 text-brand-red rounded-lg shrink-0 mt-0.5">
                <AlertTriangle size={22} className="animate-pulse" aria-hidden="true" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <span>Pemberitahuan: {lowStockItems.length} Stok Aksesoris Menipis / Kritis!</span>
                  {outOfStockItems.length > 0 && (
                    <Badge variant="rose" className="font-semibold text-xs">
                      {outOfStockItems.length} Habis Total (0)
                    </Badge>
                  )}
                </h3>
                <p className="text-sm text-slate-600 mt-0.5">
                  Item aksesoris di bawah ini telah mencapai atau melewati batas stok minimum (safety stock). Segera lakukan re-stock atau pengadaan aksesoris.
                </p>
              </div>
            </div>

            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setActiveTab('inventory');
                setStockStatusFilter(stockStatusFilter === 'LOW' ? 'ALL' : 'LOW');
              }}
              className="shrink-0 text-xs h-8 border-rose-300 text-rose-700 hover:bg-rose-100"
            >
              {stockStatusFilter === 'LOW' ? 'Tampilkan Semua Stok' : 'Filter Stok Menipis'}
            </Button>
          </div>

          <div className="flex flex-wrap gap-2 pt-2 border-t border-rose-200/60">
            {lowStockItems.map(item => {
              const empty = isOutOfStock(item);
              return (
                <div
                  key={item.id}
                  onClick={() => {
                    setActiveTab('inventory');
                    setSearchQuery(item.name);
                  }}
                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors border ${
                    empty
                      ? 'bg-rose-100/90 text-rose-900 border-rose-300 hover:bg-rose-200'
                      : 'bg-amber-100/80 text-amber-900 border-amber-300 hover:bg-amber-200'
                  }`}
                  title="Klik untuk mencari item ini"
                >
                  <span className="font-bold">{item.name}</span>
                  <span className="font-mono bg-white/70 px-1.5 py-0.5 rounded text-slate-800">
                    Sisa: {formatQty(item.stock)} {item.unit} (Min: {formatQty(item.minStock)})
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Card className="p-4 flex items-center gap-3.5 min-w-0">
          <div className="hidden sm:flex w-10 h-10 rounded-lg bg-teal-50 text-teal-700 items-center justify-center shrink-0">
            <Boxes className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="text-sm text-slate-500">Total Aksesoris</div>
            <div className="text-base sm:text-lg font-bold text-slate-900 tabular-nums mt-0.5">
              {stockItems.length} Item
            </div>
            <div className="text-xs text-slate-500 mt-0.5">Tersedia di rak</div>
          </div>
        </Card>

        <Card className="p-4 flex items-center gap-3.5 min-w-0">
          <div className="hidden sm:flex w-10 h-10 rounded-lg bg-amber-50 text-amber-700 items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="text-sm text-slate-500">Stok Menipis</div>
            <div className="text-base sm:text-lg font-bold text-amber-700 tabular-nums mt-0.5">
              {lowStockItems.length} Item
            </div>
            <div className="text-xs text-slate-500 mt-0.5">&le; Stok minimum</div>
          </div>
        </Card>

        <Card className="p-4 flex items-center gap-3.5 min-w-0">
          <div className="hidden sm:flex w-10 h-10 rounded-lg bg-emerald-50 text-emerald-700 items-center justify-center shrink-0">
            <ClipboardCheck className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="text-sm text-slate-500">Riwayat Opname</div>
            <div className="text-base sm:text-lg font-bold text-emerald-800 tabular-nums mt-0.5">
              {opnameRecords.length} Audit
            </div>
            <div className="text-xs text-slate-500 mt-0.5">Pemeriksaan fisik</div>
          </div>
        </Card>

        <Card className="p-4 flex items-center gap-3.5 min-w-0">
          <div className="hidden sm:flex w-10 h-10 rounded-lg bg-blue-50 text-blue-700 items-center justify-center shrink-0">
            <Layers className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="text-sm text-slate-500">Roll Kain Proyek</div>
            <div className="text-base sm:text-lg font-bold text-blue-900 tabular-nums mt-0.5">
              {rollRecords.length} Lot Kain
            </div>
            <div className="text-xs text-slate-500 mt-0.5">Tersimpan di gudang</div>
          </div>
        </Card>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-slate-200 gap-6">
        <button
          onClick={() => setActiveTab('inventory')}
          className={`pb-3 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'inventory'
              ? 'border-teal-600 text-teal-700'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Boxes size={18} />
          <span>Stok Aksesoris ({stockItems.length})</span>
          {lowStockItems.length > 0 && (
            <span className="px-1.5 py-0.5 text-xs bg-rose-100 text-brand-red rounded-full font-bold">
              {lowStockItems.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('opname')}
          className={`pb-3 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'opname'
              ? 'border-teal-600 text-teal-700'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <History size={18} />
          <span>Riwayat Stock Opname ({opnameRecords.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('fabric')}
          className={`pb-3 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'fabric'
              ? 'border-teal-600 text-teal-700'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Layers size={18} />
          <span>Sisa Roll Kain Proyek ({rollRecords.length})</span>
        </button>
      </div>

      {/* TAB 1: ACCESSORIES INVENTORY */}
      {activeTab === 'inventory' && (
        <div className="space-y-4">
          {/* Search and Filters */}
          <Card className="p-4 flex flex-col md:flex-row gap-3 md:items-center justify-between">
            <div className="relative w-full md:w-80">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <Input
                type="search"
                aria-label="Cari aksesoris"
                placeholder="Cari aksesoris, kode, atau rak…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full md:w-auto">
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                aria-label="Filter kategori"
                className={filterClass}
              >
                <option value="ALL">Semua Kategori Aksesoris</option>
                {ACCESSORY_CATEGORIES.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>

              <select
                value={stockStatusFilter}
                onChange={(e) => setStockStatusFilter(e.target.value as any)}
                aria-label="Filter status stok"
                className={filterClass}
              >
                <option value="ALL">Semua Kondisi Stok</option>
                <option value="LOW">⚠️ Stok Menipis / Kritis</option>
                <option value="SAFE">✅ Stok Aman</option>
              </select>
            </div>
          </Card>

          {/* Table of Accessories */}
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="cell-sticky-start">ID</TableHead>
                  <TableHead>Aksesoris</TableHead>
                  <TableHead className="hidden md:table-cell">Kategori</TableHead>
                  <TableHead className="hidden lg:table-cell">Lokasi Rak</TableHead>
                  <TableHead className="text-right">Stok Fisik</TableHead>
                  <TableHead className="hidden sm:table-cell text-right">Min. Stok</TableHead>
                  <TableHead className="text-center">Status Stok</TableHead>
                  <TableHead className="hidden xl:table-cell">Opname Terakhir</TableHead>
                  <TableHead className="cell-sticky-end text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableSkeletonRows columns={9} rows={4} />
                ) : filteredStockItems.length === 0 ? (
                  <TableEmptyRow
                    colSpan={9}
                    icon={<Package size={20} />}
                    title={searchQuery || categoryFilter !== 'ALL' || stockStatusFilter !== 'ALL' ? 'Tidak ada aksesoris yang cocok' : 'Belum ada data stok aksesoris'}
                    description="Tambahkan item aksesoris baru dengan tombol di atas."
                  />
                ) : (
                  filteredStockItems.map(item => {
                    const low = isLowStock(item);
                    const empty = isOutOfStock(item);
                    return (
                      <TableRow key={item.id} className={empty ? 'bg-rose-50/60' : (low ? 'bg-amber-50/40' : undefined)}>
                        <TableCell className="cell-sticky-start whitespace-nowrap font-mono font-bold text-slate-900">
                          {item.id}
                        </TableCell>

                        <TableCell>
                          <div className="font-semibold text-slate-900 break-words">{item.name}</div>
                          <div className="mt-1.5 sm:hidden">
                            {empty ? (
                              <Badge variant="rose">Stok Habis</Badge>
                            ) : low ? (
                              <Badge variant="amber">Stok Menipis</Badge>
                            ) : (
                              <Badge variant="emerald">Stok Aman</Badge>
                            )}
                          </div>
                        </TableCell>

                        <TableCell className="hidden md:table-cell text-xs font-medium text-slate-700">
                          <span className="px-2 py-0.5 bg-slate-100 rounded-md">
                            {item.category || '-'}
                          </span>
                        </TableCell>

                        <TableCell className="hidden lg:table-cell text-xs font-mono text-slate-600">
                          {item.location || '-'}
                        </TableCell>

                        <TableCell className="text-right whitespace-nowrap">
                          <span className={`font-bold text-sm ${empty ? 'text-brand-red' : (low ? 'text-amber-700' : 'text-slate-900')}`}>
                            {formatQty(item.stock)} {item.unit}
                          </span>
                        </TableCell>

                        <TableCell className="hidden sm:table-cell text-right whitespace-nowrap text-xs text-slate-600">
                          {formatQty(item.minStock)} {item.unit}
                        </TableCell>

                        <TableCell className="text-center whitespace-nowrap">
                          {empty ? (
                            <Badge variant="rose">Stok Habis (0)</Badge>
                          ) : low ? (
                            <Badge variant="amber">Stok Menipis</Badge>
                          ) : (
                            <Badge variant="emerald">Aman</Badge>
                          )}
                        </TableCell>

                        <TableCell className="hidden xl:table-cell whitespace-nowrap text-xs text-slate-500">
                          {item.lastOpnameDate ? formatDate(item.lastOpnameDate) : 'Belum pernah'}
                        </TableCell>

                        <TableCell className="cell-sticky-end text-right">
                          <TableRowActions>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleOpenOpname(item)}
                              aria-label={`Stock Opname ${item.name}`}
                              title="Lakukan Stock Opname Fisik"
                              className="h-8 min-w-8 px-2.5 text-xs text-teal-700 hover:bg-teal-50 border-teal-300"
                            >
                              <ClipboardCheck size={14} aria-hidden="true" />
                              <span className="hidden sm:inline">Opname</span>
                            </Button>
                            <RowDetailButton label={item.name} onClick={() => setDetailStockId(item.id)} />
                          </TableRowActions>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}

      {/* TAB 2: RIWAYAT STOCK OPNAME */}
      {activeTab === 'opname' && (
        <div className="space-y-4">
          <Card className="p-4 flex flex-col md:flex-row gap-3 md:items-center justify-between">
            <div className="relative w-full md:w-80">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <Input
                type="search"
                aria-label="Cari riwayat opname"
                placeholder="Cari item, auditor, atau alasan opname…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            <Button
              size="sm"
              onClick={() => handleOpenOpname()}
              className="w-full md:w-auto"
            >
              <ClipboardCheck size={16} aria-hidden="true" /> Mulai Stock Opname Baru
            </Button>
          </Card>

          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="cell-sticky-start">No. Opname</TableHead>
                  <TableHead>Tanggal</TableHead>
                  <TableHead>Nama Aksesoris</TableHead>
                  <TableHead className="text-right">Stok Sistem</TableHead>
                  <TableHead className="text-right">Stok Fisik</TableHead>
                  <TableHead className="text-center">Selisih</TableHead>
                  <TableHead className="hidden md:table-cell">Alasan / Keterangan</TableHead>
                  <TableHead className="hidden lg:table-cell">Auditor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableSkeletonRows columns={8} rows={3} />
                ) : filteredOpnames.length === 0 ? (
                  <TableEmptyRow
                    colSpan={8}
                    icon={<History size={20} />}
                    title="Belum ada riwayat stock opname"
                    description="Catatan hasil opname fisik akan tersimpan otomatis di sini."
                  />
                ) : (
                  filteredOpnames.map(op => {
                    const isMinus = op.difference < 0;
                    const isPlus = op.difference > 0;
                    const isZero = op.difference === 0;
                    return (
                      <TableRow key={op.id}>
                        <TableCell className="cell-sticky-start whitespace-nowrap font-mono font-bold text-slate-900">
                          {op.id}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-slate-600">
                          {formatDate(op.opnameDate)}
                        </TableCell>
                        <TableCell className="font-semibold text-slate-900">
                          {op.itemName}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap text-slate-600 font-mono">
                          {formatQty(op.systemStock)} {op.unit}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap font-bold text-slate-900 font-mono">
                          {formatQty(op.physicalStock)} {op.unit}
                        </TableCell>
                        <TableCell className="text-center whitespace-nowrap">
                          {isZero ? (
                            <Badge variant="emerald">Sesuai (0)</Badge>
                          ) : isMinus ? (
                            <Badge variant="rose">Kurang ({op.difference} {op.unit})</Badge>
                          ) : (
                            <Badge variant="blue">Lebih (+{op.difference} {op.unit})</Badge>
                          )}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-xs text-slate-700">
                          {op.reason || '-'}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell text-xs text-slate-600 font-medium">
                          {op.auditor}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}

      {/* TAB 3: FABRIC ROLLS (PROYEK) */}
      {activeTab === 'fabric' && (
        <div className="space-y-4">
          <Card className="p-4 flex flex-col md:flex-row gap-3 md:items-center justify-between">
            <div className="relative w-full md:w-80">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <Input
                type="search"
                aria-label="Cari roll kain"
                placeholder="Cari kain, lot, atau warna…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            <Button size="sm" onClick={() => setIsFabricModalOpen(true)}>
              <Plus size={16} aria-hidden="true" /> Tambah Lot Kain
            </Button>
          </Card>

          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="cell-sticky-start">ID Lot</TableHead>
                  <TableHead>No. Roll</TableHead>
                  <TableHead className="hidden md:table-cell">Jenis Kain</TableHead>
                  <TableHead className="hidden md:table-cell">Warna</TableHead>
                  <TableHead className="text-right">Sisa (m)</TableHead>
                  <TableHead className="hidden md:table-cell text-right">Total (m)</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="cell-sticky-end text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableSkeletonRows columns={8} rows={3} />
                ) : filteredRolls.length === 0 ? (
                  <TableEmptyRow
                    colSpan={8}
                    icon={<Layers size={20} />}
                    title="Belum ada data lot kain proyek"
                    description="Kain yang masuk dari pembelian proyek dapat dicatat di sini."
                  />
                ) : (
                  filteredRolls.map(roll => (
                    <TableRow key={roll.id}>
                      <TableCell className="cell-sticky-start whitespace-nowrap font-mono font-bold text-slate-900">
                        {roll.id}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-slate-600">
                        Roll {roll.rollNumber}
                      </TableCell>
                      <TableCell className="hidden md:table-cell font-semibold text-slate-900">
                        {roll.fabricName}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-slate-700">
                        {roll.color}
                      </TableCell>
                      <TableCell className="text-right font-bold text-slate-900 whitespace-nowrap">
                        {roll.remainingMeters} m
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-right whitespace-nowrap text-slate-600">
                        {roll.lengthMeters} m
                      </TableCell>
                      <TableCell className="text-center whitespace-nowrap">
                        <StatusBadge status={roll.status} />
                      </TableCell>
                      <TableCell className="cell-sticky-end text-right">
                        <TableRowActions>
                          <RowDetailButton label={roll.id} onClick={() => setDetailRollId(roll.id)} />
                        </TableRowActions>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}

      {/* ACCESSORY DETAIL DRAWER */}
      <DetailDrawer
        isOpen={!!detailStock}
        onClose={() => setDetailStockId(null)}
        title={detailStock?.name}
        subtitle={detailStock && <span className="font-mono">{detailStock.id}</span>}
        status={
          detailStock && (
            isOutOfStock(detailStock) ? (
              <Badge variant="rose">Stok Habis (0)</Badge>
            ) : detailStockLow ? (
              <Badge variant="amber">Stok Menipis</Badge>
            ) : (
              <Badge variant="emerald">Stok Aman</Badge>
            )
          )
        }
        footer={
          detailStock && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDetailStockId(null);
                  handleOpenOpname(detailStock);
                }}
                className="text-teal-700 border-teal-300 hover:bg-teal-50"
              >
                <ClipboardCheck size={16} aria-hidden="true" /> Opname
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDetailStockId(null);
                  handleOpenEdit(detailStock);
                }}
              >
                <Pencil size={16} aria-hidden="true" /> Ubah
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDetailStockId(null);
                  handleDeleteItem(detailStock.id, detailStock.name);
                }}
                className="text-brand-red hover:bg-rose-50 border-rose-200"
              >
                <Trash2 size={16} aria-hidden="true" /> Hapus
              </Button>
            </>
          )
        }
      >
        {detailStock && (
          <>
            <DetailStats
              items={[
                {
                  label: 'Stok Fisik Tersedia',
                  value: `${formatQty(detailStock.stock)} ${detailStock.unit}`,
                  tone: detailStockLow ? 'danger' : 'accent'
                },
                {
                  label: 'Batas Minimum',
                  value: `${formatQty(detailStock.minStock)} ${detailStock.unit}`
                },
                {
                  label: 'Selisih Safety Stock',
                  value: `${detailStockGap > 0 ? '+' : ''}${formatQty(detailStockGap)} ${detailStock.unit}`,
                  tone: detailStockLow ? 'danger' : 'default'
                }
              ]}
            />

            {detailStockLow && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2 text-xs text-brand-red font-medium">
                <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                <span>
                  Perhatian: Stok item ini berada di bawah batas safety stock ({detailStock.minStock} {detailStock.unit}). Segera jadwalkan pengadaan aksesoris.
                </span>
              </div>
            )}

            <DetailSection title="Informasi Aksesoris">
              <DetailField label="Nama Item" full>{detailStock.name}</DetailField>
              <DetailField label="Kategori">{detailStock.category}</DetailField>
              <DetailField label="Satuan">{detailStock.unit}</DetailField>
              <DetailField label="Lokasi Rak / Laci" mono>{detailStock.location || '-'}</DetailField>
              <DetailField label="Harga Satuan">
                {detailStock.price ? formatCurrency(detailStock.price) : '-'}
              </DetailField>
              <DetailField label="Pemasok">{detailStock.supplier || '-'}</DetailField>
            </DetailSection>

            <DetailSection title="Status Stock Opname">
              <DetailField label="Tanggal Opname Terakhir">
                {detailStock.lastOpnameDate ? formatDate(detailStock.lastOpnameDate) : 'Belum pernah di-opname'}
              </DetailField>
              {detailStock.lastOpnameNotes && (
                <DetailField label="Catatan Opname Terakhir" full>{detailStock.lastOpnameNotes}</DetailField>
              )}
            </DetailSection>
          </>
        )}
      </DetailDrawer>

      {/* FABRIC ROLL DETAIL DRAWER */}
      <DetailDrawer
        isOpen={!!detailRoll}
        onClose={() => setDetailRollId(null)}
        title={detailRoll?.fabricName}
        subtitle={detailRoll && <span className="font-mono">{detailRoll.id} · Roll {detailRoll.rollNumber}</span>}
        status={detailRoll && <StatusBadge status={detailRoll.status} />}
      >
        {detailRoll && (
          <>
            <DetailStats
              items={[
                { label: 'Sisa stok', value: `${detailRoll.remainingMeters} m`, tone: 'accent' },
                { label: 'Panjang awal', value: `${detailRoll.lengthMeters} m` },
                {
                  label: 'Titik cacat',
                  value: detailRoll.defectCountPerRoll === 0 ? 'Tidak ada' : `${detailRoll.defectCountPerRoll} titik`,
                  tone: detailRoll.defectCountPerRoll > 0 ? 'danger' : 'default'
                }
              ]}
            />
            <DetailSection title="Kain">
              <DetailField label="Jenis kain">{detailRoll.fabricName}</DetailField>
              <DetailField label="Warna">{detailRoll.color}</DetailField>
              <DetailField label="Lokasi rak" mono>{detailRoll.rackLocation}</DetailField>
              <DetailField label="Pemasok">{detailRoll.supplier}</DetailField>
            </DetailSection>
          </>
        )}
      </DetailDrawer>

      {/* MODAL: ADD / EDIT ACCESSORY */}
      <Modal
        isOpen={isAddModalOpen || isEditModalOpen}
        onClose={() => {
          setIsAddModalOpen(false);
          setIsEditModalOpen(false);
        }}
        title={isEditModalOpen ? `Ubah Aksesoris ${itemForm.id}` : 'Tambah Aksesoris Baru'}
        maxWidth="lg"
      >
        <form onSubmit={handleSaveItem} className="space-y-4">
          <div>
            <label htmlFor="acc-name" className={labelClass}>Nama Aksesoris *</label>
            <input
              id="acc-name"
              type="text"
              required
              placeholder="Contoh: Kancing Kemeja 4 Lubang Putih 18L"
              value={itemForm.name}
              onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })}
              className={fieldClass}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="acc-category" className={labelClass}>Kategori Aksesoris *</label>
              <select
                id="acc-category"
                value={itemForm.category}
                onChange={(e) => setItemForm({ ...itemForm, category: e.target.value as any })}
                className={fieldClass}
                required
              >
                {ACCESSORY_CATEGORIES.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="acc-unit" className={labelClass}>Satuan *</label>
              <select
                id="acc-unit"
                value={itemForm.unit}
                onChange={(e) => setItemForm({ ...itemForm, unit: e.target.value })}
                className={fieldClass}
                required
              >
                <option value="Pcs">Pcs</option>
                <option value="Gross">Gross (144 Pcs)</option>
                <option value="Lusin">Lusin (12 Pcs)</option>
                <option value="Roll">Roll</option>
                <option value="Meter">Meter</option>
                <option value="Cones">Cones</option>
                <option value="Pack">Pack</option>
                <option value="Set">Set</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="acc-stock" className={labelClass}>Stok Fisik Tersedia *</label>
              <input
                id="acc-stock"
                type="number"
                min={0}
                step="any"
                required
                value={itemForm.stock}
                onChange={(e) => setItemForm({ ...itemForm, stock: parseFloat(e.target.value) || 0 })}
                className={`${fieldClass} font-semibold text-slate-900`}
              />
            </div>

            <div>
              <label htmlFor="acc-min-stock" className={labelClass}>
                Stok Minimum (Alert Peringatan) *
              </label>
              <input
                id="acc-min-stock"
                type="number"
                min={0}
                step="any"
                required
                value={itemForm.minStock}
                onChange={(e) => setItemForm({ ...itemForm, minStock: parseFloat(e.target.value) || 0 })}
                className={`${fieldClass} font-semibold text-amber-700`}
              />
              <p className="text-xs text-slate-500 mt-1">Jika stok &le; angka ini, notifikasi stok menipis akan berbunyi/muncul.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="acc-price" className={labelClass}>Harga Satuan (Rp)</label>
              <input
                id="acc-price"
                type="number"
                min={0}
                value={itemForm.price}
                onChange={(e) => setItemForm({ ...itemForm, price: parseFloat(e.target.value) || 0 })}
                className={fieldClass}
              />
            </div>

            <div>
              <label htmlFor="acc-loc" className={labelClass}>Lokasi Rak / Laci</label>
              <input
                id="acc-loc"
                type="text"
                placeholder="Contoh: RAK-AKS-A1"
                value={itemForm.location}
                onChange={(e) => setItemForm({ ...itemForm, location: e.target.value })}
                className={`${fieldClass} font-mono`}
              />
            </div>
          </div>

          <div>
            <label htmlFor="acc-supplier" className={labelClass}>Pemasok / Toko Pembelian</label>
            <input
              id="acc-supplier"
              type="text"
              placeholder="Contoh: Toko Kancing Jaya Bandung"
              value={itemForm.supplier}
              onChange={(e) => setItemForm({ ...itemForm, supplier: e.target.value })}
              className={fieldClass}
            />
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setIsAddModalOpen(false);
                setIsEditModalOpen(false);
              }}
            >
              Batal
            </Button>
            <Button type="submit">
              {isEditModalOpen ? 'Simpan Perubahan' : 'Tambah Aksesoris'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* MODAL: STOCK OPNAME (HITUNG FISIK VS SISTEM) */}
      <Modal
        isOpen={isOpnameModalOpen}
        onClose={() => setIsOpnameModalOpen(false)}
        title="Stock Opname Fisik Aksesoris"
        maxWidth="lg"
      >
        <form onSubmit={handleSaveOpname} className="space-y-4">
          <div className="p-3 bg-teal-50 border border-teal-200 rounded-xl text-xs text-teal-900">
            <p className="font-semibold flex items-center gap-1.5">
              <ClipboardCheck size={16} className="text-teal-700" />
              <span>SOP-05: Prosedur Audit Stock Opname Fisik</span>
            </p>
            <p className="mt-1 text-teal-800">
              Hitung jumlah fisik barang yang ada di rak/laci secara teliti. Sistem akan mencatat selisih dan otomatis menyinkronkan stok gudang ke hitungan riil.
            </p>
          </div>

          <div>
            <label htmlFor="opname-item-select" className={labelClass}>Pilih Aksesoris yang Di-Opname *</label>
            <select
              id="opname-item-select"
              required
              value={opnameForm.itemId}
              onChange={(e) => handleOpnameItemChange(e.target.value)}
              className="w-full h-11 px-3 text-sm font-bold border-2 border-teal-600 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              {stockItems.map(i => (
                <option key={i.id} value={i.id}>
                  {i.name} (Stok Sistem: {formatQty(i.stock)} {i.unit}) - {i.location || 'Tanpa Rak'}
                </option>
              ))}
            </select>
          </div>

          {/* Side by side System vs Physical count */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-slate-50 border border-slate-200 rounded-xl">
            <div className="p-3 bg-white border border-slate-200 rounded-lg">
              <span className="text-xs text-slate-500 block font-medium">Stok Sistem Saat Ini:</span>
              <div className="text-xl font-mono font-bold text-slate-700 mt-1">
                {formatQty(opnameForm.systemStock)} <span className="text-sm font-normal">{opnameForm.unit}</span>
              </div>
              <span className="text-[11px] text-slate-400 block mt-1">Tercatat di pembukuan</span>
            </div>

            <div className="p-3 bg-teal-50/70 border-2 border-teal-500 rounded-lg">
              <label htmlFor="opname-physical" className="text-xs text-teal-900 block font-bold">
                Hitungan Fisik Riil Gudang *
              </label>
              <div className="flex items-center gap-2 mt-1">
                <input
                  id="opname-physical"
                  type="number"
                  step="any"
                  min={0}
                  required
                  value={opnameForm.physicalStock}
                  onChange={(e) => setOpnameForm({ ...opnameForm, physicalStock: parseFloat(e.target.value) || 0 })}
                  className="w-full h-10 px-3 text-lg font-mono font-bold text-slate-900 bg-white border border-teal-400 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
                <span className="text-sm font-bold text-teal-800">{opnameForm.unit}</span>
              </div>
              <span className="text-[11px] text-teal-700 block mt-1">Kuantitas hasil hitung manual</span>
            </div>
          </div>

          {/* Real-time Difference Calculation */}
          <div className={`p-4 rounded-xl border flex items-center justify-between ${
            calculatedDiff === 0
              ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
              : calculatedDiff < 0
              ? 'bg-rose-50 border-rose-300 text-rose-900'
              : 'bg-blue-50 border-blue-300 text-blue-900'
          }`}>
            <div>
              <span className="text-xs font-semibold block uppercase tracking-wider">
                {calculatedDiff === 0 ? 'Status Hasil Opname' : (calculatedDiff < 0 ? 'Selisih Kurang (Loss / Hilang / Rusak)' : 'Selisih Lebih (Surplus)')}
              </span>
              <span className="text-lg font-bold">
                {calculatedDiff === 0 ? (
                  'Stok Cocok 100% (Tidak ada selisih)'
                ) : (
                  `${calculatedDiff > 0 ? '+' : ''}${calculatedDiff} ${opnameForm.unit}`
                )}
              </span>
            </div>
            {calculatedDiff === 0 ? (
              <CheckCircle2 size={28} className="text-emerald-600" />
            ) : calculatedDiff < 0 ? (
              <TrendingDown size={28} className="text-brand-red" />
            ) : (
              <AlertCircle size={28} className="text-blue-600" />
            )}
          </div>

          <div>
            <label htmlFor="opname-reason" className={labelClass}>
              Alasan / Keterangan Penyesuaian {calculatedDiff !== 0 && '*'}
            </label>
            <input
              id="opname-reason"
              type="text"
              required={calculatedDiff !== 0}
              placeholder={calculatedDiff === 0 ? 'Contoh: Hitungan fisik berkala cocok' : 'Contoh: Rusak saat proses penjahitan / Salah hitung penerimaan sebelumnya'}
              value={opnameForm.reason}
              onChange={(e) => setOpnameForm({ ...opnameForm, reason: e.target.value })}
              className={fieldClass}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="opname-auditor" className={labelClass}>Petugas Auditor *</label>
              <input
                id="opname-auditor"
                type="text"
                required
                value={opnameForm.auditor}
                onChange={(e) => setOpnameForm({ ...opnameForm, auditor: e.target.value })}
                className={fieldClass}
              />
            </div>

            <div>
              <label htmlFor="opname-date" className={labelClass}>Tanggal Pelaksanaan Opname *</label>
              <input
                id="opname-date"
                type="date"
                required
                value={opnameForm.opnameDate}
                onChange={(e) => setOpnameForm({ ...opnameForm, opnameDate: e.target.value })}
                className={fieldClass}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsOpnameModalOpen(false)}
            >
              Batal
            </Button>
            <Button type="submit">
              Simpan Hasil Opname & Sesuaikan Stok
            </Button>
          </div>
        </form>
      </Modal>

      {/* MODAL: ADD FABRIC ROLL */}
      <Modal
        isOpen={isFabricModalOpen}
        onClose={() => setIsFabricModalOpen(false)}
        title="Tambah Lot Roll Kain Proyek"
      >
        <form onSubmit={handleCreateRoll} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="rm-fabric" className={labelClass}>Nama Kain</label>
              <input
                id="rm-fabric"
                type="text"
                required
                value={rollForm.fabricName}
                onChange={(e) => setRollForm({ ...rollForm, fabricName: e.target.value })}
                className={fieldClass}
              />
            </div>
            <div>
              <label htmlFor="rm-color" className={labelClass}>Warna</label>
              <input
                id="rm-color"
                type="text"
                required
                value={rollForm.color}
                onChange={(e) => setRollForm({ ...rollForm, color: e.target.value })}
                className={fieldClass}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="rm-length" className={labelClass}>Panjang (m)</label>
              <input
                id="rm-length"
                type="number"
                value={rollForm.lengthMeters}
                onChange={(e) => setRollForm({ ...rollForm, lengthMeters: Number(e.target.value) })}
                className={fieldClass}
              />
            </div>
            <div>
              <label htmlFor="rm-rack" className={labelClass}>Lokasi Rak</label>
              <input
                id="rm-rack"
                type="text"
                value={rollForm.rackLocation}
                onChange={(e) => setRollForm({ ...rollForm, rackLocation: e.target.value })}
                className={fieldClass}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsFabricModalOpen(false)}
            >
              Batal
            </Button>
            <Button type="submit">
              Simpan Lot Kain
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
