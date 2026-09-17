import crypto from 'node:crypto';

import express, { type Response } from 'express';
import multer, { type FileFilterCallback } from 'multer';
import type { Request } from 'express';
import pdfParse from 'pdf-parse';

import { db } from '../db';
import { requireAuth, type AuthedRequest } from '../auth/middleware';
import { generateFlashcards, type GenerationOptions, type GenerationSource } from '../ai/router';
import { mapDocument, mapFlashcard, type DocumentRow, type FlashcardRow } from '../mappers';
import { isYoutubeUrl } from '../urlValidation';

export const documentsRouter = express.Router({ mergeParams: true });
documentsRouter.use(requireAuth);

// A Files API do Gemini não impõe um teto prático de tamanho pra uso normal
// (arquivo sobe primeiro, geração só referencia por URI), então o limite
// aqui é só pra manter o uso de memória do servidor razoável — multer guarda
// o arquivo inteiro em RAM antes de repassar.
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_TEXT_CHARS = 100_000;
const MAX_TOPIC_CHARS = 300;

const ACCEPTED_FILE_PREFIXES = ['image/', 'audio/', 'video/'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    const accepted =
      file.mimetype === 'application/pdf' ||
      ACCEPTED_FILE_PREFIXES.some((prefix) => file.mimetype.startsWith(prefix));
    if (!accepted) {
      cb(new Error('Formato de arquivo não suportado. Envie um PDF, imagem, áudio ou vídeo.'));
      return;
    }
    cb(null, true);
  },
});

interface CollectionRow {
  id: string;
  user_id: string;
}

function loadOwnedCollection(userId: string, collectionId: string): CollectionRow | null {
  const row = db.prepare('SELECT id, user_id FROM collections WHERE id = ?').get(collectionId) as unknown as
    | CollectionRow
    | undefined;
  if (!row || row.user_id !== userId) return null;
  return row;
}

function parseQuantity(raw: unknown): GenerationOptions['quantity'] {
  if (raw === 'auto' || raw === undefined || raw === null || raw === '') return 'auto';
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n <= 300 ? n : 'auto';
}

function parseEnum<T extends string>(raw: unknown, allowed: readonly T[], fallback: T): T {
  return typeof raw === 'string' && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

function parseOptions(body: Record<string, unknown> | undefined): GenerationOptions {
  return {
    quantity: parseQuantity(body?.quantity),
    difficulty: parseEnum(body?.difficulty, ['facil', 'medio', 'dificil', 'misto'] as const, 'medio'),
    cardType: parseEnum(
      body?.cardType,
      ['pergunta_resposta', 'verdadeiro_falso', 'multipla_escolha', 'conceito_definicao', 'misto'] as const,
      'pergunta_resposta',
    ),
    depth: parseEnum(body?.depth, ['essencial', 'normal', 'avancado'] as const, 'normal'),
    focus: typeof body?.focus === 'string' ? body.focus.slice(0, 500) : undefined,
  };
}

interface RunGenerationParams {
  label: string;
  size: number;
  sourceType: string;
  pdfBuffer?: Buffer;
  source: GenerationSource;
}

async function runGeneration(req: AuthedRequest, res: Response, params: RunGenerationParams): Promise<void> {
  const collection = loadOwnedCollection(req.userId!, req.params.collectionId);
  if (!collection) {
    res.status(404).json({ success: false, error: 'Coleção não encontrada.' });
    return;
  }

  const options = parseOptions(req.body as Record<string, unknown> | undefined);

  const documentId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(
    'INSERT INTO documents (id, collection_id, filename, size, pages, status, source_type, created_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)',
  ).run(documentId, collection.id, params.label, params.size, 'processing', params.sourceType, createdAt);

  try {
    // A contagem de páginas vem do pdf-parse (só se aplica a PDF; não
    // depende de texto, então funciona mesmo em PDF escaneado). Se o
    // arquivo estiver corrompido a ponto de nem isso funcionar, seguimos
    // mesmo assim — é o Gemini que vai efetivamente ler o conteúdo.
    const pageCount = params.pdfBuffer
      ? await pdfParse(params.pdfBuffer)
          .then((parsed) => parsed.numpages ?? 0)
          .catch(() => 0)
      : 0;

    const { flashcards } = await generateFlashcards(params.source, options);

    const insertFlashcard = db.prepare(
      'INSERT INTO flashcards (id, collection_id, document_id, question, answer, difficulty, source_page, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const now = new Date().toISOString();
    for (const card of flashcards) {
      insertFlashcard.run(
        crypto.randomUUID(),
        collection.id,
        documentId,
        card.question,
        card.answer,
        card.difficulty,
        card.sourcePage ?? null,
        now,
      );
    }

    db.prepare('UPDATE documents SET status = ?, pages = ? WHERE id = ?').run(
      'completed',
      pageCount,
      documentId,
    );
    db.prepare('UPDATE collections SET updated_at = ? WHERE id = ?').run(now, collection.id);

    const document = db.prepare('SELECT * FROM documents WHERE id = ?').get(documentId) as unknown as DocumentRow;
    const savedFlashcards = db
      .prepare('SELECT * FROM flashcards WHERE document_id = ? ORDER BY created_at ASC')
      .all(documentId) as unknown as FlashcardRow[];

    res.status(201).json({
      success: true,
      document: mapDocument(document),
      flashcards: savedFlashcards.map(mapFlashcard),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha ao gerar flashcards.';
    db.prepare('UPDATE documents SET status = ?, error_message = ? WHERE id = ?').run(
      'error',
      message,
      documentId,
    );
    res.status(422).json({ success: false, error: message });
  }
}

documentsRouter.post('/file', upload.single('file'), async (req: AuthedRequest, res: Response) => {
  if (!req.file) {
    res.status(400).json({ success: false, error: 'Envie um arquivo.' });
    return;
  }
  await runGeneration(req, res, {
    label: req.file.originalname,
    size: req.file.size,
    sourceType: 'file',
    pdfBuffer: req.file.mimetype === 'application/pdf' ? req.file.buffer : undefined,
    source: { type: 'file', buffer: req.file.buffer, mimeType: req.file.mimetype },
  });
});

documentsRouter.post('/topic', async (req: AuthedRequest, res: Response) => {
  const topic = typeof req.body?.topic === 'string' ? req.body.topic.trim().slice(0, MAX_TOPIC_CHARS) : '';
  if (!topic) {
    res.status(400).json({ success: false, error: 'Informe um tópico.' });
    return;
  }
  await runGeneration(req, res, {
    label: topic,
    size: 0,
    sourceType: 'topic',
    source: { type: 'topic', topic },
  });
});

documentsRouter.post('/text', async (req: AuthedRequest, res: Response) => {
  const text = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, MAX_TEXT_CHARS) : '';
  if (!text) {
    res.status(400).json({ success: false, error: 'Cole um texto.' });
    return;
  }
  await runGeneration(req, res, {
    label: text.length > 80 ? `${text.slice(0, 80)}…` : text,
    size: Buffer.byteLength(text, 'utf8'),
    sourceType: 'text',
    source: { type: 'text', text },
  });
});

documentsRouter.post('/youtube', async (req: AuthedRequest, res: Response) => {
  const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
  if (!url || !isYoutubeUrl(url)) {
    res.status(400).json({ success: false, error: 'Informe um link válido do YouTube.' });
    return;
  }
  await runGeneration(req, res, {
    label: url,
    size: 0,
    sourceType: 'youtube',
    source: { type: 'youtube', url },
  });
});
