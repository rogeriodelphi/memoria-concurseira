/**
 * "Meu desempenho": o que foi estudado num período, por nome de coleção e por assunto. Um "cartão estudado"
 * é um cartão com ao menos uma revisão no período (conta uma vez, não importa quantas vezes foi revisto); as
 * revisões aparecem à parte. Acerto = "Bom" ou "Fácil"; erro = "Errei" ou "Difícil".
 *
 * Os nomes e os assuntos são agrupados como a lista de coleções agrupa (sem diferenciar maiúsculas nem
 * acentos). Cada grupo traz também o acerto do período anterior, de mesma duração, para a seta de tendência.
 * Tudo vem do histórico de revisões (study_sessions); nada é guardado à parte.
 */
import type { DatabaseSync } from 'node:sqlite';

import { nextExam } from '../studyplan/nextExam';

export const DEFAULT_PERFORMANCE_DAYS = 7;
/** Períodos prontos, em dias (0 = desde o início). Um período personalizado vem como `from` e `to`. */
export const PERFORMANCE_PERIODS: readonly number[] = [1, 7, 15, 30, 0];
/** Um período personalizado maior que isto é recusado: o gráfico por dia não faria sentido. */
export const MAX_CUSTOM_DAYS = 3660;

export const NO_SUBJECT_LABEL = 'Sem assunto';
/** Na URL, o filtro "só os sem assunto" (o assunto vazio não cabe num parâmetro). */
export const NO_SUBJECT_KEY = '__sem_assunto__';

export type Scope = 'all' | 'exam';

export interface PerformanceQuery {
  /** Período pronto, em dias (0 = desde o início). Ignorado quando há `range`. */
  days: number;
  /** Período personalizado: dias locais, AAAA-MM-DD, do primeiro ao último (os dois inclusive). */
  range: { from: string; to: string } | null;
  /** 'exam' = só as coleções ligadas ao concurso principal do usuário. */
  scope: Scope;
  /** Só este nome de coleção (a chave de agrupamento). */
  name: string | null;
  /** Só este assunto (a chave de agrupamento, ou NO_SUBJECT_KEY). */
  subject: string | null;
}

export interface ResultCounts {
  errei: number;
  dificil: number;
  bom: number;
  facil: number;
}

export interface Totals {
  /** Cartões diferentes estudados. */
  cards: number;
  reviews: number;
  good: number;
  bad: number;
  accuracyPct: number | null;
  byResult: ResultCounts;
}

interface Counts {
  cards: number;
  reviews: number;
  good: number;
  bad: number;
  accuracyPct: number;
  /** Cartões diferentes com ao menos uma revisão "Errei" ou "Difícil" no período: os que valem uma segunda olhada. */
  missedCards: number;
  /** O acerto do período anterior, de mesma duração; `null` sem período anterior ou sem revisões nele. */
  previousAccuracyPct: number | null;
  /** Quantas revisões o período anterior teve (0 sem período anterior): diz se a comparação tem base. */
  previousReviews: number;
}

export interface SubjectRow extends Counts {
  key: string;
  label: string;
  /** As coleções deste nome com este assunto e cartões estudados no período. */
  collectionIds: string[];
}

export interface NameRow extends Counts {
  key: string;
  label: string;
  /** As coleções deste nome com cartões estudados no período (se for uma só, o nome vira link). */
  collectionIds: string[];
  /** Os assuntos dentro deste nome, do que teve mais cartões estudados ao que teve menos. */
  subjects: SubjectRow[];
}

export interface SubjectGroup extends Counts {
  key: string;
  label: string;
  /** Os nomes (grafia da tela) que trazem este assunto, do que teve mais cartões estudados ao que teve menos. */
  names: string[];
  /** As coleções com este assunto e cartões estudados no período. */
  collectionIds: string[];
}

export interface DailyPoint {
  /** O dia local, AAAA-MM-DD. */
  date: string;
  good: number;
  bad: number;
}

export interface FilterOption {
  key: string;
  label: string;
}

