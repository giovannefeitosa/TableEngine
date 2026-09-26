'use client';

import React, { useState, useEffect } from 'react';
import { api, TableInfo, FieldInfo, ChoiceInfo } from '@/lib/api';
import {
  Layers,
  Plus,
  Search,
  ArrowLeft,
  Database,
  Tag,
  Key,
  Calendar,
  Hash,
  Type,
  ToggleLeft,
  Link as LinkIcon,
  CheckCircle2,
  AlertTriangle,
  X,
  RefreshCw,
  GitFork,
  Sliders,
  FileCode,
  Edit3,
  Trash2,
  Save,
  Check,
  Shield,
  Clock,
  Sparkles,
  Info
} from 'lucide-react';

type StudioView =
  | 'catalog'
  | 'table-new'
  | 'table-detail'
  | 'field-new'
  | 'field-detail'
  | 'choice-new'
  | 'choice-detail';

export function SchemaStudio() {
  const [view, setView] = useState<StudioView>('catalog');
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [includeKernel, setIncludeKernel] = useState(false);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  // Selected entities for detail views
  const [selectedTable, setSelectedTable] = useState<TableInfo | null>(null);
  const [selectedField, setSelectedField] = useState<FieldInfo | null>(null);
  const [selectedChoice, setSelectedChoice] = useState<ChoiceInfo | null>(null);

  // Table Details & Related
  const [fields, setFields] = useState<FieldInfo[]>([]);
  const [choices, setChoices] = useState<ChoiceInfo[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Edit Modes (in-place)
  const [isEditingTable, setIsEditingTable] = useState(false);
  const [editTableForm, setEditTableForm] = useState({ label: '', is_extendable: true });

  const [isEditingField, setIsEditingField] = useState(false);
  const [editFieldForm, setEditFieldForm] = useState({
    label: '',
    is_mandatory: false,
    is_read_only: false,
    default_value: '',
  });

  const [isEditingChoice, setIsEditingChoice] = useState(false);
  const [editChoiceForm, setEditChoiceForm] = useState({
    label: '',
    value: '',
    sequence: 10,
    is_active: true,
  });

  // Table Create Form
  const [newTableName, setNewTableName] = useState('');
  const [newTableLabel, setNewTableLabel] = useState('');
  const [newTableParent, setNewTableParent] = useState<string>('');
  const [newTableExtendable, setNewTableExtendable] = useState(true);

  // Field Create Form
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

  // Choice Create Form
  const [choiceElement, setChoiceElement] = useState('state');
  const [choiceValue, setChoiceValue] = useState('');
  const [choiceLabel, setChoiceLabel] = useState('');
  const [choiceSeq, setChoiceSeq] = useState(10);

  // Number Config Form
  const [numPrefix, setNumPrefix] = useState('REC');
  const [numDigits, setNumDigits] = useState(7);
  const [numStart, setNumStart] = useState(1);
  const [isConfiguringNumber, setIsConfiguringNumber] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

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

  const loadTableDetails = async (table: TableInfo) => {
    setSelectedTable(table);
    setEditTableForm({
      label: table.label,
      is_extendable: table.is_extendable,
    });
    setIsEditingTable(false);
    setView('table-detail');
    setLoadingDetails(true);

    try {
      const [fList, cList] = await Promise.all([
        api.schema.getFields(table.name),
        api.schema.getTableChoices(table.name).catch(() => []),
      ]);
      setFields(fList);
      setChoices(cList);
    } catch (err: any) {
      showToast(err.message || 'Erro ao carregar metadados da tabela');
    } finally {
      setLoadingDetails(false);
    }
  };

  // ==========================================
  // TABLE ACTIONS
  // ==========================================
  const handleCreateTable = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const created = await api.schema.createTable({
        name: newTableName,
        label: newTableLabel,
        super_class_id: newTableParent || null,
        is_extendable: newTableExtendable,
      });
      showToast(`Tabela '${created.name}' criada com sucesso!`);
      setNewTableName('');
      setNewTableLabel('');
      setNewTableParent('');
      await fetchTables();
      loadTableDetails(created);
    } catch (err: any) {
      showToast(err.message);
    }
  };

  const handleUpdateTable = async () => {
    if (!selectedTable) return;
    try {
      const updated = await api.schema.updateTable(selectedTable.sys_id, {
        label: editTableForm.label,
        is_extendable: editTableForm.is_extendable,
      });
      setSelectedTable(updated);
      setIsEditingTable(false);
      showToast(`Tabela '${updated.name}' atualizada com sucesso!`);
      await fetchTables();
    } catch (err: any) {
      showToast(err.message);
    }
  };

  const handleDeleteTable = async () => {
    if (!selectedTable) return;
    if (
      !confirm(
        `Tem certeza que deseja EXCLUIR a tabela '${selectedTable.name}'? Todos os dados, views polimórficas e colunas serão descartados no PostgreSQL!`
      )
    ) {
      return;
    }

    try {
      await api.schema.deleteTable(selectedTable.sys_id);
      showToast(`Tabela '${selectedTable.name}' excluída com sucesso!`);
      setSelectedTable(null);
      setView('catalog');
      await fetchTables();
    } catch (err: any) {
      showToast(err.message);
    }
  };

  // ==========================================
  // FIELD ACTIONS
  // ==========================================
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
      setNewColName('');
      setNewColLabel('');
      setNewColDefault('');
      await loadTableDetails(selectedTable);
      setView('table-detail');
    } catch (err: any) {
      showToast(err.message);
    }
  };

  const handleOpenFieldDetail = (f: FieldInfo) => {
    setSelectedField(f);
    setEditFieldForm({
      label: f.label,
      is_mandatory: f.is_mandatory,
      is_read_only: f.is_read_only,
      default_value: f.default_value || '',
    });
    setIsEditingField(false);
    setView('field-detail');
  };

  const handleUpdateField = async () => {
    if (!selectedField || !selectedTable) return;
    try {
      const updated = await api.schema.updateField(selectedField.sys_id, {
        label: editFieldForm.label,
        is_mandatory: editFieldForm.is_mandatory,
        is_read_only: editFieldForm.is_read_only,
        default_value: editFieldForm.default_value || null,
      });
      setSelectedField(updated);
      setIsEditingField(false);
      showToast(`Campo '${updated.column_name}' atualizado com sucesso!`);
      await loadTableDetails(selectedTable);
    } catch (err: any) {
      showToast(err.message);
    }
  };

  const handleDeleteField = async () => {
    if (!selectedField || !selectedTable) return;
    if (
      !confirm(
        `Tem certeza que deseja EXCLUIR o campo '${selectedField.column_name}'? A coluna física será descartada no PostgreSQL e a view polimórfica será regenerada!`
      )
    ) {
      return;
    }

    try {
      await api.schema.deleteField(selectedField.sys_id);
      showToast(`Campo '${selectedField.column_name}' excluído com sucesso!`);
      setSelectedField(null);
      await loadTableDetails(selectedTable);
      setView('table-detail');
    } catch (err: any) {
      showToast(err.message);
    }
  };

  // ==========================================
  // CHOICE ACTIONS
  // ==========================================
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
      showToast(`Opção de dropdown '${choiceLabel}' adicionada com sucesso!`);
      setChoiceValue('');
      setChoiceLabel('');
      await loadTableDetails(selectedTable);
      setView('table-detail');
    } catch (err: any) {
      showToast(err.message);
    }
  };

  const handleOpenChoiceDetail = (c: ChoiceInfo) => {
    setSelectedChoice(c);
    setEditChoiceForm({
      label: c.label,
      value: c.value,
      sequence: c.sequence,
      is_active: true,
    });
    setIsEditingChoice(false);
    setView('choice-detail');
  };

  const handleUpdateChoice = async () => {
    if (!selectedChoice || !selectedTable) return;
    try {
      const updated = await api.schema.updateChoice(selectedChoice.sys_id, {
        label: editChoiceForm.label,
        value: editChoiceForm.value,
        sequence: editChoiceForm.sequence,
        is_active: editChoiceForm.is_active,
      });
      setSelectedChoice(updated);
      setIsEditingChoice(false);
      showToast(`Opção '${updated.label}' atualizada com sucesso!`);
      await loadTableDetails(selectedTable);
    } catch (err: any) {
      showToast(err.message);
    }
  };

  const handleDeleteChoice = async () => {
    if (!selectedChoice || !selectedTable) return;
    if (!confirm(`Tem certeza que deseja excluir a opção '${selectedChoice.label}'?`)) {
      return;
    }

    try {
      await api.schema.deleteChoice(selectedChoice.sys_id);
      showToast(`Opção '${selectedChoice.label}' excluída com sucesso!`);
      setSelectedChoice(null);
      await loadTableDetails(selectedTable);
      setView('table-detail');
    } catch (err: any) {
      showToast(err.message);
    }
  };

  // ==========================================
  // NUMBERING CONFIG
  // ==========================================
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
      setIsConfiguringNumber(false);
      await loadTableDetails(selectedTable);
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

      {/* ========================================================================= */}
      {/* VIEW: CATALOG (DEFAULT SPLIT OR LIST) */}
      {/* ========================================================================= */}
      {view === 'catalog' && (
        <div className="space-y-6">
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
                onClick={() => setView('table-new')}
                className="flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow-glow-sm transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                <Plus className="w-4 h-4" />
                <span>Nova Tabela</span>
              </button>
            </div>
          </div>

          {/* Search bar */}
          <div className="relative max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3 pointer-events-none" />
            <input
              type="text"
              placeholder="Buscar classes ou tabelas..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-900/80 border border-slate-800 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
          </div>

          {/* Tables Grid */}
          {loading ? (
            <div className="p-12 text-center text-slate-400 text-xs">Carregando catálogo de tabelas...</div>
          ) : filteredTables.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-xs glass-panel rounded-2xl">
              Nenhuma tabela encontrada. Clique em &quot;Nova Tabela&quot; para criar sua primeira classe TPT.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredTables.map((t) => {
                const parentTable = tables.find((p) => p.sys_id === t.super_class_id);
                return (
                  <div
                    key={t.sys_id}
                    onClick={() => loadTableDetails(t)}
                    className="p-5 rounded-2xl border border-slate-800 hover:border-brand-500/50 glass-card transition-all cursor-pointer group hover:shadow-glow-sm"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center space-x-3">
                        <div
                          className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                            t.is_kernel_table
                              ? 'bg-slate-800 text-slate-400'
                              : 'bg-brand-500/10 text-brand-400 border border-brand-500/20 group-hover:scale-105'
                          } transition-transform`}
                        >
                          <Database className="w-4 h-4" />
                        </div>
                        <div>
                          <h3 className="text-xs font-bold text-white group-hover:text-brand-400 transition-colors">
                            {t.label}
                          </h3>
                          <p className="font-mono text-[11px] text-slate-400 mt-0.5">{t.name}</p>
                        </div>
                      </div>

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

                    <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
                      {parentTable ? (
                        <span className="text-indigo-300 flex items-center gap-1">
                          <GitFork className="w-3 h-3 text-indigo-400 rotate-180" />
                          Herda de {parentTable.label}
                        </span>
                      ) : (
                        <span className="text-slate-500">Tabela Raiz (Base)</span>
                      )}

                      <span className="text-brand-400 group-hover:translate-x-0.5 transition-transform flex items-center gap-1 font-semibold">
                        Ver Detalhes &rarr;
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW: TABLE CREATE PAGE (ZERO MODAL) */}
      {/* ========================================================================= */}
      {view === 'table-new' && (
        <div className="max-w-3xl mx-auto space-y-6">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => setView('catalog')}
              className="p-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Database className="w-5 h-5 text-brand-400" />
                <span>Criar Nova Tabela (Raiz ou TPT)</span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Crie uma classe raiz ou estenda uma classe existente com herança Table-per-Type.
              </p>
            </div>
          </div>

          <div className="glass-panel rounded-2xl border border-slate-800 p-6 shadow-2xl">
            <form onSubmit={handleCreateTable} className="space-y-5 text-xs">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-300 mb-1.5">
                    Nome Técnico da Tabela <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="ex: tbl_incident ou incident"
                    value={newTableName}
                    onChange={(e) => setNewTableName(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono focus:border-brand-500 focus:outline-none"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    Prefixo &apos;tbl_&apos; será adicionado automaticamente se omitido.
                  </p>
                </div>

                <div>
                  <label className="block font-semibold text-slate-300 mb-1.5">
                    Rótulo de Exibição (Label) <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="ex: Incidente Operacional"
                    value={newTableLabel}
                    onChange={(e) => setNewTableLabel(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white focus:border-brand-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1.5">
                  Herança Table-per-Type (Tabela Pai)
                </label>
                <select
                  value={newTableParent}
                  onChange={(e) => setNewTableParent(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white focus:border-brand-500 focus:outline-none"
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
                <p className="text-[10px] text-slate-500 mt-1">
                  Ao estender, a tabela filha compartilha a PK/FK do pai e uma view polimórfica automática é criada.
                </p>
              </div>

              <div className="flex items-center space-x-2 pt-1">
                <input
                  type="checkbox"
                  id="extendable_new"
                  checked={newTableExtendable}
                  onChange={(e) => setNewTableExtendable(e.target.checked)}
                  className="rounded bg-slate-800 border-slate-700 text-brand-500 focus:ring-0"
                />
                <label htmlFor="extendable_new" className="text-slate-300 select-none cursor-pointer">
                  Permitir que outras tabelas herdem desta (is_extendable)
                </label>
              </div>

              <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setView('catalog')}
                  className="px-4 py-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-semibold transition-all shadow-glow-sm"
                >
                  <Save className="w-4 h-4" />
                  <span>Criar Tabela</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW: TABLE DETAILS & FORM (IN-PLACE EDIT, SUB-SECTIONS) */}
      {/* ========================================================================= */}
      {view === 'table-detail' && selectedTable && (
        <div className="space-y-6">
          {/* Header & Navigation */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center space-x-3">
              <button
                onClick={() => setView('catalog')}
                className="p-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div>
                <div className="flex items-center space-x-2.5">
                  <h2 className="text-lg font-bold text-white">{selectedTable.label}</h2>
                  <span className="font-mono text-xs px-2.5 py-0.5 rounded-lg bg-slate-800 text-slate-300 border border-slate-700">
                    {selectedTable.name}
                  </span>
                  {selectedTable.view_name && (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                      view: {selectedTable.view_name}
                    </span>
                  )}
                  <span
                    className={`text-[9px] px-2 py-0.5 rounded-full font-semibold ${
                      selectedTable.is_kernel_table
                        ? 'bg-slate-800 text-slate-400 border border-slate-700'
                        : 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
                    }`}
                  >
                    {selectedTable.is_kernel_table ? 'Kernel' : 'TPT Business'}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  ID: <span className="font-mono text-[10px]">{selectedTable.sys_id}</span>
                </p>
              </div>
            </div>

            {/* In-place Action Buttons */}
            <div className="flex items-center space-x-3">
              {!selectedTable.is_kernel_table && (
                <>
                  {!isEditingTable ? (
                    <>
                      <button
                        onClick={() => setIsEditingTable(true)}
                        className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-colors"
                      >
                        <Edit3 className="w-3.5 h-3.5 text-brand-400" />
                        <span>Editar Tabela</span>
                      </button>
                      <button
                        onClick={handleDeleteTable}
                        className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 text-xs font-medium border border-rose-500/20 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                        <span>Excluir Tabela</span>
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => setIsEditingTable(false)}
                        className="px-3.5 py-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 text-xs transition-colors"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={handleUpdateTable}
                        className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-glow-sm transition-all"
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>Salvar Tabela</span>
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Table Entity Form (Preserving Layout in View vs Edit Mode) */}
          <div className="glass-panel rounded-2xl border border-slate-800 p-6 space-y-4 shadow-xl">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
              <Database className="w-3.5 h-3.5 text-brand-400" />
              <span>Metadados da Classe</span>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              {/* Technical Name */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                  Nome Técnico (name)
                </label>
                <div className="px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 font-mono text-xs">
                  {selectedTable.name}
                </div>
              </div>

              {/* Display Label */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                  Rótulo de Exibição (label)
                </label>
                {isEditingTable ? (
                  <input
                    type="text"
                    value={editTableForm.label}
                    onChange={(e) => setEditTableForm({ ...editTableForm, label: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-brand-500 text-white focus:outline-none"
                  />
                ) : (
                  <div className="px-3.5 py-2.5 rounded-xl bg-slate-900/60 border border-slate-800 text-white font-medium text-xs">
                    {selectedTable.label}
                  </div>
                )}
              </div>

              {/* Super Class / Inheritance */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                  Herança TPT (super_class_id)
                </label>
                <div className="px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 text-xs">
                  {selectedTable.super_class_id
                    ? tables.find((p) => p.sys_id === selectedTable.super_class_id)?.label ||
                      selectedTable.super_class_id
                    : 'Tabela Raiz (Nenhuma)'}
                </div>
              </div>
            </div>

            <div className="pt-2 flex items-center space-x-6 text-xs text-slate-300">
              <label className="flex items-center space-x-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  disabled={!isEditingTable}
                  checked={isEditingTable ? editTableForm.is_extendable : selectedTable.is_extendable}
                  onChange={(e) =>
                    setEditTableForm({ ...editTableForm, is_extendable: e.target.checked })
                  }
                  className="rounded bg-slate-800 border-slate-700 text-brand-500 focus:ring-0 disabled:opacity-60"
                />
                <span>Permite Extensões (is_extendable)</span>
              </label>

              <span className="text-[11px] text-slate-500">
                Criado em: {new Date(selectedTable.sys_created_on).toLocaleString()}
              </span>
            </div>
          </div>

          {/* Sub-Section: Numbering Configuration */}
          {!selectedTable.is_kernel_table && (
            <div className="glass-panel rounded-2xl border border-slate-800 p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                    <Hash className="w-3.5 h-3.5 text-brand-400" />
                    <span>Configuração de Numeração Automática (sys_number)</span>
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Gera números sequenciais formatados pelo PostgreSQL (ex: INC0000001).
                  </p>
                </div>
                {!isConfiguringNumber ? (
                  <button
                    onClick={() => setIsConfiguringNumber(true)}
                    className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-colors"
                  >
                    <Edit3 className="w-3 h-3 text-brand-400" />
                    <span>Configurar Numeração</span>
                  </button>
                ) : (
                  <button
                    onClick={() => setIsConfiguringNumber(false)}
                    className="px-3 py-1.5 rounded-lg text-slate-400 hover:text-white text-xs"
                  >
                    Cancelar
                  </button>
                )}
              </div>

              {isConfiguringNumber ? (
                <form onSubmit={handleConfigureNumber} className="space-y-4 pt-2">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                        Prefixo (1 a 3 caracteres)
                      </label>
                      <input
                        type="text"
                        required
                        maxLength={3}
                        value={numPrefix}
                        onChange={(e) => setNumPrefix(e.target.value.toUpperCase())}
                        className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono uppercase focus:border-brand-500 focus:outline-none text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                        Dígitos Mínimos
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={19}
                        value={numDigits}
                        onChange={(e) => setNumDigits(Number(e.target.value))}
                        className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono focus:border-brand-500 focus:outline-none text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                        Número Inicial
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={numStart}
                        onChange={(e) => setNumStart(Number(e.target.value))}
                        className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono focus:border-brand-500 focus:outline-none text-xs"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-xl bg-slate-900 border border-slate-800">
                    <span className="text-xs text-slate-400">
                      Exemplo do próximo número:&nbsp;
                      <span className="font-mono text-emerald-400 font-bold">
                        {numPrefix.padEnd(3, 'X')}
                        {String(numStart).padStart(numDigits, '0')}
                      </span>
                    </span>
                    <button
                      type="submit"
                      className="px-4 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-semibold text-xs transition-all shadow-glow-sm"
                    >
                      Salvar Numeração
                    </button>
                  </div>
                </form>
              ) : null}
            </div>
          )}

          {/* Sub-Section: Fields (Attributes & CTE Inheritance) */}
          <div className="glass-panel rounded-2xl border border-slate-800 p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                  <Sliders className="w-3.5 h-3.5 text-brand-400" />
                  <span>Dicionário de Campos com Herança TPT ({fields.length})</span>
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Atributos resolvidos via CTE recursiva de linhagem. Clique em um campo para ver detalhes e editar.
                </p>
              </div>

              {!selectedTable.is_kernel_table && (
                <button
                  onClick={() => setView('field-new')}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow-glow-sm transition-all"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Adicionar Campo</span>
                </button>
              )}
            </div>

            {loadingDetails ? (
              <div className="py-8 text-center text-xs text-slate-400">
                Resolvendo metadados de campos no PostgreSQL...
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
                      <th className="py-2.5 px-3 text-right">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                    {fields.map((f, i) => (
                      <tr
                        key={i}
                        onClick={() => handleOpenFieldDetail(f)}
                        className={`hover:bg-slate-800/50 cursor-pointer transition-colors ${
                          f.inheritance_level > 0 ? 'bg-indigo-950/10' : ''
                        }`}
                      >
                        <td className="py-2 px-3 font-semibold text-white flex items-center gap-1.5">
                          <span>{f.column_name}</span>
                        </td>
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
                        <td className="py-2 px-3 text-right">
                          <button className="text-brand-400 hover:text-brand-300 text-[11px] font-sans font-medium">
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

          {/* Sub-Section: Dropdown Choices (sys_choice) */}
          <div className="glass-panel rounded-2xl border border-slate-800 p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                  <Tag className="w-3.5 h-3.5 text-brand-400" />
                  <span>Opções de Dropdown (sys_choice) ({choices.length})</span>
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Valores permitidos para colunas de escolha (ex: state, priority, category).
                </p>
              </div>

              {!selectedTable.is_kernel_table && (
                <button
                  onClick={() => setView('choice-new')}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5 text-brand-400" />
                  <span>Nova Opção</span>
                </button>
              )}
            </div>

            {choices.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-400 glass-card rounded-xl">
                Nenhuma opção de dropdown registrada para esta tabela.
              </div>
            ) : (
              <div className="overflow-x-auto border border-slate-800 rounded-xl">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-900/80 text-[11px] font-semibold text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="py-2.5 px-3">Campo Alvo (Element)</th>
                      <th className="py-2.5 px-3">Valor Técnico</th>
                      <th className="py-2.5 px-3">Rótulo Exibido</th>
                      <th className="py-2.5 px-3 text-center">Sequência</th>
                      <th className="py-2.5 px-3 text-right">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                    {choices.map((c) => (
                      <tr
                        key={c.sys_id}
                        onClick={() => handleOpenChoiceDetail(c)}
                        className="hover:bg-slate-800/50 cursor-pointer transition-colors"
                      >
                        <td className="py-2 px-3 font-semibold text-brand-300">{c.element}</td>
                        <td className="py-2 px-3 text-slate-200">{c.value}</td>
                        <td className="py-2 px-3 font-sans text-white font-medium">{c.label}</td>
                        <td className="py-2 px-3 text-center text-slate-400">{c.sequence}</td>
                        <td className="py-2 px-3 text-right">
                          <button className="text-brand-400 hover:text-brand-300 text-[11px] font-sans font-medium">
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
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW: FIELD CREATE PAGE (ZERO MODAL) */}
      {/* ========================================================================= */}
      {view === 'field-new' && selectedTable && (
        <div className="max-w-3xl mx-auto space-y-6">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => setView('table-detail')}
              className="p-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Plus className="w-5 h-5 text-brand-400" />
                <span>Adicionar Campo em {selectedTable.name}</span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Crie um novo atributo na classe {selectedTable.label}. O PostgreSQL adicionará a coluna e atualizará a view polimórfica.
              </p>
            </div>
          </div>

          <div className="glass-panel rounded-2xl border border-slate-800 p-6 shadow-2xl">
            <form onSubmit={handleAddField} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-300 mb-1.5">
                    Nome da Coluna (column_name) <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="ex: severity, caller_id, notes"
                    value={newColName}
                    onChange={(e) => setNewColName(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono focus:border-brand-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-300 mb-1.5">
                    Rótulo de Exibição (label) <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="ex: Gravidade do Incidente"
                    value={newColLabel}
                    onChange={(e) => setNewColLabel(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white focus:border-brand-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1.5">
                  Tipo de Dado Interno (internal_type)
                </label>
                <select
                  value={newColType}
                  onChange={(e) => setNewColType(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white focus:border-brand-500 focus:outline-none"
                >
                  <option value="string">string (VARCHAR 255)</option>
                  <option value="text">text (TEXT ilimitado)</option>
                  <option value="integer">integer (INTEGER 4 bytes)</option>
                  <option value="bigint">bigint (BIGINT 8 bytes)</option>
                  <option value="boolean">boolean (BOOLEAN default false)</option>
                  <option value="reference">reference (UUID Foreign Key)</option>
                  <option value="auto_number">auto_number (Numeração Automática TSK0000001)</option>
                  <option value="timestamptz">timestamptz (Timestamp com Timezone)</option>
                  <option value="jsonb">jsonb (JSONB flexível)</option>
                </select>
              </div>

              {newColType === 'reference' && (
                <div>
                  <label className="block font-semibold text-slate-300 mb-1.5">
                    Tabela Alvo da Referência (reference_table_id)
                  </label>
                  <select
                    value={newColRefTable}
                    onChange={(e) => setNewColRefTable(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white focus:border-brand-500 focus:outline-none"
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
                <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">Prefixo (1-3 car.)</label>
                      <input
                        type="text"
                        maxLength={3}
                        value={newColNumPrefix}
                        onChange={(e) => setNewColNumPrefix(e.target.value.toUpperCase())}
                        placeholder="INC"
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 font-mono text-xs uppercase text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">Dígitos Mínimos</label>
                      <input
                        type="number"
                        min={1}
                        max={19}
                        value={newColNumDigits}
                        onChange={(e) => setNewColNumDigits(Number(e.target.value))}
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 font-mono text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">Número Inicial</label>
                      <input
                        type="number"
                        min={1}
                        value={newColNumStart}
                        onChange={(e) => setNewColNumStart(Number(e.target.value))}
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 font-mono text-xs text-white"
                      />
                    </div>
                  </div>
                </div>
              )}

              {newColType !== 'auto_number' && (
                <div>
                  <label className="block font-semibold text-slate-300 mb-1.5">
                    Valor Padrão (default_value opcional)
                  </label>
                  <input
                    type="text"
                    value={newColDefault}
                    onChange={(e) => setNewColDefault(e.target.value)}
                    placeholder="ex: new, 1, false"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white focus:border-brand-500 focus:outline-none"
                  />
                </div>
              )}

              <div className="flex items-center space-x-6 pt-2">
                <label className="flex items-center space-x-2 text-slate-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={newColMandatory}
                    onChange={(e) => setNewColMandatory(e.target.checked)}
                    className="rounded bg-slate-800 border-slate-700 text-brand-500 focus:ring-0"
                  />
                  <span>Obrigatório (is_mandatory)</span>
                </label>
                <label className="flex items-center space-x-2 text-slate-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={newColReadOnly}
                    onChange={(e) => setNewColReadOnly(e.target.checked)}
                    className="rounded bg-slate-800 border-slate-700 text-brand-500 focus:ring-0"
                  />
                  <span>Somente Leitura (is_read_only)</span>
                </label>
              </div>

              <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setView('table-detail')}
                  className="px-4 py-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-semibold transition-all shadow-glow-sm"
                >
                  <Save className="w-4 h-4" />
                  <span>Criar Campo</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW: FIELD DETAILS & FORM (IN-PLACE EDIT, DELETE) */}
      {/* ========================================================================= */}
      {view === 'field-detail' && selectedField && selectedTable && (
        <div className="max-w-3xl mx-auto space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center space-x-3">
              <button
                onClick={() => setView('table-detail')}
                className="p-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div>
                <div className="flex items-center space-x-2">
                  <h2 className="text-lg font-bold text-white">{selectedField.label}</h2>
                  <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-800 text-brand-300 border border-slate-700">
                    {selectedField.column_name}
                  </span>
                  <span className="font-mono text-xs px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                    {selectedField.internal_type}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Tabela: <span className="font-semibold text-white">{selectedTable.label}</span> ({selectedTable.name})
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-3">
              {!isEditingField ? (
                <>
                  <button
                    onClick={() => setIsEditingField(true)}
                    className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-colors"
                  >
                    <Edit3 className="w-3.5 h-3.5 text-brand-400" />
                    <span>Editar Campo</span>
                  </button>
                  {selectedField.inheritance_level === 0 && (
                    <button
                      onClick={handleDeleteField}
                      className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 text-xs font-medium border border-rose-500/20 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                      <span>Excluir Campo</span>
                    </button>
                  )}
                </>
              ) : (
                <>
                  <button
                    onClick={() => setIsEditingField(false)}
                    className="px-3.5 py-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 text-xs transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleUpdateField}
                    className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-glow-sm transition-all"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Salvar Campo</span>
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="glass-panel rounded-2xl border border-slate-800 p-6 space-y-4 shadow-2xl">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
              <Sliders className="w-3.5 h-3.5 text-brand-400" />
              <span>Metadados do Atributo</span>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                  Nome da Coluna (Físico)
                </label>
                <div className="px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 font-mono text-xs">
                  {selectedField.column_name}
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                  Rótulo (Label)
                </label>
                {isEditingField ? (
                  <input
                    type="text"
                    value={editFieldForm.label}
                    onChange={(e) => setEditFieldForm({ ...editFieldForm, label: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-brand-500 text-white focus:outline-none"
                  />
                ) : (
                  <div className="px-3.5 py-2.5 rounded-xl bg-slate-900/60 border border-slate-800 text-white font-medium text-xs">
                    {selectedField.label}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                  Tipo Interno (internal_type)
                </label>
                <div className="px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-brand-300 font-mono text-xs">
                  {selectedField.internal_type}
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                  Valor Padrão (default_value)
                </label>
                {isEditingField ? (
                  <input
                    type="text"
                    value={editFieldForm.default_value}
                    onChange={(e) =>
                      setEditFieldForm({ ...editFieldForm, default_value: e.target.value })
                    }
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-brand-500 text-white focus:outline-none"
                  />
                ) : (
                  <div className="px-3.5 py-2.5 rounded-xl bg-slate-900/60 border border-slate-800 text-slate-300 font-mono text-xs">
                    {selectedField.default_value || '(nenhum)'}
                  </div>
                )}
              </div>
            </div>

            <div className="pt-2 flex items-center space-x-6 text-xs text-slate-300">
              <label className="flex items-center space-x-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  disabled={!isEditingField}
                  checked={isEditingField ? editFieldForm.is_mandatory : selectedField.is_mandatory}
                  onChange={(e) =>
                    setEditFieldForm({ ...editFieldForm, is_mandatory: e.target.checked })
                  }
                  className="rounded bg-slate-800 border-slate-700 text-brand-500 focus:ring-0 disabled:opacity-60"
                />
                <span>Obrigatório (is_mandatory)</span>
              </label>

              <label className="flex items-center space-x-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  disabled={!isEditingField}
                  checked={isEditingField ? editFieldForm.is_read_only : selectedField.is_read_only}
                  onChange={(e) =>
                    setEditFieldForm({ ...editFieldForm, is_read_only: e.target.checked })
                  }
                  className="rounded bg-slate-800 border-slate-700 text-brand-500 focus:ring-0 disabled:opacity-60"
                />
                <span>Somente Leitura (is_read_only)</span>
              </label>
            </div>

            {selectedField.inheritance_level > 0 && (
              <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs flex items-center gap-2">
                <Info className="w-4 h-4 text-indigo-400 shrink-0" />
                <span>
                  Este campo foi herdado da tabela base &apos;{selectedField.defined_in_table}&apos; (Nível {selectedField.inheritance_level}). Ele não pode ser excluído diretamente desta classe filha.
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW: CHOICE CREATE PAGE (ZERO MODAL) */}
      {/* ========================================================================= */}
      {view === 'choice-new' && selectedTable && (
        <div className="max-w-2xl mx-auto space-y-6">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => setView('table-detail')}
              className="p-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Tag className="w-5 h-5 text-brand-400" />
                <span>Adicionar Opção de Dropdown em {selectedTable.name}</span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Cadastre um valor para campos select/choice (ex: state, status, category).
              </p>
            </div>
          </div>

          <div className="glass-panel rounded-2xl border border-slate-800 p-6 shadow-2xl">
            <form onSubmit={handleAddChoice} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-300 mb-1.5">
                  Campo Alvo (element) <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="ex: state, priority, category"
                  value={choiceElement}
                  onChange={(e) => setChoiceElement(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono focus:border-brand-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-300 mb-1.5">
                    Valor Técnico no DB (value) <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="ex: in_progress"
                    value={choiceValue}
                    onChange={(e) => setChoiceValue(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono focus:border-brand-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-300 mb-1.5">
                    Rótulo Exibido (label) <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="ex: Em Andamento"
                    value={choiceLabel}
                    onChange={(e) => setChoiceLabel(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white focus:border-brand-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1.5">
                  Ordem de Exibição (sequence)
                </label>
                <input
                  type="number"
                  value={choiceSeq}
                  onChange={(e) => setChoiceSeq(Number(e.target.value))}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono focus:border-brand-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setView('table-detail')}
                  className="px-4 py-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-semibold transition-all shadow-glow-sm"
                >
                  <Save className="w-4 h-4" />
                  <span>Salvar Opção</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW: CHOICE DETAILS & FORM (IN-PLACE EDIT, DELETE) */}
      {/* ========================================================================= */}
      {view === 'choice-detail' && selectedChoice && selectedTable && (
        <div className="max-w-2xl mx-auto space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center space-x-3">
              <button
                onClick={() => setView('table-detail')}
                className="p-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div>
                <div className="flex items-center space-x-2">
                  <h2 className="text-lg font-bold text-white">{selectedChoice.label}</h2>
                  <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-800 text-brand-300 border border-slate-700">
                    {selectedChoice.element} = {selectedChoice.value}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Tabela: <span className="font-semibold text-white">{selectedTable.label}</span>
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-3">
              {!isEditingChoice ? (
                <>
                  <button
                    onClick={() => setIsEditingChoice(true)}
                    className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-colors"
                  >
                    <Edit3 className="w-3.5 h-3.5 text-brand-400" />
                    <span>Editar Opção</span>
                  </button>
                  <button
                    onClick={handleDeleteChoice}
                    className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 text-xs font-medium border border-rose-500/20 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                    <span>Excluir Opção</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setIsEditingChoice(false)}
                    className="px-3.5 py-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 text-xs transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleUpdateChoice}
                    className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-glow-sm transition-all"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Salvar Opção</span>
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="glass-panel rounded-2xl border border-slate-800 p-6 space-y-4 shadow-2xl">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
              <Tag className="w-3.5 h-3.5 text-brand-400" />
              <span>Metadados da Opção</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                  Campo Alvo (element)
                </label>
                <div className="px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-brand-300 font-mono text-xs">
                  {selectedChoice.element}
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                  Valor Técnico no DB (value)
                </label>
                {isEditingChoice ? (
                  <input
                    type="text"
                    value={editChoiceForm.value}
                    onChange={(e) =>
                      setEditChoiceForm({ ...editChoiceForm, value: e.target.value })
                    }
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-brand-500 text-white font-mono focus:outline-none"
                  />
                ) : (
                  <div className="px-3.5 py-2.5 rounded-xl bg-slate-900/60 border border-slate-800 text-slate-200 font-mono text-xs">
                    {selectedChoice.value}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                  Rótulo Exibido (label)
                </label>
                {isEditingChoice ? (
                  <input
                    type="text"
                    value={editChoiceForm.label}
                    onChange={(e) =>
                      setEditChoiceForm({ ...editChoiceForm, label: e.target.value })
                    }
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-brand-500 text-white focus:outline-none"
                  />
                ) : (
                  <div className="px-3.5 py-2.5 rounded-xl bg-slate-900/60 border border-slate-800 text-white font-medium text-xs">
                    {selectedChoice.label}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                  Ordem de Exibição (sequence)
                </label>
                {isEditingChoice ? (
                  <input
                    type="number"
                    value={editChoiceForm.sequence}
                    onChange={(e) =>
                      setEditChoiceForm({ ...editChoiceForm, sequence: Number(e.target.value) })
                    }
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-brand-500 text-white font-mono focus:outline-none"
                  />
                ) : (
                  <div className="px-3.5 py-2.5 rounded-xl bg-slate-900/60 border border-slate-800 text-slate-300 font-mono text-xs">
                    {selectedChoice.sequence}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
