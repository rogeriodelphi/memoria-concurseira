/**
 * Simulados do banco de questões contra a nota de corte do concurso: o que o usuário acertou em cada disciplina,
 * comparado com o critério mínimo que o edital pede (o campo "Critério mínimo" da disciplina, que é texto livre:
 * "mínimo de 50%", "30 pontos", "20 questões").
 *
 * Só os simulados do banco entram: os do tipo cartão são autoavaliados, então a nota deles não é comparável com a
 * de uma prova. E é uma estimativa: poucas questões por disciplina dão uma nota que balança muito, e o app avisa.
 */
import type { DatabaseSync } from 'node:sqlite';

import { fail, ok, type Result } from '../mockexams/store';
import { mainExam } from '../stats/performance';

/** Menos questões que isto numa disciplina de um simulado: a nota dela diz pouco. */
export const LOW_SAMPLE = 5;
/** A situação "recente" de uma disciplina olha os últimos simulados que a cobriram, até este número. */
export const RECENT_ATTEMPTS = 3;
/** Quantos simulados entram no acompanhamento. */
export const OVERVIEW_ATTEMPTS = 10;
/** Menos questões que isto nos simulados recentes: a situação da disciplina ainda é incerta. */
export const LOW_RECENT_SAMPLE = 10;
/** Variação, em pontos percentuais, a partir da qual a nota "subiu" ou "caiu" entre os simulados. */
export const TREND_POINTS = 5;

export const NO_DISCIPLINE_LABEL = 'Sem disciplina';

/** O nome de uma disciplina sem acento, caixa e espaços repetidos: é por ele que os nomes se casam. */
export function disciplineKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const toNumber = (text: string) => Number(text.replace(',', '.'));
const round1 = (n: number) => Math.round(n * 10) / 10;

export interface ExamDiscipline {
  id: string;
  name: string;
  questionCount: number | null;
  weight: number | null;
  /** O critério mínimo, como está escrito no concurso. */
  cutoff: string;
}

/**
 * A nota mínima, em % de acertos da disciplina, a partir do texto do critério; `null` quando não dá para saber.
 * Entende "50%", "30 pontos" (precisa de nº de questões e peso para saber o total de pontos) e "20 questões".
 */
export function parseCutoff(raw: string, discipline: Pick<ExamDiscipline, 'questionCount' | 'weight'>): number | null {
  const text = raw.toLowerCase();
  const percent = text.match(/(\d+(?:[.,]\d+)?)\s*%/);
  if (percent) {
    const value = toNumber(percent[1]);
    return value >= 0 && value <= 100 ? value : null;
  }
  const { questionCount, weight } = discipline;
  const points = text.match(/(\d+(?:[.,]\d+)?)\s*(?:pontos?|pts?\b)/);
  if (points && questionCount && weight) {
    const value = (toNumber(points[1]) / (questionCount * weight)) * 100;
    return value >= 0 && value <= 100 ? round1(value) : null;
  }
  const items = text.match(/(\d+)\s*(?:quest(?:ões|oes)|acertos|itens)/);
  if (items && questionCount) {
    const value = (Number(items[1]) / questionCount) * 100;
    return value >= 0 && value <= 100 ? round1(value) : null;
  }
  return null;
}

const MIN_LOOSE_MATCH = 4;

/**
 * A disciplina do concurso a que um nome de disciplina do simulado corresponde: o mesmo nome (sem acento nem
 * caixa) ou, se não houver, um que contenha o outro ("Português" e "Língua Portuguesa"), desde que só um sirva.
 */
export function matchDiscipline(label: string, disciplines: ExamDiscipline[]): ExamDiscipline | null {
  const key = disciplineKey(label);
  if (!key) return null;
  const exact = disciplines.find((d) => disciplineKey(d.name) === key);
  if (exact) return exact;
  if (key.length < MIN_LOOSE_MATCH) return null;
  const loose = disciplines.filter((d) => {
    const other = disciplineKey(d.name);
    return other.length >= MIN_LOOSE_MATCH && (other.includes(key) || key.includes(other));
  });
  return loose.length === 1 ? loose[0] : null;
}

