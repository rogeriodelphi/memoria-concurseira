import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, PartyPopper } from 'lucide-react';

import { flashcardsApi } from '../services/api';
import { FlashcardReviewer } from './FlashcardReviewer';
import { shuffle } from '../utils/studyQueue';
import type { DueFlashcard, Flashcard, StudyResult } from '../types';

interface ReviewSessionProps {
  fetchQueue: () => Promise<{ flashcards: DueFlashcard[] }>;
  loadErrorMessage: string;
  backTo: string;
  backLabel: string;
  emptyIcon: typeof PartyPopper;
  emptyTitle: string;
  emptyMessage: string;
  completedTitle: string;
}

/**
 * Base compartilhada por qualquer "sessão de revisão que cruza coleções" —
 * hoje usada pela revisão global (cartões pendentes) e pelos favoritos.
 * Mantém fila, contagem e favoritar; quem chama só define de onde vêm os
 * cartões e os textos das telas vazia/concluída.
 */
export function ReviewSession({
  fetchQueue,
  loadErrorMessage,
  backTo,
  backLabel,
  emptyIcon: EmptyIcon,
  emptyTitle,
  emptyMessage,
  completedTitle,
}: ReviewSessionProps) {
  const [loadError, setLoadError] = useState<string | null>(null);
  const [queue, setQueue] = useState<DueFlashcard[] | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [requeued, setRequeued] = useState<Set<string>>(new Set());
  const [counts, setCounts] = useState<Record<StudyResult, number>>({
    errei: 0,
    dificil: 0,
    bom: 0,
    facil: 0,
  });

  useEffect(() => {
    fetchQueue()
      .then(({ flashcards }) => setQueue(shuffle(flashcards)))
      .catch(() => setLoadError(loadErrorMessage));
    // fetchQueue/loadErrorMessage vêm de props definidas uma vez pelo componente pai, na montagem.
  }, []);

  const current = queue?.[0] ?? null;
  const studiedSoFar = useMemo(
    () => counts.errei + counts.dificil + counts.bom + counts.facil,
    [counts],
  );

  async function rate(result: StudyResult, durationMs: number) {
    if (!current || !queue) return;

    await flashcardsApi.study(current.id, result, durationMs).catch(() => {});
    setCounts((prev) => ({ ...prev, [result]: prev[result] + 1 }));

    const rest = queue.slice(1);
    if (result === 'errei' && !requeued.has(current.id)) {
      setRequeued((prev) => new Set(prev).add(current.id));
      setQueue([...rest, current]);
    } else {
      setQueue(rest);
    }
    setRevealed(false);
  }

  // Mantém collectionName e o resto do cartão da fila; só absorve o que o
  // servidor devolveu depois da edição.
  function handleUpdated(updated: Flashcard) {
    setQueue((prev) => prev?.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)) ?? prev);
  }

  async function toggleFavorite() {
    if (!current) return;
    const nextFavorite = !current.favorite;
    setQueue((prev) => prev?.map((c) => (c.id === current.id ? { ...c, favorite: nextFavorite } : c)) ?? prev);
    try {
      await flashcardsApi.update(current.id, { favorite: nextFavorite });
    } catch {
      setQueue((prev) => prev?.map((c) => (c.id === current.id ? { ...c, favorite: !nextFavorite } : c)) ?? prev);
    }
  }

  if (loadError) return <p className="text-sm text-red-600">{loadError}</p>;
  if (!queue) return <p className="text-sm text-neutral-400 dark:text-neutral-500">Carregando...</p>;

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-6 flex items-center justify-between">
        <Link
          to={backTo}
          className="flex items-center gap-1.5 text-sm font-medium text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
        >
          <ArrowLeft size={16} />
          {backLabel}
        </Link>
        {queue.length > 0 && (
          <p className="text-sm text-neutral-400 dark:text-neutral-500">
            {queue.length} restante{queue.length === 1 ? '' : 's'}
          </p>
        )}
      </div>

      {current ? (
        <FlashcardReviewer
          current={current}
          revealed={revealed}
          onReveal={() => setRevealed(true)}
          onRate={rate}
          onToggleFavorite={toggleFavorite}
          onUpdated={handleUpdated}
          upcoming={queue[1]}
        />
      ) : studiedSoFar === 0 ? (
        <div className="card flex flex-col items-center gap-3 p-10 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400">
            <EmptyIcon size={22} />
          </div>
          <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">{emptyTitle}</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">{emptyMessage}</p>
          <Link to={backTo} className="btn-primary mt-2">
            {backLabel}
          </Link>
        </div>
      ) : (
        <div className="card flex flex-col items-center gap-3 p-10 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400">
            <PartyPopper size={22} />
          </div>
          <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">{completedTitle}</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Você revisou {studiedSoFar} flashcard{studiedSoFar === 1 ? '' : 's'}.
          </p>
          <div className="mt-2 flex gap-4 text-sm">
            <span className="text-red-600 dark:text-red-400">{counts.errei} errei</span>
            <span className="text-amber-600 dark:text-amber-400">{counts.dificil} difícil</span>
            <span className="text-blue-600 dark:text-blue-400">{counts.bom} bom</span>
            <span className="text-brand-600 dark:text-brand-400">{counts.facil} fácil</span>
          </div>
          <Link to={backTo} className="btn-primary mt-4">
            {backLabel}
          </Link>
        </div>
      )}
    </div>
  );
}
