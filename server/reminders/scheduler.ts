/**
 * O lembrete diário de estudo: quem recebe, quando e com que texto. A regra é de propósito discreta:
 * no máximo um lembrete por dia, só na hora escolhida (ou até 3 horas depois, se o PC estava desligado),
 * só se há cartões para revisar e a pessoa ainda não estudou hoje. Quem decide a hora, e liga ou desliga,
 * é sempre o usuário.
 */
import type { DatabaseSync } from 'node:sqlite';

import { selectDueCards, localDayBounds } from '../studyplan/store';
import { nextExam } from '../studyplan/nextExam';
import { dropSubscriptionById, getVapidKeys, listDevices, type Device } from './store';
import { sendPush, type PushTarget, type SendResult } from './webpush';

/** Depois de tanto tempo da hora marcada, o lembrete do dia já não vale: fica para amanhã. */
export const REMINDER_WINDOW_MINUTES = 180;

export interface PushMessage {
  title: string;
  body: string;
  /** Caminho do app que o toque na notificação abre. */
  url: string;
  /** Um lembrete novo substitui o anterior que ainda esteja na tela. */
  tag: string;
}

/** O dia local como AAAA-MM-DD (o dia do servidor, que é o do PC e do navegador). */
export function localDateKey(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** Já passou da hora marcada (e não faz mais de `windowMinutes`), e hoje ainda não foi enviado? */
export function reminderDue(
  time: string | null,
  lastSent: string | null,
  now: Date,
  windowMinutes: number = REMINDER_WINDOW_MINUTES,
): boolean {
  const match = time ? /^(\d{2}):(\d{2})$/.exec(time) : null;
  if (!match || lastSent === localDateKey(now)) return false;
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Number(match[1]), Number(match[2]));
  const minutes = (now.getTime() - target.getTime()) / 60_000;
  return minutes >= 0 && minutes <= windowMinutes;
}

/** O texto do lembrete: quantos cartões e, se há prova marcada, quantos dias faltam. */
export function reminderMessage(pending: number, daysToExam: number | null): PushMessage {
  const cards = `${pending.toLocaleString('pt-BR')} ${pending === 1 ? 'cartão' : 'cartões'} para revisar hoje`;
  const exam =
    daysToExam === null || daysToExam <= 0
      ? ''
      : daysToExam === 1
        ? ' · falta 1 dia para a prova'
        : ` · faltam ${daysToExam.toLocaleString('pt-BR')} dias para a prova`;
  return { title: 'Hora de estudar', body: `${cards}${exam}`, url: '/revisar', tag: 'lembrete-diario' };
}

export const TEST_MESSAGE: PushMessage = {
  title: 'Memória Concurseira',
  body: 'Os lembretes estão funcionando neste aparelho.',
  url: '/painel',
  tag: 'lembrete-teste',
};

export type Sender = (target: PushTarget, message: PushMessage) => Promise<SendResult>;

export interface DeliveryResult {
  delivered: number;
  /** Inscrições que o serviço de push disse não existirem mais (já removidas). */
  removed: number;
  /** Falhas que podem passar sozinhas (rede, serviço fora do ar, cota). */
  failed: number;
}

/** Manda `message` a cada aparelho. Um que falha não impede os outros; os que não existem mais são tirados do banco. */
export async function deliver(db: DatabaseSync, devices: Device[], message: PushMessage, send: Sender): Promise<DeliveryResult> {
  const result: DeliveryResult = { delivered: 0, removed: 0, failed: 0 };
  for (const device of devices) {
    try {
      const sent = await send(device, message);
      if (sent.ok) result.delivered++;
      else if (sent.gone) {
        dropSubscriptionById(db, device.id);
        result.removed++;
      } else {
        result.failed++;
        console.error(`  ✗ O serviço de push respondeu ${sent.status} ao lembrete.`);
      }
    } catch (err) {
      result.failed++;
      console.error('  ✗ Não consegui falar com o serviço de push:', err instanceof Error ? err.message : err);
    }
  }
  return result;
}

export interface ReminderDeps {
  pending(userId: string, now: Date): number;
  studiedToday(userId: string, now: Date): boolean;
  daysToExam(userId: string, now: Date): number | null;
  send: Sender;
}

export type ReminderStatus = 'sent' | 'already-studied' | 'nothing-pending' | 'no-devices' | 'will-retry';

