import { useEffect, useRef } from 'react';

import type { StudyResult } from '../types';
import { studyShortcut } from '../utils/studyKeys';
import { useKeyboardNavigationFlag } from './useKeyboardNavigationFlag';

interface StudyShortcutHandlers {
  /** Desligado (por exemplo, com o cartão em edição) os atalhos não fazem nada. */
  enabled: boolean;
  revealed: boolean;
  canGoBack: boolean;
  /** Uma avaliação está sendo gravada: nada de avaliar, pular ou voltar por cima dela. */
  busy: boolean;
  onReveal: () => void;
  onRate: (result: StudyResult) => void;
  onBack?: () => void;
  onSkip?: () => void;
}

/**
 * Os atalhos da tela de estudo: Enter mostra a resposta, 1 a 4 avaliam, ← volta, → pula.
 * `studyShortcut` decide, para cada tecla, se ela vale agora (veja os casos lá).
 */
export function useStudyShortcuts(handlers: StudyShortcutHandlers): void {
  // Os atalhos sempre chamam a versão mais recente dos handlers, sem religar o ouvinte a cada
  // renderização.
  const latest = useRef(handlers);
  latest.current = handlers;

  // O usuário chegou ao foco atual andando com Tab (e não clicando)?
  const keyboardNavigation = useKeyboardNavigationFlag();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const { enabled, revealed, canGoBack, busy, onReveal, onRate, onBack, onSkip } = latest.current;
      if (!enabled || busy) return;

      const shortcut = studyShortcut(event, { revealed, canGoBack, keyboardNavigation: keyboardNavigation.current });
      if (!shortcut) return;
      if (shortcut.type === 'back' && !onBack) return;
      if (shortcut.type === 'skip' && !onSkip) return;

      // Sem isto, o botão que ficou focado (ex.: "Pular") também seria acionado pelo Enter.
      event.preventDefault();
      switch (shortcut.type) {
        case 'reveal':
          onReveal();
          break;
        case 'rate':
          onRate(shortcut.result);
          break;
        case 'back':
          onBack?.();
          break;
        case 'skip':
          onSkip?.();
          break;
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
