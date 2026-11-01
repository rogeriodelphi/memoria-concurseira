import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, BarChart3, CalendarPlus, Clock, ListChecks, Plus, Trash2 } from 'lucide-react';

import { ManualTimeForm } from '../components/pomodoro/ManualTimeForm';
import { useToast } from '../contexts/ToastContext';
import { pomodoroApi } from '../services/api';
import type { PomodoroTask } from '../types';
import { formatDateKey, rangeIncluding } from '../utils/pomodoroManual';

type Tab = 'geral' | 'tarefas';

const DAY_MS = 24 * 60 * 60 * 1000;

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 29 * DAY_MS);
  return { from: toDateKey(from), to: toDateKey(to) };
}

function formatDuration(totalSec: number): string {
  const totalMin = Math.round(totalSec / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h${m > 0 ? ` ${m}min` : ''}`;
  return `${m}min`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const MODE_LABEL: Record<string, string> = { simples: 'Pomodoro simples', super: 'Super pomodoro', manual: 'Tempo lançado' };
const PHASE_LABEL: Record<string, string> = { producao: 'Produção', manual: 'Tarefa manual' };

// Um tempo lançado não tem hora (fica ao meio-dia do dia escolhido): só a data.
function taskWhen(t: PomodoroTask): string {
  return t.mode === 'manual' ? formatDateKey(t.startedAt.slice(0, 10)) : formatDateTime(t.startedAt);
}

function taskWhat(t: PomodoroTask): string {
  return `${t.discipline || '—'}${t.subject ? ` · ${t.subject}` : ''}`;
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-600 dark:text-neutral-500 dark:hover:bg-red-950/40 dark:hover:text-red-400"
      title="Excluir"
    >
      <Trash2 size={14} />
    </button>
  );
}

function DailyChart({ tasks, from, to }: { tasks: PomodoroTask[]; from: string; to: string }) {
  const days: string[] = [];
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  for (let d = new Date(start); d <= end; d = new Date(d.getTime() + DAY_MS)) {
    days.push(toDateKey(d));
  }

  const minutesByDay = new Map<string, number>();
  for (const t of tasks) {
    const key = t.startedAt.slice(0, 10);
    minutesByDay.set(key, (minutesByDay.get(key) ?? 0) + t.durationSec / 60);
  }

  const visibleDays = days.length > 31 ? days.slice(-31) : days;
  const max = Math.max(...visibleDays.map((d) => minutesByDay.get(d) ?? 0), 1);

  return (
    <div className="card p-6">
      <h2 className="mb-4 text-sm font-semibold text-neutral-900 dark:text-neutral-100">Minutos estudados por dia</h2>
      <div className="flex h-32 items-end gap-1">
        {visibleDays.map((d) => {
          const minutes = minutesByDay.get(d) ?? 0;
          const heightPct = (minutes / max) * 100;
          return (
            <div
              key={d}
              className="flex h-full flex-1 flex-col justify-end"
              title={`${d.split('-').reverse().join('/')}: ${Math.round(minutes)} min`}
            >
              <div
                className={`w-full rounded-t ${minutes > 0 ? 'bg-brand-500' : 'bg-neutral-100 dark:bg-neutral-800'}`}
                style={{ height: minutes > 0 ? `${Math.max(heightPct, 4)}%` : '2px' }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PomodoroStats() {
  const [tab, setTab] = useState<Tab>('geral');
  const [{ from, to }, setRange] = useState(defaultRange);
  const [tasks, setTasks] = useState<PomodoroTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

  // "Lançar tempo estudado": o botão da tela do Pomodoro abre esta página já com o formulário (?lancar=1).
  const [searchParams] = useSearchParams();
  const [showForm, setShowForm] = useState(searchParams.get('lancar') === '1');
  const [suggestions, setSuggestions] = useState<{ disciplines: string[]; subjects: string[] }>({ disciplines: [], subjects: [] });
  // Sobe a cada lançamento, para recarregar a lista mesmo quando o período não mudou.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setTasks(null);
    pomodoroApi
      .listTasks(from, to)
      .then(({ tasks }) => setTasks(tasks))
      .catch(() => setError('Não foi possível carregar as estatísticas.'));
  }, [from, to, reloadKey]);

  // As sugestões de Disciplina e Assunto só são buscadas quando o formulário é aberto pela primeira vez.
  useEffect(() => {
    if (!showForm) return;
    pomodoroApi
      .suggestions()
      .then(setSuggestions)
      .catch(() => {});
  }, [showForm]);

  const totals = useMemo(() => {
    if (!tasks) return null;
    const totalSec = tasks.reduce((sum, t) => sum + t.durationSec, 0);
    const simplesCount = tasks.filter((t) => t.mode === 'simples').length;
    const superCount = tasks.filter((t) => t.mode === 'super').length;
    const manualCount = tasks.filter((t) => t.mode === 'manual').length;
    return { totalSec, count: tasks.length, simplesCount, superCount, manualCount };
  }, [tasks]);

  function handleManualSaved(date: string) {
    // Se a data lançada estiver fora do período mostrado, o período cresce para contê-la: sem isso o lançamento não apareceria.
    setRange((r) => rangeIncluding(r, date));
    setReloadKey((k) => k + 1);
    setShowForm(false);
    showToast(`Tempo lançado em ${formatDateKey(date)}.`);
  }

  async function handleRemove(id: string) {
    try {
      await pomodoroApi.removeTask(id);
      setTasks((prev) => prev?.filter((t) => t.id !== id) ?? prev);
    } catch {
      setError('Não foi possível excluir a tarefa.');
    }
  }

  return (
    <div>
      <Link
        to="/pomodoro"
        className="mb-4 flex items-center gap-1.5 text-sm font-medium text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
      >
        <ArrowLeft size={16} />
        Pomodoro de estudos
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="mb-1 text-2xl font-bold text-neutral-900 dark:text-neutral-100">Minhas estatísticas</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Acompanhe seu tempo de estudo registrado no Pomodoro.
          </p>
        </div>
        {!showForm && (
          <button type="button" onClick={() => setShowForm(true)} className="btn-primary shrink-0">
            <Plus size={16} />
            Lançar tempo
          </button>
        )}
      </div>

      {showForm && (
        <ManualTimeForm suggestions={suggestions} onSaved={handleManualSaved} onCancel={() => setShowForm(false)} />
      )}

      <div className="mb-4 flex gap-1 border-b border-neutral-200 dark:border-neutral-800">
        <button
          type="button"
          onClick={() => setTab('geral')}
          className={`px-3 py-2 text-sm font-medium transition-colors ${
            tab === 'geral'
              ? 'border-b-2 border-brand-500 text-brand-600 dark:text-brand-400'
              : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200'
          }`}
        >
          Visão geral
        </button>
        <button
          type="button"
          onClick={() => setTab('tarefas')}
          className={`px-3 py-2 text-sm font-medium transition-colors ${
            tab === 'tarefas'
              ? 'border-b-2 border-brand-500 text-brand-600 dark:text-brand-400'
              : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200'
          }`}
        >
          Minhas tarefas
        </button>
      </div>

      <div className="card mb-6 flex flex-wrap items-center gap-3 p-4">
        <input
          type="date"
          className="input-field w-auto"
          value={from}
          max={to}
          onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
        />
        <span className="text-sm text-neutral-400">até</span>
        <input
          type="date"
          className="input-field w-auto"
          value={to}
          min={from}
          onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
        />
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {tasks === null ? (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">Carregando...</p>
      ) : tasks.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 px-6 py-16 text-center">
          <BarChart3 size={28} className="mb-2 text-neutral-300 dark:text-neutral-600" />
          <p className="font-semibold text-neutral-800 dark:text-neutral-200">Sem dados no período</p>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Você ainda não registrou tarefas de Pomodoro no intervalo selecionado. Esqueceu de registrar um estudo? Use
            &quot;Lançar tempo&quot;.
          </p>
        </div>
      ) : tab === 'geral' ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <div className="card flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400">
                <Clock size={18} />
              </div>
              <div>
                <p className="text-xl font-bold text-neutral-900 dark:text-neutral-100">
                  {formatDuration(totals!.totalSec)}
                </p>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">Tempo total</p>
              </div>
            </div>
            <div className="card flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400">
                <ListChecks size={18} />
              </div>
              <div>
                <p className="text-xl font-bold text-neutral-900 dark:text-neutral-100">{totals!.count}</p>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">Tarefas registradas</p>
              </div>
            </div>
            <div className="card p-4">
              <p className="text-xl font-bold text-neutral-900 dark:text-neutral-100">{totals!.simplesCount}</p>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">Pomodoro simples</p>
            </div>
            <div className="card p-4">
              <p className="text-xl font-bold text-neutral-900 dark:text-neutral-100">{totals!.superCount}</p>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">Super pomodoro</p>
            </div>
            <div className="card p-4">
              <p className="text-xl font-bold text-neutral-900 dark:text-neutral-100">{totals!.manualCount}</p>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">Tempo lançado</p>
            </div>
          </div>

          <DailyChart tasks={tasks} from={from} to={to} />
        </div>
      ) : (
        <>
          {/* Abaixo de 1024px (celular, ou tablet com a barra lateral) a tabela não cabe e a lixeira ficava escondida à
              direita: cada tarefa vira uma linha de lista. */}
          <ul className="card divide-y divide-neutral-100 p-0 dark:divide-neutral-800 lg:hidden">
            {tasks.map((t) => (
              <li key={t.id} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm text-neutral-800 dark:text-neutral-200">{taskWhat(t)}</p>
                  <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                    {taskWhen(t)} · {MODE_LABEL[t.mode] ?? t.mode}
                    {t.mode !== 'manual' && ` (${PHASE_LABEL[t.phase] ?? t.phase})`} · {formatDuration(t.durationSec)}
                  </p>
                </div>
                <RemoveButton onClick={() => handleRemove(t.id)} />
              </li>
            ))}
          </ul>

          {/* A rolagem é só uma rede de segurança: a partir de 1024px a tabela cabe. */}
          <div className="card hidden overflow-x-auto p-0 lg:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-neutral-100 bg-neutral-50/60 text-xs uppercase tracking-wide text-neutral-400 dark:border-neutral-800 dark:bg-neutral-800/60 dark:text-neutral-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Data</th>
                  <th className="px-4 py-3 font-medium">Modo</th>
                  <th className="px-4 py-3 font-medium">Disciplina / Assunto</th>
                  <th className="px-4 py-3 font-medium">Duração</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr
                    key={t.id}
                    className="border-b border-neutral-50 last:border-0 hover:bg-neutral-50/60 dark:border-neutral-800 dark:hover:bg-neutral-800/60"
                  >
                    <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400">{taskWhen(t)}</td>
                    <td className="px-4 py-3 text-neutral-700 dark:text-neutral-300">
                      {t.mode === 'manual' && <CalendarPlus size={13} className="mr-1 inline text-neutral-400" />}
                      {MODE_LABEL[t.mode] ?? t.mode}
                      {t.mode !== 'manual' && (
                        <span className="ml-1 text-xs text-neutral-400 dark:text-neutral-500">
                          ({PHASE_LABEL[t.phase] ?? t.phase})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-neutral-700 dark:text-neutral-300">{taskWhat(t)}</td>
                    <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400">{formatDuration(t.durationSec)}</td>
                    <td className="px-4 py-3 text-right">
                      <RemoveButton onClick={() => handleRemove(t.id)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
