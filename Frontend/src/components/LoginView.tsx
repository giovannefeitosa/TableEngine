'use client';

import React, { useState } from 'react';
import { api, setToken, User } from '@/lib/api';
import { Database, Lock, User as UserIcon, ArrowRight, ShieldCheck, Sparkles, Layers, Cpu } from 'lucide-react';

interface LoginViewProps {
  onSuccess: (user: User) => void;
}

export function LoginView({ onSuccess }: LoginViewProps) {
  const [userName, setUserName] = useState('admin');
  const [password, setPassword] = useState('Admin123!Safe');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await api.auth.login(userName, password);
      setToken(res.token);
      onSuccess(res.user);
    } catch (err: any) {
      setError(err.message || 'Falha na autenticação');
    } finally {
      setLoading(false);
    }
  };

  const fillAdmin = () => {
    setUserName('admin');
    setPassword('Admin123!Safe');
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 relative overflow-hidden">
      {/* Background visual glow mesh */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-brand-600/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-indigo-600/15 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-4xl w-full grid grid-cols-1 md:grid-cols-2 rounded-2xl glass-panel border border-slate-800 shadow-2xl overflow-hidden z-10">
        {/* Left Column: Hero info */}
        <div className="p-8 md:p-10 bg-gradient-to-br from-slate-900 via-slate-900/90 to-brand-950/40 border-b md:border-b-0 md:border-r border-slate-800 flex flex-col justify-between">
          <div>
            <div className="flex items-center space-x-3 mb-6">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-tr from-brand-600 via-brand-500 to-indigo-400 flex items-center justify-center shadow-glow-sm">
                <Database className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-white">TableEngine</h1>
                <p className="text-xs text-brand-300 font-medium">Enterprise Metadata aPaaS</p>
              </div>
            </div>

            <h2 className="text-2xl font-extrabold text-white leading-tight mb-3">
              Plataforma Dinâmica de Dados & Herança Table-per-Type
            </h2>
            <p className="text-xs text-slate-300 leading-relaxed mb-6">
              Inspirado na arquitetura corporativa do ServiceNow e Salesforce Force.com sobre PostgreSQL 16 com auditoria universal e FSM em tempo real.
            </p>

            <div className="space-y-3">
              <div className="flex items-center space-x-3 text-xs text-slate-300">
                <div className="w-7 h-7 rounded-lg bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-400 shrink-0">
                  <Layers className="w-3.5 h-3.5" />
                </div>
                <span>Herança TPT Polimórfica com Views Automáticas</span>
              </div>
              <div className="flex items-center space-x-3 text-xs text-slate-300">
                <div className="w-7 h-7 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0">
                  <Cpu className="w-3.5 h-3.5" />
                </div>
                <span>FSM Declarativo, Condition Tree AST & Business Rules</span>
              </div>
              <div className="flex items-center space-x-3 text-xs text-slate-300">
                <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
                  <ShieldCheck className="w-3.5 h-3.5" />
                </div>
                <span>RBAC Zero-Cache & Auditoria Universal sys_audit</span>
              </div>
            </div>
          </div>

          <div className="pt-8 border-t border-slate-800/80">
            <span className="text-[11px] text-slate-400">Desenvolvido com Golang 1.22+ e Next.js 14 App Router</span>
          </div>
        </div>

        {/* Right Column: Login form */}
        <div className="p-8 md:p-10 flex flex-col justify-center bg-slate-900/60">
          <div className="mb-6">
            <h3 className="text-lg font-bold text-white mb-1">Acesso à Plataforma</h3>
            <p className="text-xs text-slate-400">Insira suas credenciais corporativas para autenticação.</p>
          </div>

          {error && (
            <div className="mb-5 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-start space-x-2">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-400 mt-1.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Usuário</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <UserIcon className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  required
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700/80 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-all"
                  placeholder="admin"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Senha</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700/80 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-all"
                  placeholder="••••••••••••"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-brand-600 to-indigo-600 hover:from-brand-500 hover:to-indigo-500 text-white text-xs font-semibold flex items-center justify-center space-x-2 transition-all shadow-glow-sm hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50"
            >
              <span>{loading ? 'Validando Credenciais...' : 'Entrar no TableEngine'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          {/* Quick Fill Button */}
          <div className="mt-5 pt-5 border-t border-slate-800 flex items-center justify-between">
            <button
              type="button"
              onClick={fillAdmin}
              className="text-xs text-brand-400 hover:text-brand-300 font-medium flex items-center space-x-1.5 transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Preencher com Admin Padrão</span>
            </button>
            <span className="text-[10px] text-slate-500 font-mono">admin / Admin123!Safe</span>
          </div>
        </div>
      </div>
    </div>
  );
}
