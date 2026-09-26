'use client';

import React, { useState, useEffect } from 'react';
import { api, TableInfo } from '@/lib/api';
import {
  Code2,
  Plus,
  CheckCircle2,
  ArrowLeft,
  Edit3,
  Trash2,
  Save,
  Search,
  RefreshCw,
  Terminal,
} from 'lucide-react';

export function RulesStudio() {
  const [rules, setRules] = useState<any[]>([]);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterTable, setFilterTable] = useState('');

  // Page Navigation State (No Dialogs!)
  const [activeRule, setActiveRule] = useState<any | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  // Form State
  const [selectedTableID, setSelectedTableID] = useState('');
  const [name, setName] = useState('');
  const [timing, setTiming] = useState('before_insert');
  const [executionOrder, setExecutionOrder] = useState(100);
  const [executionMode, setExecutionMode] = useState('caller');
  const [runAsUserID, setRunAsUserID] = useState<string>('');
  const [actionType, setActionType] = useState('abort_transaction');
  const [actionPayloadJSON, setActionPayloadJSON] = useState('{\n  "message": "Operação bloqueada por regra de negócio!",\n  "status_code": 422\n}');
  const [conditionJSON, setConditionJSON] = useState('{\n  "operator": "AND",\n  "rules": []\n}');
  const [isActive, setIsActive] = useState(true);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  const fetchRules = async () => {
    setLoading(true);
    try {
      const [rList, tblList] = await Promise.all([
        api.rules.listRules(),
        api.schema.listTables(false),
      ]);
      setRules(rList || []);
      setTables(tblList || []);
      if (tblList.length > 0 && !selectedTableID) {
        setSelectedTableID(tblList[0].sys_id);
      }
    } catch (err: any) {
      showToast(err.message || 'Erro ao carregar regras de negócio');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRules();
  }, []);

  const handleOpenDetails = async (r: any) => {
    try {
      const full = await api.rules.getRule(r.sys_id);
      setActiveRule(full);
      setIsNew(false);
      setIsEditing(false);
      populateForm(full);
    } catch (err: any) {
      showToast(err.message || 'Erro ao carregar detalhes da regra');
    }
  };

  const handleNewRule = () => {
    setActiveRule(null);
    setIsNew(true);
    setIsEditing(true);
    setSelectedTableID(tables.length > 0 ? tables[0].sys_id : '');
    setName('');
    setTiming('before_insert');
    setExecutionOrder(100);
    setExecutionMode('caller');
    setRunAsUserID('');
    setActionType('abort_transaction');
    setActionPayloadJSON('{\n  "message": "Operação bloqueada por regra de negócio!",\n  "status_code": 422\n}');
    setConditionJSON('{\n  "operator": "AND",\n  "rules": []\n}');
    setIsActive(true);
  };

  const populateForm = (data: any) => {
    setSelectedTableID(data.table_id || '');
    setName(data.name || '');
    setTiming(data.timing || 'before_insert');
    setExecutionOrder(data.execution_order ?? 100);
    setExecutionMode(data.execution_mode || 'caller');
    setRunAsUserID(data.run_as_user_id || '');
    setActionType(data.action_type || 'abort_transaction');
    setIsActive(data.is_active ?? true);
    setConditionJSON(
      data.condition_expression
        ? JSON.stringify(data.condition_expression, null, 2)
        : '{\n  "operator": "AND",\n  "rules": []\n}'
    );
    setActionPayloadJSON(
      data.action_payload
        ? JSON.stringify(data.action_payload, null, 2)
        : '{\n  "message": "Operação bloqueada!",\n  "status_code": 422\n}'
    );
  };

  const handleBackToList = () => {
    setActiveRule(null);
    setIsNew(false);
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    if (isNew) {
      handleBackToList();
    } else {
      populateForm(activeRule);
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
          throw new Error('A condição deve ser um JSON válido (AST).');
        }
      }
      let parsedAction = null;
      if (actionPayloadJSON.trim()) {
        try {
          parsedAction = JSON.parse(actionPayloadJSON);
        } catch {
          throw new Error('O payload da ação deve ser um JSON válido.');
        }
      }

      const payload = {
        table_id: selectedTableID,
        name,
        timing,
        execution_order: Number(executionOrder),
        execution_mode: executionMode,
        run_as_user_id: executionMode === 'service' && runAsUserID.trim() ? runAsUserID.trim() : null,
        action_type: actionType,
        condition_expression: parsedCond,
        action_payload: parsedAction,
        is_active: isActive,
      };

      if (isNew) {
        const res = await api.rules.createRule(payload);
        showToast(`Regra '${name}' criada com sucesso!`);
        const full = await api.rules.getRule(res.sys_id);
        setActiveRule(full);
        setIsNew(false);
        setIsEditing(false);
      } else {
        await api.rules.updateRule(activeRule.sys_id, payload);
        showToast(`Regra '${name}' atualizada com sucesso!`);
        const full = await api.rules.getRule(activeRule.sys_id);
        setActiveRule(full);
        setIsEditing(false);
      }
      fetchRules();
    } catch (err: any) {
      showToast(err.message || 'Erro ao salvar regra');
    }
  };

  const handleDelete = async () => {
    if (!activeRule) return;
    if (!confirm(`Confirma a exclusão da regra '${activeRule.name}'?`)) {
      return;
    }
    try {
      await api.rules.deleteRule(activeRule.sys_id);
      showToast('Regra excluída com sucesso!');
      handleBackToList();
      fetchRules();
    } catch (err: any) {
      showToast(err.message || 'Erro ao excluir regra');
    }
  };

  // -------------------------------------------------------------
  // VIEW: DETAILS / EDIT FORM PAGE (No Dialog!)
  // -------------------------------------------------------------
  if (activeRule || isNew) {
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
                  {isNew ? 'Nova Regra de Negócio' : (activeRule.name || 'Detalhes da Regra')}
                </h2>
                {!isNew && (
                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                    isActive ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30' : 'bg-slate-800 text-slate-400'
                  }`}>
                    {isActive ? 'Ativa' : 'Inativa'}
                  </span>
                )}
                {timing && (
                  <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px] font-mono border border-slate-700">
                    {timing}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Business Rules Engine (sys_script) • Automações e validações declarativas no CRUD
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
                  <span>Editar Regra</span>
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
                  type="submit"
                  onClick={handleSave}
                  className="flex items-center space-x-1.5 px-5 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow-glow-sm transition-all hover:scale-[1.02]"
                >
                  <Save className="w-4 h-4" />
                  <span>Salvar Regra</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Rule Form (Identical Position between View & Edit Mode) */}
        <form onSubmit={handleSave} className="glass-panel rounded-2xl border border-slate-800 p-6 space-y-6">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
            <h3 className="text-sm font-semibold text-white">
              {isEditing ? 'Formulário de Configuração' : 'Visualização da Regra de Negócio'}
            </h3>
            <span className="text-[11px] text-slate-400 font-mono">
              {isEditing ? 'Modo Interativo' : 'Modo Leitura (Clique em "Editar Regra" para alterar)'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 text-xs">
            {/* Rule Name */}
            <div>
              <label className="block font-semibold text-slate-300 mb-1.5">Nome da Regra *</label>
              <input
                type="text"
                required
                disabled={!isEditing}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Bloquear Severidade 1 sem Descrição"
                className={`w-full px-3.5 py-2.5 rounded-xl font-sans text-white transition-colors ${
                  !isEditing
                    ? 'bg-slate-900/60 border border-slate-800 text-slate-300 cursor-default'
                    : 'bg-slate-900 border border-slate-700 focus:border-brand-500 focus:outline-none'
                }`}
              />
            </div>

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

            {/* Timing */}
            <div>
              <label className="block font-semibold text-slate-300 mb-1.5">Momento de Execução (Timing) *</label>
              <select
                disabled={!isEditing}
                value={timing}
                onChange={(e) => setTiming(e.target.value)}
                className={`w-full px-3.5 py-2.5 rounded-xl font-sans text-white transition-colors ${
                  !isEditing
                    ? 'bg-slate-900/60 border border-slate-800 text-slate-300 cursor-default'
                    : 'bg-slate-900 border border-slate-700 focus:border-brand-500 focus:outline-none'
                }`}
              >
                <option value="before_insert">before_insert (Antes de Criar)</option>
                <option value="before_update">before_update (Antes de Atualizar)</option>
                <option value="after_insert">after_insert (Após Criar)</option>
                <option value="after_update">after_update (Após Atualizar)</option>
              </select>
            </div>

            {/* Execution Order */}
            <div>
              <label className="block font-semibold text-slate-300 mb-1.5">Ordem de Execução *</label>
              <input
                type="number"
                required
                disabled={!isEditing}
                value={executionOrder}
                onChange={(e) => setExecutionOrder(Number(e.target.value))}
                className={`w-full px-3.5 py-2.5 rounded-xl font-mono text-white transition-colors ${
                  !isEditing
                    ? 'bg-slate-900/60 border border-slate-800 text-slate-300 cursor-default'
                    : 'bg-slate-900 border border-slate-700 focus:border-brand-500 focus:outline-none'
                }`}
              />
            </div>

            {/* Execution Mode */}
            <div>
              <label className="block font-semibold text-slate-300 mb-1.5">Modo de Execução *</label>
              <select
                disabled={!isEditing}
                value={executionMode}
                onChange={(e) => setExecutionMode(e.target.value)}
                className={`w-full px-3.5 py-2.5 rounded-xl font-sans text-white transition-colors ${
                  !isEditing
                    ? 'bg-slate-900/60 border border-slate-800 text-slate-300 cursor-default'
                    : 'bg-slate-900 border border-slate-700 focus:border-brand-500 focus:outline-none'
                }`}
              >
                <option value="caller">caller (Executa com privilégios do usuário solicitante)</option>
                <option value="service">service (Executa como conta de serviço / técnico)</option>
              </select>
            </div>

            {/* Action Type */}
            <div>
              <label className="block font-semibold text-slate-300 mb-1.5">Tipo de Ação *</label>
              <select
                disabled={!isEditing}
                value={actionType}
                onChange={(e) => setActionType(e.target.value)}
                className={`w-full px-3.5 py-2.5 rounded-xl font-sans text-white transition-colors ${
                  !isEditing
                    ? 'bg-slate-900/60 border border-slate-800 text-slate-300 cursor-default'
                    : 'bg-slate-900 border border-slate-700 focus:border-brand-500 focus:outline-none'
                }`}
              >
                <option value="abort_transaction">abort_transaction (Bloqueia e reverte transação)</option>
                <option value="set_field_value">set_field_value (Preenche campo automaticamente)</option>
                <option value="execute_script">execute_script (Script ECMAScript sandboxed)</option>
              </select>
            </div>

            {/* Active Checkbox */}
            <div className="flex items-center pt-2 sm:col-span-2">
              <label className={`flex items-center space-x-2.5 text-slate-300 select-none ${!isEditing ? 'cursor-default' : 'cursor-pointer'}`}>
                <input
                  type="checkbox"
                  disabled={!isEditing}
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-brand-500 focus:ring-0"
                />
                <span className="font-medium">Regra de Negócio Ativa</span>
              </label>
            </div>

            {/* Condition Expression AST */}
            <div className="sm:col-span-2">
              <label className="block font-semibold text-slate-300 mb-1.5">
                Expressão de Condição (Condition AST - JSONB)
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

            {/* Action Payload JSON */}
            <div className="sm:col-span-2">
              <label className="block font-semibold text-slate-300 mb-1.5">
                Payload / Script da Ação (action_payload - JSONB)
              </label>
              <textarea
                rows={5}
                disabled={!isEditing}
                value={actionPayloadJSON}
                onChange={(e) => setActionPayloadJSON(e.target.value)}
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
                <span>Salvar Regra</span>
              </button>
            </div>
          )}
        </form>
      </div>
    );
  }

  // -------------------------------------------------------------
  // VIEW: RULES LIST (Table View)
  // -------------------------------------------------------------
  const filtered = rules.filter((r) => {
    const matchTable = filterTable ? r.table_name === filterTable : true;
    const matchSearch = search
      ? r.name?.toLowerCase().includes(search.toLowerCase()) ||
        r.timing?.toLowerCase().includes(search.toLowerCase()) ||
        r.action_type?.toLowerCase().includes(search.toLowerCase()) ||
        r.table_name?.toLowerCase().includes(search.toLowerCase())
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
            <Code2 className="w-5 h-5 text-brand-400" />
            <span>Business Rules Engine (sys_script)</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Automações, validações declarativas, bloqueio de transações e scripts ECMAScript sandboxed em Goja.
          </p>
        </div>

        <button
          onClick={handleNewRule}
          className="flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow-glow-sm transition-all hover:scale-[1.02] active:scale-[0.98]"
        >
          <Plus className="w-4 h-4" />
          <span>Nova Regra</span>
        </button>
      </div>

      {/* Filters Bar */}
      <div className="glass-panel rounded-2xl border border-slate-800 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-1 items-center space-x-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-2.5 pointer-events-none" />
            <input
              type="text"
              placeholder="Pesquisar regras..."
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
            onClick={fetchRules}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            title="Atualizar"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Rules List */}
      <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-900/90 text-[11px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">Nome da Regra</th>
                <th className="py-3 px-4">Tabela</th>
                <th className="py-3 px-4">Timing</th>
                <th className="py-3 px-4">Ordem</th>
                <th className="py-3 px-4">Tipo de Ação</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400 font-sans">
                    Carregando regras de negócio...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400 font-sans">
                    Nenhuma regra cadastrada. Clique em "Nova Regra" para criar!
                  </td>
                </tr>
              ) : (
                filtered.map((r) => (
                  <tr
                    key={r.sys_id}
                    onClick={() => handleOpenDetails(r)}
                    className="hover:bg-slate-800/40 cursor-pointer transition-colors group"
                  >
                    <td className="py-3.5 px-4 font-bold text-white font-sans">
                      {r.name}
                    </td>
                    <td className="py-3.5 px-4 text-slate-300 font-mono">
                      {r.table_name}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-brand-300 text-[11px] border border-slate-700">
                        {r.timing}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-slate-300">
                      {r.execution_order}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                        r.action_type === 'abort_transaction' ? 'bg-rose-500/10 text-rose-300 border border-rose-500/30 font-sans' : 'bg-indigo-500/10 text-indigo-300 border border-indigo-500/30 font-sans'
                      }`}>
                        {r.action_type}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-sans">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        r.is_active ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-800 text-slate-500'
                      }`}>
                        {r.is_active ? 'Ativa' : 'Inativa'}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenDetails(r);
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
