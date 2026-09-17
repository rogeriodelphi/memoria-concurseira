import crypto from 'node:crypto';

import express, { type Response } from 'express';
import multer, { type FileFilterCallback } from 'multer';
import type { Request } from 'express';

import { db } from '../db';
import { requireAuth, type AuthedRequest } from '../auth/middleware';
import { generateMindMap, type GenerationSource } from '../ai/router';
import { mapMindMapDetail, mapMindMapSummary, type MindMapRow } from '../mappers';
import { isYoutubeUrl } from '../urlValidation';

export const mindMapsRouter = express.Router();
mindMapsRouter.use(requireAuth);

const MAX_FILE_BYTES = 100 * 1024 * 1024;
const ACCEPTED_PREFIXES = ['image/', 'audio/', 'video/'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    const accepted = file.mimetype === 'application/pdf' || ACCEPTED_PREFIXES.some((p) => file.mimetype.startsWith(p));
    if (!accepted) {
      cb(new Error('Formato de arquivo não suportado. Envie um PDF, imagem, áudio ou vídeo.'));
      return;
    }
    cb(null, true);
  },
});

async function saveMindMap(userId: string, requestedTitle: string | undefined, source: GenerationSource, res: Response) {
  try {
    const root = await generateMindMap(source);
    const title = requestedTitle?.trim() || root.title || 'Mapa mental';
    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    db.prepare(
      'INSERT INTO mind_maps (id, user_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, userId, title, JSON.stringify(root), now, now);

    const row = db.prepare('SELECT * FROM mind_maps WHERE id = ?').get(id) as unknown as MindMapRow;
    res.status(201).json({ success: true, mindMap: mapMindMapDetail(row) });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha ao gerar o mapa mental.';
    res.status(422).json({ success: false, error: message });
  }
}

mindMapsRouter.post('/generate/topic', async (req: AuthedRequest, res: Response) => {
  const topic = typeof req.body?.topic === 'string' ? req.body.topic.trim().slice(0, 300) : '';
  if (!topic) {
    res.status(400).json({ success: false, error: 'Informe um tópico.' });
    return;
  }
  await saveMindMap(req.userId!, req.body?.title, { type: 'topic', topic }, res);
});

mindMapsRouter.post('/generate/text', async (req: AuthedRequest, res: Response) => {
  const text = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, 100_000) : '';
  if (!text) {
    res.status(400).json({ success: false, error: 'Cole um texto.' });
    return;
  }
  await saveMindMap(req.userId!, req.body?.title, { type: 'text', text }, res);
});

mindMapsRouter.post('/generate/youtube', async (req: AuthedRequest, res: Response) => {
  const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
  if (!url || !isYoutubeUrl(url)) {
    res.status(400).json({ success: false, error: 'Informe um link válido do YouTube.' });
    return;
  }
  await saveMindMap(req.userId!, req.body?.title, { type: 'youtube', url }, res);
});

mindMapsRouter.post('/generate/file', upload.single('file'), async (req: AuthedRequest, res: Response) => {
  if (!req.file) {
    res.status(400).json({ success: false, error: 'Envie um arquivo.' });
    return;
  }
  await saveMindMap(
    req.userId!,
    req.body?.title,
    { type: 'file', buffer: req.file.buffer, mimeType: req.file.mimetype },
    res,
  );
});

mindMapsRouter.get('/', (req: AuthedRequest, res: Response) => {
  const rows = db
    .prepare('SELECT * FROM mind_maps WHERE user_id = ? ORDER BY updated_at DESC')
    .all(req.userId!) as unknown as MindMapRow[];
  res.json({ success: true, mindMaps: rows.map(mapMindMapSummary) });
});

function loadOwnedMindMap(userId: string, id: string): MindMapRow | null {
  const row = db.prepare('SELECT * FROM mind_maps WHERE id = ? AND user_id = ?').get(id, userId) as unknown as
    | MindMapRow
    | undefined;
  return row ?? null;
}

mindMapsRouter.get('/:id', (req: AuthedRequest, res: Response) => {
  const row = loadOwnedMindMap(req.userId!, req.params.id);
  if (!row) {
    res.status(404).json({ success: false, error: 'Mapa mental não encontrado.' });
    return;
  }
  res.json({ success: true, mindMap: mapMindMapDetail(row) });
});

mindMapsRouter.put('/:id', (req: AuthedRequest, res: Response) => {
  const existing = loadOwnedMindMap(req.userId!, req.params.id);
  if (!existing) {
    res.status(404).json({ success: false, error: 'Mapa mental não encontrado.' });
    return;
  }
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  if (!title) {
    res.status(400).json({ success: false, error: 'Informe um título.' });
    return;
  }
  const now = new Date().toISOString();
  db.prepare('UPDATE mind_maps SET title = ?, updated_at = ? WHERE id = ?').run(title, now, existing.id);
  const row = db.prepare('SELECT * FROM mind_maps WHERE id = ?').get(existing.id) as unknown as MindMapRow;
  res.json({ success: true, mindMap: mapMindMapDetail(row) });
});

mindMapsRouter.delete('/:id', (req: AuthedRequest, res: Response) => {
  const existing = loadOwnedMindMap(req.userId!, req.params.id);
  if (!existing) {
    res.status(404).json({ success: false, error: 'Mapa mental não encontrado.' });
    return;
  }
  db.prepare('DELETE FROM mind_maps WHERE id = ?').run(existing.id);
  res.json({ success: true });
});
