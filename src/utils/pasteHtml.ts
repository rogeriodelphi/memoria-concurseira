/**
 * Converte o HTML que veio na área de transferência (copiado de um site, do Word, do Google Docs, de um chat de
 * IA...) para o pouco de marcação que o editor de cartões sabe guardar: negrito, itálico, sublinhado,
 * sobrescrito/subscrito, cor do texto e realce (só as cores vivas), listas, parágrafos e quebras de linha. É
 * exatamente o que o sanitizador do servidor aceita, então nada do que sai daqui é cortado depois.
 *
 * Fica de fora, de propósito: fonte e tamanho; as cores neutras (preto, cinza, branco: são o tema do site, e ficariam
 * ilegíveis no tema do app, enquanto um laranja ou um azul foi escolhido para destacar); links (só o texto); imagens
 * (apontam para o site de origem e quebrariam; imagem colada de verdade segue outro caminho no editor) e todo script,
 * estilo e controle de formulário.
 *
 * Trabalha sobre uma interface mínima de nó (`PNode`), que o `Node` do DOM já cumpre: assim o mesmo código roda no
 * navegador e nos testes.
 */

export interface PNode {
  nodeType: number;
  nodeName: string;
  nodeValue: string | null;
  childNodes: ArrayLike<PNode>;
  getAttribute?(name: string): string | null;
  hasAttribute?(name: string): boolean;
}

const ELEMENT = 1;
const TEXT = 3;

/** HTML colado maior que isso volta como texto simples: converter páginas inteiras travaria a digitação. */
const MAX_HTML_CHARS = 400_000;

interface Marks {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  sup: boolean;
  sub: boolean;
  /** `rgb(r, g, b)` de uma cor viva, ou nenhuma. */
  color: string | null;
  highlight: string | null;
}
const NO_MARKS: Marks = { bold: false, italic: false, underline: false, sup: false, sub: false, color: null, highlight: null };

const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'HEAD', 'TITLE', 'META', 'LINK', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'CANVAS',
  'IMG', 'PICTURE', 'VIDEO', 'AUDIO', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'HR',
]);

/** Quem ocupa uma linha própria. O resto (span, a, b, i, font...) corre dentro da linha. */
const BLOCK_TAGS = new Set([
  'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY', 'TFOOT',
  'TR', 'TD', 'TH', 'SECTION', 'ARTICLE', 'ASIDE', 'HEADER', 'FOOTER', 'MAIN', 'NAV', 'FIGURE', 'FIGCAPTION', 'ADDRESS',
  'DETAILS', 'SUMMARY', 'DL', 'DT', 'DD', 'FORM', 'FIELDSET', 'BODY', 'HTML', 'CENTER',
]);

/** Os que são um parágrafo de verdade: o site deixa um respiro depois deles, e o cartão também deixa. */
const PARAGRAPH_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'DT', 'FIGCAPTION']);

const HEADING = /^H[1-6]$/;
const SPACER = '<div><br></div>';

// ---------- estilo inline (as partes puras, testáveis sozinhas) ----------

/** `"font-weight: bold; color: red"` → `{ 'font-weight': 'bold', color: 'red' }` (nomes em minúsculas). */
export function parseInlineStyle(text: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!text) return out;
  for (const declaration of text.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon < 1) continue;
    const name = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).trim().toLowerCase().replace(/\s*!important$/, '');
    if (name && value) out[name] = value;
  }
  return out;
}

type Rgb = [number, number, number];

/** Os nomes de cor que um site usaria para destacar (os neutros, como black e gray, não precisam: são descartados). */
const NAMED_COLORS: Record<string, Rgb> = {
  red: [255, 0, 0], orangered: [255, 69, 0], tomato: [255, 99, 71], coral: [255, 127, 80], orange: [255, 165, 0],
  darkorange: [255, 140, 0], gold: [255, 215, 0], yellow: [255, 255, 0], chocolate: [210, 105, 30], goldenrod: [218, 165, 32],
  brown: [165, 42, 42], maroon: [128, 0, 0], darkred: [139, 0, 0], firebrick: [178, 34, 34], crimson: [220, 20, 60],
  deeppink: [255, 20, 147], hotpink: [255, 105, 180], magenta: [255, 0, 255], fuchsia: [255, 0, 255], violet: [238, 130, 238],
  orchid: [218, 112, 214], purple: [128, 0, 128], indigo: [75, 0, 130], slateblue: [106, 90, 205], blue: [0, 0, 255],
  mediumblue: [0, 0, 205], navy: [0, 0, 128], royalblue: [65, 105, 225], dodgerblue: [30, 144, 255], steelblue: [70, 130, 180],
  deepskyblue: [0, 191, 255], cyan: [0, 255, 255], aqua: [0, 255, 255], turquoise: [64, 224, 208], teal: [0, 128, 128],
  green: [0, 128, 0], darkgreen: [0, 100, 0], forestgreen: [34, 139, 34], seagreen: [46, 139, 87], limegreen: [50, 205, 50],
  lime: [0, 255, 0], olive: [128, 128, 0],
};

