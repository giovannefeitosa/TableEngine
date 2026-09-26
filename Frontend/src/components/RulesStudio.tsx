'use client';

import React, { useState, useEffect } from 'react';
import { api, TableInfo } from '@/lib/api';
import { Code2, Plus, CheckCircle2, Shield, X, RefreshCw, Terminal, Play, AlertCircle } from 'lucide-react';

export function RulesStudio() {
  const [rules, setRules] = useState<any[]>([]);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Form State
  const [selectedTableID, setSelectedTableID] = useState('');
  const [name, setName] = useState('');
  const [timing, setTiming] = useState('before_insert');
  const [executionOrder, setExecutionOrder] = useState(100);
  const [actionType, setActionType] = useState('abort_transaction');
  const [actionPayloadJSON, setActionPayloadJSON] = useState('{\n  "message": "Operação bloqueada por regra de negócio!",\n  "status_code": 422\n}');
  const [conditionJSON, setConditionJSON] = useState('{\n  "operator": "AND",\n  "rules": []\n}');

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

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      let parsedCond = null;
      if (conditionJSON.trim()) {
        parsedCond = JSON.parse(conditionJSON);
      }
      let parsedAction = null;
      if (actionPayloadJSON.trim()) {
        parsedAction = JSON.parse(actionPayloadJSON);
      }

      await api.rules.createRule({
        table_id: selectedTableID,
        name,
        timing,
        execution_order: executionOrder,
        action_type: actionType,
        condition_expression: parsedCond,
        action_payload: parsedAction,
      });

      showToast(`Regra de Negócio '${name}' cadastrada com sucesso!`);
      setShowCreateModal(false);
      setName('');
      fetchRules();
    } catch (err: any) {
      showToast(err.message || 'Erro ao salvar regra');
    }
  };

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
          onClick={() => setShowCreateModal(true)}
          className="flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow-glow-sm transition-all hover:scale-[1.02] active:scale-[0.98]"
        >
          <Plus className="w-4 h-4" />
          <span>Nova Regra</span>
        </button>
      </div>

      {/* Rules List */}
      <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden shadow-xl">
        <div className="p-4 border-b border-slate-800/80 flex items-center justify-between">
          <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
            Regras de Negócio Ativas ({rules.length})
          </span>
          <button
            onClick={fetchRules}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
            title="Atualizar"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-900/90 text-[11px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">Tabela</th>
                <th className="py-3 px-4">Nome da Regra</th>
                <th className="py-3 px-4">Disparo (Timing)</th>
                <th className="py-3 px-4 text-center">Ordem</th>
                <th className="py-3 px-4">Tipo de Ação</th>
                <th className="py-3 px-4 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400 font-sans">
                    Carregando regras...
                  </td>
                </tr>
              ) : rules.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400 font-sans">
                    Nenhuma regra de negócio configurada. Clique em "Nova Regra" para criar!
                  </td>
                </tr>
              ) : (
                rules.map((r) => (
                  <tr key={r.sys_id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-3 px-4 font-bold text-white font-sans">{r.table_name}</td>
                    <td className="py-3 px-4 font-sans text-brand-300 font-semibold">{r.name}</td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-indigo-300 border border-slate-700">
                        {r.timing}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center font-bold text-white">{r.execution_order}</td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-2 py-0.5 rounded font-sans text-[11px] font-medium ${
                          r.action_type === 'abort_transaction'
                            ? 'bg-rose-500/10 text-rose-300 border border-rose-500/20'
                            : r.action_type === 'execute_script'
                            ? 'bg-indigo-500/10 text-indigo-300 border border-indigo-500/20'
                            : 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
                        }`}
                      >
                        {r.action_type}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-sans font-bold">
                        Ativa
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Nova Regra */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-lg w-full glass-panel rounded-2xl border border-slate-700 p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Code2 className="w-4 h-4 text-brand-400" />
                <span>Nova Regra de Negócio (sys_script)</span>
              </h3>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-slate-300 mb-1">Tabela Alvo</label>
                <select
                  value={selectedTableID}
                  onChange={(e) => setSelectedTableID(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white focus:border-brand-500 focus:outline-none"
                >
                  {tables.map((tbl) => (
                    <option key={tbl.sys_id} value={tbl.sys_id}>
                      {tbl.label} ({tbl.name})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1">Nome da Regra</label>
                <input
                  type="text"
                  required
                  placeholder="ex: Validação de Severidade Crítica"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white focus:border-brand-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-300 mb-1">Momento (Timing)</label>
                  <select
                    value={timing}
                    onChange={(e) => setTiming(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white focus:border-brand-500 focus:outline-none"
                  >
                    <option value="before_insert">before_insert (Antes de gravar)</option>
                    <option value="before_update">before_update (Antes de atualizar)</option>
                    <option value="after_insert">after_insert (Após gravação)</option>
                    <option value="after_update">after_update (Após atualização)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-300 mb-1">Ordem de Execução</label>
                  <input
                    type="number"
                    value={executionOrder}
                    onChange={(e) => setExecutionOrder(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono focus:border-brand-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1">Tipo de Ação (action_type)</label>
                <select
                  value={actionType}
                  onChange={(e) => {
                    const t = e.target.value;
                    setActionType(t);
                    if (t === 'abort_transaction') {
                      setActionPayloadJSON('{\n  "message": "Operação bloqueada por regra de negócio!",\n  "status_code": 422\n}');
                    } else if (t === 'set_field_value') {
                      setActionPayloadJSON('{\n  "field": "priority",\n  "value": 1\n}');
                    } else {
                      setActionPayloadJSON('{\n  "script": "current.priority = current.severity * 2;"\n}');
                    }
                  }}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white focus:border-brand-500 focus:outline-none"
                >
                  <option value="abort_transaction">abort_transaction (Abortar com Rollback e Erro 422)</option>
                  <option value="set_field_value">set_field_value (Modificar campos do registro)</option>
                  <option value="execute_script">execute_script (Script ECMAScript Goja em Sandbox)</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1">Condition Expression (AST JSON)</label>
                <textarea
                  rows={3}
                  value={conditionJSON}
                  onChange={(e) => setConditionJSON(e.target.value)}
                  className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono text-[11px] focus:border-brand-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1">Action Payload (JSON)</label>
                <textarea
                  rows={3}
                  value={actionPayloadJSON}
                  onChange={(e) => setActionPayloadJSON(e.target.value)}
                  className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono text-[11px] focus:border-brand-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-3 py-1.5 rounded-lg text-slate-400 hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-semibold transition-all shadow-glow-sm"
                >
                  Salvar Regra
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
