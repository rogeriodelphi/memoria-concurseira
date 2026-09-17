import express, { type Response } from 'express';

import { db } from '../db';
import { requireAuth, type AuthedRequest } from '../auth/middleware';

export const searchRouter = express.Router();
searchRouter.use(requireAuth);

const MAX_RESULTS = 20;
const MIN_QUERY_LENGTH = 2;

// Escapa curingas do LIKE (% e _) pra que uma busca literal por esses
// caracteres não se comporte como coringa — sem isso, buscar por "50%" (por
// exemplo) casaria com qualquer coisa contendo "50" seguido de algo.
function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, '\\$&')}%`;
}

interface CollectionRow {
  id: string;
  name: string;
  subject: string;
  updated_at: string;
}

interface TitledRow {
  id: string;
  title: string;
  updated_at: string;
}

searchRouter.get('/', (req: AuthedRequest, res: Response) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (q.length < MIN_QUERY_LENGTH) {
    res.json({ success: true, collections: [], summaries: [], mindMaps: [], bulletPoints: [] });
    return;
  }

  const like = likePattern(q);
  const userId = req.userId!;

  const collections = db
    .prepare(
      `SELECT DISTINCT c.id, c.name, c.subject, c.updated_at FROM collections c
       LEFT JOIN flashcards f ON f.collection_id = c.id
       WHERE c.user_id = ?
         AND (c.name LIKE ? ESCAPE '\\' OR c.subject LIKE ? ESCAPE '\\' OR c.description LIKE ? ESCAPE '\\'
              OR f.question LIKE ? ESCAPE '\\' OR f.answer LIKE ? ESCAPE '\\')
       ORDER BY c.updated_at DESC LIMIT ?`,
    )
    .all(userId, like, like, like, like, like, MAX_RESULTS) as unknown as CollectionRow[];

  const summaries = db
    .prepare(
      `SELECT id, title, updated_at FROM summaries
       WHERE user_id = ? AND (title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\')
       ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(userId, like, like, MAX_RESULTS) as unknown as TitledRow[];

  const mindMaps = db
    .prepare(
      `SELECT id, title, updated_at FROM mind_maps
       WHERE user_id = ? AND (title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\')
       ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(userId, like, like, MAX_RESULTS) as unknown as TitledRow[];

  const bulletPoints = db
    .prepare(
      `SELECT id, title, updated_at FROM bullet_points
       WHERE user_id = ? AND (title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\')
       ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(userId, like, like, MAX_RESULTS) as unknown as TitledRow[];

  res.json({
    success: true,
    collections: collections.map((c) => ({ id: c.id, name: c.name, subject: c.subject, updatedAt: c.updated_at })),
    summaries: summaries.map((s) => ({ id: s.id, title: s.title, updatedAt: s.updated_at })),
    mindMaps: mindMaps.map((m) => ({ id: m.id, title: m.title, updatedAt: m.updated_at })),
    bulletPoints: bulletPoints.map((b) => ({ id: b.id, title: b.title, updatedAt: b.updated_at })),
  });
});
