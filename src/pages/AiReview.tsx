import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, CheckCheck, Loader2, Pencil, ShieldCheck, Sparkles, Trash2, X } from 'lucide-react';

import { useConfirm } from '../contexts/ConfirmContext';
import { useToast } from '../contexts/ToastContext';
import { DRAFTS_CHANGED_EVENT } from '../hooks/usePendingDrafts';
import { aiReviewApi, ApiError } from '../services/api';
import type { AiDraft, AiDraftGroup, DraftVerdict } from '../types';
import { plural } from '../utils/exam';

const announce = () => window.dispatchEvent(new Event(DRAFTS_CHANGED_EVENT));

const VERDICT: Record<DraftVerdict, { label: string; className: string }> = {
  ok: { label: 'A outra IA achou correto', className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' },
  duvida: { label: 'A outra IA tem dúvida', className: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' },
  erro: { label: 'A outra IA vê um possível erro', className: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300' },
};

/** A segunda opinião sobre um cartão, com o motivo. É só um alerta: a decisão é sua. */
function VerdictNote({ draft }: { draft: AiDraft }) {
  if (!draft.verdict) return null;
  const v = VERDICT[draft.verdict];
  return (
    <p className={`mt-3 rounded-lg px-3 py-2 text-xs ${v.className}`}>
      <strong className="font-semibold">{v.label}.</strong>
      {draft.verdictNote ? ` ${draft.verdictNote}` : ''}
    </p>
  );
}

/** Um cartão esperando conferência: lido, aprovado, editado ou descartado. */
function DraftCard({
  draft,
  busy,
  onApprove,
  onDiscard,
  onSave,
}: {
  draft: AiDraft;
  busy: boolean;
  onApprove: () => void;
  onDiscard: () => void;
  /** Salva a edição; com `approve`, aprova em seguida. */
  onSave: (patch: { question: string; answer: string }, approve: boolean) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [question, setQuestion] = useState(draft.question);
  const [answer, setAnswer] = useState(draft.answer);
  const dirty = question.trim() !== draft.question || answer.trim() !== draft.answer;
  const valid = question.trim() !== '' && answer.trim() !== '';

  async function save(approve: boolean) {
    const saved = await onSave({ question, answer }, approve);
    if (saved && !approve) setEditing(false);
  }

  return (
    <li className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-700">
      {editing ? (
        <div className="space-y-3">
          <div>
            <label className="label-field" htmlFor={`q-${draft.id}`}>Pergunta</label>
            <textarea id={`q-${draft.id}`} className="input-field min-h-[4.5rem]" value={question} onChange={(e) => setQuestion(e.target.value)} disabled={busy} />
          </div>
          <div>
            <label className="label-field" htmlFor={`a-${draft.id}`}>Resposta</label>
            <textarea id={`a-${draft.id}`} className="input-field min-h-[4.5rem]" value={answer} onChange={(e) => setAnswer(e.target.value)} disabled={busy} />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" disabled={busy || !valid} onClick={() => void save(true)}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
              Salvar e aprovar
            </button>
            <button type="button" className="btn-secondary" disabled={busy || !valid || !dirty} onClick={() => void save(false)}>
              Salvar
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => {
                setQuestion(draft.question);
                setAnswer(draft.answer);
                setEditing(false);
              }}
            >
              <X size={15} />
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500">Pergunta</p>
          <p className="mb-3 whitespace-pre-wrap text-sm font-medium text-neutral-900 dark:text-neutral-100">{draft.question}</p>
          <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500">Resposta</p>
          <p className="whitespace-pre-wrap text-sm text-neutral-700 dark:text-neutral-300">{draft.answer}</p>
          <VerdictNote draft={draft} />
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="button" className="btn-primary !py-1.5 text-xs" disabled={busy} onClick={onApprove}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Aprovar
            </button>
            <button type="button" className="btn-secondary !py-1.5 text-xs" disabled={busy} onClick={() => setEditing(true)}>
              <Pencil size={14} />
              Editar
            </button>
            <button type="button" className="btn-secondary !py-1.5 text-xs text-red-600 dark:text-red-400" disabled={busy} onClick={onDiscard}>
              <Trash2 size={14} />
              Descartar
            </button>
          </div>
        </>
      )}
    </li>
  );
}

/**
 * Os cartões que a IA escreveu para os tópicos do edital, só a partir do título e sem texto-fonte. Ficam
 * aqui, fora da revisão, até serem conferidos: aprovar faz do rascunho um cartão de estudo comum; descartar
 * apaga; editar corrige o texto. Nada entra na fila de estudo sem a aprovação.
 */
export function AiReview() {
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [groups, setGroups] = useState<AiDraftGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [busyGroup, setBusyGroup] = useState<string | null>(null);

  const load = useCallback(
    () =>
      aiReviewApi
        .list()
        .then((r) => setGroups(r.groups))
        .catch(() => setError('Não foi possível carregar os cartões a conferir.')),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const total = groups?.reduce((n, g) => n + g.drafts.length, 0) ?? 0;

  const withBusy = async (ids: string[], work: () => Promise<void>) => {
    setBusyIds((prev) => new Set([...prev, ...ids]));
    try {
      await work();
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    }
  };

  const remove = (ids: string[]) =>
    setGroups((prev) => (prev ?? []).map((g) => ({ ...g, drafts: g.drafts.filter((d) => !ids.includes(d.id)) })).filter((g) => g.drafts.length > 0));

  const approveOne = (draft: AiDraft) =>
    withBusy([draft.id], async () => {
      try {
        const r = await aiReviewApi.approve({ ids: [draft.id] });
        remove([draft.id]);
        announce();
        showToast(r.duplicates > 0 ? 'Esse cartão já existia na coleção: nada foi duplicado.' : 'Cartão aprovado: entra na sua revisão.');
      } catch (err) {
        showToast(err instanceof ApiError ? err.message : 'Não foi possível aprovar.', 'error');
        void load();
      }
    });

  const discardOne = (draft: AiDraft) =>
    withBusy([draft.id], async () => {
      try {
        await aiReviewApi.discard({ ids: [draft.id] });
        remove([draft.id]);
        announce();
        // Uma coleção de IA que ficou vazia é apagada pelo servidor: recarrega para a lista refletir isso.
        void load();
      } catch (err) {
        showToast(err instanceof ApiError ? err.message : 'Não foi possível descartar.', 'error');
        void load();
      }
    });

  const saveOne = (draft: AiDraft) => async (patch: { question: string; answer: string }, approve: boolean): Promise<boolean> => {
    let ok = false;
    await withBusy([draft.id], async () => {
      try {
        const { draft: saved } = await aiReviewApi.edit(draft.id, patch);
        setGroups((prev) => (prev ?? []).map((g) => ({ ...g, drafts: g.drafts.map((d) => (d.id === draft.id ? saved : d)) })));
        if (approve) {
          await aiReviewApi.approve({ ids: [draft.id] });
          remove([draft.id]);
          announce();
          showToast('Cartão corrigido e aprovado: entra na sua revisão.');
        } else {
          showToast('Alterações salvas. O cartão ainda espera a sua aprovação.');
        }
        ok = true;
      } catch (err) {
        showToast(err instanceof ApiError ? err.message : 'Não foi possível salvar.', 'error');
      }
    });
    return ok;
  };

  async function approveGroup(group: AiDraftGroup) {
    const flagged = group.drafts.filter((d) => d.verdict === 'duvida' || d.verdict === 'erro').length;
    const confirmed = await confirm({
      title: 'Aprovar todos os cartões',
      message:
        `Os ${plural(group.drafts.length, 'cartão', 'cartões')} de "${group.collection.name} · ${group.collection.subject}" passam a fazer parte da sua revisão. Só aprove todos se você já os conferiu.` +
        (flagged > 0 ? ` Atenção: ${plural(flagged, 'cartão foi marcado', 'cartões foram marcados')} pela outra IA com dúvida ou possível erro.` : ''),
      confirmLabel: 'Aprovar todos',
    });
    if (!confirmed) return;
    setBusyGroup(group.collection.id);
    try {
      const r = await aiReviewApi.approve({ collectionId: group.collection.id });
      showToast(`${plural(r.approved, 'cartão aprovado', 'cartões aprovados')}${r.duplicates > 0 ? ` (${r.duplicates} já existiam)` : ''}.`);
      announce();
      await load();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Não foi possível aprovar.', 'error');
    } finally {
      setBusyGroup(null);
    }
  }

  async function checkGroup(group: AiDraftGroup) {
    setBusyGroup(group.collection.id);
    try {
      const r = await aiReviewApi.check({ collectionId: group.collection.id });
      const parts = [`${r.counts.ok} ok`, `${r.counts.duvida} com dúvida`, `${r.counts.erro} com possível erro`].join(', ');
      showToast(
        r.error
          ? `Conferi ${plural(r.checked, 'cartão', 'cartões')} (${parts}) e parei: ${r.error}`
          : `Conferidos ${r.checked} de ${r.checked + r.unchecked}: ${parts}.`,
        r.error ? 'error' : 'success',
      );
      await load();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Não foi possível conferir com outra IA.', 'error');
    } finally {
      setBusyGroup(null);
    }
  }

  async function discardGroup(group: AiDraftGroup) {
    const confirmed = await confirm({
      title: 'Descartar todos os cartões',
      message: `Apagar os ${plural(group.drafts.length, 'cartão', 'cartões')} de "${group.collection.name} · ${group.collection.subject}"? Isso não pode ser desfeito. Depois você pode gerar de novo para o tópico.`,
      confirmLabel: 'Descartar todos',
      danger: true,
    });
    if (!confirmed) return;
    setBusyGroup(group.collection.id);
    try {
      const r = await aiReviewApi.discard({ collectionId: group.collection.id });
      showToast(`${plural(r.discarded, 'cartão descartado', 'cartões descartados')}.`);
      announce();
      await load();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Não foi possível descartar.', 'error');
    } finally {
      setBusyGroup(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="flex items-center gap-2 text-2xl font-bold text-neutral-900 dark:text-neutral-100">
        <Sparkles size={22} className="text-brand-600 dark:text-brand-400" />
        Cartões da IA a conferir
      </h1>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        A IA escreveu estes cartões só a partir do título do tópico, sem texto-fonte, e pode errar, sobretudo em leis, números e datas.
        Eles <strong className="font-semibold text-neutral-700 dark:text-neutral-200">só entram na sua revisão depois de aprovados</strong>.
      </p>

      {error && <p className="mt-6 text-sm text-red-600">{error}</p>}
      {!groups && !error && <p className="mt-6 text-sm text-neutral-400 dark:text-neutral-500">Carregando...</p>}

      {groups && groups.length === 0 && (
        <div className="card mt-6 flex flex-col items-center gap-3 px-6 py-14 text-center">
          <CheckCheck size={28} className="text-brand-600 dark:text-brand-400" />
          <p className="text-sm text-neutral-500 dark:text-neutral-400">Nenhum cartão da IA esperando conferência.</p>
          <Link to="/concursos" className="btn-primary">
            Ver concursos
          </Link>
        </div>
      )}

      {groups && groups.length > 0 && (
        <>
          <p className="mt-5 text-sm font-medium text-neutral-700 dark:text-neutral-200">
            {plural(total, 'cartão espera', 'cartões esperam')} a sua conferência, em {plural(groups.length, 'coleção', 'coleções')}.
          </p>
          <div className="mt-4 space-y-6">
            {groups.map((group) => {
              const groupBusy = busyGroup === group.collection.id;
              return (
                <section key={group.collection.id} className="card p-5" aria-label={`${group.collection.name}: ${group.collection.subject}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                        {group.collection.name}
                        {group.collection.subject && <span className="font-normal text-neutral-500 dark:text-neutral-400"> · {group.collection.subject}</span>}
                      </h2>
                      {group.topic && (
                        <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                          Tópico do edital:{' '}
                          <Link to={`/concursos/${group.topic.examId}`} className="font-medium hover:text-brand-600 hover:underline">
                            {group.topic.title}
                          </Link>{' '}
                          · {group.topic.discipline} · {group.topic.examName}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn-secondary !py-1.5 text-xs"
                        disabled={groupBusy}
                        onClick={() => void checkGroup(group)}
                        title="Pede a outra IA uma segunda opinião sobre cada cartão. É só um alerta: nada é aprovado nem descartado por ela."
                      >
                        {groupBusy ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                        Conferir com outra IA
                      </button>
                      <button type="button" className="btn-secondary !py-1.5 text-xs" disabled={groupBusy} onClick={() => void approveGroup(group)}>
                        {groupBusy ? <Loader2 size={14} className="animate-spin" /> : <CheckCheck size={14} />}
                        Aprovar todos ({group.drafts.length})
                      </button>
                      <button type="button" className="btn-secondary !py-1.5 text-xs text-red-600 dark:text-red-400" disabled={groupBusy} onClick={() => void discardGroup(group)}>
                        <Trash2 size={14} />
                        Descartar todos
                      </button>
                    </div>
                  </div>
                  <ul className="mt-4 space-y-3">
                    {group.drafts.map((draft) => (
                      <DraftCard
                        key={draft.id}
                        draft={draft}
                        busy={groupBusy || busyIds.has(draft.id)}
                        onApprove={() => void approveOne(draft)}
                        onDiscard={() => void discardOne(draft)}
                        onSave={saveOne(draft)}
                      />
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
