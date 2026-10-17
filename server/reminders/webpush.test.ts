import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { encryptPayload, generateVapidKeys, MAX_PAYLOAD_BYTES, sendPush, vapidToken, type PushTarget } from './webpush';

const fromB64u = (text: string) => Buffer.from(text, 'base64url');

// ---------- o exemplo da RFC 8291, seção 5 e apêndice A ----------

const RFC = {
  authSecret: 'BTBZMqHH6r4Tts7J_aSIgg',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  plaintext: 'When I grow up, I want to be a watermelon',
  body:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml' +
    'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT' +
    'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

test('cifra: reproduz, byte a byte, a mensagem de exemplo da RFC 8291', () => {
  const body = encryptPayload(Buffer.from(RFC.plaintext), { p256dh: RFC.uaPublic, auth: RFC.authSecret }, {
    salt: fromB64u(RFC.salt),
    senderPrivateKey: fromB64u(RFC.asPrivate),
  });
  assert.equal(body.toString('base64url'), RFC.body);
  // 86 de cabeçalho + 41 do texto + 1 do delimitador + 16 da etiqueta do GCM. (O "Content-Length: 145" que a RFC escreve
  // no exemplo está uma unidade acima do corpo que ela mesma mostra.)
  assert.equal(body.length, 144);
});

/** O lado do aparelho, escrito à parte da cifra: lê o cabeçalho, deriva as chaves e decifra. */
function decrypt(body: Buffer, uaPrivate: string, uaPublic: string, authSecret: string): string {
  const salt = body.subarray(0, 16);
  const recordSize = body.readUInt32BE(16);
  const keyIdLength = body[20];
  const asPublic = body.subarray(21, 21 + keyIdLength);
  const encrypted = body.subarray(21 + keyIdLength);
  assert.equal(recordSize, 4096);
  assert.equal(keyIdLength, 65);

  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(fromB64u(uaPrivate));
  const secret = ecdh.computeSecret(asPublic);
  const prk = crypto.createHmac('sha256', fromB64u(authSecret)).update(secret).digest();
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), fromB64u(uaPublic), asPublic]);
  const ikm = crypto.createHmac('sha256', prk).update(Buffer.concat([keyInfo, Buffer.from([1])])).digest();
  const prk2 = crypto.createHmac('sha256', salt).update(ikm).digest();
  const cek = crypto.createHmac('sha256', prk2).update(Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])])).digest().subarray(0, 16);
  const nonce = crypto.createHmac('sha256', prk2).update(Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])])).digest().subarray(0, 12);

  const decipher = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(encrypted.subarray(encrypted.length - 16));
  const plain = Buffer.concat([decipher.update(encrypted.subarray(0, encrypted.length - 16)), decipher.final()]);
  assert.equal(plain[plain.length - 1], 0x02, 'o delimitador do último registro');
  return plain.subarray(0, plain.length - 1).toString('utf8');
}

/** Uma inscrição nova, como o navegador a criaria. */
function newDevice() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16).toString('base64url');
  return { private: ecdh.getPrivateKey().toString('base64url'), p256dh: ecdh.getPublicKey().toString('base64url'), auth };
}

test('cifra: o aparelho decifra o que foi cifrado para ele, com sal e chave do servidor sorteados', () => {
  const device = newDevice();
  const text = JSON.stringify({ title: 'Hora de estudar', body: '42 cartões para revisar hoje · faltam 50 dias para a prova ✓' });
  const a = encryptPayload(Buffer.from(text), device);
  const b = encryptPayload(Buffer.from(text), device);
  assert.equal(decrypt(a, device.private, device.p256dh, device.auth), text);
  assert.equal(decrypt(b, device.private, device.p256dh, device.auth), text);
  assert.notDeepEqual(a, b, 'cada mensagem tem o seu sal e a sua chave efêmera');
  assert.equal(a.includes(Buffer.from('Hora de estudar')), false, 'o texto não aparece em claro');
});

test('cifra: outro aparelho não consegue decifrar', () => {
  const device = newDevice();
  const other = newDevice();
  const body = encryptPayload(Buffer.from('segredo'), device);
  assert.throws(() => decrypt(body, other.private, other.p256dh, other.auth));
  // com a chave certa mas o segredo de autenticação errado, também não
  assert.throws(() => decrypt(body, device.private, device.p256dh, other.auth));
});

test('cifra: recusa inscrição inválida e conteúdo vazio ou grande demais', () => {
  const device = newDevice();
  assert.throws(() => encryptPayload(Buffer.from('x'), { ...device, p256dh: 'curta' }), /Chave pública/);
  assert.throws(() => encryptPayload(Buffer.from('x'), { ...device, auth: 'curto' }), /Segredo de autenticação/);
  // 65 bytes começando com 0x04, mas fora da curva
  const offCurve = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString('base64url');
  assert.throws(() => encryptPayload(Buffer.from('x'), { ...device, p256dh: offCurve }));
  assert.throws(() => encryptPayload(Buffer.alloc(0), device), /tamanho inválido/);
  assert.throws(() => encryptPayload(Buffer.alloc(MAX_PAYLOAD_BYTES + 1, 97), device), /tamanho inválido/);
  assert.doesNotThrow(() => encryptPayload(Buffer.alloc(MAX_PAYLOAD_BYTES, 97), device));
});

// ---------- VAPID ----------

test('VAPID: chaves novas têm o tamanho certo e não se repetem', () => {
  const a = generateVapidKeys();
  const b = generateVapidKeys();
  assert.equal(fromB64u(a.publicKey).length, 65);
  assert.equal(fromB64u(a.publicKey)[0], 0x04);
  assert.equal(fromB64u(a.privateKey).length, 32);
  assert.notEqual(a.publicKey, b.publicKey);
});

