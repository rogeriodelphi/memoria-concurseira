import { useEffect, useState, type FormEvent } from 'react';

import { ApiError, aiUsageApi } from '../services/api';
import { useAiUsage } from '../hooks/useAiUsage';
import { useToast } from '../contexts/ToastContext';
import type { AiProviderStatus, AiUsageTotals } from '../types';
import { FEATURE_LABEL, PROVIDER_LABEL, STATUS_LABEL, formatRelativeTime, formatTokens } from '../utils/aiUsage';

function TotalsTile({ label, totals }: { label: string; totals: AiUsageTotals }) {
  return (
    <div className="rounded-xl bg-neutral-50 p-4 dark:bg-neutral-800/60">
      <p className="text-xs text-neutral-500 dark:text-neutral-400">{label}</p>
      <p className="mt-1 text-xl font-bold text-neutral-900 dark:text-neutral-100">{formatTokens(totals.tokens)}</p>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        tokens · {totals.requests} geraç{totals.requests === 1 ? 'ão' : 'ões'}
      </p>
    </div>
  );
}

const STATUS_BADGE: Record<AiProviderStatus, string> = {
  ok: 'bg-brand-100 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300',
  quota_exhausted: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  no_credits: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  rate_limited: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  invalid_key: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  unavailable: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
};

export function AiUsagePanel() {
  const { usage } = useAiUsage();
  const { showToast } = useToast();
  const [budgetInput, setBudgetInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [budgetError, setBudgetError] = useState<string | null>(null);

  // Só sincroniza o campo quando o orçamento salvo muda de fato — os
  // recarregamentos por causa de novas gerações não podem apagar o que o
  // usuário está digitando.
  useEffect(() => {
    setBudgetInput(usage?.budget != null ? String(usage.budget) : '');
  }, [usage?.budget]);

  async function saveBudget(e: FormEvent) {
    e.preventDefault();
    const cleaned = budgetInput.trim().replace(/\./g, '');
    let value: number | null = null;
    if (cleaned) {
      value = Number(cleaned);
      if (!Number.isInteger(value) || value < 1) {
        setBudgetError('Informe um número inteiro de tokens maior que zero (ex.: 500000).');
        return;
      }
    }
    setSaving(true);
    setBudgetError(null);
    try {
      await aiUsageApi.setBudget(value);
      showToast(value === null ? 'Orçamento removido.' : 'Orçamento salvo.');
    } catch (err) {
      setBudgetError(err instanceof ApiError ? err.message : 'Não foi possível salvar o orçamento.');
    } finally {
      setSaving(false);
    }
  }

  const maxFeatureTokens = Math.max(...(usage?.byFeature.map((f) => f.tokens) ?? [0]), 1);
  const pct = usage?.budget ? Math.round((usage.month.tokens / usage.budget) * 100) : null;
  const barColor = pct === null ? '' : pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-brand-500';

  return (
    <div id="uso-ia" className="card mt-6 p-6">
      <h2 className="mb-1 text-sm font-semibold text-neutral-900 dark:text-neutral-100">Uso de IA</h2>
      <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
        Tokens consumidos pelas gerações feitas neste app (flashcards, resumos, bullet points, mapas mentais e
        transcrição), somando todos os provedores. Isso é o consumo registrado aqui — não o saldo real das suas
        contas.
      </p>

      {!usage ? (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">Carregando...</p>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3">
            <TotalsTile label="Hoje" totals={usage.today} />
            <TotalsTile label="Este mês" totals={usage.month} />
          </div>

          <form onSubmit={saveBudget}>
            <label className="label-field" htmlFor="token-budget">
              Orçamento mensal de tokens (opcional)
            </label>
            <div className="flex gap-2">
              <input
                id="token-budget"
                type="text"
                inputMode="numeric"
                className="input-field"
                placeholder="Ex.: 500000 — deixe em branco para não usar orçamento"
                value={budgetInput}
                onChange={(e) => setBudgetInput(e.target.value)}
              />
              <button type="submit" disabled={saving} className="btn-secondary shrink-0">
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
            {budgetError && <p className="mt-2 text-xs text-red-600">{budgetError}</p>}
            {usage.budget !== null && pct !== null && (
              <div className="mt-3">
                <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                  <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                </div>
                <p className="mt-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                  {formatTokens(usage.month.tokens)} de {formatTokens(usage.budget)} usados ({pct}%) ·{' '}
                  <span className="font-medium text-neutral-700 dark:text-neutral-300">
                    {formatTokens(usage.remaining ?? 0)} restantes
                  </span>
                </p>
              </div>
            )}
            <p className="mt-2 text-xs text-neutral-400 dark:text-neutral-500">
              É só um guia seu: o app mostra quanto falta, mas nunca bloqueia uma geração.
            </p>
          </form>

          <div>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
              Este mês, por tipo
            </h3>
            <div className="space-y-3">
              {usage.byFeature.map((f) => (
                <div key={f.feature}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-medium text-neutral-800 dark:text-neutral-200">
                      {FEATURE_LABEL[f.feature]}
                    </span>
                    <span className="text-xs text-neutral-500 dark:text-neutral-400">
                      {formatTokens(f.tokens)} tokens · {f.requests} geraç{f.requests === 1 ? 'ão' : 'ões'}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                    <div
                      className="h-full rounded-full bg-brand-500"
                      style={{ width: `${(f.tokens / maxFeatureTokens) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
              Provedores
            </h3>
            <div className="space-y-2">
              {usage.providers.map((p) => {
                const used = usage.byProvider.find((b) => b.provider === p.provider);
                return (
                  <div
                    key={p.provider}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-neutral-200 px-3 py-2.5 dark:border-neutral-700"
                  >
                    <div>
                      <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
                        {PROVIDER_LABEL[p.provider]}
                      </p>
                      <p className="text-xs text-neutral-500 dark:text-neutral-400">
                        {formatTokens(used?.tokens ?? 0)} tokens no mês · {used?.requests ?? 0} geraç
                        {(used?.requests ?? 0) === 1 ? 'ão' : 'ões'}
                      </p>
                    </div>
                    {!p.configured ? (
                      <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                        Não configurado
                      </span>
                    ) : p.status === null || p.updatedAt === null ? (
                      <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                        Sem chamadas ainda
                      </span>
                    ) : (
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_BADGE[p.status]}`}>
                        {STATUS_LABEL[p.status]} · {formatRelativeTime(p.updatedAt)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-neutral-400 dark:text-neutral-500">
              O status é o resultado da última chamada feita a cada provedor. Para ver o saldo real: OpenAI em{' '}
              <a
                href="https://platform.openai.com/usage"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-600 hover:underline dark:text-brand-400"
              >
                platform.openai.com/usage
              </a>{' '}
              , Gemini em{' '}
              <a
                href="https://ai.dev/rate-limit"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-600 hover:underline dark:text-brand-400"
              >
                ai.dev/rate-limit
              </a>{' '}
              e Claude em{' '}
              <a
                href="https://console.anthropic.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-600 hover:underline dark:text-brand-400"
              >
                console.anthropic.com
              </a>
              .
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
