import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Loader2 } from 'lucide-react';

import { useToast } from '../../contexts/ToastContext';
import { ApiError, collectionsApi } from '../../services/api';
import { questionBankApi } from '../../services/questionBankApi';
import type { CollectionSummary, QbCardsResult, QbFilter } from '../../types';
import { Modal } from './Modal';

/** O nome da coleção que recebe os cartões quando o usuário não escolhe outra (o servidor usa o mesmo). */
export const DEFAULT_COLLECTION_NAME = 'Erros do banco de questões';
const NEW = '__new__';

export type CardsTarget = { questionIds: string[] } | { filter: QbFilter };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * "Criar cartão" a partir de uma questão, ou "Criar cartões das que errei" de um filtro ou de um simulado: o
 * enunciado e as alternativas na frente, o gabarito (com o comentário, se houver) no verso. Entram na revisão
 * espaçada como qualquer cartão; o usuário escolhe a coleção, ou deixa que uma nova seja criada.
 */
export function CardsFromQuestionsModal({
  target,
  onClose,
  onDone,
}: {
  target: CardsTarget;
  onClose: () => void;
  onDone?: (result: QbCardsResult) => void;
}) {
  const { showToast } = useToast();
  const [collections, setCollections] = useState<CollectionSummary[] | null>(null);
  const [choice, setChoice] = useState(NEW);
  const [name, setName] = useState(DEFAULT_COLLECTION_NAME);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<QbCardsResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    collectionsApi
      .list()
      .then((r) => setCollections(r.collections))
      .catch(() => setCollections([]));
  }, []);

  const isFilter = 'filter' in target;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const destination = choice === NEW ? { collectionName: name } : { collectionId: choice };
      const created = await questionBankApi.createCards({ ...('filter' in target ? { filter: target.filter } : { questionIds: target.questionIds }), ...destination });
      setResult(created);
      onDone?.(created);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Não foi possível criar os cartões.';
      setError(message);
      showToast(message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <Modal title={result.created > 0 ? 'Cartões criados' : 'Nada a criar'} onClose={onClose}>
        <div className="space-y-3 text-sm text-neutral-700 dark:text-neutral-300">
          <p className="flex items-start gap-2 font-semibold text-brand-700 dark:text-brand-300">
            <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
            {result.created > 0
              ? `${plural(result.created, 'cartão criado', 'cartões criados')} na coleção “${result.collection.name}”${result.collection.created ? ' (nova)' : ''}.`
              : 'Nenhum cartão novo: as questões já tinham cartão.'}
          </p>
          {result.alreadyHad > 0 && result.created > 0 && <p>{plural(result.alreadyHad, 'questão já tinha cartão', 'questões já tinham cartão')} e foi pulada.</p>}
          {result.skipped > 0 && <p>{plural(result.skipped, 'questão não pôde virar cartão', 'questões não puderam virar cartão')} (sem gabarito, anulada ou ainda não respondida).</p>}
          <p className="text-neutral-500 dark:text-neutral-400">Os cartões novos entram na fila de revisão como qualquer cartão sem estudo.</p>
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Fechar
            </button>
            <Link to={`/colecoes/${result.collection.id}`} className="btn-primary">
              Abrir a coleção
            </Link>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Criar cartões de revisão" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          {isFilter
            ? 'Cria um cartão para cada questão que você errou entre as do filtro aplicado (até 100 por vez; as que já têm cartão são puladas).'
            : 'A questão vira um cartão de revisão (as que você já respondeu).'}{' '}
          O enunciado e as alternativas ficam na frente; o gabarito, o gabarito comentado (se houver) e a fonte, no verso.
        </p>
        <div>
          <label className="label-field" htmlFor="cd-collection">Em qual coleção?</label>
          <select id="cd-collection" className="input-field" value={choice} onChange={(e) => setChoice(e.target.value)} disabled={collections === null}>
            <option value={NEW}>Uma coleção nova (ou a que já tiver o nome abaixo)</option>
            {(collections ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        {choice === NEW && (
          <div>
            <label className="label-field" htmlFor="cd-name">Nome da coleção</label>
            <input id="cd-name" className="input-field" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={busy || (choice === NEW && name.trim().length < 2)}>
            {busy && <Loader2 size={16} className="animate-spin" />}
            Criar cartões
          </button>
        </div>
      </form>
    </Modal>
  );
}