function hslToRgb(h: number, s: number, l: number): Rgb {
  const sat = s / 100;
  const light = l / 100;
  const a = sat * Math.min(light, 1 - light);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    return light - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  return [channel(0), channel(8), channel(4)].map((v) => Math.round(v * 255)) as Rgb;
}

/** `0.5` ou `50%` → 0.5 */
const fraction = (text: string) => (text.endsWith('%') ? Number(text.slice(0, -1)) / 100 : Number(text));

/**
 * O que um site escreve como cor → `[r, g, b]`: `#e8761e`, `#f70`, `rgb(232, 118, 30)`, `rgb(232 118 30 / 1)`, `rgb(91% 46% 12%)`,
 * `hsl(28, 80%, 52%)`, o nome (`orange`) e `var(--x, #e8761e)` (vale o que vem depois da vírgula). Transparência, uma
 * variável sem valor reserva e qualquer outra coisa dão `null`.
 */
export function parseColor(value: string): Rgb | null {
  const named = NAMED_COLORS[value];
  if (named) return named;

  const withFallback = /^var\(\s*--[\w-]+\s*,\s*(.+)\)$/.exec(value);
  if (withFallback) return parseColor(withFallback[1].trim());

  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(value);
  if (hex) {
    const short = hex[1].length <= 4;
    const digits = short ? hex[1].replace(/./g, (d) => d + d) : hex[1];
    if (digits.length === 8 && digits.slice(6) !== 'ff') return null; // com transparência
    return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)) as Rgb;
  }

  const rgb = /^rgba?\(\s*([\d.]+%?)\s*[,\s]\s*([\d.]+%?)\s*[,\s]\s*([\d.]+%?)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/.exec(value);
  if (rgb) {
    if (rgb[4] !== undefined && fraction(rgb[4]) < 1) return null;
    const channels = [rgb[1], rgb[2], rgb[3]].map((c) => (c.endsWith('%') ? Math.round(fraction(c) * 255) : Number(c)));
    return channels.every((c) => Number.isFinite(c) && c >= 0 && c <= 255) ? (channels as Rgb) : null;
  }

  const hsl = /^hsla?\(\s*([\d.]+)(?:deg)?\s*[,\s]\s*([\d.]+)%\s*[,\s]\s*([\d.]+)%\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/.exec(value);
  if (hsl) {
    if (hsl[4] !== undefined && fraction(hsl[4]) < 1) return null;
    const [h, s, l] = [Number(hsl[1]) % 360, Number(hsl[2]), Number(hsl[3])];
    return s <= 100 && l <= 100 ? hslToRgb(h, s, l) : null;
  }
  return null;
}

/** O azul de link (o do navegador e o da maioria dos sites): matiz entre o azul-claro e o violeta. */
export function isLinkBlue([r, g, b]: Rgb): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return false;
  const delta = max - min;
  const hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  const degrees = (hue * 60 + 360) % 360;
  return degrees >= 195 && degrees <= 260;
}

/** Uma cor escolhida para destacar (laranja, azul, vermelho...), e não o preto, o cinza ou o branco do tema do site. */
export function isVivid([r, g, b]: [number, number, number]): boolean {
  return Math.max(r, g, b) - Math.min(r, g, b) >= 50;
}

/** A cor do estilo no formato que o editor guarda, ou `undefined` quando é neutra, transparente ou desconhecida. */
function vividColor(value: string | undefined): string | undefined {
  const rgb = value ? parseColor(value) : null;
  return rgb && isVivid(rgb) ? `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})` : undefined;
}

