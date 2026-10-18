/**
 * Leitura de provas anteriores (PDF) em questões de múltipla escolha com gabarito. O prompt, o esquema, o corte do
 * texto em trechos e a validação ficam aqui, num módulo neutro, e são os mesmos para OpenAI, Gemini e Claude.
 *
 * A IA só TRANSCREVE: copia enunciado e alternativas como estão no PDF e nunca resolve a questão. O gabarito vem
 * só do que está escrito no próprio PDF (ou num segundo arquivo); sem ele a questão fica "sem gabarito" e o
 * usuário informa depois. Depois da leitura, o texto de cada questão é conferido contra o texto do PDF para
 * avisar quando a IA parece ter reescrito algo.
 */

export const MAX_QUESTIONS_PER_EXAM = 200;
/** Tamanho de cada trecho do PDF enviado à IA, em caracteres: o bastante para ~10 questões sem estourar a resposta. */
export const CHUNK_CHARS = 16_000;
/** Quanto um trecho repete do anterior, para uma questão cortada na emenda aparecer inteira no trecho seguinte. */
export const CHUNK_OVERLAP_CHARS = 4_500;
/** Texto demais para ler em trechos (provas com cadernos de várias versões, apostilas): melhor recusar do que gastar à toa. */
export const MAX_EXAM_CHARS = 400_000;

export const LEVELS = ['Fundamental', 'Médio', 'Técnico', 'Superior'] as const;
export type Level = (typeof LEVELS)[number];

const LETTERS = ['A', 'B', 'C', 'D', 'E'] as const;
const MAX_STATEMENT_CHARS = 6_000;
const MAX_SUPPORT_CHARS = 12_000;
const MAX_ALTERNATIVE_CHARS = 2_000;
const MAX_LABEL_CHARS = 160;
const MAX_PROVA_CHARS = 300;
/** O gabarito comentado de um site de questões traz o fundamento, a análise de cada alternativa e dicas: é longo. */
export const MAX_COMMENT_CHARS = 12_000;
const MAX_SOURCE_ID_CHARS = 40;

/** Como a IA devolve um trecho. Os números das questões são os do PDF. */
export interface RawChunk {
  exam: { name: string; board: string; organ: string; year: number; position: string; level: string };
  supports: { id: number; text: string }[];
  questions: {
    number: number;
    /** O código da questão no site de onde o PDF veio (ex.: "Q4229308"); vazio numa prova comum. */
    sourceId: string;
    supportId: number;
    statement: string;
    alternatives: { letter: string; text: string }[];
    /** A alternativa certa, só quando está escrita junto da questão ("Gabarito: C"); vazio senão. */
    answer: string;
    /** O gabarito comentado transcrito; vazio se não houver. */
    comment: string;
    /** Ano, banca, órgão e prova desta questão (um site de questões mistura provas); vazio numa prova comum. */
    year: number;
    board: string;
    organ: string;
    prova: string;
    discipline: string;
    subject: string;
    needsFigure: boolean;
    complete: boolean;
  }[];
  answerKey: { number: number; answer: string }[];
}

export interface Alternative {
  letter: string;
  text: string;
}

export interface ExtractedQuestion {
  number: number;
  /** O código da questão no site de origem; vazio numa prova comum. */
  sourceId: string;
  support: string;
  statement: string;
  alternatives: Alternative[];
  /** A alternativa certa quando está escrita junto da questão; senão vazio (o gabarito pode vir de outro lugar). */
  answer: string;
  /** O gabarito comentado. */
  comment: string;
  /** Os dados próprios da questão; vazios quando valem os da prova inteira. */
  year: number | null;
  board: string;
  organ: string;
  prova: string;
  discipline: string;
  subject: string;
  needsFigure: boolean;
}

export interface ExamMeta {
  name: string;
  board: string;
  organ: string;
  year: number | null;
  position: string;
  level: Level | '';
}

