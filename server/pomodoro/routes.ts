import crypto from 'node:crypto';

import express, { type Response } from 'express';

import { db } from '../db';
import { requireAuth, type AuthedRequest } from '../auth/middleware';
import { mapPomodoroTask, type PomodoroTaskRow } from '../mappers';
import { insertManualTask, prepareManualTask } from './manual';
import { pomodoroSuggestions } from './suggestions';

export const pomodoroRouter = express.Router();
pomodoroRouter.use(requireAuth);

const MODES = ['simples', 'super'] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

pomodoroRouter.post('/tasks', (req: AuthedRequest, res: Response) => {
  const { mode, phase, discipline, subject, durationSec, startedAt, endedAt } = req.body ?? {};

  if (typeof mode !== 'string' || !(MODES as readonly string[]).includes(mode)) {
    res.status(400).json({ success: false, error: 'Modo inválido.' });
    return;
  }
  if (typeof durationSec !== 'number' || !Number.isFinite(durationSec) || durationSec <= 0) {
    res.status(400).json({ success: false, error: 'Duração inválida.' });
    return;
  }

  const now = new Date().toISOString();
  const row = {
    id: crypto.randomUUID(),
    user_id: req.userId!,
    mode,
    phase: typeof phase === 'string' ? phase.slice(0, 50) : '',
    discipline: typeof discipline === 'string' ? discipline.trim().slice(0, 120) : '',
    subject: typeof subject === 'string' ? subject.trim().slice(0, 120) : '',
    duration_sec: Math.round(durationSec),
    started_at: typeof startedAt === 'string' ? startedAt : now,
    ended_at: typeof endedAt === 'string' ? endedAt : now,
    created_at: now,
  };

  db.prepare(
    `INSERT INTO pomodoro_tasks
      (id, user_id, mode, phase, discipline, subject, duration_sec, started_at, ended_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.user_id,
    row.mode,
    row.phase,
    row.discipline,
    row.subject,
    row.duration_sec,
    row.started_at,
    row.ended_at,
    row.created_at,
  );

  res.status(201).json({ success: true, task: mapPomodoroTask(row as unknown as PomodoroTaskRow) });
});

// Um estudo que ficou sem registro: o usuário lança a data e o tempo depois. Grava na mesma tabela do cronômetro, então
// aparece nas estatísticas do Pomodoro e no "Tempo de estudo" do Meu desempenho. Ver ./manual.
pomodoroRouter.post('/manual', (req: AuthedRequest, res: Response) => {
  const now = new Date();
  const prepared = prepareManualTask(req.body, now);
  if (!prepared.ok) {
    res.status(prepared.status).json({ success: false, error: prepared.error });
    return;
  }
  const row = insertManualTask(db, req.userId!, prepared.value, now);
  res.status(201).json({ success: true, task: mapPomodoroTask(row as unknown as PomodoroTaskRow) });
});

pomodoroRouter.get('/tasks', (req: AuthedRequest, res: Response) => {
  const from = typeof req.query.from === 'string' && DATE_RE.test(req.query.from) ? req.query.from : null;
  const to = typeof req.query.to === 'string' && DATE_RE.test(req.query.to) ? req.query.to : null;

  let query = 'SELECT * FROM pomodoro_tasks WHERE user_id = ?';
  const params: (string | number)[] = [req.userId!];
  if (from) {
    query += ' AND date(started_at) >= ?';
    params.push(from);
  }
  if (to) {
    query += ' AND date(started_at) <= ?';
    params.push(to);
  }
  query += ' ORDER BY started_at DESC';

  const rows = db.prepare(query).all(...params) as unknown as PomodoroTaskRow[];
  res.json({ success: true, tasks: rows.map(mapPomodoroTask) });
});

// O que sugerir nos campos "Disciplina" e "Assunto": as disciplinas dos seus concursos, os nomes e os assuntos das
// suas coleções. Digitar um desses nomes faz o tempo do Pomodoro casar com os cartões e com o edital no Meu desempenho.
pomodoroRouter.get('/suggestions', (req: AuthedRequest, res: Response) => {
  res.json({ success: true, ...pomodoroSuggestions(db, req.userId!) });
});

pomodoroRouter.delete('/tasks/:id', (req: AuthedRequest, res: Response) => {
  const existing = db
    .prepare('SELECT id FROM pomodoro_tasks WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.userId!) as { id: string } | undefined;
  if (!existing) {
    res.status(404).json({ success: false, error: 'Tarefa não encontrada.' });
    return;
  }
  db.prepare('DELETE FROM pomodoro_tasks WHERE id = ?').run(existing.id);
  res.json({ success: true });
});

pomodoroRouter.get('/notes', (req: AuthedRequest, res: Response) => {
  const date = typeof req.query.date === 'string' && DATE_RE.test(req.query.date) ? req.query.date : todayKey();
  const row = db
    .prepare('SELECT text FROM pomodoro_notes WHERE user_id = ? AND note_date = ?')
    .get(req.userId!, date) as { text: string } | undefined;
  res.json({ success: true, date, text: row?.text ?? '' });
});

pomodoroRouter.put('/notes', (req: AuthedRequest, res: Response) => {
  const { date, text } = req.body ?? {};
  const noteDate = typeof date === 'string' && DATE_RE.test(date) ? date : todayKey();
  const noteText = typeof text === 'string' ? text.slice(0, 100) : '';
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO pomodoro_notes (user_id, note_date, text, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, note_date) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at`,
  ).run(req.userId!, noteDate, noteText, now);

  res.json({ success: true, date: noteDate, text: noteText });
});