export interface BreakdownRow {
  label: string;
  total: number;
  correct: number;
}

export type CutoffStatus = 'above' | 'below' | 'unknown';

export interface DisciplineResult {
  /** O nome do concurso quando a disciplina casou; senão, o que está nas questões. */
  label: string;
  total: number;
  correct: number;
  pct: number;
  examDisciplineId: string | null;
  questionCount: number | null;
  weight: number | null;
  cutoffText: string;
  cutoffPct: number | null;
  status: CutoffStatus;
  /** Pontos percentuais acima (+) ou abaixo (−) da nota de corte. */
  margin: number | null;
  /** Quantas questões a mais precisaria ter acertado, neste simulado, para chegar na nota de corte (0 se já chegou). */
  missing: number | null;
  lowSample: boolean;
  /** Os nomes de disciplina que as questões tinham (para o atalho "ver as que errei"). */
  sourceLabels: string[];
}

export interface NotCovered {
  id: string;
  name: string;
  cutoffText: string;
  cutoffPct: number | null;
}

export interface Comparison {
  /** As disciplinas do concurso que o simulado cobriu: as abaixo da nota de corte primeiro (a maior diferença antes). */
  disciplines: DisciplineResult[];
  /** As do simulado que não casaram com nenhuma do concurso. */
  unmatched: DisciplineResult[];
  /** As do concurso que têm critério mínimo e o simulado não cobriu. */
  notCovered: NotCovered[];
  /** A nota média (% de acertos) ponderada pelo peso das disciplinas na prova; `null` sem disciplina casada. */
  estimatedPct: number | null;
  verdict: CutoffStatus;
}

const pctOf = (correct: number, total: number) => (total > 0 ? round1((correct / total) * 100) : 0);

function statusOf(pct: number, cutoffPct: number | null): CutoffStatus {
  if (cutoffPct === null) return 'unknown';
  return pct >= cutoffPct ? 'above' : 'below';
}

function resultOf(
  label: string,
  total: number,
  correct: number,
  discipline: ExamDiscipline | null,
  sourceLabels: string[],
): DisciplineResult {
  const cutoffPct = discipline ? parseCutoff(discipline.cutoff, discipline) : null;
  const pct = pctOf(correct, total);
  const status = statusOf(pct, cutoffPct);
  return {
    label,
    total,
    correct,
    pct,
    examDisciplineId: discipline?.id ?? null,
    questionCount: discipline?.questionCount ?? null,
    weight: discipline?.weight ?? null,
    cutoffText: discipline?.cutoff ?? '',
    cutoffPct,
    status,
    margin: cutoffPct === null ? null : round1(pct - cutoffPct),
    missing: cutoffPct === null ? null : Math.max(0, Math.ceil((cutoffPct / 100) * total - 1e-9) - correct),
    lowSample: total < LOW_SAMPLE,
    sourceLabels,
  };
}

/** O peso de uma disciplina na prova: questões × peso (o que não se sabe vale 1). */
const examWeight = (d: Pick<ExamDiscipline, 'questionCount' | 'weight'>) => (d.questionCount ?? 1) * (d.weight ?? 1);

