import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Target } from 'lucide-react';

import { useToast } from '../contexts/ToastContext';
import { ApiError, studyPlanApi } from '../services/api';
import type { ExamPlan } from '../types';
import { formatExamDate } from '../utils/exam';
import {
  cardsPerDayLabel,
  chartBars,
  formatMinutes,
  newOrderHint,
  scenarioLabel,
  scenarioSummary,
  verdictMessage,
  VERDICT_LABEL,
  type VerdictTone,
} from '../utils/examPlan';

const TONE_CLASS: Record<VerdictTone, string> = {
  green: 'bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300',
  amber: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  red: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  neutral: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300',
};

const int = (n: number) => Math.round(n).toLocaleString('pt-BR');

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-neutral-50 px-3 py-2.5 dark:bg-neutral-800/50">
      <p className="text-[11px] text-neutral-500 dark:text-neutral-400">{label}</p>
      <p className="mt-0.5 text-lg font-bold text-neutral-900 dark:text-neutral-100">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-neutral-400 dark:text-neutral-500">{sub}</p>}
    </div>
  );
}

/**
 * "Meta para a prova": quanto falta, quanto há para estudar e o que cada tempo diário cobre. O cálculo é
 * do servidor; aqui o usuário compara os cenários e, se quiser, aplica o limite diário de novos de um deles.
 * Some sozinho se não há concurso com data (ou se não carrega): o Painel não depende dele.
 */
export function ExamPlanCard({ onLimitChanged }: { onLimitChanged?: () => void }) {
  const { showToast } = useToast();
  const [plan, setPlan] = useState<ExamPlan | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(
    () =>
      studyPlanApi
        .exam()
        .then(({ plan: loaded }) => setPlan(loaded))
        .catch(() => setPlan(null)),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);

  if (!plan) return null;

  const { exam, pace, cards } = plan;
  const verdict = VERDICT_LABEL[plan.verdict];
  const hasChoices = plan.neededNewPerDay !== null && plan.scenarios.length > 0;
  const index = Math.min(selected ?? plan.scenarios.length - 1, plan.scenarios.length - 1);
  const chosen = plan.scenarios[index];
  const bars = chosen ? chartBars(chosen.perDay) : [];
  const peak = Math.max(1, ...bars);
  const inUse = chosen !== undefined && plan.currentLimit === chosen.newPerDay;
  const orderHint = newOrderHint(plan, chosen);

  async function apply(limit: number) {
    setSaving(true);
    try {
      await studyPlanApi.setDailyNewLimit(limit);
      showToast(`Limite diário de cartões novos: ${limit} por dia.`);
      await load();
      onLimitChanged?.();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Não foi possível salvar o limite.', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card mb-6 p-5" aria-label="Meta para a prova">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            <Target size={16} className="text-brand-600 dark:text-brand-400" />
            Meta para a prova
          </h2>
          <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
            <Link to={`/concursos/${exam.id}`} className="font-medium hover:text-brand-600 hover:underline">
              {exam.name}
            </Link>{' '}
            · {formatExamDate(exam.examDate)} ·{' '}
            {exam.daysLeft === 0 ? 'hoje' : exam.daysLeft === 1 ? 'amanhã' : `faltam ${exam.daysLeft} dias`}
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${TONE_CLASS[verdict.tone]}`}>{verdict.label}</span>
      </div>

      {plan.verdict !== 'exam_today' && (
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Tile label="Cartões novos" value={int(cards.new)} sub="nunca estudados" />
          <Tile label="Vencidos" value={int(cards.due)} sub="atrasados e de hoje" />
          <Tile
            label="Seu ritmo"
            value={cardsPerDayLabel(pace.reviewsPerDay)}
            sub={`${pace.secPerReview !== null ? `≈ ${formatMinutes((pace.reviewsPerDay * pace.secPerReview) / 60)} · ` : ''}estudou ${pace.activeDays} dos últimos ${pace.windowDays} dias`}
          />
        </div>
      )}

      <p className="mt-4 text-sm text-neutral-700 dark:text-neutral-300">{verdictMessage(plan)}</p>

      {hasChoices && (
        <>
          <ul className="mt-3 space-y-2" aria-label="Opções de meta">
            {plan.scenarios.map((scenario, i) => {
              const active = i === index;
              return (
                <li key={`${scenario.kind}-${scenario.newPerDay}`}>
                  <button
                    type="button"
                    onClick={() => setSelected(i)}
                    aria-pressed={active}
                    className={`flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border px-3.5 py-2.5 text-left text-sm transition-colors ${
                      active
                        ? 'border-brand-500 bg-brand-50/60 dark:border-brand-500 dark:bg-brand-950/30'
                        : 'border-neutral-200 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800/50'
                    }`}
                  >
                    <span>
                      <span className="font-semibold text-neutral-900 dark:text-neutral-100">{scenarioLabel(scenario, cards.new)}</span>
                      <span className="ml-2 text-xs text-neutral-500 dark:text-neutral-400">
                        ≈ {cardsPerDayLabel(scenario.cardsPerDay)} · {formatMinutes(scenario.minutesPerDay)}
                      </span>
                    </span>
                    <span className="text-xs text-neutral-600 dark:text-neutral-300">{scenarioSummary(scenario, cards.new)}</span>
                  </button>
                </li>
              );
            })}
          </ul>

          {chosen && (
            <div className="mt-4">
              <div className="flex h-16 items-end gap-px" role="img" aria-label="Carga prevista por dia até a prova">
                {bars.map((n, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-t-sm bg-brand-400/80 dark:bg-brand-500/70"
                    style={{ height: `${Math.max(3, (n / peak) * 100)}%` }}
                    title={`${int(n)} cartões`}
                  />
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[11px] text-neutral-400 dark:text-neutral-500">
                <span>hoje</span>
                <span>carga por dia (cartões), até a prova</span>
                <span>prova</span>
              </div>
            </div>
          )}

          {chosen && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {inUse ? (
                <p className="flex items-center gap-1.5 text-sm font-medium text-brand-700 dark:text-brand-300">
                  <Check size={16} />
                  Este limite já está em uso ({chosen.newPerDay} novos por dia).
                </p>
              ) : (
                <button type="button" onClick={() => void apply(chosen.newPerDay)} disabled={saving} className="btn-primary">
                  {saving ? 'Salvando...' : `Usar ${chosen.newPerDay} ${chosen.newPerDay === 1 ? 'novo' : 'novos'} por dia`}
                </button>
              )}
              <span className="text-xs text-neutral-500 dark:text-neutral-400">
                Isso só muda quantos cartões novos entram na revisão por dia (você pode alterar em Configurações).
              </span>
            </div>
          )}

          {orderHint && (
            <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
              {orderHint.text}
              {orderHint.suggestEdital && (
                <>
                  {' '}
                  <Link to="/configuracoes" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
                    Priorizar pelo edital em Configurações
                  </Link>
                  .
                </>
              )}
            </p>
          )}
        </>
      )}

      {plan.verdict !== 'exam_today' && (
        <p className="mt-4 text-[11px] leading-relaxed text-neutral-400 dark:text-neutral-500">
          Estimativa com os seus números dos últimos {pace.windowDays} dias
          {pace.secPerReview !== null ? ` (cerca de ${int(pace.secPerReview)} s por cartão)` : ''}. Supõe que você acerta os cartões e
          que os últimos {plan.finalReviewDays} dias antes da prova são só de revisão; os erros aumentam a carga, por isso o tempo leva
          uma margem de 15%.
        </p>
      )}
    </section>
  );
}
