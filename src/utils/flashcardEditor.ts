import type { Flashcard } from '../types';

/**
 * Flashcards gerados pela IA são texto simples — pra abrir no editor de
 * texto rico (que trabalha com HTML), escapa caracteres especiais e troca
 * quebra de linha por <br>, senão um "<" literal no texto viraria uma tag.
 */
export function plainTextToEditorHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r\n|\r|\n/g, '<br>');
}

/** Valor inicial de um campo do cartão no editor de texto rico. */
export function toEditorHtml(value: string, format: Flashcard['format']): string {
  return format === 'html' ? value : plainTextToEditorHtml(value);
}

/**
 * O editor devolve HTML mesmo quando o campo está "vazio" (`<br>`, `<div></div>`),
 * então checar só a string não basta. Imagem sem nenhum texto conta como conteúdo
 * (cartões importados do Anki podem ter resposta que é só uma figura).
 */
export function editorHasContent(html: string): boolean {
  if (/<img\b/i.test(html)) return true;
  return html.replace(/<[^>]+>/g, '').replace(/&nbsp;|\s/gi, '').length > 0;
}