export interface Performance {
  /** O período como foi entendido: dias locais, AAAA-MM-DD, os dois inclusive. */
  range: { from: string; to: string };
  /** O período pronto escolhido (0 = desde o início); `null` quando é personalizado. */
  days: number | null;
  scope: Scope;
  /** O concurso que "Meu concurso" usa; `null` se o usuário não tem nenhum. */
  exam: { id: string; name: string } | null;
  /** Todos os cartões do recorte (escopo e filtros), estudados ou não. */
  totalCards: number;
  totals: Totals;
  /** Só os dias com revisão, em ordem; quem desenha preenche os dias sem estudo com zero. */
  daily: DailyPoint[];
  byName: NameRow[];
  bySubject: SubjectGroup[];
  /** O que dá para escolher nos filtros (do escopo, estudado ou não no período). */
  options: { names: FilterOption[]; subjects: FilterOption[] };
}

/** Sem acentos, em minúsculas, com os espaços repetidos reduzidos a um e sem os das pontas. */
export function groupKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();
const pad = (n: number) => String(n).padStart(2, '0');
const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** AAAA-MM-DD → meia-noite local desse dia; `null` se não é uma data que existe. */
export function parseDay(text: unknown): Date | null {
  if (typeof text !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

type QueryResult = { ok: true; value: PerformanceQuery } | { ok: false; error: string };

const first = (raw: unknown): unknown => (Array.isArray(raw) ? raw[0] : raw);

/** Os parâmetros do endereço: `days` (ou `from` e `to`), `scope`, `name` e `subject`. Qualquer valor estranho é recusado. */
export function parsePerformanceQuery(raw: Record<string, unknown>): QueryResult {
  const fromRaw = first(raw.from);
  const toRaw = first(raw.to);
  let range: PerformanceQuery['range'] = null;
  if (fromRaw !== undefined || toRaw !== undefined) {
    const from = parseDay(fromRaw);
    const to = parseDay(toRaw);
    if (!from || !to) return { ok: false, error: 'Datas inválidas: use AAAA-MM-DD.' };
    if (from.getTime() > to.getTime()) return { ok: false, error: 'A data inicial é depois da final.' };
    const span = Math.round((Date.UTC(to.getFullYear(), to.getMonth(), to.getDate()) - Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())) / 86_400_000) + 1;
    if (span > MAX_CUSTOM_DAYS) return { ok: false, error: 'Escolha um período de até 10 anos.' };
    range = { from: localDay(from), to: localDay(to) };
  }

  const daysRaw = first(raw.days);
  let days = DEFAULT_PERFORMANCE_DAYS;
  if (daysRaw !== undefined && daysRaw !== '') {
    const n = Number(daysRaw);
    if (!Number.isInteger(n) || !PERFORMANCE_PERIODS.includes(n)) return { ok: false, error: 'Período inválido: use 1, 7, 15, 30 ou 0 (desde o início).' };
    days = n;
  }

  const scopeRaw = first(raw.scope);
  if (scopeRaw !== undefined && scopeRaw !== '' && scopeRaw !== 'all' && scopeRaw !== 'exam') return { ok: false, error: 'Escopo inválido: use all ou exam.' };

  const text = (value: unknown): string | null => {
    const v = first(value);
    return typeof v === 'string' && v !== '' ? v.slice(0, 200) : null;
  };

  return { ok: true, value: { days, range, scope: scopeRaw === 'exam' ? 'exam' : 'all', name: text(raw.name), subject: text(raw.subject) } };
}

export interface Window {
  start: Date | null;
  /** Exclusivo: a meia-noite do dia seguinte ao último dia do período. */
  end: Date;
}

/** O período em instantes, e o período anterior de mesma duração (`null` para "desde o início"). */
export function resolveWindow(query: PerformanceQuery, now: Date): { current: Window; previous: Window | null } {
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  let current: Window;
  if (query.range) {
    const from = parseDay(query.range.from)!;
    const to = parseDay(query.range.to)!;
    current = { start: from, end: new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1) };
  } else if (query.days > 0) {
    current = { start: new Date(now.getFullYear(), now.getMonth(), now.getDate() - (query.days - 1)), end: tomorrow };
  } else {
    current = { start: null, end: tomorrow };
  }
  if (!current.start) return { current, previous: null };
  // A duração em dias de calendário (não em horas, para o horário de verão não virar 23h ou 25h).
  const length = Math.round(
    (Date.UTC(current.end.getFullYear(), current.end.getMonth(), current.end.getDate()) -
      Date.UTC(current.start.getFullYear(), current.start.getMonth(), current.start.getDate())) /
      86_400_000,
  );
  const s = current.start;
  return { current, previous: { start: new Date(s.getFullYear(), s.getMonth(), s.getDate() - length), end: s } };
}

