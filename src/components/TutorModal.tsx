import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Loader2, Send, Sparkles } from 'lucide-react';

import { ApiError, flashcardsApi } from '../services/api';
import type { Flashcard } from '../types';
import { stripHtmlForSpeech } from '../utils/speech';
import { cleanAsk, historyFor, MAX_ASK_CHARS, QUICK_ASKS, replyNotes, type TutorTurn } from '../utils/tutor';
import { Modal } from './questions/Modal';

/**
 * O "professor" de um cartão: o aluno pede uma explicação, um exemplo, um macete ou pergunta o que não entendeu, e a IA
 * responde sobre aquele cartão. As perguntas seguintes levam as últimas respostas junto, para a conversa fazer sentido.
 * Só responde: nada é gravado (nem no cartão, nem na revisão), e a conversa some ao fechar. A IA pode errar: o que vale
 * é o cartão e a sua fonte, e a tela diz isso.
 */
export function TutorModal({ card, onClose }: { card: Flashcard; onClose: () => void }) {
  const [turns, setTurns] = useState<TutorTurn[]>([]);
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    inputRef.current?.focus();
    return () => {
      alive.current = false;
    };
  }, []);

  // Cada resposta (ou erro) nova leva a tela até ela.
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [turns, pending]);

  async function ask(question: string) {
    if (pending) return;
    const id = nextId.current++;
    const history = historyFor(turns);
    setTurns((prev) => [...prev, { id, ask: question }]);
    setPending(true);
    try {
      const { reply } = await flashcardsApi.explain(card.id, { ask: question, history });
      if (alive.current) setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, reply } : t)));
    } catch (err) {
      const error = err instanceof ApiError ? err.message : 'Não foi possível falar com a IA agora.';
      if (alive.current) setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, error } : t)));
    } finally {
      if (alive.current) setPending(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const question = cleanAsk(text);
    if (!question || pending) return;
    setText('');
    void ask(question);
  }

  const preview = stripHtmlForSpeech(card.question, card.format);

  return (
    <Modal title="Professor" onClose={onClose} size="lg">
      <p className="rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-500 dark:bg-neutral-800/50 dark:text-neutral-400">
        <span className="font-medium text-neutral-700 dark:text-neutral-300">Cartão:</span> {preview.length > 220 ? `${preview.slice(0, 219)}…` : preview}
      </p>

      <div className="mt-3 space-y-3" aria-live="polite">
        {turns.length === 0 && !pending && (
          <p className="text-sm text-neutral-600 dark:text-neutral-300">O que você não entendeu neste cartão? Escolha um atalho ou escreva a sua pergunta.</p>
        )}

        {turns.map((turn) => (
          <div key={turn.id} className="space-y-2">
            <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-brand-600 px-3 py-2 text-sm text-white">{turn.ask}</p>

            {turn.reply && (
              <div className="rounded-2xl rounded-bl-sm border border-neutral-200 bg-white px-3.5 py-3 text-sm dark:border-neutral-700 dark:bg-neutral-900">
                <p className="whitespace-pre-wrap text-neutral-800 dark:text-neutral-200">{turn.reply.answer}</p>
                {replyNotes(turn.reply).map((note) => (
                  <p key={note.label} className="mt-2 text-xs text-neutral-600 dark:text-neutral-300">
                    <span className="font-semibold text-neutral-800 dark:text-neutral-100">{note.label}:</span> {note.text}
                  </p>
                ))}
              </div>
            )}

            {turn.error && (
              <p className="rounded-2xl rounded-bl-sm border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300" role="alert">
                {turn.error}
              </p>
            )}

            {!turn.reply && !turn.error && (
              <p className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                <Loader2 size={14} className="animate-spin" />O professor está pensando...
              </p>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="mt-3 flex flex-wrap gap-2" aria-label="Atalhos de pergunta">
        {QUICK_ASKS.map((quick) => (
          <button
            key={quick.label}
            type="button"
            disabled={pending}
            onClick={() => void ask(quick.ask)}
            className="inline-flex items-center gap-1 rounded-full border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:border-brand-400 hover:bg-brand-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-brand-950/30"
          >
            <Sparkles size={12} className="text-brand-600 dark:text-brand-400" />
            {quick.label}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="mt-3 flex gap-2">
        <input
          ref={inputRef}
          type="text"
          className="input-field min-w-0 flex-1"
          placeholder="Escreva a sua dúvida sobre este cartão..."
          aria-label="Sua dúvida sobre o cartão"
          value={text}
          maxLength={MAX_ASK_CHARS}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="btn-primary shrink-0 px-3" disabled={pending || cleanAsk(text) === null} aria-label="Enviar a dúvida" title="Enviar">
          {pending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </button>
      </form>

      <p className="mt-3 text-[11px] text-neutral-500 dark:text-neutral-400">
        A IA pode errar, sobretudo em números, datas e leis. Vale o que está no seu cartão e na sua fonte; nada aqui é gravado nem altera a revisão.
      </p>
    </Modal>
  );
}
