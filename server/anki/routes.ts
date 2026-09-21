import crypto from 'node:crypto';

import express, { type Request, type Response } from 'express';
import multer, { type FileFilterCallback } from 'multer';

import { db } from '../db';
import { requireAuth, type AuthedRequest } from '../auth/middleware';
import { importAnswerKey } from '../duplicates';
import { ApkgError, htmlToPlainText, parseApkg, type ApkgCard } from './apkg';

export const ankiImportRouter = express.Router();
ankiImportRouter.use(requireAuth);

const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_DUPLICATE_SAMPLES = 30;
const SAMPLE_TEXT_LENGTH = 140;

// O multer lê o nome do arquivo como latin1, então "Segurança.apkg" chega como
// "SeguranÃ§a.apkg". Reinterpretar os bytes como UTF-8 desfaz isso; se o
// resultado não for UTF-8 válido, o nome já estava certo e é mantido.
function decodeFilename(name: string): string {
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('�') ? name : decoded;
}

function suggestedNameFrom(filename: string): string {
  const base = decodeFilename(filename)
    .replace(/\.apkg$/i, '')
    .replace(/_+/g, ' ')
    .trim();
  const name = base ? base.charAt(0).toUpperCase() + base.slice(1) : 'Importado do Anki';
  return name.slice(0, 120);
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    if (!/\.apkg$/i.test(decodeFilename(file.originalname))) {
      cb(new Error('Envie um arquivo .apkg do Anki.'));
      return;
    }
    cb(null, true);
  },
});

interface DuplicateSample {
  question: string;
  // Nome da coleção onde o cartão já existe, ou null se o repetido está no
  // próprio arquivo.
  existsIn: string | null;
}

interface Classification {
  importable: ApkgCard[];
  duplicatesExisting: number;
  duplicatesInFile: number;
  duplicateSamples: DuplicateSample[];
}

/**
 * Separa o que entra do que é repetido, com a mesma regra da tela de
 * "duplicados" (resposta idêntica). Compara com os cartões de TODAS as
 * coleções do usuário e também dos cartões do próprio arquivo entre si.
 *
 * Roda tanto na prévia quanto na importação de verdade — a importação nunca
 * confia no resultado da prévia, então um cartão que virou duplicado nesse
 * meio-tempo também é barrado.
 */
function classifyCards(userId: string, cards: ApkgCard[]): Classification {
  const rows = db
    .prepare(
      `SELECT f.answer AS answer, c.name AS collectionName FROM flashcards f
       JOIN collections c ON c.id = f.collection_id
       WHERE c.user_id = ?`,
    )
    .all(userId) as unknown as { answer: string; collectionName: string }[];

  const existing = new Map<string, string>();
  for (const row of rows) {
    const key = importAnswerKey(row.answer);
    if (key && !existing.has(key)) existing.set(key, row.collectionName);
  }

  const seenInFile = new Set<string>();
  const importable: ApkgCard[] = [];
  const duplicateSamples: DuplicateSample[] = [];
  let duplicatesExisting = 0;
  let duplicatesInFile = 0;

  const addSample = (card: ApkgCard, existsIn: string | null) => {
    if (duplicateSamples.length < MAX_DUPLICATE_SAMPLES) {
      duplicateSamples.push({ question: truncate(htmlToPlainText(card.question), SAMPLE_TEXT_LENGTH), existsIn });
    }
  };

  for (const card of cards) {
    const key = importAnswerKey(card.answer);
    const existsIn = existing.get(key);
    if (existsIn !== undefined) {
      duplicatesExisting++;
      addSample(card, existsIn);
    } else if (seenInFile.has(key)) {
      duplicatesInFile++;
      addSample(card, null);
    } else {
      seenInFile.add(key);
      importable.push(card);
    }
  }

  return { importable, duplicatesExisting, duplicatesInFile, duplicateSamples };
}

function respondError(res: Response, err: unknown): void {
  if (err instanceof ApkgError) {
    res.status(422).json({ success: false, error: err.message });
    return;
  }
  console.error('Falha ao importar .apkg:', err);
  res.status(500).json({ success: false, error: 'Não foi possível importar este arquivo.' });
}

