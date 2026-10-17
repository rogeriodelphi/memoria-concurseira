import assert from 'node:assert/strict';
import test, { after } from 'node:test';

import { isolateDatabase } from '../ai/fakeAnthropic';

// Importar o banco abre `data/app.db` no diretório atual: isolado num diretório temporário, com o
// esquema de verdade (o mesmo do app), para a exportação ser testada contra as tabelas reais.
const restoreCwd = isolateDatabase();
const { db } = await import('../db');
const { buildAccountExport, EXCLUDED_TABLES, EXPORTED_TABLES, EXPORT_FORMAT, exportFilename } = await import('./export');

after(async () => {
  await restoreCwd();
});

const NOW = '2026-10-17T12:00:00.000Z';
const A_HASH = 'hash-secreto-da-conta-a';
const B_HASH = 'hash-secreto-da-conta-b';

function run(sql: string, ...params: (string | number | null)[]) {
  db.prepare(sql).run(...params);
}

/** Uma conta com um pouco de tudo: o que a exportação precisa achar, tabela por tabela. */
function seedAccount(u: string, hash: string) {
  run('INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)', u, `Nome ${u}`, `${u}@teste.local`, hash, NOW);
  run('INSERT INTO collections (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', `${u}-col`, u, `Coleção ${u}`, NOW, NOW);
  run('INSERT INTO documents (id, collection_id, filename, size, created_at) VALUES (?, ?, ?, ?, ?)', `${u}-doc`, `${u}-col`, 'a.pdf', 10, NOW);
  run('INSERT INTO flashcards (id, collection_id, question, answer, created_at) VALUES (?, ?, ?, ?, ?)', `${u}-f1`, `${u}-col`, `P ${u}`, `R ${u}`, NOW);
  run('INSERT INTO flashcards (id, collection_id, question, answer, created_at) VALUES (?, ?, ?, ?, ?)', `${u}-f2`, `${u}-col`, `P2 ${u}`, `R2 ${u}`, NOW);
  run('INSERT INTO card_choices (flashcard_id, source_hash, correct, wrong_json, created_at) VALUES (?, ?, ?, ?, ?)', `${u}-f1`, 'h', 'certa', '["a","b","c"]', NOW);
  run('INSERT INTO study_sessions (id, flashcard_id, user_id, result, studied_at) VALUES (?, ?, ?, ?, ?)', `${u}-s1`, `${u}-f1`, u, 'bom', NOW);
  run('INSERT INTO summaries (id, user_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', `${u}-sum`, u, 'T', 'C', NOW, NOW);
  run('INSERT INTO bullet_points (id, user_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', `${u}-bp`, u, 'T', '[]', NOW, NOW);
  run('INSERT INTO mind_maps (id, user_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', `${u}-mm`, u, 'T', '{}', NOW, NOW);
  run('INSERT INTO exams (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', `${u}-ex`, u, 'Concurso', NOW, NOW);
  run('INSERT INTO exam_disciplines (id, exam_id, name, position) VALUES (?, ?, ?, ?)', `${u}-d`, `${u}-ex`, 'Disc', 0);
  run('INSERT INTO exam_topics (id, discipline_id, title, position) VALUES (?, ?, ?, ?)', `${u}-t`, `${u}-d`, 'Topico', 0);
  run('INSERT INTO exam_topic_collections (topic_id, collection_id) VALUES (?, ?)', `${u}-t`, `${u}-col`);
  run('INSERT INTO mock_exams (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', `${u}-me`, u, 'Simulado', NOW, NOW);
  run('INSERT INTO mock_exam_cards (mock_exam_id, flashcard_id, added_at) VALUES (?, ?, ?)', `${u}-me`, `${u}-f1`, NOW);
  run('INSERT INTO mock_exam_attempts (id, mock_exam_id, user_id, finished_at, duration_ms, total, correct) VALUES (?, ?, ?, ?, ?, ?, ?)', `${u}-at`, `${u}-me`, u, NOW, 1000, 1, 1);
  run('INSERT INTO mock_exam_answers (attempt_id, flashcard_id, correct) VALUES (?, ?, ?)', `${u}-at`, `${u}-f1`, 1);
  run('INSERT INTO pomodoro_tasks (id, user_id, mode, duration_sec, started_at, ended_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', `${u}-pt`, u, 'foco', 1500, NOW, NOW, NOW);
  run('INSERT INTO pomodoro_notes (user_id, note_date, text, updated_at) VALUES (?, ?, ?, ?)', u, '2026-10-17', 'nota', NOW);
  run('INSERT INTO ai_usage (id, user_id, provider, feature, created_at) VALUES (?, ?, ?, ?, ?)', `${u}-ai`, u, 'gemini', 'flashcards', NOW);
}

seedAccount('A', A_HASH);
seedAccount('B', B_HASH);

const ids = (rows: Record<string, unknown>[], column: string) => rows.map((r) => String(r[column])).sort();

