import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  CircleHelp,
  ListChecks,
  Loader2,
  Play,
  RotateCcw,
  Sparkles,
  Timer,
  Trophy,
  Undo2,
  X,
} from 'lucide-react';

import { FormattedText } from '../components/FormattedText';
import { useConfirm } from '../contexts/ConfirmContext';
import { useMockExamShortcuts } from '../hooks/useMockExamShortcuts';
import { ApiError, mockExamsApi } from '../services/api';
import type { AttemptMode, ChoiceQuestion, MockExamCard, MockExamDetail } from '../types';
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
import {
  amountOptions,
  buildQuestion,
  chunk,
  defaultAmount,
  optionLetter,
  pickSample,
  PREPARE_BATCH_SIZE,
  type BuiltQuestion,
} from '../utils/mockExamChoices';
import { shuffle } from '../utils/studyQueue';

type Phase = 'intro' | 'preparing' | 'running' | 'finished';
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/** Um cartão da prova; na múltipla escolha, carrega a questão montada (alternativas já embaralhadas). */
type RunCard = MockExamCard & { built?: BuiltQuestion };

/** `-1` quando o usuário diz "não sei": conta como erro e mostra o gabarito. */
const DONT_KNOW = -1;

const KEY_CLASS =
  'rounded border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 font-sans text-[11px] font-medium text-neutral-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400';

