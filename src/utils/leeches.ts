/**
 * Cartões sanguessuga: as partes sem tela. Quem decide quais cartões são sanguessuga é o servidor
 * (server/leeches/leeches.ts); aqui ficam os textos e as contas da tela.
 */
import type { Leech, StudyResult } from '../types';
import { editorHasContent, plainTextToEditorHtml } from './flashcardEditor';
import { plural } from './performance';

/** Os prazos do "Adiar", em dias (os mesmos que o servidor aceita). */
export const SNOOZE_OPTIONS = [7, 14, 30] as const;
export type SnoozeDays = (typeof SNOOZE_OPTIONS)[number];

/** Em quantos cartões menores se pode quebrar um. */
export const MIN_SPLIT_CARDS = 2;
export const MAX_SPLIT_CARDS = 6;

/** O mínimo de erros que o usuário pode escolher (o servidor aceita de 2 a 8). */
export const MIN_ERRORS_CHOICES = [2, 3, 4, 5, 6, 7, 8] as const;
export const DEFAULT_MIN_ERRORS = 4;

/** O tamanho máximo do macete, em caracteres. */
export const MAX_MACETE_CHARS = 300;

export const OUTCOME_LABEL: Record<StudyResult, string> = {
  errei: 'Errei',
  dificil: 'Difícil',
  bom: 'Bom',
  facil: 'Fácil',
};

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Acrescenta o macete ao fim da resposta, numa linha própria em itálico ("Macete: ..."). Vazio, devolve a
 * resposta como está. O macete é texto puro: tags digitadas viram texto, e as quebras de linha viram <br>.
 */
export function appendMacete(answerHtml: string, macete: string): string {
  const text = macete.trim().slice(0, MAX_MACETE_CHARS);
  if (!text) return answerHtml;
  const body = escapeHtml(text).replace(/\r\n|\r|\n/g, '<br>');
  return `${answerHtml}<div><br></div><div><i>Macete: ${body}</i></div>`;
}

/** "Errou 5 das últimas 8 revisões". */
export function leechHeadline(leech: Pick<Leech, 'errors' | 'reviews'>): string {
  return `Errou ${leech.errors} das últimas ${plural(leech.reviews, 'revisão', 'revisões')}`;
}

/** "02/11", no dia local. */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** "Adiado até 02/11", ou nada quando o cartão não está adiado. */
export function snoozedLabel(leech: Pick<Leech, 'snoozed' | 'snoozedUntil'>): string {
  return leech.snoozed && leech.snoozedUntil ? `Adiado até ${shortDate(leech.snoozedUntil)}` : '';
}

/** As revisões em frase, para quem não vê as bolinhas: "Errei, Errei, Bom". */
export function resultsSummary(results: StudyResult[]): string {
  return results.map((r) => OUTCOME_LABEL[r]).join(', ');
}

export interface SplitDraft {
  question: string;
  answer: string;
}

export const emptySplitDraft = (): SplitDraft => ({ question: '', answer: '' });

/** Os cartões que a IA propôs, prontos para o editor (a IA devolve texto puro). */
export function suggestionToDrafts(split: { question: string; answer: string }[]): SplitDraft[] {
  return split.slice(0, MAX_SPLIT_CARDS).map((part) => ({ question: plainTextToEditorHtml(part.question), answer: plainTextToEditorHtml(part.answer) }));
}

/** O usuário já escreveu alguma coisa nos cartões novos? (Usar a sugestão da IA trocaria o que ele escreveu.) */
export function hasTypedDrafts(drafts: SplitDraft[]): boolean {
  return drafts.some((d) => editorHasContent(d.question) || editorHasContent(d.answer));
}

/** O primeiro problema dos cartões novos de uma quebra (para a tela avisar), ou `null` se está tudo certo. */
export function splitProblem(drafts: SplitDraft[]): string | null {
  if (drafts.length < MIN_SPLIT_CARDS) return `Quebre em pelo menos ${MIN_SPLIT_CARDS} cartões.`;
  if (drafts.length > MAX_SPLIT_CARDS) return `No máximo ${MAX_SPLIT_CARDS} cartões.`;
  const bad = drafts.findIndex((d) => !editorHasContent(d.question) || !editorHasContent(d.answer));
  return bad >= 0 ? `Preencha a pergunta e a resposta do cartão ${bad + 1}.` : null;
}
