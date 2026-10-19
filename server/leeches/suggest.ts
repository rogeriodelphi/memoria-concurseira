/**
 * A sugestão da IA para um cartão sanguessuga. A IA só PROPÕE (diagnóstico, macete, divisão em cartões menores):
 * esta função não grava nada, e quem aplica é o usuário, pelas ações que já existem (reescrever, quebrar).
 */
import type { DatabaseSync } from 'node:sqlite';

import type { LeechFix, LeechFixSource } from '../ai/leechfix';
import type { FlashcardRow } from '../mappers';
import { plainText } from '../mockexams/choices';
import { LEECH_WINDOW, loadResults, type Result } from './leeches';

export type Suggester = (source: LeechFixSource) => Promise<LeechFix>;

type CardRow = FlashcardRow & { collection_name: string; collection_subject: string };

/**
 * Monta o pedido a partir do cartão e do histórico dele e chama `suggester` (a cadeia de provedores, ou um falso nos
 * testes). Cartão de outro usuário ou inexistente é 404. Uma falha da IA (cota, rede, resposta inútil) sobe como
 * erro: a rota a transforma na mensagem para o usuário.
 */
export async function suggestFix(
  db: DatabaseSync,
  userId: string,
  flashcardId: string,
  suggester: Suggester,
): Promise<Result<{ suggestion: LeechFix }>> {
  const card = db
    .prepare(
      `SELECT f.*, c.name AS collection_name, c.subject AS collection_subject
       FROM flashcards f JOIN collections c ON c.id = f.collection_id
       WHERE f.id = ? AND c.user_id = ?`,
    )
    .get(flashcardId, userId) as unknown as CardRow | undefined;
  if (!card) return { ok: false, status: 404, error: 'Cartão não encontrado.' };

  const results = loadResults(db, userId, [card.id]).get(card.id) ?? [];
  const source: LeechFixSource = {
    question: plainText(card.question, card.format),
    answer: plainText(card.answer, card.format),
    context: [card.collection_name, card.collection_subject].filter(Boolean).join(' · '),
    errors: results.filter((r) => r === 'errei').length,
    reviews: Math.min(results.length, LEECH_WINDOW),
  };
  if (!source.question || !source.answer) {
    return { ok: false, status: 422, error: 'Este cartão não tem texto para a IA ler (só figura).' };
  }
  return { ok: true, value: { suggestion: await suggester(source) } };
}
