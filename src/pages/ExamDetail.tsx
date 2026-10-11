import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CalendarDays, ChevronDown, ChevronRight, Info, Link2, Pencil, Plus, Trash2 } from 'lucide-react';

import { useConfirm } from '../contexts/ConfirmContext';
import { useToast } from '../contexts/ToastContext';
import { ApiError, examsApi } from '../services/api';
import { daysLeftLabel, formatExamDate, plural } from '../utils/exam';
import type { ExamDetail as ExamDetailData, ExamDisciplineProgress, ExamTopicProgress } from '../types';

type Collection = ExamDetailData['collections'][number];

const AUTO_OPEN_MAX_TOPICS = 40;

function pctText(n: number | null): string {
  return n === null ? '—' : `${n}%`;
}

function collectionLabel(c: Collection): string {
  return c.subject || c.name;
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-neutral-500 dark:text-neutral-400">{label}</p>
      <p className="mt-1 text-xl font-bold text-neutral-900 dark:text-neutral-100">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-neutral-400 dark:text-neutral-500">{sub}</p>}
    </div>
  );
}

function CollectionPicker({
  collections,
  selected,
  onToggle,
}: {
  collections: Collection[];
  selected: Set<string>;
  onToggle: (collectionId: string) => void;
}) {
  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();
  const visible = query
    ? collections.filter((c) => `${c.name} ${c.subject}`.toLowerCase().includes(query))
    : collections;

  return (
    <div className="mt-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-800/50">
      <input
        className="input-field !py-1.5"
        placeholder="Buscar coleção"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoFocus
      />
      <div className="mt-2 max-h-56 space-y-0.5 overflow-y-auto">
        {visible.map((c) => (
          <label
            key={c.id}
            className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-white dark:hover:bg-neutral-800"
          >
            <input
              type="checkbox"
              className="h-4 w-4 shrink-0 accent-brand-600"
              checked={selected.has(c.id)}
              onChange={() => onToggle(c.id)}
            />
            <span className="min-w-0 flex-1 truncate text-neutral-800 dark:text-neutral-100">
              {c.subject ? `${c.subject} ` : ''}
              <span className="text-neutral-400 dark:text-neutral-500">{c.subject ? `· ${c.name}` : c.name}</span>
            </span>
            <span className="shrink-0 text-xs text-neutral-400 dark:text-neutral-500">{plural(c.cards, 'cartão', 'cartões')}</span>
          </label>
        ))}
        {visible.length === 0 && (
          <p className="px-2 py-2 text-sm text-neutral-400 dark:text-neutral-500">Nenhuma coleção encontrada.</p>
        )}
      </div>
    </div>
  );
}

