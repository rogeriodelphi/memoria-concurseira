/**
 * O que os lembretes guardam: as inscrições de push dos aparelhos, a hora do lembrete de cada usuário e
 * as chaves VAPID do servidor. Tudo recebe o banco como argumento, para os testes usarem um em memória.
 */
import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { fail, ok, type Result } from '../mockexams/store';
import { generateVapidKeys, type PushTarget, type VapidKeys } from './webpush';

/** Mais que isto seria lixo acumulado (navegadores reinstalados): as inscrições mais antigas saem. */
export const MAX_DEVICES_PER_USER = 10;
const MAX_ENDPOINT_CHARS = 1000;

/**
 * O servidor faz um POST para o endereço da inscrição, e quem o cadastra é o usuário logado (o cadastro é
 * aberto): sem uma lista, ele poderia mandar o servidor falar com qualquer endereço da rede de casa. Só
 * valem os serviços de push dos navegadores: Google (Chrome e Edge), Mozilla (Firefox), Apple (Safari)
 * e Microsoft (Edge).
 */
const PUSH_HOST_SUFFIXES = ['.googleapis.com', '.push.services.mozilla.com', '.push.apple.com', '.notify.windows.com'];

export function isAllowedPushEndpoint(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_ENDPOINT_CHARS) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix) && host.length > suffix.length);
}

/** "19:30" ou `null` (sem lembrete); qualquer outra coisa é recusada. */
export function parseReminderTime(raw: unknown): Result<string | null> {
  if (raw === null || raw === undefined || raw === '') return ok(null);
  if (typeof raw === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) return ok(raw);
  return fail(400, 'Escolha uma hora válida (por exemplo, 19:30).');
}

const decodedLength = (text: unknown): number => (typeof text === 'string' ? Buffer.from(text, 'base64url').length : -1);

export interface SubscriptionInput {
  endpoint: unknown;
  keys?: { p256dh?: unknown; auth?: unknown } | null;
}

/** Guarda (ou atualiza) a inscrição de um aparelho. Reinscrever o mesmo endereço não duplica; passa a valer para quem inscreveu por último. */
export function saveSubscription(db: DatabaseSync, userId: string, input: SubscriptionInput, now: Date = new Date()): Result<{ devices: number }> {
  if (!isAllowedPushEndpoint(input.endpoint)) return fail(400, 'Este navegador usou um serviço de notificações que o app não aceita.');
  const p256dh = input.keys?.p256dh;
  const auth = input.keys?.auth;
  const publicKey = typeof p256dh === 'string' ? Buffer.from(p256dh, 'base64url') : Buffer.alloc(0);
  if (publicKey.length !== 65 || publicKey[0] !== 0x04 || decodedLength(auth) !== 16) return fail(400, 'Inscrição de notificações inválida.');

  db.exec('BEGIN');
  try {
    db.prepare(
      `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, created_at = excluded.created_at`,
    ).run(crypto.randomUUID(), userId, input.endpoint, p256dh as string, auth as string, now.toISOString());
    const rows = db
      .prepare('SELECT id FROM push_subscriptions WHERE user_id = ? ORDER BY created_at DESC, rowid DESC')
      .all(userId) as unknown as { id: string }[];
    for (const extra of rows.slice(MAX_DEVICES_PER_USER)) db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(extra.id);
    db.exec('COMMIT');
    return ok({ devices: Math.min(rows.length, MAX_DEVICES_PER_USER) });
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Tira a inscrição de um aparelho (só se for deste usuário). Devolve quantos aparelhos sobraram. */
export function removeSubscription(db: DatabaseSync, userId: string, endpoint: unknown): number {
  if (typeof endpoint === 'string') db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(userId, endpoint);
  return countDevices(db, userId);
}

/** Tira uma inscrição que o serviço de push disse não existir mais. */
export function dropSubscriptionById(db: DatabaseSync, id: string): void {
  db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(id);
}

export function countDevices(db: DatabaseSync, userId: string): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?').get(userId) as unknown as { n: number }).n;
}

export interface Device extends PushTarget {
  id: string;
}

export function listDevices(db: DatabaseSync, userId: string): Device[] {
  return db
    .prepare('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ? ORDER BY created_at, rowid')
    .all(userId) as unknown as Device[];
}

export function getReminderTime(db: DatabaseSync, userId: string): string | null {
  const row = db.prepare('SELECT reminder_time AS t FROM users WHERE id = ?').get(userId) as unknown as { t: string | null } | undefined;
  return row?.t ?? null;
}

/** Define a hora do lembrete (ou o desliga, com `null`). O dia do último envio não muda: mudar a hora não repete o lembrete de hoje. */
export function setReminderTime(db: DatabaseSync, userId: string, raw: unknown): Result<{ time: string | null }> {
  const parsed = parseReminderTime(raw);
  if (!parsed.ok) return parsed;
  db.prepare('UPDATE users SET reminder_time = ? WHERE id = ?').run(parsed.value, userId);
  return ok({ time: parsed.value });
}

const VAPID_PUBLIC = 'vapid_public_key';
const VAPID_PRIVATE = 'vapid_private_key';

function readVapid(db: DatabaseSync): VapidKeys | null {
  const rows = db.prepare('SELECT key, value FROM app_kv WHERE key IN (?, ?)').all(VAPID_PUBLIC, VAPID_PRIVATE) as unknown as {
    key: string;
    value: string;
  }[];
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const publicKey = byKey.get(VAPID_PUBLIC);
  const privateKey = byKey.get(VAPID_PRIVATE);
  return publicKey && privateKey ? { publicKey, privateKey } : null;
}

/**
 * As chaves VAPID do servidor: geradas na primeira vez e guardadas no banco, porque trocá-las invalidaria
 * todas as inscrições. O driver é síncrono: não há dois pedidos gerando ao mesmo tempo. Se só uma metade do
 * par existir (banco mexido à mão), as duas são refeitas: uma chave pública que não é a do par não serve.
 */
export function getVapidKeys(db: DatabaseSync): VapidKeys {
  const existing = readVapid(db);
  if (existing) return existing;
  const fresh = generateVapidKeys();
  db.exec('BEGIN');
  try {
    db.prepare('INSERT OR REPLACE INTO app_kv (key, value) VALUES (?, ?)').run(VAPID_PUBLIC, fresh.publicKey);
    db.prepare('INSERT OR REPLACE INTO app_kv (key, value) VALUES (?, ?)').run(VAPID_PRIVATE, fresh.privateKey);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return readVapid(db) ?? fresh;
}
