import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { BookMarked, ChevronLeft, ChevronRight, FileSearch, FolderOpen, Library, Loader2, Play, Save, SlidersHorizontal } from 'lucide-react';

import { BankTabs } from '../components/questions/BankTabs';
import { NotebookModal } from '../components/questions/NotebookModal';
import { QuestionCard } from '../components/questions/QuestionCard';
import { QuestionFilters } from '../components/questions/QuestionFilters';
import { SaveFilterModal, SavedFiltersModal } from '../components/questions/SavedFiltersModal';
import { ApiError } from '../services/api';
import { questionBankApi } from '../services/questionBankApi';
import type { QbFacets, QbFilter, QbOrder, QbQuestion, QbSearchResult, QbStatus, QbTotals } from '../types';
import {
  activeCount,
  EMPTY_FILTER,
  lastPageOf,
  loadLastFilter,
  ORDER_LABEL,
  pageWindow,
  PAGE_SIZES,
  percent,
  saveLastFilter,
  type Chip,
} from '../utils/questionBank';

type Modal = null | 'caderno' | 'simulado' | 'salvar' | 'filtros';

/** O filtro com que a tela abre: vazio, ou o que veio no endereço (o atalho "ver as questões desta prova" etc.). */
function filterFromUrl(params: URLSearchParams): QbFilter {
  const exam = params.get('prova');
  const notebook = params.get('caderno');
  const status = params.get('status');
  return {
    ...EMPTY_FILTER,
    exam: exam ? [exam] : [],
    notebook: notebook ?? '',
    status: status && ['resolvidas', 'nao_resolvidas', 'acertei', 'errei'].includes(status) ? [status as QbStatus] : [],
  };
}

