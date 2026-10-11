import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const KEY_PATTERN = /^[a-f0-9]{64}$/;

interface Entry {
  size: number;
  lastUsed: number;
}

/**
 * Cache de áudio em disco: cada fala é gerada uma vez (custa tokens e leva
 * alguns segundos) e reaproveitada nas próximas. Tem tamanho máximo — quando
 * passa dele, apaga primeiro o que foi usado há mais tempo.
 *
 * A chave é um hash (64 hexadecimais) e vira o nome do arquivo; qualquer outra
 * coisa é recusada, então ninguém escapa da pasta por um nome malicioso.
 */
export class AudioCache {
  private readonly index = new Map<string, Entry>();
  private total = 0;

  constructor(
    private readonly dir: string,
    private readonly maxBytes: number,
  ) {
    fs.mkdirSync(dir, { recursive: true });
    for (const name of fs.readdirSync(dir)) {
      const key = name.replace(/\.wav$/, '');
      if (!name.endsWith('.wav') || !KEY_PATTERN.test(key)) continue;
      try {
        const stat = fs.statSync(path.join(dir, name));
        this.index.set(key, { size: stat.size, lastUsed: stat.mtimeMs });
        this.total += stat.size;
      } catch {
        // some entre a listagem e a leitura: ignora
      }
    }
  }

  private file(key: string): string {
    return path.join(this.dir, `${key}.wav`);
  }

  get(key: string): Buffer | null {
    if (!KEY_PATTERN.test(key)) return null;
    const entry = this.index.get(key);
    if (!entry) return null;
    try {
      const data = fs.readFileSync(this.file(key));
      entry.lastUsed = Date.now();
      // Persiste o "uso" no próprio arquivo, para a ordem sobreviver a uma reinicialização.
      const now = new Date();
      fs.utimesSync(this.file(key), now, now);
      return data;
    } catch {
      this.forget(key); // o arquivo foi apagado por fora
      return null;
    }
  }

  set(key: string, data: Buffer): void {
    if (!KEY_PATTERN.test(key) || data.length > this.maxBytes) return;
    this.forget(key);
    // Grava num arquivo temporário e renomeia: uma leitura nunca pega meio arquivo.
    const tmp = `${this.file(key)}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, this.file(key));
    this.index.set(key, { size: data.length, lastUsed: Date.now() });
    this.total += data.length;
    this.evict(key);
  }

  get sizeBytes(): number {
    return this.total;
  }

  get count(): number {
    return this.index.size;
  }

  private forget(key: string): void {
    const entry = this.index.get(key);
    if (!entry) return;
    this.total -= entry.size;
    this.index.delete(key);
    try {
      fs.rmSync(this.file(key), { force: true });
    } catch {
      // já não existia
    }
  }

  /** Apaga os menos usados até caber. Nunca apaga a entrada que acabou de entrar. */
  private evict(protectedKey: string): void {
    if (this.total <= this.maxBytes) return;
    const oldestFirst = [...this.index.entries()]
      .filter(([key]) => key !== protectedKey)
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [key] of oldestFirst) {
      if (this.total <= this.maxBytes) break;
      this.forget(key);
    }
  }
}

/**
 * Fora da pasta do projeto de propósito: ela fica dentro do OneDrive, e centenas
 * de MB de áudio não devem ser sincronizados na nuvem.
 */
export function defaultCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.TTS_CACHE_DIR?.trim()) return env.TTS_CACHE_DIR.trim();
  if (env.LOCALAPPDATA) return path.join(env.LOCALAPPDATA, 'BaseConcurseira', 'tts-cache');
  return path.join(os.homedir(), '.cache', 'base-concurseira', 'tts-cache');
}

export function cacheMaxBytes(env: NodeJS.ProcessEnv = process.env): number {
  const mb = Number(env.TTS_CACHE_MAX_MB);
  return (Number.isFinite(mb) && mb > 0 ? mb : 1024) * 1024 * 1024;
}
