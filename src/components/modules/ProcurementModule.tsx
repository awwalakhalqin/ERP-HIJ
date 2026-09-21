import React, { useState, useEffect } from 'react';
import {
  Plus,
  Search,
  ShoppingBag,
  Download,
  Pencil,
  Trash2,
  Phone,
  Clock,
  Truck,
  PackageCheck,
  FolderKanban,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { Procurement, Order } from '../../types';
import { fetchResource, createResource, updateResource, deleteResource } from '../../services/api';
import { formatCurrency, formatDate, formatDateTime, generateId, exportTableToExcel, statusLabel } from '../../lib/utils';
import { Badge, StatusBadge } from '../ui/Badge';
import { Modal } from '../ui/Modal';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { PageHeader } from '../ui/PageHeader';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell, TableRowActions, TableEmptyRow, TableSkeletonRows } from '../ui/Table';
import { DetailDrawer, DetailSection, DetailField, DetailStats, RowDetailButton } from '../ui/DetailDrawer';
import { newestFirst } from '../../lib/ordering';

const CATEGORIES = [
  'Kain Utama',
  'Furing',
  'Kain Kombinasi',
  'Rib / Kerah',
  'Sablon/Bordir Khusus',
  'Aksesoris Khusus'
] as const;

export const ProcurementModule: React.FC = () => {
  const [items, setItems] = useState<Procurement[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [projectFilter, setProjectFilter] = useState('ALL');
  const [detailId, setDetailId] = useState<string | null>(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedItem, setSelectedItem] = useState<Procurement | null>(null);

  // Form State
  const [formData, setFormData] = useState<Partial<Procurement>>({
    id: '',
    itemName: '',
    supplierName: '',
    supplierContact: '',
    intendedFor: '',
    orderId: '',
    projectName: '',
    customerName: '',
    quantity: 1,
    unit: 'Kg',
    unitPrice: 0,
    totalPrice: 0,
    purchaseDate: new Date().toISOString().split('T')[0],
    estimatedDelivery: '',
    category: 'Kain Utama',
    status: 'Requested',
    notes: ''
  });

  const loadData = async () => {
    try {
      setLoading(true);
      const [procRes, orderRes] = await Promise.all([
        fetchResource<Procurement>('procurements'),
        fetchResource<Order>('orders')
      ]);
      setItems(procRes || []);
      setOrders(orderRes || []);
    } catch (err) {
      console.error('Failed loading procurement data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleOpenAdd = () => {
    setIsEditMode(false);
    setSelectedItem(null);

    // Default to first active order if available
    const firstOrder = orders.find(o => o.status !== 'Completed' && o.status !== 'Cancelled') || orders[0];
    const defaultIntended = firstOrder ? firstOrder.id : '';
    const defaultItemName = firstOrder?.material
      ? `${firstOrder.material}${firstOrder.color ? ' ' + firstOrder.color : ''}`
      : '';

    setFormData({
      id: generateId('PO'),
      itemName: defaultItemName,
      supplierName: '',
      supplierContact: '',
      intendedFor: defaultIntended,
      orderId: defaultIntended,
      customerName: firstOrder?.customerName || '',
      projectName: firstOrder ? `${firstOrder.productType} - ${firstOrder.customerName}` : '',
      quantity: 25,
      unit: 'Kg',
      unitPrice: 85000,
      totalPrice: 25 * 85000,
      purchaseDate: new Date().toISOString().split('T')[0],
      estimatedDelivery: new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0],
      category: 'Kain Utama',
      status: 'Requested',
      notes: ''
    });
    setIsModalOpen(true);
  };

  const handleOpenEdit = (item: Procurement) => {
    setIsEditMode(true);
    setSelectedItem(item);
    setFormData({ ...item });
    setIsModalOpen(true);
  };

  const handleOrderSelect = (orderId: string) => {
    const selectedOrder = orders.find(o => o.id === orderId);
    setFormData(prev => {
      const autoItemName = (!prev.itemName || prev.itemName === '') && selectedOrder?.material
        ? `${selectedOrder.material}${selectedOrder.color ? ' ' + selectedOrder.color : ''}`
        : prev.itemName;

      return {
        ...prev,
        intendedFor: orderId,
        orderId: orderId,
        customerName: selectedOrder?.customerName || '',
        projectName: selectedOrder ? `${selectedOrder.productType} - ${selectedOrder.customerName}` : '',
        itemName: autoItemName
      };
    });
  };

  const handleQtyPriceChange = (qty: number, price: number) => {
    setFormData(prev => ({
      ...prev,
      quantity: qty,
      unitPrice: price,
      totalPrice: Math.round(qty * price)
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.intendedFor) {
      alert('Harap pilih Proyek / Pesanan tujuan. Pengadaan bahan wajib terikat ke kebutuhan proyek.');
      return;
    }
    if (!formData.itemName?.trim()) {
      alert('Nama barang / spesifikasi bahan wajib diisi.');
      return;
    }

    try {
      const payload: Partial<Procurement> = {
        ...formData,
        orderId: formData.intendedFor,
        timestamp: formData.timestamp || new Date().toISOString()
      };

      if (isEditMode && selectedItem) {
        await updateResource('procurements', selectedItem.id, payload);
      } else {
        await createResource('procurements', payload);
      }
      setIsModalOpen(false);
      loadData();
    } catch (err) {
      console.error('Save procurement error:', err);
      alert('Gagal menyimpan PO. Coba lagi.');
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm(`Hapus PO ${id}?`)) {
      try {
        await deleteResource('procurements', id);
        loadData();
      } catch (err) {
        console.error('Delete error:', err);
      }
    }
  };

  const handleQuickStatusChange = async (item: Procurement, nextStatus: Procurement['status']) => {
    try {
      await updateResource('procurements', item.id, { ...item, status: nextStatus });
      loadData();
    } catch (err) {
      console.error('Status update failed:', err);
    }
  };

  const filteredItems = newestFirst(items.filter(item => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      (item.itemName || '').toLowerCase().includes(q) ||
      (item.supplierName || '').toLowerCase().includes(q) ||
      (item.id || '').toLowerCase().includes(q) ||
      (item.intendedFor || '').toLowerCase().includes(q) ||
      (item.customerName || '').toLowerCase().includes(q) ||
      (item.projectName || '').toLowerCase().includes(q);

    const matchesStatus = statusFilter === 'ALL' || item.status === statusFilter;
    const matchesCategory = categoryFilter === 'ALL' || item.category === categoryFilter;
    const matchesProject = projectFilter === 'ALL' || item.intendedFor === projectFilter || item.orderId === projectFilter;

    return matchesSearch && matchesStatus && matchesCategory && matchesProject;
  }));

  const isFiltered = searchQuery !== '' || statusFilter !== 'ALL' || categoryFilter !== 'ALL' || projectFilter !== 'ALL';

  const handleExport = () => {
    const rows = filteredItems.map(item => {
      const linkedOrder = orders.find(o => o.id === item.intendedFor || o.id === item.orderId);
      return {
        'No. PO': item.id,
        'Proyek / Pesanan': item.intendedFor || item.orderId || '-',
        'Pelanggan': linkedOrder?.customerName || item.customerName || '-',
        'Produk Proyek': linkedOrder?.productType || item.projectName || '-',
        'Tanggal Beli': formatDate(item.purchaseDate),
        'Estimasi Tiba': item.estimatedDelivery ? formatDate(item.estimatedDelivery) : '-',
        'Barang / Bahan': item.itemName,
        'Kategori': item.category || '-',
        'Pemasok': item.supplierName || '-',
        'Kontak Pemasok': item.supplierContact || '-',
        'Jumlah': Number(item.quantity) || 0,
        'Satuan': item.unit,
        'Harga Satuan': Number(item.unitPrice) || 0,
        'Total': Number(item.totalPrice) || 0,
        'Status': statusLabel(item.status),
        'Catatan': item.notes || '',
        'Dicatat Oleh': item.user || '',
        'Dicatat Pada': item.timestamp ? formatDateTime(item.timestamp) : ''
      };
    });
    exportTableToExcel(rows, 'Laporan_Pembelian_Bahan_Proyek_HIJ');
  };

  // Summary Metrics
  const totalSpend = items.reduce((sum, i) => sum + (Number(i.totalPrice) || 0), 0);
  const pendingCount = items.filter(i => i.status === 'Requested' || i.status === 'PO Created').length;
  const inTransitCount = items.filter(i => i.status === 'Shipped').length;
  const receivedCount = items.filter(i => i.status === 'Received').length;

  const detailItem = detailId ? items.find(i => i.id === detailId) ?? null : null;
  const detailOrder = detailItem ? orders.find(o => o.id === detailItem.intendedFor || o.id === detailItem.orderId) : undefined;
  const formOrder = formData.intendedFor ? orders.find(o => o.id === formData.intendedFor) : undefined;

  const labelClass = 'block text-sm font-medium text-slate-700 mb-1.5';
  const fieldClass = 'w-full h-10 px-3 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-600';
  const filterClass = 'h-10 w-full md:w-auto text-sm bg-white border border-slate-300 rounded-lg px-3 text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-600';
  const destructiveOutline = 'text-brand-red hover:bg-rose-50 hover:text-brand-red';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pembelian Bahan Proyek"
        description="Pengadaan material & bahan khusus untuk kebutuhan proyek/pesanan (Make-to-Order)."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download size={16} aria-hidden="true" /> Unduh Excel
            </Button>
            <Button size="sm" onClick={handleOpenAdd}>
              <Plus size={16} aria-hidden="true" /> Buat PO Proyek
            </Button>
          </>
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Card className="p-4 flex items-center gap-3.5 min-w-0">
          <div className="hidden sm:flex w-10 h-10 rounded-lg bg-blue-50 text-blue-700 items-center justify-center shrink-0" aria-hidden="true">
            <ShoppingBag className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="text-sm text-slate-500">Total Belanja Bahan</div>
            <div
              className="text-base sm:text-lg font-bold text-slate-900 tabular-nums whitespace-nowrap truncate mt-0.5"
              title={formatCurrency(totalSpend)}
            >
              {formatCurrency(totalSpend)}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">{items.length} PO Terkait Proyek</div>
          </div>
        </Card>

        <Card className="p-4 flex items-center gap-3.5 min-w-0">
          <div className="hidden sm:flex w-10 h-10 rounded-lg bg-teal-50 text-brand-teal-dark items-center justify-center shrink-0" aria-hidden="true">
            <Clock className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="text-sm text-slate-500">Menunggu Proses</div>
            <div className="text-base sm:text-lg font-bold text-brand-teal-dark tabular-nums whitespace-nowrap mt-0.5">{pendingCount} PO</div>
            <div className="text-xs text-slate-500 mt-0.5">{statusLabel('Requested')} & {statusLabel('PO Created')}</div>
          </div>
        </Card>

        <Card className="p-4 flex items-center gap-3.5 min-w-0">
          <div className="hidden sm:flex w-10 h-10 rounded-lg bg-amber-50 text-amber-700 items-center justify-center shrink-0" aria-hidden="true">
            <Truck className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="text-sm text-slate-500">Dalam Pengiriman</div>
            <div className="text-base sm:text-lg font-bold text-amber-800 tabular-nums whitespace-nowrap mt-0.5">{inTransitCount} PO</div>
            <div className="text-xs text-slate-500 mt-0.5">Menuju pabrik</div>
          </div>
        </Card>

        <Card className="p-4 flex items-center gap-3.5 min-w-0">
          <div className="hidden sm:flex w-10 h-10 rounded-lg bg-emerald-50 text-emerald-700 items-center justify-center shrink-0" aria-hidden="true">
            <PackageCheck className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="text-sm text-slate-500">Bahan Diterima</div>
            <div className="text-base sm:text-lg font-bold text-emerald-800 tabular-nums whitespace-nowrap mt-0.5">{receivedCount} PO</div>
            <div className="text-xs text-slate-500 mt-0.5">Siap masuk potong/SPK</div>
          </div>
        </Card>
      </div>

      {/* Filter and Search Bar */}
      <Card className="p-4 flex flex-col md:flex-row gap-3 md:items-center justify-between">
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <Input
            type="search"
            aria-label="Cari PO"
            placeholder="Cari bahan, pemasok, no. PO, atau proyek…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full md:w-auto">
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            aria-label="Filter proyek"
            className={filterClass}
          >
            <option value="ALL">Semua Proyek / Pesanan</option>
            {orders.map(o => (
              <option key={o.id} value={o.id}>
                {o.id} - {o.customerName} ({o.productType})
              </option>
            ))}
          </select>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            aria-label="Filter kategori"
            className={filterClass}
          >
            <option value="ALL">Semua Kategori</option>
            {CATEGORIES.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter status"
            className={filterClass}
          >
            <option value="ALL">Semua Status</option>
            <option value="Requested">{statusLabel('Requested')}</option>
            <option value="PO Created">{statusLabel('PO Created')}</option>
            <option value="Paid">{statusLabel('Paid')}</option>
            <option value="Shipped">{statusLabel('Shipped')}</option>
            <option value="Received">{statusLabel('Received')}</option>
          </select>
        </div>
      </Card>

      {/* Procurement Table */}
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="cell-sticky-start">No. PO</TableHead>
              <TableHead>Proyek / Pesanan</TableHead>
              <TableHead>Bahan / Barang</TableHead>
              <TableHead className="hidden md:table-cell">Kategori</TableHead>
              <TableHead className="hidden md:table-cell">Pemasok</TableHead>
              <TableHead className="text-right">Kuantitas</TableHead>
              <TableHead className="hidden lg:table-cell text-right">Total</TableHead>
              <TableHead className="hidden xl:table-cell">Tanggal</TableHead>
              <TableHead className="text-center">Status</TableHead>
              <TableHead className="cell-sticky-end text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableSkeletonRows columns={10} />
            ) : filteredItems.length === 0 ? (
              <TableEmptyRow
                colSpan={10}
                icon={<ShoppingBag size={20} />}
                title={isFiltered && items.length > 0 ? 'Tidak ada PO yang cocok' : 'Belum ada PO Pengadaan Bahan'}
                description={
                  isFiltered && items.length > 0
                    ? 'Coba kata kunci lain atau ubah filter proyek, kategori, dan status.'
                    : 'Klik "Buat PO Proyek" untuk melakukan pengadaan bahan make-to-order per pesanan.'
                }
              />
            ) : (
              filteredItems.map((item) => {
                const linkedOrder = orders.find(o => o.id === item.intendedFor || o.id === item.orderId);
                return (
                  <TableRow key={item.id}>
                    <TableCell className="cell-sticky-start whitespace-nowrap font-mono font-bold text-slate-900">
                      {item.id}
                    </TableCell>

                    <TableCell>
                      <div className="flex flex-col">
                        <div className="flex items-center gap-1.5">
                          <Badge variant="blue" className="font-mono text-xs px-2 py-0.5">
                            {item.intendedFor || item.orderId || 'Proyek'}
                          </Badge>
                        </div>
                        <span className="text-xs text-slate-600 font-medium truncate max-w-[180px] mt-1">
                          {linkedOrder?.customerName || item.customerName || '-'} • {linkedOrder?.productType || item.projectName || ''}
                        </span>
                      </div>
                    </TableCell>

                    <TableCell>
                      <span className="font-semibold text-slate-900 break-words">{item.itemName}</span>
                    </TableCell>

                    <TableCell className="hidden md:table-cell">
                      <span className="text-xs font-medium px-2 py-1 bg-slate-100 text-slate-700 rounded-md">
                        {item.category || '-'}
                      </span>
                    </TableCell>

                    <TableCell className="hidden md:table-cell font-semibold text-slate-800">
                      {item.supplierName || '-'}
                    </TableCell>

                    <TableCell className="text-right whitespace-nowrap font-medium text-slate-900">
                      {item.quantity} {item.unit}
                    </TableCell>

                    <TableCell className="hidden lg:table-cell text-right font-bold text-slate-900 whitespace-nowrap">
                      {formatCurrency(item.totalPrice)}
                    </TableCell>

                    <TableCell className="hidden xl:table-cell whitespace-nowrap text-xs text-slate-600">
                      {formatDate(item.purchaseDate)}
                    </TableCell>

                    <TableCell className="text-center whitespace-nowrap">
                      <StatusBadge status={item.status} />
                    </TableCell>

                    <TableCell className="cell-sticky-end text-right">
                      <TableRowActions>
                        {item.status === 'Shipped' && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleQuickStatusChange(item, 'Received')}
                            aria-label={`Tandai Diterima ${item.id}`}
                            title="Tandai Diterima"
                            className="h-8 min-w-8 px-2.5 text-xs text-emerald-700 hover:bg-emerald-50"
                          >
                            <PackageCheck size={14} aria-hidden="true" />
                            <span className="hidden sm:inline">Terima</span>
                          </Button>
                        )}
                        <RowDetailButton label={item.id} onClick={() => setDetailId(item.id)} />
                      </TableRowActions>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>

      {/* PO Detail Drawer */}
      <DetailDrawer
        isOpen={!!detailItem}
        onClose={() => setDetailId(null)}
        title={detailItem?.itemName}
        subtitle={detailItem && <span className="font-mono">{detailItem.id} · {formatDate(detailItem.purchaseDate)}</span>}
        status={detailItem && <StatusBadge status={detailItem.status} />}
        footer={
          detailItem && (
            <>
              {detailItem.status === 'Shipped' && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setDetailId(null);
                    handleOpenEdit(detailItem);
                  }}
                >
                  <Pencil size={16} aria-hidden="true" /> Ubah PO
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleDelete(detailItem.id)}
                className={destructiveOutline}
              >
                <Trash2 size={16} aria-hidden="true" /> Hapus PO
              </Button>
              {detailItem.status === 'Shipped' ? (
                <Button size="sm" onClick={() => handleQuickStatusChange(detailItem, 'Received')}>
                  <PackageCheck size={16} aria-hidden="true" /> Tandai Diterima
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() => {
                    setDetailId(null);
                    handleOpenEdit(detailItem);
                  }}
                >
                  <Pencil size={16} aria-hidden="true" /> Ubah PO
                </Button>
              )}
            </>
          )
        }
      >
        {detailItem && (
          <>
            <DetailStats
              items={[
                { label: 'Jumlah', value: `${detailItem.quantity} ${detailItem.unit}` },
                { label: 'Harga satuan', value: formatCurrency(detailItem.unitPrice) },
                { label: 'Total Pembelian', value: formatCurrency(detailItem.totalPrice), tone: 'accent' }
              ]}
            />

            {/* Linked Project Banner */}
            <div className="p-3.5 bg-blue-50/80 border border-blue-200 rounded-xl space-y-2">
              <div className="flex items-center gap-2 text-blue-900 font-semibold text-sm">
                <FolderKanban size={16} className="text-blue-700" />
                <span>Pengadaan Khusus Proyek: {detailItem.intendedFor || detailItem.orderId}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-blue-800">
                <div>
                  <span className="text-blue-600 block">Pelanggan:</span>
                  <span className="font-semibold">{detailOrder?.customerName || detailItem.customerName || '-'}</span>
                </div>
                <div>
                  <span className="text-blue-600 block">Produk:</span>
                  <span className="font-semibold">{detailOrder?.productType || detailItem.projectName || '-'}</span>
                </div>
                {detailOrder && (
                  <>
                    <div>
                      <span className="text-blue-600 block">Target Qty:</span>
                      <span className="font-semibold">{detailOrder.quantity} pcs</span>
                    </div>
                    <div>
                      <span className="text-blue-600 block">Deadline Proyek:</span>
                      <span className="font-semibold">{formatDate(detailOrder.deadline)}</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            <DetailSection title="PO & Pengadaan">
              <DetailField label="No. PO" mono>{detailItem.id}</DetailField>
              <DetailField label="Status"><StatusBadge status={detailItem.status} /></DetailField>
              <DetailField label="Tanggal Beli">{formatDate(detailItem.purchaseDate)}</DetailField>
              <DetailField label="Estimasi Tiba">
                {detailItem.estimatedDelivery ? formatDate(detailItem.estimatedDelivery) : '-'}
              </DetailField>
            </DetailSection>

            <DetailSection title="Spesifikasi Bahan">
              <DetailField label="Nama / Jenis Bahan" full>{detailItem.itemName}</DetailField>
              <DetailField label="Kategori">{detailItem.category}</DetailField>
              <DetailField label="Satuan">{detailItem.unit}</DetailField>
            </DetailSection>

            <DetailSection title="Pemasok">
              <DetailField label="Nama Pemasok">{detailItem.supplierName || '-'}</DetailField>
              <DetailField label="Kontak WhatsApp">
                {detailItem.supplierContact ? (
                  <a
                    href={`https://wa.me/${detailItem.supplierContact.replace(/[^0-9]/g, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-brand-teal-dark underline-offset-2 hover:underline font-medium"
                  >
                    <Phone size={14} aria-hidden="true" />
                    {detailItem.supplierContact}
                  </a>
                ) : '-'}
              </DetailField>
            </DetailSection>

            {detailItem.notes && (
              <DetailSection title="Catatan Khusus">
                <DetailField label="Catatan Pengadaan" full>{detailItem.notes}</DetailField>
              </DetailSection>
            )}

            {(detailItem.user || detailItem.timestamp) && (
              <DetailSection title="Riwayat Data">
                <DetailField label="Dicatat oleh">{detailItem.user || 'Staf Pengadaan'}</DetailField>
                <DetailField label="Dicatat pada">
                  {detailItem.timestamp ? formatDateTime(detailItem.timestamp) : '-'}
                </DetailField>
              </DetailSection>
            )}
          </>
        )}
      </DetailDrawer>

      {/* Modal Add / Edit PO Proyek */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={isEditMode ? `Edit PO Bahan ${formData.id}` : 'Buat PO Bahan Proyek (Make-to-Order)'}
        maxWidth="2xl"
      >
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Linked Project Selection (Wajib) */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="po-order" className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                  <FolderKanban size={16} className="text-teal-700" />
                  Untuk Kebutuhan Proyek / Pesanan *
                </label>
                <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full font-medium">
                  Khusus Make-to-Order Proyek
                </span>
              </div>
              <select
                id="po-order"
                required
                value={formData.intendedFor}
                onChange={(e) => handleOrderSelect(e.target.value)}
                className="w-full h-11 px-3 text-sm font-semibold border-2 border-teal-600 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                <option value="">-- Pilih Proyek / Pesanan Tujuan * --</option>
                {orders.map(o => (
                  <option key={o.id} value={o.id}>
                    {o.id} – {o.customerName} ({o.productType} • {o.quantity} pcs)
                  </option>
                ))}
              </select>
            </div>

            {/* Selected Order Summary Card */}
            {formOrder ? (
              <div className="p-3 bg-white border border-teal-200 rounded-lg space-y-1.5 text-xs text-slate-700">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900 text-sm">
                    {formOrder.id} • {formOrder.customerName}
                  </span>
                  <Badge variant="blue">{formOrder.status}</Badge>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1 border-t border-slate-100">
                  <div>
                    <span className="text-slate-500 block">Produk & Qty:</span>
                    <span className="font-medium text-slate-900">{formOrder.productType} ({formOrder.quantity} pcs)</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Bahan & Warna:</span>
                    <span className="font-medium text-slate-900">{formOrder.material || '-'} ({formOrder.color || '-'})</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Deadline Kirim:</span>
                    <span className="font-medium text-slate-900">{formatDate(formOrder.deadline)}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 p-2.5 rounded-lg border border-amber-200">
                <AlertCircle size={15} className="shrink-0" />
                <span>Pilih proyek di atas untuk mengaitkan pengadaan bahan dengan kebutuhan pesanan.</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="po-number" className={labelClass}>Nomor PO</label>
              <input
                id="po-number"
                type="text"
                value={formData.id}
                readOnly
                className="w-full h-10 px-3 text-sm bg-slate-100 border border-slate-300 rounded-lg font-mono text-slate-600 cursor-not-allowed"
              />
            </div>

            <div>
              <label htmlFor="po-category" className={labelClass}>Kategori Bahan *</label>
              <select
                id="po-category"
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value as any })}
                className={fieldClass}
                required
              >
                {CATEGORIES.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="po-item" className={labelClass}>Nama Bahan & Spesifikasi *</label>
            <input
              id="po-item"
              type="text"
              placeholder="Contoh: Cotton Combed 24s Hitam Reaktif 185 gsm"
              value={formData.itemName}
              onChange={(e) => setFormData({ ...formData, itemName: e.target.value })}
              className={fieldClass}
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="po-supplier" className={labelClass}>Nama Pemasok / Toko Bahan</label>
              <input
                id="po-supplier"
                type="text"
                placeholder="Contoh: CV Citra Tekstil Bandung"
                value={formData.supplierName}
                onChange={(e) => setFormData({ ...formData, supplierName: e.target.value })}
                className={fieldClass}
              />
            </div>

            <div>
              <label htmlFor="po-contact" className={labelClass}>No. WhatsApp Pemasok</label>
              <input
                id="po-contact"
                type="tel"
                placeholder="Contoh: 081234567890"
                value={formData.supplierContact}
                onChange={(e) => setFormData({ ...formData, supplierContact: e.target.value })}
                className={fieldClass}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="po-qty" className={labelClass}>Jumlah Dibeli *</label>
              <input
                id="po-qty"
                type="number"
                min="0.1"
                step="any"
                value={formData.quantity}
                onChange={(e) => handleQtyPriceChange(parseFloat(e.target.value) || 0, formData.unitPrice || 0)}
                className={`${fieldClass} font-semibold`}
                required
              />
            </div>

            <div>
              <label htmlFor="po-unit" className={labelClass}>Satuan</label>
              <select
                id="po-unit"
                value={formData.unit}
                onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                className={fieldClass}
              >
                <option value="Kg">Kg</option>
                <option value="Roll">Roll</option>
                <option value="Yard">Yard</option>
                <option value="Meter">Meter</option>
                <option value="Lusin">Lusin</option>
                <option value="Gross">Gross (144 Pcs)</option>
                <option value="Cone">Cone</option>
                <option value="Pcs">Pcs</option>
              </select>
            </div>

            <div>
              <label htmlFor="po-price" className={labelClass}>Harga Satuan (Rp)</label>
              <input
                id="po-price"
                type="number"
                value={formData.unitPrice}
                onChange={(e) => handleQtyPriceChange(formData.quantity || 0, parseFloat(e.target.value) || 0)}
                className={fieldClass}
              />
            </div>
          </div>

          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between gap-3">
            <div>
              <span className="text-xs text-emerald-800 block font-medium">Total Anggaran Pengadaan Proyek</span>
              <span className="text-lg font-bold text-emerald-700 tabular-nums whitespace-nowrap">
                {formatCurrency(formData.totalPrice || 0)}
              </span>
            </div>
            <div className="text-right text-xs text-emerald-700">
              {formData.quantity} {formData.unit} @ {formatCurrency(formData.unitPrice || 0)}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="po-status" className={labelClass}>Status PO</label>
              <select
                id="po-status"
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                className={fieldClass}
              >
                <option value="Requested">{statusLabel('Requested')}</option>
                <option value="PO Created">{statusLabel('PO Created')}</option>
                <option value="Paid">{statusLabel('Paid')}</option>
                <option value="Shipped">{statusLabel('Shipped')}</option>
                <option value="Received">{statusLabel('Received')}</option>
              </select>
            </div>

            <div>
              <label htmlFor="po-date" className={labelClass}>Tanggal Beli</label>
              <input
                id="po-date"
                type="date"
                value={formData.purchaseDate}
                onChange={(e) => setFormData({ ...formData, purchaseDate: e.target.value })}
                className={fieldClass}
              />
            </div>

            <div>
              <label htmlFor="po-eta" className={labelClass}>Estimasi Tiba di Pabrik</label>
              <input
                id="po-eta"
                type="date"
                value={formData.estimatedDelivery}
                onChange={(e) => setFormData({ ...formData, estimatedDelivery: e.target.value })}
                className={fieldClass}
              />
            </div>
          </div>

          <div>
            <label htmlFor="po-notes" className={labelClass}>Catatan Spesifikasi / Kebutuhan</label>
            <textarea
              id="po-notes"
              rows={2}
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Contoh: Lot warna harus persis sama, lebar setting 180 cm, minta sample swatch dulu."
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsModalOpen(false)}
            >
              Batal
            </Button>
            <Button type="submit">
              {isEditMode ? 'Simpan Perubahan' : 'Buat PO Bahan'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
