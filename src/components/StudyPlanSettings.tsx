import { useEffect, useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';

import { useToast } from '../contexts/ToastContext';
import { ApiError, statsApi, studyPlanApi } from '../services/api';

const PRESETS = [10, 20, 30, 50];

/** Texto do campo para o número salvo: vazio quer dizer "sem limite". */
const asField = (limit: number | null) => (limit === null ? '' : String(limit));

/**
 * O limite diário de cartões novos na fila de revisão. Só os cartões que você nunca estudou são
 * limitados; as revisões dos que já estudou entram todas. Vazio = sem limite (o jeito de sempre).
 */
export function StudyPlanSettings() {
  const { showToast } = useToast();
  const [saved, setSaved] = useState<number | null | undefined>(undefined); // undefined = ainda carregando
  const [draft, setDraft] = useState('');
  const [newTotal, setNewTotal] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    studyPlanApi
      .get()
      .then(({ dailyNewLimit }) => {
        setSaved(dailyNewLimit);
        setDraft(asField(dailyNewLimit));
      })
      .catch(() => setError('Não foi possível carregar o limite.'));
    // Quantos cartões novos existem no total, para estimar em quantos dias o limite os esgota.
    statsApi
      .dashboard()
      .then((d) => setNewTotal(d.remaining.new + d.remaining.newWaiting))
      .catch(() => {});
  }, []);

  const draftNumber = draft.trim() === '' ? null : Number(draft);
  const dirty = saved !== undefined && draftNumber !== saved;
  const estimateDays =
    draftNumber !== null && draftNumber > 0 && newTotal !== null && newTotal > 0 ? Math.ceil(newTotal / draftNumber) : null;

  async function save(event?: FormEvent, value: number | null = draftNumber) {
    event?.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const { dailyNewLimit } = await studyPlanApi.setDailyNewLimit(value);
      setSaved(dailyNewLimit);
      setDraft(asField(dailyNewLimit));
      showToast(dailyNewLimit === null ? 'Limite diário removido.' : 'Limite diário salvo.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar o limite.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card mt-6 p-6">
      <h2 className="mb-1 text-sm font-semibold text-neutral-900 dark:text-neutral-100">Plano de estudo</h2>
      <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
        Novos cartões por dia: o máximo de cartões que você ainda não estudou que entram na revisão de cada dia. As
        revisões dos cartões que você já estudou não são limitadas. Deixe em branco para não limitar.
      </p>

      <form onSubmit={save} className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label-field" htmlFor="daily-new-limit">
            Novos por dia
          </label>
          <input
            id="daily-new-limit"
            type="number"
            inputMode="numeric"
            min={0}
            max={1000}
            step={1}
            className="input-field w-40"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Sem limite"
            disabled={saved === undefined}
          />
        </div>
        <button type="submit" className="btn-primary" disabled={!dirty || saving}>
          {saving ? <Loader2 size={16} className="animate-spin" /> : null}
          Salvar
        </button>
        {saved !== undefined && saved !== null && (
          <button type="button" className="btn-secondary" disabled={saving} onClick={() => void save(undefined, null)}>
            Remover limite
          </button>
        )}
      </form>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-neutral-400 dark:text-neutral-500">Sugestões:</span>
        {PRESETS.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setDraft(String(n))}
            className="rounded-full border border-neutral-200 px-2.5 py-0.5 text-xs font-medium text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            {n}
          </button>
        ))}
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {estimateDays !== null && !error && (
        <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
          Você tem {newTotal!.toLocaleString('pt-BR')} cartões novos: com {draftNumber} por dia, termina de ver todos em cerca de{' '}
          {estimateDays.toLocaleString('pt-BR')} {estimateDays === 1 ? 'dia' : 'dias'}.
        </p>
      )}
      {draftNumber === 0 && !error && (
        <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
          Com 0, nenhum cartão novo entra na revisão: só as revisões dos que você já estudou.
        </p>
      )}
    </div>
  );
}
