import { useState, type ReactNode } from 'react';
import { Loader2, Sparkles, X } from 'lucide-react';

import { useToast } from '../../contexts/ToastContext';
import { ApiError, leechesApi } from '../../services/api';
import type { LeechSuggestion } from '../../types';

/**
 * Pede à IA a sugestão para um cartão sanguessuga (diagnóstico, macete, divisão) e a guarda. Quem abre a página
 * guarda a resposta por cartão (`cached`/`onCache`): o modal "Reescrever" e o "Quebrar" usam a mesma, e a IA só é
 * chamada uma vez por cartão. A IA só propõe: nada é aplicado sem o usuário clicar em "Usar".
 */
export function useLeechSuggestion(cardId: string, cached: LeechSuggestion | undefined, onCache: (suggestion: LeechSuggestion) => void) {
  const { showToast } = useToast();
  const [suggestion, setSuggestion] = useState<LeechSuggestion | undefined>(cached);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  async function ask() {
    if (loading) return;
    setDismissed(false);
    if (suggestion) return; // já veio: só volta a mostrar
    setLoading(true);
    setError(null);
    try {
      const { suggestion: received } = await leechesApi.suggest(cardId);
      setSuggestion(received);
      onCache(received);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Não foi possível gerar a sugestão.';
      setError(message);
      showToast(message, 'error');
    } finally {
      setLoading(false);
    }
  }

  return { suggestion: dismissed ? undefined : suggestion, loading, error, ask, dismiss: () => setDismissed(true) };
}

/** O botão que pede a sugestão. */
export function SuggestButton({ label, loading, disabled, onClick }: { label: string; loading: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" className="btn-secondary !py-1.5 text-xs" disabled={loading || disabled} onClick={onClick}>
      {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
      {loading ? 'A IA está pensando...' : label}
    </button>
  );
}

/** A moldura de uma sugestão da IA: o diagnóstico, o que ela propõe e o aviso de que é só uma proposta. */
export function SuggestionFrame({ diagnosis, onDismiss, children }: { diagnosis: string; onDismiss: () => void; children: ReactNode }) {
  return (
    <div className="mt-2 rounded-xl border border-brand-200 bg-brand-50/60 p-3 text-sm dark:border-brand-900 dark:bg-brand-950/30" role="region" aria-label="Sugestão da IA">
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">
          <Sparkles size={12} />
          Sugestão da IA
        </p>
        <button type="button" className="rounded p-0.5 text-neutral-400 hover:text-neutral-600" onClick={onDismiss} aria-label="Fechar a sugestão" title="Descartar">
          <X size={14} />
        </button>
      </div>
      {diagnosis && (
        <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-300">
          <span className="font-medium">Por que é difícil:</span> {diagnosis}
        </p>
      )}
      <div className="mt-2 space-y-2">{children}</div>
      <p className="mt-2 text-[11px] text-neutral-500 dark:text-neutral-400">A IA só reorganiza o que o cartão já diz. Confira antes de usar: nada é aplicado sem o seu clique.</p>
    </div>
  );
}