/** A leitura de um trecho já limpa: as questões inteiras e válidas, e o gabarito que o trecho trouxe. */
export interface Chunk {
  meta: ExamMeta;
  questions: ExtractedQuestion[];
  /** Por número da questão: a letra, ou 'ANULADA'. */
  answerKey: Map<number, string>;
}

export const ANNULLED = 'ANULADA';

export const PASTEXAM_SYSTEM_PROMPT = `Você transcreve provas de concursos públicos brasileiros (e os gabaritos delas) para um banco de questões.
Você recebe um trecho do texto de um PDF e devolve as questões de múltipla escolha que COMEÇAM nesse trecho, mais o
gabarito, se o trecho trouxer um.

Regras:
- TRANSCREVA, não reescreva. Copie enunciado e alternativas exatamente como estão no PDF (inclusive números, siglas,
  pontuação e símbolos), corrigindo apenas quebras de linha e hifenização que o PDF tenha inserido no meio das frases.
  Não resuma, não corrija, não traduza, não complete o que falta.
- NUNCA resolva a questão nem escolha a alternativa certa por conta própria. O gabarito só entra em "answerKey" quando
  está ESCRITO no trecho (uma tabela ou lista "1-A, 2-C...", ou "Gabarito"). Sem gabarito no trecho, "answerKey" fica vazio.
- Questão do tipo Certo/Errado (sem letras): devolva duas alternativas, letra "C" com o texto "Certo" e letra "E" com o
  texto "Errado". Nas demais, use as letras A, B, C, D, E como estão na prova.
- Textos de apoio (o texto que várias questões compartilham, ex.: "Leia o texto a seguir para responder às questões 5 a 8"):
  coloque cada texto UMA vez em "supports" e aponte para ele, em cada questão, por "supportId" (0 quando a questão não
  tem texto de apoio). O enunciado da questão não repete o texto de apoio.
- "number" é o número da questão no PDF. "discipline" e "subject" (assunto) vêm do cabeçalho do PDF; se o trecho não
  disser, deduza pelo conteúdo, usando nomes curtos e padronizados (ex.: "Língua Portuguesa", "Direito Administrativo").
  Quando houver uma lista de disciplinas sugeridas, use exatamente esses nomes sempre que servirem.
- PÁGINAS DE SITE DE QUESTÕES (a captura ou impressão de uma busca, com várias questões de provas diferentes, cada uma com
  um código como "Q4229308", um caminho "Disciplina › Assunto" e uma linha "Ano / Banca / Órgão / Prova"): para CADA
  questão preencha "sourceId" (o código), "year", "board" (Banca), "organ" (Órgão) e "prova" (o texto do campo Prova, por
  inteiro), copiados da linha da própria questão. Em "discipline" e "subject" use o caminho "Disciplina › Assunto" (se houver
  mais de um assunto, o primeiro). "number" é a posição da questão na lista (1, 2, 3...). Ignore tudo que não é questão:
  menus, filtros, botões, contagem de resultados, curtidas, comentários de alunos.
- "answer": a alternativa certa da questão, SOMENTE quando está escrita junto dela ("Gabarito: C" ou a alternativa marcada
  como CERTA no gabarito comentado). Sem isso, deixe vazio. Nunca resolva a questão para preencher.
- "comment": o "Gabarito Comentado" daquela questão, transcrito por inteiro e na ordem (fundamento, tema, análise de cada
  alternativa com o veredito CERTA ou ERRADA, pegadinha, dicas). Não inclua o nome do autor nem os botões de curtir. Vazio
  quando a questão não tem gabarito comentado visível. O texto continua de uma página para a outra: junte tudo.
- Em prova comum (sem o código nem a linha Ano/Banca/Órgão/Prova), deixe "sourceId", "board", "organ" e "prova" vazios e
  "year" 0 nas questões: os dados da prova vão só em "exam".
- Ignore a questão cujo começo (o número e o enunciado) NÃO está neste trecho, pois o trecho começou no meio dela, e
  marque "complete": false se a última questão do trecho terminar cortada (faltam alternativas ou texto).
- "needsFigure": true se a questão depende de figura, gráfico, tabela ou imagem que não aparece no texto.
- "exam": nome da prova, banca, órgão, ano, cargo e nível (Fundamental, Médio, Técnico ou Superior) quando o trecho disser;
  campos desconhecidos ficam vazios ("" ou 0 no ano). Não invente.
- Gabarito anulado (letra X, "ANULADA", "Anulada", "*"): devolva "${ANNULLED}" em "answer".
- Se o trecho não tiver questões (só gabarito, capa, instruções), "questions" fica vazio.
Responda apenas com o JSON pedido, sem texto adicional.`;

