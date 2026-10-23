import crypto from 'node:crypto';

import express, { type Request, type Response } from 'express';
import multer, { type FileFilterCallback } from 'multer';

import { db } from '../db';
import { requireAuth, type AuthedRequest } from '../auth/middleware';
import { notFrozen } from '../collections/frozen';
import { extractSyllabus, generateFlashcards, MAX_SYLLABUS_CHARS } from '../ai/router';
import { withUsageContext } from '../ai/usage';
import { mockExamFromDiscipline } from '../mockexams/fromDiscipline';
import { fail } from '../mockexams/store';
import { generateTopicCards } from './topicCards';
import { draftCountsByTopic } from '../aireview/store';
import { LIMITS, normalizeDraft, type ExamDraft } from './draft';
import {
  buildExamProgress,
  daysUntil,
  type CollectionStat,
  type ExamStructure,
  type TopicLinks,
} from './progress';
import { STRONG_SCORE, suggestCollections } from './suggest';
import { buildUnlinked, loadIgnoredIds, setCollectionIgnored } from './unlinked';

export const examsRouter = express.Router();
examsRouter.use(requireAuth);

const MIN_PASTED_CHARS = 40;
const MAX_PDF_BYTES = 30 * 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PDF_BYTES },
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    if (file.mimetype !== 'application/pdf') {
      cb(new Error('Envie o edital em PDF, ou cole o texto do conteúdo programático.'));
      return;
    }
    cb(null, true);
  },
});

interface ExamRow {
  id: string;
  user_id: string;
  name: string;
  position: string;
  board: string;
  exam_date: string | null;
  created_at: string;
  updated_at: string;
}

function loadOwnedExam(userId: string, examId: string): ExamRow | null {
  const row = db.prepare('SELECT * FROM exams WHERE id = ? AND user_id = ?').get(examId, userId) as unknown as
    | ExamRow
    | undefined;
  return row ?? null;
}

