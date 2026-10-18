/**
 * As importações de prova em andamento. Ler um PDF inteiro leva minutos (vários trechos, cada um uma chamada à IA),
 * então o pedido de importação responde na hora com o número do trabalho e o navegador pergunta o andamento até
 * terminar. Ficam só na memória do servidor: se ele reiniciar no meio, a importação se perde e basta refazê-la
 * (nada foi gravado — a prova só é gravada quando o usuário revisa e confirma).
 */
import crypto from 'node:crypto';

import { fail, ok, type Result } from '../mockexams/store';
import type { ExamDraft } from './draft';

export interface Progress {
  /** O que está sendo lido agora, em português para mostrar ao usuário. */
  stage: string;
  done: number;
  total: number;
}

export type JobStatus = 'running' | 'done' | 'error';

export interface ImportJob {
  id: string;
  status: JobStatus;
  progress: Progress;
  draft?: ExamDraft;
  error?: string;
}

interface StoredJob extends ImportJob {
  userId: string;
  startedAt: number;
  finishedAt?: number;
}

/** Um trabalho terminado fica este tempo à espera de ser buscado. */
export const JOB_TTL_MS = 60 * 60 * 1000;
/** Um trabalho que nunca terminou (travou) deixa de bloquear novas importações depois disto. */
export const JOB_MAX_RUNNING_MS = 30 * 60 * 1000;
const MAX_JOBS_PER_USER = 5;

export type Run = (report: (progress: Progress) => void) => Promise<ExamDraft>;

export class JobStore {
  private jobs = new Map<string, StoredJob>();

  constructor(private now: () => number = Date.now) {}

  private sweep(): void {
    const t = this.now();
    for (const [id, job] of this.jobs) {
      const expired = job.finishedAt !== undefined ? t - job.finishedAt > JOB_TTL_MS : t - job.startedAt > JOB_MAX_RUNNING_MS;
      if (expired) this.jobs.delete(id);
    }
  }

  /** Começa uma importação; uma por usuário de cada vez. A execução segue em segundo plano. */
  start(userId: string, run: Run): Result<ImportJob> {
    this.sweep();
    const mine = [...this.jobs.values()].filter((j) => j.userId === userId);
    if (mine.some((j) => j.status === 'running')) {
      return fail(409, 'Já há uma prova sendo lida. Espere terminar para importar outra.');
    }
    // Os mais antigos saem para não acumular rascunhos grandes na memória.
    for (const old of mine.sort((a, b) => a.startedAt - b.startedAt).slice(0, Math.max(0, mine.length - MAX_JOBS_PER_USER + 1))) {
      this.jobs.delete(old.id);
    }

    const job: StoredJob = {
      id: crypto.randomUUID(),
      userId,
      status: 'running',
      progress: { stage: 'Preparando a leitura', done: 0, total: 0 },
      startedAt: this.now(),
    };
    this.jobs.set(job.id, job);

    void (async () => {
      try {
        job.draft = await run((progress) => {
          job.progress = progress;
        });
        job.status = 'done';
      } catch (err) {
        job.status = 'error';
        job.error = err instanceof Error ? err.message : 'Não foi possível ler a prova.';
      } finally {
        job.finishedAt = this.now();
      }
    })();

    return ok(this.view(job));
  }

  get(userId: string, id: string): Result<ImportJob> {
    this.sweep();
    const job = this.jobs.get(id);
    if (!job || job.userId !== userId) return fail(404, 'Importação não encontrada. Ela pode ter expirado: envie o PDF de novo.');
    return ok(this.view(job));
  }

  /** Descarta o rascunho depois de salvo ou abandonado. */
  discard(userId: string, id: string): void {
    const job = this.jobs.get(id);
    if (job && job.userId === userId && job.status !== 'running') this.jobs.delete(id);
  }

  private view(job: StoredJob): ImportJob {
    return {
      id: job.id,
      status: job.status,
      progress: { ...job.progress },
      ...(job.draft ? { draft: job.draft } : {}),
      ...(job.error ? { error: job.error } : {}),
    };
  }
}
