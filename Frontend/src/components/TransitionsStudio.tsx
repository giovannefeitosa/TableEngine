'use client';

import React, { useState, useEffect } from 'react';
import { api, TableInfo } from '@/lib/api';
import {
  GitBranch,
  Plus,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  Edit3,
  Trash2,
  Save,
  Search,
  RefreshCw,
  Sliders,
} from 'lucide-react';

export function TransitionsStudio() {
  const [transitions, setTransitions] = useState<any[]>([]);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterTable, setFilterTable] = useState('');

  // Page Navigation State (No Dialogs!)
  const [activeTransition, setActiveTransition] = useState<any | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  // Form State
  const [selectedTableID, setSelectedTableID] = useState('');
  const [fromState, setFromState] = useState('new');
  const [toState, setToState] = useState('in_progress');
  const [label, setLabel] = useState('');
  const [requiredRoleID, setRequiredRoleID] = useState<string>('');
  const [isActive, setIsActive] = useState(true);
  const [conditionJSON, setConditionJSON] = useState('{\n  "operator": "AND",\n  "rules": []\n}');
  const [actionJSON, setActionJSON] = useState('{\n  "set_fields": {}\n}');

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  const fetchTransitions = async () => {
    setLoading(true);
    try {
      const [tList, tblList] = await Promise.all([
        api.fsm.listTransitions(),
        api.schema.listTables(false),
      ]);
      setTransitions(tList || []);
      setTables(tblList || []);
      if (tblList.length > 0 && !selectedTableID) {
        setSelectedTableID(tblList[0].sys_id);
      }
    } catch (err: any) {
      showToast(err.message || 'Erro ao carregar transições');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTransitions();
  }, []);

  const handleOpenDetails = async (t: any) => {
    try {
      const full = await api.fsm.getTransition(t.sys_id);
      setActiveTransition(full);
      setIsNew(false);
      setIsEditing(false);
      populateForm(full);
    } catch (err: any) {
      showToast(err.message || 'Erro ao carregar detalhes da transição');
    }
  };

  const handleNewTransition = () => {
    setActiveTransition(null);
    setIsNew(true);
    setIsEditing(true);
    setSelectedTableID(tables.length > 0 ? tables[0].sys_id : '');
    setFromState('new');
    setToState('in_progress');
    setLabel('');
    setRequiredRoleID('');
    setIsActive(true);
    setConditionJSON('{\n  "operator": "AND",\n  "rules": []\n}');
    setActionJSON('{\n  "set_fields": {}\n}');
  };

  const populateForm = (data: any) => {
    setSelectedTableID(data.table_id || '');
    setFromState(data.from_state || '');
    setToState(data.to_state || '');
    setLabel(data.label || '');
    setRequiredRoleID(data.required_role_id || '');
    setIsActive(data.is_active ?? true);
    setConditionJSON(
      data.condition_tree ? JSON.stringify(data.condition_tree, null, 2) : '{\n  "operator": "AND",\n  "rules": []\n}'
    );
    setActionJSON(
      data.on_transition_action
        ? JSON.stringify(data.on_transition_action, null, 2)
        : '{\n  "set_fields": {}\n}'
    );
  };

  const handleBackToList = () => {
    setActiveTransition(null);
    setIsNew(false);
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    if (isNew) {
      handleBackToList();
    } else {
      populateForm(activeTransition);
      setIsEditing(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      let parsedCond = null;
      if (conditionJSON.trim()) {
        try {
          parsedCond = JSON.parse(conditionJSON);
        } catch {
          throw new Error('A árvore de condições deve ser um JSON válido.');
        }
      }
      let parsedAction = null;
      if (actionJSON.trim()) {
        try {
          parsedAction = JSON.parse(actionJSON);
        } catch {
          throw new Error('A ação on_transition_action deve ser um JSON válido.');
        }
      }

      const payload = {
        table_id: selectedTableID,
        state_field: 'state',
        from_state: fromState,
        to_state: toState,
        label,
        required_role_id: requiredRoleID.trim() ? requiredRoleID.trim() : null,
        condition_tree: parsedCond,
        on_transition_action: parsedAction,
        is_active: isActive,
      };

      if (isNew) {
        const res = await api.fsm.createTransition(payload);
        showToast(`Transição '${label}' criada com sucesso!`);
        const full = await api.fsm.getTransition(res.sys_id);
        setActiveTransition(full);
        setIsNew(false);
        setIsEditing(false);
      } else {
        await api.fsm.updateTransition(activeTransition.sys_id, payload);
        showToast(`Transição '${label}' atualizada com sucesso!`);
        const full = await api.fsm.getTransition(activeTransition.sys_id);
        setActiveTransition(full);
        setIsEditing(false);
      }
      fetchTransitions();
    } catch (err: any) {
      showToast(err.message || 'Erro ao salvar transição');
    }
  };

  const handleDelete = async () => {
    if (!activeTransition) return;
    if (!confirm(`Confirma a exclusão da transição '${activeTransition.label}'?`)) {
      return;
    }
    try {
      await api.fsm.deleteTransition(activeTransition.sys_id);
      showToast('Transição excluída com sucesso!');
      handleBackToList();
      fetchTransitions();
    } catch (err: any) {
      showToast(err.message || 'Erro ao excluir transição');
    }
  };

  // -------------------------------------------------------------
  // VIEW: DETAILS / EDIT FORM PAGE (No Dialog!)
  // -------------------------------------------------------------
  if (activeTransition || isNew) {
    return (
      <div className="space-y-6">
        {/* Toast */}
        {toast && (
          <div className="fixed bottom-6 right-6 z-50 p-4 rounded-xl bg-slate-900 border border-brand-500/40 text-slate-100 text-xs shadow-2xl flex items-center space-x-3 animate-bounce">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{toast}</span>
          </div>
        )}

        {/* Top Header & Action Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <button
              onClick={handleBackToList}
              className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 transition-colors"
              title="Voltar para a listagem"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div>
              <div className="flex items-center space-x-2.5">
                <h2 className="text-xl font-bold text-white">
                  {isNew ? 'Nova Transição de Estado' : (activeTransition.label || 'Detalhes da Transição')}
                </h2>
                {!isNew && (
                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                    isActive ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30' : 'bg-slate-800 text-slate-400'
                  }`}>
                    {isActive ? 'Ativa' : 'Inativa'}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Máquina de Estados (FSM) • Controle de avanço de estados e regras guard AST
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2.5">
            {!isNew && !isEditing ? (
              <>
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow-glow-sm transition-all hover:scale-[1.02]"
                >
                  <Edit3 className="w-4 h-4" />
                  <span>Editar Transição</span>
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-xs font-medium transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Excluir</span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  className="flex items-center space-x-1.5 px-5 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow-glow-sm transition-all hover:scale-[1.02]"
                >
                  <Save className="w-4 h-4" />
                  <span>Salvar Transição</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Transition Form (Identical Position between View & Edit Mode) */}
        <form onSubmit={handleSave} className="glass-panel rounded-2xl border border-slate-800 p-6 space-y-6">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
            <h3 className="text-sm font-semibold text-white">
              {isEditing ? 'Formulário de Configuração' : 'Visualização da Regra FSM'}
            </h3>
            <span className="text-[11px] text-slate-400 font-mono">
              {isEditing ? 'Modo Interativo' : 'Modo Leitura (Clique em "Editar Transição" para alterar)'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 text-xs">
            {/* Table Selection */}
            <div>
              <label className="block font-semibold text-slate-300 mb-1.5">Tabela Alvo *</label>
              <select
                disabled={!isEditing}
                value={selectedTableID}
                onChange={(e) => setSelectedTableID(e.target.value)}
                className={`w-full px-3.5 py-2.5 rounded-xl font-sans text-white transition-colors ${
                  !isEditing
                    ? 'bg-slate-900/60 border border-slate-800 text-slate-300 cursor-default'
                    : 'bg-slate-900 border border-slate-700 focus:border-brand-500 focus:outline-none'
                }`}
              >
                {tables.map((t) => (
                  <option key={t.sys_id} value={t.sys_id}>
                    {t.label} ({t.name})
                  </option>
                ))}
              </select>
            </div>

            {/* Label */}
            <div>
              <label className="block font-semibold text-slate-300 mb-1.5">Rótulo da Ação (Botão na UI) *</label>
              <input
                type="text"
                required
                disabled={!isEditing}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Ex: Resolver Incidente"
                className={`w-full px-3.5 py-2.5 rounded-xl font-sans text-white transition-colors ${
                  !isEditing
                    ? 'bg-slate-900/60 border border-slate-800 text-slate-300 cursor-default'
                    : 'bg-slate-900 border border-slate-700 focus:border-brand-500 focus:outline-none'
                }`}
              />
            </div>

            {/* From State */}
            <div>
              <label className="block font-semibold text-slate-300 mb-1.5">Estado de Origem (from_state) *</label>
              <input
                type="text"
                required
                disabled={!isEditing}
                value={fromState}
                onChange={(e) => setFromState(e.target.value)}
                placeholder="Ex: in_progress"
                className={`w-full px-3.5 py-2.5 rounded-xl font-mono text-white transition-colors ${
                  !isEditing
                    ? 'bg-slate-900/60 border border-slate-800 text-slate-300 cursor-default'
                    : 'bg-slate-900 border border-slate-700 focus:border-brand-500 focus:outline-none'
                }`}
              />
            </div>

            {/* To State */}
            <div>
              <label className="block font-semibold text-slate-300 mb-1.5">Estado de Destino (to_state) *</label>
              <input
                type="text"
                required
                disabled={!isEditing}
                value={toState}
                onChange={(e) => setToState(e.target.value)}
                placeholder="Ex: resolved"
                className={`w-full px-3.5 py-2.5 rounded-xl font-mono text-white transition-colors ${
                  !isEditing
                    ? 'bg-slate-900/60 border border-slate-800 text-slate-300 cursor-default'
                    : 'bg-slate-900 border border-slate-700 focus:border-brand-500 focus:outline-none'
                }`}
              />
            </div>

            {/* Required Role ID */}
            <div>
              <label className="block font-semibold text-slate-300 mb-1.5">Role Exigida (Opcional - UUID)</label>
              <input
                type="text"
                disabled={!isEditing}
                value={requiredRoleID}
                onChange={(e) => setRequiredRoleID(e.target.value)}
                placeholder="Ex: 20000000-0000-0000-0000-000000000001"
                className={`w-full px-3.5 py-2.5 rounded-xl font-mono text-white transition-colors ${
                  !isEditing
                    ? 'bg-slate-900/60 border border-slate-800 text-slate-300 cursor-default'
                    : 'bg-slate-900 border border-slate-700 focus:border-brand-500 focus:outline-none'
                }`}
              />
            </div>

            {/* Is Active */}
            <div className="flex items-center pt-6">
              <label className={`flex items-center space-x-2.5 text-slate-300 select-none ${!isEditing ? 'cursor-default' : 'cursor-pointer'}`}>
                <input
                  type="checkbox"
                  disabled={!isEditing}
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-brand-500 focus:ring-0"
                />
                <span className="font-medium">Regra de Transição Ativa</span>
              </label>
            </div>

            {/* Condition Tree JSON */}
            <div className="sm:col-span-2">
              <label className="block font-semibold text-slate-300 mb-1.5">
                Árvore de Condições (Guard Condition AST - JSONB)
              </label>
              <textarea
                rows={5}
                disabled={!isEditing}
                value={conditionJSON}
                onChange={(e) => setConditionJSON(e.target.value)}
                className={`w-full px-3.5 py-2.5 rounded-xl font-mono text-xs transition-colors ${
                  !isEditing
                    ? 'bg-slate-900/60 border border-slate-800 text-indigo-300 cursor-default'
                    : 'bg-slate-950 border border-slate-700 text-emerald-400 focus:border-brand-500 focus:outline-none'
                }`}
              />
            </div>

            {/* On Transition Action JSON */}
            <div className="sm:col-span-2">
              <label className="block font-semibold text-slate-300 mb-1.5">
                Ação Mutadora Automática (on_transition_action - JSONB)
              </label>
              <textarea
                rows={4}
                disabled={!isEditing}
                value={actionJSON}
                onChange={(e) => setActionJSON(e.target.value)}
                className={`w-full px-3.5 py-2.5 rounded-xl font-mono text-xs transition-colors ${
                  !isEditing
                    ? 'bg-slate-900/60 border border-slate-800 text-indigo-300 cursor-default'
                    : 'bg-slate-950 border border-slate-700 text-emerald-400 focus:border-brand-500 focus:outline-none'
                }`}
              />
            </div>
          </div>

          {isEditing && (
            <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-800">
              <button
                type="button"
                onClick={handleCancelEdit}
                className="px-4 py-2 rounded-xl text-slate-400 hover:text-white transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-semibold shadow-glow-sm transition-all"
              >
                <Save className="w-4 h-4" />
                <span>Salvar Transição</span>
              </button>
            </div>
          )}
        </form>
      </div>
    );
  }

  // -------------------------------------------------------------
  // VIEW: TRANSITIONS LIST (Table View)
  // -------------------------------------------------------------
  const filtered = transitions.filter((t) => {
    const matchTable = filterTable ? t.table_name === filterTable : true;
    const matchSearch = search
      ? t.label?.toLowerCase().includes(search.toLowerCase()) ||
        t.from_state?.toLowerCase().includes(search.toLowerCase()) ||
        t.to_state?.toLowerCase().includes(search.toLowerCase()) ||
        t.table_name?.toLowerCase().includes(search.toLowerCase())
      : true;
    return matchTable && matchSearch;
  });

  return (
    <div className="space-y-6">
      {/* Toast */}
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
            <GitBranch className="w-5 h-5 text-brand-400" />
            <span>FSM State Transitions Designer</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Controle estrito de avanço de estados operacionais, permissões execute e regras guard declarativas (AST).
          </p>
        </div>

        <button
          onClick={handleNewTransition}
          className="flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow-glow-sm transition-all hover:scale-[1.02] active:scale-[0.98]"
        >
          <Plus className="w-4 h-4" />
          <span>Nova Transição</span>
        </button>
      </div>

      {/* Filters Bar */}
      <div className="glass-panel rounded-2xl border border-slate-800 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-1 items-center space-x-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-2.5 pointer-events-none" />
            <input
              type="text"
              placeholder="Pesquisar transições..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:border-brand-500"
            />
          </div>

          <select
            value={filterTable}
            onChange={(e) => setFilterTable(e.target.value)}
            className="px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-800 text-white text-xs focus:border-brand-500 focus:outline-none"
          >
            <option value="">Todas as Tabelas</option>
            {tables.map((t) => (
              <option key={t.sys_id} value={t.name}>
                {t.label} ({t.name})
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center space-x-3 text-xs text-slate-400">
          <span>Total: <strong className="text-white font-mono">{filtered.length}</strong></span>
          <button
            onClick={fetchTransitions}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            title="Atualizar"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Transitions List */}
      <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-900/90 text-[11px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">Tabela</th>
                <th className="py-3 px-4">Rótulo / Ação</th>
                <th className="py-3 px-4">Origem $\rightarrow$ Destino</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-400 font-sans">
                    Carregando transições FSM...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-400 font-sans">
                    Nenhuma transição encontrada. Clique em "Nova Transição" para cadastrar!
                  </td>
                </tr>
              ) : (
                filtered.map((t) => (
                  <tr
                    key={t.sys_id}
                    onClick={() => handleOpenDetails(t)}
                    className="hover:bg-slate-800/40 cursor-pointer transition-colors group"
                  >
                    <td className="py-3.5 px-4 font-bold text-white font-sans">
                      {t.table_name}
                    </td>
                    <td className="py-3.5 px-4 text-slate-200 font-sans font-medium">
                      {t.label}
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex items-center space-x-2">
                        <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[11px]">
                          {t.from_state}
                        </span>
                        <ArrowRight className="w-3 h-3 text-slate-500" />
                        <span className="px-2 py-0.5 rounded bg-brand-500/20 text-brand-300 font-mono text-[11px] font-bold">
                          {t.to_state}
                        </span>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 font-sans">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        t.is_active ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-800 text-slate-500'
                      }`}>
                        {t.is_active ? 'Ativa' : 'Inativa'}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenDetails(t);
                        }}
                        className="px-2.5 py-1 rounded bg-slate-800 hover:bg-brand-600 text-slate-300 hover:text-white transition-colors text-[11px] font-sans font-medium"
                      >
                        Abrir Detalhes
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
