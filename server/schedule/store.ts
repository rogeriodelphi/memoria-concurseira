/**
 * O cronograma no banco: lê o edital, o que o usuário marcou como feito e as escolhas dele, monta o plano
 * (`buildSchedule`) e devolve tudo o que a tela precisa. Só escreve as duas coisas que são do usuário (as escolhas e as
 * marcas de "estudei"); o plano em si nunca é guardado.
 */
import type { DatabaseSync } from 'node:sqlite';

import { notFrozen } from '../collections/frozen';
import { loadExamOrderContext } from '../studyplan/newOrder';
import { chooseExam, type NextExam } from '../studyplan/nextExam';
import {
  ALL_WEEKDAYS,
  buildSchedule,
  DEFAULT_SETTINGS,
  formatDay,
  MAX_MINUTES_PER_DAY,
  MAX_MINUTES_PER_TOPIC,
  MIN_MINUTES_PER_DAY,
  MIN_MINUTES_PER_TOPIC,
  type ScheduleDay,
  type ScheduleSettings,
  type ScheduleSummary,
} from './plan';

export type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
const fail = (status: number, error: string): Result<never> => ({ ok: false, status, error });

// ---------- as escolhas do usuário ----------

const isIntIn = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

/**
 * Valida as escolhas: minutos por dia (10 a 480), minutos por tópico (10 a 120, e nunca mais que o dia: um tópico precisa
 * caber em um dia) e os dias da semana em que estuda (0 a 6, ao menos um). Qualquer outra coisa é erro, não chute.
 */
export function parseSettings(raw: unknown): Result<ScheduleSettings> {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (!isIntIn(body.minutesPerDay, MIN_MINUTES_PER_DAY, MAX_MINUTES_PER_DAY)) {
    return fail(400, `O tempo por dia deve ser de ${MIN_MINUTES_PER_DAY} a ${MAX_MINUTES_PER_DAY} minutos.`);
  }
  if (!isIntIn(body.minutesPerTopic, MIN_MINUTES_PER_TOPIC, MAX_MINUTES_PER_TOPIC)) {
    return fail(400, `O tempo por tópico deve ser de ${MIN_MINUTES_PER_TOPIC} a ${MAX_MINUTES_PER_TOPIC} minutos.`);
  }
  if (body.minutesPerTopic > body.minutesPerDay) {
    return fail(400, 'Cada tópico precisa caber em um dia: o tempo por tópico não pode passar do tempo por dia.');
  }
  const weekdays = body.weekdays;
  if (!Array.isArray(weekdays) || weekdays.length === 0 || !weekdays.every((d) => isIntIn(d, 0, 6))) {
    return fail(400, 'Escolha ao menos um dia da semana para estudar.');
  }
  return { ok: true, value: { minutesPerDay: body.minutesPerDay, minutesPerTopic: body.minutesPerTopic, weekdays: [...new Set(weekdays as number[])].sort((a, b) => a - b) } };
}

interface SettingsRow {
  minutes_per_day: number;
  minutes_per_topic: number;
  weekdays: string;
}

/** As escolhas guardadas para o concurso, ou as padrão (e se são as padrão). Uma linha estragada também cai nas padrão. */
export function loadSettings(db: DatabaseSync, examId: string): { settings: ScheduleSettings; saved: boolean } {
  const row = db.prepare('SELECT minutes_per_day, minutes_per_topic, weekdays FROM schedule_settings WHERE exam_id = ?').get(examId) as unknown as SettingsRow | undefined;
  if (!row) return { settings: { ...DEFAULT_SETTINGS, weekdays: [...ALL_WEEKDAYS] }, saved: false };
  const parsed = parseSettings({ minutesPerDay: row.minutes_per_day, minutesPerTopic: row.minutes_per_topic, weekdays: row.weekdays.split(',').filter(Boolean).map(Number) });
  return parsed.ok ? { settings: parsed.value, saved: true } : { settings: { ...DEFAULT_SETTINGS, weekdays: [...ALL_WEEKDAYS] }, saved: false };
}