export interface CollectionInfo {
  id: string;
  name: string;
  nameKey: string;
  subject: string;
  subjectKey: string;
}

interface SessionRow {
  card: string;
  result: string;
  at: string;
  cid: string;
}

/** O concurso do "Meu concurso": o de data mais próxima que ainda não passou; sem data, o criado por último. */
export function mainExam(db: DatabaseSync, userId: string, now: Date): { id: string; name: string } | null {
  const upcoming = nextExam(db, userId, now);
  if (upcoming) return { id: upcoming.id, name: upcoming.name };
  const latest = db
    .prepare('SELECT id, name FROM exams WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1')
    .get(userId) as unknown as { id: string; name: string } | undefined;
  return latest ?? null;
}

export function loadCollections(db: DatabaseSync, userId: string, examId: string | null): Map<string, CollectionInfo> {
  const rows = (
    examId
      ? db
          .prepare(
            `SELECT DISTINCT c.id, c.name, c.subject FROM collections c
             JOIN exam_topic_collections l ON l.collection_id = c.id
             JOIN exam_topics t ON t.id = l.topic_id
             JOIN exam_disciplines d ON d.id = t.discipline_id
             WHERE c.user_id = ? AND d.exam_id = ?`,
          )
          .all(userId, examId)
      : db.prepare('SELECT id, name, subject FROM collections WHERE user_id = ?').all(userId)
  ) as unknown as { id: string; name: string; subject: string }[];
  return new Map(
    rows.map((r) => {
      const name = squash(r.name);
      const subject = squash(r.subject);
      return [r.id, { id: r.id, name, nameKey: groupKey(name), subject, subjectKey: subject ? groupKey(subject) : NO_SUBJECT_KEY }];
    }),
  );
}

function loadSessions(db: DatabaseSync, userId: string, window: Window): SessionRow[] {
  return db
    .prepare(
      `SELECT ss.flashcard_id AS card, ss.result AS result, ss.studied_at AS at, f.collection_id AS cid
       FROM study_sessions ss JOIN flashcards f ON f.id = ss.flashcard_id
       WHERE ss.user_id = ? ${window.start ? 'AND ss.studied_at >= ?' : ''} AND ss.studied_at < ?`,
    )
    .all(...(window.start ? [userId, window.start.toISOString(), window.end.toISOString()] : [userId, window.end.toISOString()])) as unknown as SessionRow[];
}

const GOOD = new Set(['bom', 'facil']);
const BAD = new Set(['errei', 'dificil']);

interface Acc {
  cards: Set<string>;
  /** Os cartões com alguma revisão "Errei" ou "Difícil". */
  missed: Set<string>;
  reviews: number;
  good: number;
  bad: number;
}
const newAcc = (): Acc => ({ cards: new Set(), missed: new Set(), reviews: 0, good: 0, bad: 0 });
function add(acc: Acc, row: SessionRow): void {
  acc.cards.add(row.card);
  acc.reviews += 1;
  if (GOOD.has(row.result)) acc.good += 1;
  else {
    acc.bad += 1;
    acc.missed.add(row.card);
  }
}
const bucket = <K>(map: Map<K, Acc>, key: K): Acc => {
  let acc = map.get(key);
  if (!acc) map.set(key, (acc = newAcc()));
  return acc;
};

/** A grafia mais usada dentre as dadas; o empate fica com a primeira em ordem alfabética, para o resultado ser sempre o mesmo. */
function commonSpelling(spellings: Map<string, number>): string {
  return [...spellings].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'))[0][0];
}

