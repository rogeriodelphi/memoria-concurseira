import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

import { pomodoroApi } from '../services/api';
import type { PomodoroTask } from '../types';

const CONFIG_KEY = 'bc-pomodoro-config';
const SOUND_KEY = 'bc-pomodoro-sound';

export interface SimplesConfig {
  producaoMin: number;
  descansoCurtoMin: number;
  descansoLongoMin: number;
  tarefasAteDescansoLongo: number;
}

export const DEFAULT_POMODORO_CONFIG: SimplesConfig = {
  producaoMin: 25,
  descansoCurtoMin: 5,
  descansoLongoMin: 15,
  tarefasAteDescansoLongo: 4,
};

function readConfig(): SimplesConfig {
  try {
    const stored = localStorage.getItem(CONFIG_KEY);
    if (!stored) return DEFAULT_POMODORO_CONFIG;
    const parsed = JSON.parse(stored);
    return { ...DEFAULT_POMODORO_CONFIG, ...parsed };
  } catch {
    return DEFAULT_POMODORO_CONFIG;
  }
}

function readSoundPref(): boolean {
  return localStorage.getItem(SOUND_KEY) === 'true';
}

function playBeep() {
  try {
    const AudioCtx =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.start();
    osc.stop(ctx.currentTime + 0.6);
  } catch {
    // Web Audio indisponível neste navegador — ignora silenciosamente.
  }
}

export type SimplesPhase = 'producao' | 'descanso_curto' | 'descanso_longo';

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

interface PomodoroContextValue {
  soundEnabled: boolean;
  setSoundEnabled: (value: boolean) => void;

  config: SimplesConfig;
  setConfig: (updater: (c: SimplesConfig) => SimplesConfig) => void;
  restoreDefaults: () => void;

  simplesRunning: boolean;
  simplesPhase: SimplesPhase;
  simplesRemaining: number;
  simplesDiscipline: string;
  setSimplesDiscipline: (value: string) => void;
  simplesSubject: string;
  setSimplesSubject: (value: string) => void;
  simplesTasks: PomodoroTask[];
  startSimples: () => void;
  stopSimples: () => void;
  resetSimplesTasks: () => void;

  superRunning: boolean;
  superPaused: boolean;
  superElapsed: number;
  superDiscipline: string;
  setSuperDiscipline: (value: string) => void;
  superSubject: string;
  setSuperSubject: (value: string) => void;
  superTasks: PomodoroTask[];
  startSuper: () => void;
  toggleSuperPause: () => void;
  endSuper: () => void;
  resetSuperTasks: () => void;

  notes: string;
  setNotes: (value: string) => void;
}

const PomodoroContext = createContext<PomodoroContextValue | null>(null);