export function ExamDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { showToast } = useToast();

  const [data, setData] = useState<ExamDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [pickerTopicId, setPickerTopicId] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [busy, setBusy] = useState(false);
  const initialized = useRef(false);

  async function load() {
    if (!id) return;
    const detail = await examsApi.get(id);
    setData(detail);
    if (!initialized.current) {
      initialized.current = true;
      if (detail.overall.topicCount <= AUTO_OPEN_MAX_TOPICS) setOpen(new Set(detail.disciplines.map((d) => d.id)));
    }
  }

  useEffect(() => {
    load().catch(() => setError('Não foi possível carregar o concurso.'));
    // `id` vem da rota e só muda ao trocar de concurso.
  }, [id]);

  const collectionById = useMemo(() => new Map((data?.collections ?? []).map((c) => [c.id, c])), [data]);

  const strongLinks = useMemo(() => {
    const links: { topicId: string; collectionIds: string[] }[] = [];
    for (const [topicId, list] of Object.entries(data?.suggestions ?? {})) {
      const strong = list.filter((s) => s.strong).map((s) => s.collectionId);
      if (strong.length > 0) links.push({ topicId, collectionIds: strong });
    }
    return links;
  }, [data]);

  async function run(action: () => Promise<unknown>, failure: string) {
    setBusy(true);
    try {
      await action();
      await load();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : failure, 'error');
    } finally {
      setBusy(false);
    }
  }

  function setTopicLinks(topic: ExamTopicProgress, collectionIds: string[]) {
    return run(() => examsApi.setTopicCollections(id!, topic.id, collectionIds), 'Não foi possível salvar o vínculo.');
  }

  async function acceptStrongSuggestions() {
    const linkCount = strongLinks.reduce((n, l) => n + l.collectionIds.length, 0);
    const ok = await confirm({
      title: 'Aceitar sugestões',
      message: `Vincular ${plural(strongLinks.length, 'tópico', 'tópicos')} às coleções sugeridas (${plural(linkCount, 'vínculo', 'vínculos')})? Você pode desfazer qualquer um depois.`,
      confirmLabel: 'Aceitar',
    });
    if (!ok) return;
    await run(async () => {
      const { added } = await examsApi.addLinks(id!, strongLinks);
      showToast(`${plural(added, 'vínculo criado', 'vínculos criados')}.`);
    }, 'Não foi possível criar os vínculos.');
  }

  async function removeExam() {
    if (!data) return;
    const ok = await confirm({
      title: 'Excluir concurso',
      message: `Excluir "${data.exam.name}"? As disciplinas, os tópicos e os vínculos são apagados; suas coleções e cartões não são afetados.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await examsApi.remove(data.exam.id);
      showToast('Concurso excluído.');
      navigate('/concursos');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Não foi possível excluir o concurso.', 'error');
    }
  }

  function toggleOpen(disciplineId: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(disciplineId)) next.delete(disciplineId);
      else next.add(disciplineId);
      return next;
    });
  }

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <p className="text-sm text-neutral-400 dark:text-neutral-500">Carregando...</p>;

  const { exam, overall, disciplines, suggestions } = data;
  const countdown = daysLeftLabel(exam.daysLeft);
  const subtitle = [exam.position, exam.board].filter(Boolean).join(' · ');

  function renderTopic(topic: ExamTopicProgress) {
    const linked = topic.collectionIds
      .map((collectionId) => collectionById.get(collectionId))
      .filter((c): c is Collection => !!c);
    const topicSuggestions = suggestions[topic.id] ?? [];
    const pickerOpen = pickerTopicId === topic.id;

    let status: string;
    if (topic.hasMaterial) {
      status = [
        plural(topic.cards, 'cartão', 'cartões'),
        topic.dueCards > 0 ? `${topic.dueCards.toLocaleString('pt-BR')} para revisar` : null,
        topic.approvalPct !== null ? `${topic.approvalPct}% de aprovação` : null,
      ]
        .filter(Boolean)
        .join(' · ');
    } else if (linked.length > 0) {
      status = 'As coleções vinculadas ainda não têm cartões';
    } else {
      status = 'Sem material';
    }

    return (
      <li key={topic.id} className="border-t border-neutral-100 px-4 py-3 dark:border-neutral-800">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <div className="flex min-w-0 flex-1 items-start gap-2.5">
            <span
              className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${topic.hasMaterial ? 'bg-brand-500' : 'bg-neutral-300 dark:bg-neutral-600'}`}
              title={topic.hasMaterial ? 'Tem material' : 'Sem material'}
            />
            <p className="text-sm text-neutral-800 dark:text-neutral-100">{topic.title}</p>
          </div>
          <p className={`text-xs ${topic.hasMaterial ? 'text-neutral-500 dark:text-neutral-400' : 'text-neutral-400 dark:text-neutral-500'}`}>
            {status}
          </p>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-[18px]">
          {linked.map((c) => (
            <Link
              key={c.id}
              to={`/colecoes/${c.id}`}
              title={`${c.name}${c.subject ? ` — ${c.subject}` : ''}`}
              className="max-w-[16rem] truncate rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100 dark:bg-brand-950/40 dark:text-brand-300 dark:hover:bg-brand-950/70"
            >
              {collectionLabel(c)}
            </Link>
          ))}

          {linked.length === 0 &&
            topicSuggestions.map((s) => {
              const c = collectionById.get(s.collectionId);
              if (!c) return null;
              return (
                <button
                  key={s.collectionId}
                  type="button"
                  disabled={busy}
                  onClick={() => setTopicLinks(topic, [s.collectionId])}
                  title={`Sugestão: ${c.name}${c.subject ? ` — ${c.subject}` : ''}`}
                  className={`flex max-w-[16rem] items-center gap-1 truncate rounded-full border border-dashed px-2.5 py-1 text-xs transition-colors disabled:opacity-60 ${
                    s.strong
                      ? 'border-brand-400 text-brand-700 hover:bg-brand-50 dark:border-brand-600 dark:text-brand-300 dark:hover:bg-brand-950/40'
                      : 'border-neutral-300 text-neutral-500 hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-400 dark:hover:bg-neutral-800'
                  }`}
                >
                  <Plus size={12} className="shrink-0" />
                  <span className="truncate">{collectionLabel(c)}</span>
                </button>
              );
            })}

          <button
            type="button"
            onClick={() => setPickerTopicId(pickerOpen ? null : topic.id)}
            className="flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-neutral-500 hover:bg-neutral-100 hover:text-brand-600 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-brand-400"
            aria-expanded={pickerOpen}
          >
            <Link2 size={12} />
            {linked.length > 0 ? 'Editar vínculos' : 'Vincular coleção'}
          </button>
        </div>

        {pickerOpen && (
          <div className="pl-[18px]">
            <CollectionPicker
              collections={data!.collections}
              selected={new Set(topic.collectionIds)}
              onToggle={(collectionId) => {
                const next = topic.collectionIds.includes(collectionId)
                  ? topic.collectionIds.filter((c) => c !== collectionId)
                  : [...topic.collectionIds, collectionId];
                setTopicLinks(topic, next);
              }}
            />
          </div>
        )}
      </li>
    );
  }

  function renderDiscipline(discipline: ExamDisciplineProgress) {
    const expanded = open.has(discipline.id);
    return (
      <section key={discipline.id} className="card overflow-hidden">
        <button
          type="button"
          onClick={() => toggleOpen(discipline.id)}
          aria-expanded={expanded}
          className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
        >
          {expanded ? <ChevronDown size={18} className="shrink-0 text-neutral-400" /> : <ChevronRight size={18} className="shrink-0 text-neutral-400" />}
          <div className="min-w-[10rem] flex-1">
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{discipline.name}</h2>
            <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
              {[
                discipline.questionCount !== null ? plural(discipline.questionCount, 'questão', 'questões') : null,
                discipline.weight !== null ? `peso ${discipline.weight.toLocaleString('pt-BR')}` : null,
                discipline.cutoff || null,
              ]
                .filter(Boolean)
                .join(' · ') || plural(discipline.topicCount, 'tópico', 'tópicos')}
            </p>
          </div>
          <div className="w-44 shrink-0">
            <div className="mb-1 flex justify-between text-xs">
              <span className="font-medium text-neutral-700 dark:text-neutral-200">{pctText(discipline.coveragePct)} com material</span>
              <span className="text-neutral-400 dark:text-neutral-500">
                {discipline.coveredTopics}/{discipline.topicCount}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
              <div className="h-full rounded-full bg-brand-500" style={{ width: `${discipline.coveragePct ?? 0}%` }} />
            </div>
          </div>
          <p className="w-full text-xs text-neutral-500 dark:text-neutral-400 sm:w-auto sm:min-w-[11rem] sm:text-right">
            {plural(discipline.cards, 'cartão', 'cartões')}
            {discipline.dueCards > 0 && ` · ${discipline.dueCards.toLocaleString('pt-BR')} para revisar`}
            {discipline.approvalPct !== null && ` · ${discipline.approvalPct}% aprov.`}
          </p>
        </button>
        {expanded && (
          <ul>
            {discipline.topics.map(renderTopic)}
            {discipline.topics.length === 0 && (
              <li className="border-t border-neutral-100 px-4 py-3 text-sm text-neutral-400 dark:border-neutral-800 dark:text-neutral-500">
                Esta disciplina não tem tópicos. Use “Editar” para adicionar.
              </li>
            )}
          </ul>
        )}
      </section>
    );
  }

  return (
    <div>
      <Link
        to="/concursos"
        className="mb-4 flex items-center gap-1.5 text-sm font-medium text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
      >
        <ArrowLeft size={16} />
        Concursos
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">{exam.name}</h1>
          {subtitle && <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{subtitle}</p>}
          {countdown && (
            <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-brand-700 dark:text-brand-300">
              <CalendarDays size={15} />
              {countdown} <span className="font-normal text-neutral-400 dark:text-neutral-500">({formatExamDate(exam.examDate)})</span>
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Link to={`/concursos/${exam.id}/editar`} className="btn-secondary">
            <Pencil size={15} />
            Editar
          </Link>
          <button type="button" className="btn-secondary" onClick={removeExam} aria-label="Excluir concurso">
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Tile
          label="Cobertura"
          value={pctText(overall.coveragePct)}
          sub={overall.weightedByQuestions ? 'pesada pelas questões' : 'tópicos com material'}
        />
        <Tile label="Tópicos com material" value={`${overall.coveredTopics} de ${overall.topicCount}`} />
        <Tile label="Cartões" value={overall.cards.toLocaleString('pt-BR')} sub={`${overall.newCards.toLocaleString('pt-BR')} ainda não estudados`} />
        <Tile label="Para revisar" value={overall.dueCards.toLocaleString('pt-BR')} />
        <Tile label="Aprovação (30 dias)" value={pctText(overall.approvalPct)} />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {strongLinks.length > 0 ? (
          <div className="flex flex-wrap items-center gap-3 text-sm text-neutral-600 dark:text-neutral-300">
            <span>
              {plural(strongLinks.length, 'tópico tem', 'tópicos têm')} uma coleção com assunto praticamente igual.
            </span>
            <button type="button" className="btn-secondary !py-1.5" onClick={acceptStrongSuggestions} disabled={busy}>
              Aceitar sugestões
            </button>
          </div>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={() => setShowInfo((v) => !v)}
          aria-expanded={showInfo}
          className="flex items-center gap-1.5 text-xs font-medium text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
        >
          <Info size={14} />
          Como estes números são calculados
        </button>
      </div>

      {showInfo && (
        <div className="card mb-4 space-y-1.5 p-5 text-xs text-neutral-600 dark:text-neutral-300">
          <p>
            <strong>Tem material</strong>: o tópico está vinculado a ao menos uma coleção que tem cartões.
          </p>
          <p>
            <strong>Cobertura</strong>: percentual dos tópicos que têm material. Se todas as disciplinas informarem o número de
            questões, cada uma pesa pelas suas questões (10 questões valem mais que 3).
          </p>
          <p>
            <strong>Aprovação</strong>: das revisões dos últimos 30 dias nas coleções vinculadas, a parte que não foi “Errei”.
            Coleções vinculadas a vários tópicos contam uma vez só em cada disciplina.
          </p>
          <p>
            <strong>Sugestões</strong>: comparam o texto do tópico com o assunto e o nome das suas coleções. São só palpites:
            nada é vinculado sem a sua confirmação.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {disciplines.map(renderDiscipline)}
        {disciplines.length === 0 && (
          <div className="card px-6 py-10 text-center text-sm text-neutral-500 dark:text-neutral-400">
            Este concurso ainda não tem disciplinas.{' '}
            <Link to={`/concursos/${exam.id}/editar`} className="font-medium text-brand-600 hover:underline dark:text-brand-400">
              Adicionar
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