test('exportação: traz as linhas da conta, tabela por tabela, e só elas', () => {
  const data = buildAccountExport(db, 'A', new Date(NOW))!;
  assert.ok(data);
  assert.equal(data.formato, EXPORT_FORMAT);
  assert.equal(data.exportadoEm, NOW);

  const t = data.tabelas;
  assert.deepEqual(ids(t.collections, 'id'), ['A-col']);
  assert.deepEqual(ids(t.documents, 'id'), ['A-doc']);
  assert.deepEqual(ids(t.flashcards, 'id'), ['A-f1', 'A-f2']);
  assert.deepEqual(ids(t.card_choices, 'flashcard_id'), ['A-f1']);
  assert.deepEqual(ids(t.study_sessions, 'id'), ['A-s1']);
  assert.deepEqual(ids(t.summaries, 'id'), ['A-sum']);
  assert.deepEqual(ids(t.bullet_points, 'id'), ['A-bp']);
  assert.deepEqual(ids(t.mind_maps, 'id'), ['A-mm']);
  assert.deepEqual(ids(t.exams, 'id'), ['A-ex']);
  assert.deepEqual(ids(t.exam_disciplines, 'id'), ['A-d']);
  assert.deepEqual(ids(t.exam_topics, 'id'), ['A-t']);
  assert.deepEqual(ids(t.exam_topic_collections, 'topic_id'), ['A-t']);
  assert.deepEqual(ids(t.mock_exams, 'id'), ['A-me']);
  assert.deepEqual(ids(t.mock_exam_cards, 'flashcard_id'), ['A-f1']);
  assert.deepEqual(ids(t.mock_exam_attempts, 'id'), ['A-at']);
  assert.deepEqual(ids(t.mock_exam_answers, 'attempt_id'), ['A-at']);
  assert.deepEqual(ids(t.pomodoro_tasks, 'id'), ['A-pt']);
  assert.deepEqual(ids(t.pomodoro_notes, 'user_id'), ['A']);
  assert.deepEqual(ids(t.ai_usage, 'id'), ['A-ai']);
});

test('exportação: nada da outra conta aparece em lugar nenhum, nem escondido em outro campo', () => {
  const asText = JSON.stringify(buildAccountExport(db, 'A', new Date(NOW)));
  assert.ok(!asText.includes('B-'), 'nenhum id da conta B');
  assert.ok(!asText.includes('Nome B'));
  assert.ok(!asText.includes('B@teste.local'));
  assert.ok(!asText.includes(B_HASH));

  // E o inverso: a conta B também só recebe o que é dela.
  const forB = JSON.stringify(buildAccountExport(db, 'B', new Date(NOW)));
  assert.ok(!forB.includes('A-') && !forB.includes('Nome A') && !forB.includes(A_HASH));
});

test('exportação: a senha nunca sai, e o perfil traz só o que é do usuário', () => {
  const data = buildAccountExport(db, 'A', new Date(NOW))!;
  assert.ok(!JSON.stringify(data).includes(A_HASH), 'nem o hash da própria conta');
  assert.ok(!('password_hash' in data.usuario));
  assert.deepEqual(Object.keys(data.usuario).sort(), ['created_at', 'daily_new_limit', 'email', 'id', 'monthly_token_budget', 'name']);
  assert.equal(data.usuario.email, 'A@teste.local');
});

test('exportação: as contagens batem com as linhas', () => {
  const data = buildAccountExport(db, 'A', new Date(NOW))!;
  for (const [table, rows] of Object.entries(data.tabelas)) assert.equal(data.contagens[table], rows.length, table);
  assert.equal(data.contagens.flashcards, 2);
});

test('exportação: conta sem nada exporta tabelas vazias; conta que não existe dá nulo', () => {
  run('INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)', 'C', 'Nome C', 'C@teste.local', 'x', NOW);
  const empty = buildAccountExport(db, 'C', new Date(NOW))!;
  assert.ok(Object.values(empty.contagens).every((n) => n === 0));
  assert.equal(Object.keys(empty.tabelas).length, EXPORTED_TABLES.length);
  assert.equal(buildAccountExport(db, 'nao-existe', new Date(NOW)), null);
});

test('exportação: as linhas saem como estão no banco, e o arquivo é JSON válido que volta igual', () => {
  const data = buildAccountExport(db, 'A', new Date(NOW))!;
  const card = data.tabelas.flashcards.find((r) => r.id === 'A-f1')!;
  assert.equal(card.question, 'P A');
  assert.equal(card.collection_id, 'A-col');
  assert.equal(card.favorite, 0, 'colunas com valor padrão também saem');
  // O que o navegador baixa é este JSON: lido de volta, tem que ser idêntico ao que foi montado.
  assert.deepEqual(JSON.parse(JSON.stringify(data)), data);
});

test('completude: toda tabela do banco é exportada ou está na lista de exclusões com o motivo', () => {
  const inDb = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((r) => r.name);
  const classified = new Set([...EXPORTED_TABLES, ...Object.keys(EXCLUDED_TABLES)]);
  const missing = inDb.filter((name) => !classified.has(name));
  assert.deepEqual(missing, [], `tabela nova sem classificar em server/account/export.ts: ${missing.join(', ')}`);
  for (const name of [...EXPORTED_TABLES, ...Object.keys(EXCLUDED_TABLES)]) {
    assert.ok(inDb.includes(name), `${name} está na lista mas não existe no banco`);
  }
  for (const [name, reason] of Object.entries(EXCLUDED_TABLES)) assert.ok(reason.length > 10, `${name}: diga o motivo`);
  assert.ok(!EXPORTED_TABLES.includes('users') && !EXPORTED_TABLES.includes('ai_provider_status'));
});

test('nome do arquivo: tem a data', () => {
  assert.equal(exportFilename(new Date('2026-10-17T23:59:59Z')), 'memoria-concurseira-2026-10-17.json');
});
