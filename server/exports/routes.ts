import { createRequire } from 'node:module';

import express, { type Response } from 'express';
import PDFDocument from 'pdfkit';

import { db } from '../db';
import { requireAuth, type AuthedRequest } from '../auth/middleware';
import { sanitizeFlashcardHtml } from '../sanitizeHtml';

export const exportsRouter = express.Router();
exportsRouter.use(requireAuth);

interface AnkiExportInstance {
  addCard(front: string, back: string, options?: { tags?: string[] }): void;
  save(): Promise<Buffer>;
}

/**
 * `anki-apkg-export` é um pacote CJS antigo (sem `.default` reconhecido de
 * forma consistente pelo interop nativo do Node quando este projeto roda
 * como ESM) — `require` direto evita a ambiguidade de qual exportação vira
 * o "default" e garante que pegamos a função/classe de verdade.
 *
 * Em dev (tsx, ESM real) não existe `require` global, então usamos
 * createRequire(import.meta.url). Já no build de produção (esbuild
 * empacota pra CJS) o próprio bundle já fornece um `require` funcional, e
 * ali `import.meta.url` fica vazio — chamar createRequire com ele derruba
 * o servidor inteiro no startup. Por isso preferimos o `require` nativo
 * quando ele existe.
 */
const nodeRequire = typeof require === 'function' ? require : createRequire(import.meta.url);
const AnkiExport = (nodeRequire('anki-apkg-export') as { default: new (deckName: string) => AnkiExportInstance })
  .default;

interface CollectionRow {
  id: string;
  user_id: string;
  name: string;
}

interface FlashcardRow {
  question: string;
  answer: string;
  format: string;
  difficulty: string;
}

function slugify(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'flashcards'
  );
}

/**
 * O Anki renderiza os campos da nota como HTML. Para flashcards em texto
 * simples, um `&`/`<`/`>` do conteúdo original quebraria a marcação do
 * cartão — por isso escapa e troca quebra de linha por `<br>`. Para
 * flashcards já em HTML (editados no editor de texto rico), a marcação
 * (negrito/itálico/alinhamento) deve chegar intacta ao Anki — só sanitiza de
 * novo por segurança, sem escapar.
 */
function toCardHtml(value: string, format: string): string {
  if (format === 'html') {
    return sanitizeFlashcardHtml(value);
  }
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r\n|\r|\n/g, '<br>')
    .trim();
}

/**
 * pdfkit não entende HTML — para flashcards em HTML, convertemos quebras de
 * bloco em `\n` e removemos as tags, sobrando só o texto (perde a
 * formatação visual no PDF, mas o conteúdo continua correto).
 */
function toPlainText(value: string, format: string): string {
  if (format !== 'html') return value;
  return sanitizeFlashcardHtml(value)
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<img[^>]*>/gi, '[imagem]')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

interface ResolvedExport {
  collection: CollectionRow;
  rows: FlashcardRow[];
}

function resolveExportRows(
  userId: string,
  collectionId: unknown,
  flashcardIds: unknown,
): ResolvedExport | { error: string; status: number } {
  if (typeof collectionId !== 'string') {
    return { error: 'Informe a coleção a exportar.', status: 400 };
  }

  const collection = db.prepare('SELECT * FROM collections WHERE id = ?').get(collectionId) as unknown as
    | CollectionRow
    | undefined;
  if (!collection || collection.user_id !== userId) {
    return { error: 'Coleção não encontrada.', status: 404 };
  }

  let rows: FlashcardRow[];
  if (Array.isArray(flashcardIds) && flashcardIds.length > 0) {
    const placeholders = flashcardIds.map(() => '?').join(',');
    rows = db
      .prepare(
        `SELECT question, answer, format, difficulty FROM flashcards WHERE collection_id = ? AND id IN (${placeholders}) ORDER BY created_at ASC`,
      )
      .all(collection.id, ...flashcardIds) as unknown as FlashcardRow[];
  } else {
    rows = db
      .prepare('SELECT question, answer, format, difficulty FROM flashcards WHERE collection_id = ? ORDER BY created_at ASC')
      .all(collection.id) as unknown as FlashcardRow[];
  }

  if (rows.length === 0) {
    return { error: 'Esta coleção não tem flashcards para exportar.', status: 400 };
  }

  return { collection, rows };
}

exportsRouter.post('/anki', async (req: AuthedRequest, res: Response) => {
  const resolved = resolveExportRows(req.userId!, req.body?.collectionId, req.body?.flashcardIds);
  if ('error' in resolved) {
    res.status(resolved.status).json({ success: false, error: resolved.error });
    return;
  }
  const { collection, rows } = resolved;

  try {
    const apkg = new AnkiExport(collection.name);
    for (const row of rows) {
      apkg.addCard(toCardHtml(row.question, row.format), toCardHtml(row.answer, row.format), {
        tags: [row.difficulty],
      });
    }
    const buffer = await apkg.save();
    const filename = `${slugify(collection.name)}.apkg`;

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Não foi possível gerar o arquivo do Anki.' });
  }
});

const DIFFICULTY_LABEL: Record<string, string> = {
  facil: 'Fácil',
  medio: 'Médio',
  dificil: 'Difícil',
};

exportsRouter.post('/pdf', async (req: AuthedRequest, res: Response) => {
  const resolved = resolveExportRows(req.userId!, req.body?.collectionId, req.body?.flashcardIds);
  if ('error' in resolved) {
    res.status(resolved.status).json({ success: false, error: resolved.error });
    return;
  }
  const { collection, rows } = resolved;

  try {
    const doc = new PDFDocument({ margin: 56, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

    doc.font('Helvetica-Bold').fontSize(20).fillColor('#111827').text(collection.name);
    doc.moveDown(0.6);
    doc.font('Helvetica').fontSize(9).fillColor('#9ca3af').text(`${rows.length} flashcards`);
    doc.moveDown(1.2);

    rows.forEach((row, index) => {
      const question = toPlainText(row.question, row.format);
      const answer = toPlainText(row.answer, row.format);
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827').text(`${index + 1}. ${question}`);
      doc.moveDown(0.15);
      doc.font('Helvetica').fontSize(10).fillColor('#4b5563').text(answer, { indent: 14 });
      doc.moveDown(0.15);
      doc
        .font('Helvetica-Oblique')
        .fontSize(8)
        .fillColor('#9ca3af')
        .text(DIFFICULTY_LABEL[row.difficulty] ?? row.difficulty, { indent: 14 });
      doc.moveDown(0.5);

      if (index < rows.length - 1) {
        const y = doc.y;
        doc
          .moveTo(doc.page.margins.left, y)
          .lineTo(doc.page.width - doc.page.margins.right, y)
          .strokeColor('#e5e7eb')
          .lineWidth(0.5)
          .stroke();
        doc.moveDown(0.5);
      }
    });

    doc.end();
    const buffer = await done;
    const filename = `${slugify(collection.name)}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Não foi possível gerar o PDF.' });
  }
});
