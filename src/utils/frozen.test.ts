import assert from 'node:assert/strict';
import test from 'node:test';

import { collectionLabel, freezeMessage, frozenBadgeText, frozenNotice, retaFrozenNote, unfreezeMessage } from './frozen';

test('collectionLabel: nome e assunto, ou só o nome', () => {
  assert.equal(collectionLabel({ name: 'Segurança da Informação', subject: 'MFA' }), 'Segurança da Informação · MFA');
  assert.equal(collectionLabel({ name: 'Direito', subject: '' }), 'Direito');
});

test('frozenBadgeText: diz quantos cartões esperam, só quando há', () => {
  assert.equal(frozenBadgeText(0), 'Congelada');
  assert.equal(frozenBadgeText(1), 'Congelada · 1 em espera');
  assert.equal(frozenBadgeText(1200), `Congelada · ${(1200).toLocaleString('pt-BR')} em espera`);
});

test('mensagens: congelar tranquiliza sobre os cartões; descongelar diz quantos voltam, no singular e no plural', () => {
  assert.match(freezeMessage('Direito'), /“Direito” congelada.*os cartões ficam como estão/);
  assert.equal(unfreezeMessage('Direito', 0), '“Direito” descongelada.');
  assert.equal(unfreezeMessage('Direito', 1), '“Direito” descongelada: 1 cartão volta às revisões.');
  assert.equal(unfreezeMessage('Direito', 42), '“Direito” descongelada: 42 cartões voltam às revisões.');
});

test('retaFrozenNote: singular e plural, e diz que não é falta de cartões', () => {
  assert.equal(
    retaFrozenNote(1),
    '1 coleção congelada deste concurso fica de fora da Reta final: ela não entra na prioridade das disciplinas nem na fila do foco. Descongele para incluí-la de volta.',
  );
  assert.match(retaFrozenNote(3), /^3 coleções congeladas deste concurso ficam de fora.*elas não entram.*incluí-las/);
});

test('frozenNotice: a data da congelada e o que isso significa', () => {
  const text = frozenNotice(new Date(2026, 9, 20, 12).toISOString());
  assert.match(text, /Congelada desde 20\/10\/2026/);
  assert.match(text, /nada neles mudou/);
  assert.match(text, /Você ainda pode estudá-la/);
});
