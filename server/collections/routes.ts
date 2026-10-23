import crypto from 'node:crypto';

import express, { type Response } from 'express';

import { db } from '../db';
import { requireAuth, type AuthedRequest } from '../auth/middleware';
import { mapDocument, mapFlashcard, type DocumentRow, type FlashcardRow } from '../mappers';
import { frozenAt, setCollectionFrozen } from './frozen';

export const collectionsRouter = express.Router();
collectionsRouter.use(requireAuth);

interface CollectionRow {
  id: string;
  user_id: string;
  name: string;
  subject: string;
  description: string;
  category: string;
  created_at: string;
  updated_at: string;
}

function collectionSummary(row: CollectionRow) {
  const flashcardCount = (
    db.prepare('SELECT COUNT(*) AS n FROM flashcards WHERE collection_id = ?').get(row.id) as {
      n: number;
    }
  ).n;
  const pendingCount = (
    db
      .prepare('SELECT COUNT(*) AS n FROM flashcards WHERE collection_id = ? AND (due_at IS NULL OR due_at <= ?)')
      .get(row.id, new Date().toISOString()) as { n: number }
  ).n;
  const favoriteCount = (
    db.prepare('SELECT COUNT(*) AS n FROM flashcards WHERE collection_id = ? AND favorite = 1').get(row.id) as {
      n: number;
    }
  ).n;
  // Coleção congelada não tem pendentes nas revisões: a lista e os totais não a contam. O que ficaria pendente vai
  // à parte, para a tela mostrar "N pendentes ao descongelar".
  const frozen = frozenAt(db, row.id);
  const document = db
    .prepare('SELECT status FROM documents WHERE collection_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(row.id) as { status: string } | undefined;

  return {
    id: row.id,
    name: row.name,
    subject: row.subject,
    description: row.description,
    category: row.category,
    flashcardCount,
    dueCount: frozen ? 0 : pendingCount,
    frozen: frozen !== null,
    frozenAt: frozen,
    frozenDueCount: frozen ? pendingCount : 0,
    favoriteCount,
    status: document?.status ?? 'sem_documento',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

collectionsRouter.get('/', (req: AuthedRequest, res: Response) => {
  const rows = db
    .prepare('SELECT * FROM collections WHERE user_id = ? ORDER BY created_at DESC')
    .all(req.userId!) as unknown as CollectionRow[];
  res.json({ success: true, collections: rows.map(collectionSummary) });
});

collectionsRouter.post('/', (req: AuthedRequest, res: Response) => {
  const { name, subject, description, category } = req.body ?? {};
  if (typeof name !== 'string' || name.trim().length < 2) {
    res.status(400).json({ success: false, error: 'Informe um nome para a coleção.' });
    return;
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO collections (id, user_id, name, subject, description, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    id,
    req.userId!,
    name.trim(),
    typeof subject === 'string' ? subject.trim() : '',
    typeof description === 'string' ? description.trim() : '',
    typeof category === 'string' && category.trim() ? category.trim() : 'Outros',
    now,
    now,
  );

  const row = db.prepare('SELECT * FROM collections WHERE id = ?').get(id) as unknown as CollectionRow;
  res.status(201).json({ success: true, collection: collectionSummary(row) });
});

function loadOwnedCollection(userId: string, collectionId: string): CollectionRow | null {
  const row = db.prepare('SELECT * FROM collections WHERE id = ?').get(collectionId) as unknown as
    | CollectionRow
    | undefined;
  if (!row || row.user_id !== userId) return null;
  return row;
}

collectionsRouter.get('/:id', (req: AuthedRequest, res: Response) => {
  const row = loadOwnedCollection(req.userId!, req.params.id);
  if (!row) {
    res.status(404).json({ success: false, error: 'Coleção não encontrada.' });
    return;
  }

  const documents = db
    .prepare('SELECT * FROM documents WHERE collection_id = ? ORDER BY created_at DESC')
    .all(row.id) as unknown as DocumentRow[];
  const flashcards = db
    .prepare('SELECT * FROM flashcards WHERE collection_id = ? ORDER BY created_at ASC')
    .all(row.id) as unknown as FlashcardRow[];

  res.json({
    success: true,
    collection: {
      id: row.id,
      name: row.name,
      subject: row.subject,
      description: row.description,
      category: row.category,
      frozenAt: frozenAt(db, row.id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    documents: documents.map(mapDocument),
    flashcards: flashcards.map(mapFlashcard),
  });
});

const STATS_RESULT_KEYS = ['errei', 'dificil', 'bom', 'facil'] as const;

collectionsRouter.get('/:id/stats', (req: AuthedRequest, res: Response) => {
  const row = loadOwnedCollection(req.userId!, req.params.id);
  if (!row) {
    res.status(404).json({ success: false, error: 'Coleção não encontrada.' });
    return;
  }

  const flashcardsCount = (
    db.prepare('SELECT COUNT(*) AS n FROM flashcards WHERE collection_id = ?').get(row.id) as { n: number }
  ).n;
  const dueCount = (
    db
      .prepare('SELECT COUNT(*) AS n FROM flashcards WHERE collection_id = ? AND (due_at IS NULL OR due_at <= ?)')
      .get(row.id, new Date().toISOString()) as { n: number }
  ).n;
  const favoriteCount = (
    db.prepare('SELECT COUNT(*) AS n FROM flashcards WHERE collection_id = ? AND favorite = 1').get(row.id) as {
      n: number;
    }
  ).n;

  const byResultRows = db
    .prepare(
      `SELECT ss.result, COUNT(*) AS n FROM study_sessions ss
       JOIN flashcards f ON f.id = ss.flashcard_id
       WHERE f.collection_id = ?
       GROUP BY ss.result`,
    )
    .all(row.id) as unknown as { result: string; n: number }[];

  const byResult: Record<(typeof STATS_RESULT_KEYS)[number], number> = { errei: 0, dificil: 0, bom: 0, facil: 0 };
  let reviewsCount = 0;
  for (const r of byResultRows) {
    if ((STATS_RESULT_KEYS as readonly string[]).includes(r.result)) {
      byResult[r.result as (typeof STATS_RESULT_KEYS)[number]] = r.n;
    }
    reviewsCount += r.n;
  }
  const accuracyPct = reviewsCount > 0 ? Math.round(((byResult.bom + byResult.facil) / reviewsCount) * 100) : 0;

  res.json({
    success: true,
    totals: { flashcards: flashcardsCount, reviews: reviewsCount, dueCount, favoriteCount },
    byResult,
    accuracyPct,
  });
});

collectionsRouter.put('/:id', (req: AuthedRequest, res: Response) => {
  const existing = loadOwnedCollection(req.userId!, req.params.id);
  if (!existing) {
    res.status(404).json({ success: false, error: 'Coleção não encontrada.' });
    return;
  }

  const { name, subject, description, category } = req.body ?? {};
  const nextName = typeof name === 'string' && name.trim().length >= 2 ? name.trim() : existing.name;
  const nextSubject = typeof subject === 'string' ? subject.trim() : existing.subject;
  const nextDescription = typeof description === 'string' ? description.trim() : existing.description;
  const nextCategory =
    typeof category === 'string' && category.trim() ? category.trim() : existing.category;

  db.prepare(
    'UPDATE collections SET name = ?, subject = ?, description = ?, category = ?, updated_at = ? WHERE id = ?',
  ).run(nextName, nextSubject, nextDescription, nextCategory, new Date().toISOString(), existing.id);

  const row = db.prepare('SELECT * FROM collections WHERE id = ?').get(existing.id) as unknown as CollectionRow;
  res.json({ success: true, collection: collectionSummary(row) });
});

// Congelar tira a coleção das revisões automáticas (fila, Painel, lembretes, Meta, Reta final...) sem tocar nos cartões;
// ela segue estudável pelo "Estudar" dela. Pedir duas vezes o mesmo não muda nada.
collectionsRouter.put('/:id/freeze', (req: AuthedRequest, res: Response) => {
  const row = loadOwnedCollection(req.userId!, req.params.id);
  if (!row) {
    res.status(404).json({ success: false, error: 'Coleção não encontrada.' });
    return;
  }
  setCollectionFrozen(db, row.id, true);
  res.json({ success: true, collection: collectionSummary(row) });
});

collectionsRouter.delete('/:id/freeze', (req: AuthedRequest, res: Response) => {
  const row = loadOwnedCollection(req.userId!, req.params.id);
  if (!row) {
    res.status(404).json({ success: false, error: 'Coleção não encontrada.' });
    return;
  }
  setCollectionFrozen(db, row.id, false);
  res.json({ success: true, collection: collectionSummary(row) });
});

collectionsRouter.delete('/:id', (req: AuthedRequest, res: Response) => {
  const row = loadOwnedCollection(req.userId!, req.params.id);
  if (!row) {
    res.status(404).json({ success: false, error: 'Coleção não encontrada.' });
    return;
  }
  db.prepare('DELETE FROM collections WHERE id = ?').run(row.id);
  res.json({ success: true });
});
