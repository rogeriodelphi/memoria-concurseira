import { CheckCircle2 } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';

import { ReviewSession } from '../components/ReviewSession';
import { flashcardsApi } from '../services/api';
import { safeReturnPath } from '../utils/examLinks';

/**
 * Estudar uma disciplina inteira: a revisão dos cartões pendentes de várias coleções de uma vez. As
 * coleções vêm no endereço (?ids=a,b,c), escolhidas pela lista de coleções, que é quem sabe quais
 * pertencem à disciplina; `nome` só rotula a tela. Sem limite diário de novos: quem escolhe a
 * disciplina inteira não é contido por ele.
 */
export function DisciplineStudy() {
  const [params] = useSearchParams();
  const ids = (params.get('ids') ?? '').split(',').filter(Boolean);
  const name = params.get('nome')?.trim() || 'Disciplina';
  // Vindo da página de um concurso, o "voltar" leva de volta a ela.
  const returnTo = safeReturnPath(params.get('voltar'));

  if (ids.length === 0) {
    return (
      <div className="mx-auto max-w-xl">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Nenhuma coleção foi escolhida para estudar.</p>
        <Link to={returnTo ?? '/colecoes'} className="btn-secondary mt-4 inline-flex">
          {returnTo ? 'Voltar ao concurso' : 'Voltar às coleções'}
        </Link>
      </div>
    );
  }

  return (
    <ReviewSession
      // Uma sessão nova por disciplina: trocar de disciplina no endereço recomeça a fila.
      key={ids.join(',')}
      fetchQueue={() => flashcardsApi.dueForCollections(ids)}
      loadErrorMessage="Não foi possível carregar os flashcards desta disciplina."
      backTo={returnTo ?? '/colecoes'}
      backLabel={returnTo ? `Concurso · ${name}` : `Coleções · ${name}`}
      emptyIcon={CheckCircle2}
      emptyTitle="Tudo em dia!"
      emptyMessage={`Nenhum flashcard pendente de revisão em ${name} agora.`}
      completedTitle="Disciplina revisada!"
    />
  );
}
