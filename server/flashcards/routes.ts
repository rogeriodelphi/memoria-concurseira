import crypto from 'node:crypto';

import express, { type Response } from 'express';

import { db } from '../db';
import { explainCard } from '../ai/router';
import { withUsageContext } from '../ai/usage';
import { requireAuth, type AuthedRequest } from '../auth/middleware';
import { notFrozen } from '../collections/frozen';
import { duplicateKey } from '../duplicates';
import { mapFlashcard, type FlashcardRow } from '../mappers';
import { sanitizeFlashcardHtml } from '../sanitizeHtml';
import type { StudyResult } from '../srs';
import { MAX_REVIEW_MS } from '../stats/dashboard';
import { loadMissedCards, parseMissedQuery } from '../stats/missed';
import { loadOverdueCards } from '../stats/reviewDebt';
import { selectDueCards } from '../studyplan/store';
import { explainFlashcard } from '../tutor/explain';
import { recordStudy, undoStudy } from './study';

/** Quantas coleções cabem numa fila de "estudar a disciplina inteira". */
const MAX_DUE_COLLECTIONS = 200;

export const flashcardsRouter = express.Router();
flashcardsRouter.use(requireAuth);

function loadOwnedFlashcard(userId: string, flashcardId: string): FlashcardRow | null {
  const row = db
    .prepare(
      `SELECT f.* FROM flashcards f
       JOIN collections c ON c.id = f.collection_id
       WHERE f.id = ? AND c.user_id = ?`,
    )
    .get(flashcardId, userId) as unknown as FlashcardRow | undefined;
  return row ?? null;
}

flashcardsRouter.post('/',(req: AuthedRequest, res: Response) => {
  const { collectionId, question, answer, difficulty } = req.body ?? {};
  if (typeof collectionId !== 'string') {
    res.status(400).json({ success: false, error: 'Coleção inválida.' });
    return;
  }

  const collection = db.prepare('SELECT id, user_id FROM collections WHERE id = ?').get(collectionId) as unknown as
    | { id: string; user_id: string }
    | undefined;
  if (!collection || collection.user_id !== req.userId) {
    res.status(404).json({ success: false, error: 'Coleção não encontrada.' });
    return;
  }

  const sanitizedQuestion = typeof question === 'string' ? sanitizeFlashcardHtml(question.trim()) : '';
  const sanitizedAnswer = typeof answer === 'string' ? sanitizeFlashcardHtml(answer.trim()) : '';
  if (!sanitizedQuestion.replace(/<[^>]+>/g, '').trim() || !sanitizedAnswer.replace(/<[^>]+>/g, '').trim()) {
    res.status(400).json({ success: false, error: 'Preencha a pergunta e a resposta.' });
    return;
  }

  const nextDifficulty =
    typeof difficulty === 'string' && ['facil', 'medio', 'dificil'].includes(difficulty) ? difficulty : 'medio';

  const now = new Date().toISOString();

  // Cartões manuais de uma mesma coleção compartilham um único "documento"
  // com source_type='manual' — evita criar um registro de documento a cada
  // clique em "Novo cartão" e mantém o status da coleção (derivado do
  // último documento) como 'completed' mesmo que ela nunca tenha passado
  // por geração via IA.
  let manualDoc = db
    .prepare("SELECT id FROM documents WHERE collection_id = ? AND source_type = 'manual'")
    .get(collection.id) as { id: string } | undefined;
  let documentId: string;
  if (manualDoc) {
    documentId = manualDoc.id;
  } else {
    documentId = crypto.randomUUID();
    db.prepare(
      'INSERT INTO documents (id, collection_id, filename, size, pages, status, source_type, created_at) VALUES (?, ?, ?, 0, 0, ?, ?, ?)',
    ).run(documentId, collection.id, 'Cartões adicionados manualmente', 'completed', 'manual', now);
  }

  const flashcardId = crypto.randomUUID();
  db.prepare(
    'INSERT INTO flashcards (id, collection_id, document_id, question, answer, format, difficulty, source_page, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)',
  ).run(flashcardId, collection.id, documentId, sanitizedQuestion, sanitizedAnswer, 'html', nextDifficulty, now);

  db.prepare('UPDATE collections SET updated_at = ? WHERE id = ?').run(now, collection.id);

  const row = db.prepare('SELECT * FROM flashcards WHERE id = ?').get(flashcardId) as unknown as FlashcardRow;
  res.status(201).json({ success: true, flashcard: mapFlashcard(row) });
});

