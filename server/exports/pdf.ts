import PDFDocument from 'pdfkit';

import { parseImageDataUri, toPdfBlocks, type PdfBlock } from './pdfContent';

export interface PdfFlashcard {
  question: string;
  answer: string;
  format: string;
  difficulty: string;
}

const DIFFICULTY_LABEL: Record<string, string> = {
  facil: 'Fácil',
  medio: 'Médio',
  dificil: 'Difícil',
};

interface TextStyle {
  font: string;
  size: number;
  color: string;
}

const QUESTION_STYLE: TextStyle = { font: 'Helvetica-Bold', size: 11, color: '#111827' };
const ANSWER_STYLE: TextStyle = { font: 'Helvetica', size: 10, color: '#4b5563' };

const ANSWER_INDENT = 14;
const IMAGE_PLACEHOLDER = '[imagem não incluída no PDF]';
// A tela mostra a imagem em pixels CSS (96 por polegada); o PDF conta em pontos (72).
const PX_TO_PT = 0.75;
// Uma imagem nunca ocupa mais que isto da altura útil da página.
const MAX_IMAGE_PAGE_FRACTION = 0.85;

interface OpenedImage {
  width: number;
  height: number;
}

// `openImage` existe no pdfkit mas não está nos tipos. Abrir uma vez e passar o
// objeto pronto a `image()` evita decodificar a mesma imagem duas vezes — e
// dá as dimensões, que o ajuste de tamanho precisa.
function openImage(doc: PDFKit.PDFDocument, data: Buffer): OpenedImage {
  return (doc as unknown as { openImage(src: Buffer): OpenedImage }).openImage(data);
}

/** Desenha a imagem e devolve false se ela não pôde ser incluída. */
function drawImage(
  doc: PDFKit.PDFDocument,
  block: Extract<PdfBlock, { type: 'image' }>,
  indent: number,
): boolean {
  const data = parseImageDataUri(block.src);
  if (!data) return false;

  let image: OpenedImage;
  try {
    image = openImage(doc, data);
  } catch {
    return false;
  }

  const left = doc.page.margins.left + indent;
  const availableWidth = doc.page.width - doc.page.margins.right - left;
  const contentHeight = doc.page.height - doc.page.margins.top - doc.page.margins.bottom;

  const naturalWidth = image.width * PX_TO_PT;
  const naturalHeight = image.height * PX_TO_PT;
  const scale = Math.min(1, availableWidth / naturalWidth, (contentHeight * MAX_IMAGE_PAGE_FRACTION) / naturalHeight);
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;

  if (doc.y + height > doc.page.height - doc.page.margins.bottom) doc.addPage();

  const x =
    block.align === 'center' ? left + (availableWidth - width) / 2 : block.align === 'right' ? left + availableWidth - width : left;
  const y = doc.y;
  doc.image(image as unknown as Buffer, x, y, { width, height });
  doc.x = doc.page.margins.left;
  doc.y = y + height;
  doc.moveDown(0.3);
  return true;
}

function renderBlocks(doc: PDFKit.PDFDocument, blocks: PdfBlock[], style: TextStyle, indent: number) {
  const writeText = (text: string) => doc.font(style.font).fontSize(style.size).fillColor(style.color).text(text, { indent });

  for (const block of blocks) {
    if (block.type === 'text') writeText(block.text);
    else if (!drawImage(doc, block, indent)) writeText(IMAGE_PLACEHOLDER);
  }
}

// O número vai junto do primeiro texto; se a pergunta começa por uma imagem,
// ele fica numa linha própria acima dela.
function withNumber(blocks: PdfBlock[], number: number): PdfBlock[] {
  const [first, ...rest] = blocks;
  if (first?.type === 'text') return [{ type: 'text', text: `${number}. ${first.text}` }, ...rest];
  return [{ type: 'text', text: `${number}.` }, ...blocks];
}

export function buildFlashcardsPdf(title: string, rows: PdfFlashcard[]): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 56, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  doc.font('Helvetica-Bold').fontSize(20).fillColor('#111827').text(title);
  doc.moveDown(0.6);
  doc.font('Helvetica').fontSize(9).fillColor('#9ca3af').text(`${rows.length} flashcards`);
  doc.moveDown(1.2);

  rows.forEach((row, index) => {
    renderBlocks(doc, withNumber(toPdfBlocks(row.question, row.format), index + 1), QUESTION_STYLE, 0);
    doc.moveDown(0.15);
    renderBlocks(doc, toPdfBlocks(row.answer, row.format), ANSWER_STYLE, ANSWER_INDENT);
    doc.moveDown(0.15);
    doc
      .font('Helvetica-Oblique')
      .fontSize(8)
      .fillColor('#9ca3af')
      .text(DIFFICULTY_LABEL[row.difficulty] ?? row.difficulty, { indent: ANSWER_INDENT });
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
  return done;
}
