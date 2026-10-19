/**
 * Cartões sanguessuga: os que o usuário erra sempre. Gastam revisão sem fixar, então a tela os separa e oferece o
 * que resolve (reescrever, quebrar em cartões menores, adiar, recomeçar a contagem). Nada aqui altera um cartão
 * sozinho: tudo é pedido pelo usuário.
 *
 * Um cartão é sanguessuga quando ERROU ("Errei", não "Difícil") ao menos `minErrors` das suas últimas
 * `LEECH_WINDOW` revisões e ainda não acertou `CONSOLIDATED_STREAK` vezes seguidas desde o último erro (o
 * `repetitions` do agendamento conta exatamente isso). Quem fixou o cartão sai da lista sozinho; quem reescreveu ou
 * mandou recomeçar a contagem só conta os erros dali para a frente.
 */
import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { mapFlashcard, type FlashcardRow } from '../mappers';
import { sanitizeFlashcardHtml } from '../sanitizeHtml';

/** Quantas das últimas revisões de cada cartão entram na conta. */
export const LEECH_WINDOW = 10;
export const DEFAULT_MIN_ERRORS = 4;
export const MIN_MIN_ERRORS = 2;
export const MAX_MIN_ERRORS = 8;
/** Acertos seguidos (Difícil, Bom ou Fácil) depois do último erro que tiram o cartão da lista. */
export const CONSOLIDATED_STREAK = 3;
/** Quantos cartões a lista traz, no máximo (o total real vem junto). */
export const MAX_LEECHES = 100;
/** Os prazos do "Adiar", em dias. */
export const SNOOZE_DAYS = [7, 14, 30] as const;
/** Em quantos cartões menores se pode quebrar um (mínimo 2). */
export const MAX_SPLIT_CARDS = 6;

export type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
const fail = (status: number, error: string): Result<never> => ({ ok: false, status, error });

export type StudyOutcome = 'errei' | 'dificil' | 'bom' | 'facil';

export interface Leech {
  flashcard: ReturnType<typeof mapFlashcard> & { collectionName: string; collectionSubject: string };
  /** Quantas das últimas revisões foram "Errei". */
  errors: number;
  /** Quantas revisões entraram na conta (até `LEECH_WINDOW`). */
  reviews: number;
  /** As últimas revisões, da mais antiga para a mais nova. */
  results: StudyOutcome[];
  lastReviewedAt: string;
  /** Acertos seguidos desde o último erro. */
  streak: number;
  /** O usuário adiou a revisão deste cartão e o prazo ainda não passou. */
  snoozed: boolean;
  /** Até quando, quando está adiado. */
  snoozedUntil: string | null;
}

export interface LeechList {
  minErrors: number;
  window: number;
  streakToLeave: number;
  /** Quantos cartões atendem, mesmo que a lista traga só os `MAX_LEECHES` primeiros. */
  total: number;
  leeches: Leech[];
}

/** O limite do pedido: um inteiro de 2 a 8 (4 se ausente). Qualquer outra coisa é erro, não chute. */
export function parseMinErrors(raw: unknown): Result<number> {
  if (raw === undefined || raw === '') return { ok: true, value: DEFAULT_MIN_ERRORS };
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d{1,2}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < MIN_MIN_ERRORS || n > MAX_MIN_ERRORS) {
    return fail(400, `O mínimo de erros deve ser de ${MIN_MIN_ERRORS} a ${MAX_MIN_ERRORS}.`);
  }
  return { ok: true, value: n };
}

type LeechRow = FlashcardRow & {
  collection_name: string;
  collection_subject: string;
  errors: number;
  reviews: number;
  last_at: string;
  snoozed_until: string | null;
  total: number;
};

// As revisões de cada cartão do usuário, da mais nova (rn = 1) para a mais velha, só as de depois do último
// "recomeçar a contagem" do cartão.
const RECENT = `
  SELECT s.flashcard_id, s.result, s.studied_at,
         ROW_NUMBER() OVER (PARTITION BY s.flashcard_id ORDER BY s.studied_at DESC, s.rowid DESC) AS rn
  FROM study_sessions s
  JOIN flashcards f ON f.id = s.flashcard_id
  JOIN collections c ON c.id = f.collection_id
  LEFT JOIN leech_state r ON r.flashcard_id = s.flashcard_id
  WHERE s.user_id = ? AND c.user_id = ? AND (r.reset_at IS NULL OR s.studied_at > r.reset_at)
`;