function ownedExam(db: DatabaseSync, userId: string, examId: unknown): boolean {
  return typeof examId === 'string' && db.prepare('SELECT 1 FROM exams WHERE id = ? AND user_id = ?').get(examId, userId) !== undefined;
}

export function saveSettings(db: DatabaseSync, userId: string, examId: unknown, raw: unknown, now: Date = new Date()): Result<ScheduleSettings> {
  if (!ownedExam(db, userId, examId)) return fail(404, 'Concurso não encontrado.');
  const parsed = parseSettings(raw);
  if (!parsed.ok) return parsed;
  const { minutesPerDay, minutesPerTopic, weekdays } = parsed.value;
  db.prepare(
    `INSERT INTO schedule_settings (exam_id, minutes_per_day, minutes_per_topic, weekdays, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(exam_id) DO UPDATE SET minutes_per_day = excluded.minutes_per_day, minutes_per_topic = excluded.minutes_per_topic,
       weekdays = excluded.weekdays, updated_at = excluded.updated_at`,
  ).run(examId as string, minutesPerDay, minutesPerTopic, weekdays.join(','), now.toISOString());
  return { ok: true, value: parsed.value };
}

/** Marca (ou desmarca) um tópico como estudado. O tópico precisa ser de um concurso do usuário; devolve o concurso dele. */
export function setTopicDone(db: DatabaseSync, userId: string, topicId: unknown, done: unknown, now: Date = new Date()): Result<{ examId: string; done: boolean }> {
  if (typeof done !== 'boolean') return fail(400, 'Diga se o tópico foi estudado ou não.');
  const row =
    typeof topicId === 'string'
      ? (db
          .prepare(
            `SELECT e.id AS exam_id FROM exam_topics t JOIN exam_disciplines d ON d.id = t.discipline_id JOIN exams e ON e.id = d.exam_id
             WHERE t.id = ? AND e.user_id = ?`,
          )
          .get(topicId, userId) as unknown as { exam_id: string } | undefined)
      : undefined;
  if (!row || typeof topicId !== 'string') return fail(404, 'Tópico não encontrado.');
  if (done) db.prepare('INSERT OR IGNORE INTO schedule_topic_done (topic_id, done_at) VALUES (?, ?)').run(topicId, now.toISOString());
  else db.prepare('DELETE FROM schedule_topic_done WHERE topic_id = ?').run(topicId);
  return { ok: true, value: { examId: row.exam_id, done } };
}

// ---------- o que a tela recebe ----------

export interface ScheduleTopicView {
  id: string;
  title: string;
  disciplineId: string;
  done: boolean;
  /** Os cartões das coleções ligadas ao tópico e quantos já foram vistos (em %); `null` sem cartões. */
  cards: number;
  seenPct: number | null;
  /** As coleções ligadas (sem as congeladas), para abrir o estudo do tópico. */
  collectionIds: string[];
}

export interface ScheduleDisciplineView {
  id: string;
  name: string;
  /** A fatia da prova, em %. */
  sharePct: number;
  topics: number;
  done: number;
}

export interface ScheduleView {
  exam: NextExam;
  /** AAAA-MM-DD (hoje, no relógio do servidor, que é o do navegador). */
  today: string;
  settings: ScheduleSettings;
  /** `false` enquanto o usuário não escolheu nada (valem as escolhas padrão). */
  settingsSaved: boolean;
  disciplines: ScheduleDisciplineView[];
  /** Todos os tópicos do edital, na ordem dele. */
  topics: ScheduleTopicView[];
  days: ScheduleDay[];
  summary: ScheduleSummary;
}

/**
 * O cronograma do concurso escolhido (`requestedExam`; se não vale ou não veio, o de data mais próxima), ou `null` se o
 * usuário não tem concurso com data de hoje em diante. Só leitura.
 */
