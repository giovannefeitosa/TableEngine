'use client';

import React from 'react';
import { User, removeToken } from '@/lib/api';
import { Database, ShieldCheck, LogOut, Play, UserCircle2, Sparkles, Terminal } from 'lucide-react';

interface NavbarProps {
  user: User | null;
  onLogout: () => void;
  onRunQuickstart?: () => void;
}

export function Navbar({ user, onLogout, onRunQuickstart }: NavbarProps) {
  return (
    <header className="h-16 glass-panel border-b border-slate-800/80 px-6 flex items-center justify-between sticky top-0 z-40">
      {/* Brand & Platform Status */}
      <div className="flex items-center space-x-4">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-brand-600 via-brand-500 to-indigo-400 flex items-center justify-center shadow-glow-sm">
            <Database className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-bold text-lg tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
                TableEngine
              </span>
              <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-brand-500/10 text-brand-300 border border-brand-500/20">
                v2.0 TPT
              </span>
            </div>
            <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              PostgreSQL 16 Engine Ativo
            </p>
          </div>
        </div>
      </div>

      {/* Center / Action Shortcuts */}
      <div className="hidden md:flex items-center space-x-3">
        {onRunQuickstart && (
          <button
            onClick={onRunQuickstart}
            className="flex items-center space-x-2 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-indigo-600/80 to-brand-600/80 hover:from-indigo-600 hover:to-brand-600 text-white text-xs font-medium border border-brand-400/30 transition-all shadow-glow-sm hover:scale-[1.02] active:scale-[0.98]"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-300 animate-spin" style={{ animationDuration: '6s' }} />
            <span>Guia Rápido / Demonstração 1-Click</span>
          </button>
        )}
      </div>

      {/* User Session Info & Controls */}
      <div className="flex items-center space-x-4">
        {user ? (
          <>
            <div className="hidden sm:flex flex-col items-end text-right">
              <div className="flex items-center space-x-2">
                <span className="text-xs font-semibold text-slate-200">
                  {user.first_name} {user.last_name || ''}
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono border border-slate-700">
                  {user.user_name}
                </span>
              </div>
              <div className="flex items-center space-x-1.5 mt-0.5">
                {user.roles.slice(0, 2).map((r) => (
                  <span
                    key={r.sys_id}
                    className="text-[10px] px-1.5 py-0.2 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 font-medium"
                  >
                    role:{r.name}
                  </span>
                ))}
              </div>
            </div>

            <div className="w-9 h-9 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300">
              <UserCircle2 className="w-5 h-5 text-brand-400" />
            </div>

            <button
              onClick={() => {
                removeToken();
                onLogout();
              }}
              title="Encerrar Sessão"
              className="p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </>
        ) : (
          <span className="text-xs text-slate-400">Não autenticado</span>
        )}
      </div>
    </header>
  );
}