/** Os cartões sanguessuga do usuário, do que mais errou ao que menos, e entre iguais o revisado mais recentemente. */
export function loadLeeches(db: DatabaseSync, userId: string, minErrors: number = DEFAULT_MIN_ERRORS, now: Date = new Date()): LeechList {
  const rows = db
    .prepare(
      `WITH recent AS (${RECENT}),
       counted AS (
         SELECT flashcard_id, SUM(result = 'errei') AS errors, COUNT(*) AS reviews, MAX(studied_at) AS last_at
         FROM recent WHERE rn <= ${LEECH_WINDOW}
         GROUP BY flashcard_id HAVING SUM(result = 'errei') >= ?
       )
       SELECT f.*, c.name AS collection_name, c.subject AS collection_subject,
              k.errors, k.reviews, k.last_at, ls.snoozed_until, COUNT(*) OVER () AS total
       FROM counted k
       JOIN flashcards f ON f.id = k.flashcard_id
       JOIN collections c ON c.id = f.collection_id
       LEFT JOIN leech_state ls ON ls.flashcard_id = f.id
       WHERE f.repetitions < ${CONSOLIDATED_STREAK}
       ORDER BY k.errors DESC, k.last_at DESC, f.rowid
       LIMIT ${MAX_LEECHES}`,
    )
    .all(userId, userId, minErrors) as unknown as LeechRow[];

  const resultsByCard = loadResults(db, userId, rows.map((r) => r.id));
  const nowIso = now.toISOString();
  const leeches = rows.map((row): Leech => ({
    flashcard: { ...mapFlashcard(row), collectionName: row.collection_name, collectionSubject: row.collection_subject },
    errors: row.errors,
    reviews: row.reviews,
    results: resultsByCard.get(row.id) ?? [],
    lastReviewedAt: row.last_at,
    streak: row.repetitions,
    snoozed: row.snoozed_until !== null && row.snoozed_until > nowIso,
    snoozedUntil: row.snoozed_until !== null && row.snoozed_until > nowIso ? row.snoozed_until : null,
  }));
  return { minErrors, window: LEECH_WINDOW, streakToLeave: CONSOLIDATED_STREAK, total: rows[0]?.total ?? 0, leeches };
}

/** As últimas revisões (as da conta) de cada cartão, da mais antiga para a mais nova. */
export function loadResults(db: DatabaseSync, userId: string, cardIds: string[]): Map<string, StudyOutcome[]> {
  const byCard = new Map<string, StudyOutcome[]>();
  if (cardIds.length === 0) return byCard;
  const rows = db
    .prepare(
      `WITH recent AS (${RECENT})
       SELECT flashcard_id, result FROM recent
       WHERE rn <= ${LEECH_WINDOW} AND flashcard_id IN (${cardIds.map(() => '?').join(', ')})
       ORDER BY flashcard_id, rn DESC`,
    )
    .all(userId, userId, ...cardIds) as unknown as { flashcard_id: string; result: StudyOutcome }[];
  for (const row of rows) {
    const list = byCard.get(row.flashcard_id) ?? [];
    list.push(row.result);
    byCard.set(row.flashcard_id, list);
  }
  return byCard;
}

function loadOwned(db: DatabaseSync, userId: string, flashcardId: string): FlashcardRow | null {
  const row = db
    .prepare(
      `SELECT f.* FROM flashcards f JOIN collections c ON c.id = f.collection_id
       WHERE f.id = ? AND c.user_id = ?`,
    )
    .get(flashcardId, userId) as unknown as FlashcardRow | undefined;
  return row ?? null;
}

const NOT_FOUND = 'Cartão não encontrado.';

/** Guarda o recomeço da contagem (e deixa como está o adiamento, se houver). */
function markReset(db: DatabaseSync, flashcardId: string, at: string): void {
  db.prepare(
    'INSERT INTO leech_state (flashcard_id, reset_at) VALUES (?, ?) ON CONFLICT(flashcard_id) DO UPDATE SET reset_at = excluded.reset_at',
  ).run(flashcardId, at);
}

/** Recomeça a contagem: só os erros de DEPOIS deste momento voltam a valer para este cartão. */
export function resetLeech(db: DatabaseSync, userId: string, flashcardId: string, now: Date = new Date()): Result<{ resetAt: string }> {
  if (!loadOwned(db, userId, flashcardId)) return fail(404, NOT_FOUND);
  const resetAt = now.toISOString();
  markReset(db, flashcardId, resetAt);
  return { ok: true, value: { resetAt } };
}

