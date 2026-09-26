'use client';

import React, { useState, useEffect } from 'react';
import { api, TableInfo } from '@/lib/api';
import { GitBranch, Plus, CheckCircle2, ArrowRight, Shield, X, RefreshCw, Cpu } from 'lucide-react';

export function TransitionsStudio() {
  const [transitions, setTransitions] = useState<any[]>([]);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Form State
  const [selectedTableID, setSelectedTableID] = useState('');
  const [fromState, setFromState] = useState('new');
  const [toState, setToState] = useState('in_progress');
  const [label, setLabel] = useState('Iniciar Atendimento');
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

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      let parsedCond = null;
      if (conditionJSON.trim()) {
        parsedCond = JSON.parse(conditionJSON);
      }
      let parsedAction = null;
      if (actionJSON.trim()) {
        parsedAction = JSON.parse(actionJSON);
      }

      await api.fsm.createTransition({
        table_id: selectedTableID,
        state_field: 'state',
        from_state: fromState,
        to_state: toState,
        label,
        condition_tree: parsedCond,
        on_transition_action: parsedAction,
      });

      showToast(`Transição '${label}' criada com sucesso!`);
      setShowCreateModal(false);
      fetchTransitions();
    } catch (err: any) {
      showToast(err.message || 'Erro ao salvar transição');
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
            <GitBranch className="w-5 h-5 text-brand-400" />
            <span>FSM State Transitions Designer</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Controle estrito de avanço de estados operacionais, permissões execute e regras guard declarativas (AST).
          </p>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow-glow-sm transition-all hover:scale-[1.02] active:scale-[0.98]"
        >
          <Plus className="w-4 h-4" />
          <span>Nova Transição</span>
        </button>
      </div>

      {/* Transitions List */}
      <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden shadow-xl">
        <div className="p-4 border-b border-slate-800/80 flex items-center justify-between">
          <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
            Transições Ativas ({transitions.length})
          </span>
          <button
            onClick={fetchTransitions}
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
                <th className="py-3 px-4">Rótulo / Botão UI</th>
                <th className="py-3 px-4">Estado Origem</th>
                <th className="py-3 px-4"></th>
                <th className="py-3 px-4">Estado Destino</th>
                <th className="py-3 px-4">Ação Registrada</th>
                <th className="py-3 px-4 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400 font-sans">
                    Carregando catálogo de transições...
                  </td>
                </tr>
              ) : transitions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400 font-sans">
                    Nenhuma transição cadastrada. Clique em "Nova Transição" para configurar o ciclo de vida!
                  </td>
                </tr>
              ) : (
                transitions.map((t) => (
                  <tr key={t.sys_id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-3 px-4 font-bold text-white font-sans">{t.table_name}</td>
                    <td className="py-3 px-4 font-sans text-brand-300 font-semibold">{t.label}</td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                        {t.from_state}
                      </span>
                    </td>
                    <td className="py-3 px-1 text-slate-500">
                      <ArrowRight className="w-3.5 h-3.5" />
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 font-bold">
                        {t.to_state}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-[11px] text-slate-400 font-sans">
                      transition:{t.from_state}:{t.to_state}
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

      {/* Modal: Nova Transição */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-lg w-full glass-panel rounded-2xl border border-slate-700 p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <GitBranch className="w-4 h-4 text-brand-400" />
                <span>Nova Transição de Estado (FSM)</span>
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
                <label className="block font-semibold text-slate-300 mb-1">Rótulo do Botão na UI</label>
                <input
                  type="text"
                  required
                  placeholder="ex: Resolver Incidente"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white focus:border-brand-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-300 mb-1">Estado Origem (from_state)</label>
                  <input
                    type="text"
                    required
                    placeholder="ex: in_progress"
                    value={fromState}
                    onChange={(e) => setFromState(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono focus:border-brand-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-300 mb-1">Estado Destino (to_state)</label>
                  <input
                    type="text"
                    required
                    placeholder="ex: resolved"
                    value={toState}
                    onChange={(e) => setToState(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono focus:border-brand-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1">
                  Condition Tree AST (JSON Guard)
                </label>
                <textarea
                  rows={4}
                  value={conditionJSON}
                  onChange={(e) => setConditionJSON(e.target.value)}
                  className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono text-[11px] focus:border-brand-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1">
                  On Transition Action (Efeitos Colaterais JSON)
                </label>
                <textarea
                  rows={3}
                  value={actionJSON}
                  onChange={(e) => setActionJSON(e.target.value)}
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
                  Salvar Transição
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