/** Compara o placar de um simulado, por disciplina, com os critérios do concurso (ou só o resume, sem concurso). */
export function compare(rows: BreakdownRow[], disciplines: ExamDiscipline[] | null): Comparison {
  const examDisciplines = disciplines ?? [];
  const matchedTotals = new Map<string, { discipline: ExamDiscipline; total: number; correct: number; labels: Set<string> }>();
  const unmatchedTotals = new Map<string, BreakdownRow>();

  for (const row of rows) {
    const label = row.label.trim() || NO_DISCIPLINE_LABEL;
    const discipline = row.label.trim() ? matchDiscipline(row.label, examDisciplines) : null;
    if (discipline) {
      const entry = matchedTotals.get(discipline.id) ?? { discipline, total: 0, correct: 0, labels: new Set<string>() };
      entry.total += row.total;
      entry.correct += row.correct;
      entry.labels.add(label);
      matchedTotals.set(discipline.id, entry);
    } else {
      const key = disciplineKey(label);
      const entry = unmatchedTotals.get(key) ?? { label, total: 0, correct: 0 };
      entry.total += row.total;
      entry.correct += row.correct;
      unmatchedTotals.set(key, entry);
    }
  }

  const order = new Map(examDisciplines.map((d, i) => [d.id, i]));
  const matched = [...matchedTotals.values()]
    .map((e) => resultOf(e.discipline.name, e.total, e.correct, e.discipline, [...e.labels]))
    .sort((a, b) => {
      // Abaixo da nota de corte primeiro, o mais longe dela antes; o resto, na ordem do edital.
      const aBelow = a.status === 'below';
      const bBelow = b.status === 'below';
      if (aBelow !== bBelow) return aBelow ? -1 : 1;
      if (aBelow && bBelow) return (a.margin ?? 0) - (b.margin ?? 0);
      return (order.get(a.examDisciplineId!) ?? 0) - (order.get(b.examDisciplineId!) ?? 0);
    });
  const unmatched = [...unmatchedTotals.values()]
    .map((e) => resultOf(e.label, e.total, e.correct, null, [e.label]))
    .sort((a, b) => b.total - a.total);

  const covered = new Set(matchedTotals.keys());
  const notCovered = examDisciplines
    .filter((d) => !covered.has(d.id) && d.cutoff.trim() !== '')
    .map((d) => ({ id: d.id, name: d.name, cutoffText: d.cutoff, cutoffPct: parseCutoff(d.cutoff, d) }));

  let estimatedPct: number | null = null;
  if (matched.length > 0) {
    let weighted = 0;
    let weights = 0;
    for (const m of matched) {
      const w = examWeight({ questionCount: m.questionCount, weight: m.weight });
      weighted += m.pct * w;
      weights += w;
    }
    estimatedPct = weights > 0 ? round1(weighted / weights) : null;
  }

  const judged = matched.filter((m) => m.status !== 'unknown');
  const verdict: CutoffStatus = judged.length === 0 ? 'unknown' : judged.some((m) => m.status === 'below') ? 'below' : 'above';
  return { disciplines: matched, unmatched, notCovered, estimatedPct, verdict };
}

// ---------- concursos ----------

export interface ExamChoice {
  id: string;
  name: string;
  disciplines: number;
  /** Quantas disciplinas têm critério mínimo que dá para ler. */
  withCutoff: number;
}

export function loadExamDisciplines(db: DatabaseSync, userId: string, examId: string): ExamDiscipline[] | null {
  const exam = db.prepare('SELECT id FROM exams WHERE id = ? AND user_id = ?').get(examId, userId);
  if (!exam) return null;
  const rows = db
    .prepare('SELECT id, name, question_count, weight, cutoff FROM exam_disciplines WHERE exam_id = ? ORDER BY position')
    .all(examId) as unknown as { id: string; name: string; question_count: number | null; weight: number | null; cutoff: string }[];
  return rows.map((r) => ({ id: r.id, name: r.name, questionCount: r.question_count, weight: r.weight, cutoff: r.cutoff }));
}

/** Os concursos do usuário, o "meu concurso" primeiro. */
export function listExamChoices(db: DatabaseSync, userId: string, now: Date): ExamChoice[] {
  const rows = db
    .prepare('SELECT id, name FROM exams WHERE user_id = ? ORDER BY created_at DESC, rowid DESC')
    .all(userId) as unknown as { id: string; name: string }[];
  const mine = mainExam(db, userId, now)?.id;
  const choices = rows.map((r) => {
    const disciplines = loadExamDisciplines(db, userId, r.id) ?? [];
    return {
      id: r.id,
      name: r.name,
      disciplines: disciplines.length,
      withCutoff: disciplines.filter((d) => parseCutoff(d.cutoff, d) !== null).length,
    };
  });
  return choices.sort((a, b) => Number(b.id === mine) - Number(a.id === mine));
}