interface PrepFailure {
  message: string;
  /** Os cartões sorteados para esta prova, para tentar de novo com os mesmos. */
  sample: MockExamCard[];
  /** Quantos deles já têm alternativas e permitem começar mesmo assim. */
  ready: number;
}

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
  const [mode, setMode] = useState<AttemptMode>('self');
  const [amount, setAmount] = useState(0);
  const [readyCount, setReadyCount] = useState<number | null>(null);
  const [prep, setPrep] = useState<{ done: number; total: number } | null>(null);
  const [prepFailure, setPrepFailure] = useState<PrepFailure | null>(null);
  const [leftOut, setLeftOut] = useState(0);
  const [runMode, setRunMode] = useState<AttemptMode>('self');
  const [run, setRun] = useState<RunState<RunCard> | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [totalMs, setTotalMs] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [openWrong, setOpenWrong] = useState<Set<string>>(new Set());

  // Quando a prova e o cartão da vez começaram, para o cronômetro e o tempo de cada cartão.
  const startedAtRef = useRef(0);
  const shownAtRef = useRef(0);
  /** Quanto o usuário levou para escolher a alternativa (o tempo da resposta, não o de ler o gabarito). */
  const pickedAfterMsRef = useRef(0);
  /** As alternativas já conhecidas, de uma prova para a outra: refazer os erros não pede nada ao servidor. */
  const choicesRef = useRef(new Map<string, ChoiceQuestion>());
  const cancelRef = useRef(false);

  useEffect(() => {
    if (!id) return;
    mockExamsApi
      .get(id)
      .then(({ mockExam }) => setExam(mockExam))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Não foi possível carregar este simulado.'));
  }, [id]);

  // Sair da tela no meio da preparação a interrompe: o que já foi guardado no servidor continua valendo.
  useEffect(() => {
    cancelRef.current = false;
    return () => {
      cancelRef.current = true;
    };
  }, []);

  // O cronômetro da prova, uma vez por segundo.
  useEffect(() => {
    if (phase !== 'running') return;
    const timer = setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  const pool = exam ? (onlyWrong ? exam.cards.filter((c) => exam.lastWrongFlashcardIds.includes(c.id)) : exam.cards) : [];
  const amounts = amountOptions(pool.length);

  // A quantidade fica sempre uma das oferecidas (a lista de cartões pode mudar o que cabe).
  const poolSize = pool.length;
  useEffect(() => {
    const offered = amountOptions(poolSize);
    if (offered.length > 0 && !offered.includes(amount)) setAmount(defaultAmount(poolSize));
  }, [poolSize, amount]);

  // Ao escolher a múltipla escolha, vê quantos cartões já têm alternativas guardadas (para a tela avisar o que vai gastar).
  useEffect(() => {
    if (!id || mode !== 'choice' || phase !== 'intro') return;
    let alive = true;
    mockExamsApi
      .choices(id)
      .then(({ questions }) => {
        if (!alive) return;
        for (const q of questions) choicesRef.current.set(q.flashcardId, q);
        const poolIds = new Set(pool.map((c) => c.id));
        setReadyCount(questions.filter((q) => poolIds.has(q.flashcardId)).length);
      })
      .catch(() => alive && setReadyCount(null));
    return () => {
      alive = false;
    };
    // `pool` muda de identidade a cada render; o que importa aqui é o simulado e o modo.
  }, [id, mode, phase, exam]);

  function begin(cards: RunCard[], nextMode: AttemptMode) {
    setRunMode(nextMode);
    setRun(startRun(cards));
    setRevealed(false);
    setPicked(null);
    setOpenWrong(new Set());
    setSaveState('idle');
    setElapsedMs(0);
    startedAtRef.current = Date.now();
    shownAtRef.current = Date.now();
    setPhase('running');
  }

  function start(cards: MockExamCard[]) {
    setLeftOut(0);
    begin(shuffleOrder ? shuffle(cards) : cards, 'self');
  }

  /** Monta a prova de múltipla escolha com as alternativas já conhecidas (uma sorteada de novo a cada prova). */
  function beginChoice(cards: MockExamCard[], skipped = 0) {
    const withQuestions: RunCard[] = [];
    for (const card of cards) {
      const choice = choicesRef.current.get(card.id);
      if (choice) withQuestions.push({ ...card, built: buildQuestion(choice) });
    }
    setLeftOut(skipped + (cards.length - withQuestions.length));
    begin(withQuestions, 'choice');
  }

  /** Garante as alternativas dos cartões sorteados (só os que faltam vão à IA, em lotes) e começa a prova. */
  async function prepareAndBegin(sample: MockExamCard[]) {
    if (!id) return;
    cancelRef.current = false;
    setPrepFailure(null);
    setPhase('preparing');
    const missing = sample.filter((c) => !choicesRef.current.has(c.id));
    setPrep({ done: sample.length - missing.length, total: sample.length });

    try {
      for (const batch of chunk(missing, PREPARE_BATCH_SIZE)) {
        const { questions } = await mockExamsApi.prepareChoices(
          id,
          batch.map((c) => c.id),
        );
        if (cancelRef.current) return;
        for (const q of questions) choicesRef.current.set(q.flashcardId, q);
        setPrep((p) => (p ? { ...p, done: p.done + batch.length } : p));
      }
    } catch (err) {
      if (cancelRef.current) return;
      setPrepFailure({
        message: err instanceof ApiError ? err.message : 'Não foi possível gerar as alternativas.',
        sample,
        ready: sample.filter((c) => choicesRef.current.has(c.id)).length,
      });
      return;
    }
    if (cancelRef.current) return;

    if (!sample.some((c) => choicesRef.current.has(c.id))) {
      setPrepFailure({
        message: 'A IA não conseguiu gerar alternativas para esses cartões (cartões só com imagem, por exemplo, não servem).',
        sample,
        ready: 0,
      });
      return;
    }
    beginChoice(sample);
  }

  function startChoice() {
    void prepareAndBegin(pickSample(pool, amount, shuffleOrder));
  }

  function cancelPreparation() {
    cancelRef.current = true;
    setPrep(null);
    setPrepFailure(null);
    setPhase('intro');
  }

  async function save(finished: RunState<RunCard>, durationMs: number) {
    if (!id) return;
    setSaveState('saving');
    try {
      await mockExamsApi.recordAttempt(
        id,
        durationMs,
        finished.answers.map((a) => ({ flashcardId: a.flashcardId, correct: a.correct, durationMs: a.durationMs })),
        runMode,
      );
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  }

  function answer(correct: boolean, spentMs: number = Date.now() - shownAtRef.current) {
    if (!run) return;
    const next = answerCurrent(run, correct, spentMs);
    setRun(next);
    setRevealed(false);
    setPicked(null);
    shownAtRef.current = Date.now();
    if (isFinished(next)) {
      const durationMs = Date.now() - startedAtRef.current;
      setTotalMs(durationMs);
      setPhase('finished');
      void save(next, durationMs);
    }
  }

  function pick(index: number) {
    if (picked !== null) return;
    pickedAfterMsRef.current = Date.now() - shownAtRef.current;
    setPicked(index);
  }

  /** Segue para a próxima questão, registrando se a escolhida era a correta. */
  function next() {
    if (!run || picked === null) return;
    const card = currentCard(run);
    answer(!!card?.built && picked === card.built.correctIndex, pickedAfterMsRef.current);
  }

  function back() {
    if (!run || run.answers.length === 0) return;
    setRun(undoAnswer(run));
    setRevealed(false);
    setPicked(null);
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

  const running = phase === 'running' && !!run;
  const shownCard = running && run ? currentCard(run) : null;
  useMockExamShortcuts({
    enabled: phase === 'running',
    revealed,
    canGoBack: !!run && run.answers.length > 0,
    onReveal: () => setRevealed(true),
    onAnswer: answer,
    onBack: back,
    choice:
      runMode === 'choice' && shownCard?.built
        ? {
            optionCount: shownCard.built.options.length,
            picked: picked !== null,
            onPick: pick,
            onDontKnow: () => pick(DONT_KNOW),
            onNext: next,
          }
        : undefined,
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

  // ---------- preparando as alternativas ----------
  if (phase === 'preparing') {
    return (
      <div className="mx-auto max-w-xl">
        {backLink}
        <div className="card flex flex-col items-center gap-3 p-8 text-center">
          {prepFailure ? (
            <>
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400">
                <X size={22} />
              </div>
              <h1 className="text-lg font-bold text-neutral-900 dark:text-neutral-100">Não deu para preparar todas as questões</h1>
              <p className="text-sm text-neutral-600 dark:text-neutral-300">{prepFailure.message}</p>
              {prepFailure.ready > 0 && (
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  {prepFailure.ready} de {prepFailure.sample.length} já têm alternativas guardadas.
                </p>
              )}
              <div className="mt-2 flex flex-wrap justify-center gap-2">
                {prepFailure.ready > 0 && (
                  <button type="button" autoFocus onClick={() => beginChoice(prepFailure.sample)} className="btn-primary">
                    <Play size={16} />
                    Começar com as {prepFailure.ready} prontas
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void prepareAndBegin(prepFailure.sample)}
                  className={prepFailure.ready > 0 ? 'btn-secondary' : 'btn-primary'}
                >
                  Tentar de novo
                </button>
                <button type="button" onClick={cancelPreparation} className="btn-secondary">
                  Voltar
                </button>
              </div>
            </>
          ) : (
            <>
              <Loader2 size={28} className="animate-spin text-brand-600 dark:text-brand-400" />
              <h1 className="text-lg font-bold text-neutral-900 dark:text-neutral-100">Preparando as questões</h1>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                A IA está montando as alternativas dos cartões que ainda não têm. Isso acontece uma vez por cartão: da
                próxima vez elas já estarão guardadas.
              </p>
              {prep && (
                <>
                  <div
                    className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={prep.total}
                    aria-valuenow={prep.done}
                  >
                    <div
                      className="h-full rounded-full bg-brand-500 transition-all"
                      style={{ width: `${prep.total === 0 ? 0 : (prep.done / prep.total) * 100}%` }}
                    />
                  </div>
                  <p className="text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
                    {prep.done} de {prep.total} cartões
                  </p>
                </>
              )}
              <button type="button" onClick={cancelPreparation} className="btn-secondary mt-2">
                Cancelar
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

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
                {pool.length} {pool.length === 1 ? 'cartão' : 'cartões'}. O cronômetro corre durante toda a prova e a nota
                aparece no final.
              </p>

              <fieldset className="mt-5 space-y-2">
                <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                  Como fazer a prova
                </legend>
                <ModeOption
                  checked={mode === 'self'}
                  onSelect={() => setMode('self')}
                  icon={<Check size={16} />}
                  title="Autoavaliação"
                  description="Você vê a pergunta, pensa na resposta, a mostra e marca se acertou ou errou."
                />
                <ModeOption
                  checked={mode === 'choice'}
                  onSelect={() => setMode('choice')}
                  icon={<ListChecks size={16} />}
                  title="Múltipla escolha"
                  description="Questões com cinco alternativas, geradas por IA. Mostra o que você realmente sabe, sem a chance de se achar mais certo do que está."
                />
              </fieldset>

              {mode === 'choice' && (
                <div className="mt-4 space-y-3 rounded-lg bg-neutral-50 p-4 text-sm dark:bg-neutral-800/50">
                  <label className="flex items-center justify-between gap-3 text-neutral-700 dark:text-neutral-300">
                    Quantas questões
                    <select
                      value={amount}
                      onChange={(e) => setAmount(Number(e.target.value))}
                      className="input-field !w-auto py-1.5"
                      aria-label="Quantidade de questões"
                    >
                      {amounts.map((n) => (
                        <option key={n} value={n}>
                          {n === pool.length ? `Todas (${n})` : n}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="flex items-start gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                    <Sparkles size={14} className="mt-0.5 shrink-0 text-brand-600 dark:text-brand-400" />
                    <span>
                      As alternativas são geradas uma única vez por cartão e ficam guardadas. Só os cartões que ainda não
                      têm vão para a IA (em lotes de {PREPARE_BATCH_SIZE}), e isso usa a cota dela.
                      {readyCount !== null && (
                        <>
                          {' '}
                          <strong className="font-semibold text-neutral-700 dark:text-neutral-300">
                            {readyCount} de {pool.length}
                          </strong>{' '}
                          já estão prontos.
                        </>
                      )}
                    </span>
                  </p>
                </div>
              )}

              <label className="mt-5 flex cursor-pointer items-center gap-2.5 text-sm text-neutral-700 dark:text-neutral-300">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-brand-600"
                  checked={shuffleOrder}
                  onChange={(e) => setShuffleOrder(e.target.checked)}
                />
                {mode === 'choice' ? 'Sortear os cartões e embaralhar a ordem' : 'Embaralhar a ordem dos cartões'}
              </label>
              <button
                type="button"
                autoFocus
                onClick={() => (mode === 'choice' ? startChoice() : start(pool))}
                className="btn-primary mt-6 w-full"
              >
                <Play size={16} />
                Começar
              </button>
              <p className="mt-4 text-center text-xs text-neutral-400 dark:text-neutral-500">
                {mode === 'choice' ? (
                  <>
                    Atalhos: <kbd className={KEY_CLASS}>1</kbd>–<kbd className={KEY_CLASS}>5</kbd> ou{' '}
                    <kbd className={KEY_CLASS}>A</kbd>–<kbd className={KEY_CLASS}>E</kbd> escolhem ·{' '}
                    <kbd className={KEY_CLASS}>0</kbd> não sei · <kbd className={KEY_CLASS}>Enter</kbd> segue ·{' '}
                    <kbd className={KEY_CLASS}>←</kbd> volta
                  </>
                ) : (
                  <>
                    Atalhos: <kbd className={KEY_CLASS}>Enter</kbd> mostra a resposta · <kbd className={KEY_CLASS}>1</kbd> errei ·{' '}
                    <kbd className={KEY_CLASS}>2</kbd> acertei · <kbd className={KEY_CLASS}>←</kbd> volta
                  </>
                )}
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
          {runMode === 'choice' && (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">Prova de múltipla escolha</p>
          )}
          {leftOut > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {leftOut} {leftOut === 1 ? 'cartão ficou' : 'cartões ficaram'} de fora: a IA não gerou alternativas para{' '}
              {leftOut === 1 ? 'ele' : 'eles'}.
            </p>
          )}
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
              <button
                type="button"
                onClick={() => (runMode === 'choice' ? beginChoice(shuffleOrder ? shuffle(result.wrong) : result.wrong) : start(result.wrong))}
                className="btn-primary"
              >
                <RotateCcw size={16} />
                Refazer só os {result.wrong.length} que errei
              </button>
            )}
            {runMode === 'choice' ? (
              <button type="button" onClick={() => setPhase('intro')} className="btn-secondary">
                Fazer outra prova
              </button>
            ) : (
              <button type="button" onClick={() => start(exam.cards)} className="btn-secondary">
                Refazer tudo
              </button>
            )}
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
  const built = runMode === 'choice' ? card.built : undefined;
  const isLast = position === run.cards.length;

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
          {built ? 'Questão' : 'Cartão'} {position} de {run.cards.length}
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

      {built ? (
        <ChoiceQuestionView
          card={card}
          built={built}
          picked={picked}
          isLast={isLast}
          onPick={pick}
          onNext={next}
        />
      ) : (
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
      )}

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
          {built ? (
            <>
              <kbd className={KEY_CLASS}>1</kbd>–<kbd className={KEY_CLASS}>{built.options.length}</kbd> ou{' '}
              <kbd className={KEY_CLASS}>A</kbd>–<kbd className={KEY_CLASS}>{optionLetter(built.options.length - 1)}</kbd> escolhem ·{' '}
              <kbd className={KEY_CLASS}>0</kbd> não sei · <kbd className={KEY_CLASS}>Enter</kbd> segue ·{' '}
              <kbd className={KEY_CLASS}>←</kbd> volta
            </>
          ) : (
            <>
              <kbd className={KEY_CLASS}>Enter</kbd> mostra a resposta · <kbd className={KEY_CLASS}>1</kbd> errei ·{' '}
              <kbd className={KEY_CLASS}>2</kbd> acertei · <kbd className={KEY_CLASS}>←</kbd> volta
            </>
          )}
        </p>
      </div>
    </div>
  );
}

function ModeOption({
  checked,
  onSelect,
  icon,
  title,
  description,
}: {
  checked: boolean;
  onSelect: () => void;
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
        checked
          ? 'border-brand-500 bg-brand-50/60 dark:border-brand-500 dark:bg-brand-950/30'
          : 'border-neutral-200 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800/50'
      }`}
    >
      <input type="radio" name="mode" className="mt-1 h-4 w-4 accent-brand-600" checked={checked} onChange={onSelect} />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          {icon}
          {title}
        </span>
        <span className="mt-0.5 block text-xs text-neutral-500 dark:text-neutral-400">{description}</span>
      </span>
    </label>
  );
}

/** Uma questão de múltipla escolha: as alternativas e, depois de responder, o gabarito e a resposta do cartão. */
function ChoiceQuestionView({
  card,
  built,
  picked,
  isLast,
  onPick,
  onNext,
}: {
  card: RunCard;
  built: BuiltQuestion;
  picked: number | null;
  isLast: boolean;
  onPick: (index: number) => void;
  onNext: () => void;
}) {
  const answered = picked !== null;
  const hit = answered && picked === built.correctIndex;

  return (
    <div className="card p-6 sm:p-8">
      <p className="mb-2 text-center text-xs font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
        {card.collectionName}
      </p>
      <div className="mb-5 text-center">
        <FormattedText
          value={card.question}
          format={card.format}
          role="question"
          className="text-lg text-neutral-900 dark:text-neutral-100"
        />
      </div>

      <ul className="space-y-2" role="list">
        {built.options.map((option, index) => {
          const isCorrect = index === built.correctIndex;
          const isPicked = index === picked;
          let tone = 'border-neutral-200 hover:border-brand-400 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800/50';
          if (answered) {
            if (isCorrect) tone = 'border-brand-500 bg-brand-50 dark:border-brand-500 dark:bg-brand-950/40';
            else if (isPicked) tone = 'border-red-400 bg-red-50 dark:border-red-500 dark:bg-red-950/40';
            else tone = 'border-neutral-200 opacity-60 dark:border-neutral-700';
          }
          return (
            <li key={index}>
              <button
                type="button"
                disabled={answered}
                onClick={() => onPick(index)}
                aria-label={`Alternativa ${optionLetter(index)}`}
                className={`flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-colors disabled:cursor-default ${tone}`}
              >
                <span
                  className={`mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    answered && isCorrect
                      ? 'bg-brand-600 text-white'
                      : answered && isPicked
                        ? 'bg-red-600 text-white'
                        : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'
                  }`}
                >
                  {answered && isCorrect ? <Check size={14} /> : answered && isPicked ? <X size={14} /> : optionLetter(index)}
                </span>
                <span className="min-w-0 flex-1 whitespace-pre-wrap text-neutral-800 dark:text-neutral-200">{option}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {!answered ? (
        <button
          type="button"
          onClick={() => onPick(DONT_KNOW)}
          className="mx-auto mt-4 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        >
          <CircleHelp size={15} />
          Não sei
          <kbd className="hidden rounded border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 font-sans text-[11px] font-medium text-neutral-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400 sm:inline">
            0
          </kbd>
        </button>
      ) : (
        <div className="mt-5">
          <p
            className={`text-center text-sm font-semibold ${
              hit ? 'text-brand-700 dark:text-brand-300' : 'text-red-700 dark:text-red-300'
            }`}
          >
            {hit ? 'Acertou!' : picked === DONT_KNOW ? 'Sem problema: veja a resposta.' : 'Errou.'}
          </p>
          {/* As alternativas vêm da IA, que pode errar: a resposta do próprio cartão é o que vale. */}
          <div className="mt-3 rounded-lg bg-neutral-50 p-4 dark:bg-neutral-800/50">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
              Resposta do cartão
            </p>
            <FormattedText
              value={card.answer}
              format={card.format}
              role="answer"
              className="text-sm text-neutral-700 dark:text-neutral-300"
            />
          </div>
          <button type="button" autoFocus onClick={onNext} className="btn-primary mt-4 w-full">
            {isLast ? 'Ver resultado' : 'Próxima'}
            <kbd className="ml-2 hidden rounded bg-white/20 px-1.5 py-0.5 font-sans text-xs font-medium sm:inline">Enter</kbd>
          </button>
        </div>
      )}
    </div>
  );
}
