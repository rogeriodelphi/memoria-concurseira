/**
 * Cartões por IA para um tópico do edital que ainda não tem material. Cada tópico ganha a sua própria
 * coleção (assim os cartões dela são exatamente os do tópico, e a cobertura do concurso não conta o mesmo
 * cartão em vários tópicos) já ligada a ele. Nada roda sozinho: é o usuário quem pede, tópico a tópico.
 *
 * A IA só recebe o título do tópico e o contexto da prova, sem texto-fonte: por isso a coleção diz na
 * descrição que foi gerada assim, e o pedido já manda não inventar números nem artigos.
 */
import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type { GeneratedFlashcard, GenerationOptions } from '../ai/router';
import { fail, ok, type Result } from '../mockexams/store';

export const DEFAULT_TOPIC_CARDS = 12;
export const MIN_TOPIC_CARDS = 5;
export const MAX_TOPIC_CARDS = 30;
const MAX_TOPIC_CHARS = 300;
const MAX_FOCUS_CHARS = 500;
const MAX_NAME_CHARS = 120;
const MAX_SUBJECT_CHARS = 160;
const DIFFICULTIES: readonly string[] = ['facil', 'medio', 'dificil'];

export type TopicCardsGenerator = (
  topic: string,
  options: GenerationOptions,
) => Promise<{ flashcards: GeneratedFlashcard[] }>;

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Os editais costumam escrever "Grupo: assunto". A coleção segue o jeito do app (o nome é o grupo, que
 * junta as coleções numa disciplina na lista, e o assunto é o tópico); sem o "Grupo:", o grupo é a disciplina.
 */
export function collectionNames(disciplineName: string, topicTitle: string): { name: string; subject: string } {
  const title = squash(topicTitle);
  const colon = title.indexOf(':');
  const group = colon > 0 ? squash(title.slice(0, colon)) : '';
  const rest = colon > 0 ? squash(title.slice(colon + 1)) : title;
  const name = group || squash(disciplineName) || 'Concurso';
  return { name: clip(name, MAX_NAME_CHARS), subject: clip(rest || title, MAX_SUBJECT_CHARS) };
}

/** O que se pede à IA: o tópico com a disciplina, e o contexto da prova como foco. */
export function topicRequest(
  exam: { name: string; position: string; board: string },
  disciplineName: string,
  topicTitle: string,
  quantity: number,
): { topic: string; options: GenerationOptions } {
  const context = [`concurso ${squash(exam.name)}`, exam.position && `cargo ${squash(exam.position)}`, exam.board && `banca ${squash(exam.board)}`]
    .filter(Boolean)
    .join(', ');
  const focus =
    `o que costuma ser cobrado em provas de concurso (${context}). ` +
    'Seja preciso: não invente números de artigos, datas, valores nem siglas; se não tiver certeza de um detalhe, ' +
    'pergunte por algo de que você tenha certeza.';
  return {
    topic: clip(`${squash(disciplineName)} — ${squash(topicTitle)}`, MAX_TOPIC_CHARS),
    options: { quantity, difficulty: 'misto', cardType: 'pergunta_resposta', depth: 'normal', focus: clip(focus, MAX_FOCUS_CHARS) },
  };
}

export function parseTopicCardsQuantity(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_TOPIC_CARDS;
  const n = Number(raw);
  return Number.isInteger(n) && n >= MIN_TOPIC_CARDS && n <= MAX_TOPIC_CARDS ? n : null;
}

/** Cartões sem pergunta ou resposta, ou com a mesma pergunta de outro, saem; o resto fica na ordem recebida. */
export function usableCards(cards: GeneratedFlashcard[], max: number): GeneratedFlashcard[] {
  const seen = new Set<string>();
  const kept: GeneratedFlashcard[] = [];
  for (const card of cards) {
    const question = typeof card?.question === 'string' ? squash(card.question) : '';
    const answer = typeof card?.answer === 'string' ? card.answer.trim() : '';
    if (!question || !answer) continue;
    const key = question.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push({ ...card, question, answer });
    if (kept.length === max) break;
  }
  return kept;
}