function pickExam(db: DatabaseSync, userId: string, requested: unknown, now: Date): { id: string; name: string } | null {
  if (typeof requested === 'string' && requested) {
    const row = db.prepare('SELECT id, name FROM exams WHERE id = ? AND user_id = ?').get(requested, userId) as unknown as
      | { id: string; name: string }
      | undefined;
    if (row) return row;
  }
  return mainExam(db, userId, now);
}

// ---------- um simulado ----------

interface AttemptRow {
  id: string;
  finished_at: string;
  duration_ms: number;
  total: number;
  correct: number;
  notebook_name: string;
}

const breakdownOf = (db: DatabaseSync, attemptId: string): BreakdownRow[] =>
  (
    db.prepare('SELECT discipline, total, correct FROM qb_attempt_disciplines WHERE attempt_id = ? ORDER BY rowid').all(attemptId) as unknown as {
      discipline: string;
      total: number;
      correct: number;
    }[]
  ).map((r) => ({ label: r.discipline, total: r.total, correct: r.correct }));

export interface AttemptCutoff {
  attempt: { id: string; finishedAt: string; durationMs: number; total: number; correct: number; notebookName: string };
  exam: { id: string; name: string } | null;
  exams: ExamChoice[];
  /** Simulados feitos antes de o placar por disciplina ser guardado não têm como ser comparados. */
  hasBreakdown: boolean;
  comparison: Comparison | null;
}

/** Um simulado contra a nota de corte do concurso escolhido (ou o "meu concurso"). */
export function attemptCutoff(
  db: DatabaseSync,
  userId: string,
  attemptId: string,
  requestedExam?: unknown,
  now: Date = new Date(),
): Result<AttemptCutoff> {
  const row = db
    .prepare(
      `SELECT a.id, a.finished_at, a.duration_ms, a.total, a.correct, n.name AS notebook_name FROM qb_attempts a
       JOIN qb_notebooks n ON n.id = a.notebook_id WHERE a.id = ? AND a.user_id = ?`,
    )
    .get(attemptId, userId) as unknown as AttemptRow | undefined;
  if (!row) return fail(404, 'Simulado não encontrado.');

  const exam = pickExam(db, userId, requestedExam, now);
  const breakdown = breakdownOf(db, attemptId);
  return ok({
    attempt: { id: row.id, finishedAt: row.finished_at, durationMs: row.duration_ms, total: row.total, correct: row.correct, notebookName: row.notebook_name },
    exam,
    exams: listExamChoices(db, userId, now),
    hasBreakdown: breakdown.length > 0,
    comparison: breakdown.length > 0 ? compare(breakdown, exam ? loadExamDisciplines(db, userId, exam.id) : null) : null,
  });
}

// ---------- o conjunto dos simulados ----------

export interface SeriesPoint {
  attemptId: string;
  finishedAt: string;
  total: number;
  correct: number;
  pct: number;
}

export type Trend = 'up' | 'down' | 'flat';

export interface OverviewDiscipline {
  id: string;
  name: string;
  questionCount: number | null;
  weight: number | null;
  cutoffText: string;
  cutoffPct: number | null;
  /** Os simulados que cobriram a disciplina, do mais antigo ao mais recente. */
  series: SeriesPoint[];
  /** Acertos e total nos últimos simulados que a cobriram (até RECENT_ATTEMPTS). */
  recentCorrect: number;
  recentTotal: number;
  recentPct: number | null;
  trend: Trend | null;
  status: CutoffStatus;
  margin: number | null;
  /** Poucas questões nos simulados recentes: a situação é só uma pista. */
  lowSample: boolean;
}

export interface AttemptLine {
  id: string;
  finishedAt: string;
  notebookName: string;
  total: number;
  correct: number;
  estimatedPct: number | null;
  verdict: CutoffStatus;
}

export interface CutoffOverview {
  exam: { id: string; name: string } | null;
  exams: ExamChoice[];
  /** Quantos simulados com placar por disciplina entraram. */
  attemptCount: number;
  disciplines: OverviewDiscipline[];
  unmatched: { label: string; total: number; correct: number; pct: number }[];
  attempts: AttemptLine[];
}

