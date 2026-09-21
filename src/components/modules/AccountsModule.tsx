import React, { useState, useEffect } from 'react';
import {
  Plus,
  Search,
  Users,
  Edit,
  Trash2,
  CheckSquare,
  Square
} from 'lucide-react';
import { User, SOPModule, StaffRole, STAFF_ROLE_MODULES } from '../../types';
import { ALL_MODULES } from '../../config/modules';
import { fetchResource, createResource, updateResource, deleteResource } from '../../services/api';
import { formatDate, formatDateTime, generateId } from '../../lib/utils';
import { Badge } from '../ui/Badge';
import { Modal } from '../ui/Modal';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { PageHeader } from '../ui/PageHeader';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  TableSortHead,
  sortRows,
  TableRowActions,
  TableEmptyRow,
  TableSkeletonRows,
  type SortState
} from '../ui/Table';
import {
  DetailDrawer,
  DetailSection,
  DetailBlock,
  DetailField,
  RowDetailButton
} from '../ui/DetailDrawer';

// Module names come from src/config/modules.ts — see the note there.

// Display labels for the 5 primary staff roles
const ROLE_LABELS: Record<string, string> = {
  'Super Admin': 'Super Admin (Akses Penuh)',
  'Owner': 'Owner (Eksekutif)',
  'Design': 'Design (Desain & Pola)',
  'Pengadaan': 'Pengadaan (Material & Trims)',
  'Produksi': 'Produksi (Pabrik & QC)',
  // Fallbacks for legacy/stored roles
  'Admin Order': 'Admin Pesanan',
  'PPIC': 'PPIC',
  'Leader Cutting': 'Kepala Pemotongan',
  'Operator Sewing': 'Operator Jahit',
  'QC Inspector': 'Petugas QC',
  'Finance': 'Keuangan',
  'HR Payroll': 'HRD & Penggajian'
};

const roleLabel = (role?: string) => (role ? ROLE_LABELS[role] ?? role : '-');
const moduleName = (id: string) => ALL_MODULES.find(m => m.id === id)?.label ?? id;
const moduleSop = (id: string) => ALL_MODULES.find(m => m.id === id)?.sop ?? '';

const hasFullAccess = (user: User) => !!user.allowedModules?.includes('*');

/* '*' means every menu, so it counts as the whole list rather than one entry. */
const moduleCount = (user: User) =>
  hasFullAccess(user) ? ALL_MODULES.length : user.allowedModules?.length || 0;

// The seeded Super Admin keeps the system reachable, so it can never be deleted.
const isProtectedAccount = (user: User) => user.username === 'admin.rezza' || user.id === 'USR-001';

