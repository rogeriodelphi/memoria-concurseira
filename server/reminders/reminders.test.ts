import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  appSender,
  deliver,
  localDateKey,
  reminderDue,
  reminderMessage,
  runReminders,
  vapidSubject,
  type PushMessage,
  type ReminderDeps,
  type Sender,
} from './scheduler';
import { REMINDER_SCHEMA } from './schema';
import {
  countDevices,
  getReminderTime,
  getVapidKeys,
  isAllowedPushEndpoint,
  listDevices,
  MAX_DEVICES_PER_USER,
  parseReminderTime,
  removeSubscription,
  saveSubscription,
  setReminderTime,
} from './store';
import type { SendResult } from './webpush';

function newDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (id TEXT PRIMARY KEY, reminder_time TEXT, reminder_last_sent TEXT);
    INSERT INTO users (id) VALUES ('u1'), ('u2'), ('u3');
  `);
  db.exec(REMINDER_SCHEMA);
  return db;
}

/** Uma inscrição com chaves de verdade (a validação confere o tamanho e a curva). */
function keys() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return { p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') };
}
const endpoint = (n: number) => `https://fcm.googleapis.com/fcm/send/token-${n}`;
const subscribe = (db: DatabaseSync, userId: string, n: number, now = new Date(2026, 9, 17, 10, 0, n)) =>
  saveSubscription(db, userId, { endpoint: endpoint(n), keys: keys() }, now);

// ---------- endereços aceitos ----------

test('endereço de push: só https dos serviços dos navegadores', () => {
  for (const good of [
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://android.googleapis.com/gcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/QGxyz',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
    'https://FCM.GoogleAPIs.com:443/fcm/send/abc',
  ]) {
    assert.equal(isAllowedPushEndpoint(good), true, good);
  }
  for (const bad of [
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://127.0.0.1/push',
    'https://localhost/push',
    'https://192.168.0.10/push',
    'https://10.0.0.1:8443/x',
    'https://googleapis.com/x',
    'https://evilgoogleapis.com/x',
    'https://fcm.googleapis.com.evil.com/x',
    'https://evil.com/fcm.googleapis.com',
    'https://user:senha@fcm.googleapis.com/x',
    'https://fcm.googleapis.com:8443/x',
    'ftp://fcm.googleapis.com/x',
    'https://.push.apple.com/x',
    'not a url',
    '',
    `https://fcm.googleapis.com/${'a'.repeat(1000)}`,
    null,
    undefined,
    42,
    {},
  ]) {
    assert.equal(isAllowedPushEndpoint(bad), false, String(bad));
  }
});

// ---------- hora do lembrete ----------

test('hora do lembrete: HH:MM de 00:00 a 23:59, ou vazio para desligar', () => {
  for (const good of ['00:00', '07:05', '19:30', '23:59']) {
    const parsed = parseReminderTime(good);
    assert.ok(parsed.ok && parsed.value === good, good);
  }
  for (const off of [null, undefined, '']) {
    const parsed = parseReminderTime(off);
    assert.ok(parsed.ok && parsed.value === null);
  }
  for (const bad of ['24:00', '7:30', '19:60', '19h30', 'abc', '19:30:00', 1930, {}, ' 19:30']) {
    assert.equal(parseReminderTime(bad).ok, false, String(bad));
  }
});

test('hora do lembrete: grava, troca, desliga; hora inválida não muda nada', () => {
  const db = newDb();
  assert.equal(getReminderTime(db, 'u1'), null);
  assert.ok(setReminderTime(db, 'u1', '19:30').ok);
  assert.equal(getReminderTime(db, 'u1'), '19:30');
  assert.equal(getReminderTime(db, 'u2'), null, 'só o dele');
  const bad = setReminderTime(db, 'u1', '99:99');
  assert.ok(!bad.ok && bad.status === 400);
  assert.equal(getReminderTime(db, 'u1'), '19:30');
  assert.ok(setReminderTime(db, 'u1', null).ok);
  assert.equal(getReminderTime(db, 'u1'), null);
  assert.equal(getReminderTime(db, 'ninguem'), null);
});

test('mudar a hora não repete o lembrete de hoje', () => {
  const db = newDb();
  db.prepare("UPDATE users SET reminder_time = '08:00', reminder_last_sent = ? WHERE id = 'u1'").run(localDateKey(new Date(2026, 9, 17)));
  setReminderTime(db, 'u1', '20:00');
  const row = db.prepare("SELECT reminder_last_sent AS d FROM users WHERE id = 'u1'").get() as { d: string };
  assert.equal(row.d, '2026-10-17');
});

