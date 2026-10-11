import { sanitizeFlashcardHtml } from '../sanitizeHtml';

export type PdfBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; src: string; align: 'left' | 'center' | 'right' };

const IMG_TAG = /<img\b[^>]*>/gi;

// Teto de uma imagem decodificada. As do editor são reduzidas antes de salvar
// (poucas centenas de KB); isto só impede que um cartão estranho estoure a memória.
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

/**
 * pdfkit não entende HTML: quebras de bloco viram `\n` e as tags somem,
 * sobrando só o texto. `&amp;` é decodificado por último — senão um "&lt;"
 * digitado pelo usuário (guardado como `&amp;lt;`) viraria "<".
 */
function htmlToText(html: string): string {
  return html
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();
}

// Mesma regra que o app aplica na tela: a <img> é um bloco, então só as
// margens a deslocam — `auto` dos dois lados centraliza, `auto` só à esquerda
// encosta na direita.
function alignOf(imgTag: string): 'left' | 'center' | 'right' {
  const style = /\sstyle="([^"]*)"/i.exec(imgTag)?.[1] ?? '';
  const autoLeft = /margin-left\s*:\s*auto/i.test(style);
  const autoRight = /margin-right\s*:\s*auto/i.test(style);
  if (autoLeft && autoRight) return 'center';
  return autoLeft ? 'right' : 'left';
}

/**
 * Quebra um campo do cartão numa sequência de textos e imagens, na ordem em
 * que aparecem. Texto simples (cartões gerados pela IA) nunca tem imagem.
 */
export function toPdfBlocks(value: string, format: string): PdfBlock[] {
  if (format !== 'html') return value.trim() ? [{ type: 'text', text: value }] : [];

  const clean = sanitizeFlashcardHtml(value);
  const blocks: PdfBlock[] = [];
  const pushText = (fragment: string) => {
    const text = htmlToText(fragment);
    if (text) blocks.push({ type: 'text', text });
  };

  let last = 0;
  for (const match of clean.matchAll(IMG_TAG)) {
    pushText(clean.slice(last, match.index));
    const src = /\ssrc="([^"]*)"/i.exec(match[0])?.[1] ?? '';
    blocks.push({ type: 'image', src: src.replace(/&amp;/g, '&'), align: alignOf(match[0]) });
    last = match.index + match[0].length;
  }
  pushText(clean.slice(last));
  return blocks;
}

/**
 * Só imagens embutidas no próprio cartão (`data:`) e só nos formatos que o
 * pdfkit sabe incluir (PNG e JPEG). Nunca busca endereço externo: o servidor
 * não deve fazer requisições a URLs que vieram do conteúdo de um cartão.
 */
export function parseImageDataUri(src: string): Buffer | null {
  const match = /^data:image\/(?:png|jpe?g);base64,([A-Za-z0-9+/=\s]+)$/i.exec(src);
  if (!match) return null;
  const buffer = Buffer.from(match[1], 'base64');
  return buffer.length > 0 && buffer.length <= MAX_IMAGE_BYTES ? buffer : null;
}