test('VAPID: o token é um JWT ES256 que a chave pública confere, com origem, validade e contato', () => {
  const keys = generateVapidKeys();
  const now = new Date('2026-10-17T12:00:00Z');
  const token = vapidToken('https://fcm.googleapis.com', 'https://github.com/rogeriodelphi/memoria-concurseira', keys, now);
  const [header, claims, signature] = token.split('.');
  assert.deepEqual(JSON.parse(fromB64u(header).toString()), { typ: 'JWT', alg: 'ES256' });
  assert.deepEqual(JSON.parse(fromB64u(claims).toString()), {
    aud: 'https://fcm.googleapis.com',
    exp: Math.floor(now.getTime() / 1000) + 12 * 3600,
    sub: 'https://github.com/rogeriodelphi/memoria-concurseira',
  });

  const publicKey = fromB64u(keys.publicKey);
  const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: publicKey.subarray(1, 33).toString('base64url'), y: publicKey.subarray(33, 65).toString('base64url') }, format: 'jwk' });
  const verify = (sig: Buffer, text = `${header}.${claims}`) => crypto.verify('sha256', Buffer.from(text), { key, dsaEncoding: 'ieee-p1363' }, sig);
  assert.equal(fromB64u(signature).length, 64, 'assinatura crua (r e s), não DER');
  assert.equal(verify(fromB64u(signature)), true);
  assert.equal(verify(fromB64u(signature), `${header}.${claims}x`), false, 'mudar o conteúdo invalida a assinatura');
});

// ---------- envio, contra um "serviço de push" de verdade (um servidor HTTP local) ----------

interface Received {
  method?: string;
  url?: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

async function pushService(status: number): Promise<{ endpoint: string; received: Received[]; close: () => Promise<void> }> {
  const received: Received[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      received.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
      res.statusCode = status;
      res.end('ok');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    endpoint: `http://127.0.0.1:${port}/push/abc123`,
    received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const SUBJECT = 'https://github.com/rogeriodelphi/memoria-concurseira';

test('envio: o serviço de push recebe o corpo cifrado e os cabeçalhos certos, e o aparelho lê a mensagem', async () => {
  const service = await pushService(201);
  try {
    const device = newDevice();
    const vapid = generateVapidKeys();
    const target: PushTarget = { endpoint: service.endpoint, p256dh: device.p256dh, auth: device.auth };
    const message = { title: 'Hora de estudar', body: '12 cartões para revisar hoje', url: '/revisar' };

    const result = await sendPush(target, message, vapid, { subject: SUBJECT, ttlSeconds: 3600, urgency: 'normal', topic: 'lembrete' });
    assert.deepEqual(result, { status: 201, ok: true, gone: false });

    const [request] = service.received;
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/push/abc123');
    assert.equal(request.headers['content-encoding'], 'aes128gcm');
    assert.equal(request.headers.ttl, '3600');
    assert.equal(request.headers.urgency, 'normal');
    assert.equal(request.headers.topic, 'lembrete');
    const authorization = String(request.headers.authorization);
    assert.match(authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
    assert.ok(authorization.endsWith(`k=${vapid.publicKey}`));
    // o token é para a origem do serviço de push, não para o caminho
    const claims = JSON.parse(fromB64u(authorization.split('t=')[1].split('.')[1]).toString());
    assert.equal(claims.aud, new URL(service.endpoint).origin);
    assert.equal(claims.sub, SUBJECT);

    assert.deepEqual(JSON.parse(decrypt(request.body, device.private, device.p256dh, device.auth)), message);
  } finally {
    await service.close();
  }
});

test('envio: 404 e 410 dizem que a inscrição acabou; outros erros não', async () => {
  const device = newDevice();
  const vapid = generateVapidKeys();
  for (const [status, expected] of [[404, { ok: false, gone: true }], [410, { ok: false, gone: true }], [500, { ok: false, gone: false }], [429, { ok: false, gone: false }], [400, { ok: false, gone: false }], [200, { ok: true, gone: false }]] as const) {
    const service = await pushService(status);
    try {
      const result = await sendPush({ endpoint: service.endpoint, ...device }, { title: 't' }, vapid, { subject: SUBJECT });
      assert.deepEqual({ ok: result.ok, gone: result.gone }, expected, String(status));
      assert.equal(result.status, status);
    } finally {
      await service.close();
    }
  }
});

test('envio: sem servidor do outro lado, o erro de rede sobe', async () => {
  const device = newDevice();
  await assert.rejects(sendPush({ endpoint: 'http://127.0.0.1:1/x', ...device }, { title: 't' }, generateVapidKeys(), { subject: SUBJECT }));
});

test('envio: usa o fetch recebido e cabeçalhos padrão quando nada é pedido', async () => {
  const device = newDevice();
  const calls: { url: string; init: RequestInit }[] = [];
  const fake = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(null, { status: 201 });
  }) as unknown as typeof fetch;
  const result = await sendPush({ endpoint: 'https://fcm.googleapis.com/fcm/send/xyz', ...device }, { title: 't' }, generateVapidKeys(), { subject: SUBJECT, fetchImpl: fake });
  assert.equal(result.ok, true);
  assert.equal(calls[0].url, 'https://fcm.googleapis.com/fcm/send/xyz');
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.TTL, String(12 * 3600));
  assert.equal(headers.Urgency, 'normal');
  assert.equal('Topic' in headers, false);
});
