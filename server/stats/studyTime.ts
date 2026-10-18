/**
 * "Tempo de estudo": onde o tempo vai, por nome de coleção e por disciplina do edital, para comparar com o peso de
 * cada disciplina na prova. Duas fontes, que nunca se somam em dobro:
 *
 * - **Pomodoro**: o tempo de foco que o usuário registrou, com a disciplina e o assunto que ele digitou.
 * - **Cartões**: o tempo de cada revisão (o medido; se faltar, o intervalo até a revisão anterior, quando plausível; senão a
 *   mediana, como o Painel faz). Uma revisão que aconteceu DENTRO de um Pomodoro já está no tempo dele, então fica de fora
 *   daqui: o que o usuário declarou no Pomodoro vale mais do que a coleção do cartão.
 *
 * Só leitura: nada é gravado. Usa o mesmo período, escopo e filtros do "Meu desempenho".
 */
import type { DatabaseSync } from 'node:sqlite';

import { disciplinePoints } from '../studyplan/newOrder';
import { FALLBACK_REVIEW_MS, MAX_REVIEW_MS } from './dashboard';
import {
  groupKey,
  loadCollections,
  mainExam,
  NO_SUBJECT_KEY,
  NO_SUBJECT_LABEL,
  resolveWindow,
  type CollectionInfo,
  type PerformanceQuery,
  type Scope,
  type Window,
} from './performance';

export const OUT_OF_SYLLABUS_LABEL = 'Fora do edital';
export const NO_DISCIPLINE_LABEL = 'Sem disciplina';
/** Quantos assuntos cada linha lista. */
const MAX_SUBJECTS_PER_ROW = 8;

export interface TimeSubject {
  key: string;
  label: string;
  sec: number;
}

export interface TimeRow {
  key: string;
  label: string;
  pomodoroSec: number;
  cardSec: number;
  totalSec: number;
  /** Quantos registros do Pomodoro. */
  tasks: number;
  /** Revisões de cartões do grupo (pela coleção), com ou sem tempo; é a base do acerto. */
  reviews: number;
  accuracyPct: number | null;
  subjects: TimeSubject[];
}

export interface DisciplineTimeRow extends TimeRow {
  /** `null` na linha "Fora do edital". */
  disciplineId: string | null;
  questions: number | null;
  weight: number | null;
  /** A fatia da prova (pontos da disciplina sobre o total), em %; `null` fora do edital. */
  weightPct: number | null;
}

export interface StudyTime {
  range: { from: string; to: string };
  scope: Scope;
  exam: { id: string; name: string } | null;
  totals: {
    totalSec: number;
    pomodoroSec: number;
    cardSec: number;
    tasks: number;
    reviews: number;
    /** Revisões cujo tempo não foi medido e entrou estimado. */
    estimatedReviews: number;
    /** Tempo de revisões feitas dentro de um Pomodoro: já está no Pomodoro e não entra de novo em `cardSec`. */
    overlapSec: number;
  };
  byName: TimeRow[];
  /** `null` quando o usuário não tem concurso. */
  byDiscipline: DisciplineTimeRow[] | null;
}

interface SessionRow {
  card: string;
  result: string;
  at: string;
  durationMs: number | null;
  cid: string;
}

interface TaskRow {
  discipline: string;
  subject: string;
  durationSec: number;
  startedAt: string;
  endedAt: string;
}

const GOOD = new Set(['bom', 'facil']);
const GRADED = new Set(['errei', 'dificil', 'bom', 'facil']);

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * O tempo de cada revisão, em ms, pela mesma regra do Painel: o medido (até o teto); senão o intervalo até a revisão
 * anterior de qualquer cartão, se for de 1 s a 2 min; senão a mediana do que foi observado (ou 20 s, se nada foi).
 * `ordered` precisa estar em ordem de horário e pode começar com a revisão logo antes do período, só para medir o intervalo.
 */
export function reviewTimes(ordered: { at: number; durationMs: number | null }[]): { time: number; estimated: boolean }[] {
  const observed: number[] = [];
  const raw = ordered.map((s, i) => {
    if (s.durationMs !== null) {
      const time = Math.min(s.durationMs, MAX_REVIEW_MS);
      observed.push(time);
      return { time: time as number | null, estimated: false };
    }
    const gap = i > 0 ? s.at - ordered[i - 1].at : Infinity;
    if (gap >= 1000 && gap <= MAX_REVIEW_MS) {
      observed.push(gap);
      return { time: gap as number | null, estimated: true };
    }
    return { time: null as number | null, estimated: true };
  });
  const fallback = median(observed) ?? FALLBACK_REVIEW_MS;
  return raw.map((r) => ({ time: r.time ?? fallback, estimated: r.estimated }));
}

