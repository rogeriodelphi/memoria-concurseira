import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, PartyPopper } from 'lucide-react';

import { collectionsApi, flashcardsApi } from '../services/api';
import { FlashcardReviewer } from '../components/FlashcardReviewer';
import { shuffle, isDue } from '../utils/studyQueue';
import type { CollectionDetail, Flashcard, StudyResult } from '../types';

export function StudyMode() {
  const { id } = useParams<{ id: string }>();

  const [collection, setCollection] = useState<CollectionDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [queue, setQueue] = useState<Flashcard[] | null>(null);
  const [allCards, setAllCards] = useState<Flashcard[]>([]);
  const [studyMode, setStudyMode] = useState<'due' | 'all'>('due');
  const [hadCards, setHadCards] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [requeued, setRequeued] = useState<Set<string>>(new Set());
  const [counts, setCounts] = useState<Record<StudyResult, number>>({
    errei: 0,
    dificil: 0,
    bom: 0,
    facil: 0,
  });

  useEffect(() => {
    if (!id) return;
    collectionsApi
      .get(id)
      .then(({ collection, flashcards }) => {
        setCollection(collection);
        setHadCards(flashcards.length > 0);
        setAllCards(flashcards);
        setQueue(shuffle(flashcards.filter(isDue)));
      })
      .catch(() => setLoadError('Não foi possível carregar esta coleção.'));
  }, [id]);

  function studyAllAnyway() {
    setStudyMode('all');
    setQueue(shuffle(allCards));
  }

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

  // Troca só os campos devolvidos pelo servidor; o resto do cartão na fila
  // (posição, favorito em andamento) fica como está.
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
  if (!collection || !queue) return <p className="text-sm text-neutral-400 dark:text-neutral-500">Carregando...</p>;

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-6 flex items-center justify-between">
        <Link
          to={`/colecoes/${collection.id}`}
          className="flex items-center gap-1.5 text-sm font-medium text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
        >
          <ArrowLeft size={16} />
          {collection.name}
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
          upcoming={queue?.[1]}
        />
      ) : hadCards && studiedSoFar === 0 && studyMode === 'due' ? (
        <div className="card flex flex-col items-center gap-3 p-10 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400">
            <CheckCircle2 size={22} />
          </div>
          <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">Tudo em dia!</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Nenhum flashcard pendente de revisão agora nesta coleção.
          </p>
          <div className="mt-2 flex gap-3">
            <Link to={`/colecoes/${collection.id}`} className="btn-secondary">
              Voltar para a coleção
            </Link>
            <button type="button" onClick={studyAllAnyway} className="btn-primary">
              Estudar todos mesmo assim
            </button>
          </div>
        </div>
      ) : hadCards ? (
        <div className="card flex flex-col items-center gap-3 p-10 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400">
            <PartyPopper size={22} />
          </div>
          <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">Sessão concluída!</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Você revisou {studiedSoFar} flashcard{studiedSoFar === 1 ? '' : 's'}.
          </p>
          <div className="mt-2 flex gap-4 text-sm">
            <span className="text-red-600 dark:text-red-400">{counts.errei} errei</span>
            <span className="text-amber-600 dark:text-amber-400">{counts.dificil} difícil</span>
            <span className="text-blue-600 dark:text-blue-400">{counts.bom} bom</span>
            <span className="text-brand-600 dark:text-brand-400">{counts.facil} fácil</span>
          </div>
          <Link to={`/colecoes/${collection.id}`} className="btn-primary mt-4">
            Voltar para a coleção
          </Link>
        </div>
      ) : (
        <div className="card flex flex-col items-center gap-3 p-10 text-center">
          <p className="text-sm text-neutral-500 dark:text-neutral-400">Esta coleção ainda não tem flashcards para estudar.</p>
          <Link to={`/colecoes/${collection.id}`} className="btn-primary mt-2">
            Voltar para a coleção
          </Link>
        </div>
      )}
    </div>
  );
}
