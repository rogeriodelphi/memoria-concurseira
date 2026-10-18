/**
 * O rascunho de uma prova importada: o que a IA leu do PDF, já com o gabarito aplicado e avisos sobre o que pede
 * conferência. Nada é gravado até o usuário revisar e confirmar; na confirmação o servidor valida tudo de novo
 * (`validateDraft`), sem acreditar no que o navegador mandou.
 */
import {
  ANNULLED,
  cleanAlternatives,
  clean,
  levelOf,
  MAX_QUESTIONS_PER_EXAM,
  mergeChunks,
  MIN_SOURCE_MATCH,
  normalizeAnswer,
  oneLine,
  sourceMatch,
  unifyLabels,
  wordSet,
  type Alternative,
  type Chunk,
  type ExamMeta,
} from '../ai/pastexam';

export interface DraftQuestion {
  number: number;
  support: string;
  statement: string;
  alternatives: Alternative[];
  /** A letra do gabarito; vazio quando o PDF não trazia (a questão não pode ser corrigida até alguém informar). */
  answer: string;
  annulled: boolean;
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

const listNumbers = (numbers: number[]): string => {
  const shown = numbers.slice(0, MAX_LISTED_NUMBERS).join(', ');
  return numbers.length > MAX_LISTED_NUMBERS ? `${shown} e mais ${numbers.length - MAX_LISTED_NUMBERS}` : shown;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "a questão 3" ou "as questões 2, 3". */
const theQuestions = (numbers: number[]): string => `${numbers.length === 1 ? 'a questão' : 'as questões'} ${listNumbers(numbers)}`;

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
      `A prova tem mais de ${MAX_QUESTIONS_PER_EXAM} questões; só as ${MAX_QUESTIONS_PER_EXAM} primeiras foram mantidas. Importe o resto separadamente.`,
    );
    questions = questions.slice(0, MAX_QUESTIONS_PER_EXAM);
  }

  const texts = readings.map((r) => r.text).filter((t): t is string => t !== null);
  const scanned = readings.some((r) => r.text === null);
  const words = wordSet(texts.join('\n'));
  const checkable = texts.length > 0;

  const gaps = missingNumbers(questions.map((q) => q.number));
  if (gaps.length > 0) {
    warnings.push(`Não encontrei ${theQuestions(gaps)}. Confira o PDF; se estiverem lá, importe de novo ou cadastre-as à parte.`);
  }

  let wrongLetter = 0;
  const draftQuestions: DraftQuestion[] = questions.map((q) => {
    const key = merged.answerKey.get(q.number) ?? '';
    const annulled = key === ANNULLED;
    let answer = annulled ? '' : key;
    if (answer && !q.alternatives.some((a) => a.letter === answer)) {
      answer = '';
      wrongLetter++;
    }
    return {
      ...q,
      answer,
      annulled,
      suspect: checkable && sourceMatch(q, words) < MIN_SOURCE_MATCH,
    };
  });

  const withoutKey = draftQuestions.filter((q) => !q.answer && !q.annulled);
  if (merged.answerKey.size === 0) {
    warnings.push('Não encontrei o gabarito. Informe a alternativa certa de cada questão abaixo, ou importe de novo junto com o PDF do gabarito.');
  } else if (withoutKey.length > 0) {
    warnings.push(`${plural(withoutKey.length, 'questão ficou', 'questões ficaram')} sem gabarito (${listNumbers(withoutKey.map((q) => q.number))}).`);
  }
  if (wrongLetter > 0) {
    warnings.push(`${plural(wrongLetter, 'gabarito aponta', 'gabaritos apontam')} uma letra que a questão não tem: confira.`);
  }
  if (merged.conflictingKeys.length > 0) {
    warnings.push(
      `O gabarito traz respostas diferentes para ${theQuestions(merged.conflictingKeys)} (provas de versões diferentes?). Ficou a primeira; confira.`,
    );
  }
  const suspect = draftQuestions.filter((q) => q.suspect);
  if (suspect.length > 0) {
    warnings.push(
      `O texto d${theQuestions(suspect.map((q) => q.number))} não bate com o do PDF: confira antes de salvar.`,
    );
  }
  const figures = draftQuestions.filter((q) => q.needsFigure);
  if (figures.length > 0) {
    warnings.push(`${plural(figures.length, 'questão depende', 'questões dependem')} de figura ou tabela que não vem no texto (${listNumbers(figures.map((q) => q.number))}).`);
  }
  if (scanned) {
    warnings.push('O PDF é escaneado: a IA leu a imagem das páginas e não foi possível conferir o texto com o original. Revise as questões.');
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

type Validation = { ok: true; draft: ValidDraft } | { ok: false; error: string };

/** Valida o que o navegador mandou ao confirmar a importação. Nada vindo de fora é aceito sem conferir. */
export function validateDraft(body: unknown): Validation {
  const input = (body ?? {}) as Record<string, unknown>;
  const name = oneLine(input.name, MAX_NAME_CHARS);
  if (name.length < 2) return { ok: false, error: 'Informe um nome para a prova.' };

  const rawYear = typeof input.year === 'number' ? input.year : Number(input.year);
  const year = Number.isInteger(rawYear) && rawYear >= 1950 && rawYear <= 2100 ? rawYear : null;

  if (!Array.isArray(input.questions) || input.questions.length === 0) {
    return { ok: false, error: 'A prova precisa ter ao menos uma questão.' };
  }
  if (input.questions.length > MAX_QUESTIONS_PER_EXAM) {
    return { ok: false, error: `A prova passa de ${MAX_QUESTIONS_PER_EXAM} questões.` };
  }

  const questions: DraftQuestion[] = [];
  const seen = new Set<number>();
  for (const item of input.questions as Record<string, unknown>[]) {
    const number = item?.number;
    if (typeof number !== 'number' || !Number.isInteger(number) || number < 1 || number > 999) {
      return { ok: false, error: 'Há uma questão sem número válido (de 1 a 999).' };
    }
    if (seen.has(number)) return { ok: false, error: `A questão ${number} aparece mais de uma vez.` };
    seen.add(number);

    const statement = clean(item.statement, 6_000);
    if (statement.length < 8) return { ok: false, error: `A questão ${number} está sem enunciado.` };
    const alternatives = cleanAlternatives(item.alternatives);
    if (!alternatives) {
      return { ok: false, error: `As alternativas da questão ${number} precisam estar em ordem (A, B, C...), de 2 a 5, e sem texto vazio.` };
    }

    const answer = normalizeAnswer(item.answer);
    const annulled = answer === ANNULLED || item.annulled === true;
    if (!annulled && answer && !alternatives.some((a) => a.letter === answer)) {
      return { ok: false, error: `O gabarito da questão ${number} (${answer}) não é uma das alternativas dela.` };
    }

    questions.push({
      number,
      support: clean(item.support, 12_000),
      statement,
      alternatives,
      answer: annulled ? '' : answer,
      annulled,
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
