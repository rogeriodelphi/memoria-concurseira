import { CheckCircle2 } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';

import { ReviewSession } from '../components/ReviewSession';
import { flashcardsApi } from '../services/api';
import { safeReturnUrl } from '../utils/examLinks';
import { parseDay } from '../utils/performance';

/**
 * Revisar só os cartões que você errou (Errei ou Difícil) num grupo de coleções e num período, vindo dos
 * pontos de atenção do Meu desempenho. A lista traz cartões vencidos ou não: é uma revisão extra, e o que você
 * avaliar aqui entra no agendamento como qualquer revisão. As coleções e o período vêm no endereço.
 */
export function MissedStudy() {
  const [params] = useSearchParams();
  const ids = (params.get('ids') ?? '').split(',').filter(Boolean);
  const from = params.get('de');
  const to = params.get('ate');
  const name = params.get('nome')?.trim() || 'Cartões errados';
  const returnTo = safeReturnUrl(params.get('voltar')) ?? '/desempenho';
  const validPeriod = !!parseDay(from) && !!parseDay(to);

  if (ids.length === 0 || !validPeriod) {
    return (
      <div className="mx-auto max-w-xl">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Nenhum cartão foi escolhido para rever.</p>
        <Link to={returnTo} className="btn-secondary mt-4 inline-flex">
          Voltar ao desempenho
        </Link>
      </div>
    );
  }

  return (
    <ReviewSession
      // Uma sessão nova por grupo e período: trocar um deles no endereço recomeça a fila.
      key={`${ids.join(',')}|${from}|${to}`}
      fetchQueue={() => flashcardsApi.missed(ids, from!, to!).then(({ flashcards }) => ({ flashcards, waitingNew: 0 }))}
      loadErrorMessage="Não foi possível carregar os cartões que você errou."
      backTo={returnTo}
      backLabel={`Desempenho · ${name}`}
      emptyIcon={CheckCircle2}
      emptyTitle="Nada para rever!"
      emptyMessage={`Nenhum cartão errado em ${name} neste período.`}
      completedTitle="Errados revistos!"
    />
  );
}