// O driver é síncrono e há uma única conexão: tudo entre BEGIN e COMMIT roda
// sem `await`, então nada de outra requisição se mistura na transação.
function inTransaction<T>(work: () => T): T {
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

// ---------- leitura ----------

function loadStructure(examId: string): { structure: ExamStructure; links: TopicLinks } {
  const disciplineRows = db
    .prepare(
      'SELECT id, name, question_count, weight, cutoff FROM exam_disciplines WHERE exam_id = ? ORDER BY position',
    )
    .all(examId) as unknown as {
    id: string;
    name: string;
    question_count: number | null;
    weight: number | null;
    cutoff: string;
  }[];

  const topicRows = db
    .prepare(
      `SELECT t.id, t.discipline_id, t.title
       FROM exam_topics t JOIN exam_disciplines d ON d.id = t.discipline_id
       WHERE d.exam_id = ? ORDER BY t.position`,
    )
    .all(examId) as unknown as { id: string; discipline_id: string; title: string }[];

  const topicsByDiscipline = new Map<string, { id: string; title: string }[]>();
  for (const t of topicRows) {
    const list = topicsByDiscipline.get(t.discipline_id) ?? [];
    list.push({ id: t.id, title: t.title });
    topicsByDiscipline.set(t.discipline_id, list);
  }

  const linkRows = db
    .prepare(
      `SELECT l.topic_id, l.collection_id
       FROM exam_topic_collections l
       JOIN exam_topics t ON t.id = l.topic_id
       JOIN exam_disciplines d ON d.id = t.discipline_id
       WHERE d.exam_id = ?`,
    )
    .all(examId) as unknown as { topic_id: string; collection_id: string }[];
  const links: TopicLinks = new Map();
  for (const l of linkRows) links.set(l.topic_id, [...(links.get(l.topic_id) ?? []), l.collection_id]);

  return {
    structure: {
      disciplines: disciplineRows.map((d) => ({
        id: d.id,
        name: d.name,
        questionCount: d.question_count,
        weight: d.weight,
        cutoff: d.cutoff,
        topics: topicsByDiscipline.get(d.id) ?? [],
      })),
    },
    links,
  };
}

interface UserCollection {
  id: string;
  name: string;
  subject: string;
  cards: number;
}

function loadCollectionStats(userId: string, now: Date): { stats: CollectionStat[]; collections: UserCollection[] } {
  const rows = db
    .prepare(
      `SELECT c.id, c.name, c.subject,
              COUNT(f.id) AS cards,
              COALESCE(SUM(CASE WHEN f.due_at IS NULL THEN 1 ELSE 0 END), 0) AS new_cards,
              COALESCE(SUM(CASE WHEN f.due_at IS NOT NULL AND f.due_at <= ? AND ${notFrozen('c.id')} THEN 1 ELSE 0 END), 0) AS due_cards
       FROM collections c LEFT JOIN flashcards f ON f.collection_id = c.id
       WHERE c.user_id = ?
       GROUP BY c.id
       ORDER BY c.name, c.subject`,
    )
    .all(now.toISOString(), userId) as unknown as {
    id: string;
    name: string;
    subject: string;
    cards: number;
    new_cards: number;
    due_cards: number;
  }[];

  const windowStart = new Date(now.getTime() - 30 * DAY_MS).toISOString();
  const reviewRows = db
    .prepare(
      `SELECT f.collection_id AS id, COUNT(*) AS reviews,
              COALESCE(SUM(CASE WHEN ss.result != 'errei' THEN 1 ELSE 0 END), 0) AS passed
       FROM study_sessions ss JOIN flashcards f ON f.id = ss.flashcard_id
       WHERE ss.user_id = ? AND ss.studied_at >= ?
       GROUP BY f.collection_id`,
    )
    .all(userId, windowStart) as unknown as { id: string; reviews: number; passed: number }[];
  const reviews = new Map(reviewRows.map((r) => [r.id, r]));

  return {
    collections: rows.map((c) => ({ id: c.id, name: c.name, subject: c.subject, cards: c.cards })),
    stats: rows.map((c) => ({
      id: c.id,
      cards: c.cards,
      newCards: c.new_cards,
      dueCards: c.due_cards,
      reviews30: reviews.get(c.id)?.reviews ?? 0,
      passed30: reviews.get(c.id)?.passed ?? 0,
    })),
  };
}

function examHeader(row: ExamRow, now: Date) {
  return {
    id: row.id,
    name: row.name,
    position: row.position,
    board: row.board,
    examDate: row.exam_date,
    daysLeft: daysUntil(row.exam_date, now),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

examsRouter.get('/', (req: AuthedRequest, res: Response) => {
  const now = new Date();
  const rows = db
    .prepare('SELECT * FROM exams WHERE user_id = ? ORDER BY created_at DESC')
    .all(req.userId!) as unknown as ExamRow[];
  const { stats } = loadCollectionStats(req.userId!, now);

  const exams = rows.map((row) => {
    const { structure, links } = loadStructure(row.id);
    return { ...examHeader(row, now), overall: buildExamProgress(structure, links, stats).overall };
  });
  res.json({ success: true, exams });
});

examsRouter.get('/:id', (req: AuthedRequest, res: Response) => {
  const row = loadOwnedExam(req.userId!, req.params.id);
  if (!row) {
    res.status(404).json({ success: false, error: 'Concurso não encontrado.' });
    return;
  }
  const now = new Date();
  const { structure, links } = loadStructure(row.id);
  const { stats, collections } = loadCollectionStats(req.userId!, now);
  const progress = buildExamProgress(structure, links, stats);

  // Só tópicos sem nenhum vínculo recebem sugestão — quem já foi vinculado
  // não precisa de palpite. `strong` marca as que valem aceitar em lote.
  const suggestions: Record<string, { collectionId: string; score: number; strong: boolean }[]> = {};
  for (const discipline of progress.disciplines) {
    for (const topic of discipline.topics) {
      if (topic.collectionIds.length > 0) continue;
      const found = suggestCollections(topic.title, collections);
      if (found.length > 0) {
        suggestions[topic.id] = found.map((s) => ({ ...s, strong: s.score >= STRONG_SCORE }));
      }
    }
  }

  // Quantos cartões da IA cada tópico tem esperando conferência (ainda não são material: não entram na cobertura).
  const drafts = draftCountsByTopic(db, req.userId!, row.id);

  // O caminho contrário das sugestões acima: as coleções que não estão ligadas a nenhum tópico deste concurso, e os tópicos que
  // combinam com cada uma. As marcadas como "não é deste concurso" ficam à parte.
  const statsById = new Map(stats.map((s) => [s.id, s]));
  const { unlinked: unlinkedCollections, ignored: ignoredCollections } = buildUnlinked({
    collections: collections.map((c) => ({ id: c.id, name: c.name, subject: c.subject, cards: c.cards, newCards: statsById.get(c.id)?.newCards ?? 0, dueCards: statsById.get(c.id)?.dueCards ?? 0 })),
    topics: progress.disciplines.flatMap((d) => d.topics.map((t) => ({ id: t.id, title: t.title, discipline: d.name, hasMaterial: t.collectionIds.length > 0 }))),
    linkedCollectionIds: new Set(progress.disciplines.flatMap((d) => d.topics.flatMap((t) => t.collectionIds))),
    ignoredIds: loadIgnoredIds(db, row.id),
  });

  res.json({ success: true, exam: examHeader(row, now), ...progress, suggestions, collections, drafts, unlinkedCollections, ignoredCollections });
});

// ---------- análise do edital (IA) ----------

function parsePositionHint(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, LIMITS.meta) : '';
}

function draftFromAi(raw: unknown): ExamDraft {
  const { draft } = normalizeDraft(raw);
  if (draft.disciplines.length === 0) {
    throw new Error(
      'Não encontrei disciplinas e tópicos nesse documento. Confira se ele traz o conteúdo programático do edital.',
    );
  }
  return draft;
}

examsRouter.post('/extract/text', async (req: AuthedRequest, res: Response) => {
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (text.length < MIN_PASTED_CHARS) {
    res.status(400).json({ success: false, error: 'Cole o trecho do edital com o conteúdo programático.' });
    return;
  }
  if (text.length > MAX_SYLLABUS_CHARS) {
    res.status(400).json({
      success: false,
      error: `O texto passa de ${MAX_SYLLABUS_CHARS.toLocaleString('pt-BR')} caracteres. Cole apenas o conteúdo programático.`,
    });
    return;
  }

  try {
    const raw = await withUsageContext({ userId: req.userId!, feature: 'exam' }, () =>
      extractSyllabus({ type: 'text', text }, parsePositionHint(req.body?.position)),
    );
    res.json({ success: true, draft: draftFromAi(raw) });
  } catch (err) {
    res.status(422).json({ success: false, error: err instanceof Error ? err.message : 'Falha ao analisar o edital.' });
  }
});

examsRouter.post('/extract/file', upload.single('file'), async (req: AuthedRequest, res: Response) => {
  if (!req.file) {
    res.status(400).json({ success: false, error: 'Envie o PDF do edital.' });
    return;
  }
  const file = req.file;

  try {
    const raw = await withUsageContext({ userId: req.userId!, feature: 'exam' }, () =>
      extractSyllabus(
        { type: 'file', buffer: file.buffer, mimeType: file.mimetype },
        parsePositionHint(req.body?.position),
      ),
    );
    res.json({ success: true, draft: draftFromAi(raw) });
  } catch (err) {
    res.status(422).json({ success: false, error: err instanceof Error ? err.message : 'Falha ao analisar o edital.' });
  }
});

// ---------- criar, editar, apagar ----------

function validateDraft(body: unknown): { draft: ExamDraft } | { error: string } {
  const { draft, truncated } = normalizeDraft(body);
  if (draft.name.length < 2) return { error: 'Informe um nome para o concurso.' };
  if (truncated) {
    return {
      error: `Passou do limite de ${LIMITS.disciplines} disciplinas, ${LIMITS.topicsPerDiscipline} tópicos por disciplina ou ${LIMITS.totalTopics} no total.`,
    };
  }
  return { draft };
}

// Grava a estrutura preservando os ids que já existem — é o que mantém os
// vínculos de um tópico quando ele só foi renomeado ou mudou de lugar. O que
// não veio na lista é apagado (e leva junto seus vínculos).
function saveStructure(examId: string, draft: ExamDraft): void {
  const existingDisciplines = new Set(
    (db.prepare('SELECT id FROM exam_disciplines WHERE exam_id = ?').all(examId) as unknown as { id: string }[]).map(
      (r) => r.id,
    ),
  );
  const existingTopics = new Set(
    (
      db
        .prepare(
          'SELECT t.id FROM exam_topics t JOIN exam_disciplines d ON d.id = t.discipline_id WHERE d.exam_id = ?',
        )
        .all(examId) as unknown as { id: string }[]
    ).map((r) => r.id),
  );
  const keptDisciplines = new Set<string>();
  const keptTopics = new Set<string>();

  draft.disciplines.forEach((discipline, disciplineIndex) => {
    let disciplineId = discipline.id && existingDisciplines.has(discipline.id) ? discipline.id : null;
    if (disciplineId && keptDisciplines.has(disciplineId)) disciplineId = null; // id repetido no pedido
    if (disciplineId) {
      db.prepare(
        'UPDATE exam_disciplines SET name = ?, question_count = ?, weight = ?, cutoff = ?, position = ? WHERE id = ?',
      ).run(discipline.name, discipline.questionCount, discipline.weight, discipline.cutoff, disciplineIndex, disciplineId);
    } else {
      disciplineId = crypto.randomUUID();
      db.prepare(
        'INSERT INTO exam_disciplines (id, exam_id, name, question_count, weight, cutoff, position) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(disciplineId, examId, discipline.name, discipline.questionCount, discipline.weight, discipline.cutoff, disciplineIndex);
    }
    keptDisciplines.add(disciplineId);

    discipline.topics.forEach((topic, topicIndex) => {
      let topicId = topic.id && existingTopics.has(topic.id) ? topic.id : null;
      if (topicId && keptTopics.has(topicId)) topicId = null;
      if (topicId) {
        db.prepare('UPDATE exam_topics SET discipline_id = ?, title = ?, position = ? WHERE id = ?').run(
          disciplineId,
          topic.title,
          topicIndex,
          topicId,
        );
      } else {
        topicId = crypto.randomUUID();
        db.prepare('INSERT INTO exam_topics (id, discipline_id, title, position) VALUES (?, ?, ?, ?)').run(
          topicId,
          disciplineId,
          topic.title,
          topicIndex,
        );
      }
      keptTopics.add(topicId);
    });
  });

  // Tópicos primeiro: um tópico que mudou de disciplina já foi atualizado
  // acima e não pode ser levado junto com a disciplina antiga.
  for (const id of existingTopics) {
    if (!keptTopics.has(id)) db.prepare('DELETE FROM exam_topics WHERE id = ?').run(id);
  }
  for (const id of existingDisciplines) {
    if (!keptDisciplines.has(id)) db.prepare('DELETE FROM exam_disciplines WHERE id = ?').run(id);
  }
}

examsRouter.post('/', (req: AuthedRequest, res: Response) => {
  const validated = validateDraft(req.body);
  if ('error' in validated) {
    res.status(400).json({ success: false, error: validated.error });
    return;
  }
  const { draft } = validated;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  inTransaction(() => {
    db.prepare(
      'INSERT INTO exams (id, user_id, name, position, board, exam_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(id, req.userId!, draft.name, draft.position, draft.board, draft.examDate, now, now);
    saveStructure(id, draft);
  });
  res.status(201).json({ success: true, id });
});

examsRouter.put('/:id', (req: AuthedRequest, res: Response) => {
  const row = loadOwnedExam(req.userId!, req.params.id);
  if (!row) {
    res.status(404).json({ success: false, error: 'Concurso não encontrado.' });
    return;
  }
  const validated = validateDraft(req.body);
  if ('error' in validated) {
    res.status(400).json({ success: false, error: validated.error });
    return;
  }
  const { draft } = validated;

  inTransaction(() => {
    db.prepare('UPDATE exams SET name = ?, position = ?, board = ?, exam_date = ?, updated_at = ? WHERE id = ?').run(
      draft.name,
      draft.position,
      draft.board,
      draft.examDate,
      new Date().toISOString(),
      row.id,
    );
    saveStructure(row.id, draft);
  });
  res.json({ success: true });
});

examsRouter.delete('/:id', (req: AuthedRequest, res: Response) => {
  const row = loadOwnedExam(req.userId!, req.params.id);
  if (!row) {
    res.status(404).json({ success: false, error: 'Concurso não encontrado.' });
    return;
  }
  db.prepare('DELETE FROM exams WHERE id = ?').run(row.id);
  res.json({ success: true });
});

// ---------- vínculos tópico ↔ coleção ----------

function parseIdList(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const ids = raw.filter((v): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64);
  return ids.length === raw.length ? [...new Set(ids)] : null;
}

/** As coleções precisam ser do próprio usuário — nunca se vincula a coleção alheia. */
function allOwnedCollections(userId: string, collectionIds: string[]): boolean {
  if (collectionIds.length === 0) return true;
  const placeholders = collectionIds.map(() => '?').join(',');
  const found = db
    .prepare(`SELECT COUNT(*) AS n FROM collections WHERE user_id = ? AND id IN (${placeholders})`)
    .get(userId, ...collectionIds) as unknown as { n: number };
  return found.n === collectionIds.length;
}

function topicBelongsToExam(examId: string, topicId: string): boolean {
  const row = db
    .prepare(
      'SELECT 1 AS ok FROM exam_topics t JOIN exam_disciplines d ON d.id = t.discipline_id WHERE t.id = ? AND d.exam_id = ?',
    )
    .get(topicId, examId);
  return !!row;
}

examsRouter.put('/:id/topics/:topicId/collections', (req: AuthedRequest, res: Response) => {
  const exam = loadOwnedExam(req.userId!, req.params.id);
  if (!exam || !topicBelongsToExam(exam.id, req.params.topicId)) {
    res.status(404).json({ success: false, error: 'Tópico não encontrado.' });
    return;
  }
  const collectionIds = parseIdList(req.body?.collectionIds);
  if (!collectionIds || !allOwnedCollections(req.userId!, collectionIds)) {
    res.status(400).json({ success: false, error: 'Coleção inválida.' });
    return;
  }

  inTransaction(() => {
    db.prepare('DELETE FROM exam_topic_collections WHERE topic_id = ?').run(req.params.topicId);
    for (const collectionId of collectionIds) {
      db.prepare('INSERT INTO exam_topic_collections (topic_id, collection_id) VALUES (?, ?)').run(
        req.params.topicId,
        collectionId,
      );
    }
  });
  res.json({ success: true });
});

// Gera, por IA, os cartões de um tópico que ainda não tem material: uma coleção nova, já ligada a ele.
// Uma chamada de IA por tópico; quem decide quando e quantos é sempre o usuário.
examsRouter.post('/:id/topics/:topicId/cards', async (req: AuthedRequest, res: Response) => {
  const result = await withUsageContext({ userId: req.userId!, feature: 'flashcards' }, () =>
    generateTopicCards(db, req.userId!, req.params.id, req.params.topicId, req.body?.quantity, async (topic, options) =>
      generateFlashcards({ type: 'topic', topic }, options),
    ),
  ).catch((err: unknown) => fail(422, err instanceof Error ? err.message : 'Falha ao gerar os cartões.'));
  if (!result.ok) {
    res.status(result.status).json({ success: false, error: result.error });
    return;
  }
  res.status(201).json({ success: true, ...result.value });
});

// Cria (ou atualiza) o simulado da disciplina com os cartões das coleções ligadas aos tópicos dela.
examsRouter.post('/:id/disciplines/:disciplineId/mock-exam', (req: AuthedRequest, res: Response) => {
  const result = mockExamFromDiscipline(db, req.userId!, req.params.id, req.params.disciplineId);
  if (!result.ok) {
    res.status(result.status).json({ success: false, error: result.error });
    return;
  }
  res.status(result.value.created ? 201 : 200).json({ success: true, ...result.value });
});

// Só acrescenta (nunca remove): é o que "aceitar sugestões" usa, em lote.
examsRouter.post('/:id/links', (req: AuthedRequest, res: Response) => {
  const exam = loadOwnedExam(req.userId!, req.params.id);
  if (!exam) {
    res.status(404).json({ success: false, error: 'Concurso não encontrado.' });
    return;
  }
  const rawLinks: unknown = req.body?.links;
  if (!Array.isArray(rawLinks) || rawLinks.length > LIMITS.totalTopics) {
    res.status(400).json({ success: false, error: 'Vínculos inválidos.' });
    return;
  }

  const links: { topicId: string; collectionIds: string[] }[] = [];
  for (const item of rawLinks) {
    const topicId = typeof item?.topicId === 'string' ? item.topicId : '';
    const collectionIds = parseIdList(item?.collectionIds);
    if (!topicId || !collectionIds || !topicBelongsToExam(exam.id, topicId) || !allOwnedCollections(req.userId!, collectionIds)) {
      res.status(400).json({ success: false, error: 'Vínculos inválidos.' });
      return;
    }
    links.push({ topicId, collectionIds });
  }

  let added = 0;
  inTransaction(() => {
    for (const { topicId, collectionIds } of links) {
      for (const collectionId of collectionIds) {
        const result = db
          .prepare('INSERT OR IGNORE INTO exam_topic_collections (topic_id, collection_id) VALUES (?, ?)')
          .run(topicId, collectionId);
        added += Number(result.changes);
      }
    }
  });
  res.json({ success: true, added });
});

// "Esta coleção não é deste concurso": ela sai da lista de coleções soltas dele (e volta com o DELETE). Pedir de novo é inofensivo.
examsRouter.put('/:id/ignored-collections/:collectionId', (req: AuthedRequest, res: Response) => {
  const exam = loadOwnedExam(req.userId!, req.params.id);
  if (!exam) {
    res.status(404).json({ success: false, error: 'Concurso não encontrado.' });
    return;
  }
  if (!allOwnedCollections(req.userId!, [req.params.collectionId])) {
    res.status(404).json({ success: false, error: 'Coleção não encontrada.' });
    return;
  }
  setCollectionIgnored(db, exam.id, req.params.collectionId, true);
  res.json({ success: true });
});

examsRouter.delete('/:id/ignored-collections/:collectionId', (req: AuthedRequest, res: Response) => {
  const exam = loadOwnedExam(req.userId!, req.params.id);
  if (!exam) {
    res.status(404).json({ success: false, error: 'Concurso não encontrado.' });
    return;
  }
  setCollectionIgnored(db, exam.id, req.params.collectionId, false);
  res.json({ success: true });
});
