/**
 * "Concurso em foco": qual dos concursos do usuário as telas de prova (Meta para a prova, Reta final, Meu desempenho)
 * mostram. Quem tem um concurso só nunca vê isso; quem tem vários escolhe num seletor, e a escolha fica guardada
 * NESTE aparelho (o navegador), valendo para as três telas. Sem escolha, ou com uma escolha que a tela não consegue usar
 * (concurso sem data, apagado), vale o de data mais próxima, como sempre foi: o servidor decide e a tela mostra qual está valendo.
 */
import type { ExamOption } from '../types';
import { formatExamDate } from './exam';

export const FOCUS_EXAM_KEY = 'bc-focus-exam';
/** O tamanho máximo de um id aceito (o servidor também corta nisto). */
const MAX_ID_CHARS = 64;

export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** O armazenamento do navegador, ou `null` onde ele não existe ou está bloqueado (janela privada, dados bloqueados). */
function browserStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** O concurso escolhido, ou `undefined` se não há escolha (ou o armazenamento não funciona). */
export function readFocusExam(storage: KeyValueStorage | null = browserStorage()): string | undefined {
  try {
    const value = storage?.getItem(FOCUS_EXAM_KEY);
    return value && value.length <= MAX_ID_CHARS ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Guarda a escolha (ou a apaga, com `undefined`). Nunca lança: sem armazenamento, a escolha vale só nesta tela. */
export function saveFocusExam(id: string | undefined, storage: KeyValueStorage | null = browserStorage()): void {
  try {
    if (!storage) return;
    if (id) storage.setItem(FOCUS_EXAM_KEY, id);
    else storage.removeItem(FOCUS_EXAM_KEY);
  } catch {
    // sem armazenamento: a escolha não persiste, o resto segue funcionando
  }
}

/** O quanto falta, em poucas palavras: "faltam 48 dias", "hoje", "já passou", "sem data". */
export function daysLeftShort(daysLeft: number | null): string {
  if (daysLeft === null) return 'sem data';
  if (daysLeft < 0) return 'já passou';
  if (daysLeft === 0) return 'hoje';
  if (daysLeft === 1) return 'amanhã';
  return `faltam ${daysLeft} dias`;
}

/** A linha de um concurso no seletor: "UFBA · Analista de TI · 20/01/2027 (faltam 95 dias)". */
export function examOptionLabel(option: ExamOption): string {
  const parts = [option.name];
  if (option.position.trim()) parts.push(option.position.trim());
  const when = option.examDate ? `${formatExamDate(option.examDate)} (${daysLeftShort(option.daysLeft)})` : 'sem data';
  return `${parts.join(' · ')} · ${when}`;
}