const byCardsThenReviews = <T extends { cards: number; reviews: number; label: string }>(a: T, b: T) =>
  b.cards - a.cards || b.reviews - a.reviews || a.label.localeCompare(b.label, 'pt-BR');

export function loadPerformance(db: DatabaseSync, userId: string, now: Date, query: PerformanceQuery): Performance {
  const exam = mainExam(db, userId, now);
  const scope: Scope = query.scope === 'exam' && exam ? 'exam' : 'all';
  const collections = loadCollections(db, userId, scope === 'exam' ? exam!.id : null);

  // Os filtros valem para as revisões (no período e no anterior) e para os totais.
  const keep = (row: SessionRow): CollectionInfo | null => {
    const c = collections.get(row.cid);
    if (!c) return null;
    if (query.name !== null && c.nameKey !== query.name) return null;
    if (query.subject !== null && c.subjectKey !== query.subject) return null;
    if (!GOOD.has(row.result) && !BAD.has(row.result)) return null;
    return c;
  };

  const { current, previous } = resolveWindow(query, now);
  const sessions = loadSessions(db, userId, current);

  const total = newAcc();
  const byResult: ResultCounts = { errei: 0, dificil: 0, bom: 0, facil: 0 };
  const daily = new Map<string, { good: number; bad: number }>();
  const names = new Map<string, { acc: Acc; spellings: Map<string, number>; collections: Set<string>; subjects: Map<string, { acc: Acc; spellings: Map<string, number>; collections: Set<string> }> }>();
  const subjects = new Map<string, { acc: Acc; spellings: Map<string, number>; collections: Set<string>; names: Map<string, { spellings: Map<string, number>; cards: Set<string> }> }>();

  for (const row of sessions) {
    const c = keep(row);
    if (!c) continue;
    add(total, row);
    byResult[row.result as keyof ResultCounts] += 1;

    const day = localDay(new Date(row.at));
    const point = daily.get(day) ?? { good: 0, bad: 0 };
    if (GOOD.has(row.result)) point.good += 1;
    else point.bad += 1;
    daily.set(day, point);

    let name = names.get(c.nameKey);
    if (!name) names.set(c.nameKey, (name = { acc: newAcc(), spellings: new Map(), collections: new Set(), subjects: new Map() }));
    add(name.acc, row);
    name.spellings.set(c.name, (name.spellings.get(c.name) ?? 0) + 1);
    name.collections.add(c.id);
    let inName = name.subjects.get(c.subjectKey);
    if (!inName) name.subjects.set(c.subjectKey, (inName = { acc: newAcc(), spellings: new Map(), collections: new Set() }));
    add(inName.acc, row);
    inName.collections.add(c.id);
    const subjectLabel = c.subject || NO_SUBJECT_LABEL;
    inName.spellings.set(subjectLabel, (inName.spellings.get(subjectLabel) ?? 0) + 1);

    let subject = subjects.get(c.subjectKey);
    if (!subject) subjects.set(c.subjectKey, (subject = { acc: newAcc(), spellings: new Map(), collections: new Set(), names: new Map() }));
    add(subject.acc, row);
    subject.collections.add(c.id);
    subject.spellings.set(subjectLabel, (subject.spellings.get(subjectLabel) ?? 0) + 1);
    const nameInSubject = subject.names.get(c.nameKey) ?? { spellings: new Map(), cards: new Set<string>() };
    nameInSubject.spellings.set(c.name, (nameInSubject.spellings.get(c.name) ?? 0) + 1);
    nameInSubject.cards.add(row.card);
    subject.names.set(c.nameKey, nameInSubject);
  }

  // O acerto do período anterior, por nome, por assunto e por assunto dentro de um nome.
  const prevByName = new Map<string, Acc>();
  const prevBySubject = new Map<string, Acc>();
  const prevByPair = new Map<string, Acc>();
  if (previous) {
    for (const row of loadSessions(db, userId, previous)) {
      const c = keep(row);
      if (!c) continue;
      add(bucket(prevByName, c.nameKey), row);
      add(bucket(prevBySubject, c.subjectKey), row);
      add(bucket(prevByPair, `${c.nameKey}\u0000${c.subjectKey}`), row);
    }
  }
  const previousAccuracy = (acc: Acc | undefined): number | null => (previous && acc && acc.reviews > 0 ? pct(acc.good, acc.reviews) : null);
  const counts = (acc: Acc, prev: Acc | undefined): Counts => ({
    cards: acc.cards.size,
    reviews: acc.reviews,
    good: acc.good,
    bad: acc.bad,
    accuracyPct: pct(acc.good, acc.reviews),
    missedCards: acc.missed.size,
    previousAccuracyPct: previousAccuracy(prev),
    previousReviews: previous && prev ? prev.reviews : 0,
  });

  const byName: NameRow[] = [...names].map(([key, n]) => ({
    key,
    label: commonSpelling(n.spellings),
    ...counts(n.acc, prevByName.get(key)),
    collectionIds: [...n.collections],
    subjects: [...n.subjects]
      .map(
        ([subjectKey, s]): SubjectRow => ({
          key: subjectKey,
          label: commonSpelling(s.spellings),
          ...counts(s.acc, prevByPair.get(`${key}\u0000${subjectKey}`)),
          collectionIds: [...s.collections],
        }),
      )
      .sort(byCardsThenReviews),
  }));
  byName.sort(byCardsThenReviews);

  const bySubject: SubjectGroup[] = [...subjects]
    .map(([key, s]) => ({
      key,
      label: commonSpelling(s.spellings),
      ...counts(s.acc, prevBySubject.get(key)),
      collectionIds: [...s.collections],
      names: [...s.names.values()]
        .map((n) => ({ label: commonSpelling(n.spellings), cards: n.cards.size }))
        .sort((a, b) => b.cards - a.cards || a.label.localeCompare(b.label, 'pt-BR'))
        .map((n) => n.label),
    }))
    .sort(byCardsThenReviews);

  // As opções dos filtros: tudo do escopo, estudado ou não.
  const nameOptions = new Map<string, Map<string, number>>();
  const subjectOptions = new Map<string, Map<string, number>>();
  for (const c of collections.values()) {
    const n = nameOptions.get(c.nameKey) ?? new Map<string, number>();
    n.set(c.name, (n.get(c.name) ?? 0) + 1);
    nameOptions.set(c.nameKey, n);
    const s = subjectOptions.get(c.subjectKey) ?? new Map<string, number>();
    const label = c.subject || NO_SUBJECT_LABEL;
    s.set(label, (s.get(label) ?? 0) + 1);
    subjectOptions.set(c.subjectKey, s);
  }
  const toOptions = (map: Map<string, Map<string, number>>): FilterOption[] =>
    [...map].map(([key, spellings]) => ({ key, label: commonSpelling(spellings) })).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));

  // O total de cartões acompanha os filtros: "quanto do que é daquele nome/assunto foi estudado".
  const counted = [...collections.values()]
    .filter((c) => (query.name === null || c.nameKey === query.name) && (query.subject === null || c.subjectKey === query.subject))
    .map((c) => c.id);
  const totalCards = counted.length
    ? (db.prepare(`SELECT COUNT(*) AS n FROM flashcards WHERE collection_id IN (${counted.map(() => '?').join(', ')})`).get(...counted) as unknown as { n: number }).n
    : 0;

  const dailyPoints = [...daily].map(([date, v]): DailyPoint => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date));
  const today = localDay(now);
  const range = query.range ?? {
    from: current.start ? localDay(current.start) : (dailyPoints[0]?.date ?? today),
    to: today,
  };

  return {
    range,
    days: query.range ? null : query.days,
    scope,
    exam,
    totalCards,
    totals: {
      cards: total.cards.size,
      reviews: total.reviews,
      good: total.good,
      bad: total.bad,
      accuracyPct: total.reviews > 0 ? pct(total.good, total.reviews) : null,
      byResult,
    },
    daily: dailyPoints,
    byName,
    bySubject,
    options: { names: toOptions(nameOptions), subjects: toOptions(subjectOptions) },
  };
}
