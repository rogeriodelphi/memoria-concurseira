import assert from 'node:assert/strict';
import test from 'node:test';

import { bindAddress, cacheControlFor } from './hosting';

test('endereço de escuta: sem BIND_ADDRESS (ou em branco) nada muda: escuta em todas as interfaces', () => {
  assert.equal(bindAddress({}), undefined);
  assert.equal(bindAddress({ BIND_ADDRESS: '' }), undefined);
  assert.equal(bindAddress({ BIND_ADDRESS: '   ' }), undefined);
});

test('endereço de escuta: aceita IPv4, IPv6 e localhost, aparando espaços', () => {
  assert.equal(bindAddress({ BIND_ADDRESS: '127.0.0.1' }), '127.0.0.1');
  assert.equal(bindAddress({ BIND_ADDRESS: ' 127.0.0.1 ' }), '127.0.0.1');
  assert.equal(bindAddress({ BIND_ADDRESS: '::1' }), '::1');
  assert.equal(bindAddress({ BIND_ADDRESS: '0.0.0.0' }), '0.0.0.0');
  assert.equal(bindAddress({ BIND_ADDRESS: 'localhost' }), 'localhost');
});

test('endereço de escuta: valor inválido derruba a subida com mensagem clara, em vez de cair no padrão', () => {
  for (const bad of ['localhost:3200', 'meu-pc', '999.1.1.1', '127.0.0.1;', 'http://127.0.0.1']) {
    assert.throws(() => bindAddress({ BIND_ADDRESS: bad }), /BIND_ADDRESS inválido/, bad);
  }
});

test('cache: arquivos com hash em assets/ ficam guardados por um ano', () => {
  const immutable = 'public, max-age=31536000, immutable';
  assert.equal(cacheControlFor('assets/index-CcKxl9LC.js'), immutable);
  assert.equal(cacheControlFor('assets/index-Bm3Vf_D5.css'), immutable);
  assert.equal(cacheControlFor('assets\\index-CcKxl9LC.js'), immutable, 'separador do Windows');
  assert.equal(cacheControlFor('/assets/x.js'), immutable, 'barra inicial');
});

test('cache: a porta de entrada, o service worker, o manifest e a página offline nunca ficam velhos', () => {
  for (const file of ['index.html', 'sw.js', 'manifest.webmanifest', 'offline.html']) {
    assert.equal(cacheControlFor(file), 'no-cache', file);
  }
});

test('cache: o resto segue o padrão do Express; e só a pasta assets/ da raiz é tratada como imutável', () => {
  assert.equal(cacheControlFor('icons/icon-192.png'), undefined);
  assert.equal(cacheControlFor('favicon.ico'), undefined);
  assert.equal(cacheControlFor('icons/assets/x.png'), undefined);
  assert.equal(cacheControlFor('assets'), undefined);
  assert.equal(cacheControlFor('assetsx/a.js'), undefined);
  assert.equal(cacheControlFor('nested/index.html'), undefined, 'só o index.html da raiz');
});
