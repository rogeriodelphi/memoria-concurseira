import { prepareMatchCard, type Result } from './matchCard';

/**
 * Importar cartões de arrastar e soltar de um arquivo Markdown. O formato é o que a IA devolve quando se pede "cartões de
 * arrastar e soltar":
 *
 *   # Arrastar e soltar: Conceito de gerência de projetos        <- nome sugerido para a coleção (opcional)
 *   ## 1. Projeto, programa, portfólio e operação                <- um título "##" por cartão (o "1." é descartado)
 *   Dificuldade: Fácil                                           <- opcional: Fácil, Médio ou Difícil
 *   | Termo | Descrição |                                        <- a tabela: a linha de cima é só o cabeçalho
 *   |---|---|
 *   | Projeto | Esforço temporário que gera um resultado único |
 *
 * Cada seção vira um cartão; as regras do cartão (2 a 12 pares, termos diferentes, 300 caracteres por parte) são as de
 * `prepareMatchCard`, as mesmas de criar um cartão à mão. Uma seção que não serve não derruba o arquivo: fica de fora e a
 * prévia diz o motivo.
 */

export type MatchDifficulty = 'facil' | 'medio' | 'dificil';

export interface MatchMarkdownCard {
  question: string;
  answer: string;
  difficulty: MatchDifficulty;
}

export interface MatchMarkdownRejected {
  title: string;
  reason: string;
}

export interface ParsedMatchMarkdown {
  /** O título "#" do arquivo sem o prefixo "Arrastar e soltar:", ou '' se não houver. */
  title: string;
  cards: MatchMarkdownCard[];
  rejected: MatchMarkdownRejected[];
  /** Quantas seções "##" o arquivo tem (cartões lidos + recusados). */
  sections: number;
}

export class MatchMarkdownError extends Error {}

/** Um arquivo de cartões é pequeno; este teto só barra um arquivo errado (um PDF renomeado, por exemplo). */
export const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;
export const MAX_MARKDOWN_SECTIONS = 1000;

const TITLE_PREFIX = /^arrastar\s+e\s+soltar\s*[:\-–—]\s*/i;
const SEPARATOR_ROW = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/;

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

function difficultyOf(value: string): MatchDifficulty | null {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  if (normalized === 'facil') return 'facil';
  if (normalized === 'medio') return 'medio';
  if (normalized === 'dificil') return 'dificil';
  return null;
}

