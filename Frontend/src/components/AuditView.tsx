'use client';

import React, { useState, useEffect } from 'react';
import { api, TableInfo } from '@/lib/api';
import { History, Search, RefreshCw, Filter, CheckCircle2, User, Clock, Database, Tag } from 'lucide-react';

export function AuditView() {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [selectedTable, setSelectedTable] = useState('');
  const [docId, setDocId] = useState('');
  const [auditList, setAuditList] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    api.schema.listTables(true).then((data) => {
      setTables(data);
      if (data.length > 0) {
        const firstBiz = data.find((t) => !t.is_kernel_table) || data[0];
        setSelectedTable(firstBiz.name);
      }
    });
  }, []);

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedTable) return;
    setLoading(true);
    try {
      if (docId.trim()) {
        const entries = await api.records.audit(selectedTable, docId.trim());
        setAuditList(entries);
      } else {
        // Query recent records from the table to show their audit
        const recList = await api.records.list(selectedTable, { limit: 5 });
        if (recList.data && recList.data.length > 0) {
          const allEntries: any[] = [];
          for (const rec of recList.data) {
            const entries = await api.records.audit(selectedTable, rec.sys_id).catch(() => []);
            allEntries.push(...entries);
          }
          setAuditList(allEntries);
        } else {
          setAuditList([]);
        }
      }
    } catch (err: any) {
      setToast(err.message || 'Erro ao carregar auditoria');
      setTimeout(() => setToast(null), 4000);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedTable) {
      handleSearch();
    }
  }, [selectedTable]);

  return (
    <div className="space-y-6">
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 p-4 rounded-xl bg-slate-900 border border-brand-500/40 text-slate-100 text-xs shadow-2xl flex items-center space-x-3 animate-bounce">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{toast}</span>
        </div>
      )}

      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-white flex items-center gap-2.5">
          <History className="w-5 h-5 text-brand-400" />
          <span>Universal Audit Trail Explorer (sys_audit)</span>
        </h2>
        <p className="text-xs text-slate-400 mt-1">
          Histórico imutável de todas as mutações físicas (INSERT, UPDATE, DELETE) capturadas via PL/pgSQL triggers.
        </p>
      </div>

      {/* Search Bar */}
      <div className="glass-panel rounded-2xl border border-slate-800 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <form onSubmit={handleSearch} className="flex flex-1 items-center gap-3">
          <select
            value={selectedTable}
            onChange={(e) => setSelectedTable(e.target.value)}
            className="px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white text-xs font-medium focus:border-brand-500 focus:outline-none"
          >
            {tables.map((t) => (
              <option key={t.sys_id} value={t.name}>
                {t.label} ({t.name})
              </option>
            ))}
          </select>

          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-2.5 pointer-events-none" />
            <input
              type="text"
              placeholder="Filtrar por Document ID UUID específico (opcional)..."
              value={docId}
              onChange={(e) => setDocId(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white text-xs font-mono placeholder:text-slate-500 focus:border-brand-500 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow-glow-sm"
          >
            Filtrar
          </button>
        </form>

        <button
          onClick={() => handleSearch()}
          className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 self-end sm:self-auto"
          title="Recarregar"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Audit Log Results */}
      <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden shadow-xl">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
            Eventos Capturados ({auditList.length})
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-900/90 text-[11px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">Operação</th>
                <th className="py-3 px-4">Tabela</th>
                <th className="py-3 px-4">Campo Alterado</th>
                <th className="py-3 px-4">Valor Anterior</th>
                <th className="py-3 px-4">Valor Novo</th>
                <th className="py-3 px-4">Autor (sys_user)</th>
                <th className="py-3 px-4">Data / Hora (UTC)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400 font-sans">
                    Carregando trilha de auditoria...
                  </td>
                </tr>
              ) : auditList.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400 font-sans">
                    Nenhum evento de auditoria encontrado. Realize inserções ou alterações em registros para gerar registros de auditoria!
                  </td>
                </tr>
              ) : (
                auditList.map((entry, idx) => (
                  <tr key={idx} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-3 px-4">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded font-sans uppercase ${
                          entry.operation === 'INSERT'
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : entry.operation === 'UPDATE'
                            ? 'bg-brand-500/10 text-brand-300 border border-brand-500/20'
                            : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                        }`}
                      >
                        {entry.operation}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-300 font-sans font-medium">{entry.table_name}</td>
                    <td className="py-3 px-4 text-indigo-300 font-bold">{entry.field_name}</td>
                    <td className="py-3 px-4 text-slate-400 max-w-xs truncate">
                      {entry.old_value !== null && entry.old_value !== undefined
                        ? JSON.stringify(entry.old_value)
                        : '-'}
                    </td>
                    <td className="py-3 px-4 text-emerald-300 font-semibold max-w-xs truncate">
                      {entry.new_value !== null && entry.new_value !== undefined
                        ? JSON.stringify(entry.new_value)
                        : '-'}
                    </td>
                    <td className="py-3 px-4 text-slate-200 font-sans">
                      {entry.changed_by?.user_name || 'system_service'}
                    </td>
                    <td className="py-3 px-4 text-slate-400 text-[11px]">
                      {new Date(entry.changed_on).toLocaleString()}
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
