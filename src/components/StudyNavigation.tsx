import { SkipForward, Undo2 } from 'lucide-react';

const BUTTON_CLASS =
  'flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200';

/**
 * Voltar ao cartão anterior (desfazendo a avaliação dele, se houve) e pular o cartão da vez
 * (sai desta sessão sem ser avaliado e continua pendente para a próxima). Fica abaixo do
 * cartão nas telas de estudo.
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
    <div className="mt-3 flex items-center justify-between">
      <button
        type="button"
        onClick={onBack}
        disabled={!canGoBack || busy}
        title="Voltar ao cartão anterior. Se ele foi avaliado, a avaliação é desfeita."
        className={BUTTON_CLASS}
      >
        <Undo2 size={15} />
        Voltar
      </button>
      <button
        type="button"
        onClick={onSkip}
        disabled={busy}
        title="Pular este cartão nesta sessão. Ele não é avaliado e continua pendente para a próxima."
        className={BUTTON_CLASS}
      >
        Pular
        <SkipForward size={15} />
      </button>
    </div>
  );
}
