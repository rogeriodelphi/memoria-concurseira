import express, { type Response } from 'express';

import { db } from '../db';
import { requireAuth, type AuthedRequest } from '../auth/middleware';
import { appSender, deliver, TEST_MESSAGE } from './scheduler';
import { countDevices, getReminderTime, getVapidKeys, listDevices, removeSubscription, saveSubscription, setReminderTime } from './store';

export const remindersRouter = express.Router();
remindersRouter.use(requireAuth);

// Um teste manda uma notificação de verdade: um a cada 10 segundos por usuário basta e evita martelar o serviço de push.
const TEST_COOLDOWN_MS = 10_000;
const lastTest = new Map<string, number>();

// A chave pública que o navegador precisa para se inscrever, a hora do lembrete e quantos aparelhos recebem.
remindersRouter.get('/', (req: AuthedRequest, res: Response) => {
  res.json({
    success: true,
    publicKey: getVapidKeys(db).publicKey,
    time: getReminderTime(db, req.userId!),
    devices: countDevices(db, req.userId!),
  });
});

remindersRouter.put('/', (req: AuthedRequest, res: Response) => {
  const saved = setReminderTime(db, req.userId!, req.body?.time);
  if (!saved.ok) {
    res.status(saved.status).json({ success: false, error: saved.error });
    return;
  }
  res.json({ success: true, time: saved.value.time });
});

// A inscrição de push deste aparelho (o `subscription.toJSON()` do navegador).
remindersRouter.post('/subscribe', (req: AuthedRequest, res: Response) => {
  const subscription = req.body?.subscription as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | undefined;
  const saved = saveSubscription(db, req.userId!, { endpoint: subscription?.endpoint, keys: subscription?.keys });
  if (!saved.ok) {
    res.status(saved.status).json({ success: false, error: saved.error });
    return;
  }
  res.status(201).json({ success: true, devices: saved.value.devices });
});

remindersRouter.post('/unsubscribe', (req: AuthedRequest, res: Response) => {
  res.json({ success: true, devices: removeSubscription(db, req.userId!, req.body?.endpoint) });
});

// Manda uma notificação de teste para os aparelhos do usuário.
remindersRouter.post('/test', async (req: AuthedRequest, res: Response) => {
  const userId = req.userId!;
  const now = Date.now();
  if (now - (lastTest.get(userId) ?? 0) < TEST_COOLDOWN_MS) {
    res.status(429).json({ success: false, error: 'Aguarde alguns segundos para testar de novo.' });
    return;
  }
  const devices = listDevices(db, userId);
  if (devices.length === 0) {
    res.status(409).json({ success: false, error: 'Nenhum aparelho está inscrito. Ative o lembrete neste aparelho primeiro.' });
    return;
  }
  lastTest.set(userId, now);
  const result = await deliver(db, devices, TEST_MESSAGE, appSender(db));
  if (result.delivered === 0) {
    res.status(422).json({
      success: false,
      error:
        result.removed > 0 && result.failed === 0
          ? 'A inscrição deste aparelho tinha expirado e foi removida. Ative o lembrete de novo.'
          : 'O serviço de notificações do navegador não aceitou o teste. Tente de novo em instantes.',
    });
    return;
  }
  res.json({ success: true, ...result });
});
