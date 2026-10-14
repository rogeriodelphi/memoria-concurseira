import type { ReactNode } from 'react';
import { SkipForward, Undo2 } from 'lucide-react';

const BUTTON_CLASS =
  'flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200';

function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 font-sans text-[11px] font-medium text-neutral-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400">
      {children}
    </kbd>
  );
}

/**
 * Voltar ao cartão anterior (desfazendo a avaliação dele, se houve) e pular o cartão da vez
 * (sai desta sessão sem ser avaliado e continua pendente para a próxima). Fica abaixo do
 * cartão nas telas de estudo, com a lembrança dos atalhos de teclado (que `useStudyShortcuts`
 * liga dentro do cartão).
 */
export function StudyNavigation({
  canGoBack,
  busy,
  onBack,
  onSkip,
}: {
  canGoBack: boolean;
  busy: boolean;
  onBack: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          disabled={!canGoBack || busy}
          title="Voltar ao cartão anterior (←). Se ele foi avaliado, a avaliação é desfeita."
          className={BUTTON_CLASS}
        >
          <Undo2 size={15} />
          Voltar
        </button>
        <button
          type="button"
          onClick={onSkip}
          disabled={busy}
          title="Pular este cartão nesta sessão (→). Ele não é avaliado e continua pendente para a próxima."
          className={BUTTON_CLASS}
        >
          Pular
          <SkipForward size={15} />
        </button>
      </div>
      <p className="mt-2 hidden text-center text-xs text-neutral-400 dark:text-neutral-500 sm:block">
        <Key>Enter</Key> mostra a resposta · <Key>1</Key> a <Key>4</Key> avaliam (errei, difícil, bom, fácil) ·{' '}
        <Key>←</Key> volta · <Key>→</Key> pula
      </p>
    </div>
  );
}
