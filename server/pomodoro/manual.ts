/**
 * Lançamento manual de tempo de estudo no Pomodoro: o usuário esqueceu de registrar um estudo e lança depois a data e o
 * tempo (e, se quiser, a disciplina e o assunto). Vira uma linha de `pomodoro_tasks`, a mesma tabela do cronômetro, e por
 * isso aparece em "Minhas estatísticas" e no "Tempo de estudo" do Meu desempenho sem nenhum caminho novo de leitura.
 *
 * Não se sabe a hora em que o estudo aconteceu, então o registro fica ao meio-dia do dia escolhido (cai no dia certo seja
 * qual for o fuso) e com início e fim iguais. Uma janela de duração zero não esconde nenhuma revisão de cartão do dia: o
 * "Tempo de estudo" ignora as revisões feitas DENTRO de um Pomodoro (já estariam contadas nele), e aqui não há como saber
 * quais foram. O tempo vale pelo `duration_sec`.
 */
import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export const MANUAL_MODE = 'manual';
export const MANUAL_PHASE = 'lancamento';
/** Um lançamento vai de 1 minuto a um dia inteiro; mais que isso é engano de digitação. */
export const MAX_MINUTES = 24 * 60;
/** Uma data antes disso é engano de digitação (um ano com 4 dígitos digitado pela metade, por exemplo). */
export const MIN_DATE = '2000-01-01';
const MAX_TEXT = 120;

export type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
const fail = (status: number, error: string): Result<never> => ({ ok: false, status, error });

export interface ManualTask {
  mode: typeof MANUAL_MODE;
  phase: typeof MANUAL_PHASE;
  discipline: string;
  subject: string;
  durationSec: number;
  startedAt: string;
  endedAt: string;
}

/** `2026-10-25` do dia local de `d`. */
export function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** O meio-dia local de uma data `AAAA-MM-DD` que existe no calendário; `null` para qualquer outra coisa (2026-02-30, "ontem"...). */
function noonOf(text: unknown): Date | null {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [y, m, d] = text.split('-').map(Number);
  const noon = new Date(y, m - 1, d, 12, 0, 0, 0);
  return noon.getFullYear() === y && noon.getMonth() === m - 1 && noon.getDate() === d ? noon : null;
}

const cleanText = (value: unknown) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT) : '');

/** Valida o que o usuário digitou e devolve a tarefa a gravar, ou a mensagem de erro. `now` decide o que é "futuro". */
export function prepareManualTask(body: unknown, now: Date): Result<ManualTask> {
  const { date, minutes, discipline, subject } = (body ?? {}) as Record<string, unknown>;

  const noon = noonOf(date);
  if (!noon) return fail(400, 'Informe uma data válida.');
  if ((date as string) < MIN_DATE) return fail(400, 'A data é antiga demais.');
  if ((date as string) > localDateKey(now)) return fail(400, 'A data não pode ser no futuro.');

  if (typeof minutes !== 'number' || !Number.isFinite(minutes)) return fail(400, 'Informe o tempo estudado.');
  const rounded = Math.round(minutes);
  if (rounded < 1 || rounded > MAX_MINUTES) return fail(400, 'O tempo deve ficar entre 1 minuto e 24 horas.');

  const instant = noon.toISOString();
  return {
    ok: true,
    value: {
      mode: MANUAL_MODE,
      phase: MANUAL_PHASE,
      discipline: cleanText(discipline),
      subject: cleanText(subject),
      durationSec: rounded * 60,
      startedAt: instant,
      endedAt: instant,
    },
  };
}

/** Grava o lançamento na tabela do Pomodoro e devolve a linha gravada. */
export function insertManualTask(db: DatabaseSync, userId: string, task: ManualTask, now: Date) {
  const row = {
    id: crypto.randomUUID(),
    user_id: userId,
    mode: task.mode,
    phase: task.phase,
    discipline: task.discipline,
    subject: task.subject,
    duration_sec: task.durationSec,
    started_at: task.startedAt,
    ended_at: task.endedAt,
    created_at: now.toISOString(),
  };
  db.prepare(
    `INSERT INTO pomodoro_tasks (id, user_id, mode, phase, discipline, subject, duration_sec, started_at, ended_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.user_id, row.mode, row.phase, row.discipline, row.subject, row.duration_sec, row.started_at, row.ended_at, row.created_at);
  return row;
}
