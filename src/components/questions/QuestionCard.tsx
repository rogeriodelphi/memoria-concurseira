import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AlertTriangle, BarChart3, BookCheck, Check, CircleSlash, FolderPlus, Image as ImageIcon, Loader2, Pencil, Plus, RotateCcw, StickyNote, X } from 'lucide-react';

import { useToast } from '../../contexts/ToastContext';
import { ApiError } from '../../services/api';
import { questionBankApi } from '../../services/questionBankApi';
import type { QbHistoryEntry, QbNotebook, QbQuestion } from '../../types';
import { blockedReason, breadcrumb, metaParts, questionLabel, statsLine } from '../../utils/questionBank';
import { EditQuestionModal } from './EditQuestionModal';

type Tab = 'gabarito' | 'estatisticas' | 'cadernos' | 'anotacoes';

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: 'gabarito', label: 'Gabarito', icon: <BookCheck size={15} /> },
  { id: 'estatisticas', label: 'Estatísticas', icon: <BarChart3 size={15} /> },
  { id: 'cadernos', label: 'Cadernos', icon: <FolderPlus size={15} /> },
  { id: 'anotacoes', label: 'Anotações', icon: <StickyNote size={15} /> },
];

const LONG_SUPPORT_CHARS = 500;

const message = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

function Badge({ tone, title, children }: { tone: 'amber' | 'neutral'; title: string; children: ReactNode }) {
  const color =
    tone === 'amber'
      ? 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200'
      : 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300';
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${color}`}>
      {children}
    </span>
  );
}

/** O cabeçalho, o texto de apoio e o enunciado de uma questão; usado no cartão e na correção do simulado. */
export function QuestionBody({ question }: { question: QbQuestion }) {
  const [expanded, setExpanded] = useState(false);
  const meta = metaParts(question);
  const crumb = breadcrumb(question);
  const longSupport = question.support.length > LONG_SUPPORT_CHARS;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-brand-700 dark:text-brand-300">
            {questionLabel(question)}
            {/* Num site de questões a prova já está na linha de baixo, por extenso. */}
            {!question.sourceId && <span className="ml-2 font-normal text-neutral-400 dark:text-neutral-500">{question.examName}</span>}
          </p>
          {crumb && <p className="mt-0.5 text-sm text-neutral-600 dark:text-neutral-400">{crumb}</p>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {question.annulled && (
            <Badge tone="amber" title="A banca anulou esta questão">
              <CircleSlash size={12} />
              Anulada
            </Badge>
          )}
          {!question.annulled && !question.gradable && (
            <Badge tone="amber" title="O PDF não trazia o gabarito: informe a alternativa certa para poder responder">
              Sem gabarito
            </Badge>
          )}
          {question.needsFigure && (
            <Badge tone="neutral" title="Esta questão depende de uma figura, gráfico ou tabela que não vem no texto">
              <ImageIcon size={12} />
              Depende de figura
            </Badge>
          )}
          {question.suspect && (
            <Badge tone="amber" title="O texto lido do PDF não bate com o original: confira e corrija se preciso">
              <AlertTriangle size={12} />
              Confira o texto
            </Badge>
          )}
        </div>
      </div>

      {meta.length > 0 && (
        <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
          {meta.map((part, i) => (
            <span key={part.label}>
              {i > 0 && <span className="mx-1.5">·</span>}
              <span className="font-medium text-neutral-600 dark:text-neutral-300">{part.label}:</span> {part.value}
            </span>
          ))}
        </p>
      )}

      {question.support && (
        <div className="mt-4 rounded-lg border-l-4 border-neutral-300 bg-neutral-50 p-4 text-sm leading-relaxed text-neutral-700 dark:border-neutral-600 dark:bg-neutral-800/50 dark:text-neutral-300">
          <p className="whitespace-pre-wrap">{longSupport && !expanded ? `${question.support.slice(0, 320).trimEnd()}…` : question.support}</p>
          {longSupport && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-2 text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300"
            >
              {expanded ? 'Mostrar menos' : 'Ver o texto completo'}
            </button>
          )}
        </div>
      )}

      <p className="mt-4 whitespace-pre-wrap text-base leading-relaxed text-neutral-900 dark:text-neutral-100">{question.statement}</p>
    </div>
  );
}

/**
 * As alternativas de uma questão. Sem `reveal`, escolhe-se uma (`picked`); com `reveal`, mostra o gabarito: a certa
 * em verde e, se a marcada estava errada, ela em vermelho.
 */
export function Alternatives({
  question,
  picked,
  onPick,
  reveal,
  disabled = false,
}: {
  question: QbQuestion;
  picked: string;
  onPick: (letter: string) => void;
  reveal: boolean;
  disabled?: boolean;
}) {
  return (
    <ul className="mt-5 space-y-2" role="list">
      {question.alternatives.map((alt) => {
        const isPicked = picked === alt.letter;
        const isRight = reveal && question.answer === alt.letter;
        const isWrong = reveal && isPicked && question.answer !== alt.letter;
        let tone = isPicked
          ? 'border-brand-500 bg-brand-50 dark:border-brand-500 dark:bg-brand-950/40'
          : 'border-neutral-200 hover:border-brand-400 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800/50';
        if (reveal) {
          if (isRight) tone = 'border-brand-500 bg-brand-50 dark:border-brand-500 dark:bg-brand-950/40';
          else if (isWrong) tone = 'border-red-400 bg-red-50 dark:border-red-500 dark:bg-red-950/40';
          else tone = 'border-neutral-200 opacity-60 dark:border-neutral-700';
        }
        return (
          <li key={alt.letter}>
            <button
              type="button"
              disabled={disabled || reveal}
              onClick={() => onPick(alt.letter)}
              aria-pressed={isPicked}
              aria-label={`Alternativa ${alt.letter}`}
              className={`flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-colors disabled:cursor-default ${tone}`}
            >
              <span
                className={`mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  isRight
                    ? 'bg-brand-600 text-white'
                    : isWrong
                      ? 'bg-red-600 text-white'
                      : isPicked
                        ? 'bg-brand-600 text-white'
                        : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'
                }`}
              >
                {isRight ? <Check size={14} /> : isWrong ? <X size={14} /> : alt.letter}
              </span>
              <span className="min-w-0 flex-1 whitespace-pre-wrap text-neutral-800 dark:text-neutral-200">{alt.text}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function QuestionCard({
  question,
  onChange,
  onDeleted,
  showTabs = true,
  fresh = false,
  onAnswered,
  footer,
}: {
  question: QbQuestion;
  /** Chamado com a questão atualizada (depois de responder, corrigir ou mudar as anotações). */
  onChange: (next: QbQuestion) => void;
  onDeleted: (id: string) => void;
  showTabs?: boolean;
  /** Começa sem mostrar a resposta anterior (a prática de questões que já foram respondidas). */
  fresh?: boolean;
  onAnswered?: (result: { correct: boolean; answer: string }) => void;
  /** Aparece embaixo do cartão depois de a questão ser respondida (ex.: "Próxima"). */
  footer?: ReactNode;
}) {
  const { showToast } = useToast();
  const [picked, setPicked] = useState('');
  const [shown, setShown] = useState(!fresh && question.mine !== null && question.answer !== undefined);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab | null>(null);
  const [editing, setEditing] = useState(false);
  const startedAt = useRef(Date.now());

  const blocked = blockedReason(question);
  const reveal = shown && question.answer !== undefined;
  const chosen = reveal ? (question.mine?.chosen ?? picked) : picked;
  const hit = reveal && chosen === question.answer;

  async function submit() {
    if (!picked || busy) return;
    setBusy(true);
    try {
      const result = await questionBankApi.answer(question.id, picked, Date.now() - startedAt.current);
      onChange({
        ...question,
        answer: result.answer,
        ...(result.comment ? { comment: result.comment } : {}),
        mine: { chosen: result.chosen, correct: result.correct, answeredAt: new Date().toISOString() },
        timesAnswered: question.timesAnswered + 1,
        timesCorrect: question.timesCorrect + (result.correct ? 1 : 0),
      });
      setShown(true);
      onAnswered?.({ correct: result.correct, answer: result.answer });
    } catch (err) {
      showToast(message(err, 'Não foi possível registrar a resposta.'), 'error');
    } finally {
      setBusy(false);
    }
  }

  function again() {
    setShown(false);
    setPicked('');
    startedAt.current = Date.now();
  }

  return (
    <article className="card p-5 sm:p-6">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <QuestionBody question={question} />
        </div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="tap-area -mr-1 flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          title="Corrigir o texto, o gabarito ou a disciplina desta questão"
        >
          <Pencil size={14} />
          <span className="hidden sm:inline">Corrigir</span>
        </button>
      </div>

      <Alternatives question={question} picked={chosen} onPick={setPicked} reveal={reveal} disabled={busy || blocked !== null} />

      {blocked && <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{blocked}</p>}

      {!blocked && !reveal && (
        <div className="mt-5">
          <button type="button" onClick={() => void submit()} disabled={!picked || busy} className="btn-primary">
            {busy && <Loader2 size={16} className="animate-spin" />}
            Responder
          </button>
        </div>
      )}

      {reveal && (
        <div className="mt-5" role="status">
          <p className={`flex flex-wrap items-center gap-3 text-sm font-semibold ${hit ? 'text-brand-700 dark:text-brand-300' : 'text-red-700 dark:text-red-300'}`}>
            {hit ? 'Você acertou!' : `Você errou. O gabarito é a alternativa ${question.answer}.`}
            <button
              type="button"
              onClick={again}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
            >
              <RotateCcw size={13} />
              Responder de novo
            </button>
          </p>
          {footer && <div className="mt-4">{footer}</div>}
        </div>
      )}

      {showTabs && (
        <div className="mt-5 border-t border-neutral-100 pt-3 dark:border-neutral-800">
          <div className="flex flex-wrap gap-1" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(tab === t.id ? null : t.id)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  tab === t.id
                    ? 'bg-brand-50 text-brand-800 dark:bg-brand-950/50 dark:text-brand-200'
                    : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100'
                }`}
              >
                {t.icon}
                {t.id === 'gabarito' && question.hasComment ? 'Gabarito comentado' : t.label}
                {t.id === 'cadernos' && question.notebookCount > 0 && <span className="text-neutral-400">({question.notebookCount})</span>}
                {t.id === 'anotacoes' && question.note && <span className="h-1.5 w-1.5 rounded-full bg-brand-500" aria-label="Tem anotação" />}
              </button>
            ))}
          </div>
          {tab && (
            <div className="mt-3 text-sm" role="tabpanel">
              {tab === 'gabarito' && <AnswerTab question={question} shown={shown} onChange={onChange} />}
              {tab === 'estatisticas' && <StatsTab question={question} />}
              {tab === 'cadernos' && <NotebooksTab question={question} onChange={onChange} />}
              {tab === 'anotacoes' && <NoteTab question={question} onChange={onChange} />}
            </div>
          )}
        </div>
      )}

      {editing && (
        <EditQuestionModal
          questionId={question.id}
          onClose={() => setEditing(false)}
          onSaved={(next) => {
            // O gabarito só aparece se o cartão já o mostrava: corrigir a questão não é responder a ela.
            onChange({ ...next, answer: shown || question.answer !== undefined ? next.answer : undefined });
            setEditing(false);
          }}
          onDeleted={() => {
            setEditing(false);
            onDeleted(question.id);
          }}
        />
      )}
    </article>
  );
}

