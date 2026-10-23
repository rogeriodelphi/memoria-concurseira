import express, { type Response } from 'express';

import { db } from '../db';
import { requireAuth, type AuthedRequest } from '../auth/middleware';
import { listExamOptions } from '../studyplan/nextExam';
import { loadSchedule, saveSettings, setTopicDone } from './store';

export const scheduleRouter = express.Router();
scheduleRouter.use(requireAuth);

/** O concurso que a tela escolheu (`?exam=<id>`); sem ele, ou se não vale, vale o de data mais próxima. */
const requestedExam = (req: AuthedRequest): string | undefined => (typeof req.query.exam === 'string' ? req.query.exam.slice(0, 64) : undefined);

function answer(req: AuthedRequest, res: Response, exam: unknown): void {
  const now = new Date();
  res.json({ success: true, schedule: loadSchedule(db, req.userId!, exam, now), exams: listExamOptions(db, req.userId!, now) });
}

// O cronograma do concurso escolhido (`schedule: null` se o usuário não tem concurso com data de hoje em diante). Só leitura.
scheduleRouter.get('/', (req: AuthedRequest, res: Response) => {
  answer(req, res, requestedExam(req));
});

// As escolhas do concurso: `{ examId, minutesPerDay, minutesPerTopic, weekdays }`. Devolve o cronograma já refeito.
scheduleRouter.put('/settings', (req: AuthedRequest, res: Response) => {
  const saved = saveSettings(db, req.userId!, req.body?.examId, req.body);
  if (!saved.ok) {
    res.status(saved.status).json({ success: false, error: saved.error });
    return;
  }
  answer(req, res, req.body.examId);
});

// Marca como estudado (ou volta a pendente): `{ done: true | false }`. Devolve o cronograma já refeito.
scheduleRouter.put('/topics/:topicId/done', (req: AuthedRequest, res: Response) => {
  const result = setTopicDone(db, req.userId!, req.params.topicId, req.body?.done);
  if (!result.ok) {
    res.status(result.status).json({ success: false, error: result.error });
    return;
  }
  answer(req, res, result.value.examId);
});
