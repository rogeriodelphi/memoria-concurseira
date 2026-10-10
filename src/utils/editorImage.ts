export type ImageAlign = 'left' | 'center' | 'right' | 'justify';

const ALIGN_BY_COMMAND: Record<string, ImageAlign> = {
  justifyLeft: 'left',
  justifyCenter: 'center',
  justifyRight: 'right',
  justifyFull: 'justify',
};

export function imageAlignForCommand(command: string): ImageAlign | null {
  return ALIGN_BY_COMMAND[command] ?? null;
}

/**
 * A imagem selecionada, se a seleção atual do editor for exatamente uma
 * imagem. Lê sempre a seleção real do navegador (nada de estado guardado),
 * então nunca fica "presa" numa imagem depois que o usuário clica em outro lugar.
 */
export function getSelectedImage(root: HTMLElement): HTMLImageElement | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  if (range.startContainer !== range.endContainer || range.endOffset - range.startOffset !== 1) return null;
  const node = range.startContainer.childNodes[range.startOffset];
  return node instanceof HTMLImageElement ? node : null;
}

export function selectImage(img: HTMLImageElement): void {
  const range = document.createRange();
  range.selectNode(img);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

/**
 * Alinha uma imagem pelas margens dela mesma.
 *
 * Não dá pra usar o `text-align` do bloco em volta: o CSS-base do Tailwind
 * deixa toda <img> como `display: block`, e `text-align` não move um elemento
 * de bloco. O comando nativo do navegador (justifyCenter) faz exatamente
 * isso, e ainda grava o `text-align` no próprio <img> — sem efeito algum. Um
 * bloco se alinha pelas margens: auto dos dois lados centraliza, auto só à
 * esquerda encosta na direita. À esquerda é o padrão, então "esquerda" (e
 * "justificar", que não faz sentido pra uma imagem) só limpa o estilo.
 */
export function alignImage(img: HTMLImageElement, align: ImageAlign): void {
  img.style.removeProperty('text-align');

  if (align === 'center' || align === 'right') {
    img.style.display = 'block';
    img.style.marginLeft = 'auto';
    img.style.marginRight = align === 'center' ? 'auto' : '0';
  } else {
    img.style.removeProperty('display');
    img.style.removeProperty('margin-left');
    img.style.removeProperty('margin-right');
  }

  if (!img.getAttribute('style')) img.removeAttribute('style');
}