export function QuestionBank() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const initial = useMemo(() => filterFromUrl(params), []); // eslint-disable-line react-hooks/exhaustive-deps

  const [overview, setOverview] = useState<{ facets: QbFacets; totals: QbTotals } | null>(null);
  const [draft, setDraft] = useState<QbFilter>(initial);
  const [applied, setApplied] = useState<QbFilter>(initial);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [order, setOrder] = useState<QbOrder>('prova');
  const [result, setResult] = useState<QbSearchResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [canApplyLast, setCanApplyLast] = useState(() => loadLastFilter() !== null);
  const [reload, setReload] = useState(0);
  const listTop = useRef<HTMLDivElement>(null);
  const latest = useRef(0);

  const loadOverview = useCallback(() => {
    questionBankApi
      .overview()
      .then(setOverview)
      .catch(() => setError('Não foi possível carregar o banco de questões.'));
  }, []);
  useEffect(loadOverview, [loadOverview]);

  useEffect(() => {
    const ticket = ++latest.current;
    setLoading(true);
    questionBankApi
      .search({ filter: applied, page, pageSize, order })
      .then((r) => {
        if (ticket !== latest.current) return;
        setResult(r);
        setError(null);
        if (r.page !== page) setPage(r.page);
      })
      .catch((err) => ticket === latest.current && setError(err instanceof ApiError ? err.message : 'Não foi possível buscar as questões.'))
      .finally(() => ticket === latest.current && setLoading(false));
  }, [applied, page, pageSize, order, reload]);

  function apply(next: QbFilter) {
    setDraft(next);
    setApplied(next);
    setPage(1);
    if (activeCount(next) > 0) {
      saveLastFilter(next);
      setCanApplyLast(true);
    }
  }

  const clear = () => apply(EMPTY_FILTER);
  const applyLast = () => {
    const last = loadLastFilter();
    if (last) apply(last);
  };
  const removeChip = (chip: Chip) => {
    setDraft(chip.without(draft));
    apply(chip.without(applied));
  };

  function replace(next: QbQuestion) {
    setResult((prev) => (prev ? { ...prev, questions: prev.questions.map((q) => (q.id === next.id ? next : q)) } : prev));
  }

  function removed() {
    setReload((n) => n + 1);
    loadOverview();
  }

  function goTo(nextPage: number) {
    setPage(nextPage);
    listTop.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const totals = overview?.totals;
  const total = result?.total ?? 0;
  const lastPage = lastPageOf(total, pageSize);
  const isEmptyBank = totals !== undefined && totals.questions === 0;
  const filtered = activeCount(applied) > 0;

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Questões objetivas</h1>
      <p className="mb-5 mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        As questões das provas anteriores que você importou, com o gabarito. Filtre, responda, monte cadernos e faça simulados no estilo da banca.
      </p>
      <BankTabs />

      {isEmptyBank ? (
        <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400">
            <Library size={22} />
          </div>
          <p className="max-w-md text-sm text-neutral-500 dark:text-neutral-400">
            Seu banco de questões está vazio. Importe o PDF de uma prova antiga da banca do seu concurso (e o gabarito) e as questões
            aparecem aqui para você resolver.
          </p>
          <Link to="/questoes/importar" className="btn-primary">
            Importar a primeira prova
          </Link>
        </div>
      ) : (
        <>
          <QuestionFilters
            draft={draft}
            onDraft={setDraft}
            applied={applied}
            facets={overview?.facets ?? null}
            onApply={() => apply(draft)}
            onClear={clear}
            onApplyLast={applyLast}
            canApplyLast={canApplyLast}
            onRemoveChip={removeChip}
            busy={loading}
          />

          <div ref={listTop} className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100" aria-live="polite">
                {result === null ? 'Buscando...' : `${total.toLocaleString('pt-BR')} ${total === 1 ? 'questão encontrada' : 'questões encontradas'}`}
              </p>
              {totals && totals.answered > 0 && (
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  No banco todo: {totals.answered} de {totals.questions} resolvidas · {percent(totals.correct, totals.answered)}% de acerto
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                <span className="sr-only sm:not-sr-only">Por página</span>
                <select
                  className="input-field w-auto py-1.5 pr-8"
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(1);
                  }}
                  aria-label="Questões por página"
                >
                  {PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>
                      {n}/Página
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                <SlidersHorizontal size={14} className="shrink-0" />
                <select
                  className="input-field w-auto py-1.5 pr-8"
                  value={order}
                  onChange={(e) => {
                    setOrder(e.target.value as QbOrder);
                    setPage(1);
                  }}
                  aria-label="Ordenar por"
                >
                  {(Object.keys(ORDER_LABEL) as QbOrder[]).map((key) => (
                    <option key={key} value={key}>
                      {ORDER_LABEL[key]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="mb-5 flex flex-wrap gap-2">
            <button type="button" className="btn-secondary py-2" disabled={!filtered} onClick={() => setModal('salvar')} title={filtered ? '' : 'Aplique um filtro para poder salvá-lo'}>
              <Save size={16} />
              Salvar filtro
            </button>
            <button type="button" className="btn-secondary py-2" disabled={total === 0} onClick={() => setModal('caderno')}>
              <BookMarked size={16} />
              Gerar caderno
            </button>
            <Link to="/questoes/cadernos" className="btn-secondary py-2">
              <FolderOpen size={16} />
              Meus cadernos
            </Link>
            <button type="button" className="btn-secondary py-2" onClick={() => setModal('filtros')}>
              <SlidersHorizontal size={16} />
              Meus filtros
            </button>
            <button type="button" className="btn-primary py-2" disabled={total === 0} onClick={() => setModal('simulado')}>
              <Play size={16} />
              Criar simulado
            </button>
          </div>

          {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

          <div className={`space-y-4 transition-opacity ${loading && result ? 'opacity-60' : ''}`}>
            {result === null && !error && (
              <p className="flex items-center gap-2 text-sm text-neutral-400">
                <Loader2 size={14} className="animate-spin" />
                Carregando...
              </p>
            )}
            {result && result.questions.length === 0 && (
              <div className="card flex flex-col items-center gap-3 px-6 py-12 text-center">
                <FileSearch size={24} className="text-neutral-400" />
                <p className="text-sm text-neutral-500 dark:text-neutral-400">Nenhuma questão encontrada com esses critérios.</p>
                {filtered && (
                  <button type="button" className="btn-secondary" onClick={clear}>
                    Limpar o filtro
                  </button>
                )}
              </div>
            )}
            {result?.questions.map((question) => (
              <QuestionCard key={question.id} question={question} onChange={replace} onDeleted={removed} />
            ))}
          </div>

          {result && lastPage > 1 && (
            <nav className="mt-6 flex flex-wrap items-center justify-center gap-1" aria-label="Páginas">
              <button type="button" className="btn-secondary px-3 py-2" disabled={page <= 1} onClick={() => goTo(page - 1)} aria-label="Página anterior">
                <ChevronLeft size={16} />
              </button>
              {pageWindow(page, lastPage).map((p, i) =>
                p === null ? (
                  <span key={`gap-${i}`} className="px-1 text-neutral-400">
                    …
                  </span>
                ) : (
                  <button
                    key={p}
                    type="button"
                    onClick={() => goTo(p)}
                    aria-current={p === page ? 'page' : undefined}
                    className={`h-10 min-w-10 rounded-lg px-3 text-sm font-medium ${
                      p === page ? 'bg-brand-600 text-white' : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'
                    }`}
                  >
                    {p}
                  </button>
                ),
              )}
              <button type="button" className="btn-secondary px-3 py-2" disabled={page >= lastPage} onClick={() => goTo(page + 1)} aria-label="Próxima página">
                <ChevronRight size={16} />
              </button>
            </nav>
          )}
        </>
      )}

      {(modal === 'caderno' || modal === 'simulado') && (
        <NotebookModal
          mode={modal}
          filter={applied}
          order={order}
          total={total}
          onClose={() => setModal(null)}
          onCreated={(notebook, mode) => navigate(mode === 'simulado' ? `/questoes/cadernos/${notebook.id}/resolver?modo=simulado` : `/questoes/cadernos/${notebook.id}`)}
        />
      )}
      {modal === 'salvar' && <SaveFilterModal filter={applied} onClose={() => setModal(null)} onSaved={() => setModal(null)} />}
      {modal === 'filtros' && (
        <SavedFiltersModal
          facets={overview?.facets ?? null}
          onClose={() => setModal(null)}
          onApply={(filter) => {
            setModal(null);
            apply(filter);
          }}
        />
      )}
    </div>
  );
}