export interface ReminderOutcome {
  userId: string;
  status: ReminderStatus;
  delivery?: DeliveryResult;
}

function markSent(db: DatabaseSync, userId: string, now: Date): void {
  db.prepare('UPDATE users SET reminder_last_sent = ? WHERE id = ?').run(localDateKey(now), userId);
}

/**
 * Manda o lembrete de hoje a quem está na hora. Se todas as tentativas falharam por algo passageiro, o
 * dia não é marcado como enviado e a próxima rodada tenta de novo (dentro da janela). Um usuário com
 * problema não impede os outros.
 */
export async function runReminders(db: DatabaseSync, now: Date, deps: ReminderDeps): Promise<ReminderOutcome[]> {
  const users = db
    .prepare('SELECT id, reminder_time, reminder_last_sent FROM users WHERE reminder_time IS NOT NULL ORDER BY rowid')
    .all() as unknown as { id: string; reminder_time: string; reminder_last_sent: string | null }[];

  const outcomes: ReminderOutcome[] = [];
  for (const user of users) {
    if (!reminderDue(user.reminder_time, user.reminder_last_sent, now)) continue;
    try {
      const devices = listDevices(db, user.id);
      if (devices.length === 0) {
        outcomes.push({ userId: user.id, status: 'no-devices' });
        continue;
      }
      if (deps.studiedToday(user.id, now)) {
        markSent(db, user.id, now);
        outcomes.push({ userId: user.id, status: 'already-studied' });
        continue;
      }
      const pending = deps.pending(user.id, now);
      if (pending === 0) {
        markSent(db, user.id, now);
        outcomes.push({ userId: user.id, status: 'nothing-pending' });
        continue;
      }
      const delivery = await deliver(db, devices, reminderMessage(pending, deps.daysToExam(user.id, now)), deps.send);
      // Entregou a alguém, ou não restou nenhum aparelho para tentar: o dia está resolvido.
      if (delivery.delivered > 0 || delivery.failed === 0) {
        markSent(db, user.id, now);
        outcomes.push({ userId: user.id, status: 'sent', delivery });
      } else {
        outcomes.push({ userId: user.id, status: 'will-retry', delivery });
      }
    } catch (err) {
      console.error(`  ✗ Falha ao processar o lembrete de ${user.id}:`, err);
    }
  }
  return outcomes;
}

const DEFAULT_SUBJECT = 'https://github.com/rogeriodelphi/memoria-concurseira';

/** O contato do servidor que o serviço de push exige (VAPID): um `mailto:` ou um endereço https. */
export function vapidSubject(env: NodeJS.ProcessEnv = process.env): string {
  const custom = env.VAPID_SUBJECT?.trim();
  return custom && /^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/.test(custom) ? custom : DEFAULT_SUBJECT;
}

/** Os dados e o envio de verdade, a partir do banco do app. */
export function appDeps(db: DatabaseSync): ReminderDeps {
  return {
    pending: (userId, now) => selectDueCards(db, userId, now).cards.length,
    studiedToday: (userId, now) => {
      const { start, end } = localDayBounds(now);
      return !!db
        .prepare('SELECT 1 FROM study_sessions WHERE user_id = ? AND studied_at >= ? AND studied_at < ? LIMIT 1')
        .get(userId, start, end);
    },
    daysToExam: (userId, now) => nextExam(db, userId, now)?.daysLeft ?? null,
    send: appSender(db),
  };
}

/** O envio de verdade: cifrado, com as chaves VAPID do servidor, guardando o aviso por 6 horas (um lembrete velho não serve). */
export function appSender(db: DatabaseSync): Sender {
  return (target, message) =>
    sendPush(target, message, getVapidKeys(db), { subject: vapidSubject(), ttlSeconds: 6 * 60 * 60, urgency: 'normal', topic: 'lembrete' });
}

const CHECK_EVERY_MS = 5 * 60 * 1000;
const FIRST_CHECK_MS = 60 * 1000;

/** Liga a verificação periódica. Nunca derruba o servidor: qualquer erro é só registrado. */
export function startReminderSchedule(db: DatabaseSync): void {
  const tick = () => {
    runReminders(db, new Date(), appDeps(db)).catch((err) => console.error('  ✗ Falha na rodada de lembretes:', err));
  };
  setTimeout(tick, FIRST_CHECK_MS);
  setInterval(tick, CHECK_EVERY_MS);
}