/**
 * Adia a revisão por 7, 14 ou 30 dias: empurra a data de vencimento (as filas já respeitam), sem tocar no
 * agendamento em si, e guarda até quando foi adiado (é isso que distingue um cartão adiado de um que só vence amanhã
 * porque acabou de ser revisado). Um cartão que já vence depois disso fica como está: adiar nunca antecipa.
 */
export function snoozeLeech(db: DatabaseSync, userId: string, flashcardId: string, days: unknown, now: Date = new Date()): Result<{ dueAt: string }> {
  if (typeof days !== 'number' || !(SNOOZE_DAYS as readonly number[]).includes(days)) {
    return fail(400, `Escolha ${SNOOZE_DAYS.join(', ')} dias.`);
  }
  const card = loadOwned(db, userId, flashcardId);
  if (!card) return fail(404, NOT_FOUND);
  const target = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
  const dueAt = card.due_at !== null && card.due_at > target ? card.due_at : target;
  db.prepare('UPDATE flashcards SET due_at = ? WHERE id = ?').run(dueAt, card.id);
  db.prepare(
    'INSERT INTO leech_state (flashcard_id, snoozed_until) VALUES (?, ?) ON CONFLICT(flashcard_id) DO UPDATE SET snoozed_until = excluded.snoozed_until',
  ).run(card.id, dueAt);
  return { ok: true, value: { dueAt } };
}

export interface SplitResult {
  created: ReturnType<typeof mapFlashcard>[];
  originalDeleted: boolean;
}

const textOf = (html: string) => html.replace(/<[^>]+>/g, '').trim();

/**
 * Quebra um cartão em vários menores (o motivo mais comum de um cartão não fixar é trazer coisa demais). Os novos
 * ficam na mesma coleção, com a mesma dificuldade, como cartões novos; o original é apagado (com o seu histórico)
 * ou, com `keepOriginal`, fica e recomeça a contagem. Tudo junto ou nada: se um dos novos for inválido, nenhum é criado.
 */
export function splitLeech(db: DatabaseSync, userId: string, flashcardId: string, body: unknown, now: Date = new Date()): Result<SplitResult> {
  const card = loadOwned(db, userId, flashcardId);
  if (!card) return fail(404, NOT_FOUND);

  const input = (body ?? {}) as { cards?: unknown; keepOriginal?: unknown };
  if (!Array.isArray(input.cards) || input.cards.length < 2 || input.cards.length > MAX_SPLIT_CARDS) {
    return fail(400, `Quebre em ${2} a ${MAX_SPLIT_CARDS} cartões.`);
  }
  const parts: { question: string; answer: string }[] = [];
  for (const item of input.cards as { question?: unknown; answer?: unknown }[]) {
    const question = typeof item?.question === 'string' ? sanitizeFlashcardHtml(item.question.trim()) : '';
    const answer = typeof item?.answer === 'string' ? sanitizeFlashcardHtml(item.answer.trim()) : '';
    if (!textOf(question) || !textOf(answer)) return fail(400, 'Preencha a pergunta e a resposta de cada cartão novo.');
    parts.push({ question, answer });
  }
  const keepOriginal = input.keepOriginal === true;
  const stamp = now.toISOString();

  db.exec('BEGIN');
  try {
    const insert = db.prepare(
      'INSERT INTO flashcards (id, collection_id, document_id, question, answer, format, difficulty, source_page, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)',
    );
    const ids: string[] = [];
    for (const part of parts) {
      const id = crypto.randomUUID();
      insert.run(id, card.collection_id, card.document_id, part.question, part.answer, 'html', card.difficulty, stamp);
      ids.push(id);
    }
    if (keepOriginal) {
      markReset(db, card.id, stamp);
    } else {
      db.prepare('DELETE FROM flashcards WHERE id = ?').run(card.id);
    }
    db.prepare('UPDATE collections SET updated_at = ? WHERE id = ?').run(stamp, card.collection_id);
    const created = ids.map((id) => mapFlashcard(db.prepare('SELECT * FROM flashcards WHERE id = ?').get(id) as unknown as FlashcardRow));
    db.exec('COMMIT');
    return { ok: true, value: { created, originalDeleted: !keepOriginal } };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
