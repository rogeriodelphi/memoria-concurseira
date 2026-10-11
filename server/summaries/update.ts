import { sanitizeFlashcardHtml } from '../sanitizeHtml';

export const MAX_TITLE_CHARS = 200;
export const MAX_CONTENT_CHARS = 500_000;

export interface SummaryUpdate {
  title: string;
  content: string;
  format: 'plain' | 'html';
}

export type SummaryUpdateResult = { ok: true; value: SummaryUpdate } | { ok: false; error: string };

/**
 * O editor devolve HTML mesmo quando o texto está "vazio" (`<br>`, `<div></div>`), então
 * checar só a string não basta. Imagem sem nenhum texto conta como conteúdo.
 */
function htmlHasContent(html: string): boolean {
  if (/<img\b/i.test(html)) return true;
  return html.replace(/<[^>]+>/g, '').replace(/&nbsp;|\s/gi, '').length > 0;
}

/**
 * Valida e normaliza a edição de um resumo, devolvendo o que gravar ou a mensagem de erro.
 * O HTML do editor passa pelo mesmo sanitizador dos cartões: o que chega do navegador nunca
 * é gravado como veio.
 */
export function prepareSummaryUpdate(body: unknown): SummaryUpdateResult {
  const { title, content, format } = (body ?? {}) as Record<string, unknown>;

  const cleanTitle = typeof title === 'string' ? title.replace(/\s+/g, ' ').trim() : '';
  if (!cleanTitle) return { ok: false, error: 'Informe um título para o resumo.' };
  if (cleanTitle.length > MAX_TITLE_CHARS) {
    return { ok: false, error: `O título passa de ${MAX_TITLE_CHARS} caracteres.` };
  }

  if (typeof content !== 'string') return { ok: false, error: 'O resumo não pode ficar vazio.' };
  const nextFormat = format === 'html' ? 'html' : 'plain';
  const cleanContent = nextFormat === 'html' ? sanitizeFlashcardHtml(content.trim()) : content.trim();
  const hasContent = nextFormat === 'html' ? htmlHasContent(cleanContent) : cleanContent.length > 0;
  if (!hasContent) return { ok: false, error: 'O resumo não pode ficar vazio.' };
  if (cleanContent.length > MAX_CONTENT_CHARS) {
    return { ok: false, error: 'O resumo é grande demais. Reduza o texto ou o tamanho das imagens.' };
  }

  return { ok: true, value: { title: cleanTitle, content: cleanContent, format: nextFormat } };
}
