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

/** Teclas que nenhum atalho de estudo usa: com modificador, em composição, repetidas, ou dentro de um campo de texto. */
function isIgnored(event: KeyEventLike): boolean {
  return (
    event.ctrlKey ||
    event.altKey ||
    event.metaKey ||
    event.shiftKey ||
    !!event.isComposing ||
    !!event.repeat ||
    isTyping(event.target as Partial<HTMLElement> | null)
  );
}

/**
 * O Enter mostra a resposta, a menos que ela já esteja à mostra ou que o foco esteja num botão ou
 * link a que o usuário chegou com Tab (ali o Enter é "clicar", como quem navega por teclado espera).
 */
function revealsOnEnter(
  event: KeyEventLike,
  context: { revealed: boolean; keyboardNavigation: boolean },
): boolean {
  if (context.revealed) return false;
  const target = event.target as Partial<HTMLElement> | null;
  const activatable =
    !!target &&
    typeof target.tagName === 'string' &&
    (ACTIVATABLE_TAGS.has(target.tagName) || target.getAttribute?.('role') === 'button');
  return !(activatable && context.keyboardNavigation);
}

/** O que um atalho de teclado pode fazer na tela do simulado. */
export type MockExamShortcut = { type: 'reveal' } | { type: 'answer'; correct: boolean } | { type: 'back' };

export interface MockExamShortcutContext {
  revealed: boolean;
  /** Há uma resposta anterior a desfazer. */
  canGoBack: boolean;
  keyboardNavigation: boolean;
}

/**
 * Os atalhos do simulado, com as mesmas regras de `studyShortcut` (o que nunca aciona, e o Enter com
 * botão focado): Enter mostra a resposta; 1 marca "errei" e 2 marca "acertei", só com a resposta à
 * mostra; ← desfaz a última resposta.
 */
export function mockExamShortcut(event: KeyEventLike, context: MockExamShortcutContext): MockExamShortcut | null {
  if (isIgnored(event)) return null;

  if (event.key === 'Enter') return revealsOnEnter(event, context) ? { type: 'reveal' } : null;
  if (event.key === '1' || event.key === '2') {
    return context.revealed ? { type: 'answer', correct: event.key === '2' } : null;
  }
  if (event.key === 'ArrowLeft') return context.canGoBack ? { type: 'back' } : null;
  return null;
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
  if (isIgnored(event)) return null;

  if (event.key === 'Enter') return revealsOnEnter(event, context) ? { type: 'reveal' } : null;

  const result = RATING_KEYS[event.key];
  if (result) return context.revealed ? { type: 'rate', result } : null;

  if (event.key === 'ArrowRight') return { type: 'skip' };
  if (event.key === 'ArrowLeft') return context.canGoBack ? { type: 'back' } : null;
  return null;
}

/** O que um atalho de teclado pode fazer na prova de múltipla escolha. */
export type ChoiceShortcut =
  /** Seleciona a alternativa (ainda não responde: falta confirmar). */
  | { type: 'pick'; index: number }
  /** Tacha (ou destaca) a alternativa selecionada. */
  | { type: 'cross' }
  /** Confirma a alternativa selecionada: aí sim a resposta conta. */
  | { type: 'confirm' }
  | { type: 'dontknow' }
  | { type: 'next' }
  | { type: 'back' };

export interface ChoiceShortcutContext {
  /** Quantas alternativas a questão tem (4 ou 5). */
  optionCount: number;
  /** O usuário já respondeu (confirmou ou desistiu): o gabarito está à mostra e só falta seguir. */
  picked: boolean;
  /** Há uma alternativa selecionada, esperando a confirmação. */
  selected: boolean;
  /** Há uma resposta anterior a desfazer. */
  canGoBack: boolean;
  keyboardNavigation: boolean;
}

/**
 * Os atalhos da múltipla escolha, com as mesmas proteções dos outros (modificadores, teclas
 * repetidas, composição e campos de texto não acionam nada):
 * - antes de responder: 1 a 5 (ou A a E) SELECIONAM a alternativa (trocar de ideia é só apertar outra), T tacha a
 *   selecionada, Enter confirma a selecionada (sem seleção, Enter não responde por você) e 0 é "não sei", que responde
 *   na hora;
 * - depois de responder: Enter segue para a próxima; as alternativas não mudam mais;
 * - nos dois Enter vale a regra do botão focado por Tab de sempre (nesse caso o Enter "clica" o botão);
 * - ← volta e desfaz a resposta anterior, a qualquer momento.
 */
export function choiceShortcut(event: KeyEventLike, context: ChoiceShortcutContext): ChoiceShortcut | null {
  if (isIgnored(event)) return null;

  if (event.key === 'ArrowLeft') return context.canGoBack ? { type: 'back' } : null;

  // `revealed: false` aqui só diz "decida pelo foco": o Enter age, a menos que seja de um botão focado por Tab.
  const enterActs = event.key === 'Enter' && revealsOnEnter(event, { revealed: false, keyboardNavigation: context.keyboardNavigation });
  if (context.picked) return enterActs ? { type: 'next' } : null;
  if (event.key === 'Enter') return enterActs && context.selected ? { type: 'confirm' } : null;

  if (event.key === '0') return { type: 'dontknow' };
  if (event.key.toLowerCase() === 't') return context.selected ? { type: 'cross' } : null;
  const key = event.key.toLowerCase();
  const byNumber = /^[1-5]$/.test(key) ? Number(key) - 1 : -1;
  const byLetter = /^[a-e]$/.test(key) ? key.charCodeAt(0) - 'a'.charCodeAt(0) : -1;
  const index = byNumber >= 0 ? byNumber : byLetter;
  return index >= 0 && index < context.optionCount ? { type: 'pick', index } : null;
}
