import type { StudyResult } from '../types';

/** O que as regras precisam de um evento de teclado (o `KeyboardEvent` do navegador serve). */
export interface KeyEventLike {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
  /** Tecla mantida apertada: o navegador repete o evento. */
  repeat?: boolean;
  target: EventTarget | null;
}

/** O que um atalho de teclado pode fazer na tela de estudo. */
export type StudyShortcut =
  | { type: 'reveal' }
  | { type: 'rate'; result: StudyResult }
  | { type: 'back' }
  | { type: 'skip' };

export interface ShortcutContext {
  /** A resposta já está à mostra (então 1 a 4 avaliam; antes, Enter a mostra). */
  revealed: boolean;
  /** Há o que desfazer: sem isso, ← não faz nada. */
  canGoBack: boolean;
  /** O usuário chegou ao foco atual andando com Tab (e não clicando com o mouse). */
  keyboardNavigation: boolean;
}

const RATING_KEYS: Record<string, StudyResult> = { '1': 'errei', '2': 'dificil', '3': 'bom', '4': 'facil' };

const TEXT_ENTRY_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const ACTIVATABLE_TAGS = new Set(['BUTTON', 'A', 'SUMMARY']);

/** Quem está digitando (a busca da lateral, o editor de texto rico) fica com todas as teclas. */
function isTyping(target: Partial<HTMLElement> | null): boolean {
  return !!target && (TEXT_ENTRY_TAGS.has(target.tagName ?? '') || !!target.isContentEditable);
}

/**
 * Qual atalho, se algum, um evento de teclado aciona na tela de estudo.
 *
 * Nunca acionam: teclas com modificador (Ctrl, Alt, Cmd, Shift são de outros atalhos), o
 * Enter que fecha uma composição (acentos, IME), teclas mantidas apertadas (senão segurar →
 * pularia a fila inteira) e qualquer tecla dentro de um campo de texto.
 *
 * - Enter mostra a resposta. Com um botão ou link focado, depende de COMO ele ganhou o foco
 *   (`keyboardNavigation`). Pelo teclado, o Enter é "clicar" nele, como quem navega por teclado
 *   espera. Pelo mouse — o "Pular" que continua na tela de um cartão para o outro, o "Ouvir
 *   pergunta", a estrela —, o Enter seguinte é para a resposta, não para repetir o botão. (O
 *   `:focus-visible` não serve para distinguir: o navegador o liga assim que qualquer tecla é
 *   apertada, mesmo com o foco vindo do mouse.)
 * - 1, 2, 3 e 4 avaliam (Errei, Difícil, Bom, Fácil), mas só com a resposta à mostra: antes
 *   disso o usuário ainda não viu o que está avaliando.
 * - ← volta ao cartão anterior e → pula este. Não têm uso em botões, então valem com qualquer
 *   foco (menos num campo de texto).
 */
export function studyShortcut(event: KeyEventLike, context: ShortcutContext): StudyShortcut | null {
  if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.isComposing || event.repeat) {
    return null;
  }
  const target = event.target as Partial<HTMLElement> | null;
  if (isTyping(target)) return null;

  if (event.key === 'Enter') {
    if (context.revealed) return null;
    const activatable =
      !!target && typeof target.tagName === 'string' &&
      (ACTIVATABLE_TAGS.has(target.tagName) || target.getAttribute?.('role') === 'button');
    return activatable && context.keyboardNavigation ? null : { type: 'reveal' };
  }

  const result = RATING_KEYS[event.key];
  if (result) return context.revealed ? { type: 'rate', result } : null;

  if (event.key === 'ArrowRight') return { type: 'skip' };
  if (event.key === 'ArrowLeft') return context.canGoBack ? { type: 'back' } : null;
  return null;
}