/** O que o estilo inline de um elemento liga (ou desliga, quando o site diz "normal") em cada marca. */
export function marksFromStyle(style: Record<string, string>): Partial<Marks> {
  const result: Partial<Marks> = {};
  const color = vividColor(style.color);
  if (color) result.color = color;
  const highlight = vividColor(style['background-color']);
  if (highlight) result.highlight = highlight;
  const weight = style['font-weight'];
  if (weight) result.bold = weight === 'bold' || weight === 'bolder' || (/^\d{3}$/.test(weight) && Number(weight) >= 600);
  const fontStyle = style['font-style'];
  if (fontStyle) result.italic = fontStyle === 'italic' || fontStyle === 'oblique';
  const decoration = `${style['text-decoration-line'] ?? ''} ${style['text-decoration'] ?? ''}`;
  if (style['text-decoration-line'] || style['text-decoration']) result.underline = /\bunderline\b/.test(decoration);
  const align = style['vertical-align'];
  if (align) {
    result.sup = align === 'super';
    result.sub = align === 'sub';
  }
  return result;
}

/** `white-space: pre`, `pre-wrap`, `pre-line`: as quebras de linha do texto são quebras de verdade (VS Code, `<pre>`). */
export function keepsLineBreaks(style: Record<string, string>): boolean {
  return /^pre/.test(style['white-space'] ?? '');
}

function isHidden(style: Record<string, string>, el: PNode): boolean {
  return style.display === 'none' || style.visibility === 'hidden' || el.hasAttribute?.('hidden') === true;
}

// ---------- marcas ----------

const TAG_MARKS: Record<string, Partial<Marks>> = {
  B: { bold: true },
  STRONG: { bold: true },
  I: { italic: true },
  EM: { italic: true },
  CITE: { italic: true },
  DFN: { italic: true },
  U: { underline: true },
  INS: { underline: true },
  SUP: { sup: true },
  SUB: { sub: true },
  TH: { bold: true },
};

function marksOf(el: PNode): Partial<Marks> {
  const tag = el.nodeName.toUpperCase();
  const own: Partial<Marks> = { ...(HEADING.test(tag) ? { bold: true } : TAG_MARKS[tag]) };
  // O estilo manda: o Google Docs embrulha tudo num <b style="font-weight:normal">, que NÃO é negrito.
  // <font color="#e67e22">: a forma antiga de colorir, ainda comum nos editores de texto dos sites (o estilo, se houver, vale mais).
  if (tag === 'FONT') {
    const legacy = vividColor(el.getAttribute?.('color')?.trim().toLowerCase());
    if (legacy) own.color = legacy;
  }
  const fromStyle = marksFromStyle(parseInlineStyle(el.getAttribute?.('style')));
  Object.assign(own, fromStyle);
  // O navegador grava no estilo o sublinhado e a cor do link ao copiar; como o link não vem, o sublinhado e o
  // fundo também não. A cor fica quando não é o azul de link: um termo destacado em laranja que seja link continua laranja.
  if (tag === 'A') {
    delete own.underline;
    delete own.highlight;
    const rgb = own.color ? parseColor(own.color) : null;
    if (rgb && isLinkBlue(rgb)) delete own.color;
  }
  // O fundo de um bloco inteiro (um quadro, um cartão do site) não é realce de texto.
  if (BLOCK_TAGS.has(tag)) delete own.highlight;
  return own;
}

function merge(base: Marks, own: Partial<Marks>): Marks {
  return {
    bold: own.bold ?? base.bold,
    italic: own.italic ?? base.italic,
    underline: own.underline ?? base.underline,
    sup: own.sup ?? base.sup,
    sub: own.sub ?? base.sub,
    color: own.color ?? base.color,
    highlight: own.highlight ?? base.highlight,
  };
}

function wrap(html: string, marks: Marks, against: Marks): string {
  // Só abre a marca que o pai ainda não abriu: não vira <b><b>texto</b></b>.
  let out = html;
  if (marks.bold && !against.bold) out = `<b>${out}</b>`;
  if (marks.italic && !against.italic) out = `<i>${out}</i>`;
  if (marks.underline && !against.underline) out = `<u>${out}</u>`;
  if (marks.sup && !against.sup) out = `<sup>${out}</sup>`;
  if (marks.sub && !against.sub) out = `<sub>${out}</sub>`;
  const css: string[] = [];
  if (marks.color && marks.color !== against.color) css.push(`color: ${marks.color}`);
  if (marks.highlight && marks.highlight !== against.highlight) css.push(`background-color: ${marks.highlight}`);
  if (css.length > 0) out = `<span style="${css.join('; ')}">${out}</span>`;
  return out;
}

