import fs from 'node:fs';
import path from 'node:path';
import { backup } from 'node:sqlite';

import { db } from './db';

const BACKUP_DIR = path.join(process.cwd(), 'backups');
const MAX_BACKUPS = 14;
const INTERVAL_MS = 6 * 60 * 60 * 1000;

function timestampedFilename(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `app-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.db`;
}

function pruneOldBackups() {
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.db'))
    .map((f) => ({ name: f, mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  for (const file of files.slice(MAX_BACKUPS)) {
    fs.unlinkSync(path.join(BACKUP_DIR, file.name));
  }
}

/**
 * Usa a API nativa de backup do SQLite (não uma cópia de arquivo) — ela
 * produz um snapshot consistente mesmo com o banco aberto e em uso pelo
 * servidor, coisa que copiar app.db/-wal/-shm manualmente não garante.
 */
export async function runBackup(): Promise<void> {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const dest = path.join(BACKUP_DIR, timestampedFilename());
  try {
    const pages = await backup(db, dest);
    pruneOldBackups();
    console.log(`  ✓ Backup do banco criado: ${dest} (${pages} páginas)`);
  } catch (err) {
    console.error('  ✗ Falha ao criar backup do banco:', err);
  }
}

export function startBackupSchedule(): void {
  void runBackup();
  setInterval(() => void runBackup(), INTERVAL_MS);
}
