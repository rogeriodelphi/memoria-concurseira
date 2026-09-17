import { Link } from 'react-router-dom';
import { BarChart3, Play, Square } from 'lucide-react';

import { usePomodoro, type SimplesPhase } from '../contexts/PomodoroContext';
import type { PomodoroTask } from '../types';

function formatTimer(totalSec: number): string {
  const m = Math.floor(Math.max(totalSec, 0) / 60);
  const s = Math.max(totalSec, 0) % 60;
  return `${String(m).padStart(2, '0')}min:${String(s).padStart(2, '0')}s`;
}

const SIMPLES_PHASE_LABEL: Record<SimplesPhase, string> = {
  producao: 'Em produção',
  descanso_curto: 'Descanso curto',
  descanso_longo: 'Descanso longo',
};

export function Pomodoro() {
  const {
    soundEnabled,
    setSoundEnabled,
    config,
    setConfig,
    restoreDefaults,
    simplesRunning,
    simplesPhase,
    simplesRemaining,
    simplesDiscipline,
    setSimplesDiscipline,
    simplesSubject,
    setSimplesSubject,
    simplesTasks,
    startSimples,
    stopSimples,
    resetSimplesTasks,
    superRunning,
    superPaused,
    superElapsed,
    superDiscipline,
    setSuperDiscipline,
    superSubject,
    setSuperSubject,
    superTasks,
    startSuper,
    toggleSuperPause,
    endSuper,
    resetSuperTasks,
    notes,
    setNotes,
  } = usePomodoro();

  return (
    <div>
      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Pomodoro de estudos</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Escolha entre o Pomodoro simples ou o Super pomodoro e acompanhe sua produtividade em tempo real.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300">
            <input
              type="checkbox"
              checked={soundEnabled}
              onChange={(e) => setSoundEnabled(e.target.checked)}
              className="h-4 w-4 accent-brand-600"
            />
            Ativar aviso sonoro
          </label>
          <Link to="/pomodoro/estatisticas" className="btn-secondary">
            <BarChart3 size={16} />
            Minhas estatísticas
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Pomodoro simples */}
        <div className="card p-6">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Pomodoro simples</h2>
            <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
              CLÁSSICO
            </span>
          </div>
          <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
            Tarefas de produção seguidas de descanso curto e, periodicamente, um descanso longo.
          </p>

          <div className="mb-4 rounded-xl border border-neutral-200 bg-neutral-50 px-6 py-6 text-center dark:border-neutral-700 dark:bg-neutral-800/60">
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              Status: <span className="font-medium">{simplesRunning ? SIMPLES_PHASE_LABEL[simplesPhase] : 'Encerrado'}</span>
            </p>
            <p className="mt-1 text-3xl font-bold text-neutral-900 dark:text-neutral-100">
              {formatTimer(simplesRunning ? simplesRemaining : 0)}
            </p>
          </div>

          <p className="mb-2 text-xs font-semibold text-neutral-700 dark:text-neutral-300">Configurações</p>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label className="label-field text-xs">Produção (min)</label>
              <input
                type="number"
                min={1}
                disabled={simplesRunning}
                className="input-field"
                value={config.producaoMin}
                onChange={(e) => setConfig((c) => ({ ...c, producaoMin: Number(e.target.value) || 1 }))}
              />
            </div>
            <div>
              <label className="label-field text-xs">Descanso curto (min)</label>
              <input
                type="number"
                min={1}
                disabled={simplesRunning}
                className="input-field"
                value={config.descansoCurtoMin}
                onChange={(e) => setConfig((c) => ({ ...c, descansoCurtoMin: Number(e.target.value) || 1 }))}
              />
            </div>
            <div>
              <label className="label-field text-xs">Descanso longo (min)</label>
              <input
                type="number"
                min={1}
                disabled={simplesRunning}
                className="input-field"
                value={config.descansoLongoMin}
                onChange={(e) => setConfig((c) => ({ ...c, descansoLongoMin: Number(e.target.value) || 1 }))}
              />
            </div>
            <div>
              <label className="label-field text-xs">Tarefas até descanso longo</label>
              <input
                type="number"
                min={1}
                disabled={simplesRunning}
                className="input-field"
                value={config.tarefasAteDescansoLongo}
                onChange={(e) => setConfig((c) => ({ ...c, tarefasAteDescansoLongo: Number(e.target.value) || 1 }))}
              />
            </div>
          </div>
          {!simplesRunning && (
            <button
              type="button"
              onClick={restoreDefaults}
              className="mb-4 text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400"
            >
              Restaurar tempos padrão
            </button>
          )}

          <div className="mb-4 grid grid-cols-2 gap-3">
            <div>
              <label className="label-field text-xs">Disciplina</label>
              <input
                type="text"
                disabled={simplesRunning}
                className="input-field"
                placeholder="Ex.: Direito Administrativo"
                value={simplesDiscipline}
                onChange={(e) => setSimplesDiscipline(e.target.value)}
              />
            </div>
            <div>
              <label className="label-field text-xs">Assunto</label>
              <input
                type="text"
                disabled={simplesRunning}
                className="input-field"
                placeholder="Ex.: Poder de polícia"
                value={simplesSubject}
                onChange={(e) => setSimplesSubject(e.target.value)}
              />
            </div>
          </div>

          <div className="flex gap-2">
            <button type="button" onClick={startSimples} disabled={simplesRunning} className="btn-primary">
              <Play size={16} />
              Iniciar tarefa
            </button>
            <button type="button" onClick={stopSimples} disabled={!simplesRunning} className="btn-secondary">
              Fim das tarefas dessa sessão
            </button>
          </div>
        </div>

        {/* Super pomodoro */}
        <div className="card p-6">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Super pomodoro</h2>
            <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
              AVANÇADO
            </span>
          </div>
          <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
            Controle manual das tarefas: início, pausa e fim, com registro de cada tarefa.
          </p>

          <div className="mb-4 rounded-xl border border-neutral-200 bg-neutral-50 px-6 py-6 text-center dark:border-neutral-700 dark:bg-neutral-800/60">
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              Status: <span className="font-medium">{superRunning ? (superPaused ? 'Pausada' : 'Em andamento') : 'Encerrada'}</span>
            </p>
            <p className="mt-1 text-3xl font-bold text-neutral-900 dark:text-neutral-100">
              {formatTimer(superRunning ? superElapsed : 0)}
            </p>
            <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
              Fase: {superRunning ? (superPaused ? 'Pausada' : 'Tarefa em curso') : 'Nenhuma tarefa em curso'} · Tarefas
              registradas: {superTasks.length}
            </p>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-3">
            <div>
              <label className="label-field text-xs">Disciplina</label>
              <input
                type="text"
                disabled={superRunning}
                className="input-field"
                placeholder="Ex.: Direito Constitucional"
                value={superDiscipline}
                onChange={(e) => setSuperDiscipline(e.target.value)}
              />
            </div>
            <div>
              <label className="label-field text-xs">Assunto</label>
              <input
                type="text"
                disabled={superRunning}
                className="input-field"
                placeholder="Ex.: Controle de constitucionalidade"
                value={superSubject}
                onChange={(e) => setSuperSubject(e.target.value)}
              />
            </div>
          </div>

          <div className="flex gap-2">
            {!superRunning ? (
              <button type="button" onClick={startSuper} className="btn-primary">
                <Play size={16} />
                Iniciar tarefa
              </button>
            ) : (
              <button type="button" onClick={toggleSuperPause} className="btn-primary">
                <Play size={16} />
                {superPaused ? 'Retomar' : 'Pausar'}
              </button>
            )}
            <button type="button" onClick={endSuper} disabled={!superRunning} className="btn-secondary">
              <Square size={14} />
              Encerrar tarefa
            </button>
          </div>
        </div>
      </div>

      <div className="card mt-6 p-6">
        <h2 className="mb-1 text-base font-semibold text-neutral-900 dark:text-neutral-100">
          Estatísticas da sessão atual
        </h2>
        <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
          Registre disciplina e assunto em cada tarefa.
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <SessionStatsBox title="Pomodoro simples" tasks={simplesTasks} onReset={resetSimplesTasks} />
          <SessionStatsBox title="Super pomodoro" tasks={superTasks} onReset={resetSuperTasks} />
        </div>
      </div>

      <div className="card mt-6 p-6">
        <h2 className="mb-1 text-base font-semibold text-neutral-900 dark:text-neutral-100">Observações</h2>
        <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">Anotações gerais desta sessão.</p>
        <textarea
          rows={3}
          maxLength={100}
          className="input-field resize-none"
          placeholder="Escreva observações gerais..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <p className="mt-1 text-right text-xs text-neutral-400 dark:text-neutral-500">{notes.length} / 100</p>
      </div>
    </div>
  );
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}min${s > 0 ? ` ${s}s` : ''}` : `${s}s`;
}

const TASK_PHASE_LABEL: Record<string, string> = {
  producao: 'Produção',
  manual: 'Tarefa manual',
};

function SessionStatsBox({
  title,
  tasks,
  onReset,
}: {
  title: string;
  tasks: PomodoroTask[];
  onReset: () => void;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-700">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">{title}</p>
          {tasks.length === 0 && (
            <p className="text-xs text-neutral-400 dark:text-neutral-500">Nenhuma tarefa registrada ainda.</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onReset}
            disabled={tasks.length === 0}
            className="rounded-lg border border-neutral-200 px-2.5 py-1 text-xs font-medium text-neutral-500 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            Resetar estatísticas
          </button>
          <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
            {tasks.length} TAREFA{tasks.length === 1 ? '' : 'S'}
          </span>
        </div>
      </div>

      {tasks.length === 0 ? (
        <p className="text-center text-xs text-neutral-400 dark:text-neutral-500">
          {title === 'Pomodoro simples'
            ? 'Inicie uma tarefa no Pomodoro simples para começar a registrar os tempos desta sessão.'
            : 'Registre uma tarefa no Super pomodoro para registrar disciplina e assunto.'}
        </p>
      ) : (
        <div className="max-h-48 space-y-1.5 overflow-y-auto">
          {tasks.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between gap-2 rounded-lg bg-neutral-50 px-2.5 py-1.5 text-xs dark:bg-neutral-800/60"
            >
              <span className="min-w-0 truncate text-neutral-700 dark:text-neutral-300">
                {t.discipline || 'Sem disciplina'}
                {t.subject ? ` · ${t.subject}` : ''}
              </span>
              <span className="shrink-0 text-neutral-400 dark:text-neutral-500">
                {TASK_PHASE_LABEL[t.phase] ?? t.phase} · {formatDuration(t.durationSec)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