export const PASTEXAM_JSON_SCHEMA = {
  type: 'object',
  properties: {
    exam: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        board: { type: 'string' },
        organ: { type: 'string' },
        year: { type: 'integer' },
        position: { type: 'string' },
        level: { type: 'string', enum: ['', ...LEVELS] },
      },
      required: ['name', 'board', 'organ', 'year', 'position', 'level'],
      additionalProperties: false,
    },
    supports: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'integer' }, text: { type: 'string' } },
        required: ['id', 'text'],
        additionalProperties: false,
      },
    },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          number: { type: 'integer' },
          sourceId: { type: 'string' },
          supportId: { type: 'integer' },
          statement: { type: 'string' },
          alternatives: {
            type: 'array',
            items: {
              type: 'object',
              properties: { letter: { type: 'string' }, text: { type: 'string' } },
              required: ['letter', 'text'],
              additionalProperties: false,
            },
          },
          answer: { type: 'string' },
          comment: { type: 'string' },
          year: { type: 'integer' },
          board: { type: 'string' },
          organ: { type: 'string' },
          prova: { type: 'string' },
          discipline: { type: 'string' },
          subject: { type: 'string' },
          needsFigure: { type: 'boolean' },
          complete: { type: 'boolean' },
        },
        required: [
          'number',
          'sourceId',
          'supportId',
          'statement',
          'alternatives',
          'answer',
          'comment',
          'year',
          'board',
          'organ',
          'prova',
          'discipline',
          'subject',
          'needsFigure',
          'complete',
        ],
        additionalProperties: false,
      },
    },
    answerKey: {
      type: 'array',
      items: {
        type: 'object',
        properties: { number: { type: 'integer' }, answer: { type: 'string' } },
        required: ['number', 'answer'],
        additionalProperties: false,
      },
    },
  },
  required: ['exam', 'supports', 'questions', 'answerKey'],
  additionalProperties: false,
};

export interface PastExamHints {
  board?: string;
  year?: number | null;
  position?: string;
  /** Nomes de disciplinas que o usuário já usa (as do concurso dele): a IA os reaproveita em vez de inventar variações. */
  disciplines?: string[];
}

export interface ChunkPosition {
  index: number;
  total: number;
}

const MAX_HINT_DISCIPLINES = 30;

/** O pedido que acompanha o trecho: o que se sabe da prova e em que ponto do PDF o trecho está. */
export function pastExamUserPrompt(hints: PastExamHints, position: ChunkPosition | null): string {
  const lines = ['Transcreva as questões e o gabarito deste trecho de uma prova de concurso.'];
  const known = [
    hints.board?.trim() && `banca: ${hints.board.trim()}`,
    hints.year && `ano: ${hints.year}`,
    hints.position?.trim() && `cargo: ${hints.position.trim()}`,
  ].filter(Boolean);
  if (known.length > 0) lines.push(`O que o usuário informou sobre a prova: ${known.join('; ')}.`);
  const disciplines = (hints.disciplines ?? []).map((d) => d.trim()).filter(Boolean).slice(0, MAX_HINT_DISCIPLINES);
  if (disciplines.length > 0) lines.push(`Disciplinas sugeridas: ${disciplines.join('; ')}.`);
  if (position && position.total > 1) {
    lines.push(
      `Este é o trecho ${position.index + 1} de ${position.total}; ele repete o final do trecho anterior, então a primeira ` +
        'questão pode aparecer cortada no começo: ignore-a se o número e o enunciado dela não estiverem aqui.',
    );
  }
  return lines.join('\n');
}

