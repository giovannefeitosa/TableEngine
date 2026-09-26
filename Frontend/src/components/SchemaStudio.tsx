'use client';

import React, { useState, useEffect } from 'react';
import { api, TableInfo, FieldInfo } from '@/lib/api';
import {
  Layers,
  Plus,
  Search,
  ArrowRight,
  Database,
  Tag,
  Key,
  Calendar,
  Hash,
  Type,
  ToggleLeft,
  Link as LinkIcon,
  CheckCircle2,
  X,
  RefreshCw,
  GitFork,
  Sliders,
  FileCode,
} from 'lucide-react';

export function SchemaStudio() {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [includeKernel, setIncludeKernel] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedTable, setSelectedTable] = useState<TableInfo | null>(null);
  const [fields, setFields] = useState<FieldInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingFields, setLoadingFields] = useState(false);
  const [showCreateTableModal, setShowCreateTableModal] = useState(false);
  const [showAddFieldModal, setShowAddFieldModal] = useState(false);
  const [showAddChoiceModal, setShowAddChoiceModal] = useState(false);
  const [showNumberModal, setShowNumberModal] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // New Table Form State
  const [newTableName, setNewTableName] = useState('');
  const [newTableLabel, setNewTableLabel] = useState('');
  const [newTableParent, setNewTableParent] = useState<string>('');
  const [newTableExtendable, setNewTableExtendable] = useState(true);

  // New Field Form State
  const [newColName, setNewColName] = useState('');
  const [newColLabel, setNewColLabel] = useState('');
  const [newColType, setNewColType] = useState('string');
  const [newColMandatory, setNewColMandatory] = useState(false);
  const [newColReadOnly, setNewColReadOnly] = useState(false);
  const [newColDefault, setNewColDefault] = useState('');
  const [newColRefTable, setNewColRefTable] = useState('');
  const [newColNumPrefix, setNewColNumPrefix] = useState('');
  const [newColNumDigits, setNewColNumDigits] = useState(7);
  const [newColNumStart, setNewColNumStart] = useState(1);

  // New Choice Form State
  const [choiceElement, setChoiceElement] = useState('state');
  const [choiceValue, setChoiceValue] = useState('');
  const [choiceLabel, setChoiceLabel] = useState('');
  const [choiceSeq, setChoiceSeq] = useState(10);

  // New Number Config Form State
  const [numPrefix, setNumPrefix] = useState('REC');
  const [numDigits, setNumDigits] = useState(7);
  const [numStart, setNumStart] = useState(1);

  const fetchTables = async () => {
    setLoading(true);
    try {
      const data = await api.schema.listTables(includeKernel);
      setTables(data);
    } catch (err: any) {
      showToast(err.message || 'Erro ao carregar tabelas');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTables();
  }, [includeKernel]);

  const loadTableFields = async (table: TableInfo) => {
    setSelectedTable(table);
    setLoadingFields(true);
    try {
      const fList = await api.schema.getFields(table.name);
      setFields(fList);
    } catch (err: any) {
      showToast(err.message || 'Erro ao carregar campos');
    } finally {
      setLoadingFields(false);
    }
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  const handleCreateTable = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const created = await api.schema.createTable({
        name: newTableName,
        label: newTableLabel,
        super_class_id: newTableParent ? newTableParent : null,
        is_extendable: newTableExtendable,
      });
      showToast(`Tabela '${created.name}' criada com sucesso!`);
      setShowCreateTableModal(false);
      setNewTableName('');
      setNewTableLabel('');
      setNewTableParent('');
      await fetchTables();
      loadTableFields(created);
    } catch (err: any) {
      showToast(err.message);
    }
  };

  const handleAddField = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTable) return;
    try {
      await api.schema.addField(selectedTable.sys_id, {
        column_name: newColName,
        label: newColLabel,
        internal_type: newColType,
        is_mandatory: newColMandatory,
        is_read_only: newColReadOnly,
        default_value: newColDefault || undefined,
        reference_table_id: newColType === 'reference' && newColRefTable ? newColRefTable : undefined,
        number_prefix: newColType === 'auto_number' ? newColNumPrefix : undefined,
        minimum_digits: newColType === 'auto_number' ? newColNumDigits : undefined,
        start_number: newColType === 'auto_number' ? newColNumStart : undefined,
      });
      showToast(`Campo '${newColName}' adicionado com sucesso!`);
      setShowAddFieldModal(false);
      setNewColName('');
      setNewColLabel('');
      setNewColDefault('');
      loadTableFields(selectedTable);
    } catch (err: any) {
      showToast(err.message);
    }
  };

  const handleAddChoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTable) return;
    try {
      await api.schema.addChoice({
        table_id: selectedTable.sys_id,
        element: choiceElement,
        value: choiceValue,
        label: choiceLabel,
        sequence: choiceSeq,
      });
      showToast(`Opção de dropdown '${choiceLabel}' adicionada!`);
      setShowAddChoiceModal(false);
      setChoiceValue('');
      setChoiceLabel('');
    } catch (err: any) {
      showToast(err.message);
    }
  };

  const handleConfigureNumber = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTable) return;
    try {
      await api.schema.configureNumber({
        table_id: selectedTable.sys_id,
        field_name: 'number',
        prefix: numPrefix,
        minimum_digits: numDigits,
        start_number: numStart,
      });
      showToast(`Numeração ${numPrefix} configurada com sucesso!`);
      setShowNumberModal(false);
      loadTableFields(selectedTable);
    } catch (err: any) {
      showToast(err.message);
    }
  };

  const filteredTables = tables.filter(
    (t) =>
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.label.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 p-4 rounded-xl bg-slate-900 border border-brand-500/40 text-slate-100 text-xs shadow-2xl flex items-center space-x-3 animate-bounce">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{toast}</span>
        </div>
      )}

      {/* Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2.5">
            <Layers className="w-5 h-5 text-brand-400" />
            <span>Schema Studio (Data Dictionary & TPT)</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Gerenciamento de classes, herança Table-per-Type, atributos, views polimórficas e numeração.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <label className="flex items-center space-x-2 text-xs text-slate-300 cursor-pointer select-none px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700">
            <input
              type="checkbox"
              checked={includeKernel}
              onChange={(e) => setIncludeKernel(e.target.checked)}
              className="rounded bg-slate-800 border-slate-700 text-brand-500 focus:ring-0"
            />
            <span>Incluir Tabelas sys_*</span>
          </label>

          <button
            onClick={() => setShowCreateTableModal(true)}
            className="flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow-glow-sm transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            <Plus className="w-4 h-4" />
            <span>Nova Tabela</span>
          </button>
        </div>
      </div>

      {/* Main Content: Tables Grid & Details Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Tables List */}
        <div className="lg:col-span-5 space-y-4">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3 pointer-events-none" />
            <input
              type="text"
              placeholder="Buscar classes ou tabelas..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-900/80 border border-slate-800 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
          </div>

          <div className="space-y-2 max-h-[calc(100vh-18rem)] overflow-y-auto pr-1">
            {loading ? (
              <div className="p-8 text-center text-slate-400 text-xs">Carregando catálogo...</div>
            ) : filteredTables.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs glass-panel rounded-xl">
                Nenhuma tabela encontrada. Crie sua primeira tabela de negócio!
              </div>
            ) : (
              filteredTables.map((t) => {
                const isSelected = selectedTable?.sys_id === t.sys_id;
                const parentTable = tables.find((p) => p.sys_id === t.super_class_id);

                return (
                  <div
                    key={t.sys_id}
                    onClick={() => loadTableFields(t)}
                    className={`p-3.5 rounded-xl cursor-pointer transition-all border ${
                      isSelected
                        ? 'bg-brand-600/15 border-brand-500/50 shadow-glow-sm'
                        : 'glass-card hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center space-x-2.5">
                        <div
                          className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                            t.is_kernel_table
                              ? 'bg-slate-800 text-slate-400'
                              : 'bg-brand-500/10 text-brand-400 border border-brand-500/20'
                          }`}
                        >
                          <Database className="w-3.5 h-3.5" />
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-white flex items-center gap-2">
                            <span>{t.label}</span>
                            <span className="font-mono text-[10px] text-slate-400">({t.name})</span>
                          </p>
                          {parentTable ? (
                            <p className="text-[10px] text-indigo-300 flex items-center gap-1 mt-0.5">
                              <GitFork className="w-3 h-3 text-indigo-400 rotate-180" />
                              <span>Herda de {parentTable.label} ({parentTable.name})</span>
                            </p>
                          ) : (
                            <p className="text-[10px] text-slate-400 mt-0.5">Tabela Raiz (Base)</p>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col items-end space-y-1">
                        <span
                          className={`text-[9px] px-2 py-0.5 rounded-full font-semibold ${
                            t.is_kernel_table
                              ? 'bg-slate-800 text-slate-400 border border-slate-700'
                              : 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
                          }`}
                        >
                          {t.is_kernel_table ? 'Kernel' : 'TPT Business'}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Table Detail & Dictionary Inspector */}
        <div className="lg:col-span-7">
          {selectedTable ? (
            <div className="glass-panel rounded-2xl border border-slate-800 p-6 space-y-6">
              {/* Header Info */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800 gap-4">
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-base font-bold text-white">{selectedTable.label}</span>
                    <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                      {selectedTable.name}
                    </span>
                    {selectedTable.view_name && (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                        view: {selectedTable.view_name}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Chave primária UUID universal • Concorrência otimista (sys_mod_count) • Trilha universal sys_audit
                  </p>
                </div>

                {!selectedTable.is_kernel_table && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => setShowAddFieldModal(true)}
                      className="px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-xs font-medium flex items-center space-x-1.5 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Adicionar Campo</span>
                    </button>
                    <button
                      onClick={() => setShowAddChoiceModal(true)}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-colors"
                    >
                      <span>+ Opções</span>
                    </button>
                    <button
                      onClick={() => setShowNumberModal(true)}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-colors"
                    >
                      <span># Numeração</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Resolved Fields Table */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                    <Sliders className="w-3.5 h-3.5 text-brand-400" />
                    <span>Dicionário Resolvido com Herança (CTE)</span>
                  </h3>
                  <span className="text-xs text-slate-400 font-mono">
                    {fields.length} atributos disponíveis
                  </span>
                </div>

                {loadingFields ? (
                  <div className="py-12 text-center text-xs text-slate-400">
                    Resolvendo CTE de herança no PostgreSQL...
                  </div>
                ) : fields.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-400 glass-card rounded-xl">
                    Nenhum campo registrado nesta tabela.
                  </div>
                ) : (
                  <div className="overflow-x-auto border border-slate-800 rounded-xl">
                    <table className="w-full text-left text-xs text-slate-300">
                      <thead className="bg-slate-900/80 text-[11px] font-semibold text-slate-400 border-b border-slate-800">
                        <tr>
                          <th className="py-2.5 px-3">Coluna</th>
                          <th className="py-2.5 px-3">Rótulo</th>
                          <th className="py-2.5 px-3">Tipo Interno</th>
                          <th className="py-2.5 px-3">Origem (TPT)</th>
                          <th className="py-2.5 px-3 text-center">Obrigatório</th>
                          <th className="py-2.5 px-3 text-center">Somente Leitura</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                        {fields.map((f, i) => (
                          <tr
                            key={i}
                            className={`hover:bg-slate-800/40 transition-colors ${
                              f.inheritance_level > 0 ? 'bg-indigo-950/10' : ''
                            }`}
                          >
                            <td className="py-2 px-3 font-semibold text-white">{f.column_name}</td>
                            <td className="py-2 px-3 font-sans text-slate-200">{f.label}</td>
                            <td className="py-2 px-3">
                              <span className="px-2 py-0.5 rounded bg-slate-800 text-brand-300 border border-slate-700">
                                {f.internal_type}
                              </span>
                            </td>
                            <td className="py-2 px-3 font-sans">
                              {f.inheritance_level > 0 ? (
                                <span className="inline-flex items-center gap-1 text-[10px] text-indigo-300 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
                                  <GitFork className="w-2.5 h-2.5 rotate-180" />
                                  Herdado de {f.defined_in_table} (Nível {f.inheritance_level})
                                </span>
                              ) : (
                                <span className="text-[10px] text-emerald-400 font-medium">
                                  Próprio desta classe
                                </span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-center">
                              {f.is_mandatory ? (
                                <span className="text-rose-400 font-bold">Sim</span>
                              ) : (
                                <span className="text-slate-500">-</span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-center">
                              {f.is_read_only ? (
                                <span className="text-amber-400 font-bold">Sim</span>
                              ) : (
                                <span className="text-slate-500">-</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="h-full min-h-[300px] glass-panel rounded-2xl border border-slate-800 flex flex-col items-center justify-center p-8 text-center text-slate-400">
              <Layers className="w-10 h-10 text-slate-600 mb-3" />
              <p className="text-sm font-semibold text-slate-300">Selecione uma Tabela</p>
              <p className="text-xs text-slate-500 max-w-sm mt-1">
                Escolha uma tabela no catálogo à esquerda para visualizar sua árvore genealógica de herança TPT e dicionário de atributos.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Modal: Nova Tabela */}
      {showCreateTableModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-md w-full glass-panel rounded-2xl border border-slate-700 p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Database className="w-4 h-4 text-brand-400" />
                <span>Criar Nova Tabela (Raiz ou TPT)</span>
              </h3>
              <button
                onClick={() => setShowCreateTableModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateTable} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-300 mb-1">Nome Técnico da Tabela</label>
                <input
                  type="text"
                  required
                  placeholder="ex: tbl_incident ou incident"
                  value={newTableName}
                  onChange={(e) => setNewTableName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono focus:border-brand-500 focus:outline-none"
                />
                <span className="text-[10px] text-slate-500">
                  Prefixo 'tbl_' será inserido automaticamente se omitido.
                </span>
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1">Rótulo de Exibição (Label)</label>
                <input
                  type="text"
                  required
                  placeholder="ex: Incidente Operacional"
                  value={newTableLabel}
                  onChange={(e) => setNewTableLabel(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white focus:border-brand-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1">
                  Herança Table-per-Type (Tabela Pai)
                </label>
                <select
                  value={newTableParent}
                  onChange={(e) => setNewTableParent(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white focus:border-brand-500 focus:outline-none"
                >
                  <option value="">Nenhum (Tabela Raiz com System Attributes)</option>
                  {tables
                    .filter((t) => t.is_extendable && !t.is_kernel_table)
                    .map((t) => (
                      <option key={t.sys_id} value={t.sys_id}>
                        Estender: {t.label} ({t.name})
                      </option>
                    ))}
                </select>
                <span className="text-[10px] text-slate-500">
                  Ao estender, a tabela filha recebe PK/FK em cascata e view polimórfica automática.
                </span>
              </div>

              <div className="flex items-center space-x-2 pt-1">
                <input
                  type="checkbox"
                  id="extendable"
                  checked={newTableExtendable}
                  onChange={(e) => setNewTableExtendable(e.target.checked)}
                  className="rounded bg-slate-800 border-slate-700 text-brand-500 focus:ring-0"
                />
                <label htmlFor="extendable" className="text-slate-300 select-none cursor-pointer">
                  Permitir que outras tabelas herdem desta (is_extendable)
                </label>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowCreateTableModal(false)}
                  className="px-3 py-1.5 rounded-lg text-slate-400 hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-semibold transition-all shadow-glow-sm"
                >
                  Criar Tabela
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Adicionar Campo */}
      {showAddFieldModal && selectedTable && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-md w-full glass-panel rounded-2xl border border-slate-700 p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Plus className="w-4 h-4 text-brand-400" />
                <span>Adicionar Campo em {selectedTable.name}</span>
              </h3>
              <button onClick={() => setShowAddFieldModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddField} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-slate-300 mb-1">Nome da Coluna</label>
                <input
                  type="text"
                  required
                  placeholder="ex: severity, close_notes, caller_id"
                  value={newColName}
                  onChange={(e) => setNewColName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono focus:border-brand-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1">Rótulo (Label)</label>
                <input
                  type="text"
                  required
                  placeholder="ex: Gravidade do Chamado"
                  value={newColLabel}
                  onChange={(e) => setNewColLabel(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white focus:border-brand-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1">Tipo de Dado (internal_type)</label>
                <select
                  value={newColType}
                  onChange={(e) => setNewColType(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white focus:border-brand-500 focus:outline-none"
                >
                  <option value="string">string (VARCHAR 255)</option>
                  <option value="text">text (TEXT sem limite)</option>
                  <option value="integer">integer (INTEGER 4 bytes)</option>
                  <option value="bigint">bigint (BIGINT 8 bytes)</option>
                  <option value="boolean">boolean (BOOLEAN com default false)</option>
                  <option value="reference">reference (UUID Foreign Key)</option>
                  <option value="auto_number">auto_number (Numeração Automática Ex: TSK0000001)</option>
                  <option value="timestamptz">timestamptz (Timestamp com Timezone)</option>
                  <option value="jsonb">jsonb (JSONB flexível)</option>
                </select>
              </div>

              {newColType === 'reference' && (
                <div>
                  <label className="block font-semibold text-slate-300 mb-1">Tabela Alvo da Referência</label>
                  <select
                    value={newColRefTable}
                    onChange={(e) => setNewColRefTable(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white focus:border-brand-500 focus:outline-none"
                  >
                    <option value="">Selecione uma tabela...</option>
                    {tables.map((t) => (
                      <option key={t.sys_id} value={t.sys_id}>
                        {t.label} ({t.name})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {newColType === 'auto_number' && (
                <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[10px] text-slate-400">Prefixo (1-3 car.)</label>
                      <input
                        type="text"
                        maxLength={3}
                        value={newColNumPrefix}
                        onChange={(e) => setNewColNumPrefix(e.target.value.toUpperCase())}
                        placeholder="INC"
                        className="w-full px-2 py-1 rounded bg-slate-800 border border-slate-700 font-mono text-xs uppercase text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400">Dígitos Mínimos</label>
                      <input
                        type="number"
                        min={1}
                        max={19}
                        value={newColNumDigits}
                        onChange={(e) => setNewColNumDigits(Number(e.target.value))}
                        className="w-full px-2 py-1 rounded bg-slate-800 border border-slate-700 font-mono text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400">Número Inicial</label>
                      <input
                        type="number"
                        min={1}
                        value={newColNumStart}
                        onChange={(e) => setNewColNumStart(Number(e.target.value))}
                        className="w-full px-2 py-1 rounded bg-slate-800 border border-slate-700 font-mono text-xs text-white"
                      />
                    </div>
                  </div>
                </div>
              )}

              {newColType !== 'auto_number' && (
                <div>
                  <label className="block font-semibold text-slate-300 mb-1">Valor Padrão (Opcional)</label>
                  <input
                    type="text"
                    value={newColDefault}
                    onChange={(e) => setNewColDefault(e.target.value)}
                    placeholder="ex: new, 1, false"
                    className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white focus:border-brand-500 focus:outline-none"
                  />
                </div>
              )}

              <div className="flex items-center space-x-6 pt-1">
                <label className="flex items-center space-x-2 text-slate-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={newColMandatory}
                    onChange={(e) => setNewColMandatory(e.target.checked)}
                    className="rounded bg-slate-800 border-slate-700 text-brand-500 focus:ring-0"
                  />
                  <span>Obrigatório</span>
                </label>
                <label className="flex items-center space-x-2 text-slate-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={newColReadOnly}
                    onChange={(e) => setNewColReadOnly(e.target.checked)}
                    className="rounded bg-slate-800 border-slate-700 text-brand-500 focus:ring-0"
                  />
                  <span>Somente Leitura</span>
                </label>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddFieldModal(false)}
                  className="px-3 py-1.5 rounded-lg text-slate-400 hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-semibold transition-all shadow-glow-sm"
                >
                  Adicionar Coluna
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Adicionar Opção Dropdown */}
      {showAddChoiceModal && selectedTable && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-md w-full glass-panel rounded-2xl border border-slate-700 p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Tag className="w-4 h-4 text-brand-400" />
                <span>Adicionar Opção de Dropdown (sys_choice)</span>
              </h3>
              <button onClick={() => setShowAddChoiceModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddChoice} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-slate-300 mb-1">Campo Alvo (Element)</label>
                <input
                  type="text"
                  required
                  placeholder="ex: state, severity, category"
                  value={choiceElement}
                  onChange={(e) => setChoiceElement(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono focus:border-brand-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-300 mb-1">Valor Técnico (DB)</label>
                  <input
                    type="text"
                    required
                    placeholder="ex: in_progress"
                    value={choiceValue}
                    onChange={(e) => setChoiceValue(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono focus:border-brand-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-300 mb-1">Rótulo Exibido</label>
                  <input
                    type="text"
                    required
                    placeholder="ex: Em Andamento"
                    value={choiceLabel}
                    onChange={(e) => setChoiceLabel(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white focus:border-brand-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1">Ordem de Exibição (Sequence)</label>
                <input
                  type="number"
                  value={choiceSeq}
                  onChange={(e) => setChoiceSeq(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono focus:border-brand-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddChoiceModal(false)}
                  className="px-3 py-1.5 rounded-lg text-slate-400 hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-semibold transition-all shadow-glow-sm"
                >
                  Salvar Opção
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Configurar Numeração */}
      {showNumberModal && selectedTable && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-md w-full glass-panel rounded-2xl border border-slate-700 p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Hash className="w-4 h-4 text-brand-400" />
                <span>Configurar Numeração Sequencial (sys_number)</span>
              </h3>
              <button onClick={() => setShowNumberModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleConfigureNumber} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-300 mb-1">Prefixo (1-3 car.)</label>
                  <input
                    type="text"
                    required
                    maxLength={3}
                    placeholder="INC"
                    value={numPrefix}
                    onChange={(e) => setNumPrefix(e.target.value.toUpperCase())}
                    className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono uppercase focus:border-brand-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-300 mb-1">Dígitos Mínimos</label>
                  <input
                    type="number"
                    min={1}
                    max={19}
                    value={numDigits}
                    onChange={(e) => setNumDigits(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono focus:border-brand-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-300 mb-1">Número Inicial</label>
                  <input
                    type="number"
                    min={1}
                    value={numStart}
                    onChange={(e) => setNumStart(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono focus:border-brand-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-[11px] text-slate-400">
                <p>
                  Exemplo de saída formatada gerada por <code className="text-brand-300">sys_next_number()</code>:
                </p>
                <p className="font-mono text-xs text-emerald-400 font-bold mt-1">
                  {numPrefix.padEnd(3, 'X')}
                  {String(numStart).padStart(numDigits, '0')}
                </p>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowNumberModal(false)}
                  className="px-3 py-1.5 rounded-lg text-slate-400 hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-semibold transition-all shadow-glow-sm"
                >
                  Salvar Numeração
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