/** Os intervalos [início, fim] dos Pomodoros, em ms, em ordem e fundidos quando se sobrepõem: para perguntar "este instante está dentro de algum?". */
export function mergeIntervals(tasks: { startedAt: string; endedAt: string }[]): [number, number][] {
  const spans = tasks
    .map((t): [number, number] => [Date.parse(t.startedAt), Date.parse(t.endedAt)])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b >= a)
    .sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push([span[0], span[1]]);
  }
  return merged;
}

export function insideAny(merged: [number, number][], instant: number): boolean {
  let lo = 0;
  let hi = merged.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (instant < merged[mid][0]) hi = mid - 1;
    else if (instant > merged[mid][1]) lo = mid + 1;
    else return true;
  }
  return false;
}

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();
const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function loadSessions(db: DatabaseSync, userId: string, window: Window): SessionRow[] {
  // A revisão logo antes do período entra só para medir o intervalo da primeira de dentro.
  const before = window.start
    ? (db
        .prepare(
          `SELECT ss.flashcard_id AS card, ss.result AS result, ss.studied_at AS at, ss.duration_ms AS durationMs, f.collection_id AS cid
           FROM study_sessions ss JOIN flashcards f ON f.id = ss.flashcard_id
           WHERE ss.user_id = ? AND ss.studied_at < ? ORDER BY ss.studied_at DESC LIMIT 1`,
        )
        .all(userId, window.start.toISOString()) as unknown as SessionRow[])
    : [];
  const inside = db
    .prepare(
      `SELECT ss.flashcard_id AS card, ss.result AS result, ss.studied_at AS at, ss.duration_ms AS durationMs, f.collection_id AS cid
       FROM study_sessions ss JOIN flashcards f ON f.id = ss.flashcard_id
       WHERE ss.user_id = ? ${window.start ? 'AND ss.studied_at >= ?' : ''} AND ss.studied_at < ?
       ORDER BY ss.studied_at, ss.rowid`,
    )
    .all(...(window.start ? [userId, window.start.toISOString(), window.end.toISOString()] : [userId, window.end.toISOString()])) as unknown as SessionRow[];
  return [...before.map((r) => ({ ...r, card: `\u0000before:${r.card}` })), ...inside];
}

function loadTasks(db: DatabaseSync, userId: string, window: Window): TaskRow[] {
  // Um Pomodoro que começou até um dia antes do período ainda pode ter revisões dentro dele.
  const from = window.start ? new Date(window.start.getFullYear(), window.start.getMonth(), window.start.getDate() - 1) : null;
  return db
    .prepare(
      `SELECT discipline, subject, duration_sec AS durationSec, started_at AS startedAt, ended_at AS endedAt
       FROM pomodoro_tasks WHERE user_id = ? ${from ? 'AND started_at >= ?' : ''} AND started_at < ?`,
    )
    .all(...(from ? [userId, from.toISOString(), window.end.toISOString()] : [userId, window.end.toISOString()])) as unknown as TaskRow[];
}

interface Acc {
  spellings: Map<string, number>;
  pomodoroSec: number;
  cardSec: number;
  tasks: number;
  reviews: number;
  good: number;
  subjects: Map<string, { spellings: Map<string, number>; sec: number }>;
}
const newAcc = (): Acc => ({ spellings: new Map(), pomodoroSec: 0, cardSec: 0, tasks: 0, reviews: 0, good: 0, subjects: new Map() });
const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);
/** A grafia mais usada; no empate, a que começa com maiúscula (o que se digita em minúsculas costuma ser descuido), depois a ordem alfabética. */
const startsUpper = (text: string) => (text[0] !== undefined && text[0] === text[0].toUpperCase() && text[0] !== text[0].toLowerCase() ? 1 : 0);
const common = (spellings: Map<string, number>): string =>
  [...spellings].sort((a, b) => b[1] - a[1] || startsUpper(b[0]) - startsUpper(a[0]) || a[0].localeCompare(b[0], 'pt-BR'))[0][0];

function addSubject(acc: Acc, subject: string, sec: number): void {
  const label = squash(subject) || NO_SUBJECT_LABEL;
  const key = squash(subject) ? groupKey(subject) : NO_SUBJECT_KEY;
  const entry = acc.subjects.get(key) ?? { spellings: new Map<string, number>(), sec: 0 };
  bump(entry.spellings, label);
  entry.sec += sec;
  acc.subjects.set(key, entry);
}

