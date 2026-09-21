import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';

import { db } from '../db';

export type AiFeature = 'flashcards' | 'summary' | 'bulletpoints' | 'mindmap' | 'transcription';
export type AiProvider = 'gemini' | 'openai';
export type ProviderStatus = 'ok' | 'quota_exhausted' | 'no_credits' | 'rate_limited' | 'invalid_key' | 'unavailable';

interface UsageContext {
  userId: string;
  feature: AiFeature;
}

// As chamadas às APIs de IA moram bem fundo (gemini.ts/openai.ts) e não
// sabem quem as pediu nem pra qual funcionalidade. Em vez de passar userId e
// feature por todas as funções de geração, a rota abre um contexto e o
// registro de uso lê dele — quem chama a IA fora de um contexto (ex.: um
// script) simplesmente não registra nada.
const storage = new AsyncLocalStorage<UsageContext>();

export function withUsageContext<T>(ctx: UsageContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

// Nenhuma das duas funções abaixo pode lançar erro: elas rodam no meio de
// uma geração que já deu certo (ou já falhou por outro motivo), e um problema
// de contabilidade não deve derrubar a resposta ao usuário.
export function recordUsage(provider: AiProvider, tokens: { input: number; output: number; total: number }): void {
  const ctx = storage.getStore();
  if (!ctx) return;
  try {
    db.prepare(
      'INSERT INTO ai_usage (id, user_id, provider, feature, input_tokens, output_tokens, total_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      crypto.randomUUID(),
      ctx.userId,
      provider,
      ctx.feature,
      tokens.input,
      tokens.output,
      tokens.total,
      new Date().toISOString(),
    );
  } catch (err) {
    console.error('Falha ao registrar uso de IA:', err);
  }
}

export function reportProviderOutcome(provider: AiProvider, status: ProviderStatus): void {
  try {
    db.prepare(
      `INSERT INTO ai_provider_status (provider, status, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(provider) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`,
    ).run(provider, status, new Date().toISOString());
  } catch (err) {
    console.error('Falha ao registrar status do provedor de IA:', err);
  }
}
