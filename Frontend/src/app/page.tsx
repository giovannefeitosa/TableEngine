'use client';

import React, { useState, useEffect } from 'react';
import { api, getToken, User } from '@/lib/api';
import { Navbar } from '@/components/Navbar';
import { Sidebar, NavTab } from '@/components/Sidebar';
import { LoginView } from '@/components/LoginView';
import { DashboardView } from '@/components/DashboardView';
import { SchemaStudio } from '@/components/SchemaStudio';
import { RecordStudio } from '@/components/RecordStudio';
import { TransitionsStudio } from '@/components/TransitionsStudio';
import { RulesStudio } from '@/components/RulesStudio';
import { RbacStudio } from '@/components/RbacStudio';
import { AuditView } from '@/components/AuditView';
import { QuickstartTour } from '@/components/QuickstartTour';

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getToken();
    if (token) {
      api.auth
        .me()
        .then((userData) => {
          setUser(userData);
        })
        .catch(() => {
          setUser(null);
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="flex flex-col items-center space-y-4">
          <div className="w-10 h-10 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-slate-400 font-medium">Carregando TableEngine...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginView onSuccess={(u) => setUser(u)} />;
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">
      <Navbar
        user={user}
        onLogout={() => setUser(null)}
        onRunQuickstart={() => setActiveTab('quickstart')}
      />

      <div className="flex flex-1">
        <Sidebar activeTab={activeTab} onSelectTab={setActiveTab} />

        <main className="flex-1 p-6 md:p-8 max-w-7xl mx-auto w-full">
          {activeTab === 'dashboard' && <DashboardView onNavigate={setActiveTab} />}
          {activeTab === 'schema' && <SchemaStudio />}
          {activeTab === 'records' && <RecordStudio />}
          {activeTab === 'transitions' && <TransitionsStudio />}
          {activeTab === 'rules' && <RulesStudio />}
          {activeTab === 'rbac' && <RbacStudio />}
          {activeTab === 'audit' && <AuditView />}
          {activeTab === 'quickstart' && <QuickstartTour />}
        </main>
      </div>
    </div>
  );
}
