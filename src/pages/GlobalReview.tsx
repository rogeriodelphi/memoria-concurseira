import { CheckCircle2 } from 'lucide-react';

import { flashcardsApi } from '../services/api';
import { ReviewSession } from '../components/ReviewSession';

export function GlobalReview() {
  return (
    <ReviewSession
      fetchQueue={flashcardsApi.due}
      loadErrorMessage="Não foi possível carregar os flashcards pendentes."
      backTo="/colecoes"
      backLabel="Coleções"
      emptyIcon={CheckCircle2}
      emptyTitle="Tudo em dia!"
      emptyMessage="Você não tem nenhum flashcard pendente de revisão em nenhuma coleção agora."
      completedTitle="Revisão concluída!"
    />
  );
}
