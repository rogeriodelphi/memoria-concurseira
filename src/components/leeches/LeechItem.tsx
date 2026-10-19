import { useState } from 'react';
import { ChevronDown, ChevronUp, Clock, Loader2, Pencil, RotateCcw, Scissors } from 'lucide-react';

import type { Leech } from '../../types';
import { leechHeadline, snoozedLabel, SNOOZE_OPTIONS, type SnoozeDays } from '../../utils/leeches';
import { plural } from '../../utils/performance';
import { FormattedText } from '../FormattedText';
import { ResultDots } from './ResultDots';

/** Um cartão sanguessuga e o que dá para fazer com ele: reescrever, quebrar, adiar a revisão, recomeçar a contagem. */
export function LeechItem({
  leech,
  streakToLeave,
  busy,
  onRewrite,
  onSplit,
  onSnooze,
  onReset,
}: {
  leech: Leech;
  /** Quantos acertos seguidos tiram o cartão da lista. */
  streakToLeave: number;
  busy: boolean;
  onRewrite: () => void;
  onSplit: () => void;
  onSnooze: (days: SnoozeDays) => void;
  onReset: () => void;
}) {
  const { flashcard } = leech;
  const [open, setOpen] = useState(false);
  const [choosingDays, setChoosingDays] = useState(false);
  const snoozed = snoozedLabel(leech);

  return (
    <li className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-700">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="text-neutral-500 dark:text-neutral-400">
          {flashcard.collectionName}
          {flashcard.collectionSubject ? ` · ${flashcard.collectionSubject}` : ''}
        </span>
        <span className="font-medium text-red-600 dark:text-red-400">{leechHeadline(leech)}</span>
        <ResultDots results={leech.results} />
        {leech.streak > 0 && (
          <span className="text-emerald-600 dark:text-emerald-400">
            {plural(leech.streak, 'acerto seguido', 'acertos seguidos')} (com {streakToLeave} ele sai da lista)
          </span>
        )}
        {snoozed && (
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">{snoozed}</span>
        )}
      </div>

      <div className="mt-2">
        <FormattedText
          value={flashcard.question}
          format={flashcard.format}
          role="question"
          className={`text-sm text-neutral-900 dark:text-neutral-100 ${open ? '' : 'line-clamp-3'}`}
        />
        {open && (
          <div className="mt-2 border-t border-neutral-100 pt-2 dark:border-neutral-800">
            <FormattedText value={flashcard.answer} format={flashcard.format} role="answer" className="text-sm text-neutral-700 dark:text-neutral-300" />
          </div>
        )}
        <button
          type="button"
          className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline dark:text-brand-300"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          {open ? 'Recolher' : 'Ver o cartão inteiro'}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary !py-1.5 text-xs" disabled={busy} onClick={onRewrite} title="Edita a pergunta e a resposta e permite criar um macete">
          <Pencil size={14} />
          Reescrever
        </button>
        <button type="button" className="btn-secondary !py-1.5 text-xs" disabled={busy} onClick={onSplit} title="Separa o cartão em cartões menores, de uma ideia só">
          <Scissors size={14} />
          Quebrar
        </button>
        {choosingDays ? (
          <span className="inline-flex items-center gap-1">
            <span className="text-xs text-neutral-500 dark:text-neutral-400">Adiar por</span>
            {SNOOZE_OPTIONS.map((days) => (
              <button
                key={days}
                type="button"
                className="btn-secondary !px-2 !py-1 text-xs"
                disabled={busy}
                onClick={() => {
                  setChoosingDays(false);
                  onSnooze(days);
                }}
              >
                {days} dias
              </button>
            ))}
            <button type="button" className="px-1 text-xs text-neutral-500 hover:underline" onClick={() => setChoosingDays(false)}>
              cancelar
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="btn-secondary !py-1.5 text-xs"
            disabled={busy}
            onClick={() => setChoosingDays(true)}
            title="Tira o cartão da revisão por um tempo, sem alterar nada nele"
          >
            <Clock size={14} />
            Adiar
          </button>
        )}
        <button
          type="button"
          className="btn-secondary !py-1.5 text-xs"
          disabled={busy}
          onClick={onReset}
          title="Os erros de antes deixam de contar: ele só volta à lista se errar de novo"
        >
          <RotateCcw size={14} />
          Recomeçar a contagem
        </button>
        {busy && <Loader2 size={14} className="animate-spin text-neutral-400" />}
      </div>
    </li>
  );
}