const UNUSABLE = 'A IA não retornou as questões no formato esperado.';

export const clean = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim().slice(0, max) : '';

export const oneLine = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';

/** O ano, se for um ano plausível; senão `null` (0 e vazio também significam "não informado"). */
export function validYear(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 1950 && raw <= 2100 ? raw : null;
}

export function levelOf(raw: unknown): Level | '' {
  const text = oneLine(raw, 40).toLowerCase();
  const found = LEVELS.find((l) => l.toLowerCase() === text);
  return found ?? '';
}

/** Letra do gabarito: A–E, ou 'ANULADA'; qualquer outra coisa vira '' (sem gabarito). */
export function normalizeAnswer(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const text = raw.trim().toUpperCase().replace(/[().\s]/g, '');
  if (text === 'ANULADA' || text === 'ANULADO' || text === 'X' || text === '*' || text === 'ANUL') return ANNULLED;
  return (LETTERS as readonly string[]).includes(text) ? text : '';
}

/**
 * As alternativas de uma questão, se formam um conjunto válido: de 2 a 5, nas letras A, B, C... em sequência a partir
 * do A, ou exatamente C/E (Certo/Errado). Qualquer outra coisa é leitura quebrada — devolve null.
 */
export function cleanAlternatives(raw: unknown): Alternative[] | null {
  if (!Array.isArray(raw)) return null;
  const alternatives: Alternative[] = [];
  for (const item of raw as Record<string, unknown>[]) {
    const letter = typeof item?.letter === 'string' ? item.letter.trim().toUpperCase().replace(/[().\s]/g, '') : '';
    const text = clean(item?.text, MAX_ALTERNATIVE_CHARS);
    if (!letter || !text) return null;
    alternatives.push({ letter, text });
  }
  const letters = alternatives.map((a) => a.letter).join('');
  if (letters === 'CE') return alternatives;
  if (alternatives.length < 2 || alternatives.length > LETTERS.length) return null;
  return alternatives.every((a, i) => a.letter === LETTERS[i]) ? alternatives : null;
}

/** Valida a resposta de um trecho. Devolve as questões inteiras e utilizáveis; descarta as demais sem derrubar o trecho. */
export function parsePastExamResponse(rawText: string | undefined): Chunk {
  if (!rawText) throw new Error(UNUSABLE);
  let parsed: Partial<RawChunk>;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(UNUSABLE);
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.questions) || !Array.isArray(parsed.answerKey)) {
    throw new Error(UNUSABLE);
  }

  const exam = (parsed.exam ?? {}) as Record<string, unknown>;
  const meta: ExamMeta = {
    name: oneLine(exam.name, MAX_LABEL_CHARS),
    board: oneLine(exam.board, MAX_LABEL_CHARS),
    organ: oneLine(exam.organ, MAX_LABEL_CHARS),
    year: validYear(exam.year),
    position: oneLine(exam.position, MAX_LABEL_CHARS),
    level: levelOf(exam.level),
  };

  const supports = new Map<number, string>();
  for (const item of (Array.isArray(parsed.supports) ? parsed.supports : []) as Record<string, unknown>[]) {
    const text = clean(item?.text, MAX_SUPPORT_CHARS);
    if (typeof item?.id === 'number' && item.id > 0 && text) supports.set(item.id, text);
  }

  const questions: ExtractedQuestion[] = [];
  for (const item of parsed.questions as Record<string, unknown>[]) {
    const number = item?.number;
    if (typeof number !== 'number' || !Number.isInteger(number) || number < 1 || number > 999) continue;
    if (item.complete === false) continue;
    const statement = clean(item.statement, MAX_STATEMENT_CHARS);
    const alternatives = cleanAlternatives(item.alternatives);
    if (statement.length < 8 || !alternatives) continue;
    const supportId = typeof item.supportId === 'number' ? item.supportId : 0;
    questions.push({
      number,
      sourceId: oneLine(item.sourceId, MAX_SOURCE_ID_CHARS).replace(/\s+/g, '').toUpperCase(),
      support: supports.get(supportId) ?? '',
      statement,
      alternatives,
      // Uma letra que a questão não tem vira vazio mais adiante, junto com os demais avisos do gabarito.
      answer: normalizeAnswer(item.answer),
      comment: clean(item.comment, MAX_COMMENT_CHARS),
      year: validYear(item.year),
      board: oneLine(item.board, MAX_LABEL_CHARS),
      organ: oneLine(item.organ, MAX_LABEL_CHARS),
      prova: oneLine(item.prova, MAX_PROVA_CHARS),
      discipline: oneLine(item.discipline, MAX_LABEL_CHARS),
      subject: oneLine(item.subject, MAX_LABEL_CHARS),
      needsFigure: item.needsFigure === true,
    });
  }

  const answerKey = new Map<number, string>();
  for (const item of parsed.answerKey as Record<string, unknown>[]) {
    const number = item?.number;
    const answer = normalizeAnswer(item?.answer);
    if (typeof number !== 'number' || !Number.isInteger(number) || number < 1 || number > 999 || !answer) continue;
    if (!answerKey.has(number)) answerKey.set(number, answer);
  }

  return { meta, questions, answerKey };
}

