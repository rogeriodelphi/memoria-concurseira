import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Check, CircleSlash, ListChecks, Play, Timer, X } from 'lucide-react';

import { useToast } from '../contexts/ToastContext';
import { ApiError } from '../services/api';
import { questionBankApi } from '../services/questionBankApi';
import type { QbAttempt, QbNotebook, QbQuestion } from '../types';
import { formatDuration } from '../utils/studyTime';
import { breadcrumb, percent } from '../utils/questionBank';

/** Pendente = ainda não resolvida, ou a última resposta foi errada. */
export const isPending = (q: QbQuestion) => q.gradable && (q.mine === null || !q.mine.correct);

function StatusIcon({ question }: { question: QbQuestion }) {
  if (question.annulled) return <CircleSlash size={16} className="text-neutral-400" aria-label="Anulada" />;
  if (!question.gradable) return <span className="text-xs text-amber-600" title="Sem gabarito">?</span>;
  if (!question.mine) return <span className="h-2 w-2 rounded-full bg-neutral-300 dark:bg-neutral-600" aria-label="Não resolvida" />;
  return question.mine.correct ? (
    <Check size={16} className="text-brand-600" aria-label="Acertou" />
  ) : (
    <X size={16} className="text-red-500" aria-label="Errou" />
  );
}

export function QuestionNotebook() {
  const { id } = useParams<{ id: string }>();
  const { showToast } = useToast();
  const [notebook, setNotebook] = useState<QbNotebook | null>(null);
  const [questions, setQuestions] = useState<QbQuestion[]>([]);
  const [attempts, setAttempts] = useState<QbAttempt[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    questionBankApi
      .notebook(id)
      .then((r) => {
        setNotebook(r.notebook);
        setQuestions(r.questions);
        setAttempts(r.attempts);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Não foi possível carregar o caderno.'));
  }, [id]);

  async function remove(question: QbQuestion) {
    if (!id) return;
    try {
      await questionBankApi.removeFromNotebook(id, question.id);
      setQuestions((prev) => prev.filter((q) => q.id !== question.id));
      setNotebook((prev) => (prev ? { ...prev, questionCount: prev.questionCount - 1 } : prev));
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Não foi possível tirar a questão do caderno.', 'error');
    }
  }

  const back = (
    <Link to="/questoes/cadernos" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-neutral-500 hover:text-brand-600 dark:text-neutral-400 dark:hover:text-brand-400">
      <ArrowLeft size={16} />
      Cadernos
    </Link>
  );

  if (error) {
    return (
      <div className="mx-auto max-w-3xl">
        {back}
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }
  if (!notebook || !id) return <div className="mx-auto max-w-3xl">{back}<p className="text-sm text-neutral-400">Carregando...</p></div>;

  const gradable = questions.filter((q) => q.gradable);
  const pending = questions.filter(isPending);
  const answered = questions.filter((q) => q.mine !== null);
  const correct = answered.filter((q) => q.mine?.correct && !q.annulled).length;

  return (
    <div className="mx-auto max-w-3xl">
      {back}
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">{notebook.name}</h1>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        {questions.length} {questions.length === 1 ? 'questão' : 'questões'}
        {answered.length > 0 ? ` · ${answered.length} resolvidas · ${percent(correct, answered.length)}% de acerto` : ' · nenhuma resolvida ainda'}
      </p>

      {gradable.length === 0 ? (
        <p className="card mt-5 px-4 py-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
          Nenhuma questão deste caderno tem gabarito, então ele não pode ser praticado. Informe o gabarito nas questões (aba Questões).
        </p>
      ) : (
        <div className="mt-5 flex flex-wrap gap-2">
          <Link to={`/questoes/cadernos/${id}/resolver?modo=pratica`} className="btn-primary">
            <Play size={16} />
            Praticar
          </Link>
          {pending.length > 0 && pending.length < gradable.length && (
            <Link to={`/questoes/cadernos/${id}/resolver?modo=pratica&so=pendentes`} className="btn-secondary">
              <ListChecks size={16} />
              Só as pendentes ({pending.length})
            </Link>
          )}
          <Link to={`/questoes/cadernos/${id}/resolver?modo=simulado`} className="btn-secondary">
            <Timer size={16} />
            Fazer simulado
          </Link>
          <Link to={`/questoes?caderno=${id}`} className="btn-secondary">
            Ver como lista completa
          </Link>
        </div>
      )}

      {attempts.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">Simulados feitos</h2>
          <ul className="card divide-y divide-neutral-100 dark:divide-neutral-800">
            {attempts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <span className="text-neutral-600 dark:text-neutral-300">
                  {new Date(a.finishedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                </span>
                <span className="font-medium text-neutral-900 dark:text-neutral-100">
                  {a.correct} de {a.total} ({percent(a.correct, a.total)}%)
                  <span className="ml-2 font-normal text-neutral-400">{formatDuration(Math.round(a.durationMs / 1000))}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">Questões</h2>
        {questions.length === 0 ? (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">Este caderno ficou sem questões.</p>
        ) : (
          <ul className="card divide-y divide-neutral-100 dark:divide-neutral-800">
            {questions.map((q) => (
              <li key={q.id} className="flex items-start gap-3 px-4 py-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
                  <StatusIcon question={q} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-neutral-400 dark:text-neutral-500">
                    {q.examName} · Questão {q.number}
                    {breadcrumb(q) ? ` · ${breadcrumb(q)}` : ''}
                  </p>
                  <p className="line-clamp-2 text-sm text-neutral-800 dark:text-neutral-200">{q.statement}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void remove(q)}
                  className="shrink-0 rounded-lg p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                  title="Tirar do caderno"
                  aria-label={`Tirar a questão ${q.number} do caderno`}
                >
                  <X size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
