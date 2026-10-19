/**
 * Cartões de revisão a partir das questões que o usuário errou no banco de questões. Sem IA: o texto do cartão vem
 * da própria questão (enunciado e alternativas na frente; o gabarito, o gabarito comentado e a fonte no verso).
 *
 * O usuário escolhe o que vira cartão (uma questão, ou as erradas de um filtro ou de um simulado): nada entra sozinho
 * na fila de revisão. Uma questão tem no máximo um cartão (`qb_question_cards`), então repetir o pedido não duplica.
 */
import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { fail, ok, type Result } from '../mockexams/store';
import { oneLine } from '../ai/pastexam';
import { sanitizeFlashcardHtml } from '../sanitizeHtml';
import { buildWhere, orderSql, parseFilter, QUESTION_FROM } from './filter';
import type { Alternative } from './types';

export const DEFAULT_COLLECTION_NAME = 'Erros do banco de questões';
export const MAX_CARDS_PER_REQUEST = 100;
const MAX_COLLECTION_NAME_CHARS = 80;
/** Um texto de apoio maior que isto não cabe na frente de um cartão: vai cortado (o usuário pode editar o cartão). */
const MAX_SUPPORT_IN_CARD = 1_500;

export interface CardSource {
  statement: string;
  support: string;
  alternatives: Alternative[];
  answer: string;
  comment: string;
  sourceId: string;
  number: number;
  examName: string;
  board: string;
  year: number | null;
  discipline: string;
  subject: string;
}

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Um texto simples em HTML: as quebras de linha viram <br>. */
const lines = (text: string) => escapeHtml(text.trim()).replace(/\n/g, '<br>');

const paragraph = (inner: string) => `<p>${inner}</p>`;

const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text);

/** A fonte da questão, numa linha: "IDHTEC · 2026 · Q4229308". */
export function sourceLine(q: Pick<CardSource, 'board' | 'year' | 'sourceId' | 'number' | 'examName'>): string {
  const parts = [q.board, q.year ? String(q.year) : '', q.sourceId || `questão ${q.number}`].filter(Boolean);
  return q.board || q.year || q.sourceId ? parts.join(' · ') : `${q.examName} · questão ${q.number}`;
}

/** A frente e o verso do cartão de uma questão, já em HTML limpo. */
export function cardContent(q: CardSource): { question: string; answer: string } {
  const front = [
    q.support ? paragraph(`<i>${lines(truncate(q.support, MAX_SUPPORT_IN_CARD))}</i>`) : '',
    paragraph(lines(q.statement)),
    ...q.alternatives.map((a) => paragraph(`<b>${escapeHtml(a.letter)})</b> ${lines(a.text)}`)),
  ].filter(Boolean);

  const right = q.alternatives.find((a) => a.letter === q.answer);
  const back = [
    paragraph(`<b>Gabarito: ${escapeHtml(q.answer)}</b>${right ? ` — ${lines(right.text)}` : ''}`),
    q.comment ? paragraph(lines(q.comment)) : '',
    paragraph(`<i>${escapeHtml(sourceLine(q))}</i>`),
  ].filter(Boolean);

  return { question: sanitizeFlashcardHtml(front.join('')), answer: sanitizeFlashcardHtml(back.join('')) };
}

export interface CardsResult {
  collection: { id: string; name: string; created: boolean };
  /** Cartões novos nesta chamada. */
  created: number;
  /** Questões que já tinham cartão e não geraram outro. */
  alreadyHad: number;
  /** Questões pedidas que não podem virar cartão (sem gabarito, anuladas ou nunca respondidas). */
  skipped: number;
}

interface Candidate extends CardSource {
  id: string;
  hasCard: boolean;
}

const COLUMNS = `q.id, q.statement, q.support, q.alternatives_json, q.answer, q.comment, q.source_id, q.number,
  e.name AS exam_name, e.board, e.year, q.discipline, q.subject,
  EXISTS(SELECT 1 FROM qb_question_cards c WHERE c.question_id = q.id) AS has_card`;

