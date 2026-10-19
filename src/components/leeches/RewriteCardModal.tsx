import { useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';

import { useToast } from '../../contexts/ToastContext';
import { ApiError, flashcardsApi, leechesApi } from '../../services/api';
import type { DueFlashcard, Flashcard } from '../../types';
import { editorHasContent, toEditorHtml } from '../../utils/flashcardEditor';
import { appendMacete, MAX_MACETE_CHARS } from '../../utils/leeches';
import { Modal } from '../questions/Modal';
import { RichTextEditor } from '../RichTextEditor';

/**
 * Reescrever um cartão sanguessuga: pergunta e resposta no editor de sempre e, se quiser, um macete (um jeito de
 * lembrar) que entra no fim da resposta. Ao salvar, a contagem de erros do cartão recomeça: o que valia antes era
 * do texto antigo.
 */
export function RewriteCardModal({
  card,
  onClose,
  onSaved,
}: {
  card: DueFlashcard;
  onClose: () => void;
  onSaved: (flashcard: Flashcard) => void;
}) {
  const { showToast } = useToast();
  const [question, setQuestion] = useState(() => toEditorHtml(card.question, card.format));
  const [answer, setAnswer] = useState(() => toEditorHtml(card.answer, card.format));
  const [macete, setMacete] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!editorHasContent(question) || !editorHasContent(answer)) {
      setError('Preencha a pergunta e a resposta.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { flashcard } = await flashcardsApi.update(card.id, { question, answer: appendMacete(answer, macete), format: 'html' });
      await leechesApi.reset(card.id);
      showToast('Cartão reescrito: a contagem de erros recomeçou.');
      onSaved(flashcard);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Não foi possível salvar o cartão.';
      setError(message);
      showToast(message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Reescrever o cartão" onClose={onClose} size="lg">
      <form onSubmit={save} className="space-y-4">
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Um cartão que você erra sempre costuma trazer coisa demais, ou uma resposta difícil de lembrar. Deixe a pergunta clara, a resposta curta e, se ajudar,
          crie um macete.
        </p>
        <div>
          <span className="label-field">Pergunta</span>
          <RichTextEditor value={question} onChange={setQuestion} role="question" />
        </div>
        <div>
          <span className="label-field">Resposta</span>
          <RichTextEditor value={answer} onChange={setAnswer} role="answer" />
        </div>
        <div>
          <label className="label-field" htmlFor="lc-macete">
            Macete (opcional)
          </label>
          <textarea
            id="lc-macete"
            className="input-field min-h-[3.5rem]"
            rows={2}
            maxLength={MAX_MACETE_CHARS}
            value={macete}
            onChange={(e) => setMacete(e.target.value)}
            placeholder="Um jeito de lembrar: uma sigla, uma imagem, uma comparação..."
          />
          <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">Entra no fim da resposta, numa linha em itálico.</p>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy && <Loader2 size={16} className="animate-spin" />}
            Salvar e recomeçar a contagem
          </button>
        </div>
      </form>
    </Modal>
  );
}
