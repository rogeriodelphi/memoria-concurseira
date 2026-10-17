import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Headphones, Info, Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react';

import { APP_NAME } from '../components/BrandMark';
import { FormattedText } from '../components/FormattedText';
import { useStudySettings } from '../contexts/StudySettingsContext';
import { useHandsFree } from '../hooks/useHandsFree';
import { useTtsInfo } from '../hooks/useSpeech';
import { useWakeLock } from '../hooks/useWakeLock';
import { flashcardsApi } from '../services/api';
import type { DueFlashcard } from '../types';
import { THINK_SECONDS_OPTIONS, type HandsFreePhase } from '../utils/handsFree';
import { shuffle } from '../utils/studyQueue';

const PHASE_LABEL: Record<HandsFreePhase, string> = {
  question: 'Lendo a pergunta…',
  thinking: 'Pensando…',
  answer: 'Lendo a resposta…',
  gap: 'Próximo cartão…',
  finished: 'Fim da fila',
};

const ROUND_BUTTON =
  'tap-area flex h-12 w-12 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-600 shadow-card transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700';

/** O tempo de pensar entre a pergunta e a resposta; vale na hora, até no meio da sessão. */
function ThinkTimeSelect() {
  const { handsFreeThinkSeconds, setHandsFreeThinkSeconds } = useStudySettings();
  return (
    <label className="flex items-center justify-between gap-3 text-sm text-neutral-700 dark:text-neutral-300">
      Tempo para pensar
      <select
        value={handsFreeThinkSeconds}
        onChange={(e) => setHandsFreeThinkSeconds(Number(e.target.value))}
        className="input-field !w-auto py-1.5"
        aria-label="Tempo para pensar, em segundos"
      >
        {THINK_SECONDS_OPTIONS.map((seconds) => (
          <option key={seconds} value={seconds}>
            {seconds} segundos
          </option>
        ))}
      </select>
    </label>
  );
}

/** Qual voz vai ler, e o aviso de que a natural tem limite diário (o modo gasta duas leituras por cartão). */
function VoiceNote() {
  const { speechEngine } = useStudySettings();
  const info = useTtsInfo();
  const natural = speechEngine === 'natural' && info?.available === true;
  return (
    <p className="flex items-start gap-2 text-xs text-neutral-500 dark:text-neutral-400">
      <Info size={14} className="mt-0.5 shrink-0" />
      <span>
        {natural ? (
          <>
            Voz <strong className="font-semibold">natural</strong> (Gemini): ela tem limite diário no plano gratuito e este modo
            usa duas leituras por cartão. Quando o limite chegar, o app segue com a voz do navegador.
          </>
        ) : (
          <>
            Voz <strong className="font-semibold">do navegador</strong>, sem limite de uso.
          </>
        )}{' '}
        Para trocar a voz ou a velocidade, vá em{' '}
        <Link to="/configuracoes" className="underline hover:text-brand-600">
          Configurações
        </Link>
        .
      </span>
    </p>
  );
}

