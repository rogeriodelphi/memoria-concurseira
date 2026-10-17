import express, { type Response } from 'express';

import { db } from '../db';
import { requireAuth, type AuthedRequest } from '../auth/middleware';
import { loadExamPlan } from './examPlan';
import { loadNewOrderOverview, setNewCardOrder } from './newOrder';
import { getDailyNewLimit, setDailyNewLimit } from './store';

export const studyPlanRouter = express.Router();
studyPlanRouter.use(requireAuth);

// O limite diário de cartões novos na fila de revisão (`null` = sem limite).
studyPlanRouter.get('/', (req: AuthedRequest, res: Response) => {
  res.json({ success: true, dailyNewLimit: getDailyNewLimit(db, req.userId!) });
});

studyPlanRouter.put('/', (req: AuthedRequest, res: Response) => {
  const saved = setDailyNewLimit(db, req.userId!, req.body?.dailyNewLimit);
  if (!saved.ok) {
    res.status(400).json({ success: false, error: saved.error });
    return;
  }
  res.json({ success: true, dailyNewLimit: saved.value });
});

// Em que ordem os cartões novos entram na fila (com limite diário) e como ficaria a divisão pelo edital.
studyPlanRouter.get('/new-order', (req: AuthedRequest, res: Response) => {
  res.json({ success: true, ...loadNewOrderOverview(db, req.userId!) });
});

studyPlanRouter.put('/new-order', (req: AuthedRequest, res: Response) => {
  const saved = setNewCardOrder(db, req.userId!, req.body?.order);
  if (!saved.ok) {
    res.status(400).json({ success: false, error: saved.error });
    return;
  }
  res.json({ success: true, order: saved.value });
});

// A meta para a prova do concurso com data mais próxima (`plan: null` se não há nenhum com data).
studyPlanRouter.get('/exam', (req: AuthedRequest, res: Response) => {
  res.json({ success: true, plan: loadExamPlan(db, req.userId!) });
});
