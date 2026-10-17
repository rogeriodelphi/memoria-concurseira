import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check, ChevronRight, Loader2, Play, RotateCcw, Timer, Trophy, Undo2, X } from 'lucide-react';

import { FormattedText } from '../components/FormattedText';
import { useConfirm } from '../contexts/ConfirmContext';
import { useMockExamShortcuts } from '../hooks/useMockExamShortcuts';
import { ApiError, mockExamsApi } from '../services/api';
import type { MockExamCard, MockExamDetail } from '../types';
import {
  answerCurrent,
  currentCard,
  formatDuration,
  isFinished,
  runResult,
  startRun,
  undoAnswer,
  type RunState,
} from '../utils/mockExamRun';
import { shuffle } from '../utils/studyQueue';

type Phase = 'intro' | 'running' | 'finished';
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const KEY_CLASS =
  'rounded border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 font-sans text-[11px] font-medium text-neutral-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400';

export function MockExamTake() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const onlyWrong = params.get('erros') === '1';
  const navigate = useNavigate();
  const confirm = useConfirm();

  const [exam, setExam] = useState<MockExamDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('intro');
  const [shuffleOrder, setShuffleOrder] = useState(true);
  const [run, setRun] = useState<RunState<MockExamCard> | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [totalMs, setTotalMs] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [openWrong, setOpenWrong] = useState<Set<string>>(new Set());

  // Quando a prova e o cartão da vez começaram, para o cronômetro e o tempo de cada cartão.
  const startedAtRef = useRef(0);
  const shownAtRef = useRef(0);

  useEffect(() => {
    if (!id) return;
    mockExamsApi
      .get(id)
      .then(({ mockExam }) => setExam(mockExam))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Não foi possível carregar este simulado.'));
  }, [id]);

  // O cronômetro da prova, uma vez por segundo.
  useEffect(() => {
    if (phase !== 'running') return;
    const timer = setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  const pool = exam ? (onlyWrong ? exam.cards.filter((c) => exam.lastWrongFlashcardIds.includes(c.id)) : exam.cards) : [];

  function start(cards: MockExamCard[]) {
    setRun(startRun(shuffleOrder ? shuffle(cards) : cards));
    setRevealed(false);
    setOpenWrong(new Set());
    setSaveState('idle');
    setElapsedMs(0);
    startedAtRef.current = Date.now();
    shownAtRef.current = Date.now();
    setPhase('running');
  }

  async function save(finished: RunState<MockExamCard>, durationMs: number) {
    if (!id) return;
    setSaveState('saving');
    try {
      await mockExamsApi.recordAttempt(
        id,
        durationMs,
        finished.answers.map((a) => ({ flashcardId: a.flashcardId, correct: a.correct, durationMs: a.durationMs })),
      );
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  }

  function answer(correct: boolean) {
    if (!run) return;
    const next = answerCurrent(run, correct, Date.now() - shownAtRef.current);
    setRun(next);
    setRevealed(false);
    shownAtRef.current = Date.now();
    if (isFinished(next)) {
      const durationMs = Date.now() - startedAtRef.current;
      setTotalMs(durationMs);
      setPhase('finished');
      void save(next, durationMs);
    }
  }

  function back() {
    if (!run || run.answers.length === 0) return;
    setRun(undoAnswer(run));
    setRevealed(false);
    shownAtRef.current = Date.now();
  }

  async function leave() {
    if (run && run.answers.length > 0) {
      const ok = await confirm({
        message: 'Sair do simulado agora? As respostas desta tentativa serão perdidas.',
        danger: true,
      });
      if (!ok) return;
    }
    navigate(`/simulados/${id}`);
  }

  useMockExamShortcuts({
    enabled: phase === 'running',
    revealed,
    canGoBack: !!run && run.answers.length > 0,
    onReveal: () => setRevealed(true),
    onAnswer: answer,
    onBack: back,
  });

  if (error) {
    return (
      <div className="mx-auto max-w-xl">
        <p className="text-sm text-red-600">{error}</p>
        <Link to="/simulados" className="btn-secondary mt-4 inline-flex">
          Voltar aos simulados
        </Link>
      </div>
    );
  }
  if (!exam) return <p className="text-sm text-neutral-400 dark:text-neutral-500">Carregando...</p>;

  const backLink = (
    <Link
      to={`/simulados/${exam.id}`}
      className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
    >
      <ArrowLeft size={16} />
      {exam.name}
    </Link>
  );

  // ---------- tela inicial ----------
  if (phase === 'intro' || !run) {
    return (
      <div className="mx-auto max-w-xl">
        {backLink}
        <div className="card p-8">
          <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">{exam.name}</h1>
          {pool.length === 0 ? (
            <>
              <p className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">
                {onlyWrong
                  ? 'Você não errou nenhum cartão da última vez (ou eles já saíram do simulado).'
                  : 'Este simulado ainda não tem cartões.'}
              </p>
              <Link to={onlyWrong ? `/simulados/${exam.id}/fazer` : `/simulados/${exam.id}`} className="btn-primary mt-5 inline-flex">
                {onlyWrong ? 'Fazer o simulado inteiro' : 'Voltar ao simulado'}
              </Link>
            </>
          ) : (
            <>
              <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
                {onlyWrong ? 'Só os cartões que você errou da última vez: ' : ''}
                {pool.length} {pool.length === 1 ? 'cartão' : 'cartões'}. Você vê a pergunta, pensa na resposta, a
                mostra e marca se acertou ou errou. O cronômetro corre durante toda a prova e a nota aparece no final.
              </p>
              <label className="mt-5 flex cursor-pointer items-center gap-2.5 text-sm text-neutral-700 dark:text-neutral-300">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-brand-600"
                  checked={shuffleOrder}
                  onChange={(e) => setShuffleOrder(e.target.checked)}
                />
                Embaralhar a ordem dos cartões
              </label>
              <button type="button" autoFocus onClick={() => start(pool)} className="btn-primary mt-6 w-full">
                <Play size={16} />
                Começar
              </button>
              <p className="mt-4 text-center text-xs text-neutral-400 dark:text-neutral-500">
                Atalhos: <kbd className={KEY_CLASS}>Enter</kbd> mostra a resposta · <kbd className={KEY_CLASS}>1</kbd> errei ·{' '}
                <kbd className={KEY_CLASS}>2</kbd> acertei · <kbd className={KEY_CLASS}>←</kbd> volta
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  const result = runResult(run);

  // ---------- resultado ----------
  if (phase === 'finished') {
    const message =
      result.percent >= 80 ? 'Excelente!' : result.percent >= 60 ? 'Bom resultado!' : result.percent >= 40 ? 'Dá para melhorar.' : 'Vale revisar esse conteúdo.';
    return (
      <div className="mx-auto max-w-xl">
        {backLink}
        <div className="card flex flex-col items-center gap-3 p-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400">
            <Trophy size={22} />
          </div>
          <h1 className="text-4xl font-bold text-neutral-900 dark:text-neutral-100">{result.percent}%</h1>
          <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
            {message} Você acertou {result.correct} de {result.total}.
          </p>
          <div className="flex gap-6 text-sm text-neutral-500 dark:text-neutral-400">
            <span className="flex items-center gap-1.5">
              <Timer size={15} />
              {formatDuration(totalMs)} no total
            </span>
            <span>{formatDuration(result.averageMs)} por cartão</span>
          </div>

          {saveState === 'saving' && (
            <p className="flex items-center gap-1.5 text-xs text-neutral-400 dark:text-neutral-500">
              <Loader2 size={12} className="animate-spin" />
              Guardando no histórico...
            </p>
          )}
          {saveState === 'saved' && (
            <p className="flex items-center gap-1.5 text-xs text-brand-600 dark:text-brand-400">
              <Check size={12} />
              Guardado no histórico do simulado.
            </p>
          )}
          {saveState === 'error' && (
            <p className="text-xs text-red-600">
              Não foi possível guardar no histórico.{' '}
              <button type="button" onClick={() => void save(run, totalMs)} className="font-semibold underline">
                Tentar de novo
              </button>
            </p>
          )}

          <div className="mt-2 flex flex-wrap justify-center gap-2">
            {result.wrong.length > 0 && (
              <button type="button" onClick={() => start(result.wrong)} className="btn-primary">
                <RotateCcw size={16} />
                Refazer só os {result.wrong.length} que errei
              </button>
            )}
            <button type="button" onClick={() => start(exam.cards)} className="btn-secondary">
              Refazer tudo
            </button>
            <Link to={`/simulados/${exam.id}`} className="btn-secondary">
              Voltar ao simulado
            </Link>
          </div>
        </div>

        {result.wrong.length > 0 && (
          <section className="mt-6">
            <h2 className="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              O que você errou ({result.wrong.length})
            </h2>
            <ul className="card divide-y divide-neutral-200 dark:divide-neutral-800">
              {result.wrong.map((card) => {
                const open = openWrong.has(card.id);
                return (
                  <li key={card.id}>
                    <button
                      type="button"
                      onClick={() =>
                        setOpenWrong((prev) => {
                          const next = new Set(prev);
                          if (!next.delete(card.id)) next.add(card.id);
                          return next;
                        })
                      }
                      className="flex w-full items-center gap-2 px-4 py-3 text-left"
                      aria-expanded={open}
                    >
                      <ChevronRight
                        size={16}
                        className={`shrink-0 text-neutral-400 transition-transform dark:text-neutral-500 ${open ? 'rotate-90' : ''}`}
                      />
                      <span className="min-w-0 flex-1">
                        <FormattedText
                          value={card.question}
                          format={card.format}
                          role="question"
                          className="text-sm text-neutral-800 dark:text-neutral-200"
                        />
                      </span>
                    </button>
                    {open && (
                      <div className="px-4 pb-4 pl-10">
                        <FormattedText
                          value={card.answer}
                          format={card.format}
                          role="answer"
                          className="text-sm text-neutral-600 dark:text-neutral-300"
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    );
  }

  // ---------- a prova ----------
  const card = currentCard(run);
  if (!card) return null;
  const position = run.answers.length + 1;

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-3 flex items-center justify-between text-sm">
        <button
          type="button"
          onClick={() => void leave()}
          className="flex items-center gap-1.5 font-medium text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
        >
          <X size={16} />
          Sair
        </button>
        <span className="font-medium text-neutral-700 dark:text-neutral-300">
          Cartão {position} de {run.cards.length}
        </span>
        <span className="flex items-center gap-1.5 tabular-nums text-neutral-500 dark:text-neutral-400" title="Tempo de prova">
          <Timer size={15} />
          {formatDuration(elapsedMs)}
        </span>
      </div>
      <div
        className="mb-5 h-1.5 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={run.cards.length}
        aria-valuenow={run.answers.length}
      >
        <div
          className="h-full rounded-full bg-brand-500 transition-all"
          style={{ width: `${(run.answers.length / run.cards.length) * 100}%` }}
        />
      </div>

      <div className="card flex min-h-[320px] flex-col justify-between p-8">
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
            {card.collectionName}
          </p>
          <FormattedText
            value={card.question}
            format={card.format}
            role="question"
            className="text-lg text-neutral-900 dark:text-neutral-100"
          />
          {revealed && (
            <>
              <div className="my-6 h-px w-full bg-neutral-100 dark:bg-neutral-800" />
              <FormattedText
                value={card.answer}
                format={card.format}
                role="answer"
                className="text-neutral-600 dark:text-neutral-400"
              />
            </>
          )}
        </div>

        {!revealed ? (
          <button onClick={() => setRevealed(true)} className="btn-primary mt-6 w-full">
            Mostrar resposta
            <kbd className="ml-2 hidden rounded bg-white/20 px-1.5 py-0.5 font-sans text-xs font-medium sm:inline">Enter</kbd>
          </button>
        ) : (
          <div className="mt-6 grid grid-cols-2 gap-3">
            <button
              onClick={() => answer(false)}
              className="rounded-lg bg-red-50 px-3 py-3 text-sm font-semibold text-red-700 transition-colors hover:bg-red-100 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/70"
            >
              Errei
              <kbd className="ml-2 hidden rounded bg-red-100 px-1.5 py-0.5 font-sans text-xs font-medium dark:bg-red-950 sm:inline">1</kbd>
            </button>
            <button
              onClick={() => answer(true)}
              className="rounded-lg bg-brand-50 px-3 py-3 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-100 dark:bg-brand-950/40 dark:text-brand-300 dark:hover:bg-brand-950/70"
            >
              Acertei
              <kbd className="ml-2 hidden rounded bg-brand-100 px-1.5 py-0.5 font-sans text-xs font-medium dark:bg-brand-950 sm:inline">2</kbd>
            </button>
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <button
          type="button"
          onClick={back}
          disabled={run.answers.length === 0}
          title="Voltar ao cartão anterior (←) e refazer a resposta dele."
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        >
          <Undo2 size={15} />
          Voltar
        </button>
        <p className="hidden text-xs text-neutral-400 dark:text-neutral-500 sm:block">
          <kbd className={KEY_CLASS}>Enter</kbd> mostra a resposta · <kbd className={KEY_CLASS}>1</kbd> errei ·{' '}
          <kbd className={KEY_CLASS}>2</kbd> acertei · <kbd className={KEY_CLASS}>←</kbd> volta
        </p>
      </div>
    </div>
  );
}
