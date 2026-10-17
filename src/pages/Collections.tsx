import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  ChevronRight,
  GraduationCap,
  Layers,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react';

import { ApiError, collectionsApi, flashcardsApi, statsApi } from '../services/api';
import { useConfirm } from '../contexts/ConfirmContext';
import { useToast } from '../contexts/ToastContext';
import type { CollectionSummary, DashboardData, DuplicateGroup } from '../types';
import { filterCollections } from '../utils/collectionFilter';
import {
  groupByDiscipline,
  groupTotals,
  loadExpandedGroups,
  saveExpandedGroups,
  type CollectionEntry,
} from '../utils/collectionGroups';

function stripHtml(value: string, format: string): string {
  return format === 'html' ? value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : value;
}

type SortKey = 'name' | 'flashcardCount' | 'status' | 'updatedAt';

/** Uma disciplina da lista: coleções de mesmo nome. */
type GroupEntry = Extract<CollectionEntry<CollectionSummary>, { kind: 'group' }>;

const STATUS_LABEL: Record<CollectionSummary['status'], { text: string; className: string }> = {
  sem_documento: { text: 'Sem documento', className: 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400' },
  processing: { text: 'Processando', className: 'bg-amber-100 text-amber-700' },
  completed: { text: 'Concluída', className: 'bg-brand-100 text-brand-700' },
  error: { text: 'Erro', className: 'bg-red-100 text-red-700' },
};

export function Collections() {
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [collections, setCollections] = useState<CollectionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editSubject, setEditSubject] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[] | null>(null);
  const [showDuplicatesModal, setShowDuplicatesModal] = useState(false);

  const loadDuplicates = useCallback(() => {
    flashcardsApi
      .findDuplicates()
      .then(({ groups }) => setDuplicateGroups(groups))
      .catch(() => setDuplicateGroups(null));
  }, []);

  useEffect(() => {
    loadDuplicates();
  }, [loadDuplicates]);

  // O plano do dia (os números do Painel): com limite diário de novos, o aviso mostra a meta de
  // hoje em vez de todo o acervo pendente.
  const [plan, setPlan] = useState<DashboardData | null>(null);
  useEffect(() => {
    statsApi
      .dashboard()
      .then(setPlan)
      .catch(() => {});
  }, []);

  async function handleDeleteDuplicate(fcId: string) {
    const ok = await confirm({ message: 'Excluir este flashcard duplicado? Essa ação não pode ser desfeita.', danger: true });
    if (!ok) return;
    try {
      await flashcardsApi.remove(fcId);
      showToast('Flashcard duplicado excluído.');
      loadDuplicates();
      collectionsApi.list().then(({ collections }) => setCollections(collections));
    } catch {
      showToast('Não foi possível excluir o flashcard.', 'error');
    }
  }

  const totalDue = useMemo(() => collections?.reduce((sum, c) => sum + c.dueCount, 0) ?? 0, [collections]);
  const collectionsWithDue = useMemo(
    () => collections?.filter((c) => c.dueCount > 0).length ?? 0,
    [collections],
  );
  const totalFavorites = useMemo(
    () => collections?.reduce((sum, c) => sum + c.favoriteCount, 0) ?? 0,
    [collections],
  );

  const sortedCollections = useMemo(() => {
    if (!collections || !sortKey) return collections;
    const copy = [...collections];
    copy.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name':
          cmp = a.name.localeCompare(b.name, 'pt-BR');
          break;
        case 'flashcardCount':
          cmp = a.flashcardCount - b.flashcardCount;
          break;
        case 'status':
          cmp = STATUS_LABEL[a.status].text.localeCompare(STATUS_LABEL[b.status].text, 'pt-BR');
          break;
        case 'updatedAt':
          cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [collections, sortKey, sortDir]);

  // A pesquisa fica no endereço (?q=...): ao abrir uma coleção e voltar, o filtro continua lá.
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('q') ?? '';
  function setQuery(value: string) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set('q', value);
        else next.delete('q');
        return next;
      },
      { replace: true },
    );
  }
  const visibleCollections = useMemo(
    () => (sortedCollections ? filterCollections(sortedCollections, query) : sortedCollections),
    [sortedCollections, query],
  );

  // As disciplinas (coleções de mesmo nome) ficam fechadas até o usuário abrir, e a escolha é lembrada
  // neste navegador. Pesquisando, todas abrem: o que casou com a pesquisa precisa estar à vista.
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => loadExpandedGroups());
  const entries = useMemo(() => groupByDiscipline(visibleCollections ?? []), [visibleCollections]);
  const groupKeys = useMemo(() => entries.flatMap((e) => (e.kind === 'group' ? [e.key] : [])), [entries]);
  const searching = query.trim() !== '';
  const isExpanded = (key: string) => searching || expandedGroups.has(key);
  const allExpanded = groupKeys.length > 0 && groupKeys.every((key) => expandedGroups.has(key));
  function setExpanded(next: Set<string>) {
    setExpandedGroups(next);
    saveExpandedGroups(next);
  }
  function toggleGroup(key: string) {
    const next = new Set(expandedGroups);
    if (!next.delete(key)) next.add(key);
    setExpanded(next);
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  function SortableHeader({ label, sortKeyName }: { label: string; sortKeyName: SortKey }) {
    const isActive = sortKey === sortKeyName;
    return (
      <th className="px-6 py-3 font-medium">
        <button
          type="button"
          onClick={() => handleSort(sortKeyName)}
          className="flex items-center gap-1 text-neutral-400 transition-colors hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300"
        >
          {label}
          {isActive ? (
            sortDir === 'asc' ? (
              <ArrowUp size={12} />
            ) : (
              <ArrowDown size={12} />
            )
          ) : (
            <ArrowUpDown size={12} className="opacity-40" />
          )}
        </button>
      </th>
    );
  }

  useEffect(() => {
    collectionsApi
      .list()
      .then(({ collections }) => setCollections(collections))
      .catch(() => setError('Não foi possível carregar suas coleções.'));
  }, []);

  function startEdit(c: CollectionSummary) {
    setEditingId(c.id);
    setEditName(c.name);
    setEditSubject(c.subject);
    setEditError(null);
  }

  async function saveEdit(id: string) {
    // O servidor ignora em silêncio um nome curto demais e mantém o antigo: avisar aqui,
    // para o "Salvo" nunca aparecer quando nada mudou.
    if (editName.trim().length < 2) {
      setEditError('O nome precisa ter pelo menos 2 caracteres.');
      return;
    }
    setSaving(true);
    setEditError(null);
    try {
      const { collection } = await collectionsApi.update(id, { name: editName.trim(), subject: editSubject });
      setCollections((prev) => prev?.map((c) => (c.id === id ? collection : c)) ?? prev);
      setEditingId(null);
      showToast('Coleção atualizada.');
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : 'Não foi possível salvar as alterações.');
    } finally {
      setSaving(false);
    }
  }

  const pencilClass =
    'shrink-0 p-1 text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300';

  /** O nome e o assunto da coleção; o lápis de qualquer um dos dois abre a edição dos dois. */
  function renderTitle(c: CollectionSummary, layout: 'tabela' | 'cartao', nested = false) {
    if (editingId === c.id) {
      return (
        <form
          className="max-w-sm space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void saveEdit(c.id);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setEditingId(null);
          }}
        >
          <div>
            <label className="label-field" htmlFor={`${layout}-collection-name-${c.id}`}>
              Nome
            </label>
            <input
              id={`${layout}-collection-name-${c.id}`}
              autoFocus
              className="input-field"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              maxLength={120}
              placeholder="Nome da coleção"
            />
          </div>
          <div>
            <label className="label-field" htmlFor={`${layout}-collection-subject-${c.id}`}>
              Assunto
            </label>
            <input
              id={`${layout}-collection-subject-${c.id}`}
              className="input-field text-xs"
              value={editSubject}
              onChange={(e) => setEditSubject(e.target.value)}
              placeholder="Adicione um assunto para essa coleção"
            />
          </div>
          {editError && <p className="text-xs text-red-600">{editError}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="text-xs font-semibold text-brand-600 hover:text-brand-700 disabled:opacity-60"
            >
              {saving ? 'Salvando...' : 'Salvar'}
            </button>
            <button
              type="button"
              onClick={() => setEditingId(null)}
              className="text-xs font-semibold text-neutral-500 hover:text-neutral-700"
            >
              Cancelar
            </button>
          </div>
        </form>
      );
    }
    // Dentro de uma disciplina o nome é o do grupo; o que distingue a coleção é o assunto.
    if (nested) {
      return (
        <div className="flex items-center gap-1">
          <p
            className={`text-sm font-medium ${
              c.subject ? 'text-neutral-800 dark:text-neutral-200' : 'italic text-neutral-400 dark:text-neutral-500'
            }`}
          >
            {c.subject || 'Sem assunto'}
          </p>
          <button type="button" onClick={() => startEdit(c)} className={pencilClass} title="Editar nome e assunto">
            <Pencil size={12} />
          </button>
        </div>
      );
    }
    return (
      <>
        <div className="flex items-center gap-1">
          <p className="font-medium text-neutral-900 dark:text-neutral-100">{c.name}</p>
          <button type="button" onClick={() => startEdit(c)} className={pencilClass} title="Editar nome e assunto">
            <Pencil size={12} />
          </button>
        </div>
        <div className="mt-0.5 flex items-center gap-1">
          <p className="line-clamp-1 text-xs text-neutral-400 dark:text-neutral-500">{c.subject || 'Sem assunto'}</p>
          <button type="button" onClick={() => startEdit(c)} className={pencilClass} title="Editar nome e assunto">
            <Pencil size={12} />
          </button>
        </div>
      </>
    );
  }

  // ---------- disciplinas: coleções de mesmo nome, agrupadas ----------

  const dueBadge = (n: number, extra = '') => (
    <span
      className={`rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 ${extra}`}
    >
      {n} a revisar
    </span>
  );

  /** A revisão dos pendentes de todas as coleções da disciplina (só as que têm algo pendente vão no endereço). */
  const studyHref = (group: GroupEntry) =>
    `/disciplina/estudar?ids=${group.items
      .filter((c) => c.dueCount > 0)
      .map((c) => c.id)
      .join(',')}&nome=${encodeURIComponent(group.name)}`;

  function renderTableRow(c: CollectionSummary, nested: boolean) {
    const status = STATUS_LABEL[c.status];
    return (
      <tr
        key={c.id}
        className="border-b border-neutral-50 last:border-0 hover:bg-neutral-50/60 dark:border-neutral-800 dark:hover:bg-neutral-800/60"
      >
        <td className={nested ? 'border-l-2 border-brand-300 py-4 pl-14 pr-6 dark:border-brand-700' : 'px-6 py-4'}>
          {renderTitle(c, 'tabela', nested)}
        </td>
        <td className="px-6 py-4 text-neutral-600 dark:text-neutral-300">
          <div className="flex items-center gap-2">
            <span>{c.flashcardCount}</span>
            {c.dueCount > 0 && dueBadge(c.dueCount)}
          </div>
        </td>
        <td className="px-6 py-4">
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${status.className}`}>{status.text}</span>
        </td>
        <td className="px-6 py-4 text-neutral-500 dark:text-neutral-400">
          {new Date(c.updatedAt).toLocaleDateString('pt-BR')}
        </td>
        <td className="px-6 py-4 text-right">
          <Link to={`/colecoes/${c.id}`} className="font-semibold text-brand-600 hover:text-brand-700">
            Abrir
          </Link>
        </td>
      </tr>
    );
  }

  function renderGroupRow(group: GroupEntry) {
    const totals = groupTotals(group.items);
    const open = isExpanded(group.key);
    return (
      <tr className="border-b border-neutral-100 bg-neutral-50/70 dark:border-neutral-800 dark:bg-neutral-800/40">
        <td className="px-6 py-4">
          <button
            type="button"
            onClick={() => toggleGroup(group.key)}
            aria-expanded={open}
            className="flex items-center gap-2 text-left"
            title={open ? 'Recolher as coleções desta disciplina' : 'Mostrar as coleções desta disciplina'}
          >
            <ChevronRight
              size={16}
              className={`shrink-0 text-neutral-400 transition-transform dark:text-neutral-500 ${open ? 'rotate-90' : ''}`}
            />
            <span>
              <span className="block font-semibold text-neutral-900 dark:text-neutral-100">{group.name}</span>
              <span className="block text-xs text-neutral-400 dark:text-neutral-500">
                {group.items.length} coleções
              </span>
            </span>
          </button>
        </td>
        <td className="px-6 py-4 text-neutral-600 dark:text-neutral-300">
          <div className="flex items-center gap-2">
            <span>{totals.flashcards}</span>
            {totals.due > 0 && dueBadge(totals.due)}
          </div>
        </td>
        <td className="px-6 py-4" />
        <td className="px-6 py-4 text-neutral-500 dark:text-neutral-400">
          {new Date(totals.updatedAt).toLocaleDateString('pt-BR')}
        </td>
        <td className="px-6 py-4 text-right">
          {totals.due > 0 && (
            <Link
              to={studyHref(group)}
              className="btn-primary whitespace-nowrap"
              title={`Junta os ${totals.due} pendentes de todas as ${group.items.length} coleções de ${group.name}`}
            >
              <GraduationCap size={16} />
              Estudar a disciplina inteira
            </Link>
          )}
        </td>
      </tr>
    );
  }

  function renderCard(c: CollectionSummary, nested: boolean) {
    const status = STATUS_LABEL[c.status];
    return (
      <div key={c.id} className={`card p-4 ${nested ? 'ml-4 border-l-2 border-l-brand-300 dark:border-l-brand-700' : ''}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">{renderTitle(c, 'cartao', nested)}</div>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${status.className}`}>
            {status.text}
          </span>
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-neutral-100 pt-3 text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
          <span className="flex items-center gap-1.5">
            {c.flashcardCount} flashcard{c.flashcardCount === 1 ? '' : 's'} ·{' '}
            {new Date(c.updatedAt).toLocaleDateString('pt-BR')}
            {c.dueCount > 0 && dueBadge(c.dueCount)}
          </span>
          <Link to={`/colecoes/${c.id}`} className="font-semibold text-brand-600 hover:text-brand-700">
            Abrir
          </Link>
        </div>
      </div>
    );
  }

  function renderGroupCard(group: GroupEntry) {
    const totals = groupTotals(group.items);
    const open = isExpanded(group.key);
    return (
      <div className="card bg-neutral-50/70 p-4 dark:bg-neutral-800/40">
        <button
          type="button"
          onClick={() => toggleGroup(group.key)}
          aria-expanded={open}
          className="flex w-full items-center gap-2 text-left"
        >
          <ChevronRight
            size={16}
            className={`shrink-0 text-neutral-400 transition-transform dark:text-neutral-500 ${open ? 'rotate-90' : ''}`}
          />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-neutral-900 dark:text-neutral-100">{group.name}</span>
            <span className="block text-xs text-neutral-400 dark:text-neutral-500">
              {group.items.length} coleções · {totals.flashcards} flashcards
            </span>
          </span>
          {totals.due > 0 && dueBadge(totals.due, 'shrink-0')}
        </button>
        {totals.due > 0 && (
          <Link to={studyHref(group)} className="btn-primary mt-3 w-full">
            <GraduationCap size={16} />
            Estudar a disciplina inteira
          </Link>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Suas coleções</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Envie um arquivo, cole um texto ou um link do YouTube e deixe a IA transformar em flashcards.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 self-start sm:self-auto">
          <Link to="/importar-anki" className="btn-secondary">
            <Upload size={16} />
            Importar do Anki
          </Link>
          <Link to="/colecoes/nova" className="btn-primary">
            <Plus size={16} />
            Gerar flashcards
          </Link>
        </div>
      </div>

      {plan && plan.dailyNewLimit !== null ? (
        // Com limite diário de novos: a meta de hoje (a mesma conta do Painel e da revisão), não todo o acervo pendente.
        plan.remaining.total > 0 ? (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 dark:border-brand-900 dark:bg-brand-950/30">
            <div className="flex items-center gap-2 text-sm text-brand-800 dark:text-brand-300">
              <GraduationCap size={16} className="shrink-0" />
              <span>
                Meta de hoje: <strong>{plan.remaining.total.toLocaleString('pt-BR')}</strong> cartões (
                {(plan.remaining.learning + plan.remaining.due).toLocaleString('pt-BR')} revisões +{' '}
                {plan.remaining.new.toLocaleString('pt-BR')} novos)
                {plan.remaining.estimatedMin !== null && ` · cerca de ${Math.max(1, Math.round(plan.remaining.estimatedMin))} min`}
                {plan.remaining.newWaiting > 0 &&
                  ` · ${plan.remaining.newWaiting.toLocaleString('pt-BR')} ${plan.remaining.newWaiting === 1 ? 'novo aguarda' : 'novos aguardam'}`}
                .
              </span>
            </div>
            <Link to="/revisar" className="btn-primary shrink-0">
              Revisar agora
            </Link>
          </div>
        ) : (
          (totalDue > 0 || plan.remaining.newWaiting > 0) && (
            <div className="mb-6 flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800 dark:border-brand-900 dark:bg-brand-950/30 dark:text-brand-300">
              <CheckCircle2 size={16} className="shrink-0" />
              <span>
                Meta de hoje concluída!
                {plan.remaining.newWaiting > 0 &&
                  ` ${plan.remaining.newWaiting.toLocaleString('pt-BR')} ${plan.remaining.newWaiting === 1 ? 'cartão novo aguarda' : 'cartões novos aguardam'} os próximos dias (limite de ${plan.dailyNewLimit.toLocaleString('pt-BR')} por dia).`}
              </span>
            </div>
          )
        )
      ) : (
        totalDue > 0 && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 dark:border-brand-900 dark:bg-brand-950/30">
            <div className="flex items-center gap-2 text-sm text-brand-800 dark:text-brand-300">
              <GraduationCap size={16} className="shrink-0" />
              <span>
                Você tem {totalDue} flashcard{totalDue === 1 ? '' : 's'} para revisar hoje, em {collectionsWithDue}{' '}
                coleç{collectionsWithDue === 1 ? 'ão' : 'ões'}.
              </span>
            </div>
            <Link to="/revisar" className="btn-primary shrink-0">
              Revisar agora
            </Link>
          </div>
        )
      )}

      {totalFavorites > 0 && (
        <div className="card mb-6 flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
            <Star size={16} className="shrink-0 text-amber-500" fill="currentColor" />
            <span>
              Você tem {totalFavorites} flashcard{totalFavorites === 1 ? '' : 's'} favoritado
              {totalFavorites === 1 ? '' : 's'}.
            </span>
          </div>
          <Link to="/favoritos" className="btn-secondary shrink-0">
            Revisar favoritos
          </Link>
        </div>
      )}

      {duplicateGroups && duplicateGroups.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900 dark:bg-amber-950/30">
          <div className="flex items-center gap-2 text-sm text-amber-800 dark:text-amber-300">
            <AlertTriangle size={16} className="shrink-0" />
            <span>
              Você tem{' '}
              {duplicateGroups.reduce((sum, g) => sum + g.flashcards.length - 1, 0)} flashcard
              {duplicateGroups.reduce((sum, g) => sum + g.flashcards.length - 1, 0) === 1 ? '' : 's'} duplicado
              {duplicateGroups.reduce((sum, g) => sum + g.flashcards.length - 1, 0) === 1 ? '' : 's'} entre suas
              coleções.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowDuplicatesModal(true)}
            className="shrink-0 text-sm font-semibold text-amber-800 hover:underline dark:text-amber-300"
          >
            Ver duplicados
          </button>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {collections === null && !error && <p className="text-sm text-neutral-400 dark:text-neutral-500">Carregando...</p>}

      {collections !== null && collections.length === 0 && (
        <div className="card flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400">
            <Layers size={22} />
          </div>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">Você ainda não possui nenhuma coleção gerada.</p>
          <Link to="/colecoes/nova" className="btn-primary mt-2">
            <Plus size={16} />
            Criar minha primeira coleção
          </Link>
        </div>
      )}

      {collections !== null && collections.length > 0 && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="relative min-w-0 flex-1 sm:max-w-md">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 dark:text-neutral-500"
              />
              <input
                type="text"
                className="input-field pl-9 pr-9"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setQuery('');
                }}
                placeholder="Pesquisar por nome ou assunto..."
                aria-label="Pesquisar coleções por nome ou assunto"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300"
                  aria-label="Limpar pesquisa"
                  title="Limpar pesquisa (Esc)"
                >
                  <X size={15} />
                </button>
              )}
            </div>
            {query.trim() && (
              <p className="text-sm text-neutral-500 dark:text-neutral-400" aria-live="polite">
                {visibleCollections!.length} de {collections.length} coleç{collections.length === 1 ? 'ão' : 'ões'}
              </p>
            )}
            {groupKeys.length > 0 && !searching && (
              <button
                type="button"
                onClick={() => setExpanded(allExpanded ? new Set() : new Set(groupKeys))}
                className="text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400"
              >
                {allExpanded ? 'Recolher todas as disciplinas' : 'Expandir todas as disciplinas'}
              </button>
            )}
          </div>

          {visibleCollections!.length === 0 ? (
            <div className="card flex flex-col items-center gap-3 px-6 py-12 text-center">
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                Nenhuma coleção tem &quot;{query.trim()}&quot; no nome ou no assunto.
              </p>
              <button type="button" onClick={() => setQuery('')} className="btn-secondary">
                Limpar pesquisa
              </button>
            </div>
          ) : (
            <>
              {/* Tabela — telas médias e maiores. Em telas de celular uma tabela de
                  5 colunas não cabe, por isso ela fica escondida e substituída
                  pelos cards logo abaixo. As coleções de mesmo nome formam uma disciplina,
                  com uma linha própria que abre e fecha as coleções dela. */}
              <div className="card hidden overflow-hidden md:block">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-neutral-100 bg-neutral-50/60 text-xs uppercase tracking-wide text-neutral-400 dark:border-neutral-800 dark:bg-neutral-800/60 dark:text-neutral-500">
                    <tr>
                      <SortableHeader label="Nome da coleção" sortKeyName="name" />
                      <SortableHeader label="Flashcards" sortKeyName="flashcardCount" />
                      <SortableHeader label="Status" sortKeyName="status" />
                      <SortableHeader label="Atualizada em" sortKeyName="updatedAt" />
                      <th className="px-6 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) =>
                      entry.kind === 'single' ? (
                        renderTableRow(entry.item, false)
                      ) : (
                        <Fragment key={entry.key}>
                          {renderGroupRow(entry)}
                          {isExpanded(entry.key) && entry.items.map((c) => renderTableRow(c, true))}
                        </Fragment>
                      ),
                    )}
                  </tbody>
                </table>
              </div>

              {/* Cards — só em telas de celular (abaixo de md). */}
              <div className="space-y-3 md:hidden">
                {entries.map((entry) =>
                  entry.kind === 'single' ? (
                    renderCard(entry.item, false)
                  ) : (
                    <Fragment key={entry.key}>
                      {renderGroupCard(entry)}
                      {isExpanded(entry.key) && entry.items.map((c) => renderCard(c, true))}
                    </Fragment>
                  ),
                )}
              </div>
            </>
          )}
        </>
      )}

      {showDuplicatesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="card flex max-h-[80vh] w-full max-w-lg flex-col p-6">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                Flashcards duplicados
              </h2>
              <button
                type="button"
                onClick={() => setShowDuplicatesModal(false)}
                className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:text-neutral-500 dark:hover:bg-neutral-800"
              >
                <X size={18} />
              </button>
            </div>
            <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
              Mesma resposta encontrada em mais de uma coleção (a pergunta pode ser diferente). Exclua as cópias
              que não precisa manter.
            </p>

            <div className="-mx-6 min-h-0 flex-1 overflow-y-auto px-6">
              {!duplicateGroups || duplicateGroups.length === 0 ? (
                <p className="text-sm text-neutral-400 dark:text-neutral-500">Nenhum duplicado encontrado.</p>
              ) : (
                <div className="space-y-4">
                  {duplicateGroups.map((group) => (
                    <div
                      key={group.flashcards[0].id}
                      className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-700"
                    >
                      <p className="mb-2 line-clamp-2 text-sm font-medium text-neutral-800 dark:text-neutral-200">
                        {stripHtml(group.flashcards[0].answer, group.flashcards[0].format)}
                      </p>
                      <div className="space-y-1.5">
                        {group.flashcards.map((fc) => (
                          <div
                            key={fc.id}
                            className="flex items-center justify-between gap-2 rounded-md bg-neutral-50 px-2.5 py-1.5 text-xs dark:bg-neutral-800/60"
                          >
                            <div className="min-w-0">
                              <Link
                                to={`/colecoes/${fc.collectionId}`}
                                className="truncate font-medium text-brand-600 hover:underline dark:text-brand-400"
                              >
                                {fc.collectionName}
                                {fc.collectionSubject ? ` — ${fc.collectionSubject}` : ''}
                              </Link>
                              <p className="truncate text-neutral-500 dark:text-neutral-400">
                                {stripHtml(fc.question, fc.format)}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleDeleteDuplicate(fc.id)}
                              className="shrink-0 rounded p-1 text-neutral-400 hover:bg-red-50 hover:text-red-600 dark:text-neutral-500 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                              title="Excluir este flashcard"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
