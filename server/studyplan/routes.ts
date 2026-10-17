import express, { type Response } from 'express';

import { db } from '../db';
import { requireAuth, type AuthedRequest } from '../auth/middleware';
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
