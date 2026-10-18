import assert from 'node:assert/strict';
import test from 'node:test';

import type { ExamDraft } from './draft';
import { JOB_MAX_RUNNING_MS, JOB_TTL_MS, JobStore } from './jobs';

const DRAFT: ExamDraft = { meta: { name: 'P', board: '', organ: '', year: null, position: '', level: '' }, questions: [], warnings: [] };

/** Uma tarefa que só termina quando o teste manda. */
function manual() {
  let finish!: (draft: ExamDraft) => void;
  let crash!: (error: Error) => void;
  const promise = new Promise<ExamDraft>((resolve, reject) => {
    finish = resolve;
    crash = reject;
  });
  return { run: () => promise, finish, crash };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

function view(store: JobStore, userId: string, id: string) {
  const result = store.get(userId, id);
  assert.ok(result.ok, result.ok ? '' : result.error);
  return result.value;
}

test('importação: começa rodando, mostra o andamento e termina com o rascunho', async () => {
  const store = new JobStore();
  const task = manual();
  let report!: (p: { stage: string; done: number; total: number }) => void;
  const started = store.start('u1', (r) => {
    report = r;
    return task.run();
  });
  assert.ok(started.ok);
  assert.equal(started.value.status, 'running');
  await tick();

  report({ stage: 'Lendo a prova', done: 2, total: 5 });
  assert.deepEqual(view(store, 'u1', started.value.id).progress, { stage: 'Lendo a prova', done: 2, total: 5 });

  task.finish(DRAFT);
  await tick();
  const done = view(store, 'u1', started.value.id);
  assert.equal(done.status, 'done');
  assert.deepEqual(done.draft, DRAFT);
});

test('importação: erro vira status de erro com a mensagem', async () => {
  const store = new JobStore();
  const task = manual();
  const started = store.start('u1', task.run);
  assert.ok(started.ok);
  task.crash(new Error('Sem crédito na IA.'));
  await tick();
  const job = view(store, 'u1', started.value.id);
  assert.equal(job.status, 'error');
  assert.equal(job.error, 'Sem crédito na IA.');
  assert.equal(job.draft, undefined);
});

test('importação: uma por vez por usuário, mas outro usuário não é afetado; terminada, libera a próxima', async () => {
  const store = new JobStore();
  const first = manual();
  assert.ok(store.start('u1', first.run).ok);
  const blocked = store.start('u1', manual().run);
  assert.ok(!blocked.ok);
  assert.equal(blocked.status, 409);
  assert.ok(store.start('u2', manual().run).ok);

  first.finish(DRAFT);
  await tick();
  assert.ok(store.start('u1', manual().run).ok);
});

test('importação: só o dono vê o trabalho', async () => {
  const store = new JobStore();
  const started = store.start('u1', async () => DRAFT);
  assert.ok(started.ok);
  await tick();
  const other = store.get('u2', started.value.id);
  assert.ok(!other.ok);
  assert.equal(other.status, 404);
  assert.ok(!store.get('u1', 'inexistente').ok);
});

test('importação: terminada some depois do prazo; travada deixa de bloquear', async () => {
  let now = 1_000_000;
  const store = new JobStore(() => now);
  const started = store.start('u1', async () => DRAFT);
  assert.ok(started.ok);
  await tick();
  now += JOB_TTL_MS + 1;
  assert.ok(!store.get('u1', started.value.id).ok, 'expirou');

  const stuck = manual();
  assert.ok(store.start('u1', stuck.run).ok);
  assert.ok(!store.start('u1', manual().run).ok);
  now += JOB_MAX_RUNNING_MS + 1;
  assert.ok(store.start('u1', manual().run).ok, 'o travado não bloqueia para sempre');
});

test('importação: descartar tira o rascunho, mas não mexe no que ainda roda nem no de outro usuário', async () => {
  const store = new JobStore();
  const done = store.start('u1', async () => DRAFT);
  assert.ok(done.ok);
  await tick();
  store.discard('u2', done.value.id);
  assert.ok(store.get('u1', done.value.id).ok);
  store.discard('u1', done.value.id);
  assert.ok(!store.get('u1', done.value.id).ok);

  const running = manual();
  const started = store.start('u1', running.run);
  assert.ok(started.ok);
  store.discard('u1', started.value.id);
  assert.ok(store.get('u1', started.value.id).ok, 'em andamento não se descarta');
});

test('importação: não acumula rascunhos antigos sem limite', async () => {
  const store = new JobStore();
  const ids: string[] = [];
  for (let i = 0; i < 8; i++) {
    const started = store.start('u1', async () => DRAFT);
    assert.ok(started.ok);
    ids.push(started.value.id);
    await tick();
  }
  const alive = ids.filter((id) => store.get('u1', id).ok);
  assert.ok(alive.length <= 5, `${alive.length} guardados`);
  assert.ok(alive.includes(ids[7]), 'o mais recente fica');
});
