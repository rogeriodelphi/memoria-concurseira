import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type { ChoiceSource, GeneratedChoice } from '../ai/choices';
import { fail, ok, type Result } from './store';

/**
 * Quantos cartões o servidor aceita preparar por pedido. Cada pedido é uma chamada de IA: lotes
 * pequenos mantêm a correspondência cartão↔questão confiável, deixam a barra de progresso andar e
 * fazem uma falha (cota, rede) custar poucos cartões, não a preparação inteira.
 */
export const MAX_CARDS_PER_PREPARE = 8;

export interface ChoiceQuestion {
  flashcardId: string;
  correct: string;
  wrong: string[];
}

/** Quem gera as alternativas: a cadeia de provedores de IA no app, um falso nos testes. */
export type ChoiceGenerator = (sources: ChoiceSource[]) => Promise<GeneratedChoice[]>;

interface CardRow {
  id: string;
  question: string;
  answer: string;
  format: string;
}

interface StoredRow {
  flashcard_id: string;
  source_hash: string;
  correct: string;
  wrong_json: string;
}

const NOT_FOUND = 'Simulado não encontrado.';

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/gi, '&');
}

/** O texto de um lado do cartão como a IA o lê: sem marcação, sem imagens, em uma linha só. */
export function plainText(raw: string, format: string): string {
  const text =
    format === 'html'
      ? decodeEntities(raw.replace(/<\/(p|div|li|h[1-6])>|<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' '))
      : raw;
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Impressão digital do que a IA viu. Usa o texto puro, então mexer só na formatação do cartão não
 * joga fora as alternativas; mudar a pergunta ou a resposta, sim.
 */
export function sourceHash(question: string, answer: string): string {
  return crypto.createHash('sha256').update(`${question}\u0000${answer}`).digest('hex');
}

function hashOf(card: CardRow): string {
  return sourceHash(plainText(card.question, card.format), plainText(card.answer, card.format));
}

function parseWrong(json: string): string[] | null {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) && parsed.length > 0 && parsed.every((x) => typeof x === 'string') ? parsed : null;
  } catch {
    return null;
  }
}

function ownsExam(db: DatabaseSync, userId: string, mockExamId: string): boolean {
  return db.prepare('SELECT 1 FROM mock_exams WHERE id = ? AND user_id = ?').get(mockExamId, userId) !== undefined;
}

/** Os cartões da lista, ou só os `only`. */
function examCards(db: DatabaseSync, mockExamId: string, only?: string[]): CardRow[] {
  const rows = db
    .prepare(
      `SELECT f.id, f.question, f.answer, f.format
       FROM mock_exam_cards mc JOIN flashcards f ON f.id = mc.flashcard_id
       WHERE mc.mock_exam_id = ? ORDER BY mc.added_at, mc.rowid`,
    )
    .all(mockExamId) as unknown as CardRow[];
  if (!only) return rows;
  const wanted = new Set(only);
  return rows.filter((r) => wanted.has(r.id));
}

/** As alternativas guardadas que ainda valem para estes cartões (o texto do cartão não mudou desde que foram geradas). */
function validStored(db: DatabaseSync, cards: CardRow[]): Map<string, ChoiceQuestion> {
  const valid = new Map<string, ChoiceQuestion>();
  const select = db.prepare('SELECT flashcard_id, source_hash, correct, wrong_json FROM card_choices WHERE flashcard_id = ?');
  for (const card of cards) {
    const row = select.get(card.id) as unknown as StoredRow | undefined;
    if (!row || row.source_hash !== hashOf(card)) continue;
    const wrong = parseWrong(row.wrong_json);
    if (wrong) valid.set(card.id, { flashcardId: card.id, correct: row.correct, wrong });
  }
  return valid;
}

/** Para cada cartão da lista: as alternativas que já existem e valem, e quais cartões ainda não têm. */
export function listChoices(
  db: DatabaseSync,
  userId: string,
  mockExamId: string,
): Result<{ questions: ChoiceQuestion[]; missing: string[] }> {
  if (!ownsExam(db, userId, mockExamId)) return fail(404, NOT_FOUND);
  const cards = examCards(db, mockExamId);
  const valid = validStored(db, cards);
  return ok({
    questions: cards.flatMap((c) => valid.get(c.id) ?? []),
    missing: cards.filter((c) => !valid.has(c.id)).map((c) => c.id),
  });
}

/**
 * Garante as alternativas dos cartões pedidos (até `MAX_CARDS_PER_PREPARE`, da lista do usuário):
 * os que já têm alternativas válidas não gastam IA; para os demais, uma única chamada gera tudo e
 * o resultado fica guardado. Devolve as questões prontas e, em `failed`, os cartões que não puderam
 * virar questão — a IA não os devolveu, ou eles não têm texto (só imagem). Se a IA falha de vez
 * (cota, rede), o erro sobe para quem chamou e nada é guardado.
 */
export async function prepareChoices(
  db: DatabaseSync,
  userId: string,
  mockExamId: string,
  flashcardIds: unknown,
  generate: ChoiceGenerator,
  now: Date = new Date(),
): Promise<Result<{ questions: ChoiceQuestion[]; failed: string[] }>> {
  if (!ownsExam(db, userId, mockExamId)) return fail(404, NOT_FOUND);
  if (!Array.isArray(flashcardIds) || flashcardIds.length === 0 || !flashcardIds.every((x) => typeof x === 'string')) {
    return fail(400, 'Escolha ao menos um cartão.');
  }
  const wanted = [...new Set(flashcardIds as string[])];
  if (wanted.length > MAX_CARDS_PER_PREPARE) {
    return fail(400, `Prepare no máximo ${MAX_CARDS_PER_PREPARE} cartões por vez.`);
  }

  const cards = examCards(db, mockExamId, wanted);
  if (cards.length === 0) return fail(404, 'Esses cartões não estão neste simulado.');

  const questions = validStored(db, cards);
  const failed: string[] = [];
  const pending: { card: CardRow; question: string; answer: string }[] = [];
  for (const card of cards) {
    if (questions.has(card.id)) continue;
    const question = plainText(card.question, card.format);
    const answer = plainText(card.answer, card.format);
    if (!question || !answer) failed.push(card.id);
    else pending.push({ card, question, answer });
  }

  if (pending.length > 0) {
    const sources: ChoiceSource[] = pending.map((p, i) => ({ n: i + 1, question: p.question, answer: p.answer }));
    const generated = await generate(sources);
    const byNumber = new Map(generated.map((g) => [g.n, g]));

    const insert = db.prepare(
      `INSERT INTO card_choices (flashcard_id, source_hash, correct, wrong_json, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(flashcard_id) DO UPDATE SET
         source_hash = excluded.source_hash, correct = excluded.correct,
         wrong_json = excluded.wrong_json, created_at = excluded.created_at`,
    );
    db.exec('BEGIN');
    try {
      pending.forEach((p, i) => {
        const choice = byNumber.get(i + 1);
        if (!choice) {
          failed.push(p.card.id);
          return;
        }
        // O hash é o do texto que a IA recebeu: se o cartão foi editado enquanto a chamada rodava,
        // ele deixa de bater e as alternativas serão geradas de novo na próxima vez.
        insert.run(p.card.id, sourceHash(p.question, p.answer), choice.correct, JSON.stringify(choice.wrong), now.toISOString());
        questions.set(p.card.id, { flashcardId: p.card.id, correct: choice.correct, wrong: choice.wrong });
      });
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  return ok({ questions: cards.flatMap((c) => questions.get(c.id) ?? []), failed });
}
