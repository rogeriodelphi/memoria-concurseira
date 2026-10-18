import express, { type Response } from 'express';

import { db } from '../db';
import { requireAuth, type AuthedRequest } from '../auth/middleware';
import { getDailyNewLimit } from '../studyplan/store';
import { loadPerformance, parsePerformanceQuery } from './performance';
import { buildDashboard, type DashboardCard, type DashboardSession } from './dashboard';

export const statsRouter = express.Router();
statsRouter.use(requireAuth);

const DAY_MS = 24 * 60 * 60 * 1000;

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Sequência de dias consecutivos com pelo menos um estudo, contando a partir
 * de hoje — ou de ontem, se ainda não estudou hoje (não queremos zerar a
 * sequência só porque o dia ainda não acabou).
 */
function computeStreak(studiedDaysDesc: string[]): number {
  if (studiedDaysDesc.length === 0) return 0;
  const daySet = new Set(studiedDaysDesc);

  let cursor = new Date();
  if (!daySet.has(toDateKey(cursor))) {
    cursor = new Date(cursor.getTime() - DAY_MS);
    if (!daySet.has(toDateKey(cursor))) return 0;
  }

  let streak = 0;
  while (daySet.has(toDateKey(cursor))) {
    streak++;
    cursor = new Date(cursor.getTime() - DAY_MS);
  }
  return streak;
}

const RESULT_KEYS = ['errei', 'dificil', 'bom', 'facil'] as const;

statsRouter.get('/', (req: AuthedRequest, res: Response) => {
  const userId = req.userId!;

  const collectionsCount = (
    db.prepare('SELECT COUNT(*) AS n FROM collections WHERE user_id = ?').get(userId) as unknown as {
      n: number;
    }
  ).n;

  const flashcardsCount = (
    db
      .prepare('SELECT COUNT(*) AS n FROM flashcards f JOIN collections c ON c.id = f.collection_id WHERE c.user_id = ?')
      .get(userId) as unknown as { n: number }
  ).n;

  const reviewsCount = (
    db.prepare('SELECT COUNT(*) AS n FROM study_sessions WHERE user_id = ?').get(userId) as unknown as {
      n: number;
    }
  ).n;

  const byResultRows = db
    .prepare('SELECT result, COUNT(*) AS n FROM study_sessions WHERE user_id = ? GROUP BY result')
    .all(userId) as unknown as { result: string; n: number }[];
  const byResult: Record<(typeof RESULT_KEYS)[number], number> = { errei: 0, dificil: 0, bom: 0, facil: 0 };
  for (const row of byResultRows) {
    if ((RESULT_KEYS as readonly string[]).includes(row.result)) {
      byResult[row.result as (typeof RESULT_KEYS)[number]] = row.n;
    }
  }

  const dayRows = db
    .prepare("SELECT date(studied_at) AS day, COUNT(*) AS n FROM study_sessions WHERE user_id = ? GROUP BY day ORDER BY day DESC")
    .all(userId) as unknown as { day: string; n: number }[];
  const dayMap = new Map(dayRows.map((r) => [r.day, r.n]));

  const dailyActivity: { date: string; count: number }[] = [];
  const today = new Date();
  for (let i = 13; i >= 0; i--) {
    const key = toDateKey(new Date(today.getTime() - i * DAY_MS));
    dailyActivity.push({ date: key, count: dayMap.get(key) ?? 0 });
  }

  const streakDays = computeStreak(dayRows.map((r) => r.day));

  // Agrupado por NOME, não por id: o usuário pode ter mais de uma coleção
  // com o mesmo nome (ex.: gerou o mesmo PDF duas vezes em coleções
  // separadas em vez de usar "Adicionar PDF" numa já existente) — nesse
  // caso o ranking deve somar as revisões das duas em vez de listar duas
  // linhas iguais. GROUP_CONCAT junta os ids por trás daquele nome; se for
  // só um, o card vira link; se forem vários, fica só texto (não dá pra
  // linkar um nome ambíguo pra uma coleção específica).
  const byCollectionRows = db
    .prepare(
      `SELECT c.name AS name,
              GROUP_CONCAT(DISTINCT c.id) AS collectionIds,
              COUNT(ss.id) AS reviews,
              SUM(CASE WHEN ss.result IN ('bom','facil') THEN 1 ELSE 0 END) AS good
       FROM study_sessions ss
       JOIN flashcards f ON f.id = ss.flashcard_id
       JOIN collections c ON c.id = f.collection_id
       WHERE ss.user_id = ?
       GROUP BY c.name
       ORDER BY reviews DESC`,
    )
    .all(userId) as unknown as { name: string; collectionIds: string; reviews: number; good: number }[];

  const byCollection = byCollectionRows.map((row) => {
    const ids = row.collectionIds.split(',');
    return {
      id: ids.length === 1 ? ids[0] : null,
      name: row.name,
      reviews: row.reviews,
      accuracyPct: row.reviews > 0 ? Math.round((row.good / row.reviews) * 100) : 0,
    };
  });

  res.json({
    success: true,
    totals: {
      collections: collectionsCount,
      flashcards: flashcardsCount,
      reviews: reviewsCount,
      streakDays,
    },
    byResult,
    dailyActivity,
    byCollection,
  });
});

// "Meu desempenho": o que foi estudado num período, por nome de coleção e por assunto. Parâmetros: days (1, 7, 15,
// 30 ou 0 = desde o início) ou from e to (AAAA-MM-DD), scope (all ou exam), name e subject (filtros).
statsRouter.get('/performance', (req: AuthedRequest, res: Response) => {
  const parsed = parsePerformanceQuery(req.query as Record<string, unknown>);
  if (!parsed.ok) {
    res.status(400).json({ success: false, error: parsed.error });
    return;
  }
  res.json({ success: true, ...loadPerformance(db, req.userId!, new Date(), parsed.value) });
});

statsRouter.get('/dashboard', (req: AuthedRequest, res: Response) => {
  const userId = req.userId!;

  const sessions = db
    .prepare('SELECT flashcard_id, result, studied_at, duration_ms FROM study_sessions WHERE user_id = ?')
    .all(userId) as unknown as {
    flashcard_id: string;
    result: DashboardSession['result'];
    studied_at: string;
    duration_ms: number | null;
  }[];

  const cards = db
    .prepare(
      `SELECT f.due_at, f.repetitions, f.interval_days
       FROM flashcards f JOIN collections c ON c.id = f.collection_id
       WHERE c.user_id = ?`,
    )
    .all(userId) as unknown as { due_at: string | null; repetitions: number; interval_days: number }[];

  const dashboard = buildDashboard(
    sessions.map(
      (s): DashboardSession => ({
        flashcardId: s.flashcard_id,
        result: s.result,
        studiedAt: s.studied_at,
        durationMs: s.duration_ms,
      }),
    ),
    cards.map((c): DashboardCard => ({ dueAt: c.due_at, repetitions: c.repetitions, intervalDays: c.interval_days })),
    new Date(),
    getDailyNewLimit(db, userId),
  );

  res.json({ success: true, ...dashboard });
});
