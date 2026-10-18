/**
 * Os cartões de IA que esperam conferência: criar, listar, editar, aprovar (vira cartão comum) e descartar.
 * Tudo recebe o banco como argumento, para os testes usarem um em memória. Só as linhas do próprio usuário
 * são vistas ou alteradas.
 */
import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { MAX_VERIFY_PER_CALL, type Verdict, type VerifiedCard, type VerifySource } from '../ai/verify';
import { fail, ok, type Result } from '../mockexams/store';

/** Cada cartão (pergunta ou resposta) tem no máximo isto: o suficiente para um cartão de estudo, sem deixar crescer sem limite. */
export const MAX_DRAFT_CHARS = 4000;
/** Quantos rascunhos uma ação em lote pode pegar de uma vez. */
export const MAX_BATCH = 500;
/** O começo da descrição das coleções criadas para rascunhos: é o que as distingue das coleções do usuário. */
export const GENERATED_DESCRIPTION_PREFIX = 'Gerada por IA';

export type { Verdict } from '../ai/verify';

export interface DraftInput {
  question: string;
  answer: string;
  difficulty: string;
  sourcePage?: number | null;
}

/** Guarda os rascunhos de uma geração (quem chama cuida da transação). Devolve os ids, na ordem. */
export function insertDrafts(
  db: DatabaseSync,
  userId: string,
  target: { collectionId: string; documentId: string | null; topicId: string | null },
  cards: DraftInput[],
  now: Date = new Date(),
): string[] {
  const insert = db.prepare(
    `INSERT INTO ai_card_drafts (id, user_id, collection_id, document_id, topic_id, question, answer, difficulty, source_page, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const stamp = now.toISOString();
  return cards.map((card) => {
    const id = crypto.randomUUID();
    insert.run(id, userId, target.collectionId, target.documentId, target.topicId, card.question, card.answer, card.difficulty, card.sourcePage ?? null, stamp);
    return id;
  });
}

export function countDrafts(db: DatabaseSync, userId: string): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM ai_card_drafts WHERE user_id = ?').get(userId) as unknown as { n: number }).n;
}

/** Quantos rascunhos cada tópico de um concurso tem (só os que têm). */
export function draftCountsByTopic(db: DatabaseSync, userId: string, examId: string): Record<string, number> {
  const rows = db
    .prepare(
      `SELECT t.id AS topic_id, COUNT(*) AS n
       FROM ai_card_drafts d
       JOIN exam_topics t ON t.id = d.topic_id
       JOIN exam_disciplines x ON x.id = t.discipline_id
       WHERE d.user_id = ? AND x.exam_id = ?
       GROUP BY t.id`,
    )
    .all(userId, examId) as unknown as { topic_id: string; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.topic_id, r.n]));
}

export interface DraftView {
  id: string;
  question: string;
  answer: string;
  difficulty: string;
  verdict: Verdict | null;
  verdictNote: string | null;
}

export interface DraftGroup {
  collection: { id: string; name: string; subject: string };
  /** O tópico do edital para o qual os cartões foram gerados; `null` se ele foi apagado. */
  topic: { id: string; title: string; discipline: string; examId: string; examName: string } | null;
  drafts: DraftView[];
}

const toVerdict = (value: unknown): Verdict | null => (value === 'ok' || value === 'duvida' || value === 'erro' ? value : null);

/** Os rascunhos do usuário, agrupados por coleção (a de cartões mais recente primeiro) e na ordem em que a IA os escreveu. */
export function listDraftGroups(db: DatabaseSync, userId: string): DraftGroup[] {
  const rows = db
    .prepare(
      `SELECT d.id, d.question, d.answer, d.difficulty, d.verdict, d.verdict_note, d.created_at,
              c.id AS collection_id, c.name AS collection_name, c.subject AS collection_subject,
              t.id AS topic_id, t.title AS topic_title, x.name AS discipline, e.id AS exam_id, e.name AS exam_name
       FROM ai_card_drafts d
       JOIN collections c ON c.id = d.collection_id
       LEFT JOIN exam_topics t ON t.id = d.topic_id
       LEFT JOIN exam_disciplines x ON x.id = t.discipline_id
       LEFT JOIN exams e ON e.id = x.exam_id
       WHERE d.user_id = ?
       ORDER BY d.created_at DESC, c.id, d.rowid`,
    )
    .all(userId) as unknown as {
    id: string;
    question: string;
    answer: string;
    difficulty: string;
    verdict: string | null;
    verdict_note: string | null;
    collection_id: string;
    collection_name: string;
    collection_subject: string;
    topic_id: string | null;
    topic_title: string | null;
    discipline: string | null;
    exam_id: string | null;
    exam_name: string | null;
  }[];

  const groups = new Map<string, DraftGroup>();
  for (const row of rows) {
    let group = groups.get(row.collection_id);
    if (!group) {
      group = {
        collection: { id: row.collection_id, name: row.collection_name, subject: row.collection_subject },
        topic:
          row.topic_id && row.topic_title && row.discipline && row.exam_id && row.exam_name
            ? { id: row.topic_id, title: row.topic_title, discipline: row.discipline, examId: row.exam_id, examName: row.exam_name }
            : null,
        drafts: [],
      };
      groups.set(row.collection_id, group);
    }
    group.drafts.push({ id: row.id, question: row.question, answer: row.answer, difficulty: row.difficulty, verdict: toVerdict(row.verdict), verdictNote: row.verdict_note });
  }
  return [...groups.values()];
}

const clean = (text: unknown): string | null => (typeof text === 'string' ? text.replace(/\r\n/g, '\n').trim() : null);

/** Troca a pergunta e/ou a resposta de um rascunho. Editar apaga a segunda opinião: ela valia para o texto antigo. */
export function editDraft(db: DatabaseSync, userId: string, id: string, patch: { question?: unknown; answer?: unknown }): Result<DraftView> {
  const row = db
    .prepare('SELECT question, answer, difficulty, verdict, verdict_note FROM ai_card_drafts WHERE id = ? AND user_id = ?')
    .get(id, userId) as unknown as { question: string; answer: string; difficulty: string; verdict: string | null; verdict_note: string | null } | undefined;
  if (!row) return fail(404, 'Cartão não encontrado.');

  const question = patch.question === undefined ? row.question : clean(patch.question);
  const answer = patch.answer === undefined ? row.answer : clean(patch.answer);
  if (!question || !answer) return fail(400, 'A pergunta e a resposta não podem ficar vazias.');
  if (question.length > MAX_DRAFT_CHARS || answer.length > MAX_DRAFT_CHARS) return fail(400, `Cada lado do cartão tem no máximo ${MAX_DRAFT_CHARS} caracteres.`);

  const changed = question !== row.question || answer !== row.answer;
  if (changed) db.prepare('UPDATE ai_card_drafts SET question = ?, answer = ?, verdict = NULL, verdict_note = NULL WHERE id = ?').run(question, answer, id);
  return ok({
    id,
    question,
    answer,
    difficulty: row.difficulty,
    verdict: changed ? null : toVerdict(row.verdict),
    verdictNote: changed ? null : row.verdict_note,
  });
}

export type Selector = { ids?: unknown; collectionId?: unknown };

/** Os ids dos rascunhos do usuário que o pedido escolhe: uma lista de ids ou todos de uma coleção. */
function selectDrafts(db: DatabaseSync, userId: string, selector: Selector): Result<{ id: string; collection_id: string }[]> {
  if (typeof selector.collectionId === 'string' && selector.collectionId) {
    const rows = db
      .prepare('SELECT id, collection_id FROM ai_card_drafts WHERE user_id = ? AND collection_id = ? ORDER BY created_at, rowid')
      .all(userId, selector.collectionId) as unknown as { id: string; collection_id: string }[];
    return ok(rows);
  }
  const ids = selector.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_BATCH || !ids.every((x) => typeof x === 'string' && x.length > 0 && x.length <= 64)) {
    return fail(400, 'Escolha os cartões.');
  }
  const unique = [...new Set(ids as string[])];
  const rows = db
    .prepare(`SELECT id, collection_id FROM ai_card_drafts WHERE user_id = ? AND id IN (${unique.map(() => '?').join(', ')}) ORDER BY created_at, rowid`)
    .all(userId, ...unique) as unknown as { id: string; collection_id: string }[];
  return ok(rows);
}

/**
 * Uma coleção criada só para rascunhos que ficou sem cartões e sem rascunhos (o usuário descartou tudo) não
 * tem mais razão de existir: sai, e com ela o vínculo ao tópico, que volta a poder receber cartões novos.
 * Coleções do usuário (sem a descrição de geração por IA) nunca são apagadas aqui.
 */
function removeEmptyGeneratedCollections(db: DatabaseSync, userId: string, collectionIds: string[]): void {
  for (const id of new Set(collectionIds)) {
    const empty = db
      .prepare(
        `SELECT 1 FROM collections c
         WHERE c.id = ? AND c.user_id = ? AND c.description LIKE ?
           AND NOT EXISTS (SELECT 1 FROM flashcards f WHERE f.collection_id = c.id)
           AND NOT EXISTS (SELECT 1 FROM ai_card_drafts d WHERE d.collection_id = c.id)`,
      )
      .get(id, userId, `${GENERATED_DESCRIPTION_PREFIX}%`);
    if (empty) db.prepare('DELETE FROM collections WHERE id = ? AND user_id = ?').run(id, userId);
  }
}

function inTransaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

const sameQuestion = (a: string, b: string) => a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Aprova rascunhos: cada um vira um cartão comum na coleção do tópico (entra na fila de estudo) e sai da
 * lista. Um cartão cuja pergunta já existe na coleção não é duplicado (o rascunho some do mesmo jeito).
 */
export function approveDrafts(db: DatabaseSync, userId: string, selector: Selector, now: Date = new Date()): Result<{ approved: number; duplicates: number }> {
  const selected = selectDrafts(db, userId, selector);
  if (!selected.ok) return selected;
  if (selected.value.length === 0) return fail(404, 'Cartões não encontrados.');

  return ok(
    inTransaction(db, () => {
      let approved = 0;
      let duplicates = 0;
      const touched: string[] = [];
      for (const { id } of selected.value) {
        const d = db.prepare('SELECT * FROM ai_card_drafts WHERE id = ? AND user_id = ?').get(id, userId) as unknown as {
          collection_id: string;
          document_id: string | null;
          question: string;
          answer: string;
          difficulty: string;
          source_page: number | null;
          created_at: string;
        };
        const existing = db.prepare('SELECT question FROM flashcards WHERE collection_id = ?').all(d.collection_id) as unknown as { question: string }[];
        if (existing.some((f) => sameQuestion(f.question, d.question))) {
          duplicates++;
        } else {
          db.prepare(
            'INSERT INTO flashcards (id, collection_id, document_id, question, answer, difficulty, source_page, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          ).run(crypto.randomUUID(), d.collection_id, d.document_id, d.question, d.answer, d.difficulty, d.source_page, d.created_at);
          approved++;
        }
        db.prepare('DELETE FROM ai_card_drafts WHERE id = ?').run(id);
        touched.push(d.collection_id);
      }
      for (const collectionId of new Set(touched)) db.prepare('UPDATE collections SET updated_at = ? WHERE id = ?').run(now.toISOString(), collectionId);
      removeEmptyGeneratedCollections(db, userId, touched);
      return { approved, duplicates };
    }),
  );
}

/** Descarta rascunhos (apaga de vez). Se uma coleção de IA ficar vazia, ela sai também. */
export function discardDrafts(db: DatabaseSync, userId: string, selector: Selector): Result<{ discarded: number }> {
  const selected = selectDrafts(db, userId, selector);
  if (!selected.ok) return selected;
  if (selected.value.length === 0) return fail(404, 'Cartões não encontrados.');

  return ok(
    inTransaction(db, () => {
      for (const { id } of selected.value) db.prepare('DELETE FROM ai_card_drafts WHERE id = ? AND user_id = ?').run(id, userId);
      removeEmptyGeneratedCollections(db, userId, selected.value.map((d) => d.collection_id));
      return { discarded: selected.value.length };
    }),
  );
}

// ---------- segunda opinião de outra IA ----------

/** Quantos cartões uma conferência pega de uma vez: o resto fica para uma nova rodada (cada lote é uma chamada de IA). */
export const MAX_VERIFY_DRAFTS = 60;

/** Quem confere: a cadeia de provedores de IA no app, um falso nos testes. */
export type DraftVerifier = (sources: VerifySource[], context: string) => Promise<VerifiedCard[]>;

export interface VerifyOutcome {
  /** Cartões que receberam um veredito agora. */
  checked: number;
  /** Cartões que ficaram sem conferência (a IA não os devolveu, ou a conferência parou por erro). */
  unchecked: number;
  counts: Record<Verdict, number>;
  /** Por que parou antes do fim (cota, rede...), se parou; o que já foi conferido fica guardado. */
  error: string | null;
}

/** O contexto que a IA recebe sobre a prova de uma coleção de rascunhos: concurso, cargo, banca, disciplina e tópico. */
function examContext(db: DatabaseSync, userId: string, collectionId: string): string {
  const row = db
    .prepare(
      `SELECT e.name AS exam, e.position AS position, e.board AS board, x.name AS discipline, t.title AS topic
       FROM ai_card_drafts d
       JOIN exam_topics t ON t.id = d.topic_id
       JOIN exam_disciplines x ON x.id = t.discipline_id
       JOIN exams e ON e.id = x.exam_id
       WHERE d.user_id = ? AND d.collection_id = ? LIMIT 1`,
    )
    .get(userId, collectionId) as unknown as { exam: string; position: string; board: string; discipline: string; topic: string } | undefined;
  if (!row) return '';
  const squash = (text: string) => text.replace(/\s+/g, ' ').trim();
  return [`concurso ${squash(row.exam)}`, row.position && `cargo ${squash(row.position)}`, row.board && `banca ${squash(row.board)}`, `disciplina ${squash(row.discipline)}`, `tópico "${squash(row.topic)}"`]
    .filter(Boolean)
    .join(', ');
}

/**
 * Pede a outra IA que confira os rascunhos escolhidos e guarda o veredito de cada um (ok, dúvida ou erro, com o
 * motivo). Os cartões vão em lotes, da mesma coleção (assim o contexto da prova é um só). Se um lote falha, para: o
 * que já foi conferido fica, e o resto segue sem conferência. Um rascunho editado enquanto a IA trabalhava não recebe
 * o veredito (ele valia para o texto antigo). O veredito é só um alerta: nada é aprovado nem descartado por ele.
 */
export async function verifyDrafts(db: DatabaseSync, userId: string, selector: Selector, verify: DraftVerifier): Promise<Result<VerifyOutcome>> {
  const selected = selectDrafts(db, userId, selector);
  if (!selected.ok) return selected;
  if (selected.value.length === 0) return fail(404, 'Cartões não encontrados.');
  if (selected.value.length > MAX_VERIFY_DRAFTS) return fail(400, `Confira até ${MAX_VERIFY_DRAFTS} cartões por vez.`);

  const rows = selected.value.map(
    ({ id }) => db.prepare('SELECT id, collection_id, question, answer FROM ai_card_drafts WHERE id = ? AND user_id = ?').get(id, userId) as unknown as { id: string; collection_id: string; question: string; answer: string },
  );
  const byCollection = new Map<string, typeof rows>();
  for (const row of rows) byCollection.set(row.collection_id, [...(byCollection.get(row.collection_id) ?? []), row]);

  const outcome: VerifyOutcome = { checked: 0, unchecked: 0, counts: { ok: 0, duvida: 0, erro: 0 }, error: null };
  const save = db.prepare('UPDATE ai_card_drafts SET verdict = ?, verdict_note = ? WHERE id = ? AND user_id = ? AND question = ? AND answer = ?');

  for (const [collectionId, group] of byCollection) {
    const context = examContext(db, userId, collectionId);
    for (let start = 0; start < group.length; start += MAX_VERIFY_PER_CALL) {
      const batch = group.slice(start, start + MAX_VERIFY_PER_CALL);
      if (outcome.error) {
        outcome.unchecked += batch.length;
        continue;
      }
      try {
        const checks = await verify(batch.map((row, i) => ({ n: i + 1, question: row.question, answer: row.answer })), context);
        const byNumber = new Map(checks.map((c) => [c.n, c]));
        batch.forEach((row, i) => {
          const check = byNumber.get(i + 1);
          const saved = check ? Number(save.run(check.verdict, check.note || null, row.id, userId, row.question, row.answer).changes) : 0;
          if (check && saved > 0) {
            outcome.checked++;
            outcome.counts[check.verdict]++;
          } else {
            outcome.unchecked++;
          }
        });
      } catch (err) {
        outcome.error = err instanceof Error ? err.message : 'Não foi possível conferir os cartões.';
        outcome.unchecked += batch.length;
      }
    }
  }
  return ok(outcome);
}
