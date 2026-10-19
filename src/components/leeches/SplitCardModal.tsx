import { useState, type FormEvent } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';

import { useToast } from '../../contexts/ToastContext';
import { ApiError, leechesApi } from '../../services/api';
import type { DueFlashcard, Flashcard } from '../../types';
import { emptySplitDraft, MAX_SPLIT_CARDS, MIN_SPLIT_CARDS, splitProblem, type SplitDraft } from '../../utils/leeches';
import { FormattedText } from '../FormattedText';
import { Modal } from '../questions/Modal';
import { RichTextEditor } from '../RichTextEditor';

/**
 * Quebrar um cartão em vários menores: o motivo mais comum de um cartão não fixar é trazer mais de uma ideia. O
 * cartão original fica à vista, para copiar o trecho de cada parte. Os novos entram na mesma coleção, como cartões
 * novos; o original é apagado (com o histórico) ou, se preferir, fica e recomeça a contagem.
 */
export function SplitCardModal({
  card,
  onClose,
  onDone,
}: {
  card: DueFlashcard;
  onClose: () => void;
  onDone: (result: { created: Flashcard[]; originalDeleted: boolean }) => void;
}) {
  const { showToast } = useToast();
  const [drafts, setDrafts] = useState<SplitDraft[]>(() => [emptySplitDraft(), emptySplitDraft()]);
  const [keepOriginal, setKeepOriginal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = splitProblem(drafts);

  const change = (index: number, patch: Partial<SplitDraft>) => setDrafts((all) => all.map((d, i) => (i === index ? { ...d, ...patch } : d)));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || problem) return;
    setBusy(true);
    setError(null);
    try {
      const result = await leechesApi.split(card.id, { cards: drafts, keepOriginal });
      showToast(`${result.created.length} cartões criados${result.originalDeleted ? ' e o original foi apagado' : ''}.`);
      onDone(result);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Não foi possível quebrar o cartão.';
      setError(message);
      showToast(message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Quebrar em cartões menores" onClose={onClose} size="lg">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Um cartão com uma ideia só é mais fácil de fixar. Separe o original em partes e escreva um cartão para cada uma (você pode copiar os trechos daqui).
        </p>

        <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-800/50">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Cartão original</p>
          <FormattedText value={card.question} format={card.format} role="question" className="text-sm text-neutral-900 dark:text-neutral-100" />
          <div className="my-2 border-t border-neutral-200 dark:border-neutral-700" />
          <FormattedText value={card.answer} format={card.format} role="answer" className="text-sm text-neutral-700 dark:text-neutral-300" />
        </div>

        {drafts.map((draft, index) => (
          <fieldset key={index} className="space-y-2 rounded-xl border border-neutral-200 p-3 dark:border-neutral-700">
            <legend className="flex items-center gap-2 px-1 text-xs font-semibold text-neutral-700 dark:text-neutral-300">
              Cartão {index + 1}
              {drafts.length > MIN_SPLIT_CARDS && (
                <button
                  type="button"
                  className="rounded p-0.5 text-neutral-400 hover:text-red-600"
                  title="Remover este cartão"
                  aria-label={`Remover o cartão ${index + 1}`}
                  onClick={() => setDrafts((all) => all.filter((_, i) => i !== index))}
                >
                  <Trash2 size={13} />
                </button>
              )}
            </legend>
            <div>
              <span className="label-field">Pergunta</span>
              <RichTextEditor value={draft.question} onChange={(html) => change(index, { question: html })} role="question" />
            </div>
            <div>
              <span className="label-field">Resposta</span>
              <RichTextEditor value={draft.answer} onChange={(html) => change(index, { answer: html })} role="answer" />
            </div>
          </fieldset>
        ))}

        <button
          type="button"
          className="btn-secondary !py-1.5 text-xs"
          disabled={drafts.length >= MAX_SPLIT_CARDS}
          onClick={() => setDrafts((all) => [...all, emptySplitDraft()])}
        >
          <Plus size={14} />
          Adicionar outro cartão
        </button>

        <label className="flex items-start gap-2 text-sm text-neutral-700 dark:text-neutral-300">
          <input type="checkbox" className="mt-0.5" checked={keepOriginal} onChange={(e) => setKeepOriginal(e.target.checked)} />
          <span>
            Manter o cartão original
            <span className="block text-xs text-neutral-500 dark:text-neutral-400">
              Se desmarcado, o original é apagado, com o histórico de revisões. Se marcado, ele fica e a contagem de erros recomeça.
            </span>
          </span>
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {problem && <p className="mr-auto text-xs text-neutral-500 dark:text-neutral-400">{problem}</p>}
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={busy || !!problem}>
            {busy && <Loader2 size={16} className="animate-spin" />}
            Criar {drafts.length} cartões
          </button>
        </div>
      </form>
    </Modal>
  );
}
