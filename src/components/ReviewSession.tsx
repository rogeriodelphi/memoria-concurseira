import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, PartyPopper, Undo2 } from 'lucide-react';

import { FlashcardReviewer } from './FlashcardReviewer';
import { StudyNavigation } from './StudyNavigation';
import { useStudySession } from '../hooks/useStudySession';
import { shuffle } from '../utils/studyQueue';
import { studiedCount } from '../utils/studySession';
import type { DueFlashcard } from '../types';

/** Lembra dos cartões novos que ficaram para outro dia por causa do limite diário (configurável em Configurações). */
function WaitingNote({ count }: { count: number }) {
  return (
    <p className="text-xs text-neutral-400 dark:text-neutral-500">
      {count.toLocaleString('pt-BR')} {count === 1 ? 'cartão novo aguarda' : 'cartões novos aguardam'} os próximos dias. O
      limite diário está em{' '}
      <Link to="/configuracoes" className="underline hover:text-brand-600">
        Configurações
      </Link>
      .
    </p>
  );
}

interface ReviewSessionProps {
  // `waitingNew`: cartões novos que ficaram de fora da fila pelo limite diário (só a revisão global informa).
  fetchQueue: () => Promise<{ flashcards: DueFlashcard[]; waitingNew?: number }>;
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
  const [waitingNew, setWaitingNew] = useState(0);
  const study = useStudySession<DueFlashcard>();
  const { session, current } = study;

  useEffect(() => {
    fetchQueue()
      .then(({ flashcards, waitingNew: waiting = 0 }) => {
        setWaitingNew(waiting);
        study.start(shuffle(flashcards));
      })
      .catch(() => setLoadError(loadErrorMessage));
    // fetchQueue/loadErrorMessage vêm de props definidas uma vez pelo componente pai, na montagem.
  }, []);

  if (loadError) return <p className="text-sm text-red-600">{loadError}</p>;
  if (!session) return <p className="text-sm text-neutral-400 dark:text-neutral-500">Carregando...</p>;

  const { queue, counts, skipped } = session;
  const studiedSoFar = studiedCount(session);

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
        <>
          <FlashcardReviewer
            current={current}
            revealed={study.revealed}
            onReveal={study.reveal}
            onRate={study.rate}
            onToggleFavorite={study.toggleFavorite}
            onUpdated={study.handleUpdated}
            upcoming={queue[1]}
            busy={study.busy}
            onBack={study.back}
            onSkip={study.skip}
            canGoBack={study.canGoBack}
          />
          <StudyNavigation canGoBack={study.canGoBack} busy={study.busy} onBack={study.back} onSkip={study.skip} />
        </>
      ) : session.history.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 p-10 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400">
            <EmptyIcon size={22} />
          </div>
          <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">
            {waitingNew > 0 ? 'Meta de hoje concluída!' : emptyTitle}
          </h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            {waitingNew > 0
              ? 'Você não tem mais revisões para hoje e já chegou ao limite de cartões novos do dia.'
              : emptyMessage}
          </p>
          {waitingNew > 0 && <WaitingNote count={waitingNew} />}
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
            Você revisou {studiedSoFar} flashcard{studiedSoFar === 1 ? '' : 's'}
            {skipped > 0 && ` e pulou ${skipped}`}.
          </p>
          {waitingNew > 0 && <WaitingNote count={waitingNew} />}
          <div className="mt-2 flex gap-4 text-sm">
            <span className="text-red-600 dark:text-red-400">{counts.errei} errei</span>
            <span className="text-amber-600 dark:text-amber-400">{counts.dificil} difícil</span>
            <span className="text-blue-600 dark:text-blue-400">{counts.bom} bom</span>
            <span className="text-brand-600 dark:text-brand-400">{counts.facil} fácil</span>
          </div>
          <div className="mt-4 flex gap-3">
            <button type="button" onClick={study.back} disabled={study.busy} className="btn-secondary">
              <Undo2 size={16} />
              Voltar ao cartão anterior
            </button>
            <Link to={backTo} className="btn-primary">
              {backLabel}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