function Player({ cards, backLabel }: { cards: DueFlashcard[]; backLabel: string }) {
  const hf = useHandsFree(cards);
  const { handsFreeThinkSeconds } = useStudySettings();
  const { status, position } = hf;
  const active = status === 'playing' || status === 'paused';

  // A tela fica ligada enquanto toca: a voz do navegador costuma parar quando ela apaga.
  useWakeLock(status === 'playing');

  const card = cards[position.index];

  // Controles na tela de bloqueio e nos fones, quando o navegador os oferece (hoje só com a voz
  // natural, que toca como áudio; a voz do navegador não aparece ali).
  useEffect(() => {
    if (!active || !card || typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;
    try {
      session.metadata = new MediaMetadata({
        title: card.question.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90) || 'Cartão',
        artist: APP_NAME,
        album: card.collectionName,
      });
      session.playbackState = status === 'playing' ? 'playing' : 'paused';
      session.setActionHandler('play', hf.resume);
      session.setActionHandler('pause', hf.pause);
      session.setActionHandler('nexttrack', hf.next);
      session.setActionHandler('previoustrack', hf.previous);
    } catch {
      // sem suporte a algum dos controles: o resto continua valendo
    }
    return () => {
      try {
        for (const action of ['play', 'pause', 'nexttrack', 'previoustrack'] as const) session.setActionHandler(action, null);
      } catch {
        // idem
      }
    };
  }, [active, card, status, hf.resume, hf.pause, hf.next, hf.previous]);

  // Teclado (no PC): Espaço pausa/continua; ← e → trocam de cartão.
  useEffect(() => {
    if (!active) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.repeat) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      if (event.key === ' ' && tag !== 'BUTTON' && tag !== 'A') {
        event.preventDefault();
        if (status === 'playing') hf.pause();
        else hf.resume();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        hf.next();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        hf.previous();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, status, hf.pause, hf.resume, hf.next, hf.previous]);

  const back = (
    <Link
      to="/colecoes"
      className="tap-area mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
    >
      <ArrowLeft size={16} />
      {backLabel}
    </Link>
  );

  if (!hf.canSpeak) {
    return (
      <div className="mx-auto max-w-xl">
        {back}
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          Este navegador não tem leitura em voz alta, e a voz natural não está disponível. O modo mãos livres precisa de uma
          das duas (veja a voz em{' '}
          <Link to="/configuracoes" className="underline">
            Configurações
          </Link>
          ).
        </p>
      </div>
    );
  }

  // ---------- antes de começar ----------
  if (status === 'idle') {
    return (
      <div className="mx-auto max-w-xl">
        {back}
        <div className="card p-8">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400">
            <Headphones size={22} />
          </div>
          <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">Modo mãos livres</h1>
          <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
            {cards.length.toLocaleString('pt-BR')} {cards.length === 1 ? 'cartão pendente' : 'cartões pendentes'}, em ordem
            aleatória. A voz lê a pergunta, espera você pensar, lê a resposta e passa ao próximo. Isto{' '}
            <strong className="font-semibold">não conta como estudo</strong>: nada é avaliado e o agendamento dos cartões não
            muda.
          </p>
          <div className="mt-5 space-y-4">
            <ThinkTimeSelect />
            <VoiceNote />
          </div>
          <button type="button" autoFocus onClick={hf.start} className="btn-primary mt-6 w-full">
            <Play size={16} />
            Começar
          </button>
          <p className="mt-3 text-center text-xs text-neutral-400 dark:text-neutral-500">
            A tela fica ligada enquanto toca. Com a voz do navegador, o som para se a tela apagar.
          </p>
        </div>
      </div>
    );
  }

  // ---------- o aparelho não consegue falar ----------
  if (status === 'unspeakable') {
    return (
      <div className="mx-auto max-w-xl">
        {back}
        <div className="card p-8 text-center">
          <h1 className="text-lg font-bold text-neutral-900 dark:text-neutral-100">Não consegui ler em voz alta</h1>
          <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
            Várias leituras seguidas falharam. Confira se o som do aparelho está ligado e se há uma voz em português instalada,
            ou troque a voz em Configurações.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <button type="button" onClick={hf.start} className="btn-primary">
              Tentar de novo
            </button>
            <Link to="/configuracoes" className="btn-secondary">
              Configurações
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ---------- fim da fila ----------
  if (status === 'finished' || !card) {
    return (
      <div className="mx-auto max-w-xl">
        {back}
        <div className="card flex flex-col items-center gap-3 p-10 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400">
            <CheckCircle2 size={22} />
          </div>
          <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">Fim da fila</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Você ouviu {cards.length.toLocaleString('pt-BR')} {cards.length === 1 ? 'cartão' : 'cartões'}. Os pendentes
            continuam pendentes: para avaliá-los, use a revisão.
          </p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            <button type="button" onClick={hf.start} className="btn-secondary">
              <RotateCcw size={16} />
              Ouvir de novo
            </button>
            <Link to="/revisar" className="btn-primary">
              Revisar pendentes
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ---------- tocando ou pausado ----------
  const paused = status === 'paused';
  const showAnswer = position.phase === 'answer' || position.phase === 'gap';
  const origin = [card.collectionName, card.collectionSubject].filter(Boolean).join(' · ');
  const label = paused ? 'Pausado' : PHASE_LABEL[position.phase];
  const thinking = position.phase === 'thinking' && !paused;

  return (
    <div className="mx-auto max-w-xl">
      {back}

      <div className="mb-3 flex items-center justify-between text-sm">
        <span className="font-medium text-neutral-700 dark:text-neutral-300">
          Cartão {position.index + 1} de {hf.total}
        </span>
        <span className="text-neutral-500 dark:text-neutral-400" role="status" aria-live="polite">
          {label}
        </span>
      </div>
      <div
        className="mb-5 h-1.5 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={hf.total}
        aria-valuenow={position.index}
      >
        <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${(position.index / hf.total) * 100}%` }} />
      </div>

      <div className="card flex min-h-[260px] flex-col justify-center p-8 text-center">
        {origin && (
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500">{origin}</p>
        )}
        <FormattedText value={card.question} format={card.format} role="question" className="text-lg text-neutral-900 dark:text-neutral-100" />
        {thinking && (
          // Uma barra que enche no tempo de pensar; `key` a recomeça a cada cartão.
          <div className="mx-auto mt-6 h-1 w-40 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800" aria-hidden="true">
            <div
              key={position.index}
              className="h-full rounded-full bg-brand-400"
              style={{ animation: `handsfree-think ${handsFreeThinkSeconds * 1000}ms linear forwards` }}
            />
          </div>
        )}
        {showAnswer && (
          <>
            <div className="my-6 h-px w-full bg-neutral-100 dark:bg-neutral-800" />
            <FormattedText value={card.answer} format={card.format} role="answer" className="text-neutral-600 dark:text-neutral-400" />
          </>
        )}
      </div>

      <div className="mt-6 flex items-center justify-center gap-5">
        <button type="button" onClick={hf.previous} disabled={position.index === 0} className={ROUND_BUTTON} aria-label="Cartão anterior" title="Cartão anterior (←)">
          <SkipBack size={20} />
        </button>
        <button
          type="button"
          onClick={paused ? hf.resume : hf.pause}
          className="tap-area flex h-16 w-16 items-center justify-center rounded-full bg-brand-600 text-white shadow-card transition-colors hover:bg-brand-700"
          aria-label={paused ? 'Continuar' : 'Pausar'}
          title={paused ? 'Continuar (Espaço)' : 'Pausar (Espaço)'}
        >
          {paused ? <Play size={26} /> : <Pause size={26} />}
        </button>
        <button type="button" onClick={hf.next} className={ROUND_BUTTON} aria-label="Próximo cartão" title="Próximo cartão (→)">
          <SkipForward size={20} />
        </button>
      </div>

      <div className="mt-6 flex flex-col gap-4">
        <button
          type="button"
          onClick={hf.replay}
          className="tap-area mx-auto flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        >
          <RotateCcw size={15} />
          Repetir este cartão
        </button>
        <ThinkTimeSelect />
        <VoiceNote />
      </div>
    </div>
  );
}

/** Carrega os cartões pendentes (os de todas as coleções, ou só os das coleções do endereço) e entrega ao player. */
export function HandsFree() {
  const [params] = useSearchParams();
  const ids = (params.get('ids') ?? '').split(',').filter(Boolean);
  const idsKey = ids.join(',');
  const name = params.get('nome')?.trim();

  const [cards, setCards] = useState<DueFlashcard[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setCards(null);
    setLoadError(null);
    const request = idsKey ? flashcardsApi.dueForCollections(idsKey.split(',')) : flashcardsApi.due();
    request
      .then(({ flashcards }) => setCards(shuffle(flashcards)))
      .catch(() => setLoadError('Não foi possível carregar os cartões pendentes.'));
  }, [idsKey]);

  if (loadError) return <p className="text-sm text-red-600">{loadError}</p>;
  if (!cards) return <p className="text-sm text-neutral-400 dark:text-neutral-500">Carregando...</p>;

  if (cards.length === 0) {
    return (
      <div className="mx-auto max-w-xl">
        <div className="card flex flex-col items-center gap-3 p-10 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400">
            <CheckCircle2 size={22} />
          </div>
          <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">Tudo em dia!</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Não há cartões pendentes{name ? ` em ${name}` : ''} para ouvir agora.
          </p>
          <Link to="/colecoes" className="btn-primary mt-2">
            Coleções
          </Link>
        </div>
      </div>
    );
  }

  // `key`: trocar de coleções no endereço começa uma sessão nova.
  return <Player key={idsKey} cards={cards} backLabel={name ? `Coleções · ${name}` : 'Coleções'} />;
}
