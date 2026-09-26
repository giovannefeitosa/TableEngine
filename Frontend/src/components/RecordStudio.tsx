'use client';

import React, { useState, useEffect } from 'react';
import { api, TableInfo, FieldInfo, TransitionInfo, AuditEntry } from '@/lib/api';
import {
  Database,
  Plus,
  Search,
  Filter,
  RefreshCw,
  Edit3,
  Trash2,
  History,
  GitBranch,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  X,
  Clock,
  User,
  Shield,
  Layers,
  ChevronLeft,
  ChevronRight,
  Eye,
  SlidersHorizontal,
} from 'lucide-react';

export function RecordStudio() {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [selectedTableName, setSelectedTableName] = useState<string>('');
  const [fields, setFields] = useState<FieldInfo[]>([]);
  const [records, setRecords] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [limit, setLimit] = useState(25);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingFields, setLoadingFields] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Active record detail / edit modal
  const [activeRecord, setActiveRecord] = useState<any | null>(null);
  const [isNewRecord, setIsNewRecord] = useState(false);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [choicesCache, setChoicesCache] = useState<Record<string, { value: string; label: string }[]>>({});

  // FSM State transitions & Audit
  const [availableTransitions, setAvailableTransitions] = useState<TransitionInfo[]>([]);
  const [loadingTransitions, setLoadingTransitions] = useState(false);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [showAuditDrawer, setShowAuditDrawer] = useState(false);
  const [loadingAudit, setLoadingAudit] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  // Load tables catalogue
  useEffect(() => {
    api.schema
      .listTables(true)
      .then((data) => {
        setTables(data);
        const firstBiz = data.find((t) => !t.is_kernel_table) || data[0];
        if (firstBiz) {
          setSelectedTableName(firstBiz.name);
        }
      })
      .catch((err) => showToast(err.message));
  }, []);

  // When table changes, load fields and records
  useEffect(() => {
    if (!selectedTableName) return;
    loadTableData(selectedTableName);
  }, [selectedTableName, limit, offset]);

  const loadTableData = async (tblName: string) => {
    setLoading(true);
    setLoadingFields(true);
    try {
      const [fieldList, recordList] = await Promise.all([
        api.schema.getFields(tblName),
        api.records.list(tblName, { limit, offset }),
      ]);
      setFields(fieldList);
      setRecords(recordList.data || []);
      setTotalCount(recordList.meta?.total_count || 0);

      // Load choices for dropdown fields (like 'state')
      fieldList.forEach((f) => {
        if (f.column_name === 'state' || f.internal_type === 'string') {
          api.schema
            .getChoices(tblName, f.column_name)
            .then((chList) => {
              if (chList.length > 0) {
                setChoicesCache((prev) => ({
                  ...prev,
                  [f.column_name]: chList.map((c) => ({ value: c.value, label: c.label })),
                }));
              }
            })
            .catch(() => {});
        }
      });
    } catch (err: any) {
      showToast(err.message || 'Erro ao carregar dados da tabela');
    } finally {
      setLoading(false);
      setLoadingFields(false);
    }
  };

  // Open Record Details
  const handleOpenRecord = async (record: any) => {
    setActiveRecord(record);
    setIsNewRecord(false);
    setFormData({ ...record });
    loadRecordTransitions(record);
  };

  // Load available FSM UI actions for record
  const loadRecordTransitions = async (record: any) => {
    if (!record?.sys_id) return;
    setLoadingTransitions(true);
    try {
      const transitions = await api.records.availableTransitions(selectedTableName, record.sys_id);
      setAvailableTransitions(transitions || []);
    } catch (err: any) {
      setAvailableTransitions([]);
    } finally {
      setLoadingTransitions(false);
    }
  };

  // Open New Record Form
  const handleNewRecord = () => {
    const initData: Record<string, any> = {};
    fields.forEach((f) => {
      if (f.default_value) {
        initData[f.column_name] = f.default_value;
      }
    });
    setActiveRecord(null);
    setIsNewRecord(true);
    setFormData(initData);
    setAvailableTransitions([]);
  };

  // Save Record (Create or Update)
  const handleSaveRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (isNewRecord) {
        const created = await api.records.create(selectedTableName, formData);
        showToast('Registro criado com sucesso!');
        setActiveRecord(created);
        setIsNewRecord(false);
        setFormData({ ...created });
        loadRecordTransitions(created);
      } else {
        const updated = await api.records.update(selectedTableName, activeRecord.sys_id, {
          sys_mod_count: activeRecord.sys_mod_count,
          ...formData,
        });
        showToast('Registro atualizado com sucesso!');
        setActiveRecord(updated);
        setFormData({ ...updated });
        loadRecordTransitions(updated);
      }
      loadTableData(selectedTableName);
    } catch (err: any) {
      showToast(err.message);
    }
  };

  // Execute FSM State Transition
  const handleExecuteTransition = async (transition: TransitionInfo) => {
    if (!activeRecord) return;
    try {
      const updated = await api.records.executeTransition(
        selectedTableName,
        activeRecord.sys_id,
        transition.transition_id,
        {
          sys_mod_count: activeRecord.sys_mod_count,
          payload: formData,
        }
      );
      showToast(`Transição '${transition.label}' executada com sucesso!`);
      setActiveRecord(updated);
      setFormData({ ...updated });
      loadRecordTransitions(updated);
      loadTableData(selectedTableName);
    } catch (err: any) {
      showToast(err.message);
    }
  };

  // Delete Record
  const handleDeleteRecord = async () => {
    if (!activeRecord) return;
    if (!confirm('Confirma a exclusão deste registro? A ação removerá tuplas em todas as tabelas derivadas (TPT Cascade).')) {
      return;
    }
    try {
      await api.records.delete(selectedTableName, activeRecord.sys_id);
      showToast('Registro excluído com sucesso!');
      setActiveRecord(null);
      loadTableData(selectedTableName);
    } catch (err: any) {
      showToast(err.message);
    }
  };

  // Open Audit Drawer
  const handleOpenAudit = async () => {
    if (!activeRecord?.sys_id) return;
    setShowAuditDrawer(true);
    setLoadingAudit(true);
    try {
      const entries = await api.records.audit(selectedTableName, activeRecord.sys_id);
      setAuditEntries(entries);
    } catch (err: any) {
      showToast(err.message || 'Erro ao carregar histórico de auditoria');
    } finally {
      setLoadingAudit(false);
    }
  };

  // Grid displayed columns: prioritize friendly columns
  const displayedCols = fields
    .filter((f) => !['sys_class_name', 'sys_updated_by', 'sys_created_by'].includes(f.column_name))
    .slice(0, 6);

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 p-4 rounded-xl bg-slate-900 border border-brand-500/40 text-slate-100 text-xs shadow-2xl flex items-center space-x-3 animate-bounce">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{toast}</span>
        </div>
      )}

      {/* Header & Table Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2.5">
            <Database className="w-5 h-5 text-brand-400" />
            <span>Record Studio (Dynamic Data Browser)</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Explorador dinâmico de dados, formulários automáticos, ações de estado e trilha de auditoria.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <select
            value={selectedTableName}
            onChange={(e) => {
              setSelectedTableName(e.target.value);
              setOffset(0);
            }}
            className="px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white text-xs font-medium focus:border-brand-500 focus:outline-none"
          >
            {tables.map((t) => (
              <option key={t.sys_id} value={t.name}>
                {t.label} ({t.name})
              </option>
            ))}
          </select>

          <button
            onClick={handleNewRecord}
            className="flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow-glow-sm transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            <Plus className="w-4 h-4" />
            <span>Novo Registro</span>
          </button>
        </div>
      </div>

      {/* Grid Filter Bar */}
      <div className="glass-panel rounded-2xl border border-slate-800 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-2.5 pointer-events-none" />
          <input
            type="text"
            placeholder="Pesquisar registros..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:border-brand-500"
          />
        </div>

        <div className="flex items-center space-x-3 text-xs text-slate-400">
          <span>Total: <strong className="text-white font-mono">{totalCount}</strong> registros</span>
          <button
            onClick={() => loadTableData(selectedTableName)}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            title="Atualizar"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Records Data Table */}
      <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-900/90 text-[11px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800">
              <tr>
                {displayedCols.map((c) => (
                  <th key={c.column_name} className="py-3 px-4">
                    {c.label}
                  </th>
                ))}
                <th className="py-3 px-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
              {loading ? (
                <tr>
                  <td colSpan={displayedCols.length + 1} className="py-12 text-center text-slate-400">
                    Carregando registros...
                  </td>
                </tr>
              ) : records.length === 0 ? (
                <tr>
                  <td colSpan={displayedCols.length + 1} className="py-12 text-center text-slate-400">
                    Nenhum registro encontrado nesta tabela. Clique em "Novo Registro" para cadastrar!
                  </td>
                </tr>
              ) : (
                records
                  .filter((r) => {
                    if (!search) return true;
                    return JSON.stringify(r).toLowerCase().includes(search.toLowerCase());
                  })
                  .map((rec) => (
                    <tr
                      key={rec.sys_id}
                      onClick={() => handleOpenRecord(rec)}
                      className="hover:bg-slate-800/40 cursor-pointer transition-colors group"
                    >
                      {displayedCols.map((c) => {
                        const val = rec[c.column_name];
                        return (
                          <td key={c.column_name} className="py-3 px-4">
                            {c.column_name === 'state' ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-brand-500/10 text-brand-300 border border-brand-500/20 font-sans">
                                {val || 'draft'}
                              </span>
                            ) : c.column_name === 'number' ? (
                              <span className="font-bold text-white bg-slate-800 px-2 py-0.5 rounded">
                                {val || '-'}
                              </span>
                            ) : typeof val === 'boolean' ? (
                              val ? (
                                <span className="text-emerald-400 font-bold">Sim</span>
                              ) : (
                                <span className="text-slate-500">Não</span>
                              )
                            ) : (
                              <span className="truncate max-w-xs block font-sans">
                                {val !== null && val !== undefined ? String(val) : '-'}
                              </span>
                            )}
                          </td>
                        );
                      })}
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenRecord(rec);
                          }}
                          className="px-2.5 py-1 rounded bg-slate-800 hover:bg-brand-600 text-slate-300 hover:text-white transition-colors text-[11px] font-sans font-medium"
                        >
                          Abrir
                        </button>
                      </td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <div className="p-3 bg-slate-900/60 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <div>
            Mostrando {records.length} de {totalCount} registros
          </div>
          <div className="flex items-center space-x-2">
            <button
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - limit))}
              className="p-1.5 rounded-lg bg-slate-800 text-slate-300 disabled:opacity-30 hover:bg-slate-700"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-2 font-mono">
              Página {Math.floor(offset / limit) + 1}
            </span>
            <button
              disabled={offset + limit >= totalCount}
              onClick={() => setOffset(offset + limit)}
              className="p-1.5 rounded-lg bg-slate-800 text-slate-300 disabled:opacity-30 hover:bg-slate-700"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Modal / Drawer: Form View & FSM State Actions */}
      {(activeRecord || isNewRecord) && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="max-w-2xl w-full glass-panel rounded-2xl border border-slate-700 shadow-2xl p-6 space-y-6 my-8">
            {/* Modal Top Header with Action Buttons */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800 gap-4">
              <div>
                <div className="flex items-center space-x-2">
                  <span className="text-base font-bold text-white">
                    {isNewRecord
                      ? `Novo Registro em ${selectedTableName}`
                      : `${activeRecord.number || activeRecord.sys_id}`}
                  </span>
                  {!isNewRecord && (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                      v{activeRecord.sys_mod_count}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  {selectedTableName} • Concorrência Otimista & FSM Guard
                </p>
              </div>

              <div className="flex items-center space-x-2">
                {!isNewRecord && (
                  <>
                    <button
                      type="button"
                      onClick={handleOpenAudit}
                      className="px-3 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-xs font-medium flex items-center space-x-1.5 transition-colors"
                    >
                      <History className="w-3.5 h-3.5" />
                      <span>Auditoria</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleDeleteRecord}
                      className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 transition-colors"
                      title="Excluir Registro"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setActiveRecord(null);
                    setIsNewRecord(false);
                  }}
                  className="p-1.5 text-slate-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* DYNAMIC FSM UI ACTION BUTTONS */}
            {!isNewRecord && availableTransitions.length > 0 && (
              <div className="p-3.5 rounded-xl bg-brand-950/40 border border-brand-500/30 space-y-2">
                <div className="flex items-center space-x-2 text-xs text-brand-300 font-semibold">
                  <GitBranch className="w-4 h-4 text-brand-400" />
                  <span>Ações de Estado Disponíveis (UI Actions / FSM):</span>
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  {availableTransitions.map((t) => (
                    <button
                      key={t.transition_id}
                      type="button"
                      onClick={() => handleExecuteTransition(t)}
                      className="px-4 py-2 rounded-xl bg-gradient-to-r from-brand-600 to-indigo-600 hover:from-brand-500 hover:to-indigo-500 text-white text-xs font-bold shadow-glow-sm flex items-center space-x-2 transition-all hover:scale-[1.02] active:scale-[0.98]"
                    >
                      <span>{t.label}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Form Fields Rendered Dynamically */}
            <form onSubmit={handleSaveRecord} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {fields.map((f) => {
                  const isSys = ['sys_created_on', 'sys_created_by', 'sys_updated_on', 'sys_updated_by', 'sys_mod_count', 'sys_class_name'].includes(f.column_name);
                  const isId = f.column_name === 'sys_id';
                  const isAutoNum = f.internal_type === 'auto_number';
                  const isReadOnly = f.is_read_only || isSys || isId || isAutoNum;
                  const choices = choicesCache[f.column_name];

                  const val = formData[f.column_name] !== undefined ? formData[f.column_name] : '';

                  return (
                    <div
                      key={f.column_name}
                      className={f.internal_type === 'text' ? 'sm:col-span-2' : ''}
                    >
                      <label className="block font-semibold text-slate-300 mb-1 flex items-center justify-between">
                        <span className="flex items-center gap-1.5">
                          <span>{f.label}</span>
                          {f.is_mandatory && <span className="text-rose-400 font-bold">*</span>}
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">
                          {f.column_name}
                        </span>
                      </label>

                      {choices && choices.length > 0 && !isReadOnly ? (
                        <select
                          value={String(val)}
                          onChange={(e) =>
                            setFormData({ ...formData, [f.column_name]: e.target.value })
                          }
                          className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white focus:border-brand-500 focus:outline-none"
                        >
                          <option value="">Selecione uma opção...</option>
                          {choices.map((c) => (
                            <option key={c.value} value={c.value}>
                              {c.label} ({c.value})
                            </option>
                          ))}
                        </select>
                      ) : f.internal_type === 'text' ? (
                        <textarea
                          rows={3}
                          disabled={isReadOnly}
                          value={String(val)}
                          onChange={(e) =>
                            setFormData({ ...formData, [f.column_name]: e.target.value })
                          }
                          className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white disabled:opacity-50 focus:border-brand-500 focus:outline-none"
                        />
                      ) : f.internal_type === 'boolean' ? (
                        <div className="pt-2">
                          <label className="flex items-center space-x-2 text-slate-300 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              disabled={isReadOnly}
                              checked={Boolean(val)}
                              onChange={(e) =>
                                setFormData({ ...formData, [f.column_name]: e.target.checked })
                              }
                              className="rounded bg-slate-800 border-slate-700 text-brand-500 focus:ring-0"
                            />
                            <span>{Boolean(val) ? 'Verdadeiro' : 'Falso'}</span>
                          </label>
                        </div>
                      ) : (
                        <input
                          type={f.internal_type === 'integer' || f.internal_type === 'bigint' ? 'number' : 'text'}
                          disabled={isReadOnly}
                          required={f.is_mandatory && !isReadOnly}
                          value={isAutoNum && isNewRecord ? '(Gerado automaticamente pelo servidor)' : String(val)}
                          onChange={(e) => {
                            const v = f.internal_type === 'integer' || f.internal_type === 'bigint'
                              ? Number(e.target.value)
                              : e.target.value;
                            setFormData({ ...formData, [f.column_name]: v });
                          }}
                          className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white disabled:opacity-50 focus:border-brand-500 focus:outline-none font-mono"
                        />
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setActiveRecord(null);
                    setIsNewRecord(false);
                  }}
                  className="px-4 py-2 rounded-xl text-slate-400 hover:text-white"
                >
                  Fechar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-semibold shadow-glow-sm transition-all"
                >
                  {isNewRecord ? 'Criar Registro' : 'Salvar Alterações'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* AUDIT TRAIL TIMELINE DRAWER */}
      {showAuditDrawer && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex justify-end">
          <div className="max-w-md w-full h-full glass-panel border-l border-slate-800 p-6 space-y-4 flex flex-col justify-between overflow-y-auto shadow-2xl">
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <History className="w-4 h-4 text-brand-400" />
                  <span>Trilha de Auditoria (sys_audit)</span>
                </h3>
                <button onClick={() => setShowAuditDrawer(false)} className="text-slate-400 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="mt-4 space-y-3">
                {loadingAudit ? (
                  <div className="py-12 text-center text-xs text-slate-400">
                    Carregando histórico de auditoria...
                  </div>
                ) : auditEntries.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-400 glass-card rounded-xl">
                    Nenhum registro de auditoria encontrado para este documento.
                  </div>
                ) : (
                  auditEntries.map((a) => (
                    <div
                      key={a.sys_id}
                      className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 text-xs space-y-1.5"
                    >
                      <div className="flex items-center justify-between text-[11px]">
                        <span
                          className={`font-bold px-1.5 py-0.5 rounded text-[10px] ${
                            a.operation === 'INSERT'
                              ? 'bg-emerald-500/10 text-emerald-400'
                              : a.operation === 'UPDATE'
                              ? 'bg-brand-500/10 text-brand-300'
                              : 'bg-rose-500/10 text-rose-400'
                          }`}
                        >
                          {a.operation} • {a.field_name}
                        </span>
                        <span className="text-slate-500 text-[10px]">
                          {new Date(a.changed_on).toLocaleString()}
                        </span>
                      </div>

                      {a.operation === 'UPDATE' && (
                        <div className="grid grid-cols-2 gap-2 text-[10px] font-mono pt-1">
                          <div className="p-1.5 rounded bg-slate-950/60 text-slate-400 truncate">
                            <span className="text-rose-400 block font-sans">Anterior:</span>
                            {JSON.stringify(a.old_value)}
                          </div>
                          <div className="p-1.5 rounded bg-slate-950/60 text-emerald-300 truncate">
                            <span className="text-emerald-400 block font-sans">Novo:</span>
                            {JSON.stringify(a.new_value)}
                          </div>
                        </div>
                      )}

                      <div className="pt-1 text-[10px] text-slate-400 flex items-center justify-between border-t border-slate-800/60">
                        <span>Autor: <strong>{a.changed_by.user_name}</strong></span>
                        <span className="text-slate-500 font-mono text-[9px]">{a.table_name}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <button
              onClick={() => setShowAuditDrawer(false)}
              className="w-full py-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white text-xs font-semibold"
            >
              Fechar Painel de Auditoria
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
