import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Droplets, Loader2, PlayCircle } from 'lucide-react';

import { LeechItem } from '../components/leeches/LeechItem';
import { ResultLegend } from '../components/leeches/ResultDots';
import { RewriteCardModal } from '../components/leeches/RewriteCardModal';
import { SplitCardModal } from '../components/leeches/SplitCardModal';
import { useToast } from '../contexts/ToastContext';
import { ApiError, leechesApi } from '../services/api';
import type { LeechList } from '../types';
import { DEFAULT_MIN_ERRORS, MIN_ERRORS_CHOICES, type SnoozeDays } from '../utils/leeches';
import { plural } from '../utils/performance';

type Dialog = { kind: 'rewrite' | 'split'; id: string } | null;

function parseMin(raw: string | null): number {
  const n = Number(raw);
  return (MIN_ERRORS_CHOICES as readonly number[]).includes(n) ? n : DEFAULT_MIN_ERRORS;
}

/**
 * Cartões sanguessuga: os que você erra sempre. Gastam revisão sem fixar, então ficam aqui separados, com o que
 * costuma resolver: reescrever (com um macete), quebrar em cartões menores, adiar a revisão ou recomeçar a contagem.
 * Nada muda sozinho: cada ação é um clique seu.
 */
export function Leeches() {
  const { showToast } = useToast();
  const [params, setParams] = useSearchParams();
  const minErrors = parseMin(params.get('min'));
  const [data, setData] = useState<LeechList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    leechesApi
      .list(minErrors)
      .then(setData)
      .catch(() => setError('Não foi possível carregar os cartões sanguessuga.'));
  }, [minErrors]);

  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  const removeLocally = (id: string) =>
    setData((current) => (current ? { ...current, total: Math.max(0, current.total - 1), leeches: current.leeches.filter((l) => l.flashcard.id !== id) } : current));

  async function run(id: string, action: () => Promise<void>) {
    setBusyId(id);
    try {
      await action();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Não foi possível concluir a ação.', 'error');
    } finally {
      setBusyId(null);
    }
  }

  const snooze = (id: string, days: SnoozeDays) =>
    run(id, async () => {
      const { dueAt } = await leechesApi.snooze(id, days);
      setData((current) =>
        current
          ? {
              ...current,
              leeches: current.leeches.map((l) => (l.flashcard.id === id ? { ...l, snoozed: true, snoozedUntil: dueAt, flashcard: { ...l.flashcard, dueAt } } : l)),
            }
          : current,
      );
      showToast(`Revisão adiada por ${days} dias.`);
    });

  const reset = (id: string) =>
    run(id, async () => {
      await leechesApi.reset(id);
      removeLocally(id);
      showToast('Contagem recomeçada: o cartão sai da lista e só volta se você errar de novo.');
    });

  const selected = dialog ? data?.leeches.find((l) => l.flashcard.id === dialog.id)?.flashcard : undefined;
  const reviewable = data ? data.leeches.filter((l) => !l.snoozed).length : 0;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <Link to="/desempenho" className="text-xs text-neutral-500 hover:underline dark:text-neutral-400">
          ← Meu desempenho
        </Link>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold text-neutral-900 dark:text-neutral-100">
          <Droplets size={24} className="text-red-500" />
          Cartões sanguessuga
        </h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          São os cartões que você marcou <strong>Errei</strong> {minErrors} vezes ou mais nas últimas {data?.window ?? 10} revisões e ainda não acertou{' '}
          {data?.streakToLeave ?? 3} seguidas. Eles gastam revisão sem fixar: o que costuma resolver é deixar o cartão mais claro, quebrá-lo em cartões menores ou criar um macete.
          Nada muda sozinho.
        </p>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <label className="label-field" htmlFor="leech-min">
            Considerar sanguessuga quem errou
          </label>
          <select id="leech-min" className="input-field !w-auto" value={minErrors} onChange={(e) => setParams(e.target.value === String(DEFAULT_MIN_ERRORS) ? {} : { min: e.target.value })}>
            {MIN_ERRORS_CHOICES.map((n) => (
              <option key={n} value={n}>
                {n} vezes ou mais
              </option>
            ))}
          </select>
        </div>
        {reviewable > 0 && (
          <Link to={`/sanguessugas/revisar?min=${minErrors}`} className="btn-primary">
            <PlayCircle size={16} />
            Revisar {plural(reviewable, 'cartão', 'cartões')} agora
          </Link>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!data && !error && (
        <p className="flex items-center gap-2 text-sm text-neutral-400 dark:text-neutral-500">
          <Loader2 size={16} className="animate-spin" />
          Carregando...
        </p>
      )}

      {data && data.leeches.length === 0 && (
        <div className="card flex items-start gap-3 p-6 text-sm text-neutral-600 dark:text-neutral-300">
          <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-emerald-500" />
          <p>
            Nenhum cartão sanguessuga agora. Quem erra {minErrors} vezes ou mais nas últimas {data.window} revisões aparece aqui; e sai sozinho depois de {data.streakToLeave}{' '}
            acertos seguidos. {minErrors > 2 && 'Dá para baixar o número de erros acima para ver os que estão no caminho.'}
          </p>
        </div>
      )}

      {data && data.leeches.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-neutral-600 dark:text-neutral-300">
              {plural(data.total, 'cartão', 'cartões')}
              {data.total > data.leeches.length && ` (os ${data.leeches.length} que mais erram)`}, dos que mais erram aos que menos.
            </p>
            <ResultLegend />
          </div>
          <ul className="space-y-3">
            {data.leeches.map((leech) => (
              <LeechItem
                key={leech.flashcard.id}
                leech={leech}
                streakToLeave={data.streakToLeave}
                busy={busyId === leech.flashcard.id}
                onRewrite={() => setDialog({ kind: 'rewrite', id: leech.flashcard.id })}
                onSplit={() => setDialog({ kind: 'split', id: leech.flashcard.id })}
                onSnooze={(days) => snooze(leech.flashcard.id, days)}
                onReset={() => reset(leech.flashcard.id)}
              />
            ))}
          </ul>
        </>
      )}

      {dialog?.kind === 'rewrite' && selected && (
        <RewriteCardModal
          card={selected}
          onClose={() => setDialog(null)}
          onSaved={() => {
            removeLocally(selected.id);
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === 'split' && selected && (
        <SplitCardModal
          card={selected}
          onClose={() => setDialog(null)}
          onDone={() => {
            // Com o original apagado ele some da lista; mantido, a contagem recomeçou e ele também sai.
            removeLocally(selected.id);
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}
