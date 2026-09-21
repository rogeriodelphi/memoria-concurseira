import { AlertTriangle, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';

import { useAiUsage } from '../hooks/useAiUsage';
import { PROVIDER_LABEL, STATUS_LABEL, formatTokens, isRecent } from '../utils/aiUsage';

export function AiUsageWidget({ onNavigate }: { onNavigate: () => void }) {
  const { usage } = useAiUsage();
  if (!usage) return null;

  const problems = usage.providers.filter(
    (p) => p.configured && p.status !== null && p.status !== 'ok' && isRecent(p.updatedAt),
  );
  const pct = usage.budget ? Math.round((usage.month.tokens / usage.budget) * 100) : null;
  const barColor = pct === null ? '' : pct >= 100 ? 'bg-red-400' : pct >= 80 ? 'bg-amber-400' : 'bg-brand-300';

  return (
    <Link
      to="/configuracoes#uso-ia"
      onClick={onNavigate}
      className="mb-3 block rounded-lg bg-brand-700/60 px-3 py-2.5 transition-colors hover:bg-brand-700"
    >
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-brand-200">
        <Sparkles size={12} />
        Tokens de IA · mês
      </p>
      {usage.remaining !== null ? (
        <p className="mt-1 text-sm font-semibold text-white">
          {formatTokens(usage.remaining)} <span className="font-normal text-brand-200">restantes</span>
        </p>
      ) : (
        <p className="mt-1 text-sm font-semibold text-white">
          {formatTokens(usage.month.tokens)} <span className="font-normal text-brand-200">usados</span>
        </p>
      )}
      {pct !== null && (
        <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-brand-900/60">
          <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
      )}
      {problems.map((p) => (
        <p key={p.provider} className="mt-1.5 flex items-center gap-1 text-[11px] text-amber-300">
          <AlertTriangle size={11} className="shrink-0" />
          {PROVIDER_LABEL[p.provider]}: {STATUS_LABEL[p.status!].toLowerCase()}
        </p>
      ))}
    </Link>
  );
}