export function loadSchedule(db: DatabaseSync, userId: string, requestedExam: unknown, now: Date = new Date()): ScheduleView | null {
  const exam = chooseExam(db, userId, requestedExam, now);
  if (!exam) return null;
  const context = loadExamOrderContext(db, userId, now, exam);
  if (!context) return null;

  const topicRows = db
    .prepare(
      `SELECT t.id, t.title, t.discipline_id
       FROM exam_topics t JOIN exam_disciplines d ON d.id = t.discipline_id
       WHERE d.exam_id = ? ORDER BY d.position, d.rowid, t.position, t.rowid`,
    )
    .all(exam.id) as unknown as { id: string; title: string; discipline_id: string }[];

  const doneIds = new Set(
    (
      db
        .prepare(
          `SELECT s.topic_id FROM schedule_topic_done s JOIN exam_topics t ON t.id = s.topic_id JOIN exam_disciplines d ON d.id = t.discipline_id
           WHERE d.exam_id = ?`,
        )
        .all(exam.id) as unknown as { topic_id: string }[]
    ).map((r) => r.topic_id),
  );

  const cardRows = db
    .prepare(
      `SELECT t.id AS topic_id, COUNT(f.id) AS cards, COALESCE(SUM(CASE WHEN f.due_at IS NULL THEN 1 ELSE 0 END), 0) AS new_cards
       FROM exam_topics t JOIN exam_disciplines d ON d.id = t.discipline_id
       LEFT JOIN exam_topic_collections l ON l.topic_id = t.id
       LEFT JOIN collections c ON c.id = l.collection_id AND c.user_id = ?
       LEFT JOIN flashcards f ON f.collection_id = c.id
       WHERE d.exam_id = ? GROUP BY t.id`,
    )
    .all(userId, exam.id) as unknown as { topic_id: string; cards: number; new_cards: number }[];
  const cardsOf = new Map(cardRows.map((r) => [r.topic_id, r]));

  const linkRows = db
    .prepare(
      `SELECT l.topic_id, l.collection_id
       FROM exam_topic_collections l JOIN collections c ON c.id = l.collection_id
       JOIN exam_topics t ON t.id = l.topic_id JOIN exam_disciplines d ON d.id = t.discipline_id
       WHERE d.exam_id = ? AND c.user_id = ? AND ${notFrozen('c.id')} ORDER BY l.rowid`,
    )
    .all(exam.id, userId) as unknown as { topic_id: string; collection_id: string }[];
  const collectionsOf = new Map<string, string[]>();
  for (const link of linkRows) collectionsOf.set(link.topic_id, [...(collectionsOf.get(link.topic_id) ?? []), link.collection_id]);

  const topics: ScheduleTopicView[] = topicRows.map((t) => {
    const stat = cardsOf.get(t.id);
    const cards = stat?.cards ?? 0;
    return {
      id: t.id,
      title: t.title,
      disciplineId: t.discipline_id,
      done: doneIds.has(t.id),
      cards,
      seenPct: cards > 0 ? Math.round(((cards - (stat?.new_cards ?? 0)) / cards) * 100) : null,
      collectionIds: collectionsOf.get(t.id) ?? [],
    };
  });

  const { settings, saved } = loadSettings(db, exam.id);
  const today = formatDay(now);
  const schedule = buildSchedule({
    today,
    examDate: exam.examDate,
    settings,
    disciplines: context.disciplines.map((d) => ({ id: d.id, points: d.points })),
    topics: topics.map((t) => ({ id: t.id, disciplineId: t.disciplineId, done: t.done })),
  });

  const totalPoints = context.disciplines.reduce((sum, d) => sum + d.points, 0);
  return {
    exam,
    today,
    settings,
    settingsSaved: saved,
    disciplines: context.disciplines.map((d) => {
      const own = topics.filter((t) => t.disciplineId === d.id);
      return { id: d.id, name: d.name, sharePct: totalPoints > 0 ? Math.round((d.points / totalPoints) * 100) : 0, topics: own.length, done: own.filter((t) => t.done).length };
    }),
    topics,
    days: schedule.days,
    summary: schedule.summary,
  };
}
