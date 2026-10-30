import { marksFromStyle, parseInlineStyle, type PNode } from './pasteHtml';

/**
 * O que o editor de texto rico guarda (`<div>` por linha, `<ul>`, negrito...) → texto corrido para mandar à IA. A
 * estrutura vai junto, no jeito que um texto simples a mostra: uma linha por parágrafo, `- ` nos marcadores, `1. ` nas
 * listas numeradas (com recuo nas listas de dentro) e `**negrito**`. É o que deixa a IA saber o que era título e o que
 * era destaque no texto colado, sem mandar HTML.
 *
 * Trabalha sobre `PNode` (o `Node` do DOM já cumpre), como o `pasteHtml`: o mesmo código roda no navegador e nos testes.
 */

const ELEMENT = 1;
const TEXT = 3;

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'IMG', 'SVG', 'IFRAME', 'OBJECT', 'EMBED', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA']);
const BLOCK_TAGS = new Set(['DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'TR', 'TABLE', 'SECTION', 'ARTICLE']);
const BOLD_TAGS = new Set(['B', 'STRONG']);

interface Walk {
  lines: string[];
  current: string;
}

interface Level {
  /** Quantas listas há em volta (o recuo do item). */
  depth: number;
  bold: boolean;
}

function push(walk: Walk) {
  walk.lines.push(walk.current.replace(/\s+$/, ''));
  walk.current = '';
}

/** A linha já tem texto de verdade (o marcador de lista sozinho não conta)? */
function hasText(walk: Walk, marker = ''): boolean {
  return walk.current.slice(marker.length).trim().length > 0;
}

function append(walk: Walk, text: string) {
  // O espaço do começo da linha não conta: vem da quebra do HTML, não do texto.
  const clean = walk.current === '' || walk.current.endsWith(' ') ? text.replace(/^ /, '') : text;
  walk.current += clean;
}

function isBold(el: PNode): boolean {
  // O estilo manda: os botões do editor gravam o negrito como `style="font-weight: bold"`, e o Google Docs embrulha
  // tudo num `<b style="font-weight: normal">`, que NÃO é negrito.
  const fromStyle = marksFromStyle(parseInlineStyle(el.getAttribute?.('style'))).bold;
  return fromStyle ?? BOLD_TAGS.has(el.nodeName.toUpperCase());
}

function children(node: PNode): PNode[] {
  return Array.from(node.childNodes);
}

function walkList(list: PNode, walk: Walk, level: Level) {
  const ordered = list.nodeName.toUpperCase() === 'OL';
  let n = 0;
  for (const item of children(list)) {
    if (item.nodeType !== ELEMENT || item.nodeName.toUpperCase() !== 'LI') continue;
    n += 1;
    if (hasText(walk)) push(walk);
    walk.current = '';
    const marker = `${'  '.repeat(level.depth)}${ordered ? `${n}. ` : '- '}`;
    walk.current = marker;
    walkChildren(item, walk, { ...level, depth: level.depth + 1 });
    if (hasText(walk, marker)) push(walk);
    else walk.current = '';
  }
}

function walkChildren(parent: PNode, walk: Walk, level: Level) {
  for (const node of children(parent)) {
    if (node.nodeType === TEXT) {
      append(walk, (node.nodeValue ?? '').replace(/[\s ]+/g, ' '));
      continue;
    }
    if (node.nodeType !== ELEMENT) continue;
    const tag = node.nodeName.toUpperCase();
    if (SKIP_TAGS.has(tag)) continue;
    if (tag === 'BR') {
      push(walk);
      continue;
    }
    if (tag === 'UL' || tag === 'OL') {
      if (hasText(walk)) push(walk);
      walkList(node, walk, level);
      continue;
    }
    if (BLOCK_TAGS.has(tag)) {
      if (hasText(walk)) push(walk);
      walkChildren(node, walk, level);
      if (hasText(walk)) push(walk);
      continue;
    }
    // Elemento de linha (span, b, font...): continua na mesma linha; o negrito abre e fecha em volta.
    const startsBold = !level.bold && isBold(node);
    const lineCount = walk.lines.length;
    const start = walk.current.length;
    if (startsBold) walk.current += '**';
    walkChildren(node, walk, { ...level, bold: level.bold || startsBold });
    if (startsBold) closeBold(walk, lineCount, start);
  }
}

/**
 * Fecha o negrito aberto em `start`. Os espaços do começo e do fim ficam fora dos asteriscos (`**texto**`, e não
 * `** texto **`), e um negrito sem palavra nenhuma some. Um negrito que atravessou uma quebra de linha perde a marca:
 * um `**` aberto numa linha e fechado em outra confundiria mais do que ajudaria.
 */
function closeBold(walk: Walk, lineCount: number, start: number) {
  if (walk.lines.length !== lineCount) {
    const line = walk.lines[lineCount];
    walk.lines[lineCount] = line.slice(0, start) + line.slice(start + 2);
    return;
  }
  const inner = walk.current.slice(start + 2);
  if (inner.trim() === '') {
    walk.current = walk.current.slice(0, start) + inner;
    return;
  }
  const lead = /^\s*/.exec(inner)![0];
  const trail = /\s*$/.exec(inner)![0];
  const core = inner.slice(lead.length, inner.length - trail.length);
  walk.current = `${walk.current.slice(0, start)}${lead}**${core}**${trail}`;
}

function tidy(text: string): string {
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** O texto de uma árvore já lida (o `body` de um documento HTML). Vazio quando só sobra marcação. */
export function treeToText(root: PNode): string {
  const walk: Walk = { lines: [], current: '' };
  walkChildren(root, walk, { depth: 0, bold: false });
  if (walk.current.trim()) push(walk);
  return tidy(walk.lines.join('\n'));
}

/** O HTML do editor como texto para a IA. */
export function editorHtmlToText(html: string): string {
  if (!html || typeof DOMParser === 'undefined') return '';
  try {
    // O DOMParser monta um documento inerte: nada executa, nenhuma imagem é baixada.
    return treeToText(new DOMParser().parseFromString(html, 'text/html').body);
  } catch {
    return '';
  }
}

const MAX_TITLE = 120;

/** O título de um resumo escrito à mão: a primeira linha do texto, sem marcador nem negrito, num tamanho de título. */
export function summaryTitleFromText(text: string): string {
  const firstLine =
    text
      .split('\n')
      .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s+/, '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim())
      .find((line) => line.length > 0) ?? '';
  if (!firstLine) return 'Resumo';
  if (firstLine.length <= MAX_TITLE) return firstLine;
  const cut = firstLine.slice(0, MAX_TITLE);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > MAX_TITLE / 2 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.-]+$/, '')}…`;
}
