import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_CONTENT_CHARS, MAX_TITLE_CHARS, prepareSummaryUpdate } from './update';

const ok = (body: unknown) => {
  const result = prepareSummaryUpdate(body);
  assert.ok(result.ok, result.ok ? '' : result.error);
  return result.value;
};
const error = (body: unknown) => {
  const result = prepareSummaryUpdate(body);
  assert.ok(!result.ok, 'devia recusar');
  return result.error;
};

test('edição: título e texto são aparados e o formato html é mantido', () => {
  assert.deepEqual(ok({ title: '  Firewalls   e  Redes ', content: '  <div>Texto</div> ', format: 'html' }), {
    title: 'Firewalls e Redes',
    content: '<div>Texto</div>',
    format: 'html',
  });
});

test('edição: qualquer formato desconhecido vira texto simples, sem tratar como HTML', () => {
  const value = ok({ title: 'T', content: '  a < b  ', format: 'xml' });
  assert.deepEqual(value, { title: 'T', content: 'a < b', format: 'plain' });
});

test('edição: o HTML passa pelo sanitizador (script, onclick e iframe somem; o resto fica)', () => {
  const { content } = ok({
    title: 'T',
    format: 'html',
    content:
      '<div style="text-align:justify" onclick="x()">Oi <b>mundo</b><script>alert(1)</script><iframe src="x"></iframe></div>',
  });
  assert.equal(content, '<div style="text-align:justify">Oi <b>mundo</b></div>');
});

test('edição: título vazio ou grande demais é recusado, com mensagem', () => {
  assert.match(error({ title: '   ', content: 'x' }), /título/);
  assert.match(error({ content: 'x' }), /título/);
  assert.match(error({ title: 'a'.repeat(MAX_TITLE_CHARS + 1), content: 'x' }), /título/);
  assert.ok(ok({ title: 'a'.repeat(MAX_TITLE_CHARS), content: 'x' }));
});

test('edição: texto vazio é recusado, inclusive o "vazio" que o editor devolve', () => {
  assert.match(error({ title: 'T', content: '', format: 'plain' }), /vazio/);
  assert.match(error({ title: 'T', content: '   ' }), /vazio/);
  assert.match(error({ title: 'T', content: '<div><br></div>', format: 'html' }), /vazio/);
  assert.match(error({ title: 'T', content: '<div>&nbsp;</div><script>x</script>', format: 'html' }), /vazio/);
  assert.match(error({ title: 'T' }), /vazio/);
  assert.match(error(null), /título/);
});

test('edição: uma imagem sozinha conta como conteúdo', () => {
  const { content } = ok({ title: 'T', format: 'html', content: '<div><img src="data:image/png;base64,AAAA"></div>' });
  assert.match(content, /<img src="data:image\/png;base64,AAAA"/);
});

test('edição: texto maior que o limite é recusado', () => {
  assert.match(error({ title: 'T', content: 'a'.repeat(MAX_CONTENT_CHARS + 1) }), /grande demais/);
});
