import { useEffect, useState } from 'react';
import { Star, Volume2, VolumeX } from 'lucide-react';

import { FormattedText } from './FormattedText';
import { useStudySettings } from '../contexts/StudySettingsContext';
import type { Flashcard, StudyResult } from '../types';

// A leitura em voz alta usa o texto puro — ler as tags de um cartão em HTML
// literalmente soletraria a marcação em vez do conteúdo.
function stripHtmlForSpeech(value: string, format: Flashcard['format']): string {
  if (format !== 'html') return value;
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

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
  onRate: (result: StudyResult) => void;
  onToggleFavorite?: () => void;
}

export function FlashcardReviewer({ current, revealed, onReveal, onRate, onToggleFavorite }: FlashcardReviewerProps) {
  const { autoPlaySpeech } = useStudySettings();
  const [speaking, setSpeaking] = useState<'question' | 'answer' | null>(null);

  // Some a fala ao sair da revisão (troca de página ou fim da sessão) —
  // nunca deixa voz tocando sozinha em segundo plano.
  useEffect(() => {
    if (!speechSupported) return;
    return () => window.speechSynthesis.cancel();
  }, []);

  function speak(rawText: string, format: Flashcard['format'], field: 'question' | 'answer') {
    if (!speechSupported) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(stripHtmlForSpeech(rawText, format));
    utterance.lang = 'pt-BR';
    utterance.onend = () => setSpeaking(null);
    utterance.onerror = () => setSpeaking(null);
    window.speechSynthesis.speak(utterance);
    setSpeaking(field);
  }

  function toggleSpeak(rawText: string, format: Flashcard['format'], field: 'question' | 'answer') {
    if (!speechSupported) return;
    if (speaking === field) {
      window.speechSynthesis.cancel();
      setSpeaking(null);
      return;
    }
    speak(rawText, format, field);
  }

  // Ao trocar de cartão, para qualquer fala pendente do cartão anterior.
  useEffect(() => {
    if (speechSupported) window.speechSynthesis.cancel();
    setSpeaking(null);
  }, [current.id]);

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

  return (
    <div className="card relative flex min-h-[320px] flex-col justify-between p-8">
      {onToggleFavorite && (
        <button
          type="button"
          onClick={onToggleFavorite}
          className={`absolute right-4 top-4 transition-colors ${
            current.favorite
              ? 'text-amber-500 hover:text-amber-600'
              : 'text-neutral-300 hover:text-amber-500 dark:text-neutral-600 dark:hover:text-amber-400'
          }`}
          title={current.favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
        >
          <Star size={18} fill={current.favorite ? 'currentColor' : 'none'} />
        </button>
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
          className="text-lg font-medium text-neutral-900 dark:text-neutral-100"
        />
        {speechSupported && (
          <button
            type="button"
            onClick={() => toggleSpeak(current.question, current.format, 'question')}
            className="mt-2 flex items-center gap-1 text-xs font-medium text-neutral-400 hover:text-brand-600 dark:text-neutral-500 dark:hover:text-brand-400"
          >
            {speaking === 'question' ? <VolumeX size={14} /> : <Volume2 size={14} />}
            {speaking === 'question' ? 'Parar' : 'Ouvir pergunta'}
          </button>
        )}
        {revealed && (
          <>
            <div className="my-6 h-px w-full bg-neutral-100 dark:bg-neutral-800" />
            <FormattedText
              value={current.answer}
              format={current.format}
              className="text-neutral-600 dark:text-neutral-400"
            />
            {speechSupported && (
              <button
                type="button"
                onClick={() => toggleSpeak(current.answer, current.format, 'answer')}
                className="mt-2 flex items-center gap-1 text-xs font-medium text-neutral-400 hover:text-brand-600 dark:text-neutral-500 dark:hover:text-brand-400"
              >
                {speaking === 'answer' ? <VolumeX size={14} /> : <Volume2 size={14} />}
                {speaking === 'answer' ? 'Parar' : 'Ouvir resposta'}
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
              onClick={() => onRate(btn.result)}
              className={`rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${btn.className}`}
            >
              {btn.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
