import { useEffect, useRef } from 'react';

import { mockExamShortcut } from '../utils/studyKeys';
import { useKeyboardNavigationFlag } from './useKeyboardNavigationFlag';

interface MockExamShortcutHandlers {
  /** Fora da prova (tela inicial, resultado) os atalhos não fazem nada. */
  enabled: boolean;
  revealed: boolean;
  canGoBack: boolean;
  onReveal: () => void;
  onAnswer: (correct: boolean) => void;
  onBack: () => void;
}

/**
 * Os atalhos da prova: Enter mostra a resposta, 1 marca "errei", 2 marca "acertei", ← desfaz a
 * última resposta. `mockExamShortcut` decide, para cada tecla, se ela vale agora.
 */
export function useMockExamShortcuts(handlers: MockExamShortcutHandlers): void {
  const latest = useRef(handlers);
  latest.current = handlers;
  const keyboardNavigation = useKeyboardNavigationFlag();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const { enabled, revealed, canGoBack, onReveal, onAnswer, onBack } = latest.current;
      if (!enabled) return;

      const shortcut = mockExamShortcut(event, { revealed, canGoBack, keyboardNavigation: keyboardNavigation.current });
      if (!shortcut) return;

      // Sem isto, o botão que ficou focado (ex.: "Voltar") também seria acionado pelo Enter.
      event.preventDefault();
      if (shortcut.type === 'reveal') onReveal();
      else if (shortcut.type === 'answer') onAnswer(shortcut.correct);
      else onBack();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [keyboardNavigation]);
}
