/**
 * Quais backups ficam. Só os 14 mais recentes não bastam: cada vez que o servidor sobe (um deploy, o PC
 * reiniciando) sai um backup novo, e num dia movimentado os 14 caem todos no mesmo dia ou dois, de modo
 * que um problema notado uma semana depois já não teria de onde voltar. Por isso, além dos mais recentes,
 * fica o último backup de cada um dos últimos 30 dias.
 *
 * Só se mexe em arquivos com o nome que o próprio app dá (`app-AAAAMMDD-HHMMSS.db`): qualquer outro
 * arquivo que esteja na pasta é deixado em paz.
 */
import fs from 'node:fs';
import path from 'node:path';

export const RECENT_BACKUPS = 14;
export const DAILY_BACKUP_DAYS = 30;

const BACKUP_NAME = /^app-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.db$/;

/** O instante do backup, lido do nome (hora local, como o nome é escrito); `null` se o nome não é de backup ou a data não existe. */
export function backupTime(name: string): Date | null {
  const m = BACKUP_NAME.exec(name);
  if (!m) return null;
  const [year, month, day, hour, minute, second] = m.slice(1).map(Number);
  const date = new Date(year, month - 1, day, hour, minute, second);
  const valid =
    date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day && date.getHours() === hour;
  return valid ? date : null;
}

/** Dias de calendário (no horário local) de `from` até `to`; o horário de verão não vira 23h/25h. */
function calendarDaysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / 86_400_000);
}

/**
 * Dos backups que a lista tem, os que ficam: os `recent` mais novos e o último de cada um dos
 * últimos `dailyDays` dias (hoje e os anteriores). Nomes que não são de backup nunca entram aqui.
 */
export function backupsToKeep(
  names: string[],
  now: Date,
  options: { recent?: number; dailyDays?: number } = {},
): Set<string> {
  const recent = options.recent ?? RECENT_BACKUPS;
  const dailyDays = options.dailyDays ?? DAILY_BACKUP_DAYS;

  const backups = names
    .map((name) => ({ name, time: backupTime(name) }))
    .filter((b): b is { name: string; time: Date } => b.time !== null)
    // do mais novo para o mais antigo; o nome desempata, para o resultado ser sempre o mesmo
    .sort((a, b) => b.time.getTime() - a.time.getTime() || b.name.localeCompare(a.name));

  const keep = new Set(backups.slice(0, Math.max(0, recent)).map((b) => b.name));
  const seenDays = new Set<string>();
  for (const { name, time } of backups) {
    const day = `${time.getFullYear()}-${time.getMonth()}-${time.getDate()}`;
    if (seenDays.has(day)) continue; // o primeiro de cada dia, na ordem acima, é o mais novo dele
    seenDays.add(day);
    const age = calendarDaysBetween(time, now);
    if (age >= 0 && age < dailyDays) keep.add(name);
  }
  return keep;
}

/** Apaga, na pasta, os backups que não ficam. Devolve os nomes apagados. Um arquivo que não dá para apagar não impede os outros. */
export function pruneBackupDir(dir: string, now: Date = new Date()): string[] {
  const names = fs.readdirSync(dir);
  const keep = backupsToKeep(names, now);
  const removed: string[] = [];
  for (const name of names) {
    if (backupTime(name) === null || keep.has(name)) continue;
    try {
      fs.unlinkSync(path.join(dir, name));
      removed.push(name);
    } catch (err) {
      console.error(`  ✗ Não consegui apagar o backup antigo ${name}:`, err);
    }
  }
  return removed;
}
