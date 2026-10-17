import express, { type Response } from 'express';

import { db } from '../db';
import { requireAuth, type AuthedRequest } from '../auth/middleware';
import { generateChoices } from '../ai/router';
import { withUsageContext } from '../ai/usage';
import { listChoices, prepareChoices } from './choices';
import {
  addCards,
  createMockExam,
  deleteMockExam,
  getMockExamDetail,
  listMockExams,
  recordAttempt,
  removeCard,
  renameMockExam,
  type Failure,
} from './store';

export const mockExamsRouter = express.Router();
mockExamsRouter.use(requireAuth);

const sendFailure = (res: Response, failure: Failure) =>
  res.status(failure.status).json({ success: false, error: failure.error });

// Com ?flashcardId=..., cada simulado diz se já tem aquele cartão (é o que o seletor
// "Adicionar ao simulado" mostra marcado).
mockExamsRouter.get('/', (req: AuthedRequest, res: Response) => {
  const flashcardId = typeof req.query.flashcardId === 'string' ? req.query.flashcardId : undefined;
  res.json({ success: true, mockExams: listMockExams(db, req.userId!, flashcardId) });
});

mockExamsRouter.post('/', (req: AuthedRequest, res: Response) => {
  const created = createMockExam(db, req.userId!, req.body?.name);
  if (!created.ok) return sendFailure(res, created);
  res.status(201).json({ success: true, mockExam: created.value });
});

mockExamsRouter.get('/:id', (req: AuthedRequest, res: Response) => {
  const detail = getMockExamDetail(db, req.userId!, req.params.id);
  if (!detail.ok) return sendFailure(res, detail);
  res.json({ success: true, mockExam: detail.value });
});

mockExamsRouter.put('/:id', (req: AuthedRequest, res: Response) => {
  const renamed = renameMockExam(db, req.userId!, req.params.id, req.body?.name);
  if (!renamed.ok) return sendFailure(res, renamed);
  res.json({ success: true, mockExam: renamed.value });
});

mockExamsRouter.delete('/:id', (req: AuthedRequest, res: Response) => {
  const deleted = deleteMockExam(db, req.userId!, req.params.id);
  if (!deleted.ok) return sendFailure(res, deleted);
  res.json({ success: true });
});

mockExamsRouter.post('/:id/cards', (req: AuthedRequest, res: Response) => {
  const added = addCards(db, req.userId!, req.params.id, req.body?.flashcardIds);
  if (!added.ok) return sendFailure(res, added);
  res.json({ success: true, ...added.value });
});

mockExamsRouter.delete('/:id/cards/:flashcardId', (req: AuthedRequest, res: Response) => {
  const removed = removeCard(db, req.userId!, req.params.id, req.params.flashcardId);
  if (!removed.ok) return sendFailure(res, removed);
  res.json({ success: true });
});

// As alternativas já geradas (e ainda válidas) dos cartões do simulado, e quais cartões ainda não têm.
mockExamsRouter.get('/:id/choices', (req: AuthedRequest, res: Response) => {
  const listed = listChoices(db, req.userId!, req.params.id);
  if (!listed.ok) return sendFailure(res, listed);
  res.json({ success: true, ...listed.value });
});

// Gera (uma chamada de IA por pedido) as alternativas dos cartões que ainda não têm e as guarda.
// O navegador pede em lotes pequenos e mostra o progresso. Falha da IA (cota, rede) é 422 com o
// motivo, como nas demais gerações; o que já foi guardado em lotes anteriores continua valendo.
mockExamsRouter.post('/:id/choices', async (req: AuthedRequest, res: Response) => {
  try {
    const prepared = await withUsageContext({ userId: req.userId!, feature: 'choices' }, () =>
      prepareChoices(db, req.userId!, req.params.id, req.body?.flashcardIds, generateChoices),
    );
    if (!prepared.ok) return sendFailure(res, prepared);
    res.json({ success: true, ...prepared.value });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Não foi possível gerar as alternativas.';
    res.status(422).json({ success: false, error: message });
  }
});

mockExamsRouter.post('/:id/attempts',(req: AuthedRequest, res: Response) => {
  const attempt = recordAttempt(db, req.userId!, req.params.id, req.body);
  if (!attempt.ok) return sendFailure(res, attempt);
  res.status(201).json({ success: true, attempt: attempt.value });
});