function toRow(key: string, label: string, acc: Acc): TimeRow {
  const subjects = [...acc.subjects]
    .map(([k, v]): TimeSubject => ({ key: k, label: common(v.spellings), sec: Math.round(v.sec) }))
    .filter((s) => s.sec > 0)
    .sort((a, b) => b.sec - a.sec || a.label.localeCompare(b.label, 'pt-BR'))
    .slice(0, MAX_SUBJECTS_PER_ROW);
  const pomodoroSec = Math.round(acc.pomodoroSec);
  const cardSec = Math.round(acc.cardSec);
  return {
    key,
    label,
    pomodoroSec,
    cardSec,
    totalSec: pomodoroSec + cardSec,
    tasks: acc.tasks,
    reviews: acc.reviews,
    accuracyPct: acc.reviews > 0 ? Math.round((acc.good / acc.reviews) * 100) : null,
    subjects,
  };
}

const bySizeThenName = <T extends { totalSec: number; reviews: number; label: string }>(a: T, b: T) =>
  b.totalSec - a.totalSec || b.reviews - a.reviews || a.label.localeCompare(b.label, 'pt-BR');

interface ExamDiscipline {
  id: string;
  name: string;
  key: string;
  questions: number | null;
  weight: number | null;
  points: number;
  position: number;
}

