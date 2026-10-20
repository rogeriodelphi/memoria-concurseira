import assert from 'node:assert/strict';
import test from 'node:test';

import type { ExamOption } from '../types';
import { daysLeftShort, examOptionLabel, FOCUS_EXAM_KEY, readFocusExam, saveFocusExam, type KeyValueStorage } from './focusExam';

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

const throwing: KeyValueStorage = {
  getItem: () => {
    throw new Error('bloqueado');
  },
  setItem: () => {
    throw new Error('bloqueado');
  },
  removeItem: () => {
    throw new Error('bloqueado');
  },
};

test('a escolha vai e volta pelo armazenamento, e apagar a desfaz', () => {
  const storage = memoryStorage();
  assert.equal(readFocusExam(storage), undefined);
  saveFocusExam('ufba-1', storage);
  assert.equal(storage.data.get(FOCUS_EXAM_KEY), 'ufba-1');
  assert.equal(readFocusExam(storage), 'ufba-1');
  saveFocusExam('transpetro-2', storage);
  assert.equal(readFocusExam(storage), 'transpetro-2', 'escolher de novo troca');
  saveFocusExam(undefined, storage);
  assert.equal(readFocusExam(storage), undefined);
  assert.equal(storage.data.size, 0);
});

test('um valor guardado vazio ou comprido demais não vale', () => {
  assert.equal(readFocusExam(memoryStorage({ [FOCUS_EXAM_KEY]: '' })), undefined);
  assert.equal(readFocusExam(memoryStorage({ [FOCUS_EXAM_KEY]: 'x'.repeat(65) })), undefined);
  assert.equal(readFocusExam(memoryStorage({ [FOCUS_EXAM_KEY]: 'x'.repeat(64) })), 'x'.repeat(64));
});

test('sem armazenamento (janela privada, dados bloqueados) nada lança e não há escolha', () => {
  assert.equal(readFocusExam(throwing), undefined);
  assert.doesNotThrow(() => saveFocusExam('abc', throwing));
  assert.doesNotThrow(() => saveFocusExam(undefined, throwing));
  assert.equal(readFocusExam(null), undefined);
  assert.doesNotThrow(() => saveFocusExam('abc', null));
});

test('daysLeftShort: o quanto falta, em poucas palavras', () => {
  assert.equal(daysLeftShort(null), 'sem data');
  assert.equal(daysLeftShort(-3), 'já passou');
  assert.equal(daysLeftShort(0), 'hoje');
  assert.equal(daysLeftShort(1), 'amanhã');
  assert.equal(daysLeftShort(95), 'faltam 95 dias');
});

test('examOptionLabel: nome, cargo (se houver) e a data com os dias', () => {
  const ufba: ExamOption = { id: 'u', name: 'UFBA', position: 'Analista de TI', examDate: '2027-01-20', daysLeft: 95 };
  assert.equal(examOptionLabel(ufba), 'UFBA · Analista de TI · 20/01/2027 (faltam 95 dias)');
  assert.equal(examOptionLabel({ ...ufba, position: '   ' }), 'UFBA · 20/01/2027 (faltam 95 dias)');
  assert.equal(examOptionLabel({ ...ufba, examDate: null, daysLeft: null }), 'UFBA · Analista de TI · sem data');
  assert.equal(examOptionLabel({ ...ufba, examDate: '2026-10-01', daysLeft: -18 }), 'UFBA · Analista de TI · 01/10/2026 (já passou)');
});
