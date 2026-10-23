import { CheckCircle2 } from 'lucide-react';

import { ReviewSession } from '../components/ReviewSession';
import { flashcardsApi } from '../services/api';

/**
 * "Pôr em dia": uma revisão só com os cartões atrasados há mais tempo (um lote por vez), vinda do cartão "Dívida de
 * revisão" do Painel. Nenhum cartão novo entra, e o que você avaliar entra no agendamento como qualquer revisão.
 */
export function OverdueReview() {
  return (
    <ReviewSession
      fetchQueue={() => flashcardsApi.overdue().then(({ flashcards }) => ({ flashcards, waitingNew: 0 }))}
      loadErrorMessage="Não foi possível carregar os cartões atrasados."
      backTo="/painel"
      backLabel="Painel"
      emptyIcon={CheckCircle2}
      emptyTitle="Nada atrasado!"
      emptyMessage="Você não tem nenhum cartão atrasado agora: o que venceu antes de hoje já foi revisado."
      completedTitle="Lote em dia!"
    />
  );
}
