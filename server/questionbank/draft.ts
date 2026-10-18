/**
 * O rascunho de uma prova importada: o que a IA leu do PDF, já com o gabarito aplicado e avisos sobre o que pede
 * conferência. Nada é gravado até o usuário revisar e confirmar; na confirmação o servidor valida tudo de novo
 * (`validateDraft`), sem acreditar no que o navegador mandou.
 *
 * Um PDF de prova comum é UMA prova: os dados (nome, banca, ano...) ficam em `meta`. A captura de um site de questões
 * mistura provas: cada questão traz o seu ano, banca, órgão e prova, e ao salvar elas se agrupam em uma prova por
 * nome (`groupByProva`).
 */
import {
  ANNULLED,
  cleanAlternatives,
  clean,
  levelOf,
  MAX_COMMENT_CHARS,
  MAX_QUESTIONS_PER_EXAM,
  mergeChunks,
  MIN_SOURCE_MATCH,
  normalizeAnswer,
  oneLine,
  sourceMatch,
  unifyLabels,
  validYear,
  wordSet,
  type Alternative,
  type Chunk,
  type ExamMeta,
} from '../ai/pastexam';

export interface DraftQuestion {
  number: number;
  /** O código da questão no site de origem (ex.: "Q4229308"); vazio numa prova comum. */
  sourceId: string;
  support: string;
  statement: string;
  alternatives: Alternative[];
  /** A letra do gabarito; vazio quando o PDF não trazia (a questão não pode ser corrigida até alguém informar). */
  answer: string;
  annulled: boolean;
  /** O gabarito comentado; vazio se não houver. */
  comment: string;
  /** Os dados desta questão, quando diferem dos da prova inteira (captura de um site de questões); vazios senão. */
  prova: string;
  board: string;
  organ: string;
  year: number | null;
  discipline: string;
  subject: string;
  needsFigure: boolean;
  /** O texto lido pela IA não bate com o do PDF: pode ter sido reescrito ou lido errado. */
  suspect: boolean;
}

export interface ExamDraft {
  meta: ExamMeta;
  questions: DraftQuestion[];
  warnings: string[];
}

/** Uma leitura (da prova ou do gabarito): os trechos que a IA devolveu e o texto de onde vieram (null = escaneado). */
export interface Reading {
  chunks: Chunk[];
  text: string | null;
}

const MAX_LISTED_NUMBERS = 12;