export interface TopicCardsResult {
  collection: { id: string; name: string; subject: string };
  added: number;
}

const hasMaterial = (db: DatabaseSync, topicId: string): boolean =>
  !!db
    .prepare(
      `SELECT 1 FROM exam_topic_collections l JOIN flashcards f ON f.collection_id = l.collection_id WHERE l.topic_id = ? LIMIT 1`,
    )
    .get(topicId);

export async function generateTopicCards(
  db: DatabaseSync,
  userId: string,
  examId: string,
  topicId: string,
  rawQuantity: unknown,
  generate: TopicCardsGenerator,
  now: Date = new Date(),
): Promise<Result<TopicCardsResult>> {
  const quantity = parseTopicCardsQuantity(rawQuantity);
  if (quantity === null) return fail(400, `Escolha de ${MIN_TOPIC_CARDS} a ${MAX_TOPIC_CARDS} cartões.`);

  const exam = db
    .prepare('SELECT id, name, position, board FROM exams WHERE id = ? AND user_id = ?')
    .get(examId, userId) as unknown as { id: string; name: string; position: string; board: string } | undefined;
  if (!exam) return fail(404, 'Concurso não encontrado.');

  const topic = db
    .prepare(
      `SELECT t.id, t.title, d.name AS discipline FROM exam_topics t JOIN exam_disciplines d ON d.id = t.discipline_id
       WHERE t.id = ? AND d.exam_id = ?`,
    )
    .get(topicId, examId) as unknown as { id: string; title: string; discipline: string } | undefined;
  if (!topic) return fail(404, 'Tópico não encontrado.');
  if (hasMaterial(db, topic.id)) return fail(409, 'Este tópico já tem material.');

  const request = topicRequest(exam, topic.discipline, topic.title, quantity);
  const generated = await generate(request.topic, request.options);
  const cards = usableCards(generated.flashcards, quantity);
  if (cards.length === 0) return fail(422, 'A IA não devolveu cartões para este tópico. Tente de novo.');

  const names = collectionNames(topic.discipline, topic.title);
  const description = clip(
    `Gerada por IA a partir do tópico "${squash(topic.title)}" do edital de ${squash(exam.name)}, sem texto-fonte: confira os cartões, sobretudo leis, números e datas.`,
    500,
  );
  const stamp = now.toISOString();
  const collectionId = crypto.randomUUID();
  const documentId = crypto.randomUUID();

  db.exec('BEGIN');
  try {
    // A geração levou segundos: se outro pedido deu material ao tópico enquanto isso, não duplica.
    if (hasMaterial(db, topic.id)) {
      db.exec('ROLLBACK');
      return fail(409, 'Este tópico já tem material.');
    }
    db.prepare(
      'INSERT INTO collections (id, user_id, name, subject, description, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(collectionId, userId, names.name, names.subject, description, 'Concursos', stamp, stamp);
    db.prepare(
      'INSERT INTO documents (id, collection_id, filename, size, pages, status, source_type, created_at) VALUES (?, ?, ?, 0, 0, ?, ?, ?)',
    ).run(documentId, collectionId, clip(squash(topic.title), 200), 'completed', 'topic', stamp);
    const insert = db.prepare(
      'INSERT INTO flashcards (id, collection_id, document_id, question, answer, difficulty, source_page, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    for (const card of cards) {
      insert.run(crypto.randomUUID(), collectionId, documentId, card.question, card.answer, DIFFICULTIES.includes(card.difficulty) ? card.difficulty : 'medio', card.sourcePage ?? null, stamp);
    }
    db.prepare('INSERT INTO exam_topic_collections (topic_id, collection_id) VALUES (?, ?)').run(topic.id, collectionId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return ok({ collection: { id: collectionId, ...names }, added: cards.length });
}