/**
 * Corta o texto em trechos de ~`size` caracteres, sempre numa quebra de linha, e cada trecho repete as últimas
 * `overlap` caracteres do anterior. Texto que cabe num trecho só volta inteiro.
 */
export function splitIntoChunks(text: string, size: number = CHUNK_CHARS, overlap: number = CHUNK_OVERLAP_CHARS): string[] {
  if (overlap >= size) throw new Error('A sobreposição precisa ser menor que o trecho.');
  const source = text.trim();
  if (source.length <= size) return source ? [source] : [];

  const chunks: string[] = [];
  let start = 0;
  while (start < source.length) {
    let end = Math.min(start + size, source.length);
    if (end < source.length) {
      const lineBreak = source.lastIndexOf('\n', end);
      // Só recua até a quebra de linha se ela não encolher o trecho a quase nada.
      if (lineBreak > start + size / 2) end = lineBreak;
    }
    chunks.push(source.slice(start, end).trim());
    if (end >= source.length) break;
    let next = end - overlap;
    const lineStart = source.indexOf('\n', next);
    if (lineStart !== -1 && lineStart < end) next = lineStart + 1;
    start = Math.max(next, start + 1);
  }
  return chunks.filter(Boolean);
}

const sameKey = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** O valor mais repetido (sem diferenciar acento e caixa); no empate, o primeiro a aparecer. Vazio nunca vence. */
export function mostCommon(values: string[]): string {
  const counts = new Map<string, { value: string; count: number }>();
  for (const value of values) {
    if (!value.trim()) continue;
    const key = sameKey(value);
    const entry = counts.get(key);
    if (entry) entry.count++;
    else counts.set(key, { value, count: 1 });
  }
  let best: { value: string; count: number } | null = null;
  for (const entry of counts.values()) if (!best || entry.count > best.count) best = entry;
  return best?.value ?? '';
}

const completeness = (q: ExtractedQuestion) => q.alternatives.length * 100_000 + q.statement.length + q.support.length + q.comment.length;

/** Como se reconhece a mesma questão em trechos que se sobrepõem: pelo código do site, ou pelo número na prova. */
const identityOf = (q: ExtractedQuestion) => (q.sourceId ? `id:${q.sourceId}` : `n:${q.number}`);

export interface Merged {
  meta: ExamMeta;
  questions: ExtractedQuestion[];
  /** Por número da questão: a letra, ou 'ANULADA'. */
  answerKey: Map<number, string>;
  /** Números com mais de um gabarito diferente no PDF (provas de versões diferentes misturadas): vale o primeiro. */
  conflictingKeys: number[];
}

