import assert from 'node:assert/strict';
import test from 'node:test';

import { reminderSupport, reminderTimeLabel, urlBase64ToUint8Array } from './reminders';

test('chave do servidor: base64url vira os mesmos bytes, com ou sem preenchimento', () => {
  for (const length of [1, 2, 3, 31, 32, 64, 65]) {
    const original = Buffer.from(Array.from({ length }, (_, i) => (i * 37 + 250) % 256));
    const text = original.toString('base64url');
    assert.deepEqual(Buffer.from(urlBase64ToUint8Array(text)), original, `${length} bytes`);
  }
  // os caracteres que mudam entre base64 e base64url
  assert.deepEqual([...urlBase64ToUint8Array('-_8')], [0xfb, 0xff]);
  assert.deepEqual([...urlBase64ToUint8Array('')], []);
});

test('suporte: https, service worker, push e notificações; quando falta, a mensagem diz o que fazer', () => {
  const full = { isSecureContext: true, hasServiceWorker: true, hasPushManager: true, hasNotification: true };
  assert.deepEqual(reminderSupport(full), { ok: true });

  const insecure = reminderSupport({ ...full, isSecureContext: false });
  assert.ok(!insecure.ok && insecure.reason === 'insecure');
  assert.match(insecure.message, /https/);
  assert.match(insecure.message, /Tailscale/);

  for (const missing of ['hasServiceWorker', 'hasPushManager', 'hasNotification'] as const) {
    const result = reminderSupport({ ...full, [missing]: false });
    assert.ok(!result.ok && result.reason === 'unsupported', missing);
    assert.match(result.message, /iPhone/);
  }
  // o endereço inseguro vem primeiro: é o que o usuário corrige
  const both = reminderSupport({ isSecureContext: false, hasServiceWorker: false, hasPushManager: false, hasNotification: false });
  assert.ok(!both.ok && both.reason === 'insecure');
});

test('hora: 19:00 vira 19h, 07:05 vira 7h05', () => {
  assert.equal(reminderTimeLabel('19:00'), '19h');
  assert.equal(reminderTimeLabel('19:30'), '19h30');
  assert.equal(reminderTimeLabel('07:05'), '7h05');
  assert.equal(reminderTimeLabel('00:00'), '0h');
});
