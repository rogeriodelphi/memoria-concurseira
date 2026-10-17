import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

import { useToast } from '../contexts/ToastContext';
import { ApiError, studyPlanApi } from '../services/api';
import type { NewCardOrder, NewOrderOverview } from '../types';
import { formatExamDate } from '../utils/exam';

const OPTIONS: { value: NewCardOrder; title: string; text: string }[] = [
  { value: 'created', title: 'Pela ordem de criação', text: 'Os mais antigos primeiro. É como sempre foi.' },
  { value: 'exam', title: 'Pelo edital da prova', text: 'Repartidos pelo peso das disciplinas da prova mais próxima.' },
];

const int = (n: number) => n.toLocaleString('pt-BR');
const pct = (n: number | null) => (n === null ? '—' : `${n}%`);

/**
 * Em que ordem os cartões novos entram na revisão quando há limite diário. O padrão é a ordem de criação;
 * "pelo edital" reparte as vagas do dia entre as disciplinas do concurso na proporção do peso de cada uma,
 * descontando o que você já estudou. Sem limite diário, todos os novos entram e a ordem não muda nada.
 */
export function NewCardOrderSettings() {
  const { showToast } = useToast();
  const [overview, setOverview] = useState<NewOrderOverview | null>(null);
  const [saving, setSaving] = useState<NewCardOrder | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      studyPlanApi
        .newOrder()
        .then(setOverview)
        .catch(() => setError('Não foi possível carregar a ordem dos cartões novos.')),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);

  async function choose(order: NewCardOrder) {
    if (saving || !overview || overview.order === order) return;
    setSaving(order);
    setError(null);
    try {
      await studyPlanApi.setNewOrder(order);
      await load();
      showToast(order === 'exam' ? 'Os cartões novos agora entram pelo edital.' : 'Os cartões novos voltaram à ordem de criação.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar a ordem.');
    } finally {
      setSaving(null);
    }
  }

  const withoutCards = overview?.disciplines.filter((d) => d.quotaPct === null) ?? [];
  const noDatedExam = overview !== null && (overview.exam === null || overview.disciplines.length === 0);

  return (
    <div className="card mt-6 p-6">
      <h2 className="mb-1 text-sm font-semibold text-neutral-900 dark:text-neutral-100">Ordem dos cartões novos</h2>
      <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
        Com um limite de novos por dia (acima), define quais cartões novos entram primeiro. Sem limite, todos entram e a
        ordem não muda nada.
      </p>

      <div role="radiogroup" aria-label="Ordem dos cartões novos" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {OPTIONS.map((option) => {
          const active = overview?.order === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={!overview || saving !== null}
              onClick={() => void choose(option.value)}
              className={`flex flex-col items-start gap-1 rounded-lg border px-4 py-3 text-left text-sm transition-colors ${
                active
                  ? 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-500 dark:bg-brand-950/40 dark:text-brand-300'
                  : 'border-neutral-200 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800'
              }`}
            >
              <span className="flex items-center gap-2 font-medium">
                {saving === option.value && <Loader2 size={14} className="animate-spin" />}
                {option.title}
              </span>
              <span className="text-xs font-normal opacity-80">{option.text}</span>
            </button>
          );
        })}
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {noDatedExam && (
        <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">
          Para a ordem pelo edital funcionar, um concurso precisa ter a data da prova e as disciplinas no edital. Enquanto
          isso, vale a ordem de criação.{' '}
          <Link to="/concursos" className="font-medium underline">
            Ver concursos
          </Link>
        </p>
      )}

      {overview?.exam && (
        <div className="mt-4">
          <p className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">
            {overview.order === 'exam' ? 'Como os novos são repartidos' : 'Como ficaria a divisão pelo edital'} ·{' '}
            <Link to={`/concursos/${overview.exam.id}`} className="font-medium hover:text-brand-600 hover:underline">
              {overview.exam.name}
            </Link>{' '}
            ({formatExamDate(overview.exam.examDate)})
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-neutral-500 dark:text-neutral-400">
                <tr>
                  <th className="py-1.5 pr-2 font-medium">Disciplina</th>
                  <th className="px-2 py-1.5 text-right font-medium" title="O peso da disciplina na prova, entre as que têm cartões.">
                    Cota
                  </th>
                  <th className="px-2 py-1.5 text-right font-medium" title="Que parte dos cartões que você já estudou é desta disciplina.">
                    Estudado
                  </th>
                  <th className="py-1.5 pl-2 text-right font-medium">Novos</th>
                </tr>
              </thead>
              <tbody className="text-neutral-700 dark:text-neutral-300">
                {overview.disciplines.map((d) => (
                  <tr key={d.id} className="border-t border-neutral-100 dark:border-neutral-800">
                    <td className="py-1.5 pr-2 font-medium">{d.name}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{pct(d.quotaPct)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {pct(d.learnedSharePct)}
                      {d.learnedSharePct !== null && <span className="ml-1 text-neutral-400">({int(d.learnedCards)})</span>}
                    </td>
                    <td className="py-1.5 pl-2 text-right tabular-nums">{int(d.newCards)}</td>
                  </tr>
                ))}
                {overview.unlinkedNew > 0 && (
                  <tr className="border-t border-neutral-100 text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                    <td className="py-1.5 pr-2">Fora do edital (entram por último)</td>
                    <td className="px-2 py-1.5 text-right">—</td>
                    <td className="px-2 py-1.5 text-right">—</td>
                    <td className="py-1.5 pl-2 text-right tabular-nums">{int(overview.unlinkedNew)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-neutral-400 dark:text-neutral-500">
            A cada vaga do dia entra um cartão da disciplina que está mais abaixo da sua cota, contando o que você já
            estudou: a que pesa mais na prova e está mais atrasada vem primeiro.
            {withoutCards.length > 0 &&
              ` Sem cartões ligados: ${withoutCards.map((d) => d.name).join(', ')}. ${withoutCards.length === 1 ? 'Ela só entra' : 'Elas só entram'} na divisão quando você ligar uma coleção ${withoutCards.length === 1 ? 'a ela' : 'a elas'} no edital.`}
          </p>
        </div>
      )}
    </div>
  );
}
