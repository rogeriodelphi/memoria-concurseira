import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, ListChecks, Loader2, Target, XCircle } from 'lucide-react';

import { ExamPicker } from '../components/ExamPicker';
import { AttentionPoints } from '../components/performance/AttentionPoints';
import { ActiveFilters, FilterBar } from '../components/performance/Filters';
import { BarList, DailyChart, DistributionDonut } from '../components/performance/Charts';
import { LeechesSummary } from '../components/performance/LeechesSummary';
import { NameTable } from '../components/performance/NameTable';
import { StudyTimePanel } from '../components/performance/StudyTimePanel';
import { statsApi } from '../services/api';
import { readFocusExam, saveFocusExam } from '../utils/focusExam';
import type { PerformanceData, PerformanceQuery, StudyTimeData } from '../types';
import {
  accuracyTone,
  METRIC_LABEL,
  paramsFromQuery,
  queryFromParams,
  rangeLabel,
  rankBars,
  studiedShare,
  TOP_BARS,
  type Metric,
} from '../utils/performance';

const TONE_TEXT = {
  good: 'text-emerald-600 dark:text-emerald-400',
  ok: 'text-amber-600 dark:text-amber-400',
  bad: 'text-red-600 dark:text-red-400',
};

function Kpi({ icon, tone, label, value, sub, valueClass = 'text-neutral-900 dark:text-neutral-100' }: { icon: ReactNode; tone: string; label: string; value: string; sub?: string; valueClass?: string }) {
  return (
    <div className="card flex flex-col items-start gap-3 p-4 sm:flex-row sm:items-center sm:gap-4 sm:p-5">
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${tone}`}>{icon}</div>
      <div className="min-w-0">
        <p className="text-xs leading-tight text-neutral-500 dark:text-neutral-400">{label}</p>
        <p className={`text-2xl font-bold leading-tight ${valueClass}`}>{value}</p>
        {sub && <p className="text-[11px] leading-tight text-neutral-400 dark:text-neutral-500">{sub}</p>}
      </div>
    </div>
  );
}

function Segmented<T extends string>({ label, options, value, onChange }: { label: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg bg-neutral-100 p-0.5 dark:bg-neutral-800">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            o.value === value ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-50' : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * "Meu desempenho": quantos cartões foram estudados, e como, num período à escolha: por dia, por resultado,
 * por nome de coleção e por assunto. Período, escopo e filtros ficam no endereço da página (dá para voltar e
 * compartilhar). Tocar numa barra ou no funil de uma linha filtra a página inteira por aquele grupo.
 */
export function Performance() {
  const [params, setParams] = useSearchParams();
  const paramsText = params.toString();
  const query = useMemo(() => queryFromParams(new URLSearchParams(paramsText)), [paramsText]);

  const [data, setData] = useState<PerformanceData | null>(null);
  // O tempo de estudo vem à parte: se falhar, o resto da página segue valendo.
  const [time, setTime] = useState<StudyTimeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metric, setMetric] = useState<Metric>('cards');
  const [namesExpanded, setNamesExpanded] = useState(false);
  const [subjectsExpanded, setSubjectsExpanded] = useState(false);

  // O concurso de "Meu concurso": o do endereço; sem ele, o que o usuário escolheu antes neste aparelho (e, sem nenhum, o principal).
  const apiQuery = useMemo(() => ({ ...query, exam: query.exam ?? readFocusExam() ?? null }), [query]);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    statsApi
      .performance(apiQuery)
      .then((result) => current && setData(result))
      .catch(() => current && setError('Não foi possível carregar o desempenho.'))
      .finally(() => current && setLoading(false));
    statsApi
      .studyTime(apiQuery)
      .then((result) => current && setTime(result))
      .catch(() => current && setTime(null));
    return () => {
      current = false;
    };
  }, [apiQuery]);

  const change = (next: PerformanceQuery) => setParams(paramsFromQuery(next), { replace: true });
  const pickName = (key: string) => change({ ...query, name: query.name === key ? null : key });
  const pickSubject = (key: string) => change({ ...query, subject: query.subject === key ? null : key });
  const filterFromTable = (name: string, subject: string | null) =>
    change(query.name === name && query.subject === subject ? { ...query, name: null, subject: null } : { ...query, name, subject });

  const totals = data?.totals;
  const share = data ? studiedShare(data) : null;
  const accuracy = totals?.accuracyPct ?? null;
  const hasData = !!totals && totals.reviews > 0;
  const nameBars = data ? rankBars(data.byName, metric) : [];
  const subjectBars = data ? rankBars(data.bySubject, metric) : [];
  const scope = data?.scope ?? query.scope;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Meu desempenho</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Acompanhe sua evolução nos cartões estudados e identifique pontos de atenção.
          </p>
        </div>
        {data?.exam && (
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <Segmented
              label="Quais dados"
              options={[
                { value: 'exam', label: 'Meu concurso' },
                { value: 'all', label: 'Todos os dados' },
              ]}
              value={scope}
              onChange={(value) => change({ ...query, scope: value, name: null, subject: null })}
            />
            {scope === 'exam' && (
              <ExamPicker
                options={data.exams}
                selectedId={data.exam.id}
                onChange={(id) => {
                  saveFocusExam(id);
                  change({ ...query, exam: id, name: null, subject: null });
                }}
              />
            )}
          </div>
        )}
      </div>

      <hr className="my-5 border-neutral-200 dark:border-neutral-800" />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterBar query={query} data={data} onChange={change} />
        {data && (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            {rangeLabel(data.range)}
            {scope === 'exam' && data.exam && <> · {data.exam.name}</>}
          </p>
        )}
      </div>
      <div className="mt-3 empty:hidden">
        <ActiveFilters query={query} data={data} onChange={change} />
      </div>

      <hr className="my-5 border-neutral-200 dark:border-neutral-800" />

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!data && loading && (
        <p className="flex items-center gap-2 text-sm text-neutral-400 dark:text-neutral-500">
          <Loader2 size={14} className="animate-spin" /> Carregando...
        </p>
      )}

      {data && totals && (
        <div className={`space-y-5 transition-opacity ${loading ? 'opacity-60' : ''}`}>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Kpi
              icon={<ListChecks size={20} />}
              tone="bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
              label="Cartões estudados"
              value={totals.cards.toLocaleString('pt-BR')}
              sub={share !== null ? `${share}% dos ${data.totalCards.toLocaleString('pt-BR')} cartões` : undefined}
            />
            <Kpi
              icon={<Target size={20} />}
              tone="bg-orange-50 text-orange-600 dark:bg-orange-950/40 dark:text-orange-400"
              label="Taxa de acerto"
              value={accuracy === null ? '—' : `${accuracy}%`}
              sub={`${totals.reviews.toLocaleString('pt-BR')} ${totals.reviews === 1 ? 'revisão' : 'revisões'}`}
              valueClass={accuracy === null ? 'text-neutral-400' : TONE_TEXT[accuracyTone(accuracy)]}
            />
            <Kpi icon={<CheckCircle2 size={20} />} tone="bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400" label="Acertos" value={totals.good.toLocaleString('pt-BR')} sub="Bom ou Fácil" valueClass="text-emerald-600 dark:text-emerald-400" />
            <Kpi icon={<XCircle size={20} />} tone="bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400" label="Erros" value={totals.bad.toLocaleString('pt-BR')} sub="Errei ou Difícil" valueClass="text-red-600 dark:text-red-400" />
          </div>

          {!hasData ? (
            <>
            <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                {scope === 'exam' && data.totalCards === 0
                  ? 'Nenhuma coleção está ligada ao seu concurso. Ligue coleções aos tópicos do edital para ver o desempenho dele.'
                  : 'Nenhum cartão estudado neste período e com estes filtros. Escolha um período maior ou comece uma revisão.'}
              </p>
              <Link to={scope === 'exam' && data.exam ? `/concursos/${data.exam.id}` : '/revisar'} className="btn-primary">
                {scope === 'exam' && data.totalCards === 0 ? 'Abrir o concurso' : 'Revisar pendentes'}
              </Link>
            </div>
            {/* Sem revisões de cartões, ainda pode haver tempo de Pomodoro no período */}
            {time && time.totals.totalSec > 0 && <StudyTimePanel key={time.byDiscipline ? 'edital' : 'nome'} data={time} />}
            </>
          ) : (
            <>
              <AttentionPoints
                data={data}
                returnTo={`/desempenho${paramsText ? `?${paramsText}` : ''}`}
                onFilter={(nameKey, subjectKey) => change({ ...query, name: nameKey, subject: subjectKey })}
              />

              <LeechesSummary />

              {time && <StudyTimePanel key={time.byDiscipline ? 'edital' : 'nome'} data={time} />}

              <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
                <section className="card p-6 lg:col-span-2" aria-label="Revisões por dia">
                  <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Revisões por dia</h2>
                  <p className="mb-4 mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">Evolução da prática no período selecionado.</p>
                  <DailyChart data={data} />
                </section>
                <section className="card p-6" aria-label="Distribuição">
                  <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Distribuição</h2>
                  <p className="mb-4 mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">O que você marcou nas revisões do período.</p>
                  <DistributionDonut byResult={totals.byResult} reviews={totals.reviews} />
                </section>
              </div>

              <section className="card p-6" aria-label="Cartões estudados por nome da coleção e por assunto">
                <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Cartões estudados</h2>
                    <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                      Por nome da coleção e por assunto. Toque numa barra para filtrar a página.
                    </p>
                  </div>
                  <Segmented label="O que medir" options={(Object.keys(METRIC_LABEL) as Metric[]).map((m) => ({ value: m, label: METRIC_LABEL[m] }))} value={metric} onChange={setMetric} />
                </div>
                {metric === 'reviews' && (
                  <p className="-mt-2 mb-4 text-[11px] text-neutral-500 dark:text-neutral-400">A barra mostra a parte de acertos (verde) e de erros (vermelho).</p>
                )}
                <div className="grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-2">
                  <BarList
                    title="Por nome da coleção"
                    rows={nameBars}
                    metric={metric}
                    activeKey={query.name}
                    onPick={pickName}
                    expanded={namesExpanded}
                    onToggleExpanded={() => setNamesExpanded((v) => !v)}
                    limit={TOP_BARS}
                    emptyText="Nada estudado neste período."
                  />
                  <BarList
                    title="Por assunto"
                    rows={subjectBars}
                    metric={metric}
                    activeKey={query.subject}
                    onPick={pickSubject}
                    expanded={subjectsExpanded}
                    onToggleExpanded={() => setSubjectsExpanded((v) => !v)}
                    limit={TOP_BARS}
                    emptyText="Nada estudado neste período."
                  />
                </div>
              </section>

              <section className="card p-6" aria-label="Desempenho por nome da coleção">
                <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Desempenho por nome da coleção</h2>
                <p className="mb-4 mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                  Abra um nome para ver os assuntos dele. A seta compara o acerto com o período anterior, de mesma duração.
                </p>
                <NameTable rows={data.byName} activeName={query.name} activeSubject={query.subject} onFilter={filterFromTable} />
              </section>
            </>
          )}
        </div>
      )}
    </div>
  );
}