ankiImportRouter.post('/preview', upload.single('file'), async (req: AuthedRequest, res: Response) => {
  if (!req.file) {
    res.status(400).json({ success: false, error: 'Envie um arquivo .apkg do Anki.' });
    return;
  }
  try {
    const parsed = await parseApkg(req.file.buffer);
    const classified = classifyCards(req.userId!, parsed.cards);
    res.json({
      success: true,
      suggestedName: suggestedNameFrom(req.file.originalname),
      totalNotes: parsed.totalNotes,
      importable: classified.importable.length,
      duplicatesExisting: classified.duplicatesExisting,
      duplicatesInFile: classified.duplicatesInFile,
      empty: parsed.empty,
      clozeConverted: parsed.clozeConverted,
      images: parsed.images,
      duplicateSamples: classified.duplicateSamples,
      sample: classified.importable.slice(0, 3).map((card) => ({
        question: truncate(htmlToPlainText(card.question), SAMPLE_TEXT_LENGTH),
        answer: truncate(htmlToPlainText(card.answer), SAMPLE_TEXT_LENGTH),
      })),
    });
  } catch (err) {
    respondError(res, err);
  }
});

ankiImportRouter.post('/import', upload.single('file'), async (req: AuthedRequest, res: Response) => {
  if (!req.file) {
    res.status(400).json({ success: false, error: 'Envie um arquivo .apkg do Anki.' });
    return;
  }

  const userId = req.userId!;
  const file = req.file;
  const collectionId = typeof req.body?.collectionId === 'string' ? req.body.collectionId.trim() : '';
  const newName = typeof req.body?.newCollectionName === 'string' ? req.body.newCollectionName.trim().slice(0, 120) : '';

  let target: { id: string; name: string } | null = null;
  if (collectionId) {
    const row = db.prepare('SELECT id, user_id, name FROM collections WHERE id = ?').get(collectionId) as unknown as
      | { id: string; user_id: string; name: string }
      | undefined;
    if (!row || row.user_id !== userId) {
      res.status(404).json({ success: false, error: 'Coleção não encontrada.' });
      return;
    }
    target = { id: row.id, name: row.name };
  } else if (newName.length < 2) {
    res.status(400).json({ success: false, error: 'Escolha uma coleção de destino ou informe o nome da nova coleção.' });
    return;
  }

  try {
    const parsed = await parseApkg(file.buffer);
    const classified = classifyCards(userId, parsed.cards);
    const duplicates = classified.duplicatesExisting + classified.duplicatesInFile;

    if (classified.importable.length === 0) {
      res.json({ success: true, imported: 0, duplicates, empty: parsed.empty, collection: target });
      return;
    }

    // Tudo síncrono entre BEGIN e COMMIT (sem await) — a conexão do banco é
    // uma só, então um await aqui deixaria escritas de outras requisições
    // caírem dentro desta transação.
    const now = new Date().toISOString();
    db.exec('BEGIN');
    try {
      if (!target) {
        const id = crypto.randomUUID();
        db.prepare(
          'INSERT INTO collections (id, user_id, name, subject, description, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(id, userId, newName, '', 'Importado do Anki', 'Outros', now, now);
        target = { id, name: newName };
      }
      const documentId = crypto.randomUUID();
      db.prepare(
        'INSERT INTO documents (id, collection_id, filename, size, pages, status, source_type, created_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)',
      ).run(documentId, target.id, decodeFilename(file.originalname), file.size, 'completed', 'anki', now);

      const insert = db.prepare(
        'INSERT INTO flashcards (id, collection_id, document_id, question, answer, format, difficulty, source_page, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)',
      );
      for (const card of classified.importable) {
        insert.run(crypto.randomUUID(), target.id, documentId, card.question, card.answer, 'html', 'medio', now);
      }
      db.prepare('UPDATE collections SET updated_at = ? WHERE id = ?').run(now, target.id);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    res.status(201).json({
      success: true,
      imported: classified.importable.length,
      duplicates,
      empty: parsed.empty,
      collection: target,
    });
  } catch (err) {
    respondError(res, err);
  }
});