export function loadStudyTime(db: DatabaseSync, userId: string, now: Date, query: PerformanceQuery): StudyTime {
  const exam = mainExam(db, userId, now);
  const scope: Scope = query.scope === 'exam' && exam ? 'exam' : 'all';
  const collections = loadCollections(db, userId, scope === 'exam' ? exam!.id : null);
  const { current } = resolveWindow(query, now);

  // As disciplinas do edital, o peso de cada uma e a qual disciplina cada coleção pertence (a de maior peso, como na ordem dos novos).
  let disciplines: ExamDiscipline[] | null = null;
  const disciplineOfCollection = new Map<string, string>();
  const disciplineOfName = new Map<string, string>();
  if (exam) {
    const rows = db
      .prepare('SELECT id, name, question_count, weight FROM exam_disciplines WHERE exam_id = ? ORDER BY position, rowid')
      .all(exam.id) as unknown as { id: string; name: string; question_count: number | null; weight: number | null }[];
    disciplines = disciplinePoints(rows).map((d, i) => ({ id: d.id, name: d.name, key: groupKey(d.name), questions: d.questions, weight: d.weight, points: d.points, position: i }));
    const byId = new Map(disciplines.map((d) => [d.id, d]));
    const links = db
      .prepare(
        `SELECT DISTINCT l.collection_id AS collection_id, d.id AS discipline_id
         FROM exam_topic_collections l
         JOIN exam_topics t ON t.id = l.topic_id
         JOIN exam_disciplines d ON d.id = t.discipline_id
         JOIN collections c ON c.id = l.collection_id
         WHERE d.exam_id = ? AND c.user_id = ?`,
      )
      .all(exam.id, userId) as unknown as { collection_id: string; discipline_id: string }[];
    for (const link of links) {
      const cur = disciplineOfCollection.get(link.collection_id);
      const better = cur === undefined || byId.get(link.discipline_id)!.points > byId.get(cur)!.points || (byId.get(link.discipline_id)!.points === byId.get(cur)!.points && byId.get(link.discipline_id)!.position < byId.get(cur)!.position);
      if (better) disciplineOfCollection.set(link.collection_id, link.discipline_id);
    }
    // O nome de uma coleção também aponta para uma disciplina (a da primeira coleção dele que está no edital), para casar o que se digita no Pomodoro.
    const allCollections = loadCollections(db, userId, null);
    for (const c of allCollections.values()) {
      const d = disciplineOfCollection.get(c.id);
      if (d && !disciplineOfName.has(c.nameKey)) disciplineOfName.set(c.nameKey, d);
    }
  }
  const disciplineOfTask = (task: TaskRow): string | null => {
    const key = groupKey(task.discipline);
    if (!key) return null;
    return disciplines?.find((d) => d.key === key)?.id ?? disciplineOfName.get(key) ?? null;
  };

  // ----- as revisões de cartões, com o tempo de cada uma -----
  const sessions = loadSessions(db, userId, current);
  const times = reviewTimes(sessions.map((s) => ({ at: Date.parse(s.at), durationMs: s.durationMs })));
  const allTasks = loadTasks(db, userId, current);
  const merged = mergeIntervals(allTasks);

  const filtersMatchCollection = (c: CollectionInfo) => (query.name === null || c.nameKey === query.name) && (query.subject === null || c.subjectKey === query.subject);

  const nameAcc = new Map<string, Acc>();
  const disciplineAcc = new Map<string, Acc>(); // chave: id da disciplina, ou '' para "Fora do edital"
  const bucket = <K>(map: Map<K, Acc>, key: K): Acc => {
    let acc = map.get(key);
    if (!acc) map.set(key, (acc = newAcc()));
    return acc;
  };

  const totals = { pomodoroSec: 0, cardSec: 0, tasks: 0, reviews: 0, estimatedReviews: 0, overlapSec: 0 };
  let firstDay: string | null = null;
  const seeDay = (iso: string) => {
    const day = localDay(new Date(iso));
    if (firstDay === null || day < firstDay) firstDay = day;
  };

  sessions.forEach((s, i) => {
    if (s.card.startsWith('\u0000before:')) return; // só serviu para medir o intervalo
    const c = collections.get(s.cid);
    if (!c || !filtersMatchCollection(c) || !GRADED.has(s.result)) return;
    seeDay(s.at);
    totals.reviews += 1;
    if (times[i].estimated) totals.estimatedReviews += 1;
    const sec = times[i].time / 1000;
    const discId = disciplineOfCollection.get(c.id) ?? '';
    const inPomodoro = insideAny(merged, Date.parse(s.at));

    // Acerto e contagem: sempre pela coleção do cartão.
    for (const [acc, spelling] of [[bucket(nameAcc, c.nameKey), c.name], [bucket(disciplineAcc, discId), '']] as [Acc, string][]) {
      acc.reviews += 1;
      if (GOOD.has(s.result)) acc.good += 1;
      if (spelling) bump(acc.spellings, spelling);
    }
    // O tempo: dentro de um Pomodoro, já está lá.
    if (inPomodoro) {
      totals.overlapSec += sec;
      return;
    }
    totals.cardSec += sec;
    for (const acc of [bucket(nameAcc, c.nameKey), bucket(disciplineAcc, discId)]) {
      acc.cardSec += sec;
      addSubject(acc, c.subject, sec);
    }
  });

  // ----- o Pomodoro -----
  for (const task of allTasks) {
    const startMs = Date.parse(task.startedAt);
    const inWindow = (!current.start || startMs >= current.start.getTime()) && startMs < current.end.getTime();
    if (!inWindow || !(task.durationSec > 0)) continue;
    const discId = disciplineOfTask(task);
    const nameKey = groupKey(task.discipline);
    const subjectKey = squash(task.subject) ? groupKey(task.subject) : NO_SUBJECT_KEY;
    if (scope === 'exam' && discId === null) continue;
    if (query.name !== null && nameKey !== query.name) continue;
    if (query.subject !== null && subjectKey !== query.subject) continue;
    seeDay(task.startedAt);
    totals.pomodoroSec += task.durationSec;
    totals.tasks += 1;
    const label = squash(task.discipline) || NO_DISCIPLINE_LABEL;
    const byName = bucket(nameAcc, nameKey);
    bump(byName.spellings, label);
    byName.pomodoroSec += task.durationSec;
    byName.tasks += 1;
    addSubject(byName, task.subject, task.durationSec);
    const byDiscipline = bucket(disciplineAcc, discId ?? '');
    byDiscipline.pomodoroSec += task.durationSec;
    byDiscipline.tasks += 1;
    addSubject(byDiscipline, task.subject, task.durationSec);
  }

  // ----- as linhas -----
  const byName: TimeRow[] = [...nameAcc]
    .filter(([, acc]) => acc.spellings.size > 0)
    .map(([key, acc]) => toRow(key, key === '' ? NO_DISCIPLINE_LABEL : common(acc.spellings), acc))
    .filter((row) => row.totalSec > 0 || row.reviews > 0)
    .sort(bySizeThenName);

  let byDiscipline: DisciplineTimeRow[] | null = null;
  if (disciplines) {
    const totalPoints = disciplines.reduce((n, d) => n + d.points, 0);
    byDiscipline = disciplines.map((d): DisciplineTimeRow => ({
      ...toRow(d.id, d.name, disciplineAcc.get(d.id) ?? newAcc()),
      disciplineId: d.id,
      questions: d.questions,
      weight: d.weight,
      weightPct: totalPoints > 0 ? Math.round((d.points / totalPoints) * 100) : 0,
    }));
    const out = disciplineAcc.get('');
    if (scope === 'all' && out && (out.cardSec + out.pomodoroSec > 0 || out.reviews > 0)) {
      byDiscipline.push({ ...toRow('', OUT_OF_SYLLABUS_LABEL, out), disciplineId: null, questions: null, weight: null, weightPct: null });
    }
  }

  const today = localDay(now);
  const range = query.range ?? { from: current.start ? localDay(current.start) : (firstDay ?? today), to: today };
  return {
    range,
    scope,
    exam,
    totals: {
      totalSec: Math.round(totals.pomodoroSec) + Math.round(totals.cardSec),
      pomodoroSec: Math.round(totals.pomodoroSec),
      cardSec: Math.round(totals.cardSec),
      tasks: totals.tasks,
      reviews: totals.reviews,
      estimatedReviews: totals.estimatedReviews,
      overlapSec: Math.round(totals.overlapSec),
    },
    byName,
    byDiscipline,
  };
}
