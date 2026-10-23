import { useEffect, useRef } from 'react';

import { choiceShortcut, mockExamShortcut } from '../utils/studyKeys';
import { useKeyboardNavigationFlag } from './useKeyboardNavigationFlag';

/** Na prova de múltipla escolha, o que cada atalho faz (no lugar de mostrar a resposta e marcar acertei/errei). */
interface ChoiceHandlers {
  optionCount: number;
  /** Já respondeu (confirmou ou desistiu): o gabarito está à mostra. */
  picked: boolean;
  /** Há uma alternativa selecionada, esperando a confirmação. */
  selected: boolean;
  /** Seleciona a alternativa (não responde: falta confirmar). */
  onPick: (index: number) => void;
  /** Tacha (ou destaca) a alternativa selecionada. */
  onCross: () => void;
  /** Confirma a alternativa selecionada. */
  onConfirm: () => void;
  onDontKnow: () => void;
  onNext: () => void;
}

interface MockExamShortcutHandlers {
  /** Fora da prova (tela inicial, resultado) os atalhos não fazem nada. */
  enabled: boolean;
  revealed: boolean;
  canGoBack: boolean;
  onReveal: () => void;
  onAnswer: (correct: boolean) => void;
  onBack: () => void;
  /** Presente só na prova de múltipla escolha. */
  choice?: ChoiceHandlers;
}

/**
 * Os atalhos da prova. Autoavaliada: Enter mostra a resposta, 1 marca "errei", 2 marca "acertei".
 * Múltipla escolha: 1 a 5 (ou A a E) selecionam, T tacha a selecionada, Enter confirma a selecionada (e, depois de
 * responder, segue), 0 é "não sei". Nas duas, ← desfaz a última resposta. `mockExamShortcut` e `choiceShortcut` decidem, para cada tecla, se ela vale agora.
 */
export function useMockExamShortcuts(handlers: MockExamShortcutHandlers): void {
  const latest = useRef(handlers);
  latest.current = handlers;
  const keyboardNavigation = useKeyboardNavigationFlag();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const { enabled, revealed, canGoBack, onReveal, onAnswer, onBack, choice } = latest.current;
      if (!enabled) return;

      if (choice) {
        const shortcut = choiceShortcut(event, {
          optionCount: choice.optionCount,
          picked: choice.picked,
          selected: choice.selected,
          canGoBack,
          keyboardNavigation: keyboardNavigation.current,
        });
        if (!shortcut) return;
        event.preventDefault();
        if (shortcut.type === 'pick') choice.onPick(shortcut.index);
        else if (shortcut.type === 'cross') choice.onCross();
        else if (shortcut.type === 'confirm') choice.onConfirm();
        else if (shortcut.type === 'dontknow') choice.onDontKnow();
        else if (shortcut.type === 'next') choice.onNext();
        else onBack();
        return;
      }

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