// ---------- percurso ----------

interface Context {
  /** As marcas que o bloco em volta já aplica à linha inteira (um título, um parágrafo em negrito). */
  marks: Marks;
  pre: boolean;
}

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function textHtml(raw: string, ctx: Context): string {
  if (ctx.pre) return raw.replace(/\r\n?/g, '\n').split('\n').map(escapeHtml).join('<br>');
  return escapeHtml(raw.replace(/[ \s]+/g, ' '));
}

function tagOf(node: PNode): string {
  return node.nodeName.toUpperCase();
}

function isElement(node: PNode): boolean {
  return node.nodeType === ELEMENT;
}

function elementChildren(node: PNode): PNode[] {
  return Array.from(node.childNodes).filter(isElement);
}

function hasBlockDescendant(node: PNode): boolean {
  return elementChildren(node).some((child) => BLOCK_TAGS.has(tagOf(child)) || hasBlockDescendant(child));
}

/** O conteúdo de um elemento como texto corrido (sem quebrar em linhas): título, célula de tabela, item curto. */
function inlineHtml(node: PNode, ctx: Context): string {
  let out = '';
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === TEXT) {
      out += textHtml(child.nodeValue ?? '', ctx);
      continue;
    }
    if (!isElement(child)) continue;
    const tag = tagOf(child);
    const style = parseInlineStyle(child.getAttribute?.('style'));
    if (SKIP_TAGS.has(tag) || isHidden(style, child)) continue;
    if (tag === 'BR') {
      out += '<br>';
      continue;
    }
    const marks = merge(ctx.marks, marksOf(child));
    const inner = inlineHtml(child, { marks, pre: ctx.pre || tag === 'PRE' || keepsLineBreaks(style) });
    const separated = BLOCK_TAGS.has(tag) ? ` ${inner} ` : inner;
    out += wrap(separated, marks, ctx.marks);
  }
  return out;
}

/** O texto visível de um trecho de HTML, para saber se vale uma linha. */
const hasContent = (html: string) => html.replace(/<br>/g, '').replace(/<[^>]+>/g, '').trim().length > 0;

function trimInline(html: string): string {
  return html
    .replace(/^(\s|<br>)+/, '')
    .replace(/(\s|<br>)+$/, '')
    .replace(/^((<(b|i|u|sup|sub)>)+)\s+/, '$1')
    .replace(/\s+((<\/(b|i|u|sup|sub)>)+)$/, '$1');
}

/** Uma linha só (`<div>…</div>` sem outra linha dentro). */
const isSimpleLine = (block: string) => block.startsWith('<div>') && block.endsWith('</div>') && !block.slice(5).includes('<div>');

function listHtml(list: PNode, ctx: Context): string {
  const items: string[] = [];
  for (const child of elementChildren(list)) {
    if (tagOf(child) !== 'LI') continue;
    const blocks = dropEdgeSpacers(blocksOf(child, ctx));
    // O primeiro texto do item fica na linha do marcador, sem <div> em volta.
    if (blocks.length > 0 && isSimpleLine(blocks[0])) blocks[0] = blocks[0].slice(5, -6);
    const inner = blocks.join('');
    if (hasContent(inner) || inner.includes('<ul>') || inner.includes('<ol>')) items.push(`<li>${inner}</li>`);
  }
  if (items.length === 0) return '';
  const tag = tagOf(list) === 'OL' ? 'ol' : 'ul';
  return `<${tag}>${items.join('')}</${tag}>`;
}

function tableRows(table: PNode): PNode[] {
  const rows: PNode[] = [];
  for (const child of elementChildren(table)) {
    const tag = tagOf(child);
    if (tag === 'TR') rows.push(child);
    else if (tag === 'THEAD' || tag === 'TBODY' || tag === 'TFOOT') rows.push(...tableRows(child));
  }
  return rows;
}

