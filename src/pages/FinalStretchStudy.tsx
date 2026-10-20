import { CheckCircle2 } from 'lucide-react';

import { ReviewSession } from '../components/ReviewSession';
import { studyPlanApi } from '../services/api';
import { readFocusExam } from '../utils/focusExam';

/**
 * A sessão do foco da reta final: os cartões das coleções ligadas ao edital, repartidos pela prioridade das
 * disciplinas (vencidos e, enquanto falta mais de uma semana, alguns novos). É uma revisão como as outras: o que você
 * avaliar entra no agendamento normalmente.
 */
export function FinalStretchStudy() {
  return (
    <ReviewSession
      fetchQueue={() => studyPlanApi.finalStretchQueue(readFocusExam()).then(({ flashcards }) => ({ flashcards, waitingNew: 0 }))}
      loadErrorMessage="Não foi possível carregar os cartões do foco."
      backTo="/reta-final"
      backLabel="Reta final"
      emptyIcon={CheckCircle2}
      emptyTitle="Nada para rever!"
      emptyMessage="Nenhum cartão do edital para rever agora."
      completedTitle="Foco de hoje concluído!"
    />
  );
}
