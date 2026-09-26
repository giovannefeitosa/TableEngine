'use client';

import React, { useState } from 'react';
import { api, TableInfo } from '@/lib/api';
import {
  Sparkles,
  CheckCircle2,
  ArrowRight,
  Database,
  Layers,
  GitFork,
  Cpu,
  History,
  Terminal,
  ShieldCheck,
  Play,
  RotateCcw,
} from 'lucide-react';

interface StepLog {
  step: number;
  title: string;
  detail: string;
  status: 'pending' | 'running' | 'success' | 'error';
  data?: any;
}

export function QuickstartTour() {
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [logs, setLogs] = useState<StepLog[]>([
    {
      step: 1,
      title: 'Criação da Tabela Raiz: tbl_task',
      detail: 'Cria tbl_task com atributos de kernel (sys_id, sys_class_name, sys_created_on, sys_mod_count) e audit trigger.',
      status: 'pending',
    },
    {
      step: 2,
      title: 'Adição de Atributos Comuns & Numeração TSK',
      detail: 'Adiciona short_description, state e configura numeração automática com prefixo TSK via sys_number.',
      status: 'pending',
    },
    {
      step: 3,
      title: 'Criação da Tabela Filha TPT: tbl_incident',
      detail: 'Cria tbl_incident com PK/FK referenciando tbl_task(sys_id) ON DELETE CASCADE e gera view v_incident.',
      status: 'pending',
    },
    {
      step: 4,
      title: 'Adição de Campos Especializados do Incidente',
      detail: 'Adiciona severity (integer) e close_notes (text) e propaga automaticamente a view polimórfica v_incident.',
      status: 'pending',
    },
    {
      step: 5,
      title: 'Configuração do Ciclo de Vida FSM & Transições',
      detail: 'Cadastra transições: new -> in_progress (Iniciar) e in_progress -> resolved (Resolver com guard condition).',
      status: 'pending',
    },
    {
      step: 6,
      title: 'Inserção Polimórfica de Incidente (CRUD)',
      detail: 'Gera UUID v4 universal, chama sys_next_number(), insere na raiz e na filha atomicamente.',
      status: 'pending',
    },
    {
      step: 7,
      title: 'Execução de Transição de Estado e Trilha de Auditoria',
      detail: 'Dispara a FSM para mover para in_progress e inspeciona o histórico completo gravado em sys_audit.',
      status: 'pending',
    },
  ]);

  const updateLog = (stepIndex: number, status: StepLog['status'], detail?: string, data?: any) => {
    setLogs((prev) =>
      prev.map((item, idx) => {
        if (idx === stepIndex) {
          return {
            ...item,
            status,
            detail: detail || item.detail,
            data: data !== undefined ? data : item.data,
          };
        }
        return item;
      })
    );
  };

  const runWorkflow = async () => {
    setRunning(true);
    setCompleted(false);

    try {
      // Step 1: Base table tbl_task
      setCurrentStep(0);
      updateLog(0, 'running');
      const existingTables = await api.schema.listTables(false);
      let taskTable = existingTables.find((t) => t.name === 'tbl_task');
      if (!taskTable) {
        taskTable = await api.schema.createTable({
          name: 'tbl_task',
          label: 'Tarefa Corporativa',
          is_extendable: true,
        });
      }
      updateLog(0, 'success', `Tabela base '${taskTable.name}' pronta com System Attributes de auditoria e versão.`, taskTable);

      // Step 2: Add common fields to tbl_task
      setCurrentStep(1);
      updateLog(1, 'running');
      const taskFields = await api.schema.getFields('tbl_task');
      if (!taskFields.some((f) => f.column_name === 'short_description')) {
        await api.schema.addField(taskTable.sys_id, {
          column_name: 'short_description',
          label: 'Descrição Curta',
          internal_type: 'string',
          max_length: 160,
        });
      }
      if (!taskFields.some((f) => f.column_name === 'state')) {
        await api.schema.addField(taskTable.sys_id, {
          column_name: 'state',
          label: 'Estado Operacional',
          internal_type: 'string',
          max_length: 40,
          default_value: 'new',
        });
      }
      if (!taskFields.some((f) => f.column_name === 'number')) {
        await api.schema.addField(taskTable.sys_id, {
          column_name: 'number',
          label: 'Número do Registro',
          internal_type: 'auto_number',
          number_prefix: 'TSK',
          minimum_digits: 7,
          start_number: 1,
        });
      }
      updateLog(1, 'success', 'Atributos comuns e contador TSK configurados em sys_number.');

      // Step 3: Child Table tbl_incident
      setCurrentStep(2);
      updateLog(2, 'running');
      const tablesAfterTask = await api.schema.listTables(false);
      let incTable = tablesAfterTask.find((t) => t.name === 'tbl_incident');
      if (!incTable) {
        incTable = await api.schema.createTable({
          name: 'tbl_incident',
          label: 'Incidente de TI',
          super_class_id: taskTable.sys_id,
          is_extendable: true,
        });
      }
      updateLog(2, 'success', `Tabela filha '${incTable.name}' criada com herança TPT e view '${incTable.view_name}'.`, incTable);

      // Step 4: Add specialized fields to tbl_incident
      setCurrentStep(3);
      updateLog(3, 'running');
      const incFields = await api.schema.getFields('tbl_incident');
      if (!incFields.some((f) => f.column_name === 'severity')) {
        await api.schema.addField(incTable.sys_id, {
          column_name: 'severity',
          label: 'Gravidade (1 a 4)',
          internal_type: 'integer',
          default_value: '3',
        });
      }
      if (!incFields.some((f) => f.column_name === 'close_notes')) {
        await api.schema.addField(incTable.sys_id, {
          column_name: 'close_notes',
          label: 'Notas de Resolução Técnica',
          internal_type: 'text',
        });
      }
      const resolvedFields = await api.schema.getFields('tbl_incident');
      updateLog(3, 'success', `CTE resolveu ${resolvedFields.length} atributos consolidados entre base e filha.`);

      // Step 5: FSM State transitions
      setCurrentStep(4);
      updateLog(4, 'running');
      const transitions = await api.fsm.listTransitions();
      const hasT1 = transitions.some((t) => t.table_id === incTable!.sys_id && t.from_state === 'new' && t.to_state === 'in_progress');
      if (!hasT1) {
        await api.fsm.createTransition({
          table_id: incTable.sys_id,
          state_field: 'state',
          from_state: 'new',
          to_state: 'in_progress',
          label: 'Iniciar Atendimento',
        });
      }
      const hasT2 = transitions.some((t) => t.table_id === incTable!.sys_id && t.from_state === 'in_progress' && t.to_state === 'resolved');
      if (!hasT2) {
        await api.fsm.createTransition({
          table_id: incTable.sys_id,
          state_field: 'state',
          from_state: 'in_progress',
          to_state: 'resolved',
          label: 'Resolver Incidente',
          condition_tree: {
            operator: 'AND',
            rules: [{ field: 'close_notes', operator: 'IS_NOT_EMPTY' }],
          },
          on_transition_action: {
            set_fields: {
              close_notes: 'Problema solucionado pela equipe técnica de infraestrutura.',
            },
          },
        });
      }
      updateLog(4, 'success', 'Máquina de estados FSM configurada com transições atômicas e Condition Tree guard.');

      // Step 6: Create polymorphic incident record
      setCurrentStep(5);
      updateLog(5, 'running');
      const createdRecord = await api.records.create('tbl_incident', {
        short_description: 'Falha de comunicação no gateway VPN da filial Norte',
        state: 'new',
        severity: 1,
      });
      updateLog(5, 'success', `Registro ${createdRecord.number} persistido com sys_id ${createdRecord.sys_id}.`, createdRecord);

      // Step 7: Execute state transition and inspect audit
      setCurrentStep(6);
      updateLog(6, 'running');
      const available = await api.records.availableTransitions('tbl_incident', createdRecord.sys_id);
      let updatedRec = createdRecord;
      if (available.length > 0) {
        updatedRec = await api.records.executeTransition(
          'tbl_incident',
          createdRecord.sys_id,
          available[0].transition_id,
          {
            sys_mod_count: createdRecord.sys_mod_count,
            payload: { close_notes: 'Equipamento de rede reiniciado e rotas reestabelecidas.' },
          }
        );
      }
      const auditLog = await api.records.audit('tbl_incident', createdRecord.sys_id);
      updateLog(6, 'success', `Transição executada para '${updatedRec.state}'. sys_audit registrou ${auditLog.length} eventos de auditoria!`, {
        audit_events: auditLog.length,
        final_state: updatedRec.state,
        mod_count: updatedRec.sys_mod_count,
      });

      setCompleted(true);
    } catch (err: any) {
      updateLog(currentStep, 'error', `Falha na execução: ${err.message}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header Banner */}
      <div className="glass-panel rounded-2xl border border-brand-500/30 p-8 shadow-2xl relative overflow-hidden">
        <div className="absolute -top-12 -right-12 w-64 h-64 bg-brand-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="flex items-center space-x-2 text-brand-400 text-xs font-bold uppercase tracking-wider mb-2">
              <Sparkles className="w-4 h-4 text-amber-300" />
              <span>Demonstração Automatizada do TableEngine</span>
            </div>
            <h2 className="text-2xl font-extrabold text-white tracking-tight">
              Tour Interativo Ponta a Ponta
            </h2>
            <p className="text-xs text-slate-300 max-w-xl mt-2 leading-relaxed">
              Execute com um único clique o ciclo completo da plataforma: criação de tabelas TPT com discriminador, CTE de herança recursiva, FSM com Condition Tree guard, numeração automática e trilha universal em sys_audit.
            </p>
          </div>

          <button
            disabled={running}
            onClick={runWorkflow}
            className="px-6 py-3.5 rounded-xl bg-gradient-to-r from-brand-600 via-indigo-600 to-brand-500 hover:from-brand-500 hover:to-indigo-500 text-white font-bold text-xs shadow-glow flex items-center justify-center space-x-2 transition-all hover:scale-105 active:scale-95 disabled:opacity-50 shrink-0"
          >
            {running ? (
              <>
                <RotateCcw className="w-4 h-4 animate-spin" />
                <span>Executando Etapas...</span>
              </>
            ) : completed ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                <span>Executar Novamente</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-current" />
                <span>Iniciar Demonstração 1-Click</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Steps Execution List */}
      <div className="space-y-3">
        {logs.map((item, idx) => (
          <div
            key={item.step}
            className={`p-4 rounded-xl border transition-all glass-panel ${
              item.status === 'running'
                ? 'border-brand-500 bg-brand-950/20 shadow-glow-sm'
                : item.status === 'success'
                ? 'border-emerald-500/40 bg-emerald-950/10'
                : item.status === 'error'
                ? 'border-rose-500/50 bg-rose-950/20'
                : 'border-slate-800/80 bg-slate-900/40 opacity-70'
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-start space-x-3.5">
                <div
                  className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 ${
                    item.status === 'success'
                      ? 'bg-emerald-500 text-white'
                      : item.status === 'running'
                      ? 'bg-brand-500 text-white animate-pulse'
                      : item.status === 'error'
                      ? 'bg-rose-500 text-white'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {item.status === 'success' ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : (
                    item.step
                  )}
                </div>

                <div>
                  <h4 className="text-xs font-bold text-white flex items-center gap-2">
                    <span>{item.title}</span>
                    {item.status === 'running' && (
                      <span className="text-[10px] text-brand-300 font-normal animate-pulse">
                        (Processando no banco...)
                      </span>
                    )}
                  </h4>
                  <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                    {item.detail}
                  </p>

                  {item.data && (
                    <div className="mt-2.5 p-2 rounded-lg bg-slate-950/80 border border-slate-800 font-mono text-[10px] text-emerald-300 max-h-24 overflow-y-auto">
                      <pre>{JSON.stringify(item.data, null, 2)}</pre>
                    </div>
                  )}
                </div>
              </div>

              <span
                className={`text-[10px] px-2 py-0.5 rounded-full font-semibold shrink-0 uppercase tracking-wider ${
                  item.status === 'success'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : item.status === 'running'
                    ? 'bg-brand-500/20 text-brand-300 border border-brand-500/30'
                    : item.status === 'error'
                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                    : 'bg-slate-800 text-slate-500'
                }`}
              >
                {item.status === 'success'
                  ? 'Concluído'
                  : item.status === 'running'
                  ? 'Em Execução'
                  : item.status === 'error'
                  ? 'Erro'
                  : 'Pendente'}
              </span>
            </div>
          </div>
        ))}
      </div>

      {completed && (
        <div className="p-6 rounded-2xl glass-panel border border-emerald-500/40 bg-emerald-950/15 text-center space-y-3 shadow-glow">
          <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
          <h3 className="text-base font-bold text-white">Demonstração Concluída com Sucesso!</h3>
          <p className="text-xs text-slate-300 max-w-lg mx-auto leading-relaxed">
            Todas as tabelas físicas, foreign keys em cascata, views polimórficas, numeração e registros de auditoria foram persistidos e validados no PostgreSQL 16.
          </p>
        </div>
      )}
    </div>
  );
}
