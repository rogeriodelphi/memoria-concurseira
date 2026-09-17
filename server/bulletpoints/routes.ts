import crypto from 'node:crypto';

import express, { type Response } from 'express';

import { db } from '../db';
import { requireAuth, type AuthedRequest } from '../auth/middleware';
import { generateBulletPoints } from '../ai/router';
import { mapBulletPoints, type BulletPointsRow } from '../mappers';

export const bulletPointsRouter = express.Router();
bulletPointsRouter.use(requireAuth);

const MIN_TEXT_CHARS = 250;
const MAX_TEXT_CHARS = 64_000;

bulletPointsRouter.post('/generate', async (req: AuthedRequest, res: Response) => {
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (text.length < MIN_TEXT_CHARS) {
    res.status(400).json({ success: false, error: `Insira ao menos ${MIN_TEXT_CHARS} caracteres.` });
    return;
  }
  if (text.length > MAX_TEXT_CHARS) {
    res.status(400).json({ success: false, error: `Máximo de ${MAX_TEXT_CHARS} caracteres.` });
    return;
  }

  try {
    const { title, points } = await generateBulletPoints(text);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO bullet_points (id, user_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, req.userId!, title, JSON.stringify(points), now, now);
    const row = db.prepare('SELECT * FROM bullet_points WHERE id = ?').get(id) as unknown as BulletPointsRow;
    res.status(201).json({ success: true, bulletPoints: mapBulletPoints(row) });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha ao gerar os bullet points.';
    res.status(422).json({ success: false, error: message });
  }
});

bulletPointsRouter.get('/', (req: AuthedRequest, res: Response) => {
  const rows = db
    .prepare('SELECT * FROM bullet_points WHERE user_id = ? ORDER BY created_at DESC')
    .all(req.userId!) as unknown as BulletPointsRow[];
  res.json({ success: true, bulletPoints: rows.map(mapBulletPoints) });
});

bulletPointsRouter.delete('/:id', (req: AuthedRequest, res: Response) => {
  const row = db.prepare('SELECT * FROM bullet_points WHERE id = ? AND user_id = ?').get(
    req.params.id,
    req.userId!,
  ) as unknown as BulletPointsRow | undefined;
  if (!row) {
    res.status(404).json({ success: false, error: 'Bullet points não encontrado.' });
    return;
  }
  db.prepare('DELETE FROM bullet_points WHERE id = ?').run(row.id);
  res.json({ success: true });
});