/** As células de uma linha de tabela: separa em "|" que não esteja escrito como "\|" e tira as barras das pontas. */
function splitRow(line: string): string[] {
  let body = line.trim();
  if (body.startsWith('|')) body = body.slice(1);
  if (body.endsWith('|') && !body.endsWith('\\|')) body = body.slice(0, -1);
  const cells: string[] = [];
  let current = '';
  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (char === '\\' && body[i + 1] === '|') {
      current += '|';
      i++;
    } else if (char === '|') {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map(collapse);
}

const isTableLine = (line: string) => line.trimStart().startsWith('|');

/** O texto de uma seção em pares "termo::descrição" (ou o motivo de ela não servir). */
function pairsText(lines: string[]): Result<string> {
  const rows: string[][] = [];
  let tables = 0;
  let inTable = false;
  for (const line of lines) {
    if (!isTableLine(line)) {
      inTable = false;
      continue;
    }
    if (!inTable) {
      tables++;
      inTable = true;
    }
    if (tables === 1) rows.push(splitRow(line));
  }
  if (tables === 0) return { ok: false, status: 400, error: 'Não há uma tabela "Termo | Descrição" nesta seção.' };
  if (tables > 1) return { ok: false, status: 400, error: 'Há mais de uma tabela nesta seção; use uma só por cartão.' };

  // A linha de traços marca o fim do cabeçalho: o que vem antes dela (a linha "Termo | Descrição") não é par. Sem a linha
  // de traços, só se descarta a primeira linha se ela for o cabeçalho "Termo | ...".
  const dashes = rows.findIndex((cells) => SEPARATOR_ROW.test(`|${cells.join('|')}|`));
  const dataRows = dashes >= 0 ? rows.slice(dashes + 1) : /^termo$/i.test(rows[0]?.[0] ?? '') ? rows.slice(1) : rows;

  const pairLines: string[] = [];
  for (const cells of dataRows) {
    if (cells.length !== 2) {
      return {
        ok: false,
        status: 400,
        error: `Uma linha da tabela tem ${cells.length} colunas em vez de 2 ("${cells.join(' | ').slice(0, 60)}"). Para uma barra dentro do texto, escreva \\|.`,
      };
    }
    // O "::" é o separador guardado no cartão; dentro de um termo ele viraria o corte errado, então vira ":" (como no editor).
    pairLines.push(`${cells[0].replace(/::/g, ':')}::${cells[1]}`);
  }
  return { ok: true, value: pairLines.join('\n') };
}

export function parseMatchMarkdown(markdown: string): ParsedMatchMarkdown {
  const lines = markdown.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);

  let title = '';
  const sections: { heading: string; lines: string[] }[] = [];
  let inFence = false;
  for (const line of lines) {
    // Dentro de um bloco de código (```), "#" não é título.
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      sections.at(-1)?.lines.push(line);
      continue;
    }
    if (!inFence) {
      const h2 = /^##\s+(.*)$/.exec(line);
      if (h2) {
        sections.push({ heading: h2[1], lines: [] });
        continue;
      }
      const h1 = /^#\s+(.*)$/.exec(line);
      if (h1) {
        if (!title) title = collapse(h1[1]).replace(TITLE_PREFIX, '');
        continue;
      }
    }
    sections.at(-1)?.lines.push(line);
  }

  if (sections.length === 0) {
    throw new MatchMarkdownError(
      'Não encontrei cartões neste arquivo. Cada cartão começa com um título "## ..." e traz uma tabela "Termo | Descrição".',
    );
  }
  if (sections.length > MAX_MARKDOWN_SECTIONS) {
    throw new MatchMarkdownError(`O arquivo tem ${sections.length} cartões; o máximo por arquivo é ${MAX_MARKDOWN_SECTIONS}.`);
  }

  const cards: MatchMarkdownCard[] = [];
  const rejected: MatchMarkdownRejected[] = [];
  for (const section of sections) {
    // "1. Projeto, programa..." → "Projeto, programa..." (a numeração é do arquivo, não do cartão).
    const cardTitle = collapse(section.heading).replace(/^\d+\s*[.)]\s+/, '');
    const reject = (reason: string) => rejected.push({ title: cardTitle || '(sem título)', reason });

    let difficulty: MatchDifficulty = 'medio';
    for (const line of section.lines) {
      const match = /^\s*dificuldade\s*:\s*(.+?)\s*$/i.exec(line);
      if (match) {
        difficulty = difficultyOf(match[1]) ?? 'medio';
        break;
      }
    }

    const pairs = pairsText(section.lines);
    if (!pairs.ok) {
      reject(pairs.error);
      continue;
    }
    const prepared = prepareMatchCard(cardTitle, pairs.value);
    if (!prepared.ok) {
      reject(prepared.error);
      continue;
    }
    cards.push({ ...prepared.value, difficulty });
  }

  return { title, cards, rejected, sections: sections.length };
}

/** O nome sugerido para a coleção: o título do arquivo, ou o nome do arquivo sem extensão. */
export function suggestedCollectionName(parsedTitle: string, filename: string): string {
  const fromFile = filename.replace(/\.(md|markdown|txt)$/i, '').replace(/[_]+/g, ' ').trim();
  const name = parsedTitle || (fromFile ? fromFile.charAt(0).toUpperCase() + fromFile.slice(1) : 'Arrastar e soltar');
  return name.slice(0, 120);
}