// Vive acima das rotas (montado uma vez no App), de propósito — assim o
// cronômetro continua contando mesmo quando o usuário navega pra outra
// página (ex.: estudar uma coleção) e volta depois. Se esse estado morasse
// dentro da página /pomodoro, ela desmontaria a cada troca de rota e o
// cronômetro zeraria.
export function PomodoroProvider({ children }: { children: ReactNode }) {
  const [soundEnabled, setSoundEnabledState] = useState(readSoundPref);

  const [config, setConfigState] = useState<SimplesConfig>(readConfig);
  const [simplesRunning, setSimplesRunning] = useState(false);
  const [simplesPhase, setSimplesPhase] = useState<SimplesPhase>('producao');
  const [simplesRemaining, setSimplesRemaining] = useState(0);
  const [simplesProducaoCount, setSimplesProducaoCount] = useState(0);
  const [simplesDiscipline, setSimplesDiscipline] = useState('');
  const [simplesSubject, setSimplesSubject] = useState('');
  const [simplesTasks, setSimplesTasks] = useState<PomodoroTask[]>([]);
  const simplesPhaseStartRef = useRef<string>(new Date().toISOString());

  const [superRunning, setSuperRunning] = useState(false);
  const [superPaused, setSuperPaused] = useState(false);
  const [superElapsed, setSuperElapsed] = useState(0);
  const [superDiscipline, setSuperDiscipline] = useState('');
  const [superSubject, setSuperSubject] = useState('');
  const [superTasks, setSuperTasks] = useState<PomodoroTask[]>([]);
  const superStartRef = useRef<string>(new Date().toISOString());

  const [notes, setNotes] = useState('');
  const notesLoadedRef = useRef(false);

  useEffect(() => {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  }, [config]);

  useEffect(() => {
    localStorage.setItem(SOUND_KEY, String(soundEnabled));
  }, [soundEnabled]);

  useEffect(() => {
    pomodoroApi
      .getNote(todayKey())
      .then(({ text }) => {
        setNotes(text);
        notesLoadedRef.current = true;
      })
      .catch(() => {
        notesLoadedRef.current = true;
      });
  }, []);

  // Autosalva as observações (com debounce) — só depois que o valor inicial
  // já foi carregado do servidor, senão salvaria "" por cima do que já existia.
  useEffect(() => {
    if (!notesLoadedRef.current) return;
    const timeout = setTimeout(() => {
      pomodoroApi.saveNote(todayKey(), notes).catch(() => {});
    }, 700);
    return () => clearTimeout(timeout);
  }, [notes]);

  const logTask = useCallback(
    (task: {
      mode: 'simples' | 'super';
      phase: string;
      discipline: string;
      subject: string;
      durationSec: number;
      startedAt: string;
      endedAt: string;
    }) => {
      pomodoroApi
        .logTask(task)
        .then(({ task: saved }) => {
          if (task.mode === 'simples') setSimplesTasks((prev) => [saved, ...prev]);
          else setSuperTasks((prev) => [saved, ...prev]);
        })
        .catch(() => {});
      if (soundEnabled) playBeep();
    },
    [soundEnabled],
  );

  // Contador regressivo do Pomodoro simples.
  useEffect(() => {
    if (!simplesRunning) return;
    const interval = setInterval(() => {
      setSimplesRemaining((prev) => Math.max(prev - 1, 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [simplesRunning]);

  // Transição de fase do Pomodoro simples quando o tempo zera.
  useEffect(() => {
    if (!simplesRunning || simplesRemaining !== 0) return;

    if (simplesPhase === 'producao') {
      logTask({
        mode: 'simples',
        phase: 'producao',
        discipline: simplesDiscipline,
        subject: simplesSubject,
        durationSec: config.producaoMin * 60,
        startedAt: simplesPhaseStartRef.current,
        endedAt: new Date().toISOString(),
      });
      const nextCount = simplesProducaoCount + 1;
      setSimplesProducaoCount(nextCount);
      const isLong = nextCount % config.tarefasAteDescansoLongo === 0;
      simplesPhaseStartRef.current = new Date().toISOString();
      setSimplesPhase(isLong ? 'descanso_longo' : 'descanso_curto');
      setSimplesRemaining((isLong ? config.descansoLongoMin : config.descansoCurtoMin) * 60);
    } else {
      if (soundEnabled) playBeep();
      simplesPhaseStartRef.current = new Date().toISOString();
      setSimplesPhase('producao');
      setSimplesRemaining(config.producaoMin * 60);
    }
  }, [simplesRemaining, simplesRunning]);

  function startSimples() {
    simplesPhaseStartRef.current = new Date().toISOString();
    setSimplesPhase('producao');
    setSimplesRemaining(config.producaoMin * 60);
    setSimplesProducaoCount(0);
    setSimplesRunning(true);
  }

  function stopSimples() {
    setSimplesRunning(false);
    setSimplesRemaining(0);
  }

  // Cronômetro (progressivo) do Super pomodoro.
  useEffect(() => {
    if (!superRunning || superPaused) return;
    const interval = setInterval(() => {
      setSuperElapsed((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [superRunning, superPaused]);

  function startSuper() {
    superStartRef.current = new Date().toISOString();
    setSuperElapsed(0);
    setSuperPaused(false);
    setSuperRunning(true);
  }

  function endSuper() {
    if (superElapsed > 0) {
      logTask({
        mode: 'super',
        phase: 'manual',
        discipline: superDiscipline,
        subject: superSubject,
        durationSec: superElapsed,
        startedAt: superStartRef.current,
        endedAt: new Date().toISOString(),
      });
    }
    setSuperRunning(false);
    setSuperPaused(false);
    setSuperElapsed(0);
  }

  const value: PomodoroContextValue = {
    soundEnabled,
    setSoundEnabled: setSoundEnabledState,
    config,
    setConfig: setConfigState,
    restoreDefaults: () => setConfigState(DEFAULT_POMODORO_CONFIG),
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
    resetSimplesTasks: () => setSimplesTasks([]),
    superRunning,
    superPaused,
    superElapsed,
    superDiscipline,
    setSuperDiscipline,
    superSubject,
    setSuperSubject,
    superTasks,
    startSuper,
    toggleSuperPause: () => setSuperPaused((p) => !p),
    endSuper,
    resetSuperTasks: () => setSuperTasks([]),
    notes,
    setNotes,
  };

  return <PomodoroContext.Provider value={value}>{children}</PomodoroContext.Provider>;
}

export function usePomodoro(): PomodoroContextValue {
  const ctx = useContext(PomodoroContext);
  if (!ctx) throw new Error('usePomodoro precisa estar dentro de <PomodoroProvider>.');
  return ctx;
}