/** O Word e os sites usam tabela; o editor não tem. Cada linha vira uma linha de texto, com as células separadas por " | ". */
function tableHtml(table: PNode, ctx: Context): string[] {
  const lines: string[] = [];
  for (const row of tableRows(table)) {
    const cells = elementChildren(row)
      .filter((cell) => tagOf(cell) === 'TD' || tagOf(cell) === 'TH')
      .map((cell) => {
        const marks = merge(ctx.marks, marksOf(cell));
        return wrap(trimInline(inlineHtml(cell, { ...ctx, marks })), marks, ctx.marks);
      })
      .filter((cell) => hasContent(cell));
    if (cells.length > 0) lines.push(`<div>${cells.join(' | ')}</div>`);
  }
  return lines;
}

function dropEdgeSpacers(blocks: string[]): string[] {
  const out = [...blocks];
  while (out[0] === SPACER) out.shift();
  while (out[out.length - 1] === SPACER) out.pop();
  return out;
}

/** As linhas (blocos) de um elemento. Texto solto e elementos de linha entre blocos formam uma linha própria. */
function blocksOf(parent: PNode, ctx: Context): string[] {
  const out: string[] = [];
  let line = '';

  const flush = () => {
    const trimmed = trimInline(line);
    line = '';
    if (hasContent(trimmed)) out.push(`<div>${wrap(trimmed, ctx.marks, NO_MARKS)}</div>`);
  };

  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType === TEXT) {
      line += textHtml(child.nodeValue ?? '', ctx);
      continue;
    }
    if (!isElement(child)) continue;
    const tag = tagOf(child);
    const style = parseInlineStyle(child.getAttribute?.('style'));
    if (SKIP_TAGS.has(tag) || isHidden(style, child)) continue;
    if (tag === 'BR') {
      line += '<br>';
      continue;
    }

    const marks = merge(ctx.marks, marksOf(child));
    const inherited: Context = { marks, pre: ctx.pre || tag === 'PRE' || keepsLineBreaks(style) };

    if (tag === 'UL' || tag === 'OL') {
      flush();
      const html = listHtml(child, inherited);
      if (html) out.push(html);
    } else if (tag === 'TABLE') {
      flush();
      out.push(...tableHtml(child, inherited));
    } else if (BLOCK_TAGS.has(tag) || hasBlockDescendant(child)) {
      flush();
      out.push(...blocksOf(child, inherited));
      if (PARAGRAPH_TAGS.has(tag)) out.push(SPACER);
    } else {
      // elemento de linha (span, b, i, a, font...): fica dentro da linha atual, com as suas marcas
      line += wrap(inlineHtml(child, inherited), marks, ctx.marks);
    }
  }
  flush();
  return out;
}

/** Junta as linhas, sem respiros seguidos nem nas pontas. */
function render(blocks: string[]): string {
  const cleaned: string[] = [];
  for (const block of dropEdgeSpacers(blocks)) {
    if (block === SPACER && cleaned[cleaned.length - 1] === SPACER) continue;
    cleaned.push(block);
  }
  // Uma única linha simples não leva <div>: colada no meio de uma frase, ela não deve partir a linha em duas.
  if (cleaned.length === 1 && isSimpleLine(cleaned[0])) return cleaned[0].slice(5, -6);
  return cleaned.join('');
}

/** A conversão em si, sobre uma árvore já lida (o `body` de um documento HTML). Vazio quando não sobra texto. */
export function convertPastedTree(root: PNode): string {
  const ctx: Context = { marks: NO_MARKS, pre: false };
  // Só texto corrido (uma palavra, uma frase): vai para o meio de uma linha, então o espaço das pontas conta. No
  // Windows, o duplo clique seleciona a palavra com o espaço depois; sem ele, "meio depois" colaria como "meiodepois".
  if (!hasBlockDescendant(root)) {
    const html = inlineHtml(root, ctx).replace(/^(<br>)+|(<br>)+$/g, '');
    return hasContent(html) ? html.replace(/^\s+/, ' ').replace(/\s+$/, ' ') : '';
  }
  return render(blocksOf(root, ctx));
}

/**
 * O HTML colado, limpo para o editor. Devolve "" quando não há o que aproveitar (ou o HTML é grande demais): quem
 * chama cola o texto simples nesse caso.
 */
export function cleanPastedHtml(html: string): string {
  if (!html || html.length > MAX_HTML_CHARS || typeof DOMParser === 'undefined') return '';
  try {
    // O DOMParser monta um documento inerte: nada executa, nenhuma imagem é baixada.
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return convertPastedTree(doc.body);
  } catch {
    return '';
  }
}
