/**
 * O cartão "Arrastar e soltar" (`kind = 'match'`): um título e uma lista de pares termo/descrição que se estudam
 * arrastando cada descrição para o termo certo. Nada novo no banco além da coluna `kind`: o título fica em `question` e
 * os pares em `answer`, em texto simples, uma linha "termo::descrição" por par (o mesmo formato do Anki). Assim o resto do
 * app (exportar, listar, ouvir, o Professor) continua tratando o cartão como um cartão comum com resposta legível.
 */

export type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
const fail = (error: string): Result<never> => ({ ok: false, status: 400, error });

export const MATCH_KIND = 'match';
export const MIN_PAIRS = 2;
export const MAX_PAIRS = 12;
/** O limite de cada termo, de cada descrição e do título. */
export const MAX_PART_CHARS = 300;

const SEPARATOR = '::';

export interface MatchPair {
  term: string;
  description: string;
}

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Os pares guardados em `answer`: confere cada linha e o conjunto. */
export function validatePairs(text: unknown): Result<MatchPair[]> {
  const lines = typeof text === 'string' ? text.split(/\r\n|\r|\n/).map((l) => l.trim()).filter(Boolean) : [];
  if (lines.length < MIN_PAIRS) return fail(`Informe ao menos ${MIN_PAIRS} pares (termo e descrição).`);
  if (lines.length > MAX_PAIRS) return fail(`Use no máximo ${MAX_PAIRS} pares por cartão.`);

  const pairs: MatchPair[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const at = line.indexOf(SEPARATOR);
    const term = at < 0 ? '' : collapse(line.slice(0, at));
    const description = at < 0 ? '' : collapse(line.slice(at + SEPARATOR.length));
    if (!term || !description) return fail('Cada par precisa ter um termo e uma descrição.');
    if (term.length > MAX_PART_CHARS || description.length > MAX_PART_CHARS) {
      return fail(`Cada termo e cada descrição pode ter até ${MAX_PART_CHARS} caracteres.`);
    }
    const key = term.toLocaleLowerCase('pt-BR');
    if (seen.has(key)) return fail(`O termo "${term}" aparece mais de uma vez.`);
    seen.add(key);
    pairs.push({ term, description });
  }
  return { ok: true, value: pairs };
}

export const serializePairs = (pairs: readonly MatchPair[]): string => pairs.map((p) => `${p.term}${SEPARATOR}${p.description}`).join('\n');

/**
 * Valida e normaliza um cartão de arrastar e soltar: título em uma linha só, pares na forma canônica. É o que vai para o
 * banco (sempre em texto simples: nada aqui é HTML).
 */
export function prepareMatchCard(question: unknown, answer: unknown): Result<{ question: string; answer: string }> {
  const title = typeof question === 'string' ? collapse(question) : '';
  if (!title) return fail('Informe o título do cartão.');
  if (title.length > MAX_PART_CHARS) return fail(`O título pode ter até ${MAX_PART_CHARS} caracteres.`);
  const pairs = validatePairs(answer);
  if (!pairs.ok) return pairs;
  return { ok: true, value: { question: title, answer: serializePairs(pairs.value) } };
}

// ---------- Anki ----------

const ENTITIES: [RegExp, string][] = [
  [/&nbsp;/gi, ' '],
  [/&lt;/gi, '<'],
  [/&gt;/gi, '>'],
  [/&quot;/gi, '"'],
  [/&#39;/g, "'"],
  [/&amp;/gi, '&'],
];

/**
 * O campo HTML de uma nota do Anki em linhas de texto: <br> e a abertura ou o fechamento de <div>, <p>, <li> e <tr>
 * quebram a linha (o editor do Anki grava a primeira linha solta e as seguintes cada uma numa <div>), o resto das tags some.
 */
export function ankiFieldToLines(html: string): string[] {
  let text = html
    .replace(/\[sound:[^\]]*\]/gi, '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/?\s*(div|p|li|tr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  for (const [pattern, replacement] of ENTITIES) text = text.replace(pattern, replacement);
  return text.split(/\r\n|\r|\n/).map(collapse).filter(Boolean);
}

/**
 * Reconhece, numa nota do Anki, o modelo de arrastar e soltar: o primeiro campo é o título e o segundo traz uma linha
 * "termo::descrição" por par. Só vale se TODAS as linhas do segundo campo são pares e o conjunto passa nas regras do
 * cartão; qualquer dúvida devolve null e a nota entra como um cartão comum, como sempre entrou.
 */
export function matchFromAnki(front: string, back: string): { question: string; answer: string } | null {
  const lines = ankiFieldToLines(back);
  if (lines.length < MIN_PAIRS || !lines.every((line) => line.includes(SEPARATOR))) return null;
  const prepared = prepareMatchCard(ankiFieldToLines(front).join(' '), lines.join('\n'));
  return prepared.ok ? prepared.value : null;
}
