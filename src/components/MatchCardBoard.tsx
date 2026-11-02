import { useState, type DragEvent, type KeyboardEvent } from 'react';
import { Check, X } from 'lucide-react';

import {
  gradePlacement,
  placeDescription,
  removeFromTerm,
  termOfDescription,
  type MatchPair,
  type Placement,
} from '../utils/matchCard';

/**
 * O tabuleiro do cartão "Arrastar e soltar": as descrições (embaralhadas) numa bandeja e, embaixo, um quadro por termo.
 * Cada descrição vai para o termo certo arrastando (mouse) ou em dois toques: toca na descrição e depois no termo
 * (é o que funciona no celular, onde arrastar com o dedo não é confiável). Tocar numa descrição já colocada a devolve à
 * bandeja. Depois de conferir (`checked`), o quadro fica só para leitura, com certo e errado.
 *
 * O estado (`placement`) fica com quem usa o tabuleiro: a tela de revisão precisa dele para sugerir a nota.
 */

interface MatchCardBoardProps {
  pairs: readonly MatchPair[];
  /** A ordem das descrições na bandeja (veja `trayOrder`). */
  order: readonly number[];
  placement: Placement;
  onChange: (next: Placement) => void;
  /** Já conferido: só leitura, com o resultado de cada termo. */
  checked: boolean;
}

/** O que viaja no arrasto: só o índice da descrição, sob um tipo nosso (um arrasto de fora não é aceito). */
const DRAG_TYPE = 'application/x-memoria-match';

const CHIP =
  'rounded-lg border border-brand-100 bg-brand-50 px-3 py-2 text-left text-sm text-neutral-800 transition-colors hover:bg-brand-100 dark:border-brand-900 dark:bg-brand-950/40 dark:text-neutral-100 dark:hover:bg-brand-950/70';

function readDragged(event: DragEvent, count: number): number | null {
  const raw = event.dataTransfer.getData(DRAG_TYPE);
  if (raw === '') return null;
  const index = Number(raw);
  return Number.isInteger(index) && index >= 0 && index < count ? index : null;
}

export function MatchCardBoard({ pairs, order, placement, onChange, checked }: MatchCardBoardProps) {
  // A descrição escolhida com um toque, esperando o termo.
  const [selected, setSelected] = useState<number | null>(null);
  const grade = checked ? gradePlacement(pairs, placement) : null;
  const tray = order.filter((d) => termOfDescription(placement, d) < 0);

  function pick(description: number) {
    if (checked) return;
    setSelected((current) => (current === description ? null : description));
  }

  function activateTerm(term: number) {
    if (checked) return;
    if (selected !== null) {
      onChange(placeDescription(placement, term, selected));
      setSelected(null);
    } else if (placement[term] !== null) {
      onChange(removeFromTerm(placement, term));
    }
  }

  function dropOnTerm(event: DragEvent, term: number) {
    if (checked) return;
    event.preventDefault();
    const description = readDragged(event, pairs.length);
    if (description === null) return;
    onChange(placeDescription(placement, term, description));
    setSelected(null);
  }

  function dropOnTray(event: DragEvent) {
    if (checked) return;
    event.preventDefault();
    const description = readDragged(event, pairs.length);
    if (description === null) return;
    const term = termOfDescription(placement, description);
    if (term >= 0) onChange(removeFromTerm(placement, term));
  }

  function startDrag(event: DragEvent, description: number) {
    event.dataTransfer.setData(DRAG_TYPE, String(description));
    event.dataTransfer.effectAllowed = 'move';
    setSelected(null);
  }

  function slotKeyDown(event: KeyboardEvent, term: number) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    activateTerm(term);
  }

  return (
    <div className="w-full space-y-4 text-left">
      {!checked && (
        <div
          onDragOver={(event) => event.preventDefault()}
          onDrop={dropOnTray}
          className="flex min-h-[3.5rem] flex-wrap gap-2 rounded-xl border border-dashed border-neutral-200 p-2 dark:border-neutral-700"
          aria-label="Descrições para colocar"
        >
          {tray.length === 0 ? (
            <p className="px-1 py-2 text-xs text-neutral-400 dark:text-neutral-500">
              Todas colocadas. Toque numa para devolvê-la, ou confira.
            </p>
          ) : (
            tray.map((d) => (
              <button
                key={d}
                type="button"
                draggable
                onDragStart={(event) => startDrag(event, d)}
                onClick={() => pick(d)}
                aria-pressed={selected === d}
                className={`${CHIP} ${selected === d ? 'ring-2 ring-brand-500' : ''}`}
              >
                {pairs[d].description}
              </button>
            ))
          )}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {pairs.map((pair, i) => {
          const placed = placement[i];
          const correct = grade?.correct[i] ?? null;
          const frame =
            correct === null
              ? 'border-neutral-200 dark:border-neutral-700'
              : correct
                ? 'border-green-300 bg-green-50 dark:border-green-900 dark:bg-green-950/30'
                : 'border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/30';
          return (
            <div key={pair.term} className={`rounded-xl border p-3 ${frame}`}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{pair.term}</p>
                {correct === true && <Check size={16} className="shrink-0 text-green-600 dark:text-green-400" aria-label="Certo" />}
                {correct === false && <X size={16} className="shrink-0 text-red-600 dark:text-red-400" aria-label="Errado" />}
              </div>
              <div
                role="button"
                tabIndex={checked ? -1 : 0}
                aria-label={`Termo ${pair.term}: ${placed === null ? 'vazio' : pairs[placed].description}`}
                aria-disabled={checked}
                draggable={!checked && placed !== null}
                onDragStart={(event) => placed !== null && startDrag(event, placed)}
                onDragOver={(event) => !checked && event.preventDefault()}
                onDrop={(event) => dropOnTerm(event, i)}
                onClick={() => activateTerm(i)}
                onKeyDown={(event) => slotKeyDown(event, i)}
                className={`min-h-[3rem] rounded-lg px-3 py-2 text-sm ${
                  placed !== null
                    ? checked
                      ? 'bg-white/70 text-neutral-800 dark:bg-neutral-900/50 dark:text-neutral-100'
                      : `${CHIP} cursor-pointer`
                    : `border border-dashed border-neutral-300 text-xs text-neutral-400 dark:border-neutral-600 dark:text-neutral-500 ${
                        checked ? '' : 'cursor-pointer hover:border-brand-400'
                      } ${selected !== null && !checked ? 'border-brand-400 bg-brand-50/50 dark:bg-brand-950/20' : ''}`
                }`}
              >
                {placed !== null
                  ? pairs[placed].description
                  : checked
                    ? 'Sem resposta'
                    : selected !== null
                      ? 'Toque para colocar aqui'
                      : 'Solte aqui'}
              </div>
              {correct === false && (
                <p className="mt-2 text-xs text-green-700 dark:text-green-400">
                  <span className="font-semibold">Certo:</span> {pair.description}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Os pares de um cartão de arrastar e soltar como lista de leitura (na coleção): "termo → descrição". */
export function MatchPairsList({ pairs, className = '' }: { pairs: readonly MatchPair[]; className?: string }) {
  return (
    <ul className={`space-y-1 ${className}`}>
      {pairs.map((pair) => (
        <li key={pair.term}>
          <span className="font-semibold text-neutral-800 dark:text-neutral-200">{pair.term}</span>
          <span className="text-neutral-400 dark:text-neutral-500"> → </span>
          {pair.description}
        </li>
      ))}
    </ul>
  );
}