flashcardsRouter.put('/:id', (req: AuthedRequest, res: Response) => {
  const existing = loadOwnedFlashcard(req.userId!, req.params.id);
  if (!existing) {
    res.status(404).json({ success: false, error: 'Flashcard não encontrado.' });
    return;
  }

  const { question, answer, format, difficulty, favorite } = req.body ?? {};
  const nextFormat: string = format === 'html' || format === 'plain' ? format : existing.format;

  let nextQuestion = typeof question === 'string' && question.trim() ? question.trim() : existing.question;
  let nextAnswer = typeof answer === 'string' && answer.trim() ? answer.trim() : existing.answer;
  if (nextFormat === 'html') {
    // Sanitiza sempre que o formato é html — tanto quando o campo mudou
    // agora quanto quando só está sendo mantido de uma edição anterior,
    // porque conteúdo antigo não passou por essa allow-list.
    nextQuestion = sanitizeFlashcardHtml(nextQuestion);
    nextAnswer = sanitizeFlashcardHtml(nextAnswer);
  }

  const nextDifficulty =
    typeof difficulty === 'string' && ['facil', 'medio', 'dificil'].includes(difficulty)
      ? difficulty
      : existing.difficulty;
  const nextFavorite = typeof favorite === 'boolean' ? (favorite ? 1 : 0) : existing.favorite;

  db.prepare('UPDATE flashcards SET question = ?, answer = ?, format = ?, difficulty = ?, favorite = ? WHERE id = ?').run(
    nextQuestion,
    nextAnswer,
    nextFormat,
    nextDifficulty,
    nextFavorite,
    existing.id,
  );

  const row = db.prepare('SELECT * FROM flashcards WHERE id = ?').get(existing.id) as unknown as FlashcardRow;
  res.json({ success: true, flashcard: mapFlashcard(row) });
});

const STUDY_RESULTS = ['errei', 'dificil', 'bom', 'facil'] as const;

flashcardsRouter.post('/:id/study', (req: AuthedRequest, res: Response) => {
  const existing = loadOwnedFlashcard(req.userId!, req.params.id);
  if (!existing) {
    res.status(404).json({ success: false, error: 'Flashcard não encontrado.' });
    return;
  }

  const { result, durationMs } = req.body ?? {};
  if (typeof result !== 'string' || !(STUDY_RESULTS as readonly string[]).includes(result)) {
    res.status(400).json({ success: false, error: 'Resultado de estudo inválido.' });
    return;
  }

  // Tempo é opcional e só informativo (painel): um valor ausente ou absurdo
  // nunca pode impedir o registro do estudo em si.
  const duration =
    typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs >= 0
      ? Math.min(Math.round(durationMs), MAX_REVIEW_MS)
      : null;

  const { sessionId, dueAt } = recordStudy(db, req.userId!, existing, result as StudyResult, duration);

  // `sessionId` é o que a tela usa para desfazer esta avaliação ("Voltar ao cartão anterior").
  res.json({ success: true, dueAt, sessionId });
});

// O "professor": o aluno pergunta sobre o cartão e a IA responde (`{ ask?, history? }`). Só responde: nada é gravado, nem no
// cartão nem na revisão. Falha da IA (cota, rede, resposta inútil) é 422 com o motivo, como nas demais gerações.
flashcardsRouter.post('/:id/explain', async (req: AuthedRequest, res: Response) => {
  try {
    const result = await withUsageContext({ userId: req.userId!, feature: 'tutor' }, () =>
      explainFlashcard(db, req.userId!, req.params.id, req.body ?? {}, explainCard),
    );
    if (!result.ok) {
      res.status(result.status).json({ success: false, error: result.error });
      return;
    }
    res.json({ success: true, ...result.value });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Não foi possível gerar a explicação.';
    res.status(422).json({ success: false, error: message });
  }
});

flashcardsRouter.post('/:id/study/undo', (req: AuthedRequest, res: Response) => {
  const existing = loadOwnedFlashcard(req.userId!, req.params.id);
  if (!existing) {
    res.status(404).json({ success: false, error: 'Flashcard não encontrado.' });
    return;
  }
  const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : '';
  if (!sessionId) {
    res.status(400).json({ success: false, error: 'Avaliação inválida.' });
    return;
  }

  const undone = undoStudy(db, req.userId!, existing.id, sessionId);
  if (!undone.ok) {
    res.status(undone.status).json({ success: false, error: undone.error });
    return;
  }
  res.json({ success: true });
});

