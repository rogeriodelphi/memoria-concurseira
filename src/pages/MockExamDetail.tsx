import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ChevronRight, Play, RotateCcw, X } from 'lucide-react';

import { FormattedText } from '../components/FormattedText';
import { useToast } from '../contexts/ToastContext';
import { ApiError, mockExamsApi } from '../services/api';
import type { MockExamDetail as MockExamDetailType } from '../types';
import { formatDuration, percentage } from '../utils/mockExamRun';
import { stripHtmlForSpeech } from '../utils/speech';

export function MockExamDetail() {
  const { id } = useParams<{ id: string }>();
  const { showToast } = useToast();
  const [exam, setExam] = useState<MockExamDetailType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!id) return;
    mockExamsApi
      .get(id)
      .then(({ mockExam }) => setExam(mockExam))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Não foi possível carregar este simulado.'));
  }, [id]);

  async function removeCard(flashcardId: string) {
    if (!id) return;
    try {
      await mockExamsApi.removeCard(id, flashcardId);
      setExam((prev) =>
        prev
          ? {
              ...prev,
              cards: prev.cards.filter((c) => c.id !== flashcardId),
              lastWrongFlashcardIds: prev.lastWrongFlashcardIds.filter((x) => x !== flashcardId),
            }
          : prev,
      );
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Não foi possível tirar o cartão do simulado.', 'error');
    }
  }

  function toggleExpanded(cardId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(cardId)) next.add(cardId);
      return next;
    });
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl">
        <p className="text-sm text-red-600">{error}</p>
        <Link to="/simulados" className="btn-secondary mt-4 inline-flex">
          Voltar aos simulados
        </Link>
      </div>
    );
  }
  if (!exam) return <p className="text-sm text-neutral-400 dark:text-neutral-500">Carregando...</p>;

  const wrongCount = exam.lastWrongFlashcardIds.length;

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        to="/simulados"
        className="mb-4 flex items-center gap-1.5 text-sm font-medium text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
      >
        <ArrowLeft size={16} />
        Simulados
      </Link>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold text-neutral-900 dark:text-neutral-100">{exam.name}</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            {exam.cards.length} {exam.cards.length === 1 ? 'cartão' : 'cartões'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {exam.cards.length > 0 && (
            <Link to={`/simulados/${exam.id}/fazer`} className="btn-primary">
              <Play size={16} />
              Fazer simulado
            </Link>
          )}
          {wrongCount > 0 && (
            <Link to={`/simulados/${exam.id}/fazer?erros=1`} className="btn-secondary">
              <RotateCcw size={16} />
              Refazer os {wrongCount} que errei
            </Link>
          )}
        </div>
      </div>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">Cartões</h2>
        {exam.cards.length === 0 ? (
          <div className="card px-5 py-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
            Este simulado ainda não tem cartões. Use o botão &quot;Adicionar ao simulado&quot; em qualquer cartão, no
            estudo ou na lista de uma coleção.
          </div>
        ) : (
          <ul className="card divide-y divide-neutral-200 dark:divide-neutral-800">
            {exam.cards.map((card) => {
              const open = expanded.has(card.id);
              return (
                <li key={card.id}>
                  <div className="flex items-center gap-2 px-4 py-3">
                    <button
                      type="button"
                      onClick={() => toggleExpanded(card.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      aria-expanded={open}
                    >
                      <ChevronRight
                        size={16}
                        className={`shrink-0 text-neutral-400 transition-transform dark:text-neutral-500 ${open ? 'rotate-90' : ''}`}
                      />
                      <span className="min-w-0">
                        <span className="line-clamp-2 text-sm font-medium text-neutral-800 dark:text-neutral-200">
                          {stripHtmlForSpeech(card.question, card.format) || '(só imagem)'}
                        </span>
                        <span className="block truncate text-xs text-neutral-400 dark:text-neutral-500">
                          {card.collectionName}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeCard(card.id)}
                      className="shrink-0 rounded-lg p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-600 dark:text-neutral-500 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                      title="Tirar do simulado (o cartão continua na coleção)"
                      aria-label="Tirar do simulado"
                    >
                      <X size={16} />
                    </button>
                  </div>
                  {open && (
                    <div className="space-y-3 px-4 pb-4 pl-10">
                      <FormattedText
                        value={card.question}
                        format={card.format}
                        role="question"
                        className="text-sm text-neutral-900 dark:text-neutral-100"
                      />
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
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">Histórico</h2>
        {exam.attempts.length === 0 ? (
          <p className="text-sm text-neutral-400 dark:text-neutral-500">Você ainda não fez este simulado.</p>
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-neutral-100 bg-neutral-50/60 text-xs uppercase tracking-wide text-neutral-400 dark:border-neutral-800 dark:bg-neutral-800/60 dark:text-neutral-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Quando</th>
                  <th className="px-4 py-2.5 font-medium">Tipo</th>
                  <th className="px-4 py-2.5 font-medium">Nota</th>
                  <th className="px-4 py-2.5 font-medium">Acertos</th>
                  <th className="px-4 py-2.5 font-medium">Tempo</th>
                </tr>
              </thead>
              <tbody>
                {exam.attempts.map((attempt) => (
                  <tr key={attempt.id} className="border-b border-neutral-50 last:border-0 dark:border-neutral-800">
                    <td className="px-4 py-2.5 text-neutral-600 dark:text-neutral-300">
                      {new Date(attempt.finishedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                    </td>
                    <td className="px-4 py-2.5 text-neutral-500 dark:text-neutral-400">
                      {attempt.mode === 'choice' ? 'Múltipla escolha' : 'Autoavaliado'}
                    </td>
                    <td className="px-4 py-2.5 font-semibold text-neutral-900 dark:text-neutral-100">
                      {percentage(attempt.correct, attempt.total)}%
                    </td>
                    <td className="px-4 py-2.5 text-neutral-600 dark:text-neutral-300">
                      {attempt.correct} de {attempt.total}
                    </td>
                    <td className="px-4 py-2.5 text-neutral-500 dark:text-neutral-400">
                      {formatDuration(attempt.durationMs)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
