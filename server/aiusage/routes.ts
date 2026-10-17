import express, { type Response } from 'express';

import { db } from '../db';
import { requireAuth, type AuthedRequest } from '../auth/middleware';
import { hasClaude } from '../ai/claude';
import { hasGemini } from '../ai/gemini';
import { hasOpenAI } from '../ai/openai';
import type { AiFeature, AiProvider, ProviderStatus } from '../ai/usage';

export const aiUsageRouter = express.Router();
aiUsageRouter.use(requireAuth);

const FEATURES: AiFeature[] = ['flashcards', 'summary', 'bulletpoints', 'mindmap', 'transcription', 'exam', 'tts', 'choices'];
const PROVIDERS: AiProvider[] = ['gemini', 'openai', 'claude'];
const MAX_BUDGET = 1_000_000_000_000;

interface Totals {
  tokens: number;
  requests: number;
}

// Dia e mês são contados no fuso do servidor — que, rodando na máquina do
// próprio usuário, é o fuso dele. created_at é ISO (UTC), então comparar como
// texto com o início do período convertido pra ISO funciona.
function periodStarts(): { day: string; month: string } {
  const now = new Date();
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const month = new Date(now.getFullYear(), now.getMonth(), 1);
  return { day: day.toISOString(), month: month.toISOString() };
}

function totalsSince(userId: string, since: string): Totals {
  return db
    .prepare(
      'SELECT COALESCE(SUM(total_tokens), 0) AS tokens, COUNT(*) AS requests FROM ai_usage WHERE user_id = ? AND created_at >= ?',
    )
    .get(userId, since) as unknown as Totals;
}

function groupedSince(userId: string, since: string, column: 'feature' | 'provider'): Map<string, Totals> {
  const rows = db
    .prepare(
      `SELECT ${column} AS key, COALESCE(SUM(total_tokens), 0) AS tokens, COUNT(*) AS requests
       FROM ai_usage WHERE user_id = ? AND created_at >= ? GROUP BY ${column}`,
    )
    .all(userId, since) as unknown as { key: string; tokens: number; requests: number }[];
  return new Map(rows.map((r) => [r.key, { tokens: r.tokens, requests: r.requests }]));
}

aiUsageRouter.get('/', (req: AuthedRequest, res: Response) => {
  const userId = req.userId!;
  const { day, month } = periodStarts();

  const today = totalsSince(userId, day);
  const monthTotals = totalsSince(userId, month);

  const byFeatureMap = groupedSince(userId, month, 'feature');
  const byProviderMap = groupedSince(userId, month, 'provider');

  const budgetRow = db.prepare('SELECT monthly_token_budget AS budget FROM users WHERE id = ?').get(userId) as unknown as
    | { budget: number | null }
    | undefined;
  const budget = budgetRow?.budget ?? null;

  const statusRows = db
    .prepare('SELECT provider, status, updated_at FROM ai_provider_status')
    .all() as unknown as { provider: string; status: ProviderStatus; updated_at: string }[];
  const statusByProvider = new Map(statusRows.map((r) => [r.provider, r]));
  const configured: Record<AiProvider, boolean> = { gemini: hasGemini(), openai: hasOpenAI(), claude: hasClaude() };

  res.json({
    success: true,
    today,
    month: monthTotals,
    budget,
    remaining: budget === null ? null : Math.max(budget - monthTotals.tokens, 0),
    byFeature: FEATURES.map((feature) => ({ feature, ...(byFeatureMap.get(feature) ?? { tokens: 0, requests: 0 }) })),
    byProvider: PROVIDERS.map((provider) => ({
      provider,
      ...(byProviderMap.get(provider) ?? { tokens: 0, requests: 0 }),
    })),
    providers: PROVIDERS.map((provider) => {
      const status = statusByProvider.get(provider);
      return {
        provider,
        configured: configured[provider],
        status: status?.status ?? null,
        updatedAt: status?.updated_at ?? null,
      };
    }),
  });
});

aiUsageRouter.put('/budget', (req: AuthedRequest, res: Response) => {
  const raw = req.body?.monthlyTokenBudget;
  let next: number | null;
  if (raw === null || raw === undefined || raw === '') {
    next = null;
  } else if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= MAX_BUDGET) {
    next = raw;
  } else {
    res.status(400).json({ success: false, error: 'Informe um número inteiro de tokens maior que zero.' });
    return;
  }

  db.prepare('UPDATE users SET monthly_token_budget = ? WHERE id = ?').run(next, req.userId!);
  res.json({ success: true, budget: next });
});
