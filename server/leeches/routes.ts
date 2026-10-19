import express, { type Response } from 'express';

import { db } from '../db';
import { requireAuth, type AuthedRequest } from '../auth/middleware';
import { loadLeeches, parseMinErrors, resetLeech, snoozeLeech, splitLeech, type Result } from './leeches';

export const leechesRouter = express.Router();
leechesRouter.use(requireAuth);

function send<T extends object>(res: Response, result: Result<T>, status = 200): void {
  if (!result.ok) {
    res.status(result.status).json({ success: false, error: result.error });
    return;
  }
  res.status(status).json({ success: true, ...result.value });
}

// Os cartões que o usuário erra sempre. `?minErrors=2..8` (4 se ausente).
leechesRouter.get('/', (req: AuthedRequest, res: Response) => {
  const min = parseMinErrors(req.query.minErrors);
  if (!min.ok) return send(res, min);
  res.json({ success: true, ...loadLeeches(db, req.userId!, min.value) });
});

// Recomeça a contagem de erros do cartão (depois de reescrevê-lo, ou para dizer "este eu já resolvi").
leechesRouter.post('/:id/reset', (req: AuthedRequest, res: Response) => {
  send(res, resetLeech(db, req.userId!, req.params.id));
});

// Adia a revisão por 7, 14 ou 30 dias.
leechesRouter.post('/:id/snooze', (req: AuthedRequest, res: Response) => {
  send(res, snoozeLeech(db, req.userId!, req.params.id, req.body?.days));
});

// Quebra o cartão em vários menores: `{ cards: [{ question, answer }, ...], keepOriginal?: boolean }`.
leechesRouter.post('/:id/split', (req: AuthedRequest, res: Response) => {
  send(res, splitLeech(db, req.userId!, req.params.id, req.body), 201);
});
