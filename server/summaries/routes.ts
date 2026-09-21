import crypto from 'node:crypto';

import express, { type Response } from 'express';

import { db } from '../db';
import { requireAuth, type AuthedRequest } from '../auth/middleware';
import { generateSummary, type SummaryMode } from '../ai/router';
import { withUsageContext } from '../ai/usage';
import { mapSummary, type SummaryRow } from '../mappers';

export const summariesRouter = express.Router();
summariesRouter.use(requireAuth);

const MIN_TEXT_CHARS = 250;
const MAX_TEXT_CHARS = 64_000;

function parseMode(raw: unknown): SummaryMode {
  return raw === 'intensivo' ? 'intensivo' : 'padrao';
}

summariesRouter.post('/generate', async (req: AuthedRequest, res: Response) => {
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (text.length < MIN_TEXT_CHARS) {
    res.status(400).json({ success: false, error: `Insira ao menos ${MIN_TEXT_CHARS} caracteres.` });
    return;
  }
  if (text.length > MAX_TEXT_CHARS) {
    res.status(400).json({ success: false, error: `Máximo de ${MAX_TEXT_CHARS} caracteres.` });
    return;
  }
  const mode = parseMode(req.body?.mode);

  try {
    const { title, content } = await withUsageContext({ userId: req.userId!, feature: 'summary' }, () =>
      generateSummary(text, mode),
    );
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO summaries (id, user_id, title, content, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(id, req.userId!, title, content, mode, now, now);
    const row = db.prepare('SELECT * FROM summaries WHERE id = ?').get(id) as unknown as SummaryRow;
    res.status(201).json({ success: true, summary: mapSummary(row) });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha ao gerar o resumo.';
    res.status(422).json({ success: false, error: message });
  }
});

summariesRouter.get('/', (req: AuthedRequest, res: Response) => {
  const rows = db
    .prepare('SELECT * FROM summaries WHERE user_id = ? ORDER BY created_at DESC')
    .all(req.userId!) as unknown as SummaryRow[];
  res.json({ success: true, summaries: rows.map(mapSummary) });
});

summariesRouter.delete('/:id', (req: AuthedRequest, res: Response) => {
  const row = db.prepare('SELECT * FROM summaries WHERE id = ? AND user_id = ?').get(
    req.params.id,
    req.userId!,
  ) as unknown as SummaryRow | undefined;
  if (!row) {
    res.status(404).json({ success: false, error: 'Resumo não encontrado.' });
    return;
  }
  db.prepare('DELETE FROM summaries WHERE id = ?').run(row.id);
  res.json({ success: true });
});