// ---------- inscrições ----------

test('inscrição: guarda o aparelho e o lista; chaves ou endereço ruins são recusados', () => {
  const db = newDb();
  const saved = subscribe(db, 'u1', 1);
  assert.ok(saved.ok && saved.value.devices === 1);
  assert.equal(listDevices(db, 'u1')[0].endpoint, endpoint(1));

  const refused = (input: Parameters<typeof saveSubscription>[2]) => {
    const r = saveSubscription(db, 'u1', input);
    assert.ok(!r.ok && r.status === 400, JSON.stringify(input).slice(0, 80));
  };
  refused({ endpoint: 'https://evil.com/x', keys: keys() });
  refused({ endpoint: endpoint(2), keys: { p256dh: 'curta', auth: keys().auth } });
  refused({ endpoint: endpoint(2), keys: { p256dh: keys().p256dh, auth: 'curto' } });
  refused({ endpoint: endpoint(2), keys: null });
  refused({ endpoint: endpoint(2) });
  refused({ endpoint: endpoint(2), keys: { p256dh: Buffer.concat([Buffer.from([2]), Buffer.alloc(64)]).toString('base64url'), auth: keys().auth } });
  assert.equal(countDevices(db, 'u1'), 1, 'nada entrou');
});

test('inscrição: o mesmo aparelho de novo não duplica e atualiza as chaves', () => {
  const db = newDb();
  subscribe(db, 'u1', 1);
  const fresh = keys();
  saveSubscription(db, 'u1', { endpoint: endpoint(1), keys: fresh });
  assert.equal(countDevices(db, 'u1'), 1);
  assert.equal(listDevices(db, 'u1')[0].p256dh, fresh.p256dh);
});

test('inscrição: o navegador que troca de conta passa para a conta nova, sem ficar nas duas', () => {
  const db = newDb();
  subscribe(db, 'u1', 1);
  subscribe(db, 'u2', 1);
  assert.equal(countDevices(db, 'u1'), 0);
  assert.equal(countDevices(db, 'u2'), 1);
});

test(`inscrição: no máximo ${MAX_DEVICES_PER_USER} aparelhos; os mais antigos saem`, () => {
  const db = newDb();
  for (let n = 1; n <= MAX_DEVICES_PER_USER + 2; n++) subscribe(db, 'u1', n);
  const endpoints = listDevices(db, 'u1').map((d) => d.endpoint);
  assert.equal(endpoints.length, MAX_DEVICES_PER_USER);
  assert.ok(!endpoints.includes(endpoint(1)) && !endpoints.includes(endpoint(2)), 'os dois mais antigos saíram');
  assert.ok(endpoints.includes(endpoint(MAX_DEVICES_PER_USER + 2)));
  subscribe(db, 'u2', 99);
  assert.equal(countDevices(db, 'u2'), 1, 'o limite é por usuário');
});

test('cancelar: só tira o aparelho do próprio usuário', () => {
  const db = newDb();
  subscribe(db, 'u1', 1);
  subscribe(db, 'u2', 2);
  // devolve quantos aparelhos o próprio usuário ainda tem
  assert.equal(removeSubscription(db, 'u1', endpoint(2)), 1, 'o aparelho do outro não é dele: nada sai');
  assert.equal(countDevices(db, 'u2'), 1);
  assert.equal(removeSubscription(db, 'u1', 123), 1, 'endereço que não é texto é ignorado');
  assert.equal(removeSubscription(db, 'u1', endpoint(1)), 0);
  assert.equal(removeSubscription(db, 'u2', endpoint(2)), 0);
});

test('apagar o usuário leva as inscrições junto', () => {
  const db = newDb();
  subscribe(db, 'u1', 1);
  db.exec("DELETE FROM users WHERE id = 'u1'");
  assert.equal(countDevices(db, 'u1'), 0);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get() as { n: number }).n, 0);
});

// ---------- chaves VAPID ----------

test('chaves VAPID: nascem uma vez, ficam no banco e são sempre as mesmas', () => {
  const db = newDb();
  const first = getVapidKeys(db);
  assert.equal(Buffer.from(first.publicKey, 'base64url').length, 65);
  assert.deepEqual(getVapidKeys(db), first);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM app_kv').get() as { n: number }).n, 2);
});