interface Row {
  id: string;
  statement: string;
  support: string;
  alternatives_json: string;
  answer: string;
  comment: string;
  source_id: string;
  number: number;
  exam_name: string;
  board: string;
  year: number | null;
  discipline: string;
  subject: string;
  has_card: number;
}

const toCandidate = (r: Row): Candidate => ({
  id: r.id,
  statement: r.statement,
  support: r.support,
  alternatives: JSON.parse(r.alternatives_json) as Alternative[],
  answer: r.answer,
  comment: r.comment,
  sourceId: r.source_id,
  number: r.number,
  examName: r.exam_name,
  board: r.board,
  year: r.year,
  discipline: r.discipline,
  subject: r.subject,
  hasCard: r.has_card === 1,
});

function loadByIds(db: DatabaseSync, userId: string, ids: string[]): { candidates: Candidate[]; skipped: number } {
  const wanted = [...new Set(ids)].slice(0, MAX_CARDS_PER_REQUEST);
  if (wanted.length === 0) return { candidates: [], skipped: 0 };
  const rows = db
    .prepare(
      `SELECT ${COLUMNS}, q.annulled,
         EXISTS(SELECT 1 FROM qb_answers a WHERE a.question_id = q.id) AS answered
       FROM qb_questions q JOIN qb_exams e ON e.id = q.exam_id
       WHERE q.user_id = ? AND q.id IN (${wanted.map(() => '?').join(', ')})`,
    )
    .all(userId, ...wanted) as unknown as (Row & { annulled: number; answered: number })[];
  // Só vira cartão a questão que tem gabarito e já foi respondida: antes disso o gabarito nem foi visto.
  const usable = rows.filter((r) => r.annulled === 0 && r.answer !== '' && r.answered === 1);
  return { candidates: usable.map(toCandidate), skipped: wanted.length - usable.length };
}

const HAS_CARD = 'EXISTS(SELECT 1 FROM qb_question_cards c WHERE c.question_id = q.id)';

/**
 * As questões que o filtro encontra e que o usuário errou na última resposta (e têm gabarito): as que ainda não têm
 * cartão (até o limite do pedido: o resto vem num pedido seguinte) e quantas já tinham.
 */
function loadWrongByFilter(db: DatabaseSync, userId: string, rawFilter: unknown): { fresh: Candidate[]; alreadyHad: number } {
  const filter = { ...parseFilter(rawFilter), status: ['errei' as const] };
  const { where, params } = buildWhere(userId, filter);
  const base = `${QUESTION_FROM} ${where} AND q.annulled = 0 AND q.answer != ''`;
  const rows = db
    .prepare(`SELECT ${COLUMNS} ${base} AND NOT ${HAS_CARD} ORDER BY ${orderSql('prova')} LIMIT ?`)
    .all(...params, MAX_CARDS_PER_REQUEST) as unknown as Row[];
  const had = db.prepare(`SELECT COUNT(*) AS n ${base} AND ${HAS_CARD}`).get(...params) as unknown as { n: number };
  return { fresh: rows.map(toCandidate), alreadyHad: had.n };
}

/** A coleção de destino: a escolhida (do usuário), ou a que tem o nome pedido, que é criada se não existir. */
function destination(
  db: DatabaseSync,
  userId: string,
  body: Record<string, unknown>,
): Result<{ id: string; name: string; create: boolean }> {
  if (typeof body.collectionId === 'string' && body.collectionId) {
    const row = db.prepare('SELECT id, name FROM collections WHERE id = ? AND user_id = ?').get(body.collectionId, userId) as unknown as
      | { id: string; name: string }
      | undefined;
    return row ? ok({ ...row, create: false }) : fail(404, 'Coleção não encontrada.');
  }
  const name = oneLine(body.collectionName, MAX_COLLECTION_NAME_CHARS) || DEFAULT_COLLECTION_NAME;
  if (name.length < 2) return fail(400, 'O nome da coleção precisa ter pelo menos 2 caracteres.');
  const existing = db.prepare('SELECT id, name FROM collections WHERE user_id = ? AND name = ? COLLATE NOCASE ORDER BY created_at LIMIT 1').get(userId, name) as unknown as
    | { id: string; name: string }
    | undefined;
  if (existing) return ok({ ...existing, create: false });
  return ok({ id: crypto.randomUUID(), name, create: true });
}

