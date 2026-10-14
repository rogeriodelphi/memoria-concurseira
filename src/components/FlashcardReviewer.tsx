import { useEffect, useRef, useState } from 'react';
import { Loader2, Pencil, Star, Volume2, VolumeX } from 'lucide-react';

import { FormattedText } from './FormattedText';
import { RichTextEditor } from './RichTextEditor';
import { useStudySettings } from '../contexts/StudySettingsContext';
import { useSpeech } from '../hooks/useSpeech';
import { ApiError, flashcardsApi } from '../services/api';
import { editorHasContent, toEditorHtml } from '../utils/flashcardEditor';
import { stripHtmlForSpeech } from '../utils/speech';
import type { Flashcard, StudyResult } from '../types';

const RESULT_BUTTONS: { result: StudyResult; label: string; className: string }[] = [
  {
    result: 'errei',
    label: 'Errei',
    className: 'bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/70',
  },
  {
    result: 'dificil',
    label: 'Difícil',
    className:
      'bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-950/70',
  },
  {
    result: 'bom',
    label: 'Bom',
    className: 'bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-950/70',
  },
  {
    result: 'facil',
    label: 'Fácil',
    className:
      'bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-950/40 dark:text-brand-300 dark:hover:bg-brand-950/70',
  },
];

interface FlashcardReviewerProps {
  current: Flashcard & { collectionName?: string };
  revealed: boolean;
  onReveal: () => void;
  // `durationMs`: quanto o cartão ficou na tela até a avaliação (o painel usa
  // isso pro ritmo de estudo). O servidor limita valores absurdos.
  onRate: (result: StudyResult, durationMs: number) => void;
  onToggleFavorite?: () => void;
  // Quando informado, o cartão ganha um botão pra editar pergunta e resposta
  // ali mesmo. A tela só precisa trocar o cartão na fila pelo atualizado.
  onUpdated?: (updated: Flashcard) => void;
  // O cartão que vem depois: no modo automático, a voz dele é gerada antes, para
  // tocar na hora quando chegar a vez.
  upcoming?: Flashcard;
  // Uma avaliação está sendo gravada: os botões de avaliar esperam, para o mesmo cartão
  // não ser avaliado duas vezes (um clique duplo).
  busy?: boolean;
}

