import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Flag, Layers, Loader2, Timer, X } from 'lucide-react';

import { CardsFromQuestionsModal } from '../components/questions/CardsFromQuestionsModal';
import { CutoffCard } from '../components/questions/CutoffCard';
import { Alternatives, QuestionBody, QuestionCard } from '../components/questions/QuestionCard';
import { useConfirm } from '../contexts/ConfirmContext';
import { useToast } from '../contexts/ToastContext';
import { ApiError } from '../services/api';
import { questionBankApi } from '../services/questionBankApi';
import type { QbAttempt, QbAttemptResult, QbNotebook, QbQuestion } from '../types';
import { crossLetter, NO_LETTER_MARKS, pickLetter, type LetterMarks } from '../utils/choiceMarks';
import { clock, filterForNotebook, percent, questionLabel } from '../utils/questionBank';
import { formatDuration } from '../utils/studyTime';
import { isPending } from './QuestionNotebook';

type Phase = 'loading' | 'intro' | 'running' | 'done';

function Shell({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl">
      <Link to={`/questoes/cadernos/${id}`} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-neutral-500 hover:text-brand-600 dark:text-neutral-400 dark:hover:text-brand-400">
        <ArrowLeft size={16} />
        Voltar ao caderno
      </Link>
      {children}
    </div>
  );
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
      <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${total > 0 ? (done / total) * 100 : 0}%` }} />
    </div>
  );
}

/** A tela troca de modo pelo endereço (ex.: "praticar as que errei"): cada combinação recomeça do zero. */
export function QuestionRun() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  if (!id) return null;
  return <RunLoader key={`${id}?${params.toString()}`} id={id} simulado={params.get('modo') === 'simulado'} onlyPending={params.get('so') === 'pendentes'} />;
}

function RunLoader({ id, simulado, onlyPending }: { id: string; simulado: boolean; onlyPending: boolean }) {
  const [notebook, setNotebook] = useState<QbNotebook | null>(null);
  const [questions, setQuestions] = useState<QbQuestion[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    questionBankApi
      .notebook(id)
      .then((r) => {
        setNotebook(r.notebook);
        const usable = r.questions.filter((q) => q.gradable);
        setQuestions(onlyPending && !simulado ? usable.filter(isPending) : usable);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Não foi possível carregar o caderno.'));
  }, [id, onlyPending, simulado]);

  if (error) {
    return (
      <Shell id={id}>
        <p className="text-sm text-red-600">{error}</p>
      </Shell>
    );
  }
  if (!notebook) {
    return (
      <Shell id={id}>
        <p className="flex items-center gap-2 text-sm text-neutral-400">
          <Loader2 size={14} className="animate-spin" /> Carregando...
        </p>
      </Shell>
    );
  }
  if (questions.length === 0) {
    return (
      <Shell id={id}>
        <div className="card px-6 py-12 text-center text-sm text-neutral-500 dark:text-neutral-400">
          {onlyPending ? 'Nenhuma questão pendente neste caderno: você acertou todas na última vez. 🎉' : 'Este caderno não tem questões com gabarito para resolver.'}
        </div>
      </Shell>
    );
  }

  return simulado ? (
    <SimuladoRun notebook={notebook} questions={questions} />
  ) : (
    <PracticeRun notebook={notebook} initial={questions} onlyPending={onlyPending} />
  );
}

// ---------- praticar ----------

function PracticeRun({ notebook, initial, onlyPending }: { notebook: QbNotebook; initial: QbQuestion[]; onlyPending: boolean }) {
  const [questions, setQuestions] = useState(initial);
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<Record<string, boolean>>({});
  const [finished, setFinished] = useState(false);

  const replace = useCallback((next: QbQuestion) => setQuestions((prev) => prev.map((q) => (q.id === next.id ? next : q))), []);
  const current = questions[index];
  const hits = Object.values(results).filter(Boolean).length;
  const answered = Object.keys(results).length;
  const last = index >= questions.length - 1;

  function next() {
    if (last) setFinished(true);
    else setIndex(index + 1);
  }

  if (finished) {
    const wrong = answered - hits;
    return (
      <Shell id={notebook.id}>
        <div className="card p-8 text-center">
          <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">Prática concluída</h1>
          <p className="mt-3 text-3xl font-bold text-brand-700 dark:text-brand-300">{answered > 0 ? `${percent(hits, answered)}%` : '—'}</p>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            {answered === 0 ? 'Você não respondeu nenhuma questão.' : `Você respondeu ${answered} e acertou ${hits}.`}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {wrong > 0 && (
              <Link to={`/questoes/cadernos/${notebook.id}/resolver?modo=pratica&so=pendentes`} className="btn-primary">
                Praticar as que errei ({wrong})
              </Link>
            )}
            <Link to={`/questoes/cadernos/${notebook.id}`} className="btn-secondary">
              Voltar ao caderno
            </Link>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell id={notebook.id}>
      <div className="mb-4">
        <div className="mb-2 flex items-center justify-between text-sm">
          <h1 className="min-w-0 truncate font-semibold text-neutral-900 dark:text-neutral-100">
            {notebook.name}
            {onlyPending && <span className="ml-2 font-normal text-neutral-400">só pendentes</span>}
          </h1>
          <span className="shrink-0 text-neutral-500 dark:text-neutral-400">
            {index + 1} de {questions.length}
          </span>
        </div>
        <ProgressBar done={index + (results[current.id] !== undefined ? 1 : 0)} total={questions.length} />
      </div>

      <QuestionCard
        key={current.id}
        question={current}
        fresh
        onChange={replace}
        onDeleted={(deletedId) => {
          const remaining = questions.filter((q) => q.id !== deletedId);
          setQuestions(remaining);
          if (remaining.length === 0) setFinished(true);
          else setIndex(Math.min(index, remaining.length - 1));
        }}
        onAnswered={(r) => setResults((prev) => ({ ...prev, [current.id]: r.correct }))}
        footer={
          <button type="button" autoFocus onClick={next} className="btn-primary w-full sm:w-auto">
            {last ? 'Concluir' : 'Próxima'}
            <ArrowRight size={16} />
          </button>
        }
      />

      <div className="mt-4 flex justify-between">
        <button type="button" className="btn-secondary" disabled={index === 0} onClick={() => setIndex(index - 1)}>
          <ArrowLeft size={16} />
          Anterior
        </button>
        {results[current.id] === undefined && (
          <button type="button" className="btn-secondary" onClick={next}>
            {last ? 'Concluir sem responder' : 'Pular'}
            <ArrowRight size={16} />
          </button>
        )}
      </div>
    </Shell>
  );
}

// ---------- simulado ----------

function SimuladoRun({ notebook, questions }: { notebook: QbNotebook; questions: QbQuestion[] }) {
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [phase, setPhase] = useState<Phase>('intro');
  const [index, setIndex] = useState(0);
  // A resposta marcada e as alternativas tachadas de cada questão. As tachadas só existem na tela (ficam quando o usuário vai e
  // volta entre as questões e não são enviadas); só a marcada vai ao finalizar.
  const [marks, setMarks] = useState<Record<string, LetterMarks>>({});
  const picks = useMemo(() => Object.fromEntries(Object.entries(marks).map(([id, m]) => [id, m.picked])) as Record<string, string>, [marks]);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ attempt: QbAttempt; results: QbAttemptResult[] } | null>(null);
  const startedAt = useRef(0);

  // O relógio só anda enquanto o simulado está em andamento.
  useEffect(() => {
    if (phase !== 'running') return;
    const timer = setInterval(() => setElapsed(Date.now() - startedAt.current), 1000);
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => {
      clearInterval(timer);
      window.removeEventListener('beforeunload', warn);
    };
  }, [phase]);

  const answeredCount = useMemo(() => questions.filter((q) => picks[q.id]).length, [questions, picks]);

  /** Aplica uma mudança às marcas de uma questão (numa atualização só: dois toques seguidos nunca leem um estado velho). */
  function mark(questionId: string, change: (marks: LetterMarks) => LetterMarks) {
    setMarks((prev) => ({ ...prev, [questionId]: change(prev[questionId] ?? NO_LETTER_MARKS) }));
  }

  function begin() {
    startedAt.current = Date.now();
    setElapsed(0);
    setPhase('running');
  }

  async function finish() {
    if (busy) return;
    const missing = questions.length - answeredCount;
    if (missing > 0) {
      const ok = await confirm({
        message: `Ainda ${missing === 1 ? 'falta' : 'faltam'} ${missing} ${missing === 1 ? 'questão' : 'questões'} sem resposta (contam como erradas). Finalizar mesmo assim?`,
        confirmLabel: 'Finalizar',
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const result = await questionBankApi.finishSimulado(
        notebook.id,
        Date.now() - startedAt.current,
        questions.filter((q) => picks[q.id]).map((q) => ({ questionId: q.id, chosen: picks[q.id] })),
      );
      setOutcome(result);
      setPhase('done');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Não foi possível guardar o simulado.', 'error');
    } finally {
      setBusy(false);
    }
  }

  if (phase === 'intro') {
    return (
      <Shell id={notebook.id}>
        <div className="card p-8 text-center">
          <Timer size={28} className="mx-auto text-brand-600" />
          <h1 className="mt-3 text-xl font-bold text-neutral-900 dark:text-neutral-100">Simulado: {notebook.name}</h1>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
            {questions.length} {questions.length === 1 ? 'questão' : 'questões'}. Você responde sem ver o gabarito, pode ir e voltar entre as questões, e a correção
            aparece só quando finalizar. O relógio começa agora.
          </p>
          <button type="button" autoFocus className="btn-primary mt-6" onClick={begin}>
            Começar
          </button>
        </div>
      </Shell>
    );
  }

  if (phase === 'done' && outcome) {
    return <SimuladoResult notebook={notebook} questions={questions} picks={picks} outcome={outcome} />;
  }

  const current = questions[index];
  return (
    <Shell id={notebook.id}>
      <div className="sticky top-0 z-10 -mx-1 mb-4 border-b border-neutral-200 bg-white/95 px-1 pb-3 pt-1 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/95">
        <div className="mb-2 flex items-center justify-between gap-3 text-sm">
          <span className="font-semibold text-neutral-900 dark:text-neutral-100">
            Questão {index + 1} de {questions.length}
          </span>
          <span className="flex items-center gap-1.5 font-mono text-neutral-600 dark:text-neutral-300" aria-label="Tempo decorrido">
            <Timer size={15} />
            {clock(elapsed)}
          </span>
          <span className="text-neutral-500 dark:text-neutral-400">{answeredCount} respondidas</span>
        </div>
        <ProgressBar done={answeredCount} total={questions.length} />
      </div>

      <article className="card p-5 sm:p-6">
        <QuestionBody question={current} />
        <Alternatives
          question={current}
          picked={picks[current.id] ?? ''}
          onPick={(letter) => mark(current.id, (m) => pickLetter(m, letter, true))}
          reveal={false}
          crossed={marks[current.id]?.crossed}
          onCross={(letter) => mark(current.id, (m) => crossLetter(m, letter))}
        />
        <p className="mt-3 text-xs text-neutral-400 dark:text-neutral-500">
          Toque na alternativa escolhida de novo para desmarcá-la. O ícone riscado elimina as que você descarta.
        </p>
      </article>

      <div className="mt-4 flex justify-between gap-2">
        <button type="button" className="btn-secondary" disabled={index === 0} onClick={() => setIndex(index - 1)}>
          <ArrowLeft size={16} />
          Anterior
        </button>
        {index < questions.length - 1 ? (
          <button type="button" className="btn-primary" onClick={() => setIndex(index + 1)}>
            Próxima
            <ArrowRight size={16} />
          </button>
        ) : (
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void finish()}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Flag size={16} />}
            Finalizar
          </button>
        )}
      </div>

      <nav className="mt-6" aria-label="Ir para a questão">
        <ul className="flex flex-wrap gap-1.5">
          {questions.map((q, i) => (
            <li key={q.id}>
              <button
                type="button"
                onClick={() => setIndex(i)}
                aria-current={i === index ? 'true' : undefined}
                aria-label={`Questão ${i + 1}${picks[q.id] ? ', respondida' : ''}`}
                className={`h-9 min-w-9 rounded-lg px-2 text-sm font-medium transition-colors ${
                  i === index
                    ? 'bg-brand-600 text-white'
                    : picks[q.id]
                      ? 'bg-brand-100 text-brand-800 hover:bg-brand-200 dark:bg-brand-900/50 dark:text-brand-200'
                      : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700'
                }`}
              >
                {i + 1}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-6 flex justify-center">
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => void finish()}>
          <Flag size={16} />
          Finalizar o simulado agora
        </button>
      </div>
    </Shell>
  );
}

function SimuladoResult({
  notebook,
  questions,
  picks,
  outcome,
}: {
  notebook: QbNotebook;
  questions: QbQuestion[];
  picks: Record<string, string>;
  outcome: { attempt: QbAttempt; results: QbAttemptResult[] };
}) {
  const [onlyWrong, setOnlyWrong] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [makingCards, setMakingCards] = useState(false);
  const byId = useMemo(() => new Map(outcome.results.map((r) => [r.questionId, r])), [outcome]);
  const graded = questions.filter((q) => byId.has(q.id));
  const shown = onlyWrong ? graded.filter((q) => !byId.get(q.id)!.correct) : graded;
  const { attempt } = outcome;
  const wrongCount = attempt.total - attempt.correct;

  return (
    <Shell id={notebook.id}>
      <div className="card p-8 text-center">
        <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">Resultado do simulado</h1>
        <p className="mt-3 text-4xl font-bold text-brand-700 dark:text-brand-300">{percent(attempt.correct, attempt.total)}%</p>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          {attempt.correct} de {attempt.total} {attempt.total === 1 ? 'questão' : 'questões'} · {formatDuration(Math.round(attempt.durationMs / 1000))}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {wrongCount > 0 && (
            <Link to={`/questoes/cadernos/${notebook.id}/resolver?modo=pratica&so=pendentes`} className="btn-primary">
              Praticar as que errei ({wrongCount})
            </Link>
          )}
          {wrongCount > 0 && (
            <button type="button" className="btn-secondary" onClick={() => setMakingCards(true)}>
              <Layers size={16} />
              Criar cartões das que errei
            </button>
          )}
          <Link to={`/questoes/cadernos/${notebook.id}`} className="btn-secondary">
            Voltar ao caderno
          </Link>
        </div>
      </div>

      {makingCards && <CardsFromQuestionsModal target={{ filter: filterForNotebook(notebook.id) }} onClose={() => setMakingCards(false)} />}

      <CutoffCard attemptId={attempt.id} />

      <div className="mb-3 mt-8 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">Correção</h2>
        {wrongCount > 0 && (
          <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
            <input type="checkbox" checked={onlyWrong} onChange={(e) => setOnlyWrong(e.target.checked)} className="h-4 w-4 accent-brand-600" />
            Só as que errei
          </label>
        )}
      </div>
      <ul className="space-y-2">
        {shown.map((q) => {
          const result = byId.get(q.id)!;
          const isOpen = open === q.id;
          return (
            <li key={q.id} className="card">
              <button type="button" onClick={() => setOpen(isOpen ? null : q.id)} aria-expanded={isOpen} className="flex w-full items-start gap-3 px-4 py-3 text-left">
                <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white ${result.correct ? 'bg-brand-600' : 'bg-red-500'}`}>
                  {result.correct ? <Check size={14} /> : <X size={14} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-neutral-400 dark:text-neutral-500">
                    {q.sourceId ? questionLabel(q) : `${q.examName} · ${questionLabel(q)}`}
                  </span>
                  <span className="line-clamp-2 block text-sm text-neutral-800 dark:text-neutral-200">{q.statement}</span>
                </span>
                <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">
                  {result.chosen ? `Marcou ${result.chosen}` : 'Em branco'} · gabarito {result.answer}
                </span>
              </button>
              {isOpen && (
                <div className="border-t border-neutral-100 px-4 pb-4 pt-3 dark:border-neutral-800">
                  <QuestionBody question={q} />
                  <Alternatives question={{ ...q, answer: result.answer }} picked={result.chosen || picks[q.id] || ''} onPick={() => undefined} reveal />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Shell>
  );
}