test('chaves VAPID: metade de um par (banco mexido à mão) é refeita por inteiro', () => {
  const db = newDb();
  const first = getVapidKeys(db);
  db.exec("DELETE FROM app_kv WHERE key = 'vapid_private_key'");
  const second = getVapidKeys(db);
  assert.notEqual(second.publicKey, first.publicKey, 'uma pública que não é a do par não serve');
  assert.deepEqual(getVapidKeys(db), second);
});

// ---------- quando enviar ----------

const at = (hour: number, minute = 0, day = 17) => new Date(2026, 9, day, hour, minute);

test('hora do envio: só da hora marcada até 3 horas depois, e uma vez por dia', () => {
  assert.equal(reminderDue('19:00', null, at(18, 59)), false, 'antes da hora');
  assert.equal(reminderDue('19:00', null, at(19, 0)), true, 'na hora');
  assert.equal(reminderDue('19:00', null, at(20, 30)), true);
  assert.equal(reminderDue('19:00', null, at(22, 0)), true, 'exatamente 3 horas depois');
  assert.equal(reminderDue('19:00', null, at(22, 1)), false, 'passou da janela: fica para amanhã');
  assert.equal(reminderDue('19:00', '2026-10-17', at(19, 30)), false, 'já enviado hoje');
  assert.equal(reminderDue('19:00', '2026-10-16', at(19, 30)), true, 'o último foi ontem');
  assert.equal(reminderDue(null, null, at(19, 30)), false, 'sem lembrete');
  assert.equal(reminderDue('lixo', null, at(19, 30)), false);
  assert.equal(reminderDue('23:50', null, new Date(2026, 9, 18, 0, 10)), false, 'a janela não atravessa a meia-noite');
  assert.equal(reminderDue('19:00', null, at(19, 30), 10), false, 'janela menor');
  assert.equal(localDateKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});

test('texto do lembrete: quantos cartões e, se há prova, quantos dias faltam', () => {
  assert.deepEqual(reminderMessage(42, 50), {
    title: 'Hora de estudar',
    body: '42 cartões para revisar hoje · faltam 50 dias para a prova',
    url: '/revisar',
    tag: 'lembrete-diario',
  });
  assert.equal(reminderMessage(1, null).body, '1 cartão para revisar hoje');
  assert.equal(reminderMessage(1200, 1).body, '1.200 cartões para revisar hoje · falta 1 dia para a prova');
  assert.equal(reminderMessage(5, 0).body, '5 cartões para revisar hoje', 'no dia da prova não conta dias');
  assert.equal(reminderMessage(5, -3).body, '5 cartões para revisar hoje');
});

// ---------- a rodada ----------

interface Sent {
  endpoint: string;
  message: PushMessage;
}

function setup(options: { pending?: number; studied?: boolean; days?: number | null; results?: Record<string, SendResult | Error> } = {}) {
  const db = newDb();
  const sent: Sent[] = [];
  const results = options.results ?? {};
  const deps: ReminderDeps = {
    pending: () => options.pending ?? 12,
    studiedToday: () => options.studied ?? false,
    daysToExam: () => (options.days === undefined ? 50 : options.days),
    send: async (target, message) => {
      sent.push({ endpoint: target.endpoint, message });
      const result = results[target.endpoint] ?? { status: 201, ok: true, gone: false };
      if (result instanceof Error) throw result;
      return result;
    },
  };
  return { db, sent, deps };
}
const lastSent = (db: DatabaseSync, userId: string) => (db.prepare('SELECT reminder_last_sent AS d FROM users WHERE id = ?').get(userId) as { d: string | null }).d;
const GONE: SendResult = { status: 410, ok: false, gone: true };
const DOWN: SendResult = { status: 503, ok: false, gone: false };

test('rodada: na hora, manda o lembrete a todos os aparelhos e marca o dia; a próxima rodada não repete', async () => {
  const { db, sent, deps } = setup({ pending: 42, days: 50 });
  setReminderTime(db, 'u1', '19:00');
  subscribe(db, 'u1', 1);
  subscribe(db, 'u1', 2);

  const outcomes = await runReminders(db, at(19, 5), deps);
  assert.deepEqual(outcomes.map((o) => [o.userId, o.status, o.delivery?.delivered]), [['u1', 'sent', 2]]);
  assert.deepEqual(sent.map((s) => s.endpoint).sort(), [endpoint(1), endpoint(2)]);
  assert.equal(sent[0].message.body, '42 cartões para revisar hoje · faltam 50 dias para a prova');
  assert.equal(lastSent(db, 'u1'), '2026-10-17');

  assert.deepEqual(await runReminders(db, at(19, 10), deps), []);
  assert.equal(sent.length, 2);
  // no dia seguinte, de novo
  assert.deepEqual((await runReminders(db, at(19, 5, 18), deps)).map((o) => o.status), ['sent']);
  assert.equal(sent.length, 4);
});

test('rodada: antes da hora, sem lembrete ligado, ou fora da janela, não manda nada', async () => {
  const { db, sent, deps } = setup();
  setReminderTime(db, 'u1', '19:00');
  subscribe(db, 'u1', 1);
  subscribe(db, 'u2', 2); // u2 tem aparelho mas não ligou o lembrete
  assert.deepEqual(await runReminders(db, at(18, 0), deps), []);
  assert.deepEqual(await runReminders(db, at(23, 0), deps), []);
  assert.equal(sent.length, 0);
  assert.equal(lastSent(db, 'u1'), null, 'não marcou: ainda pode mandar dentro da janela');
});

test('rodada: sem aparelho inscrito não há o que mandar (e o dia não é marcado)', async () => {
  const { db, sent, deps } = setup();
  setReminderTime(db, 'u1', '19:00');
  assert.deepEqual((await runReminders(db, at(19, 5), deps)).map((o) => o.status), ['no-devices']);
  assert.equal(sent.length, 0);
  assert.equal(lastSent(db, 'u1'), null, 'se ele inscrever um aparelho dentro da janela, recebe');
  subscribe(db, 'u1', 1);
  assert.deepEqual((await runReminders(db, at(19, 30), deps)).map((o) => o.status), ['sent']);
});

test('rodada: quem já estudou hoje, ou não tem nada para revisar, não é incomodado', async () => {
  const studied = setup({ studied: true });
  setReminderTime(studied.db, 'u1', '19:00');
  subscribe(studied.db, 'u1', 1);
  assert.deepEqual((await runReminders(studied.db, at(19, 5), studied.deps)).map((o) => o.status), ['already-studied']);
  assert.equal(studied.sent.length, 0);
  assert.equal(lastSent(studied.db, 'u1'), '2026-10-17', 'o dia fica resolvido: não manda mais tarde');

  const empty = setup({ pending: 0 });
  setReminderTime(empty.db, 'u1', '19:00');
  subscribe(empty.db, 'u1', 1);
  assert.deepEqual((await runReminders(empty.db, at(19, 5), empty.deps)).map((o) => o.status), ['nothing-pending']);
  assert.equal(empty.sent.length, 0);
  assert.equal(lastSent(empty.db, 'u1'), '2026-10-17');
});

test('rodada: aparelho que o serviço de push diz não existir mais é removido; os outros recebem', async () => {
  const { db, sent, deps } = setup({ results: { [endpoint(1)]: GONE } });
  setReminderTime(db, 'u1', '19:00');
  subscribe(db, 'u1', 1);
  subscribe(db, 'u1', 2);
  const [outcome] = await runReminders(db, at(19, 5), deps);
  assert.deepEqual(outcome.delivery, { delivered: 1, removed: 1, failed: 0 });
  assert.deepEqual(listDevices(db, 'u1').map((d) => d.endpoint), [endpoint(2)]);
  assert.equal(sent.length, 2);
  assert.equal(lastSent(db, 'u1'), '2026-10-17');
});

test('rodada: se todos os aparelhos estavam expirados, resolve o dia sem insistir', async () => {
  const { db, deps } = setup({ results: { [endpoint(1)]: GONE } });
  setReminderTime(db, 'u1', '19:00');
  subscribe(db, 'u1', 1);
  const [outcome] = await runReminders(db, at(19, 5), deps);
  assert.equal(outcome.status, 'sent');
  assert.equal(countDevices(db, 'u1'), 0);
  assert.equal(lastSent(db, 'u1'), '2026-10-17');
});

test('rodada: falha passageira em todos não marca o dia; a rodada seguinte tenta de novo', async () => {
  const flaky = setup({ results: { [endpoint(1)]: DOWN } });
  setReminderTime(flaky.db, 'u1', '19:00');
  subscribe(flaky.db, 'u1', 1);
  const [first] = await runReminders(flaky.db, at(19, 5), flaky.deps);
  assert.equal(first.status, 'will-retry');
  assert.equal(lastSent(flaky.db, 'u1'), null);
  assert.equal(countDevices(flaky.db, 'u1'), 1, 'falha passageira não apaga a inscrição');

  const networkError = setup({ results: { [endpoint(1)]: new Error('sem rede') } });
  setReminderTime(networkError.db, 'u1', '19:00');
  subscribe(networkError.db, 'u1', 1);
  assert.deepEqual((await runReminders(networkError.db, at(19, 5), networkError.deps)).map((o) => o.status), ['will-retry']);

  // a segunda tentativa funciona
  const recovered = setup({ results: { [endpoint(1)]: DOWN } });
  setReminderTime(recovered.db, 'u1', '19:00');
  subscribe(recovered.db, 'u1', 1);
  await runReminders(recovered.db, at(19, 5), recovered.deps);
  const retryDeps: ReminderDeps = { ...recovered.deps, send: async () => ({ status: 201, ok: true, gone: false }) };
  assert.deepEqual((await runReminders(recovered.db, at(19, 10), retryDeps)).map((o) => o.status), ['sent']);
  assert.equal(lastSent(recovered.db, 'u1'), '2026-10-17');
});

test('rodada: um aparelho que falha não impede os outros, e basta um receber para o dia valer', async () => {
  const { db, sent, deps } = setup({ results: { [endpoint(1)]: new Error('sem rede') } });
  setReminderTime(db, 'u1', '19:00');
  subscribe(db, 'u1', 1);
  subscribe(db, 'u1', 2);
  const [outcome] = await runReminders(db, at(19, 5), deps);
  assert.deepEqual(outcome.delivery, { delivered: 1, removed: 0, failed: 1 });
  assert.equal(sent.length, 2);
  assert.equal(lastSent(db, 'u1'), '2026-10-17');
});

test('rodada: o problema de um usuário não impede o lembrete dos outros', async () => {
  const { db, sent, deps } = setup();
  for (const id of ['u1', 'u2', 'u3']) setReminderTime(db, id, '19:00');
  subscribe(db, 'u1', 1);
  subscribe(db, 'u2', 2);
  subscribe(db, 'u3', 3);
  const flaky: ReminderDeps = {
    ...deps,
    pending: (userId) => {
      if (userId === 'u2') throw new Error('banco travou');
      return 7;
    },
  };
  const outcomes = await runReminders(db, at(19, 5), flaky);
  assert.deepEqual(outcomes.map((o) => o.userId), ['u1', 'u3']);
  assert.equal(sent.length, 2);
  assert.equal(lastSent(db, 'u2'), null, 'o u2 tenta de novo na próxima rodada');
});

test('entrega: conta o que chegou, o que expirou e o que falhou', async () => {
  const db = newDb();
  for (const n of [1, 2, 3, 4]) subscribe(db, 'u1', n);
  const results: Record<string, SendResult | Error> = { [endpoint(2)]: GONE, [endpoint(3)]: DOWN, [endpoint(4)]: new Error('x') };
  const send: Sender = async (target) => {
    const r = results[target.endpoint] ?? { status: 201, ok: true, gone: false };
    if (r instanceof Error) throw r;
    return r;
  };
  assert.deepEqual(await deliver(db, listDevices(db, 'u1'), reminderMessage(3, null), send), { delivered: 1, removed: 1, failed: 2 });
  assert.equal(countDevices(db, 'u1'), 3);
});

test('contato do servidor (VAPID): aceita mailto e https; qualquer outra coisa volta ao padrão', () => {
  const standard = 'https://github.com/rogeriodelphi/memoria-concurseira';
  assert.equal(vapidSubject({}), standard);
  assert.equal(vapidSubject({ VAPID_SUBJECT: 'mailto:eu@exemplo.com' }), 'mailto:eu@exemplo.com');
  assert.equal(vapidSubject({ VAPID_SUBJECT: ' https://exemplo.com/contato ' }), 'https://exemplo.com/contato');
  for (const bad of ['eu@exemplo.com', 'http://exemplo.com', 'mailto:', 'javascript:alert(1)', 'https://a b', '']) {
    assert.equal(vapidSubject({ VAPID_SUBJECT: bad }), standard, bad);
  }
});

test('envio de verdade: o remetente do app usa as chaves do banco (rejeita um endereço que não responde)', async () => {
  const db = newDb();
  const send = appSender(db);
  await assert.rejects(send({ endpoint: 'http://127.0.0.1:1/x', ...keys() }, reminderMessage(1, null)));
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM app_kv').get() as { n: number }).n, 2, 'as chaves VAPID foram criadas no uso');
});