export function FlashcardReviewer({
  current,
  revealed,
  onReveal,
  onRate,
  onToggleFavorite,
  onUpdated,
  upcoming,
  busy = false,
}: FlashcardReviewerProps) {
  const { autoPlaySpeech } = useStudySettings();
  const { speak: speakText, stop: stopSpeech, prefetch, speaking, loading, canSpeak } = useSpeech();
  const [editing, setEditing] = useState(false);
  const [editQuestion, setEditQuestion] = useState('');
  const [editAnswer, setEditAnswer] = useState('');
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Quando o cartão atual apareceu, pra medir o tempo até a avaliação. O tempo
  // gasto editando o cartão não é estudo, então é descontado ao sair da edição.
  const shownAtRef = useRef(Date.now());
  const editStartedAtRef = useRef(0);

  // (O próprio hook de voz para tudo ao sair da tela: nunca deixa som tocando
  // sozinho em segundo plano.)
  function speak(rawText: string, format: Flashcard['format'], field: 'question' | 'answer') {
    void speakText(stripHtmlForSpeech(rawText, format), field);
  }

  function toggleSpeak(rawText: string, format: Flashcard['format'], field: 'question' | 'answer') {
    if (speaking === field) {
      stopSpeech();
      return;
    }
    speak(rawText, format, field);
  }

  // Ao trocar de cartão, para qualquer fala pendente do cartão anterior e
  // descarta uma edição que estivesse aberta.
  useEffect(() => {
    stopSpeech();
    setEditing(false);
    shownAtRef.current = Date.now();
  }, [current.id]);

  // Modo automático: já deixa pronta a resposta deste cartão e a pergunta do
  // próximo — a primeira vez que o Gemini gera a voz leva alguns segundos.
  useEffect(() => {
    if (!autoPlaySpeech) return;
    prefetch(stripHtmlForSpeech(current.answer, current.format));
    if (upcoming) prefetch(stripHtmlForSpeech(upcoming.question, upcoming.format));
  }, [current.id, upcoming?.id, autoPlaySpeech]);

  // Modo automático: lê a pergunta assim que um novo cartão aparece.
  useEffect(() => {
    if (!autoPlaySpeech) return;
    speak(current.question, current.format, 'question');
  }, [current.id, autoPlaySpeech]);

  // Modo automático: lê a resposta assim que ela é revelada.
  useEffect(() => {
    if (!autoPlaySpeech || !revealed) return;
    speak(current.answer, current.format, 'answer');
  }, [revealed, autoPlaySpeech]);

  function startEditing() {
    // A voz do cartão que está sendo reescrito não faz mais sentido.
    stopSpeech();
    setEditQuestion(toEditorHtml(current.question, current.format));
    setEditAnswer(toEditorHtml(current.answer, current.format));
    setEditError(null);
    editStartedAtRef.current = Date.now();
    setEditing(true);
  }

  function stopEditing() {
    shownAtRef.current += Date.now() - editStartedAtRef.current;
    setEditing(false);
  }

  function rate(result: StudyResult) {
    const durationMs = Date.now() - shownAtRef.current;
    // O próximo cartão (ou o mesmo, se for o único e voltou pra fila) aparece
    // agora — o efeito acima só dispara quando o id muda.
    shownAtRef.current = Date.now();
    onRate(result, durationMs);
  }

  async function saveEditing() {
    // O editor devolve HTML mesmo "vazio" (<br>), e o servidor ignora em
    // silêncio um campo em branco — por isso a checagem é feita aqui, pra o
    // usuário não achar que salvou algo que não foi salvo.
    if (!editorHasContent(editQuestion) || !editorHasContent(editAnswer)) {
      setEditError('Preencha a pergunta e a resposta.');
      return;
    }
    setSaving(true);
    setEditError(null);
    try {
      const { flashcard } = await flashcardsApi.update(current.id, {
        question: editQuestion,
        answer: editAnswer,
        format: 'html',
      });
      onUpdated?.(flashcard);
      stopEditing();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : 'Não foi possível salvar as alterações.');
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="card space-y-4 p-6">
        {current.collectionName && (
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
            {current.collectionName}
          </p>
        )}
        <div>
          <label className="label-field">Pergunta</label>
          <RichTextEditor value={editQuestion} onChange={setEditQuestion} role="question" />
        </div>
        <div>
          <label className="label-field">Resposta</label>
          <RichTextEditor value={editAnswer} onChange={setEditAnswer} role="answer" />
        </div>
        {editError && <p className="text-sm text-red-600">{editError}</p>}
        <div className="flex gap-2">
          <button type="button" className="btn-primary" onClick={saveEditing} disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
          <button type="button" className="btn-secondary" onClick={stopEditing} disabled={saving}>
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card relative flex min-h-[320px] flex-col justify-between p-8">
      {(onUpdated || onToggleFavorite) && (
        <div className="absolute right-4 top-4 flex items-center gap-2.5">
          {onUpdated && (
            <button
              type="button"
              onClick={startEditing}
              className="text-neutral-400 transition-colors hover:text-brand-600 dark:text-neutral-500 dark:hover:text-brand-400"
              title="Editar pergunta e resposta"
              aria-label="Editar pergunta e resposta"
            >
              <Pencil size={17} />
            </button>
          )}
          {onToggleFavorite && (
            <button
              type="button"
              onClick={onToggleFavorite}
              className={`transition-colors ${
                current.favorite
                  ? 'text-amber-500 hover:text-amber-600'
                  : 'text-neutral-300 hover:text-amber-500 dark:text-neutral-600 dark:hover:text-amber-400'
              }`}
              title={current.favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
            >
              <Star size={18} fill={current.favorite ? 'currentColor' : 'none'} />
            </button>
          )}
        </div>
      )}
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        {current.collectionName && (
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
            {current.collectionName}
          </p>
        )}
        <FormattedText
          value={current.question}
          format={current.format}
          role="question"
          className="text-lg text-neutral-900 dark:text-neutral-100"
        />
        {canSpeak && (
          <button
            type="button"
            onClick={() => toggleSpeak(current.question, current.format, 'question')}
            className="mt-2 flex items-center gap-1 text-xs font-medium text-neutral-400 hover:text-brand-600 dark:text-neutral-500 dark:hover:text-brand-400"
          >
            {loading === 'question' ? (
              <Loader2 size={14} className="animate-spin" />
            ) : speaking === 'question' ? (
              <VolumeX size={14} />
            ) : (
              <Volume2 size={14} />
            )}
            {loading === 'question' ? 'Preparando voz...' : speaking === 'question' ? 'Parar' : 'Ouvir pergunta'}
          </button>
        )}
        {revealed && (
          <>
            <div className="my-6 h-px w-full bg-neutral-100 dark:bg-neutral-800" />
            <FormattedText
              value={current.answer}
              format={current.format}
              role="answer"
              className="text-neutral-600 dark:text-neutral-400"
            />
            {canSpeak && (
              <button
                type="button"
                onClick={() => toggleSpeak(current.answer, current.format, 'answer')}
                className="mt-2 flex items-center gap-1 text-xs font-medium text-neutral-400 hover:text-brand-600 dark:text-neutral-500 dark:hover:text-brand-400"
              >
                {loading === 'answer' ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : speaking === 'answer' ? (
                  <VolumeX size={14} />
                ) : (
                  <Volume2 size={14} />
                )}
                {loading === 'answer' ? 'Preparando voz...' : speaking === 'answer' ? 'Parar' : 'Ouvir resposta'}
              </button>
            )}
          </>
        )}
      </div>

      {!revealed ? (
        <button onClick={onReveal} className="btn-primary mt-6 w-full">
          Mostrar resposta
        </button>
      ) : (
        <div className="mt-6 grid grid-cols-4 gap-2">
          {RESULT_BUTTONS.map((btn) => (
            <button
              key={btn.result}
              onClick={() => rate(btn.result)}
              disabled={busy}
              className={`rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors disabled:opacity-60 ${btn.className}`}
            >
              {btn.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