export const AccountsModule: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  const [sort, setSort] = useState<SortState>({ key: 'newest', direction: 'desc' });

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);

  // Detail Drawer State
  const [detailUser, setDetailUser] = useState<User | null>(null);

  // Form State
  const [formData, setFormData] = useState<Partial<User>>({
    id: '',
    username: '',
    name: '',
    password: '',
    role: 'Produksi',
    allowedModules: STAFF_ROLE_MODULES['Produksi']
  });

  const loadData = async () => {
    try {
      setLoading(true);
      const res = await fetchResource<User>('users');
      setUsers(res || []);
    } catch (err) {
      console.error('Failed loading users:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleRoleChange = (newRole: StaffRole) => {
    const defaultModules = STAFF_ROLE_MODULES[newRole] || ['*'];
    setFormData(prev => ({
      ...prev,
      role: newRole,
      allowedModules: defaultModules
    }));
  };

  const handleOpenAdd = () => {
    setIsEditMode(false);
    setSelectedUser(null);
    setFormData({
      id: generateId('USR'),
      username: '',
      name: '',
      password: '',
      role: 'Produksi',
      allowedModules: STAFF_ROLE_MODULES['Produksi']
    });
    setIsModalOpen(true);
  };

  const handleOpenEdit = (user: User) => {
    setIsEditMode(true);
    setSelectedUser(user);
    setFormData({ ...user, password: '' });
    setIsModalOpen(true);
  };

  const handleToggleModule = (modId: SOPModule) => {
    const current = formData.allowedModules || [];
    if (current.includes('*')) {
      // If was all, now deselect this one
      const allExceptOne = ALL_MODULES.map(m => m.id).filter(id => id !== modId);
      setFormData({ ...formData, allowedModules: allExceptOne });
      return;
    }

    if (current.includes(modId)) {
      setFormData({
        ...formData,
        allowedModules: (current as SOPModule[]).filter(m => m !== modId)
      });
    } else {
      setFormData({
        ...formData,
        allowedModules: [...(current as SOPModule[]), modId]
      });
    }
  };

  const handleSelectAllModules = () => {
    setFormData({ ...formData, allowedModules: ['*'] });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.username || !formData.name) {
      alert('Username dan nama wajib diisi.');
      return;
    }

    try {
      if (isEditMode && selectedUser) {
        // If password is blank on edit, keep existing
        const payload = { ...formData };
        if (!payload.password) delete payload.password;
        await updateResource('users', selectedUser.id, payload);
      } else {
        if (!formData.password) {
          alert('Password wajib diisi untuk akun baru.');
          return;
        }
        await createResource('users', formData);
      }
      setIsModalOpen(false);
      loadData();
    } catch (err) {
      console.error('Save user error:', err);
      alert('Gagal menyimpan akun. Coba lagi.');
    }
  };

  const handleDelete = async (id: string) => {
    if (id === 'admin' || id === 'USR-001') {
      alert('Akun Super Admin utama tidak bisa dihapus.');
      return false;
    }
    if (window.confirm('Hapus akun ini?')) {
      try {
        await deleteResource('users', id);
        loadData();
      } catch (err) {
        console.error('Delete user error:', err);
      }
      return true;
    }
    return false;
  };

  const filteredUsers = users.filter(u =>
    (u.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (u.username || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (u.role || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const sortedUsers = sortRows(filteredUsers, sort, (user, key) => {
    // Default column: the account created last leads, same key `newestFirst` uses.
    if (key === 'newest') return user.timestamp ? new Date(user.timestamp).getTime() : 0;
    if (key === 'moduleCount') return moduleCount(user);
    return (user as any)[key];
  });

  const labelClass = 'block text-sm font-medium text-slate-700 mb-1.5';
  const fieldClass = 'w-full h-10 px-3 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-600';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Akun & Hak Akses"
        description="Atur akun staf dan modul yang boleh mereka buka."
        actions={
          <Button size="sm" onClick={handleOpenAdd}>
            <Plus size={16} aria-hidden="true" /> Tambah Akun
          </Button>
        }
      />

      {/* Search Bar */}
      <Card className="p-4 flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
        <div className="relative w-full md:w-96">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <Input
            type="search"
            aria-label="Cari akun"
            placeholder="Cari nama, username, atau jabatan…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="text-sm text-slate-500 whitespace-nowrap">
          <span className="font-bold text-slate-900 tabular-nums">{users.length}</span> akun
        </div>
      </Card>

      {/* ACCOUNTS TABLE */}
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableSortHead sortKey="id" sort={sort} onSortChange={setSort} className="cell-sticky-start">
                ID Akun
              </TableSortHead>
              <TableSortHead sortKey="name" sort={sort} onSortChange={setSort} className="hidden md:table-cell">
                Nama
              </TableSortHead>
              <TableSortHead sortKey="username" sort={sort} onSortChange={setSort} className="hidden md:table-cell">
                Username
              </TableSortHead>
              <TableSortHead
                sortKey="moduleCount"
                sort={sort}
                onSortChange={setSort}
                align="right"
                className="hidden sm:table-cell"
              >
                Akses Menu
              </TableSortHead>
              <TableSortHead sortKey="timestamp" sort={sort} onSortChange={setSort} className="hidden lg:table-cell">
                Dibuat
              </TableSortHead>
              <TableSortHead sortKey="role" sort={sort} onSortChange={setSort} align="center">
                Jabatan
              </TableSortHead>
              <TableHead className="cell-sticky-end text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableSkeletonRows columns={7} />
            ) : sortedUsers.length === 0 ? (
              <TableEmptyRow
                colSpan={7}
                icon={<Users size={20} />}
                title={searchQuery ? 'Tidak ada akun yang cocok' : 'Belum ada akun staf'}
                description={
                  searchQuery
                    ? 'Coba kata kunci lain, misalnya nama atau jabatan.'
                    : 'Tambah akun agar staf bisa masuk dan membuka modul sesuai jabatannya.'
                }
                action={
                  searchQuery ? (
                    <Button variant="outline" size="sm" onClick={() => setSearchQuery('')}>
                      Hapus Pencarian
                    </Button>
                  ) : (
                    <Button size="sm" onClick={handleOpenAdd}>
                      <Plus size={16} aria-hidden="true" /> Tambah Akun
                    </Button>
                  )
                }
              />
            ) : (
              sortedUsers.map(user => {
                const isProtected = isProtectedAccount(user);

                return (
                  <TableRow key={user.id}>
                    <TableCell className="cell-sticky-start whitespace-nowrap font-mono font-bold text-slate-900">
                      {user.id}
                    </TableCell>
                    <TableCell className="hidden md:table-cell font-semibold text-slate-900">
                      {user.name || '—'}
                    </TableCell>
                    <TableCell className="hidden md:table-cell whitespace-nowrap font-mono text-teal-700">
                      @{user.username}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-right whitespace-nowrap">
                      {hasFullAccess(user) ? (
                        <Badge variant="done" size="sm" solid>Semua menu</Badge>
                      ) : (
                        `${moduleCount(user)} menu`
                      )}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell whitespace-nowrap">
                      {user.timestamp ? formatDate(user.timestamp) : '—'}
                    </TableCell>
                    <TableCell className="text-center whitespace-nowrap font-medium text-slate-900">
                      {user.role || '—'}
                    </TableCell>
                    <TableCell className="cell-sticky-end text-right">
                      <TableRowActions>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => handleDelete(user.id)}
                          disabled={isProtected}
                          aria-label={`Hapus akun ${user.name}`}
                          title={isProtected ? 'Akun Super Admin utama tidak bisa dihapus' : 'Hapus akun'}
                          className="hidden size-8 text-brand-red hover:bg-rose-50 hover:text-brand-red sm:inline-flex"
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => handleOpenEdit(user)}
                          aria-label={`Ubah akun ${user.name}`}
                          title="Ubah akun"
                          className="hidden size-8 sm:inline-flex"
                        >
                          <Edit size={14} aria-hidden="true" />
                        </Button>
                        <RowDetailButton label={user.name || user.id} onClick={() => setDetailUser(user)} />
                      </TableRowActions>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>

      <DetailDrawer
        isOpen={!!detailUser}
        onClose={() => setDetailUser(null)}
        title={detailUser?.name}
        subtitle={detailUser && <span className="font-mono">@{detailUser.username}</span>}
        status={detailUser && <Badge variant="idle" size="sm">{detailUser.role}</Badge>}
        footer={detailUser && (
          <>
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                const deleted = await handleDelete(detailUser.id);
                if (deleted) setDetailUser(null);
              }}
              disabled={isProtectedAccount(detailUser)}
              title={isProtectedAccount(detailUser) ? 'Akun Super Admin utama tidak bisa dihapus' : undefined}
              className="text-brand-red hover:bg-rose-50 hover:text-brand-red"
            >
              <Trash2 size={16} aria-hidden="true" /> Hapus
            </Button>
            <Button
              type="button"
              onClick={() => {
                const userToEdit = detailUser;
                setDetailUser(null);
                handleOpenEdit(userToEdit);
              }}
            >
              <Edit size={16} aria-hidden="true" /> Ubah Akun
            </Button>
          </>
        )}
      >
        {detailUser && (
          <>
            <DetailSection title="Akun">
              <DetailField label="ID akun" mono>{detailUser.id}</DetailField>
              <DetailField label="Username" mono>@{detailUser.username}</DetailField>
              <DetailField label="Nama lengkap">{detailUser.name}</DetailField>
              <DetailField label="Jabatan">{roleLabel(detailUser.role)}</DetailField>
              <DetailField label="Jumlah menu">
                {hasFullAccess(detailUser) ? 'Semua menu' : `${moduleCount(detailUser)} menu`}
              </DetailField>
            </DetailSection>
            <DetailBlock title="Akses Menu">
              {hasFullAccess(detailUser) ? (
                <p className="text-sm text-muted-foreground text-pretty">
                  Akun ini membuka seluruh {ALL_MODULES.length} menu sistem, termasuk Akun &amp; Hak Akses.
                </p>
              ) : (
                <ul
                  role="list"
                  aria-label={`Menu yang bisa dibuka ${detailUser.name}`}
                  className="divide-y divide-border rounded-xl border border-border"
                >
                  {(detailUser.allowedModules || []).map(m => (
                    <li key={m} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span className="min-w-0 break-words font-medium text-foreground">{moduleName(m)}</span>
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">{moduleSop(m)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </DetailBlock>
            <DetailSection title="Riwayat Data">
              <DetailField label="Dicatat oleh">{detailUser.user}</DetailField>
              <DetailField label="Dicatat pada">
                {detailUser.timestamp && formatDateTime(detailUser.timestamp)}
              </DetailField>
            </DetailSection>
          </>
        )}
      </DetailDrawer>

      {/* Modal Add / Edit User */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={isEditMode ? `Ubah Akun: ${formData.name}` : 'Tambah Akun'}
        size="2xl"
      >
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="acc-username" className={labelClass}>
                Username
              </label>
              <input
                id="acc-username"
                type="text"
                autoComplete="off"
                placeholder="Contoh: asep.cutting"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                className={fieldClass}
                required
              />
            </div>

            <div>
              <label htmlFor="acc-password" className={labelClass}>
                {isEditMode ? 'Password Baru' : 'Password'}
              </label>
              <input
                id="acc-password"
                type="password"
                autoComplete="new-password"
                value={formData.password || ''}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className={fieldClass}
                required={!isEditMode}
                aria-describedby={isEditMode ? 'acc-password-hint' : undefined}
              />
              {isEditMode && (
                <p id="acc-password-hint" className="text-xs text-slate-500 mt-1.5">Kosongkan jika tidak diubah.</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="acc-name" className={labelClass}>
                Nama Lengkap
              </label>
              <input
                id="acc-name"
                type="text"
                autoComplete="off"
                placeholder="Contoh: Asep Sunandar"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className={fieldClass}
                required
              />
            </div>

            <div>
              <label htmlFor="acc-role" className={labelClass}>
                Jabatan
              </label>
              <select
                id="acc-role"
                value={formData.role}
                onChange={(e) => handleRoleChange(e.target.value as StaffRole)}
                className={fieldClass}
              >
                <option value="Super Admin">Super Admin (Akses Penuh Seluruh Sistem)</option>
                <option value="Owner">Owner (Eksekutif, Keuangan, Pesanan & Toko)</option>
                <option value="Design">Design (Desain, Pola Grading & Sampel)</option>
                <option value="Pengadaan">Pengadaan (Purchasing, Material & Trims)</option>
                <option value="Produksi">Produksi (PPIC, Pabrik, Mesin & QC)</option>
              </select>
            </div>
          </div>

          {/* Module Permission Matrix */}
          <div role="group" aria-labelledby="acc-modules-label">
            <div className="flex items-center justify-between gap-3 mb-2">
              <span id="acc-modules-label" className="text-sm font-medium text-slate-700">
                Akses Menu
              </span>
              <Button
                type="button"
                variant="ghost"
                onClick={handleSelectAllModules}
                className="-mr-2"
              >
                Pilih Semua
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-72 overflow-y-auto p-3 bg-slate-50 border border-slate-200 rounded-xl">
              {ALL_MODULES.map((m) => {
                const isSelected = !!(
                  formData.allowedModules?.includes('*') ||
                  formData.allowedModules?.includes(m.id)
                );

                return (
                  <label
                    key={m.id}
                    htmlFor={`acc-module-${m.id}`}
                    className={`flex min-h-10 items-center gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer transition select-none text-sm border has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-teal-600 ${
                      isSelected
                        ? 'bg-white border-teal-300 shadow-xs text-slate-900 font-medium'
                        : 'border-transparent text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <input
                      id={`acc-module-${m.id}`}
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => handleToggleModule(m.id)}
                      className="sr-only"
                    />
                    {isSelected ? (
                      <CheckSquare size={16} className="text-teal-600 shrink-0" aria-hidden="true" />
                    ) : (
                      <Square size={16} className="text-slate-400 shrink-0" aria-hidden="true" />
                    )}
                    <span>{m.label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsModalOpen(false)}
            >
              Batal
            </Button>
            <Button
              type="submit"
            >
              {isEditMode ? 'Simpan Perubahan' : 'Tambah Akun'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
