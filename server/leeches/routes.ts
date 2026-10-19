import express, { type Response } from 'express';

import { db } from '../db';
import { suggestLeechFix } from '../ai/router';
import { withUsageContext } from '../ai/usage';
import { requireAuth, type AuthedRequest } from '../auth/middleware';
import { loadLeeches, parseMinErrors, resetLeech, snoozeLeech, splitLeech, type Result } from './leeches';
import { suggestFix } from './suggest';

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

// A sugestão da IA (diagnóstico, macete, divisão em cartões menores). Só propõe: nada é gravado. Falha da IA (cota, rede,
// resposta inútil) é 422 com o motivo, como nas demais gerações.
leechesRouter.post('/:id/suggest', async (req: AuthedRequest, res: Response) => {
  try {
    const result = await withUsageContext({ userId: req.userId!, feature: 'leech' }, () => suggestFix(db, req.userId!, req.params.id, suggestLeechFix));
    send(res, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Não foi possível gerar a sugestão.';
    res.status(422).json({ success: false, error: message });
  }
});
