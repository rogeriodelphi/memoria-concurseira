import { useCallback, useRef, useState } from 'react';

import { useToast } from '../contexts/ToastContext';
import { ApiError, flashcardsApi } from '../services/api';
import type { Flashcard, StudyResult } from '../types';
import {
  lastEntry,
  newSession,
  patchCard,
  rateCurrent,
  skipCurrent,
  undoLast,
  type SessionState,
} from '../utils/studySession';

/**
 * Uma sessão de estudo: a fila de cartões e o que o usuário faz com o cartão da vez —
 * avaliar, pular, voltar ao anterior, favoritar, editar. Comum às telas que estudam uma
 * coleção, a revisão global e os favoritos; cada uma só decide de onde vêm os cartões.
 */
export function useStudySession<T extends Flashcard>() {
  const { showToast } = useToast();
  const [session, setSession] = useState<SessionState<T> | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  // Um clique só vale se o anterior já terminou: avaliar duas vezes o mesmo cartão (clique
  // duplo) gravaria duas revisões, e voltar no meio de uma avaliação desfaria a errada.
  const busyRef = useRef(false);

  const current = session?.queue[0] ?? null;

  /** Começa (ou recomeça) a sessão com esta fila. */
  const start = useCallback((queue: T[]) => {
    setSession(newSession(queue));
    setRevealed(false);
  }, []);

  async function withBusy(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await action();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function rate(result: StudyResult, durationMs: number) {
    if (!current) return;
    const card = current;
    await withBusy(async () => {
      // Falhar em gravar não trava o estudo (é assim desde sempre); sem `sessionId`,
      // só não há o que desfazer no servidor.
      const saved = await flashcardsApi.study(card.id, result, durationMs).catch(() => null);
      setSession((s) => (s ? rateCurrent(s, result, saved?.sessionId ?? null) : s));
      setRevealed(false);
    });
  }

  /** Tira o cartão desta sessão sem avaliar: nada é gravado, e ele continua pendente. */
  function skip() {
    if (!current || busyRef.current) return;
    setSession((s) => (s ? skipCurrent(s) : s));
    setRevealed(false);
  }

  /** Volta ao cartão anterior; se ele tinha sido avaliado, a avaliação é desfeita. */
  async function back() {
    if (!session) return;
    const entry = lastEntry(session);
    if (!entry) return;
    await withBusy(async () => {
      if (entry.kind === 'rate' && entry.sessionId) {
        try {
          await flashcardsApi.undoStudy(entry.card.id, entry.sessionId);
        } catch (err) {
          showToast(err instanceof ApiError ? err.message : 'Não foi possível voltar ao cartão anterior.', 'error');
          return;
        }
      }
      setSession((s) => (s ? undoLast(s) : s));
      setRevealed(false);
    });
  }

  // Troca só os campos devolvidos pelo servidor; o resto do cartão na fila
  // (posição, favorito em andamento) fica como está.
  function handleUpdated(updated: Flashcard) {
    setSession((s) => (s ? patchCard(s, updated.id, updated as unknown as Partial<T>) : s));
  }

  async function toggleFavorite() {
    if (!current) return;
    const { id } = current;
    const nextFavorite = !current.favorite;
    setSession((s) => (s ? patchCard(s, id, { favorite: nextFavorite } as Partial<T>) : s));
    try {
      await flashcardsApi.update(id, { favorite: nextFavorite });
    } catch {
      setSession((s) => (s ? patchCard(s, id, { favorite: !nextFavorite } as Partial<T>) : s));
    }
  }

  return {
    session,
    current,
    revealed,
    reveal: () => setRevealed(true),
    busy,
    start,
    rate,
    skip,
    back,
    canGoBack: !!session && lastEntry(session) !== null,
    handleUpdated,
    toggleFavorite,
  };
}
