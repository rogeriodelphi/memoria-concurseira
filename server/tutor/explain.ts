/**
 * O "professor" de um cartão: o aluno pergunta, a IA responde. Esta função só lê o cartão e monta o pedido; não grava
 * nada (nem no cartão, nem na revisão, nem em histórico): a conversa mora na tela e some ao fechar.
 */
import type { DatabaseSync } from 'node:sqlite';

import { MAX_ASK_CHARS, MAX_HISTORY_REPLY_CHARS, MAX_HISTORY_TURNS, type TutorReply, type TutorSource, type TutorTurn } from '../ai/tutor';
import type { FlashcardRow } from '../mappers';
import { plainText } from '../mockexams/choices';

export type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
const fail = (status: number, error: string): Result<never> => ({ ok: false, status, error });

/** Quem responde: a cadeia de provedores de IA no app, um falso nos testes. */
export type Explainer = (source: TutorSource) => Promise<TutorReply>;

type CardRow = FlashcardRow & { collection_name: string; collection_subject: string };

const oneLine = (raw: string) => raw.replace(/\s+/g, ' ').trim();

/** O que o aluno perguntou: texto opcional, numa linha, até o limite. Vazio vale "explique o cartão". */
export function parseAsk(raw: unknown): Result<string> {
  if (raw === undefined || raw === null) return { ok: true, value: '' };
  if (typeof raw !== 'string') return fail(400, 'A pergunta precisa ser um texto.');
  const ask = oneLine(raw);
  if (ask.length > MAX_ASK_CHARS) return fail(400, `A pergunta pode ter até ${MAX_ASK_CHARS} caracteres.`);
  return { ok: true, value: ask };
}

/**
 * As trocas anteriores da conversa (a tela as manda de volta, o servidor não guarda nada): no máximo as últimas
 * `MAX_HISTORY_TURNS`, com a resposta cortada no limite. Algo que não seja uma lista de { ask, answer } em texto é erro.
 */
export function parseHistory(raw: unknown): Result<TutorTurn[]> {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return fail(400, 'O histórico da conversa é inválido.');
  const turns: TutorTurn[] = [];
  for (const item of raw as unknown[]) {
    const turn = item as { ask?: unknown; answer?: unknown } | null;
    if (!turn || typeof turn.ask !== 'string' || typeof turn.answer !== 'string') return fail(400, 'O histórico da conversa é inválido.');
    turns.push({ ask: oneLine(turn.ask).slice(0, MAX_ASK_CHARS), answer: turn.answer.trim().slice(0, MAX_HISTORY_REPLY_CHARS) });
  }
  return { ok: true, value: turns.slice(-MAX_HISTORY_TURNS) };
}

/**
 * Pede à IA a explicação. Cartão de outro usuário ou inexistente é 404; cartão só com figura (sem texto para ler) é 422.
 * Uma falha da IA (cota, rede, resposta inútil) sobe como erro: a rota a transforma na mensagem para o usuário.
 */
export async function explainFlashcard(
  db: DatabaseSync,
  userId: string,
  flashcardId: string,
  body: { ask?: unknown; history?: unknown } | undefined,
  explainer: Explainer,
): Promise<Result<{ reply: TutorReply }>> {
  const ask = parseAsk(body?.ask);
  if (!ask.ok) return ask;
  const history = parseHistory(body?.history);
  if (!history.ok) return history;

  const card = db
    .prepare(
      `SELECT f.*, c.name AS collection_name, c.subject AS collection_subject
       FROM flashcards f JOIN collections c ON c.id = f.collection_id
       WHERE f.id = ? AND c.user_id = ?`,
    )
    .get(flashcardId, userId) as unknown as CardRow | undefined;
  if (!card) return fail(404, 'Cartão não encontrado.');

  const source: TutorSource = {
    question: plainText(card.question, card.format),
    answer: plainText(card.answer, card.format),
    context: [card.collection_name, card.collection_subject].filter(Boolean).join(' · '),
    ask: ask.value,
    history: history.value,
  };
  if (!source.question || !source.answer) return fail(422, 'Este cartão não tem texto para a IA ler (só figura).');
  return { ok: true, value: { reply: await explainer(source) } };
}
