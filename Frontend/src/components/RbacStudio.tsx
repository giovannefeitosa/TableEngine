'use client';

import React, { useState, useEffect } from 'react';
import { api, TableInfo } from '@/lib/api';
import {
  ShieldCheck,
  Users,
  UserCheck,
  Key,
  Lock,
  Plus,
  Search,
  ArrowLeft,
  Edit3,
  Trash2,
  Save,
  CheckCircle2,
  AlertTriangle,
  Check,
  X,
  Shield,
  Tag,
  FolderKanban,
  Sliders,
  Mail,
  User as UserIcon,
  RefreshCw,
  Info
} from 'lucide-react';

type RbacTab = 'users' | 'groups' | 'roles' | 'permissions';
type RbacMode = 'list' | 'new' | 'detail';

export function RbacStudio() {
  const [activeTab, setActiveTab] = useState<RbacTab>('users');
  const [mode, setMode] = useState<RbacMode>('list');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  // Entities Data
  const [users, setUsers] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [permissions, setPermissions] = useState<any[]>([]);
  const [tables, setTables] = useState<TableInfo[]>([]);

  // Selected Entities for Detail View
  const [selectedUser, setSelectedUser] = useState<any | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<any | null>(null);
  const [selectedRole, setSelectedRole] = useState<any | null>(null);
  const [selectedPermission, setSelectedPermission] = useState<any | null>(null);

  // In-place Edit States
  const [isEditing, setIsEditing] = useState(false);

  // User Form State
  const [userForm, setUserForm] = useState({
    user_name: '',
    password: '',
    first_name: '',
    last_name: '',
    email: '',
    is_active: true,
    group_ids: [] as string[],
  });

  // Group Form State
  const [groupForm, setGroupForm] = useState({
    name: '',
    description: '',
    is_active: true,
    role_ids: [] as string[],
  });

  // Role Form State
  const [roleForm, setRoleForm] = useState({
    name: '',
    description: '',
    is_active: true,
    permission_ids: [] as string[],
  });

  // Permission Form State
  const [permForm, setPermForm] = useState({
    name: '',
    description: '',
    table_id: '',
    operation: 'read',
    type: 'table',
    script_condition: '',
  });

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  // Load all RBAC catalogues
  const loadAllData = async () => {
    setLoading(true);
    try {
      const [u, g, r, p, tbls] = await Promise.all([
        api.rbac.users.list().catch(() => []),
        api.rbac.groups.list().catch(() => []),
        api.rbac.roles.list().catch(() => []),
        api.rbac.permissions.list().catch(() => []),
        api.schema.listTables(true).catch(() => []),
      ]);
      setUsers(u);
      setGroups(g);
      setRoles(r);
      setPermissions(p);
      setTables(tbls);
    } catch (err: any) {
      showToast(err.message || 'Erro ao carregar dados de segurança');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAllData();
  }, []);

  // Reset view when switching tabs
  const handleSwitchTab = (tab: RbacTab) => {
    setActiveTab(tab);
    setMode('list');
    setIsEditing(false);
    setSearch('');
  };

  // ==========================================
  // USERS HANDLERS
  // ==========================================
  const handleOpenUserDetail = async (user: any) => {
    try {
      const full = await api.rbac.users.get(user.sys_id);
      setSelectedUser(full);
      setUserForm({
        user_name: full.user_name,
        password: '',
        first_name: full.first_name || '',
        last_name: full.last_name || '',
        email: full.email || '',
        is_active: full.is_active,
        group_ids: (full.groups || []).map((g: any) => g.sys_id),
      });
      setIsEditing(false);
      setMode('detail');
    } catch (err: any) {
      showToast(err.message);
    }
  };

  const handleOpenUserCreate = () => {
    setUserForm({
      user_name: '',
      password: '',
      first_name: '',
      last_name: '',
      email: '',
      is_active: true,
      group_ids: [],
    });
    setMode('new');
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.rbac.users.create(userForm);
      showToast(`Usuário '${userForm.user_name}' criado com sucesso!`);
      await loadAllData();
      setMode('list');
    } catch (err: any) {
      showToast(err.message);
    }
  };

  const handleUpdateUser = async () => {
    if (!selectedUser) return;
    try {
      const payload: any = {
        first_name: userForm.first_name,
        last_name: userForm.last_name,
        email: userForm.email,
        is_active: userForm.is_active,
        group_ids: userForm.group_ids,
      };
      if (userForm.password) {
        payload.password = userForm.password;
      }
      const updated = await api.rbac.users.update(selectedUser.sys_id, payload);
      setSelectedUser(updated);
      setIsEditing(false);
      showToast(`Usuário '${updated.user_name}' atualizado com sucesso!`);
      await loadAllData();
    } catch (err: any) {
      showToast(err.message);
    }
  };

  const handleDeleteUser = async () => {
    if (!selectedUser) return;
    if (selectedUser.user_name === 'admin') {
      alert('O usuário administrador raiz do sistema não pode ser removido.');
      return;
    }
    if (!confirm(`Deseja excluir o usuário '${selectedUser.user_name}'?`)) return;

    try {
      await api.rbac.users.delete(selectedUser.sys_id);
      showToast(`Usuário '${selectedUser.user_name}' excluído com sucesso!`);
      setSelectedUser(null);
      setMode('list');
      await loadAllData();
    } catch (err: any) {
      showToast(err.message);
    }
  };

  // ==========================================
  // GROUPS HANDLERS
  // ==========================================
  const handleOpenGroupDetail = async (grp: any) => {
    try {
      const full = await api.rbac.groups.get(grp.sys_id);
      setSelectedGroup(full);
      setGroupForm({
        name: full.name,
        description: full.description || '',
        is_active: full.is_active,
        role_ids: (full.roles || []).map((r: any) => r.sys_id),
      });
      setIsEditing(false);
      setMode('detail');
    } catch (err: any) {
      showToast(err.message);
    }
  };

  const handleOpenGroupCreate = () => {
    setGroupForm({
      name: '',
      description: '',
      is_active: true,
      role_ids: [],
    });
    setMode('new');
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.rbac.groups.create(groupForm);
      showToast(`Grupo '${groupForm.name}' criado com sucesso!`);
      await loadAllData();
      setMode('list');
    } catch (err: any) {
      showToast(err.message);
    }
  };

  const handleUpdateGroup = async () => {
    if (!selectedGroup) return;
    try {
      const updated = await api.rbac.groups.update(selectedGroup.sys_id, groupForm);
      setSelectedGroup(updated);
      setIsEditing(false);
      showToast(`Grupo '${updated.name}' atualizado com sucesso!`);
      await loadAllData();
    } catch (err: any) {
      showToast(err.message);
    }
  };

  const handleDeleteGroup = async () => {
    if (!selectedGroup) return;
    if (!confirm(`Deseja excluir o grupo '${selectedGroup.name}'?`)) return;

    try {
      await api.rbac.groups.delete(selectedGroup.sys_id);
      showToast(`Grupo '${selectedGroup.name}' excluído com sucesso!`);
      setSelectedGroup(null);
      setMode('list');
      await loadAllData();
    } catch (err: any) {
      showToast(err.message);
    }
  };

  // ==========================================
  // ROLES HANDLERS
  // ==========================================
  const handleOpenRoleDetail = async (role: any) => {
    try {
      const full = await api.rbac.roles.get(role.sys_id);
      setSelectedRole(full);
      setRoleForm({
        name: full.name,
        description: full.description || '',
        is_active: full.is_active,
        permission_ids: (full.permissions || []).map((p: any) => p.sys_id),
      });
      setIsEditing(false);
      setMode('detail');
    } catch (err: any) {
      showToast(err.message);
    }
  };

  const handleOpenRoleCreate = () => {
    setRoleForm({
      name: '',
      description: '',
      is_active: true,
      permission_ids: [],
    });
    setMode('new');
  };

  const handleCreateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.rbac.roles.create(roleForm);
      showToast(`Papel '${roleForm.name}' criado com sucesso!`);
      await loadAllData();
      setMode('list');
    } catch (err: any) {
      showToast(err.message);
    }
  };

  const handleUpdateRole = async () => {
    if (!selectedRole) return;
    try {
      const updated = await api.rbac.roles.update(selectedRole.sys_id, roleForm);
      setSelectedRole(updated);
      setIsEditing(false);
      showToast(`Papel '${updated.name}' atualizado com sucesso!`);
      await loadAllData();
    } catch (err: any) {
      showToast(err.message);
    }
  };

  const handleDeleteRole = async () => {
    if (!selectedRole) return;
    if (selectedRole.name === 'admin') {
      alert('O papel de administrador raiz não pode ser excluído.');
      return;
    }
    if (!confirm(`Deseja excluir o papel '${selectedRole.name}'?`)) return;

    try {
      await api.rbac.roles.delete(selectedRole.sys_id);
      showToast(`Papel '${selectedRole.name}' excluído com sucesso!`);
      setSelectedRole(null);
      setMode('list');
      await loadAllData();
    } catch (err: any) {
      showToast(err.message);
    }
  };

  // ==========================================
  // PERMISSIONS HANDLERS
  // ==========================================
  const handleOpenPermDetail = async (p: any) => {
    try {
      const full = await api.rbac.permissions.get(p.sys_id);
      setSelectedPermission(full);
      setPermForm({
        name: full.name,
        description: full.description || '',
        table_id: full.table_id || '',
        operation: full.operation || 'read',
        type: full.type || 'table',
        script_condition: full.script_condition || '',
      });
      setIsEditing(false);
      setMode('detail');
    } catch (err: any) {
      showToast(err.message);
    }
  };

  const handleOpenPermCreate = () => {
    setPermForm({
      name: '',
      description: '',
      table_id: tables[0]?.sys_id || '',
      operation: 'read',
      type: 'table',
      script_condition: '',
    });
    setMode('new');
  };

  const handleCreatePerm = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.rbac.permissions.create(permForm);
      showToast(`Permissão '${permForm.name}' criada com sucesso!`);
      await loadAllData();
      setMode('list');
    } catch (err: any) {
      showToast(err.message);
    }
  };

  const handleUpdatePerm = async () => {
    if (!selectedPermission) return;
    try {
      const updated = await api.rbac.permissions.update(selectedPermission.sys_id, permForm);
      setSelectedPermission(updated);
      setIsEditing(false);
      showToast(`Permissão '${updated.name}' atualizada com sucesso!`);
      await loadAllData();
    } catch (err: any) {
      showToast(err.message);
    }
  };

  const handleDeletePerm = async () => {
    if (!selectedPermission) return;
    if (!confirm(`Deseja excluir a permissão '${selectedPermission.name}'?`)) return;

    try {
      await api.rbac.permissions.delete(selectedPermission.sys_id);
      showToast(`Permissão '${selectedPermission.name}' excluída com sucesso!`);
      setSelectedPermission(null);
      setMode('list');
      await loadAllData();
    } catch (err: any) {
      showToast(err.message);
    }
  };

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 p-4 rounded-xl bg-slate-900 border border-brand-500/40 text-slate-100 text-xs shadow-2xl flex items-center space-x-3 animate-bounce">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{toast}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2.5">
            <ShieldCheck className="w-5 h-5 text-brand-400" />
            <span>Segurança, Usuários & Controle de Acesso (RBAC)</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Gerenciamento de identidades, grupos, papéis herdados e catálogo de permissões granulares no PostgreSQL.
          </p>
        </div>

        {mode === 'list' && (
          <div className="flex items-center space-x-2">
            <button
              onClick={() => {
                if (activeTab === 'users') handleOpenUserCreate();
                else if (activeTab === 'groups') handleOpenGroupCreate();
                else if (activeTab === 'roles') handleOpenRoleCreate();
                else handleOpenPermCreate();
              }}
              className="flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow-glow-sm transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              <Plus className="w-4 h-4" />
              <span>
                {activeTab === 'users' && 'Novo Usuário'}
                {activeTab === 'groups' && 'Novo Grupo'}
                {activeTab === 'roles' && 'Novo Papel'}
                {activeTab === 'permissions' && 'Nova Permissão'}
              </span>
            </button>
          </div>
        )}
      </div>

      {/* Top Sub-Navigation Tabs */}
      <div className="flex items-center space-x-2 border-b border-slate-800 pb-2">
        <button
          onClick={() => handleSwitchTab('users')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
            activeTab === 'users'
              ? 'bg-brand-600/20 text-brand-300 border border-brand-500/40 shadow-glow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
          }`}
        >
          <UserIcon className="w-4 h-4" />
          <span>Usuários ({users.length})</span>
        </button>

        <button
          onClick={() => handleSwitchTab('groups')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
            activeTab === 'groups'
              ? 'bg-brand-600/20 text-brand-300 border border-brand-500/40 shadow-glow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
          }`}
        >
          <FolderKanban className="w-4 h-4" />
          <span>Grupos ({groups.length})</span>
        </button>

        <button
          onClick={() => handleSwitchTab('roles')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
            activeTab === 'roles'
              ? 'bg-brand-600/20 text-brand-300 border border-brand-500/40 shadow-glow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
          }`}
        >
          <Key className="w-4 h-4" />
          <span>Papéis / Roles ({roles.length})</span>
        </button>

        <button
          onClick={() => handleSwitchTab('permissions')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
            activeTab === 'permissions'
              ? 'bg-brand-600/20 text-brand-300 border border-brand-500/40 shadow-glow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
          }`}
        >
          <Lock className="w-4 h-4" />
          <span>Permissões ACL ({permissions.length})</span>
        </button>
      </div>

      {/* ========================================================================= */}
      {/* 1. USERS SECTION */}
      {/* ========================================================================= */}
      {activeTab === 'users' && (
        <div>
          {mode === 'list' && (
            <div className="space-y-4">
              <div className="relative max-w-md">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Buscar por usuário, nome ou email..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-900/80 border border-slate-800 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                />
              </div>

              {loading ? (
                <div className="p-8 text-center text-xs text-slate-400">Carregando usuários...</div>
              ) : users.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400 glass-panel rounded-2xl">
                  Nenhum usuário cadastrado.
                </div>
              ) : (
                <div className="overflow-x-auto border border-slate-800 rounded-2xl glass-panel">
                  <table className="w-full text-left text-xs text-slate-300">
                    <thead className="bg-slate-900/80 text-[11px] font-semibold text-slate-400 border-b border-slate-800">
                      <tr>
                        <th className="py-3 px-4">Usuário (Login)</th>
                        <th className="py-3 px-4">Nome Completo</th>
                        <th className="py-3 px-4">Email</th>
                        <th className="py-3 px-4">Grupos</th>
                        <th className="py-3 px-4 text-center">Status</th>
                        <th className="py-3 px-4 text-right">Ação</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-sans">
                      {users
                        .filter(
                          (u) =>
                            u.user_name?.toLowerCase().includes(search.toLowerCase()) ||
                            u.first_name?.toLowerCase().includes(search.toLowerCase()) ||
                            u.last_name?.toLowerCase().includes(search.toLowerCase()) ||
                            u.email?.toLowerCase().includes(search.toLowerCase())
                        )
                        .map((u) => (
                          <tr
                            key={u.sys_id}
                            onClick={() => handleOpenUserDetail(u)}
                            className="hover:bg-slate-800/40 cursor-pointer transition-colors"
                          >
                            <td className="py-2.5 px-4 font-mono font-semibold text-white">
                              {u.user_name}
                            </td>
                            <td className="py-2.5 px-4 text-slate-200">
                              {u.first_name} {u.last_name}
                            </td>
                            <td className="py-2.5 px-4 font-mono text-[11px] text-slate-400">
                              {u.email || '-'}
                            </td>
                            <td className="py-2.5 px-4">
                              <div className="flex flex-wrap gap-1">
                                {(u.groups || []).map((g: any) => (
                                  <span
                                    key={g.sys_id}
                                    className="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300 border border-slate-700"
                                  >
                                    {g.name}
                                  </span>
                                ))}
                                {(!u.groups || u.groups.length === 0) && (
                                  <span className="text-slate-500 text-[11px]">-</span>
                                )}
                              </div>
                            </td>
                            <td className="py-2.5 px-4 text-center">
                              {u.is_active ? (
                                <span className="px-2 py-0.5 rounded-full text-[9px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                  Ativo
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full text-[9px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                                  Inativo
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-4 text-right">
                              <button className="text-brand-400 hover:text-brand-300 font-medium text-[11px]">
                                Ver / Editar &rarr;
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* User Create Page */}
          {mode === 'new' && (
            <div className="max-w-3xl mx-auto space-y-6">
              <div className="flex items-center space-x-4">
                <button
                  onClick={() => setMode('list')}
                  className="p-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div>
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <UserIcon className="w-5 h-5 text-brand-400" />
                    <span>Cadastrar Novo Usuário (sys_user)</span>
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    A senha será criptografada com algoritmo seguro bcrypt no banco de dados.
                  </p>
                </div>
              </div>

              <div className="glass-panel rounded-2xl border border-slate-800 p-6 shadow-2xl">
                <form onSubmit={handleCreateUser} className="space-y-4 text-xs">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block font-semibold text-slate-300 mb-1.5">
                        Nome de Usuário (Login) <span className="text-rose-400">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="ex: carlos.silva"
                        value={userForm.user_name}
                        onChange={(e) => setUserForm({ ...userForm, user_name: e.target.value })}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono focus:border-brand-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block font-semibold text-slate-300 mb-1.5">
                        Senha Inicial <span className="text-rose-400">*</span>
                      </label>
                      <input
                        type="password"
                        required
                        placeholder="••••••••••••"
                        value={userForm.password}
                        onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white focus:border-brand-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block font-semibold text-slate-300 mb-1.5">
                        Nome <span className="text-rose-400">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="ex: Carlos"
                        value={userForm.first_name}
                        onChange={(e) => setUserForm({ ...userForm, first_name: e.target.value })}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white focus:border-brand-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block font-semibold text-slate-300 mb-1.5">
                        Sobrenome
                      </label>
                      <input
                        type="text"
                        placeholder="ex: Silva"
                        value={userForm.last_name}
                        onChange={(e) => setUserForm({ ...userForm, last_name: e.target.value })}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white focus:border-brand-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-300 mb-1.5">
                      Email
                    </label>
                    <input
                      type="email"
                      placeholder="ex: carlos.silva@empresa.com"
                      value={userForm.email}
                      onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white focus:border-brand-500 focus:outline-none"
                    />
                  </div>

                  {/* Groups Multi-Select */}
                  <div>
                    <label className="block font-semibold text-slate-300 mb-1.5">
                      Associação a Grupos (sys_user_grmember)
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3 rounded-xl bg-slate-900 border border-slate-800 max-h-48 overflow-y-auto">
                      {groups.map((g) => {
                        const isChecked = userForm.group_ids.includes(g.sys_id);
                        return (
                          <label
                            key={g.sys_id}
                            className="flex items-center space-x-2 text-slate-300 cursor-pointer select-none p-1.5 rounded hover:bg-slate-800"
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setUserForm({
                                    ...userForm,
                                    group_ids: [...userForm.group_ids, g.sys_id],
                                  });
                                } else {
                                  setUserForm({
                                    ...userForm,
                                    group_ids: userForm.group_ids.filter((id) => id !== g.sys_id),
                                  });
                                }
                              }}
                              className="rounded bg-slate-800 border-slate-700 text-brand-500 focus:ring-0"
                            />
                            <span className="font-medium text-xs text-white">{g.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  <div className="pt-1 flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="user_active_new"
                      checked={userForm.is_active}
                      onChange={(e) => setUserForm({ ...userForm, is_active: e.target.checked })}
                      className="rounded bg-slate-800 border-slate-700 text-brand-500 focus:ring-0"
                    />
                    <label htmlFor="user_active_new" className="text-slate-300 select-none cursor-pointer">
                      Usuário Ativo (is_active)
                    </label>
                  </div>

                  <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-800">
                    <button
                      type="button"
                      onClick={() => setMode('list')}
                      className="px-4 py-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-semibold transition-all shadow-glow-sm"
                    >
                      <Save className="w-4 h-4" />
                      <span>Criar Usuário</span>
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* User Details Page (In-place edit, preserving positions) */}
          {mode === 'detail' && selectedUser && (
            <div className="max-w-3xl mx-auto space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center space-x-3">
                  <button
                    onClick={() => setMode('list')}
                    className="p-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white transition-colors"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <div>
                    <div className="flex items-center space-x-2.5">
                      <h2 className="text-lg font-bold text-white">
                        {selectedUser.first_name} {selectedUser.last_name}
                      </h2>
                      <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-800 text-brand-300 border border-slate-700">
                        @{selectedUser.user_name}
                      </span>
                      {selectedUser.is_active ? (
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          Ativo
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                          Inativo
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      ID: <span className="font-mono text-[10px]">{selectedUser.sys_id}</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-3">
                  {!isEditing ? (
                    <>
                      <button
                        onClick={() => setIsEditing(true)}
                        className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-colors"
                      >
                        <Edit3 className="w-3.5 h-3.5 text-brand-400" />
                        <span>Editar Usuário</span>
                      </button>
                      {selectedUser.user_name !== 'admin' && (
                        <button
                          onClick={handleDeleteUser}
                          className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 text-xs font-medium border border-rose-500/20 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                          <span>Excluir Usuário</span>
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => setIsEditing(false)}
                        className="px-3.5 py-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 text-xs transition-colors"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={handleUpdateUser}
                        className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-glow-sm transition-all"
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>Salvar Usuário</span>
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Form Preserving Layout */}
              <div className="glass-panel rounded-2xl border border-slate-800 p-6 space-y-5 shadow-2xl">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                  <UserIcon className="w-3.5 h-3.5 text-brand-400" />
                  <span>Dados do Usuário</span>
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                      Login (user_name)
                    </label>
                    <div className="px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 font-mono text-xs">
                      {selectedUser.user_name}
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                      Senha (Hash bcrypt)
                    </label>
                    {isEditing ? (
                      <input
                        type="password"
                        placeholder="Deixe em branco para não alterar"
                        value={userForm.password}
                        onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-brand-500 text-white focus:outline-none"
                      />
                    ) : (
                      <div className="px-3.5 py-2.5 rounded-xl bg-slate-900/60 border border-slate-800 text-slate-500 text-xs">
                        •••••••••••••••• (criptografada com segurança)
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                      Nome (first_name)
                    </label>
                    {isEditing ? (
                      <input
                        type="text"
                        value={userForm.first_name}
                        onChange={(e) => setUserForm({ ...userForm, first_name: e.target.value })}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-brand-500 text-white focus:outline-none"
                      />
                    ) : (
                      <div className="px-3.5 py-2.5 rounded-xl bg-slate-900/60 border border-slate-800 text-white text-xs">
                        {selectedUser.first_name}
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                      Sobrenome (last_name)
                    </label>
                    {isEditing ? (
                      <input
                        type="text"
                        value={userForm.last_name}
                        onChange={(e) => setUserForm({ ...userForm, last_name: e.target.value })}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-brand-500 text-white focus:outline-none"
                      />
                    ) : (
                      <div className="px-3.5 py-2.5 rounded-xl bg-slate-900/60 border border-slate-800 text-white text-xs">
                        {selectedUser.last_name || '-'}
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                    Email
                  </label>
                  {isEditing ? (
                    <input
                      type="email"
                      value={userForm.email}
                      onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-brand-500 text-white focus:outline-none"
                    />
                  ) : (
                    <div className="px-3.5 py-2.5 rounded-xl bg-slate-900/60 border border-slate-800 text-white text-xs">
                      {selectedUser.email || '-'}
                    </div>
                  )}
                </div>

                {/* Groups Assignment */}
                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-2">
                    Grupos de Pertencimento (sys_user_grmember)
                  </label>
                  {isEditing ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3 rounded-xl bg-slate-900 border border-slate-800 max-h-48 overflow-y-auto">
                      {groups.map((g) => {
                        const isChecked = userForm.group_ids.includes(g.sys_id);
                        return (
                          <label
                            key={g.sys_id}
                            className="flex items-center space-x-2 text-slate-300 cursor-pointer select-none p-1.5 rounded hover:bg-slate-800"
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setUserForm({
                                    ...userForm,
                                    group_ids: [...userForm.group_ids, g.sys_id],
                                  });
                                } else {
                                  setUserForm({
                                    ...userForm,
                                    group_ids: userForm.group_ids.filter((id) => id !== g.sys_id),
                                  });
                                }
                              }}
                              className="rounded bg-slate-800 border-slate-700 text-brand-500 focus:ring-0"
                            />
                            <span className="font-medium text-xs text-white">{g.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {(selectedUser.groups || []).map((g: any) => (
                        <span
                          key={g.sys_id}
                          className="px-3 py-1 rounded-lg text-xs bg-slate-800 text-brand-300 border border-slate-700 flex items-center gap-1.5"
                        >
                          <FolderKanban className="w-3 h-3 text-brand-400" />
                          <span>{g.name}</span>
                        </span>
                      ))}
                      {(!selectedUser.groups || selectedUser.groups.length === 0) && (
                        <span className="text-xs text-slate-500">Nenhum grupo associado.</span>
                      )}
                    </div>
                  )}
                </div>

                <div className="pt-2 flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="user_active_edit"
                    disabled={!isEditing}
                    checked={isEditing ? userForm.is_active : selectedUser.is_active}
                    onChange={(e) => setUserForm({ ...userForm, is_active: e.target.checked })}
                    className="rounded bg-slate-800 border-slate-700 text-brand-500 focus:ring-0 disabled:opacity-60"
                  />
                  <label htmlFor="user_active_edit" className="text-slate-300 text-xs select-none">
                    Usuário Ativo no Sistema (is_active)
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. GROUPS SECTION */}
      {/* ========================================================================= */}
      {activeTab === 'groups' && (
        <div>
          {mode === 'list' && (
            <div className="space-y-4">
              <div className="relative max-w-md">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Buscar grupos por nome ou descrição..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-900/80 border border-slate-800 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                />
              </div>

              {loading ? (
                <div className="p-8 text-center text-xs text-slate-400">Carregando grupos...</div>
              ) : groups.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400 glass-panel rounded-2xl">
                  Nenhum grupo cadastrado.
                </div>
              ) : (
                <div className="overflow-x-auto border border-slate-800 rounded-2xl glass-panel">
                  <table className="w-full text-left text-xs text-slate-300">
                    <thead className="bg-slate-900/80 text-[11px] font-semibold text-slate-400 border-b border-slate-800">
                      <tr>
                        <th className="py-3 px-4">Nome do Grupo</th>
                        <th className="py-3 px-4">Descrição</th>
                        <th className="py-3 px-4">Papéis (Roles) Atribuídos</th>
                        <th className="py-3 px-4 text-center">Status</th>
                        <th className="py-3 px-4 text-right">Ação</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-sans">
                      {groups
                        .filter(
                          (g) =>
                            g.name?.toLowerCase().includes(search.toLowerCase()) ||
                            g.description?.toLowerCase().includes(search.toLowerCase())
                        )
                        .map((g) => (
                          <tr
                            key={g.sys_id}
                            onClick={() => handleOpenGroupDetail(g)}
                            className="hover:bg-slate-800/40 cursor-pointer transition-colors"
                          >
                            <td className="py-2.5 px-4 font-semibold text-white flex items-center gap-2">
                              <FolderKanban className="w-3.5 h-3.5 text-brand-400" />
                              <span>{g.name}</span>
                            </td>
                            <td className="py-2.5 px-4 text-slate-400">{g.description || '-'}</td>
                            <td className="py-2.5 px-4">
                              <div className="flex flex-wrap gap-1">
                                {(g.roles || []).map((r: any) => (
                                  <span
                                    key={r.sys_id}
                                    className="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300 border border-slate-700"
                                  >
                                    {r.name}
                                  </span>
                                ))}
                                {(!g.roles || g.roles.length === 0) && (
                                  <span className="text-slate-500 text-[11px]">-</span>
                                )}
                              </div>
                            </td>
                            <td className="py-2.5 px-4 text-center">
                              {g.is_active ? (
                                <span className="px-2 py-0.5 rounded-full text-[9px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                  Ativo
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full text-[9px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                                  Inativo
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-4 text-right">
                              <button className="text-brand-400 hover:text-brand-300 font-medium text-[11px]">
                                Ver / Editar &rarr;
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Group Create Page */}
          {mode === 'new' && (
            <div className="max-w-2xl mx-auto space-y-6">
              <div className="flex items-center space-x-4">
                <button
                  onClick={() => setMode('list')}
                  className="p-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div>
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <FolderKanban className="w-5 h-5 text-brand-400" />
                    <span>Criar Novo Grupo de Acesso (sys_user_group)</span>
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Grupos agrupam usuários e herdam permissões através dos papéis concedidos.
                  </p>
                </div>
              </div>

              <div className="glass-panel rounded-2xl border border-slate-800 p-6 shadow-2xl">
                <form onSubmit={handleCreateGroup} className="space-y-4 text-xs">
                  <div>
                    <label className="block font-semibold text-slate-300 mb-1.5">
                      Nome do Grupo <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="ex: Gestão de Incidentes, Desenvolvedores"
                      value={groupForm.name}
                      onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white focus:border-brand-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-300 mb-1.5">
                      Descrição do Grupo
                    </label>
                    <textarea
                      rows={2}
                      placeholder="Finalidade operacional ou responsabilidades do grupo..."
                      value={groupForm.description}
                      onChange={(e) => setGroupForm({ ...groupForm, description: e.target.value })}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white focus:border-brand-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-300 mb-1.5">
                      Vincular Papéis (sys_group_has_role)
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3 rounded-xl bg-slate-900 border border-slate-800 max-h-48 overflow-y-auto">
                      {roles.map((r) => {
                        const isChecked = groupForm.role_ids.includes(r.sys_id);
                        return (
                          <label
                            key={r.sys_id}
                            className="flex items-center space-x-2 text-slate-300 cursor-pointer select-none p-1.5 rounded hover:bg-slate-800"
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setGroupForm({
                                    ...groupForm,
                                    role_ids: [...groupForm.role_ids, r.sys_id],
                                  });
                                } else {
                                  setGroupForm({
                                    ...groupForm,
                                    role_ids: groupForm.role_ids.filter((id) => id !== r.sys_id),
                                  });
                                }
                              }}
                              className="rounded bg-slate-800 border-slate-700 text-brand-500 focus:ring-0"
                            />
                            <span className="font-medium text-xs text-white">{r.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  <div className="pt-1 flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="grp_active_new"
                      checked={groupForm.is_active}
                      onChange={(e) => setGroupForm({ ...groupForm, is_active: e.target.checked })}
                      className="rounded bg-slate-800 border-slate-700 text-brand-500 focus:ring-0"
                    />
                    <label htmlFor="grp_active_new" className="text-slate-300 select-none cursor-pointer">
                      Grupo Ativo (is_active)
                    </label>
                  </div>

                  <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-800">
                    <button
                      type="button"
                      onClick={() => setMode('list')}
                      className="px-4 py-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-semibold transition-all shadow-glow-sm"
                    >
                      <Save className="w-4 h-4" />
                      <span>Criar Grupo</span>
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Group Details Page (In-place edit) */}
          {mode === 'detail' && selectedGroup && (
            <div className="max-w-2xl mx-auto space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center space-x-3">
                  <button
                    onClick={() => setMode('list')}
                    className="p-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white transition-colors"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <div>
                    <div className="flex items-center space-x-2.5">
                      <h2 className="text-lg font-bold text-white">{selectedGroup.name}</h2>
                      {selectedGroup.is_active ? (
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          Ativo
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                          Inativo
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      ID: <span className="font-mono text-[10px]">{selectedGroup.sys_id}</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-3">
                  {!isEditing ? (
                    <>
                      <button
                        onClick={() => setIsEditing(true)}
                        className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-colors"
                      >
                        <Edit3 className="w-3.5 h-3.5 text-brand-400" />
                        <span>Editar Grupo</span>
                      </button>
                      <button
                        onClick={handleDeleteGroup}
                        className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 text-xs font-medium border border-rose-500/20 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                        <span>Excluir Grupo</span>
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => setIsEditing(false)}
                        className="px-3.5 py-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 text-xs transition-colors"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={handleUpdateGroup}
                        className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-glow-sm transition-all"
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>Salvar Grupo</span>
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="glass-panel rounded-2xl border border-slate-800 p-6 space-y-5 shadow-2xl">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                  <FolderKanban className="w-3.5 h-3.5 text-brand-400" />
                  <span>Dados do Grupo</span>
                </h3>

                <div className="space-y-4 text-xs">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                      Nome do Grupo
                    </label>
                    {isEditing ? (
                      <input
                        type="text"
                        value={groupForm.name}
                        onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-brand-500 text-white focus:outline-none"
                      />
                    ) : (
                      <div className="px-3.5 py-2.5 rounded-xl bg-slate-900/60 border border-slate-800 text-white text-xs">
                        {selectedGroup.name}
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                      Descrição
                    </label>
                    {isEditing ? (
                      <textarea
                        rows={2}
                        value={groupForm.description}
                        onChange={(e) =>
                          setGroupForm({ ...groupForm, description: e.target.value })
                        }
                        className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-brand-500 text-white focus:outline-none"
                      />
                    ) : (
                      <div className="px-3.5 py-2.5 rounded-xl bg-slate-900/60 border border-slate-800 text-slate-300 text-xs">
                        {selectedGroup.description || '(nenhuma descrição)'}
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-2">
                      Papéis Vinculados (sys_group_has_role)
                    </label>
                    {isEditing ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3 rounded-xl bg-slate-900 border border-slate-800 max-h-48 overflow-y-auto">
                        {roles.map((r) => {
                          const isChecked = groupForm.role_ids.includes(r.sys_id);
                          return (
                            <label
                              key={r.sys_id}
                              className="flex items-center space-x-2 text-slate-300 cursor-pointer select-none p-1.5 rounded hover:bg-slate-800"
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setGroupForm({
                                      ...groupForm,
                                      role_ids: [...groupForm.role_ids, r.sys_id],
                                    });
                                  } else {
                                    setGroupForm({
                                      ...groupForm,
                                      role_ids: groupForm.role_ids.filter((id) => id !== r.sys_id),
                                    });
                                  }
                                }}
                                className="rounded bg-slate-800 border-slate-700 text-brand-500 focus:ring-0"
                              />
                              <span className="font-medium text-xs text-white">{r.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {(selectedGroup.roles || []).map((r: any) => (
                          <span
                            key={r.sys_id}
                            className="px-3 py-1 rounded-lg text-xs bg-slate-800 text-brand-300 border border-slate-700 flex items-center gap-1.5"
                          >
                            <Key className="w-3 h-3 text-brand-400" />
                            <span>{r.name}</span>
                          </span>
                        ))}
                        {(!selectedGroup.roles || selectedGroup.roles.length === 0) && (
                          <span className="text-xs text-slate-500">Nenhum papel atribuído.</span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="pt-2 flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="grp_active_edit"
                      disabled={!isEditing}
                      checked={isEditing ? groupForm.is_active : selectedGroup.is_active}
                      onChange={(e) => setGroupForm({ ...groupForm, is_active: e.target.checked })}
                      className="rounded bg-slate-800 border-slate-700 text-brand-500 focus:ring-0 disabled:opacity-60"
                    />
                    <label htmlFor="grp_active_edit" className="text-slate-300 text-xs select-none">
                      Grupo Ativo (is_active)
                    </label>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* 3. ROLES SECTION */}
      {/* ========================================================================= */}
      {activeTab === 'roles' && (
        <div>
          {mode === 'list' && (
            <div className="space-y-4">
              <div className="relative max-w-md">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Buscar papéis por nome ou descrição..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-900/80 border border-slate-800 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                />
              </div>

              {loading ? (
                <div className="p-8 text-center text-xs text-slate-400">Carregando papéis...</div>
              ) : roles.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400 glass-panel rounded-2xl">
                  Nenhum papel cadastrado.
                </div>
              ) : (
                <div className="overflow-x-auto border border-slate-800 rounded-2xl glass-panel">
                  <table className="w-full text-left text-xs text-slate-300">
                    <thead className="bg-slate-900/80 text-[11px] font-semibold text-slate-400 border-b border-slate-800">
                      <tr>
                        <th className="py-3 px-4">Nome do Papel (Role)</th>
                        <th className="py-3 px-4">Descrição</th>
                        <th className="py-3 px-4">Permissões Vinculadas</th>
                        <th className="py-3 px-4 text-center">Status</th>
                        <th className="py-3 px-4 text-right">Ação</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-sans">
                      {roles
                        .filter(
                          (r) =>
                            r.name?.toLowerCase().includes(search.toLowerCase()) ||
                            r.description?.toLowerCase().includes(search.toLowerCase())
                        )
                        .map((r) => (
                          <tr
                            key={r.sys_id}
                            onClick={() => handleOpenRoleDetail(r)}
                            className="hover:bg-slate-800/40 cursor-pointer transition-colors"
                          >
                            <td className="py-2.5 px-4 font-mono font-semibold text-brand-300 flex items-center gap-2">
                              <Key className="w-3.5 h-3.5 text-brand-400" />
                              <span>{r.name}</span>
                            </td>
                            <td className="py-2.5 px-4 text-slate-400">{r.description || '-'}</td>
                            <td className="py-2.5 px-4">
                              <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                                {(r.permissions || []).length} regras ACL
                              </span>
                            </td>
                            <td className="py-2.5 px-4 text-center">
                              {r.is_active ? (
                                <span className="px-2 py-0.5 rounded-full text-[9px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                  Ativo
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full text-[9px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                                  Inativo
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-4 text-right">
                              <button className="text-brand-400 hover:text-brand-300 font-medium text-[11px]">
                                Ver / Editar &rarr;
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Role Create Page */}
          {mode === 'new' && (
            <div className="max-w-2xl mx-auto space-y-6">
              <div className="flex items-center space-x-4">
                <button
                  onClick={() => setMode('list')}
                  className="p-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div>
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <Key className="w-5 h-5 text-brand-400" />
                    <span>Criar Novo Papel / Role (sys_user_role)</span>
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Roles definem conjuntos reutilizáveis de autorizações de negócio e sistema.
                  </p>
                </div>
              </div>

              <div className="glass-panel rounded-2xl border border-slate-800 p-6 shadow-2xl">
                <form onSubmit={handleCreateRole} className="space-y-4 text-xs">
                  <div>
                    <label className="block font-semibold text-slate-300 mb-1.5">
                      Nome Técnico da Role <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="ex: itil, incident_manager, security_admin"
                      value={roleForm.name}
                      onChange={(e) => setRoleForm({ ...roleForm, name: e.target.value })}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono focus:border-brand-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-300 mb-1.5">
                      Descrição da Role
                    </label>
                    <textarea
                      rows={2}
                      placeholder="Finalidade e autorizações concedidas..."
                      value={roleForm.description}
                      onChange={(e) => setRoleForm({ ...roleForm, description: e.target.value })}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white focus:border-brand-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-300 mb-1.5">
                      Conceder Permissões (sys_role_has_permission)
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3 rounded-xl bg-slate-900 border border-slate-800 max-h-48 overflow-y-auto">
                      {permissions.map((p) => {
                        const isChecked = roleForm.permission_ids.includes(p.sys_id);
                        return (
                          <label
                            key={p.sys_id}
                            className="flex items-center space-x-2 text-slate-300 cursor-pointer select-none p-1.5 rounded hover:bg-slate-800"
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setRoleForm({
                                    ...roleForm,
                                    permission_ids: [...roleForm.permission_ids, p.sys_id],
                                  });
                                } else {
                                  setRoleForm({
                                    ...roleForm,
                                    permission_ids: roleForm.permission_ids.filter(
                                      (id) => id !== p.sys_id
                                    ),
                                  });
                                }
                              }}
                              className="rounded bg-slate-800 border-slate-700 text-brand-500 focus:ring-0"
                            />
                            <div className="min-w-0">
                              <p className="font-medium text-xs text-white truncate">{p.name}</p>
                              <p className="text-[10px] text-slate-400 font-mono">
                                {p.operation} • {p.type}
                              </p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  <div className="pt-1 flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="role_active_new"
                      checked={roleForm.is_active}
                      onChange={(e) => setRoleForm({ ...roleForm, is_active: e.target.checked })}
                      className="rounded bg-slate-800 border-slate-700 text-brand-500 focus:ring-0"
                    />
                    <label htmlFor="role_active_new" className="text-slate-300 select-none cursor-pointer">
                      Papel Ativo (is_active)
                    </label>
                  </div>

                  <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-800">
                    <button
                      type="button"
                      onClick={() => setMode('list')}
                      className="px-4 py-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-semibold transition-all shadow-glow-sm"
                    >
                      <Save className="w-4 h-4" />
                      <span>Criar Papel</span>
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Role Details Page (In-place edit) */}
          {mode === 'detail' && selectedRole && (
            <div className="max-w-2xl mx-auto space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center space-x-3">
                  <button
                    onClick={() => setMode('list')}
                    className="p-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white transition-colors"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <div>
                    <div className="flex items-center space-x-2.5">
                      <h2 className="text-lg font-bold text-white">{selectedRole.name}</h2>
                      {selectedRole.is_active ? (
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          Ativo
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                          Inativo
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      ID: <span className="font-mono text-[10px]">{selectedRole.sys_id}</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-3">
                  {!isEditing ? (
                    <>
                      <button
                        onClick={() => setIsEditing(true)}
                        className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-colors"
                      >
                        <Edit3 className="w-3.5 h-3.5 text-brand-400" />
                        <span>Editar Papel</span>
                      </button>
                      {selectedRole.name !== 'admin' && (
                        <button
                          onClick={handleDeleteRole}
                          className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 text-xs font-medium border border-rose-500/20 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                          <span>Excluir Papel</span>
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => setIsEditing(false)}
                        className="px-3.5 py-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 text-xs transition-colors"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={handleUpdateRole}
                        className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-glow-sm transition-all"
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>Salvar Papel</span>
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="glass-panel rounded-2xl border border-slate-800 p-6 space-y-5 shadow-2xl">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                  <Key className="w-3.5 h-3.5 text-brand-400" />
                  <span>Dados do Papel</span>
                </h3>

                <div className="space-y-4 text-xs">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                      Nome Técnico (Role)
                    </label>
                    {isEditing ? (
                      <input
                        type="text"
                        value={roleForm.name}
                        onChange={(e) => setRoleForm({ ...roleForm, name: e.target.value })}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-brand-500 text-white font-mono focus:outline-none"
                      />
                    ) : (
                      <div className="px-3.5 py-2.5 rounded-xl bg-slate-900/60 border border-slate-800 text-white font-mono text-xs">
                        {selectedRole.name}
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                      Descrição
                    </label>
                    {isEditing ? (
                      <textarea
                        rows={2}
                        value={roleForm.description}
                        onChange={(e) =>
                          setRoleForm({ ...roleForm, description: e.target.value })
                        }
                        className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-brand-500 text-white focus:outline-none"
                      />
                    ) : (
                      <div className="px-3.5 py-2.5 rounded-xl bg-slate-900/60 border border-slate-800 text-slate-300 text-xs">
                        {selectedRole.description || '(nenhuma descrição)'}
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-2">
                      Permissões ACL Concedidas (sys_role_has_permission)
                    </label>
                    {isEditing ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3 rounded-xl bg-slate-900 border border-slate-800 max-h-48 overflow-y-auto">
                        {permissions.map((p) => {
                          const isChecked = roleForm.permission_ids.includes(p.sys_id);
                          return (
                            <label
                              key={p.sys_id}
                              className="flex items-center space-x-2 text-slate-300 cursor-pointer select-none p-1.5 rounded hover:bg-slate-800"
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setRoleForm({
                                      ...roleForm,
                                      permission_ids: [...roleForm.permission_ids, p.sys_id],
                                    });
                                  } else {
                                    setRoleForm({
                                      ...roleForm,
                                      permission_ids: roleForm.permission_ids.filter(
                                        (id) => id !== p.sys_id
                                      ),
                                    });
                                  }
                                }}
                                className="rounded bg-slate-800 border-slate-700 text-brand-500 focus:ring-0"
                              />
                              <div className="min-w-0">
                                <p className="font-medium text-xs text-white truncate">{p.name}</p>
                                <p className="text-[10px] text-slate-400 font-mono">
                                  {p.operation} • {p.type}
                                </p>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {(selectedRole.permissions || []).map((p: any) => (
                          <span
                            key={p.sys_id}
                            className="px-3 py-1 rounded-lg text-xs bg-slate-800 text-indigo-300 border border-slate-700 flex items-center gap-1.5"
                          >
                            <Lock className="w-3 h-3 text-indigo-400" />
                            <span>{p.name}</span>
                          </span>
                        ))}
                        {(!selectedRole.permissions || selectedRole.permissions.length === 0) && (
                          <span className="text-xs text-slate-500">Nenhuma permissão concedida.</span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="pt-2 flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="role_active_edit"
                      disabled={!isEditing}
                      checked={isEditing ? roleForm.is_active : selectedRole.is_active}
                      onChange={(e) => setRoleForm({ ...roleForm, is_active: e.target.checked })}
                      className="rounded bg-slate-800 border-slate-700 text-brand-500 focus:ring-0 disabled:opacity-60"
                    />
                    <label htmlFor="role_active_edit" className="text-slate-300 text-xs select-none">
                      Papel Ativo (is_active)
                    </label>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* 4. PERMISSIONS SECTION */}
      {/* ========================================================================= */}
      {activeTab === 'permissions' && (
        <div>
          {mode === 'list' && (
            <div className="space-y-4">
              <div className="relative max-w-md">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Buscar permissões..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-900/80 border border-slate-800 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                />
              </div>

              {loading ? (
                <div className="p-8 text-center text-xs text-slate-400">Carregando permissões...</div>
              ) : permissions.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400 glass-panel rounded-2xl">
                  Nenhuma permissão cadastrada.
                </div>
              ) : (
                <div className="overflow-x-auto border border-slate-800 rounded-2xl glass-panel">
                  <table className="w-full text-left text-xs text-slate-300">
                    <thead className="bg-slate-900/80 text-[11px] font-semibold text-slate-400 border-b border-slate-800">
                      <tr>
                        <th className="py-3 px-4">Nome da Permissão</th>
                        <th className="py-3 px-4">Operação</th>
                        <th className="py-3 px-4">Tipo</th>
                        <th className="py-3 px-4">Tabela Alvo</th>
                        <th className="py-3 px-4">Descrição</th>
                        <th className="py-3 px-4 text-right">Ação</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-sans">
                      {permissions
                        .filter(
                          (p) =>
                            p.name?.toLowerCase().includes(search.toLowerCase()) ||
                            p.operation?.toLowerCase().includes(search.toLowerCase()) ||
                            p.description?.toLowerCase().includes(search.toLowerCase())
                        )
                        .map((p) => {
                          const targetTable = tables.find((t) => t.sys_id === p.table_id);
                          return (
                            <tr
                              key={p.sys_id}
                              onClick={() => handleOpenPermDetail(p)}
                              className="hover:bg-slate-800/40 cursor-pointer transition-colors"
                            >
                              <td className="py-2.5 px-4 font-semibold text-white flex items-center gap-2">
                                <Lock className="w-3.5 h-3.5 text-indigo-400" />
                                <span>{p.name}</span>
                              </td>
                              <td className="py-2.5 px-4">
                                <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-slate-800 text-brand-300 border border-slate-700">
                                  {p.operation}
                                </span>
                              </td>
                              <td className="py-2.5 px-4 font-mono text-[11px] text-slate-300">
                                {p.type}
                              </td>
                              <td className="py-2.5 px-4 font-mono text-[11px] text-slate-300">
                                {targetTable?.name || p.table_id || 'Todas (*) '}
                              </td>
                              <td className="py-2.5 px-4 text-slate-400 max-w-xs truncate">
                                {p.description || '-'}
                              </td>
                              <td className="py-2.5 px-4 text-right">
                                <button className="text-brand-400 hover:text-brand-300 font-medium text-[11px]">
                                  Ver / Editar &rarr;
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Permission Create Page */}
          {mode === 'new' && (
            <div className="max-w-2xl mx-auto space-y-6">
              <div className="flex items-center space-x-4">
                <button
                  onClick={() => setMode('list')}
                  className="p-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div>
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <Lock className="w-5 h-5 text-indigo-400" />
                    <span>Criar Nova Permissão ACL (sys_permission)</span>
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Permissões granulares para operações CRUD em tabelas e campos com suporte a regras de script.
                  </p>
                </div>
              </div>

              <div className="glass-panel rounded-2xl border border-slate-800 p-6 shadow-2xl">
                <form onSubmit={handleCreatePerm} className="space-y-4 text-xs">
                  <div>
                    <label className="block font-semibold text-slate-300 mb-1.5">
                      Nome da Permissão <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="ex: incident.read, problem.create"
                      value={permForm.name}
                      onChange={(e) => setPermForm({ ...permForm, name: e.target.value })}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono focus:border-brand-500 focus:outline-none"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block font-semibold text-slate-300 mb-1.5">
                        Operação
                      </label>
                      <select
                        value={permForm.operation}
                        onChange={(e) => setPermForm({ ...permForm, operation: e.target.value })}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono focus:border-brand-500 focus:outline-none"
                      >
                        <option value="read">read (Leitura)</option>
                        <option value="create">create (Inserção)</option>
                        <option value="update">update (Edição)</option>
                        <option value="delete">delete (Exclusão)</option>
                        <option value="execute">execute (Transição/Script)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block font-semibold text-slate-300 mb-1.5">
                        Tipo
                      </label>
                      <select
                        value={permForm.type}
                        onChange={(e) => setPermForm({ ...permForm, type: e.target.value })}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono focus:border-brand-500 focus:outline-none"
                      >
                        <option value="table">table (Tabela)</option>
                        <option value="field">field (Campo)</option>
                        <option value="script">script (Script/Regra)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block font-semibold text-slate-300 mb-1.5">
                        Tabela Alvo
                      </label>
                      <select
                        value={permForm.table_id}
                        onChange={(e) => setPermForm({ ...permForm, table_id: e.target.value })}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white focus:border-brand-500 focus:outline-none"
                      >
                        <option value="">Todas (*) / Global</option>
                        {tables.map((t) => (
                          <option key={t.sys_id} value={t.sys_id}>
                            {t.label} ({t.name})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-300 mb-1.5">
                      Descrição
                    </label>
                    <textarea
                      rows={2}
                      placeholder="Finalidade e escopo desta regra..."
                      value={permForm.description}
                      onChange={(e) => setPermForm({ ...permForm, description: e.target.value })}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white focus:border-brand-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-300 mb-1.5">
                      Condição Adicional em Script (Opcional)
                    </label>
                    <textarea
                      rows={2}
                      placeholder="ex: current.caller_id == gs.getUserID()"
                      value={permForm.script_condition}
                      onChange={(e) =>
                        setPermForm({ ...permForm, script_condition: e.target.value })
                      }
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono focus:border-brand-500 focus:outline-none"
                    />
                  </div>

                  <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-800">
                    <button
                      type="button"
                      onClick={() => setMode('list')}
                      className="px-4 py-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-semibold transition-all shadow-glow-sm"
                    >
                      <Save className="w-4 h-4" />
                      <span>Criar Permissão</span>
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Permission Details Page (In-place edit) */}
          {mode === 'detail' && selectedPermission && (
            <div className="max-w-2xl mx-auto space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center space-x-3">
                  <button
                    onClick={() => setMode('list')}
                    className="p-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white transition-colors"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <div>
                    <div className="flex items-center space-x-2.5">
                      <h2 className="text-lg font-bold text-white">{selectedPermission.name}</h2>
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-slate-800 text-brand-300 border border-slate-700">
                        {selectedPermission.operation}
                      </span>
                      <span className="font-mono text-xs px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                        {selectedPermission.type}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      ID: <span className="font-mono text-[10px]">{selectedPermission.sys_id}</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-3">
                  {!isEditing ? (
                    <>
                      <button
                        onClick={() => setIsEditing(true)}
                        className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-colors"
                      >
                        <Edit3 className="w-3.5 h-3.5 text-brand-400" />
                        <span>Editar Permissão</span>
                      </button>
                      <button
                        onClick={handleDeletePerm}
                        className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 text-xs font-medium border border-rose-500/20 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                        <span>Excluir Permissão</span>
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => setIsEditing(false)}
                        className="px-3.5 py-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 text-xs transition-colors"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={handleUpdatePerm}
                        className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-glow-sm transition-all"
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>Salvar Permissão</span>
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="glass-panel rounded-2xl border border-slate-800 p-6 space-y-5 shadow-2xl">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                  <Lock className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Dados da Regra ACL</span>
                </h3>

                <div className="space-y-4 text-xs">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                      Nome da Permissão
                    </label>
                    {isEditing ? (
                      <input
                        type="text"
                        value={permForm.name}
                        onChange={(e) => setPermForm({ ...permForm, name: e.target.value })}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-brand-500 text-white font-mono focus:outline-none"
                      />
                    ) : (
                      <div className="px-3.5 py-2.5 rounded-xl bg-slate-900/60 border border-slate-800 text-white font-mono text-xs">
                        {selectedPermission.name}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                        Operação
                      </label>
                      {isEditing ? (
                        <select
                          value={permForm.operation}
                          onChange={(e) =>
                            setPermForm({ ...permForm, operation: e.target.value })
                          }
                          className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-brand-500 text-white font-mono focus:outline-none"
                        >
                          <option value="read">read</option>
                          <option value="create">create</option>
                          <option value="update">update</option>
                          <option value="delete">delete</option>
                          <option value="execute">execute</option>
                        </select>
                      ) : (
                        <div className="px-3.5 py-2.5 rounded-xl bg-slate-900/60 border border-slate-800 text-brand-300 font-mono text-xs uppercase">
                          {selectedPermission.operation}
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                        Tipo
                      </label>
                      {isEditing ? (
                        <select
                          value={permForm.type}
                          onChange={(e) => setPermForm({ ...permForm, type: e.target.value })}
                          className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-brand-500 text-white font-mono focus:outline-none"
                        >
                          <option value="table">table</option>
                          <option value="field">field</option>
                          <option value="script">script</option>
                        </select>
                      ) : (
                        <div className="px-3.5 py-2.5 rounded-xl bg-slate-900/60 border border-slate-800 text-slate-300 font-mono text-xs">
                          {selectedPermission.type}
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                        Tabela Alvo
                      </label>
                      {isEditing ? (
                        <select
                          value={permForm.table_id}
                          onChange={(e) => setPermForm({ ...permForm, table_id: e.target.value })}
                          className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-brand-500 text-white focus:outline-none"
                        >
                          <option value="">Todas (*) / Global</option>
                          {tables.map((t) => (
                            <option key={t.sys_id} value={t.sys_id}>
                              {t.label} ({t.name})
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div className="px-3.5 py-2.5 rounded-xl bg-slate-900/60 border border-slate-800 text-slate-300 text-xs">
                          {tables.find((t) => t.sys_id === selectedPermission.table_id)?.label ||
                            selectedPermission.table_id ||
                            'Todas (*) / Global'}
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                      Descrição
                    </label>
                    {isEditing ? (
                      <textarea
                        rows={2}
                        value={permForm.description}
                        onChange={(e) =>
                          setPermForm({ ...permForm, description: e.target.value })
                        }
                        className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-brand-500 text-white focus:outline-none"
                      />
                    ) : (
                      <div className="px-3.5 py-2.5 rounded-xl bg-slate-900/60 border border-slate-800 text-slate-300 text-xs">
                        {selectedPermission.description || '(nenhuma descrição)'}
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                      Condição em Script
                    </label>
                    {isEditing ? (
                      <textarea
                        rows={2}
                        value={permForm.script_condition}
                        onChange={(e) =>
                          setPermForm({ ...permForm, script_condition: e.target.value })
                        }
                        className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-brand-500 text-white font-mono focus:outline-none"
                      />
                    ) : (
                      <div className="px-3.5 py-2.5 rounded-xl bg-slate-900/60 border border-slate-800 text-slate-300 font-mono text-xs">
                        {selectedPermission.script_condition || '(nenhuma condição em script)'}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
