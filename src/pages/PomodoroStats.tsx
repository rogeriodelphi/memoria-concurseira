import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, BarChart3, Clock, ListChecks, Trash2 } from 'lucide-react';

import { pomodoroApi } from '../services/api';
import type { PomodoroTask } from '../types';

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

const MODE_LABEL: Record<string, string> = { simples: 'Pomodoro simples', super: 'Super pomodoro' };
const PHASE_LABEL: Record<string, string> = { producao: 'Produção', manual: 'Tarefa manual' };

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

  useEffect(() => {
    setTasks(null);
    pomodoroApi
      .listTasks(from, to)
      .then(({ tasks }) => setTasks(tasks))
      .catch(() => setError('Não foi possível carregar as estatísticas.'));
  }, [from, to]);

  const totals = useMemo(() => {
    if (!tasks) return null;
    const totalSec = tasks.reduce((sum, t) => sum + t.durationSec, 0);
    const simplesCount = tasks.filter((t) => t.mode === 'simples').length;
    const superCount = tasks.filter((t) => t.mode === 'super').length;
    return { totalSec, count: tasks.length, simplesCount, superCount };
  }, [tasks]);

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
      <h1 className="mb-1 text-2xl font-bold text-neutral-900 dark:text-neutral-100">Minhas estatísticas</h1>
      <p className="mb-6 text-sm text-neutral-500 dark:text-neutral-400">
        Acompanhe seu tempo de estudo registrado no Pomodoro.
      </p>

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
            Você ainda não registrou tarefas de Pomodoro no intervalo selecionado.
          </p>
        </div>
      ) : tab === 'geral' ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
          </div>

          <DailyChart tasks={tasks} from={from} to={to} />
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
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
                  <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400">{formatDateTime(t.startedAt)}</td>
                  <td className="px-4 py-3 text-neutral-700 dark:text-neutral-300">
                    {MODE_LABEL[t.mode] ?? t.mode}
                    <span className="ml-1 text-xs text-neutral-400 dark:text-neutral-500">
                      ({PHASE_LABEL[t.phase] ?? t.phase})
                    </span>
                  </td>
                  <td className="px-4 py-3 text-neutral-700 dark:text-neutral-300">
                    {t.discipline || '—'}
                    {t.subject ? ` · ${t.subject}` : ''}
                  </td>
                  <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400">{formatDuration(t.durationSec)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleRemove(t.id)}
                      className="rounded-lg p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-600 dark:text-neutral-500 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                      title="Excluir"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
