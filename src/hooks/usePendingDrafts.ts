import { useCallback, useEffect, useState } from 'react';

import { aiReviewApi } from '../services/api';

/** A tela de conferência avisa o menu (e quem mais quiser) quando a quantidade muda. */
export const DRAFTS_CHANGED_EVENT = 'ai-drafts-changed';

/**
 * Quantos cartões da IA esperam conferência (`0` enquanto carrega ou se não for possível saber): alimenta o
 * selo do menu. Atualiza ao trocar de tela e quando a tela de conferência muda a conta.
 */
export function usePendingDrafts(refreshKey?: string): number {
  const [pending, setPending] = useState(0);
  const load = useCallback(() => {
    aiReviewApi
      .count()
      .then((r) => setPending(r.pending))
      .catch(() => {});
  }, []);
  useEffect(() => {
    load();
  }, [load, refreshKey]);
  useEffect(() => {
    window.addEventListener(DRAFTS_CHANGED_EVENT, load);
    return () => window.removeEventListener(DRAFTS_CHANGED_EVENT, load);
  }, [load]);
  return pending;
}
