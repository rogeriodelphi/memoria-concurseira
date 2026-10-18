import express, { type Response } from 'express';

import { db } from '../db';
import { requireAuth, type AuthedRequest } from '../auth/middleware';
import { verifyCards } from '../ai/router';
import { withUsageContext } from '../ai/usage';
import { approveDrafts, countDrafts, discardDrafts, editDraft, listDraftGroups, verifyDrafts } from './store';

export const aiReviewRouter = express.Router();
aiReviewRouter.use(requireAuth);

// Os cartões de IA esperando conferência, por coleção.
aiReviewRouter.get('/', (req: AuthedRequest, res: Response) => {
  const groups = listDraftGroups(db, req.userId!);
  res.json({ success: true, groups, total: groups.reduce((n, g) => n + g.drafts.length, 0) });
});

// Só quantos esperam (o selo do menu).
aiReviewRouter.get('/count', (req: AuthedRequest, res: Response) => {
  res.json({ success: true, pending: countDrafts(db, req.userId!) });
});

aiReviewRouter.patch('/:id', (req: AuthedRequest, res: Response) => {
  const result = editDraft(db, req.userId!, req.params.id, { question: req.body?.question, answer: req.body?.answer });
  if (!result.ok) {
    res.status(result.status).json({ success: false, error: result.error });
    return;
  }
  res.json({ success: true, draft: result.value });
});

// Aprova (vira cartão de estudo) os `ids` escolhidos, ou todos os de uma `collectionId`.
aiReviewRouter.post('/approve', (req: AuthedRequest, res: Response) => {
  const result = approveDrafts(db, req.userId!, { ids: req.body?.ids, collectionId: req.body?.collectionId });
  if (!result.ok) {
    res.status(result.status).json({ success: false, error: result.error });
    return;
  }
  res.json({ success: true, ...result.value, pending: countDrafts(db, req.userId!) });
});

// A segunda opinião de outra IA sobre os cartões escolhidos (os `ids`, ou todos de uma `collectionId`). É só um alerta:
// guarda o veredito em cada cartão e não aprova nem descarta nada. Se parou no meio (cota, rede), devolve o que fez e o erro.
aiReviewRouter.post('/check', async (req: AuthedRequest, res: Response) => {
  const userId = req.userId!;
  const result = await withUsageContext({ userId, feature: 'verify' }, () =>
    verifyDrafts(db, userId, { ids: req.body?.ids, collectionId: req.body?.collectionId }, verifyCards),
  );
  if (!result.ok) {
    res.status(result.status).json({ success: false, error: result.error });
    return;
  }
  // Nada conferido e um erro: é uma falha de verdade (sem cota, sem chave), e a tela precisa mostrá-la.
  if (result.value.checked === 0 && result.value.error) {
    res.status(422).json({ success: false, error: result.value.error });
    return;
  }
  res.json({ success: true, ...result.value });
});

aiReviewRouter.post('/discard', (req: AuthedRequest, res: Response) => {
  const result = discardDrafts(db, req.userId!, { ids: req.body?.ids, collectionId: req.body?.collectionId });
  if (!result.ok) {
    res.status(result.status).json({ success: false, error: result.error });
    return;
  }
  res.json({ success: true, ...result.value, pending: countDrafts(db, req.userId!) });
});