flashcardsRouter.post('/copy', (req: AuthedRequest, res: Response) => {
  const { flashcardIds, targetCollectionId, mode } = req.body ?? {};
  if (!Array.isArray(flashcardIds) || flashcardIds.length === 0 || typeof targetCollectionId !== 'string') {
    res.status(400).json({ success: false, error: 'Selecione ao menos um flashcard e a coleção de destino.' });
    return;
  }
  const isMove = mode === 'move';

  const target = db.prepare('SELECT id, user_id FROM collections WHERE id = ?').get(targetCollectionId) as unknown as
    | { id: string; user_id: string }
    | undefined;
  if (!target || target.user_id !== req.userId) {
    res.status(404).json({ success: false, error: 'Coleção de destino não encontrada.' });
    return;
  }

  // Carrega o conteúdo já existente na coleção de destino pra nunca criar
  // (ou mover pra dentro) um cartão idêntico a um que já está lá — "não pode
  // haver duplicidade" vale tanto pra cópia quanto pra mover.
  const existingInTarget = db
    .prepare('SELECT answer FROM flashcards WHERE collection_id = ?')
    .all(target.id) as unknown as { answer: string }[];
  const seenKeys = new Set(existingInTarget.map((f) => duplicateKey(f.answer)));

  const now = new Date().toISOString();
  const resultIds: string[] = [];
  const sourceCollectionIds = new Set<string>();
  let skippedDuplicates = 0;

  const insert = db.prepare(
    // document_id fica NULL na cópia: o documento de origem pertence à
    // coleção original, não faz sentido linkar um flashcard de outra
    // coleção a ele.
    'INSERT INTO flashcards (id, collection_id, document_id, question, answer, format, difficulty, source_page, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)',
  );
  const move = db.prepare('UPDATE flashcards SET collection_id = ?, document_id = NULL WHERE id = ?');

  for (const flashcardId of flashcardIds) {
    if (typeof flashcardId !== 'string') continue;
    const source = loadOwnedFlashcard(req.userId!, flashcardId);
    if (!source) continue;

    const key = duplicateKey(source.answer);
    if (seenKeys.has(key)) {
      skippedDuplicates += 1;
      continue;
    }
    seenKeys.add(key);
    sourceCollectionIds.add(source.collection_id);

    if (isMove) {
      move.run(target.id, source.id);
      resultIds.push(source.id);
    } else {
      const newId = crypto.randomUUID();
      insert.run(
        newId,
        target.id,
        source.question,
        source.answer,
        source.format,
        source.difficulty,
        source.source_page,
        now,
      );
      resultIds.push(newId);
    }
  }

  if (resultIds.length === 0 && skippedDuplicates === 0) {
    res.status(404).json({ success: false, error: 'Nenhum flashcard válido para copiar.' });
    return;
  }

  const touchCollection = db.prepare('UPDATE collections SET updated_at = ? WHERE id = ?');
  if (resultIds.length > 0) touchCollection.run(now, target.id);
  if (isMove) {
    for (const collectionId of sourceCollectionIds) touchCollection.run(now, collectionId);
  }

  const result =
    resultIds.length > 0
      ? (db
          .prepare(`SELECT * FROM flashcards WHERE id IN (${resultIds.map(() => '?').join(', ')})`)
          .all(...resultIds) as unknown as FlashcardRow[])
      : [];

  res.status(isMove ? 200 : 201).json({
    success: true,
    flashcards: result.map(mapFlashcard),
    count: result.length,
    skippedDuplicates,
  });
});

