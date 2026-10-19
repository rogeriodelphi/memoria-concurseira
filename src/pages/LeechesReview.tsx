import { CheckCircle2 } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

import { ReviewSession } from '../components/ReviewSession';
import { leechesApi } from '../services/api';

/**
 * Revisar só os cartões sanguessuga, de uma vez. Os adiados ficam de fora (adiar é "não me mostre agora"). Vale
 * para qualquer cartão da lista, vencido ou não: quem escolhe revisar não é contido pela data de vencimento, e o que
 * for avaliado aqui entra no agendamento como qualquer revisão.
 */
export function LeechesReview() {
  const [params] = useSearchParams();
  const minErrors = Number(params.get('min')) || undefined;

  return (
    <ReviewSession
      // Uma sessão nova por limite de erros: trocar o número no endereço recomeça a fila.
      key={minErrors ?? 'padrao'}
      fetchQueue={() => leechesApi.list(minErrors).then(({ leeches }) => ({ flashcards: leeches.filter((l) => !l.snoozed).map((l) => l.flashcard), waitingNew: 0 }))}
      loadErrorMessage="Não foi possível carregar os cartões sanguessuga."
      backTo="/sanguessugas"
      backLabel="Cartões sanguessuga"
      emptyIcon={CheckCircle2}
      emptyTitle="Nada para rever!"
      emptyMessage="Nenhum cartão sanguessuga para rever agora."
      completedTitle="Sanguessugas revistos!"
    />
  );
}