/**
 * Cria os cartões de revisão. O que vira cartão vem de `questionIds` (as que o usuário já respondeu) ou do `filter`
 * (as que ele errou entre as que o filtro encontra). A coleção é `collectionId`, ou a de nome `collectionName`
 * (criada se não existir; sem nome, "Erros do banco de questões"). Nada é criado se não houver questão elegível.
 */
export function createCardsFromQuestions(db: DatabaseSync, userId: string, body: unknown, now: Date = new Date()): Result<CardsResult> {
  const input = (body ?? {}) as Record<string, unknown>;
  const stamp = now.toISOString();

  let fresh: Candidate[];
  let alreadyHad: number;
  let skipped = 0;
  if (Array.isArray(input.questionIds)) {
    const loaded = loadByIds(db, userId, input.questionIds.filter((x): x is string => typeof x === 'string'));
    fresh = loaded.candidates.filter((c) => !c.hasCard);
    alreadyHad = loaded.candidates.length - fresh.length;
    skipped = loaded.skipped;
  } else if (input.filter !== undefined) {
    ({ fresh, alreadyHad } = loadWrongByFilter(db, userId, input.filter));
  } else {
    return fail(400, 'Escolha as questões que viram cartão.');
  }

  const target = destination(db, userId, input);
  if (!target.ok) return target;
  if (fresh.length === 0) {
    if (alreadyHad === 0 && skipped === 0) return fail(422, 'Nenhuma questão errada para virar cartão neste filtro.');
    return ok({ collection: { id: target.value.id, name: target.value.name, created: false }, created: 0, alreadyHad, skipped });
  }

  db.exec('BEGIN');
  try {
    const collectionId = target.value.id;
    if (target.value.create) {
      db.prepare('INSERT INTO collections (id, user_id, name, subject, description, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        collectionId,
        userId,
        target.value.name,
        'Questões de provas',
        'Cartões feitos das questões que você errou no banco de questões.',
        'Outros',
        stamp,
        stamp,
      );
    }
    // Os cartões feitos à mão de uma coleção dividem um único "documento" manual (como em "Novo cartão").
    let documentId = (db.prepare("SELECT id FROM documents WHERE collection_id = ? AND source_type = 'manual'").get(collectionId) as unknown as
      | { id: string }
      | undefined)?.id;
    if (!documentId) {
      documentId = crypto.randomUUID();
      db.prepare('INSERT INTO documents (id, collection_id, filename, size, pages, status, source_type, created_at) VALUES (?, ?, ?, 0, 0, ?, ?, ?)').run(
        documentId,
        collectionId,
        'Cartões adicionados manualmente',
        'completed',
        'manual',
        stamp,
      );
    }
    const insertCard = db.prepare(
      'INSERT INTO flashcards (id, collection_id, document_id, question, answer, format, difficulty, source_page, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)',
    );
    const link = db.prepare('INSERT INTO qb_question_cards (question_id, flashcard_id, created_at) VALUES (?, ?, ?)');
    for (const q of fresh) {
      const card = cardContent(q);
      const flashcardId = crypto.randomUUID();
      insertCard.run(flashcardId, collectionId, documentId, card.question, card.answer, 'html', 'medio', stamp);
      link.run(q.id, flashcardId, stamp);
    }
    db.prepare('UPDATE collections SET updated_at = ? WHERE id = ?').run(stamp, collectionId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return ok({ collection: { id: target.value.id, name: target.value.name, created: target.value.create }, created: fresh.length, alreadyHad, skipped });
}
