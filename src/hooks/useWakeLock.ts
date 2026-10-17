import { useEffect } from 'react';

/**
 * Mantém a tela ligada enquanto `active` (se o navegador permitir). No celular, a voz do navegador
 * costuma parar quando a tela apaga, então o modo mãos livres pede isto enquanto toca. Sem suporte
 * (ou com o pedido negado, por bateria fraca, por exemplo), nada acontece: o app segue sem isso.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let leaving = false;

    async function acquire() {
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (leaving) {
          await lock.release().catch(() => {});
          return;
        }
        sentinel = lock;
      } catch {
        // negado: segue sem manter a tela ligada
      }
    }

    void acquire();

    // O navegador solta o bloqueio quando a aba some da tela; ao voltar, pede de novo.
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && (!sentinel || sentinel.released)) void acquire();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      leaving = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void sentinel?.release().catch(() => {});
    };
  }, [active]);
}
