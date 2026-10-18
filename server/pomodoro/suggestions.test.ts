import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { distinctSorted, MAX_SUGGESTIONS, pomodoroSuggestions } from './suggestions';

function build(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE collections (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '');
    CREATE TABLE exams (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT '');
    CREATE TABLE exam_disciplines (id TEXT PRIMARY KEY, exam_id TEXT NOT NULL, name TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0);
    INSERT INTO collections VALUES ('c1', 'u1', 'Redes de Computadores', 'DNS'), ('c2', 'u1', 'redes de computadores', 'Wi-Fi'), ('c3', 'u1', 'Direito', ''), ('cx', 'u2', 'Do outro', 'Alheio');
    INSERT INTO exams VALUES ('e1', 'u1', 'TRANSPETRO', '2026-01-01'), ('ex', 'u2', 'Do outro', '2026-01-01');
    INSERT INTO exam_disciplines VALUES ('d1', 'e1', 'Língua Portuguesa', 0), ('d2', 'e1', 'Conhecimentos Específicos', 1), ('d3', 'e1', 'direito', 2), ('dx', 'ex', 'Alheia', 0);
  `);
  return db;
}

test('sugestões: as disciplinas dos concursos e os nomes das coleções, sem repetir, em ordem, só do usuário', () => {
  const result = pomodoroSuggestions(build(), 'u1');
  assert.deepEqual(result.disciplines, ['Conhecimentos Específicos', 'direito', 'Língua Portuguesa', 'Redes de Computadores']);
  assert.deepEqual(result.subjects, ['DNS', 'Wi-Fi'], 'sem assuntos vazios');
  assert.deepEqual(pomodoroSuggestions(build(), 'u2'), { disciplines: ['Alheia', 'Do outro'], subjects: ['Alheio'] });
  assert.deepEqual(pomodoroSuggestions(build(), 'ninguem'), { disciplines: [], subjects: [] });
});

test('sem repetir por maiúsculas ou acentos (fica a primeira grafia), sem vazios e com espaços arrumados', () => {
  assert.deepEqual(distinctSorted(['  Língua   Portuguesa ', 'LINGUA PORTUGUESA', '', '   ', 'Direito', 'direito']), ['Direito', 'Língua Portuguesa']);
  assert.deepEqual(distinctSorted([]), []);
});

test('há um teto de sugestões', () => {
  const many = Array.from({ length: MAX_SUGGESTIONS + 50 }, (_, i) => `Nome ${String(i).padStart(4, '0')}`);
  const out = distinctSorted(many);
  assert.equal(out.length, MAX_SUGGESTIONS);
  assert.equal(out[0], 'Nome 0000');
  assert.equal(distinctSorted(many, 3).length, 3);
});
