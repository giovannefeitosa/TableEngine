'use client';

import React, { useState, useEffect } from 'react';
import { api, TableInfo } from '@/lib/api';
import {
  Layers,
  Database,
  GitBranch,
  Code2,
  History,
  ShieldCheck,
  Sparkles,
  ArrowRight,
  TrendingUp,
  Cpu,
  CheckCircle2,
  Activity,
} from 'lucide-react';
import { NavTab } from './Sidebar';

interface DashboardViewProps {
  onNavigate: (tab: NavTab) => void;
}

export function DashboardView({ onNavigate }: DashboardViewProps) {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [transitionsCount, setTransitionsCount] = useState(0);
  const [rulesCount, setRulesCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.schema.listTables(true),
      api.fsm.listTransitions().catch(() => []),
      api.rules.listRules().catch(() => []),
    ])
      .then(([tbls, trans, rls]) => {
        setTables(tbls || []);
        setTransitionsCount(trans?.length || 0);
        setRulesCount(rls?.length || 0);
      })
      .finally(() => setLoading(false));
  }, []);

  const businessTables = tables.filter((t) => !t.is_kernel_table);
  const tptDerivedTables = businessTables.filter((t) => t.super_class_id !== null);

  const stats = [
    {
      title: 'Tabelas de Negócio',
      value: businessTables.length,
      sub: `${tptDerivedTables.length} derivadas por herança TPT`,
      icon: Layers,
      color: 'from-brand-600 to-indigo-600',
      action: () => onNavigate('schema'),
    },
    {
      title: 'Tabelas do Kernel',
      value: tables.filter((t) => t.is_kernel_table).length,
      sub: 'sys_db_object, sys_user, etc.',
      icon: Database,
      color: 'from-slate-700 to-slate-800',
      action: () => onNavigate('schema'),
    },
    {
      title: 'Máquina de Estados (FSM)',
      value: transitionsCount,
      sub: 'Transições e UI Actions registradas',
      icon: GitBranch,
      color: 'from-emerald-600 to-teal-600',
      action: () => onNavigate('transitions'),
    },
    {
      title: 'Regras de Negócio Ativas',
      value: rulesCount,
      sub: 'Gatilhos sys_script com Sandbox Goja',
      icon: Code2,
      color: 'from-violet-600 to-purple-600',
      action: () => onNavigate('rules'),
    },
  ];

  return (
    <div className="space-y-8">
      {/* Welcome Hero Card */}
      <div className="glass-panel rounded-2xl border border-brand-500/20 p-8 shadow-2xl relative overflow-hidden bg-gradient-to-br from-slate-900 via-slate-900/90 to-brand-950/30">
        <div className="max-w-2xl relative z-10">
          <div className="flex items-center space-x-2 text-brand-400 text-xs font-bold uppercase tracking-wider mb-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            <span>Plataforma Operacional • Zero Setup</span>
          </div>
          <h2 className="text-2xl font-extrabold text-white tracking-tight">
            Motor de Dados Dinâmico Table-per-Type (TPT)
          </h2>
          <p className="text-xs text-slate-300 mt-2 leading-relaxed">
            Plataforma aPaaS orientada a metadados no PostgreSQL 16 com herança polimórfica, controle de concorrência otimista (Optimistic Locking), AST de condições declarativas e trilha de auditoria universal.
          </p>

          <div className="flex flex-wrap items-center gap-3 mt-6">
            <button
              onClick={() => onNavigate('quickstart')}
              className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-brand-600 to-indigo-600 hover:from-brand-500 hover:to-indigo-500 text-white text-xs font-bold shadow-glow flex items-center space-x-2 transition-all hover:scale-[1.02]"
            >
              <Sparkles className="w-4 h-4 text-amber-300" />
              <span>Executar Demonstração Guiada (1-Click)</span>
            </button>
            <button
              onClick={() => onNavigate('schema')}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-colors flex items-center space-x-1.5"
            >
              <span>Abrir Schema Studio</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onNavigate('records')}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-colors flex items-center space-x-1.5"
            >
              <span>Navegar Registros</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* KPI Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s, idx) => {
          const Icon = s.icon;
          return (
            <div
              key={idx}
              onClick={s.action}
              className="glass-card rounded-2xl p-5 border border-slate-800 cursor-pointer transition-all hover:-translate-y-1 group"
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-slate-400">{s.title}</span>
                <div
                  className={`w-8 h-8 rounded-lg bg-gradient-to-tr ${s.color} flex items-center justify-center text-white shadow-sm`}
                >
                  <Icon className="w-4 h-4" />
                </div>
              </div>
              <div className="flex items-baseline space-x-2">
                <span className="text-2xl font-extrabold text-white font-mono">
                  {loading ? '...' : s.value}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1 truncate">{s.sub}</p>
            </div>
          );
        })}
      </div>

      {/* Architecture Highlights & Capabilities Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="glass-panel rounded-2xl p-6 border border-slate-800 space-y-3">
          <div className="w-8 h-8 rounded-lg bg-brand-500/10 text-brand-400 border border-brand-500/20 flex items-center justify-center">
            <Layers className="w-4 h-4" />
          </div>
          <h3 className="text-sm font-bold text-white">Dynamic Table-per-Type (TPT)</h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Cada nível da hierarquia mantém sua própria tabela física com restrições referencial ON DELETE CASCADE. Views polimórficas (v_*) são geradas e propagadas dinamicamente na criação de atributos.
          </p>
        </div>

        <div className="glass-panel rounded-2xl p-6 border border-slate-800 space-y-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center">
            <GitBranch className="w-4 h-4" />
          </div>
          <h3 className="text-sm font-bold text-white">FSM & Condition Tree AST</h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Máquina de estados finita declarativa com herança polimórfica de transições via CTE. Ações da UI avaliam em tempo real papéis (roles), permissões e expressões lógicas (AND/OR, @current_user).
          </p>
        </div>

        <div className="glass-panel rounded-2xl p-6 border border-slate-800 space-y-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 flex items-center justify-center">
            <History className="w-4 h-4" />
          </div>
          <h3 className="text-sm font-bold text-white">Auditoria Universal (sys_audit)</h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Trigger PL/pgSQL acoplada automaticamente a todas as tabelas físicas. Registra operações INSERT, UPDATE e DELETE capturando diff JSONB e a identidade transacional app.user_id.
          </p>
        </div>
      </div>
    </div>
  );
}