const listNumbers = (numbers: (number | string)[]): string => {
  const shown = numbers.slice(0, MAX_LISTED_NUMBERS).join(', ');
  return numbers.length > MAX_LISTED_NUMBERS ? `${shown} e mais ${numbers.length - MAX_LISTED_NUMBERS}` : shown;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "a questão 3" ou "as questões 2, 3". */
const theQuestions = (numbers: (number | string)[]): string => `${numbers.length === 1 ? 'a questão' : 'as questões'} ${listNumbers(numbers)}`;

/** Como uma questão é chamada nos avisos: pelo código do site, se tiver, senão pelo número. */
const nameOf = (q: Pick<DraftQuestion, 'number' | 'sourceId'>) => (q.sourceId ? q.sourceId : q.number);

/** Os números que faltam entre 1 e a última questão lida (a IA pode ter pulado alguma). */
export function missingNumbers(numbers: number[]): number[] {
  if (numbers.length === 0) return [];
  const present = new Set(numbers);
  const last = Math.max(...numbers);
  const missing: number[] = [];
  for (let n = 1; n <= last; n++) if (!present.has(n)) missing.push(n);
  return missing;
}

/** Junta a leitura da prova (e do gabarito, se veio à parte) no rascunho que o usuário vai revisar. */
export function buildDraft(readings: Reading[]): ExamDraft {
  const merged = mergeChunks(readings.flatMap((r) => r.chunks));
  const warnings: string[] = [];

  let questions = unifyLabels(merged.questions);
  if (questions.length > MAX_QUESTIONS_PER_EXAM) {
    warnings.push(
      `A leitura trouxe mais de ${MAX_QUESTIONS_PER_EXAM} questões; só as ${MAX_QUESTIONS_PER_EXAM} primeiras foram mantidas. Importe o resto separadamente.`,
    );
    questions = questions.slice(0, MAX_QUESTIONS_PER_EXAM);
  }

  // Num site de questões o número é a posição na lista, e o que identifica a questão é o código dele: renumera de 1 a N.
  const fromSite = questions.some((q) => q.sourceId !== '');
  if (fromSite) questions = questions.map((q, i) => ({ ...q, number: i + 1 }));

  const texts = readings.map((r) => r.text).filter((t): t is string => t !== null);
  const scanned = readings.some((r) => r.text === null);
  const words = wordSet(texts.join('\n'));
  const checkable = texts.length > 0;

  const gaps = fromSite ? [] : missingNumbers(questions.map((q) => q.number));
  if (gaps.length > 0) {
    warnings.push(`Não encontrei ${theQuestions(gaps)}. Confira o PDF; se estiverem lá, importe de novo ou cadastre-as à parte.`);
  }

  let wrongLetter = 0;
  const disagreeing: (number | string)[] = [];
  const draftQuestions: DraftQuestion[] = questions.map((q) => {
    // O gabarito de uma tabela vale pelo número da prova; o escrito junto da questão (site de questões) vale para ela.
    const tableKey = fromSite && q.sourceId ? undefined : merged.answerKey.get(q.number);
    if (tableKey && q.answer && tableKey !== q.answer) disagreeing.push(nameOf(q));
    const key = tableKey ?? q.answer;
    const annulled = key === ANNULLED;
    let answer = annulled ? '' : key;
    if (answer && !q.alternatives.some((a) => a.letter === answer)) {
      answer = '';
      wrongLetter++;
    }
    return {
      number: q.number,
      sourceId: q.sourceId,
      support: q.support,
      statement: q.statement,
      alternatives: q.alternatives,
      answer,
      annulled,
      comment: q.comment,
      prova: q.prova,
      board: q.board,
      organ: q.organ,
      year: q.year,
      discipline: q.discipline,
      subject: q.subject,
      needsFigure: q.needsFigure,
      suspect: checkable && sourceMatch(q, words) < MIN_SOURCE_MATCH,
    };
  });

  const withoutKey = draftQuestions.filter((q) => !q.answer && !q.annulled);
  const anyKey = merged.answerKey.size > 0 || draftQuestions.some((q) => q.answer || q.annulled);
  if (!anyKey) {
    warnings.push('Não encontrei o gabarito. Informe a alternativa certa de cada questão abaixo, ou importe de novo junto com o PDF do gabarito.');
  } else if (withoutKey.length > 0) {
    warnings.push(`${plural(withoutKey.length, 'questão ficou', 'questões ficaram')} sem gabarito (${listNumbers(withoutKey.map(nameOf))}).`);
  }
  if (wrongLetter > 0) {
    warnings.push(`${plural(wrongLetter, 'gabarito aponta', 'gabaritos apontam')} uma letra que a questão não tem: confira.`);
  }
  if (disagreeing.length > 0) {
    warnings.push(`O gabarito da tabela difere do que está escrito junto d${theQuestions(disagreeing)}: valeu a tabela; confira.`);
  }
  if (merged.conflictingKeys.length > 0) {
    warnings.push(
      `O gabarito traz respostas diferentes para ${theQuestions(merged.conflictingKeys)} (provas de versões diferentes?). Ficou a primeira; confira.`,
    );
  }
  const suspect = draftQuestions.filter((q) => q.suspect);
  if (suspect.length > 0) {
    warnings.push(`O texto d${theQuestions(suspect.map(nameOf))} não bate com o do PDF: confira antes de salvar.`);
  }
  const figures = draftQuestions.filter((q) => q.needsFigure);
  if (figures.length > 0) {
    warnings.push(`${plural(figures.length, 'questão depende', 'questões dependem')} de figura ou tabela que não vem no texto (${listNumbers(figures.map(nameOf))}).`);
  }
  if (fromSite) {
    const noProva = draftQuestions.filter((q) => !q.prova);
    if (noProva.length > 0) {
      warnings.push(`Não consegui ler o campo Prova d${theQuestions(noProva.map(nameOf))}: dê um nome a elas antes de salvar.`);
    }
  }
  if (scanned) {
    warnings.push('O PDF é escaneado ou é uma imagem: a IA leu a imagem das páginas e não foi possível conferir o texto com o original. Revise as questões.');
  }

  return { meta: merged.meta, questions: draftQuestions, warnings };
}

// ---------- confirmação ----------

export interface ValidDraft {
  name: string;
  board: string;
  organ: string;
  year: number | null;
  position: string;
  level: ExamMeta['level'];
  questions: DraftQuestion[];
}

export const MAX_NAME_CHARS = 120;
const MAX_FIELD_CHARS = 160;
const MAX_PROVA_CHARS = 300;

type Validation = { ok: true; draft: ValidDraft } | { ok: false; error: string };

/** Valida o que o navegador mandou ao confirmar a importação. Nada vindo de fora é aceito sem conferir. */
export function validateDraft(body: unknown): Validation {
  const input = (body ?? {}) as Record<string, unknown>;
  const name = oneLine(input.name, MAX_NAME_CHARS);

  const rawYear = typeof input.year === 'number' ? input.year : Number(input.year);
  const year = validYear(rawYear);

  if (!Array.isArray(input.questions) || input.questions.length === 0) {
    return { ok: false, error: 'A prova precisa ter ao menos uma questão.' };
  }
  if (input.questions.length > MAX_QUESTIONS_PER_EXAM) {
    return { ok: false, error: `A importação passa de ${MAX_QUESTIONS_PER_EXAM} questões.` };
  }

  const questions: DraftQuestion[] = [];
  const seen = new Set<number>();
  const seenSource = new Set<string>();
  for (const item of input.questions as Record<string, unknown>[]) {
    const number = item?.number;
    if (typeof number !== 'number' || !Number.isInteger(number) || number < 1 || number > 999) {
      return { ok: false, error: 'Há uma questão sem número válido (de 1 a 999).' };
    }
    if (seen.has(number)) return { ok: false, error: `A questão ${number} aparece mais de uma vez.` };
    seen.add(number);

    const sourceId = oneLine(item.sourceId, 40).replace(/\s+/g, '').toUpperCase();
    if (sourceId) {
      if (seenSource.has(sourceId)) return { ok: false, error: `A questão ${sourceId} aparece mais de uma vez.` };
      seenSource.add(sourceId);
    }
    const label = sourceId || String(number);

    const statement = clean(item.statement, 6_000);
    if (statement.length < 8) return { ok: false, error: `A questão ${label} está sem enunciado.` };
    const alternatives = cleanAlternatives(item.alternatives);
    if (!alternatives) {
      return { ok: false, error: `As alternativas da questão ${label} precisam estar em ordem (A, B, C...), de 2 a 5, e sem texto vazio.` };
    }

    const answer = normalizeAnswer(item.answer);
    const annulled = answer === ANNULLED || item.annulled === true;
    if (!annulled && answer && !alternatives.some((a) => a.letter === answer)) {
      return { ok: false, error: `O gabarito da questão ${label} (${answer}) não é uma das alternativas dela.` };
    }

    const prova = oneLine(item.prova, MAX_PROVA_CHARS);
    if (!prova && name.length < 2) {
      return { ok: false, error: `Dê um nome à prova da questão ${label} (ou à importação inteira).` };
    }

    questions.push({
      number,
      sourceId,
      support: clean(item.support, 12_000),
      statement,
      alternatives,
      answer: annulled ? '' : answer,
      annulled,
      comment: clean(item.comment, MAX_COMMENT_CHARS),
      prova,
      board: oneLine(item.board, MAX_FIELD_CHARS),
      organ: oneLine(item.organ, MAX_FIELD_CHARS),
      year: validYear(item.year),
      discipline: oneLine(item.discipline, MAX_FIELD_CHARS),
      subject: oneLine(item.subject, MAX_FIELD_CHARS),
      needsFigure: item.needsFigure === true,
      suspect: item.suspect === true,
    });
  }
  questions.sort((a, b) => a.number - b.number);

  return {
    ok: true,
    draft: {
      name,
      board: oneLine(input.board, MAX_FIELD_CHARS),
      organ: oneLine(input.organ, MAX_FIELD_CHARS),
      year,
      position: oneLine(input.position, MAX_FIELD_CHARS),
      level: levelOf(input.level),
      questions,
    },
  };
}

const keyOf = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

export interface ProvaGroup {
  /** O nome da prova (o da questão ou, se faltar, o da importação). */
  name: string;
  board: string;
  organ: string;
  year: number | null;
  position: string;
  level: ExamMeta['level'];
  questions: DraftQuestion[];
}

/**
 * As questões de uma importação, agrupadas por prova. Uma prova comum é um grupo só (os dados vêm da importação); numa
 * captura de site de questões cada prova é um grupo, e o que a questão não diz (banca, órgão, ano) vale o da importação.
 */
export function groupByProva(draft: ValidDraft): ProvaGroup[] {
  const groups = new Map<string, ProvaGroup>();
  for (const q of draft.questions) {
    const name = q.prova || draft.name;
    const key = keyOf(name);
    let group = groups.get(key);
    if (!group) {
      group = {
        name,
        board: q.board || draft.board,
        organ: q.organ || draft.organ,
        year: q.year ?? draft.year,
        position: draft.position,
        level: draft.level,
        questions: [],
      };
      groups.set(key, group);
    } else {
      // O que a primeira questão do grupo não trazia pode vir de outra.
      group.board ||= q.board;
      group.organ ||= q.organ;
      group.year ??= q.year;
    }
    group.questions.push(q);
  }
  return [...groups.values()];
}
