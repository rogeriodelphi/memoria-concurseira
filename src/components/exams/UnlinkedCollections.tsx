import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, EyeOff, Link2, Loader2, Undo2 } from 'lucide-react';

import { useToast } from '../../contexts/ToastContext';
import { ApiError, examsApi } from '../../services/api';
import type { IgnoredCollection, UnlinkedCollection } from '../../types';
import {
  collectionSize,
  filterTopics,
  groupTopics,
  INITIAL_ROWS,
  matchLabel,
  MAX_OPTIONS,
  SEARCH_THRESHOLD,
  tiedMessage,
  unlinkedSummary,
  type TopicOption,
} from '../../utils/unlinked';

const label = (c: { name: string; subject: string }) => (c.subject ? `${c.name} · ${c.subject}` : c.name);

/** Escolher à mão o tópico de uma coleção: uma busca (quando a lista é longa) e a lista de tópicos por disciplina. */
function TopicPicker({ topics, busy, onLink, onCancel }: { topics: TopicOption[]; busy: boolean; onLink: (topicId: string) => void; onCancel: () => void }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('');
  const found = useMemo(() => filterTopics(topics, query), [topics, query]);
  const shown = found.slice(0, MAX_OPTIONS);
  const groups = useMemo(() => groupTopics(shown), [shown]);

  return (
    <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      {topics.length > SEARCH_THRESHOLD && (
        <input
          type="search"
          className="input-field !py-1.5 text-sm sm:!w-44"
          placeholder="Buscar tópico..."
          aria-label="Buscar tópico"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected('');
          }}
        />
      )}
      <select className="input-field min-w-0 !py-1.5 text-sm sm:flex-1" aria-label="Tópico do edital" value={selected} onChange={(e) => setSelected(e.target.value)}>
        <option value="">{found.length === 0 ? 'Nenhum tópico encontrado' : 'Escolha o tópico...'}</option>
        {groups.map((g) => (
          <optgroup key={`${g.discipline}-${g.topics[0].id}`} label={g.discipline}>
            {g.topics.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <div className="flex items-center gap-2">
        <button type="button" className="btn-primary !py-1.5 text-xs" disabled={!selected || busy} onClick={() => onLink(selected)}>
          Ligar
        </button>
        <button type="button" className="px-1 text-xs text-neutral-500 hover:underline" onClick={onCancel}>
          cancelar
        </button>
      </div>
      {found.length > MAX_OPTIONS && <p className="w-full text-[11px] text-neutral-500 dark:text-neutral-400">Mostrando {MAX_OPTIONS} de {found.length}: use a busca para afunilar.</p>}
    </div>
  );
}

/**
 * Coleções suas que ainda não estão ligadas a nenhum tópico deste concurso. Enquanto soltas, os cartões delas não entram no
 * progresso do concurso, na Reta final nem na ordem dos novos pelo edital. Cada coleção vem com os tópicos que combinam
 * (ligar é um clique) ou, quando não há, com a escolha à mão; e dá para dizer que ela não é deste concurso (uma coleção
 * de legislação que serve a outro edital, por exemplo). Nada é ligado sem o seu clique.
 */
export function UnlinkedCollections({
  examId,
  unlinked,
  ignored,
  topics,
  onChanged,
}: {
  examId: string;
  unlinked: UnlinkedCollection[];
  ignored: IgnoredCollection[];
  topics: TopicOption[];
  /** Recarrega o concurso depois de uma mudança. */
  onChanged: () => Promise<void>;
}) {
  const { showToast } = useToast();
  const [open, setOpen] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [showIgnored, setShowIgnored] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function run(id: string, action: () => Promise<void>, failure: string) {
    setBusyId(id);
    try {
      await action();
      await onChanged();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : failure, 'error');
    } finally {
      setBusyId(null);
    }
  }

  const link = (collection: UnlinkedCollection, topicId: string) =>
    run(
      collection.id,
      async () => {
        const { added } = await examsApi.addLinks(examId, [{ topicId, collectionIds: [collection.id] }]);
        const topic = topics.find((t) => t.id === topicId);
        showToast(added > 0 ? `“${label(collection)}” ligada a “${topic?.title ?? 'tópico'}”.` : 'Essa coleção já estava ligada a esse tópico.');
        setPicking(null);
      },
      'Não foi possível ligar a coleção.',
    );

  const ignore = (collection: UnlinkedCollection) =>
    run(
      collection.id,
      async () => {
        await examsApi.ignoreCollection(examId, collection.id);
        showToast(`“${label(collection)}” não aparece mais aqui (você pode mostrá-la de novo).`);
      },
      'Não foi possível esconder a coleção.',
    );

  const unignore = (collection: IgnoredCollection) =>
    run(collection.id, () => examsApi.unignoreCollection(examId, collection.id).then(() => undefined), 'Não foi possível mostrar a coleção de novo.');

  const rows = showAll ? unlinked : unlinked.slice(0, INITIAL_ROWS);

  return (
    <section className="card mb-4 p-5" aria-label="Coleções sem ligação ao edital">
      <button type="button" className="flex w-full items-start justify-between gap-3 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="min-w-0">
          <span className="flex items-center gap-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            <Link2 size={16} className="text-brand-600 dark:text-brand-400" />
            Coleções ainda sem ligação ao edital
          </span>
          <span className="mt-0.5 block text-xs text-neutral-500 dark:text-neutral-400">
            {unlinked.length > 0
              ? `${unlinkedSummary(unlinked)}. Enquanto soltas, os cartões delas não entram no progresso, na Reta final nem na ordem pelo edital.`
              : 'Todas as suas coleções estão ligadas a algum tópico (ou escondidas deste concurso).'}
          </span>
        </span>
        {open ? <ChevronDown size={18} className="mt-0.5 shrink-0 text-neutral-400" /> : <ChevronRight size={18} className="mt-0.5 shrink-0 text-neutral-400" />}
      </button>

      {open && (
        <>
          {unlinked.length > 0 && (
            <ul className="mt-4 space-y-3">
              {rows.map((c) => {
                const busy = busyId === c.id;
                return (
                  <li key={c.id} className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-700">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{label(c)}</p>
                        <p className="text-[11px] text-neutral-500 dark:text-neutral-400">{collectionSize(c)}</p>
                      </div>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:underline disabled:opacity-50"
                        disabled={busy}
                        onClick={() => ignore(c)}
                        title="Esta coleção serve a outro concurso: ela sai desta lista"
                      >
                        <EyeOff size={12} />
                        Não é deste concurso
                      </button>
                    </div>

                    {c.suggestions.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {c.suggestions.map((s) => (
                          <button
                            key={s.topicId}
                            type="button"
                            className="btn-secondary !items-start !py-1 text-left text-xs"
                            disabled={busy}
                            onClick={() => link(c, s.topicId)}
                            title={`Ligar a “${s.title}” (${s.discipline})`}
                          >
                            <Link2 size={12} className="mt-0.5 shrink-0" />
                            <span>
                              Ligar a “{s.title}”
                              <span className="block font-normal text-neutral-500 dark:text-neutral-400">
                                {s.discipline} · {matchLabel(s)}
                                {s.linked && ' · o tópico já tem outra coleção'}
                              </span>
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                    {c.tied > 0 && <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{tiedMessage(c.tied)}</p>}
                    {c.suggestions.length === 0 && c.tied === 0 && (
                      <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">Nenhum tópico parecido por palavras: escolha o tópico, ou diga que ela não é deste concurso.</p>
                    )}

                    <div className="mt-2 flex items-center gap-2">
                      {picking === c.id ? (
                        <TopicPicker topics={topics} busy={busy} onLink={(topicId) => link(c, topicId)} onCancel={() => setPicking(null)} />
                      ) : (
                        <button type="button" className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-300" disabled={busy} onClick={() => setPicking(c.id)}>
                          {c.suggestions.length > 0 ? 'Escolher outro tópico...' : 'Escolher o tópico...'}
                        </button>
                      )}
                      {busy && <Loader2 size={14} className="animate-spin text-neutral-400" />}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {unlinked.length > INITIAL_ROWS && (
            <button type="button" className="mt-3 text-xs font-medium text-brand-700 hover:underline dark:text-brand-300" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Mostrar só as primeiras' : `Mostrar as outras ${unlinked.length - INITIAL_ROWS}`}
            </button>
          )}

          {ignored.length > 0 && (
            <div className="mt-4 border-t border-neutral-100 pt-3 dark:border-neutral-800">
              <button type="button" className="flex items-center gap-1 text-xs font-medium text-neutral-500 hover:text-neutral-700 dark:text-neutral-400" onClick={() => setShowIgnored((v) => !v)} aria-expanded={showIgnored}>
                {showIgnored ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                Escondidas neste concurso ({ignored.length})
              </button>
              {showIgnored && (
                <ul className="mt-2 space-y-1.5">
                  {ignored.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-600 dark:text-neutral-300">
                      <span>
                        {label(c)} <span className="text-neutral-400">· {collectionSize(c)}</span>
                      </span>
                      <button type="button" className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline disabled:opacity-50 dark:text-brand-300" disabled={busyId === c.id} onClick={() => unignore(c)}>
                        <Undo2 size={12} />
                        Mostrar de novo
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
