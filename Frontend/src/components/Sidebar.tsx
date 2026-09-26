'use client';

import React from 'react';
import {
  LayoutDashboard,
  Layers,
  Database,
  GitBranch,
  Code2,
  History,
  Sparkles,
  ChevronRight,
  ShieldCheck,
} from 'lucide-react';

export type NavTab = 'dashboard' | 'schema' | 'records' | 'transitions' | 'rules' | 'audit' | 'quickstart';

interface SidebarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  tableCount?: number;
}

export function Sidebar({ activeTab, onSelectTab, tableCount = 0 }: SidebarProps) {
  const items: { id: NavTab; label: string; icon: React.ComponentType<{ className?: string }>; badge?: string | number; desc: string }[] = [
    {
      id: 'dashboard',
      label: 'Visão Geral',
      icon: LayoutDashboard,
      desc: 'Métricas e status da engine',
    },
    {
      id: 'schema',
      label: 'Schema Studio',
      icon: Layers,
      badge: tableCount > 0 ? tableCount : undefined,
      desc: 'Tabelas, TPT e Dicionário DDL',
    },
    {
      id: 'records',
      label: 'Record Studio',
      icon: Database,
      desc: 'Navegação de dados e formulários',
    },
    {
      id: 'transitions',
      label: 'Máquina de Estados (FSM)',
      icon: GitBranch,
      desc: 'Transições de ciclo de vida',
    },
    {
      id: 'rules',
      label: 'Regras de Negócio',
      icon: Code2,
      desc: 'Automações sys_script e scripts',
    },
    {
      id: 'audit',
      label: 'Trilha de Auditoria',
      icon: History,
      desc: 'Histórico universal sys_audit',
    },
    {
      id: 'quickstart',
      label: 'Demo Interativa 1-Click',
      icon: Sparkles,
      badge: 'Guia',
      desc: 'Fluxo ponta a ponta guiado',
    },
  ];

  return (
    <aside className="w-64 glass-panel border-r border-slate-800/80 p-4 flex flex-col justify-between shrink-0 h-[calc(100vh-4rem)] sticky top-16">
      <div className="space-y-6">
        <div>
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-3 mb-2">
            Módulos da Plataforma
          </p>
          <nav className="space-y-1">
            {items.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onSelectTab(item.id)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition-all group ${
                    isActive
                      ? 'bg-brand-600/20 text-white border border-brand-500/30 shadow-glow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border border-transparent'
                  }`}
                >
                  <div className="flex items-center space-x-3 min-w-0">
                    <div
                      className={`p-1.5 rounded-lg transition-colors ${
                        isActive
                          ? 'bg-brand-500 text-white'
                          : 'bg-slate-800 text-slate-400 group-hover:text-slate-200'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="truncate">
                      <p className={`text-xs font-medium truncate ${isActive ? 'text-white font-semibold' : ''}`}>
                        {item.label}
                      </p>
                      <p className="text-[10px] text-slate-400 truncate">{item.desc}</p>
                    </div>
                  </div>
                  {item.badge !== undefined && (
                    <span
                      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                        isActive
                          ? 'bg-brand-500/30 text-brand-200'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Footer Info Box */}
      <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800/80 text-[11px] text-slate-400">
        <div className="flex items-center space-x-2 text-indigo-400 font-medium mb-1">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Segurança RBAC Zero-Cache</span>
        </div>
        <p className="leading-relaxed text-[10px]">
          Permissões calculadas em tempo real diretamente no PostgreSQL a cada requisição HTTP.
        </p>
      </div>
    </aside>
  );
}