// ---------- abas ----------

function AnswerTab({ question, shown, onChange }: { question: QbQuestion; shown: boolean; onChange: (q: QbQuestion) => void }) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  // O gabarito só aparece depois de responder nesta tela, ou se o usuário pedir para vê-lo sem responder.
  const [peeked, setPeeked] = useState(false);

  async function define(letter: string) {
    setBusy(true);
    try {
      const { question: next } = await questionBankApi.updateQuestion(question.id, { answer: letter });
      onChange({ ...question, answer: next.answer, gradable: next.gradable, annulled: next.annulled });
      showToast(`Gabarito definido: ${letter}.`);
    } catch (err) {
      showToast(message(err, 'Não foi possível definir o gabarito.'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function peek() {
    if (question.answer !== undefined) {
      setPeeked(true);
      return;
    }
    setBusy(true);
    try {
      const { question: full } = await questionBankApi.question(question.id);
      onChange({ ...question, answer: full.answer });
      setPeeked(true);
    } catch (err) {
      showToast(message(err, 'Não foi possível buscar o gabarito.'), 'error');
    } finally {
      setBusy(false);
    }
  }

  if (question.annulled) {
    return (
      <div>
        <p className="text-neutral-600 dark:text-neutral-400">Esta questão foi anulada: não há alternativa certa.</p>
        {question.comment && <CommentBlock text={question.comment} />}
      </div>
    );
  }

  if (!question.gradable) {
    return (
      <div>
        <p className="mb-2 text-neutral-600 dark:text-neutral-400">O PDF não trazia o gabarito desta questão. Qual é a alternativa certa?</p>
        <div className="flex flex-wrap gap-2">
          {question.alternatives.map((alt) => (
            <button key={alt.letter} type="button" disabled={busy} onClick={() => void define(alt.letter)} className="btn-secondary h-9 w-9 px-0 py-0">
              {alt.letter}
            </button>
          ))}
        </div>
        {question.comment && <CommentBlock text={question.comment} />}
      </div>
    );
  }

  if (question.answer === undefined || !(shown || peeked)) {
    return (
      <div>
        <p className="text-neutral-600 dark:text-neutral-400">
          Responda a questão para ver o gabarito{question.hasComment ? ' e o gabarito comentado' : ''}.
        </p>
        <button type="button" disabled={busy} onClick={() => void peek()} className="mt-2 text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300">
          Ver o gabarito sem responder
        </button>
      </div>
    );
  }

  const right = question.alternatives.find((a) => a.letter === question.answer);
  return (
    <div>
      <p className="text-neutral-700 dark:text-neutral-300">
        <span className="font-semibold text-brand-700 dark:text-brand-300">Gabarito: {question.answer}</span>
        {right && <span> — {right.text}</span>}
      </p>
      {question.comment && <CommentBlock text={question.comment} />}
    </div>
  );
}

/** O gabarito comentado (texto da explicação), com as quebras de linha como vieram. */
function CommentBlock({ text }: { text: string }) {
  return (
    <div className="mt-3 rounded-lg bg-neutral-50 p-4 dark:bg-neutral-800/50">
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">Gabarito comentado</p>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">{text}</p>
    </div>
  );
}

function StatsTab({ question }: { question: QbQuestion }) {
  const [history, setHistory] = useState<QbHistoryEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    questionBankApi
      .question(question.id)
      .then((r) => alive && setHistory(r.history))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
    // Recarrega quando uma nova resposta entra.
  }, [question.id, question.timesAnswered]);

  return (
    <div>
      <p className="text-neutral-700 dark:text-neutral-300">{statsLine(question)}</p>
      {failed && <p className="mt-2 text-red-600">Não foi possível carregar o histórico.</p>}
      {history === null && !failed && <p className="mt-2 text-neutral-400">Carregando...</p>}
      {history && history.length > 0 && (
        <ul className="mt-2 divide-y divide-neutral-100 dark:divide-neutral-800">
          {history.map((h, i) => (
            <li key={i} className="flex items-center justify-between gap-3 py-1.5 text-xs text-neutral-600 dark:text-neutral-400">
              <span>{new Date(h.answeredAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>
              <span className="flex items-center gap-2">
                {h.inSimulado && <span className="rounded bg-neutral-100 px-1.5 py-0.5 dark:bg-neutral-800">simulado</span>}
                Marcou {h.chosen}
                <span className={h.correct ? 'font-semibold text-brand-700 dark:text-brand-300' : 'font-semibold text-red-600 dark:text-red-400'}>
                  {h.correct ? 'acertou' : 'errou'}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NotebooksTab({ question, onChange }: { question: QbQuestion; onChange: (q: QbQuestion) => void }) {
  const { showToast } = useToast();
  const [notebooks, setNotebooks] = useState<QbNotebook[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let alive = true;
    questionBankApi
      .notebooks(question.id)
      .then((r) => alive && setNotebooks(r.notebooks))
      .catch(() => alive && showToast('Não foi possível carregar seus cadernos.', 'error'));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question.id]);

  async function flip(notebook: QbNotebook) {
    if (busyId) return;
    setBusyId(notebook.id);
    const putIn = !notebook.containsQuestion;
    try {
      if (putIn) await questionBankApi.addToNotebook(notebook.id, [question.id]);
      else await questionBankApi.removeFromNotebook(notebook.id, question.id);
      setNotebooks((prev) => prev?.map((n) => (n.id === notebook.id ? { ...n, containsQuestion: putIn, questionCount: n.questionCount + (putIn ? 1 : -1) } : n)) ?? prev);
      onChange({ ...question, notebookCount: Math.max(0, question.notebookCount + (putIn ? 1 : -1)) });
    } catch (err) {
      showToast(message(err, 'Não foi possível atualizar o caderno.'), 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function createAndAdd(event: FormEvent) {
    event.preventDefault();
    if (creating || name.trim().length < 2) return;
    setCreating(true);
    try {
      const { notebook } = await questionBankApi.createNotebook({ name, questionIds: [question.id] });
      setNotebooks((prev) => [...(prev ?? []), { ...notebook, containsQuestion: true }].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' })));
      onChange({ ...question, notebookCount: question.notebookCount + 1 });
      setName('');
    } catch (err) {
      showToast(message(err, 'Não foi possível criar o caderno.'), 'error');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      {notebooks === null && <p className="text-neutral-400">Carregando...</p>}
      {notebooks && notebooks.length === 0 && <p className="mb-2 text-neutral-600 dark:text-neutral-400">Você ainda não tem cadernos. Crie o primeiro abaixo.</p>}
      {notebooks && notebooks.length > 0 && (
        <ul className="mb-3 space-y-1">
          {notebooks.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                disabled={busyId !== null}
                aria-pressed={!!n.containsQuestion}
                onClick={() => void flip(n)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-neutral-100 disabled:opacity-60 dark:hover:bg-neutral-800"
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    n.containsQuestion ? 'border-brand-600 bg-brand-600 text-white' : 'border-neutral-300 dark:border-neutral-600'
                  }`}
                >
                  {busyId === n.id ? <Loader2 size={11} className="animate-spin" /> : n.containsQuestion && <Check size={12} />}
                </span>
                <span className="min-w-0 flex-1 truncate text-neutral-800 dark:text-neutral-200">{n.name}</span>
                <span className="shrink-0 text-xs text-neutral-400">{n.questionCount}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={createAndAdd} className="flex gap-2">
        <input className="input-field min-w-0 flex-1 py-2" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Novo caderno com esta questão" aria-label="Nome do novo caderno" />
        <button type="submit" className="btn-secondary py-2" disabled={creating || name.trim().length < 2}>
          {creating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
          Criar
        </button>
      </form>
    </div>
  );
}

function NoteTab({ question, onChange }: { question: QbQuestion; onChange: (q: QbQuestion) => void }) {
  const { showToast } = useToast();
  const [text, setText] = useState(question.note);
  const [busy, setBusy] = useState(false);
  const dirty = text.trim() !== question.note.trim();

  async function save() {
    setBusy(true);
    try {
      const { question: next } = await questionBankApi.updateQuestion(question.id, { note: text });
      // Só a anotação muda aqui: o gabarito que veio junto não deve aparecer sem a questão ter sido respondida.
      onChange({ ...question, note: next.note });
      showToast('Anotação salva.');
    } catch (err) {
      showToast(message(err, 'Não foi possível salvar a anotação.'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <textarea
        className="input-field resize-y"
        rows={4}
        maxLength={4000}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Seus comentários sobre esta questão: pegadinhas, o artigo da lei, por que errou..."
        aria-label="Minhas anotações"
      />
      <div className="mt-2 flex justify-end">
        <button type="button" className="btn-primary py-2" disabled={!dirty || busy} onClick={() => void save()}>
          {busy && <Loader2 size={15} className="animate-spin" />}
          Salvar anotação
        </button>
      </div>
    </div>
  );
}