flashcardsRouter.get('/due', (req: AuthedRequest, res: Response) => {
  // Com um limite diário de novos configurado, só entram os novos que ainda cabem hoje
  // (`waitingNew` diz quantos ficaram de fora); sem limite, é a fila completa de sempre.
  // Com `?collectionIds=a,b,c`, só os pendentes dessas coleções e sem limite diário (estudar uma
  // disciplina inteira); ids que não são do usuário simplesmente não trazem cartão nenhum.
  const raw = typeof req.query.collectionIds === 'string' ? req.query.collectionIds : null;
  let collectionIds: string[] | undefined;
  if (raw !== null) {
    collectionIds = [...new Set(raw.split(',').map((id) => id.trim()).filter(Boolean))];
    if (collectionIds.length === 0 || collectionIds.length > MAX_DUE_COLLECTIONS || collectionIds.some((id) => id.length > 64)) {
      res.status(400).json({ success: false, error: 'Escolha de uma a 200 coleções.' });
      return;
    }
  }
  const { cards, waitingNew } = selectDueCards(db, req.userId!, new Date(), { collectionIds });

  res.json({
    success: true,
    flashcards: cards.map((row) => ({
      ...mapFlashcard(row),
      collectionName: row.collection_name,
      collectionSubject: row.collection_subject,
    })),
    waitingNew,
  });
});

// Os cartões atrasados há mais tempo (venceram antes de hoje), no máximo um lote: a sessão "Pôr em dia" da dívida de
// revisão. Só cartões já estudados e de coleções não congeladas; nenhum novo entra.
flashcardsRouter.get('/overdue', (req: AuthedRequest, res: Response) => {
  const cards = loadOverdueCards(db, req.userId!, new Date());
  res.json({
    success: true,
    flashcards: cards.map((row) => ({ ...mapFlashcard(row), collectionName: row.collection_name, collectionSubject: row.collection_subject })),
  });
});

// Os cartões que o usuário errou (Errei ou Difícil) num período, nas coleções escolhidas, vencidos ou não: a lista de
// "Revisar só isso" dos pontos de atenção. `?collectionIds=a,b&from=AAAA-MM-DD&to=AAAA-MM-DD`; ids que não são do usuário
// não trazem cartão nenhum.
flashcardsRouter.get('/missed', (req: AuthedRequest, res: Response) => {
  const query = parseMissedQuery(req.query as Record<string, unknown>);
  if (!query.ok) {
    res.status(400).json({ success: false, error: query.error });
    return;
  }
  const cards = loadMissedCards(db, req.userId!, query.collectionIds, { from: query.from, to: query.to });
  res.json({
    success: true,
    flashcards: cards.map((row) => ({ ...mapFlashcard(row), collectionName: row.collection_name, collectionSubject: row.collection_subject })),
  });
});

flashcardsRouter.get('/favorites', (req: AuthedRequest, res: Response) => {
  const rows = db
    .prepare(
      `SELECT f.*, c.name as collection_name, c.subject as collection_subject FROM flashcards f
       JOIN collections c ON c.id = f.collection_id
       WHERE c.user_id = ? AND f.favorite = 1 AND ${notFrozen('c.id')}
       ORDER BY f.created_at DESC`,
    )
    .all(req.userId!) as unknown as (FlashcardRow & { collection_name: string; collection_subject: string })[];

  res.json({
    success: true,
    flashcards: rows.map((row) => ({
      ...mapFlashcard(row),
      collectionName: row.collection_name,
      collectionSubject: row.collection_subject,
    })),
  });
});

flashcardsRouter.get('/duplicates', (req: AuthedRequest, res: Response) => {
  const rows = db
    .prepare(
      `SELECT f.*, c.name as collection_name, c.subject as collection_subject FROM flashcards f
       JOIN collections c ON c.id = f.collection_id
       WHERE c.user_id = ?
       ORDER BY f.created_at ASC`,
    )
    .all(req.userId!) as unknown as (FlashcardRow & { collection_name: string; collection_subject: string })[];

  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = duplicateKey(row.answer);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  const duplicateGroups = [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => ({
      flashcards: group.map((row) => ({
        ...mapFlashcard(row),
        collectionName: row.collection_name,
        collectionSubject: row.collection_subject,
      })),
    }));

  res.json({
    success: true,
    groups: duplicateGroups,
    totalDuplicates: duplicateGroups.reduce((sum, group) => sum + group.flashcards.length - 1, 0),
  });
});

flashcardsRouter.delete('/:id', (req: AuthedRequest, res: Response) => {
  const existing = loadOwnedFlashcard(req.userId!, req.params.id);
  if (!existing) {
    res.status(404).json({ success: false, error: 'Flashcard não encontrado.' });
    return;
  }
  db.prepare('DELETE FROM flashcards WHERE id = ?').run(existing.id);
  res.json({ success: true });
});