/** Junta a leitura dos trechos: metadados mais comuns, questões sem repetir (vale a mais completa) e o gabarito. */
export function mergeChunks(chunks: Chunk[]): Merged {
  const byIdentity = new Map<string, ExtractedQuestion>();
  for (const chunk of chunks) {
    for (const question of chunk.questions) {
      const key = identityOf(question);
      const previous = byIdentity.get(key);
      if (!previous) {
        byIdentity.set(key, question);
      } else {
        const best = completeness(question) > completeness(previous) ? question : previous;
        const other = best === question ? previous : question;
        // O que um trecho leu e o outro não (a resposta, por exemplo) não se perde.
        byIdentity.set(key, { ...best, answer: best.answer || other.answer });
      }
    }
  }

  const answerKey = new Map<number, string>();
  const conflicting = new Set<number>();
  for (const chunk of chunks) {
    for (const [number, answer] of chunk.answerKey) {
      const previous = answerKey.get(number);
      if (previous === undefined) answerKey.set(number, answer);
      else if (previous !== answer) conflicting.add(number);
    }
  }

  const years = chunks.map((c) => (c.meta.year ? String(c.meta.year) : ''));
  const year = Number(mostCommon(years)) || null;
  const level = mostCommon(chunks.map((c) => c.meta.level)) as Level | '';
  const meta: ExamMeta = {
    name: mostCommon(chunks.map((c) => c.meta.name)),
    board: mostCommon(chunks.map((c) => c.meta.board)),
    organ: mostCommon(chunks.map((c) => c.meta.organ)),
    year,
    position: mostCommon(chunks.map((c) => c.meta.position)),
    level,
  };

  // Sort estável: na mesma posição fica a ordem em que as questões apareceram no PDF.
  const questions = [...byIdentity.values()].sort((a, b) => a.number - b.number);
  return { meta, questions, answerKey, conflictingKeys: [...conflicting].sort((a, b) => a - b) };
}

/**
 * Uniformiza os nomes de disciplina e de assunto: "Língua portuguesa" e "língua portuguesa" viram o mesmo nome
 * (o mais usado), para os filtros do banco de questões não se fragmentarem.
 */
export function unifyLabels(questions: ExtractedQuestion[]): ExtractedQuestion[] {
  const canonical = (field: 'discipline' | 'subject') => {
    const groups = new Map<string, string[]>();
    for (const q of questions) {
      if (!q[field]) continue;
      const key = sameKey(q[field]);
      groups.set(key, [...(groups.get(key) ?? []), q[field]]);
    }
    return new Map([...groups].map(([key, values]) => [key, mostCommon(values)]));
  };
  const disciplines = canonical('discipline');
  const subjects = canonical('subject');
  return questions.map((q) => ({
    ...q,
    discipline: q.discipline ? (disciplines.get(sameKey(q.discipline)) ?? q.discipline) : '',
    subject: q.subject ? (subjects.get(sameKey(q.subject)) ?? q.subject) : '',
  }));
}

const wordsOf = (text: string): string[] =>
  sameKey(text)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4);

/**
 * Quanto do texto da questão (enunciado e alternativas) aparece no texto do PDF, de 0 a 1, olhando as palavras de
 * 4+ letras. Pega a IA que reescreve ou inventa palavras; não pega troca de ordem nem de número, e um PDF em colunas
 * embaralhadas não atrapalha porque a ordem não conta.
 */
export function sourceMatch(question: ExtractedQuestion, sourceWords: Set<string>): number {
  const words = wordsOf([question.statement, ...question.alternatives.map((a) => a.text)].join(' '));
  if (words.length === 0) return 1;
  const found = words.filter((w) => sourceWords.has(w)).length;
  return found / words.length;
}

export function wordSet(text: string): Set<string> {
  return new Set(wordsOf(text));
}

/** Abaixo disto a questão recebe o aviso de "texto não bate com o PDF". */
export const MIN_SOURCE_MATCH = 0.85;
