import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { backupsToKeep, backupTime, DAILY_BACKUP_DAYS, pruneBackupDir, RECENT_BACKUPS } from './backupRetention';

const NOW = new Date(2026, 9, 17, 21, 0, 0); // 17/10/2026, 21h (hora local)

/** O nome que o app dá a um backup feito em dia/hora locais. */
function name(year: number, month: number, day: number, hour = 12, minute = 0, second = 0): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `app-${year}${p(month)}${p(day)}-${p(hour)}${p(minute)}${p(second)}.db`;
}

test('nome: lê a data e a hora; o que não é backup, ou tem data impossível, dá null', () => {
  const t = backupTime('app-20261017-193608.db')!;
  assert.deepEqual([t.getFullYear(), t.getMonth(), t.getDate(), t.getHours(), t.getMinutes(), t.getSeconds()], [2026, 9, 17, 19, 36, 8]);
  for (const bad of ['app.db', 'app-20261017-193608.db-wal', 'app-20261017-193608.db-shm', 'x-app-20261017-193608.db', 'app-20261301-000000.db', 'app-20260231-000000.db', 'app-20261017-250000.db', 'leia-me.txt']) {
    assert.equal(backupTime(bad), null, bad);
  }
});

test('poucos backups: todos ficam', () => {
  const names = [name(2026, 10, 17, 1), name(2026, 10, 17, 7), name(2026, 10, 16, 20)];
  assert.deepEqual([...backupsToKeep(names, NOW)].sort(), [...names].sort());
  assert.equal(backupsToKeep([], NOW).size, 0);
});

test('o problema de antes: 30 backups no mesmo dia deixam só os 14 mais novos (e nenhum mais antigo por perto)', () => {
  const sameDay = Array.from({ length: 30 }, (_, i) => name(2026, 10, 17, 0, i));
  const keep = backupsToKeep(sameDay, NOW);
  assert.equal(keep.size, RECENT_BACKUPS);
  assert.ok(keep.has(name(2026, 10, 17, 0, 29)) && keep.has(name(2026, 10, 17, 0, 16)));
  assert.ok(!keep.has(name(2026, 10, 17, 0, 15)));
});

test('além dos 14 mais novos, fica o último de cada dia dos últimos 30', () => {
  // 20 backups no dia 17 (de 00h a 19h) e dois por dia nos 40 dias anteriores (de manhã e à noite)
  const names = Array.from({ length: 20 }, (_, i) => name(2026, 10, 17, i, 30));
  for (let back = 1; back <= 40; back++) {
    const d = new Date(2026, 9, 17 - back);
    names.push(name(d.getFullYear(), d.getMonth() + 1, d.getDate(), 8), name(d.getFullYear(), d.getMonth() + 1, d.getDate(), 20));
  }
  const keep = backupsToKeep(names, NOW);

  // os 14 mais novos: de 06h30 a 19h30 do dia 17; e o último do dia 17 é o de 19h30, que já está entre eles
  assert.ok(keep.has(name(2026, 10, 17, 19, 30)) && keep.has(name(2026, 10, 17, 6, 30)));
  assert.ok(!keep.has(name(2026, 10, 17, 5, 30)), 'dos do dia 17 só ficam os 14 mais novos');
  // dias anteriores (1 a 29 dias atrás): só o da noite
  for (let back = 1; back <= DAILY_BACKUP_DAYS - 1; back++) {
    const d = new Date(2026, 9, 17 - back);
    assert.ok(keep.has(name(d.getFullYear(), d.getMonth() + 1, d.getDate(), 20)), `noite de ${back} dia(s) atrás`);
    assert.ok(!keep.has(name(d.getFullYear(), d.getMonth() + 1, d.getDate(), 8)), `manhã de ${back} dia(s) atrás`);
  }
  // 30 dias atrás ou mais: nada
  for (let back = DAILY_BACKUP_DAYS; back <= 40; back++) {
    const d = new Date(2026, 9, 17 - back);
    assert.ok(!keep.has(name(d.getFullYear(), d.getMonth() + 1, d.getDate(), 20)), `${back} dias atrás`);
  }
  assert.equal(keep.size, RECENT_BACKUPS + (DAILY_BACKUP_DAYS - 1));
});

test('um dia sem nenhum backup não deixa buraco nem tira nada dos outros', () => {
  const names = [name(2026, 10, 17, 12), name(2026, 10, 10, 9), name(2026, 9, 25, 9), name(2026, 9, 10, 9)];
  const keep = backupsToKeep(names, NOW, { recent: 1 });
  assert.deepEqual([...keep].sort(), [name(2026, 9, 25, 9), name(2026, 10, 10, 9), name(2026, 10, 17, 12)].sort(), '10/09 tem 37 dias: sai');
});

test('virada de mês e de ano: a idade conta dias de calendário', () => {
  const now = new Date(2027, 0, 5, 10);
  const names = [name(2027, 1, 4, 23, 59), name(2026, 12, 7, 12), name(2026, 12, 6, 12)];
  const keep = backupsToKeep(names, now, { recent: 0 });
  assert.ok(keep.has(name(2027, 1, 4, 23, 59)), 'ontem, a poucos minutos de distância no relógio mas de outro dia');
  assert.ok(keep.has(name(2026, 12, 7, 12)), '29 dias atrás (cruzando o ano) ainda fica');
  assert.ok(!keep.has(name(2026, 12, 6, 12)), '30 dias atrás já não');
});

test('o desempate é estável: a mesma lista, em qualquer ordem, dá o mesmo resultado', () => {
  const names = Array.from({ length: 25 }, (_, i) => name(2026, 10, 1 + (i % 17), i % 24, i));
  const forward = [...backupsToKeep(names, NOW)].sort();
  const backward = [...backupsToKeep([...names].reverse(), NOW)].sort();
  assert.deepEqual(forward, backward);
});

test('arquivos que não são backups nunca entram na conta (e nem ocupam vaga dos 14)', () => {
  const stray = ['app.db', 'app-20260825-020225.db-wal', 'app-20260825-020225.db-shm', 'leia-me.txt'];
  const backups = Array.from({ length: 14 }, (_, i) => name(2026, 10, 17, i));
  const keep = backupsToKeep([...stray, ...backups], NOW);
  assert.equal(keep.size, 14);
  assert.ok(stray.every((s) => !keep.has(s)));
});

test('apaga na pasta só os backups que não ficam, e deixa os outros arquivos', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backups-test-'));
  try {
    const write = (n: string) => fs.writeFileSync(path.join(dir, n), n);
    const old = name(2026, 7, 1, 8); // bem mais de 30 dias
    const noon = name(2026, 10, 3, 12);
    const evening = name(2026, 10, 3, 20);
    const recent = Array.from({ length: 14 }, (_, i) => name(2026, 10, 17, i + 1));
    const others = ['app.db', 'app-20260825-020225.db-wal', 'anotacoes.txt'];
    for (const n of [old, noon, evening, ...recent, ...others]) write(n);

    const removed = pruneBackupDir(dir, NOW);
    assert.deepEqual(removed.sort(), [noon, old].sort());
    assert.deepEqual(fs.readdirSync(dir).sort(), [evening, ...recent, ...others].sort());

    assert.deepEqual(pruneBackupDir(dir, NOW), [], 'rodar de novo não apaga mais nada');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('pasta que não existe: o erro sobe (quem chama já criou a pasta)', () => {
  assert.throws(() => pruneBackupDir(path.join(os.tmpdir(), 'nao-existe-backups-xyz')));
});
