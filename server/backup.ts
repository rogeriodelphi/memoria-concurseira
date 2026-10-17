import fs from 'node:fs';
import path from 'node:path';
import { backup } from 'node:sqlite';

import { db } from './db';
import { pruneBackupDir } from './backupRetention';

const BACKUP_DIR = path.join(process.cwd(), 'backups');
const INTERVAL_MS = 6 * 60 * 60 * 1000;

function timestampedFilename(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `app-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.db`;
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
    const removed = pruneBackupDir(BACKUP_DIR);
    if (removed.length > 0) console.log(`  ✓ ${removed.length} backup(s) antigo(s) apagado(s)`);
    console.log(`  ✓ Backup do banco criado: ${dest} (${pages} páginas)`);
  } catch (err) {
    console.error('  ✗ Falha ao criar backup do banco:', err);
  }
}

export function startBackupSchedule(): void {
  void runBackup();
  setInterval(() => void runBackup(), INTERVAL_MS);
}