function trendOf(series: SeriesPoint[]): Trend | null {
  if (series.length < 2) return null;
  const last = series[series.length - 1].pct;
  const before = series.slice(0, -1);
  const mean = before.reduce((sum, p) => sum + p.pct, 0) / before.length;
  if (last - mean >= TREND_POINTS) return 'up';
  if (mean - last >= TREND_POINTS) return 'down';
  return 'flat';
}

/** Os últimos simulados do banco contra a nota de corte, disciplina por disciplina. */
export function cutoffOverview(db: DatabaseSync, userId: string, requestedExam?: unknown, now: Date = new Date()): CutoffOverview {
  const exam = pickExam(db, userId, requestedExam, now);
  const examDisciplines = exam ? (loadExamDisciplines(db, userId, exam.id) ?? []) : [];

  const attempts = (
    db
      .prepare(
        `SELECT a.id, a.finished_at, a.duration_ms, a.total, a.correct, n.name AS notebook_name FROM qb_attempts a
         JOIN qb_notebooks n ON n.id = a.notebook_id
         WHERE a.user_id = ? AND EXISTS (SELECT 1 FROM qb_attempt_disciplines d WHERE d.attempt_id = a.id)
         ORDER BY a.finished_at DESC, a.rowid DESC LIMIT ?`,
      )
      .all(userId, OVERVIEW_ATTEMPTS) as unknown as AttemptRow[]
  ).reverse();

  const seriesById = new Map<string, SeriesPoint[]>(examDisciplines.map((d) => [d.id, []]));
  const unmatchedTotals = new Map<string, { label: string; total: number; correct: number }>();
  const lines: AttemptLine[] = [];

  for (const attempt of attempts) {
    const comparison = compare(breakdownOf(db, attempt.id), examDisciplines);
    for (const d of comparison.disciplines) {
      seriesById.get(d.examDisciplineId!)?.push({ attemptId: attempt.id, finishedAt: attempt.finished_at, total: d.total, correct: d.correct, pct: d.pct });
    }
    for (const u of comparison.unmatched) {
      const key = disciplineKey(u.label);
      const entry = unmatchedTotals.get(key) ?? { label: u.label, total: 0, correct: 0 };
      entry.total += u.total;
      entry.correct += u.correct;
      unmatchedTotals.set(key, entry);
    }
    lines.push({
      id: attempt.id,
      finishedAt: attempt.finished_at,
      notebookName: attempt.notebook_name,
      total: attempt.total,
      correct: attempt.correct,
      estimatedPct: comparison.estimatedPct,
      verdict: comparison.verdict,
    });
  }

  const disciplines: OverviewDiscipline[] = examDisciplines
    .filter((d) => (seriesById.get(d.id)?.length ?? 0) > 0)
    .map((d) => {
      const series = seriesById.get(d.id)!;
      const recent = series.slice(-RECENT_ATTEMPTS);
      const recentTotal = recent.reduce((sum, p) => sum + p.total, 0);
      const recentCorrect = recent.reduce((sum, p) => sum + p.correct, 0);
      const recentPct = recentTotal > 0 ? pctOf(recentCorrect, recentTotal) : null;
      const cutoffPct = parseCutoff(d.cutoff, d);
      return {
        id: d.id,
        name: d.name,
        questionCount: d.questionCount,
        weight: d.weight,
        cutoffText: d.cutoff,
        cutoffPct,
        series,
        recentCorrect,
        recentTotal,
        recentPct,
        trend: trendOf(series),
        status: recentPct === null ? 'unknown' : statusOf(recentPct, cutoffPct),
        margin: recentPct === null || cutoffPct === null ? null : round1(recentPct - cutoffPct),
        lowSample: recentTotal < LOW_RECENT_SAMPLE,
      };
    });

  return {
    exam,
    exams: listExamChoices(db, userId, now),
    attemptCount: attempts.length,
    disciplines,
    unmatched: [...unmatchedTotals.values()].map((u) => ({ ...u, pct: pctOf(u.correct, u.total) })).sort((a, b) => b.total - a.total),
    attempts: lines.reverse(),
  };
}
