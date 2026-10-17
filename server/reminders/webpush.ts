/**
 * Web Push sem dependências, só com o `crypto` do Node: a criptografia da mensagem (RFC 8291, com o
 * conteúdo `aes128gcm` da RFC 8188) e a identificação do servidor (VAPID, RFC 8292). O serviço de push do
 * navegador (Google, Mozilla, Apple...) só entrega o que vem assim, e só o aparelho que fez a inscrição
 * consegue ler o conteúdo: o serviço de push vê apenas bytes cifrados.
 *
 * A conferência da cifra é o exemplo da própria RFC 8291 (seção 5), no teste.
 */
import crypto from 'node:crypto';

export interface VapidKeys {
  /** A chave pública, P-256, não comprimida (65 bytes), em base64url: é a `applicationServerKey` do navegador. */
  publicKey: string;
  /** O valor privado (32 bytes), em base64url. */
  privateKey: string;
}

export interface PushSubscriptionKeys {
  /** A chave pública do aparelho (65 bytes), em base64url. */
  p256dh: string;
  /** O segredo de autenticação do aparelho (16 bytes), em base64url. */
  auth: string;
}

export interface PushTarget extends PushSubscriptionKeys {
  endpoint: string;
}

const RECORD_SIZE = 4096;
/** Cabe folgado em um registro: o texto de um lembrete tem poucas centenas de bytes. */
export const MAX_PAYLOAD_BYTES = 3500;
const VAPID_LIFETIME_SECONDS = 12 * 60 * 60;

const b64u = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
const fromB64u = (text: string) => Buffer.from(text, 'base64url');

/** Um par de chaves VAPID novo. Guarde-o: trocar as chaves invalida as inscrições que já existem. */
export function generateVapidKeys(): VapidKeys {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey().subarray(0, 32)) };
}

/** HKDF-SHA256, o único derivador de chaves que o protocolo usa. */
function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
  return Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, length));
}

export interface EncryptOptions {
  /** Só para teste: o sal e o par de chaves do servidor são sorteados a cada mensagem. */
  salt?: Buffer;
  senderPrivateKey?: Buffer;
}

/**
 * Cifra `payload` para uma inscrição: devolve o corpo da requisição (cabeçalho com sal, tamanho do
 * registro e chave pública efêmera do servidor, seguido do texto cifrado com AES-128-GCM).
 */
export function encryptPayload(payload: Buffer, keys: PushSubscriptionKeys, options: EncryptOptions = {}): Buffer {
  if (payload.length === 0 || payload.length > MAX_PAYLOAD_BYTES) throw new Error('Conteúdo de push com tamanho inválido.');
  const uaPublic = fromB64u(keys.p256dh);
  const authSecret = fromB64u(keys.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 0x04) throw new Error('Chave pública da inscrição inválida.');
  if (authSecret.length !== 16) throw new Error('Segredo de autenticação da inscrição inválido.');

  const salt = options.salt ?? crypto.randomBytes(16);
  const ecdh = crypto.createECDH('prime256v1');
  if (options.senderPrivateKey) ecdh.setPrivateKey(options.senderPrivateKey);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  // `computeSecret` recusa um ponto que não está na curva (a validação que a RFC exige).
  const sharedSecret = ecdh.computeSecret(uaPublic);

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = hkdf(authSecret, sharedSecret, keyInfo, 32);
  const contentKey = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);

  const cipher = crypto.createCipheriv('aes-128-gcm', contentKey, nonce);
  // 0x02 marca o último (e único) registro.
  const encrypted = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([0x02])])), cipher.final(), cipher.getAuthTag()]);

  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(RECORD_SIZE);
  return Buffer.concat([salt, recordSize, Buffer.from([asPublic.length]), asPublic, encrypted]);
}

/** O JWT ES256 que identifica o servidor para o serviço de push (RFC 8292). */
export function vapidToken(audience: string, subject: string, keys: VapidKeys, now: Date = new Date()): string {
  const publicKey = fromB64u(keys.publicKey);
  const privateKey = crypto.createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', d: keys.privateKey, x: b64u(publicKey.subarray(1, 33)), y: b64u(publicKey.subarray(33, 65)) },
    format: 'jwk',
  });
  const header = b64u(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(
    Buffer.from(JSON.stringify({ aud: audience, exp: Math.floor(now.getTime() / 1000) + VAPID_LIFETIME_SECONDS, sub: subject })),
  );
  const signature = crypto.sign('sha256', Buffer.from(`${header}.${claims}`), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `${header}.${claims}.${b64u(signature)}`;
}

export interface SendOptions {
  /** Um endereço https ou mailto de contato do operador do servidor (exigido pelo serviço de push). */
  subject: string;
  /** Quanto tempo o serviço de push guarda a mensagem se o aparelho estiver desligado. */
  ttlSeconds?: number;
  urgency?: 'very-low' | 'low' | 'normal' | 'high';
  /** Uma nova mensagem com o mesmo assunto substitui a anterior que ainda não foi entregue. */
  topic?: string;
  now?: Date;
  fetchImpl?: typeof fetch;
}

export interface SendResult {
  status: number;
  ok: boolean;
  /** A inscrição não existe mais (404 ou 410): o aparelho a cancelou ou o navegador a expirou. */
  gone: boolean;
}

/** Envia `message` (um objeto JSON, curto) para a inscrição. Falha de rede sobe como erro; o resto vira resultado. */
export async function sendPush(target: PushTarget, message: unknown, vapid: VapidKeys, options: SendOptions): Promise<SendResult> {
  const body = encryptPayload(Buffer.from(JSON.stringify(message), 'utf8'), target);
  const audience = new URL(target.endpoint).origin;
  const token = vapidToken(audience, options.subject, vapid, options.now);

  const headers: Record<string, string> = {
    Authorization: `vapid t=${token}, k=${vapid.publicKey}`,
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(options.ttlSeconds ?? 12 * 60 * 60),
    Urgency: options.urgency ?? 'normal',
  };
  if (options.topic) headers.Topic = options.topic;

  const response = await (options.fetchImpl ?? fetch)(target.endpoint, {
    method: 'POST',
    headers,
    body: new Uint8Array(body),
    signal: AbortSignal.timeout(15_000),
  });
  // O corpo da resposta não interessa; ler até o fim libera a conexão.
  await response.arrayBuffer().catch(() => undefined);
  return { status: response.status, ok: response.status >= 200 && response.status < 300, gone: response.status === 404 || response.status === 410 };
}
