import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CalendarDays, Check, ChevronDown, ChevronRight, Loader2, Moon, Sparkles } from 'lucide-react';

import { ExamPicker, useFocusExam } from '../components/ExamPicker';
import { useToast } from '../contexts/ToastContext';
import { ApiError, scheduleApi } from '../services/api';
import type { ExamOption, Schedule, ScheduleDay, ScheduleSettings, ScheduleTopic } from '../types';
import { formatExamDate } from '../utils/exam';
import { studyHref } from '../utils/examLinks';
import { plural } from '../utils/performance';
import {
  dayNote,
  dayTitle,
  groupWeeks,
  headline,
  leftOutByDiscipline,
  MAX_MINUTES_PER_DAY,
  MAX_MINUTES_PER_TOPIC,
  MIN_MINUTES_PER_DAY,
  MIN_MINUTES_PER_TOPIC,
  settingsChanged,
  settingsError,
  topicsPerDayText,
  WEEKDAY_CHIP,
  wholeNumber,
  type HeadlineTone,
} from '../utils/schedule';

const TONE_CLASS: Record<HeadlineTone, string> = {
  green: 'border-brand-200 bg-brand-50 text-brand-800 dark:border-brand-900 dark:bg-brand-950/40 dark:text-brand-200',
  amber: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
  red: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200',
};

type Payload = { schedule: Schedule | null; exams: ExamOption[] };

/** Um tópico do plano: a caixa de "estudei", o título, a disciplina, os cartões dele e o atalho para estudá-los. */
function TopicRow({
  topic,
  disciplineName,
  minutes,
  examId,
  busy,
  onToggle,
}: {
  topic: ScheduleTopic;
  disciplineName: string;
  /** O tempo estimado; `null` na lista dos já estudados. */
  minutes: number | null;
  examId: string;
  busy: boolean;
  onToggle: (topic: ScheduleTopic) => void;
}) {
  const cards =
    topic.cards > 0
      ? `${plural(topic.cards, 'cartão', 'cartões')}${topic.seenPct !== null ? ` · ${topic.seenPct}% vistos` : ''}`
      : 'sem cartões';
  return (
    <li className="flex items-start gap-3 py-2">
      <button
        type="button"
        role="checkbox"
        aria-checked={topic.done}
        aria-label={topic.done ? `Desmarcar: ${topic.title}` : `Marcar como estudado: ${topic.title}`}
        disabled={busy}
        onClick={() => onToggle(topic)}
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors disabled:opacity-50 ${
          topic.done ? 'border-brand-600 bg-brand-600 text-white' : 'border-neutral-300 text-transparent hover:border-brand-500 dark:border-neutral-600'
        }`}
      >
        <Check size={12} strokeWidth={3} />
      </button>
      <div className="min-w-0 flex-1">
        <p className={`break-words text-sm ${topic.done ? 'text-neutral-400 line-through dark:text-neutral-500' : 'text-neutral-800 dark:text-neutral-100'}`}>{topic.title}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">
          <span>{disciplineName}</span>
          {minutes !== null && <span>· {minutes} min</span>}
          <span>· {cards}</span>
          {topic.collectionIds.length > 0 && topic.cards > 0 && (
            <Link
              to={studyHref('study', topic.collectionIds, topic.title, '/cronograma')}
              className="font-medium text-brand-700 hover:underline dark:text-brand-300"
              title="Revisa os cartões pendentes das coleções ligadas a este tópico"
            >
              · Estudar os cartões
            </Link>
          )}
          {topic.cards === 0 && !topic.done && (
            <Link to={`/concursos/${examId}`} className="font-medium text-brand-700 hover:underline dark:text-brand-300" title="Na página do concurso a IA pode gerar os cartões deste tópico">
              · Criar cartões
            </Link>
          )}
        </p>
      </div>
    </li>
  );
}

/** Um dia do plano: o título, o total de tempo e os tópicos (ou o que o dia é, quando não tem tópicos). */
function DayBlock({
  day,
  today,
  topics,
  disciplineOf,
  minutesPerTopic,
  examId,
  busyId,
  onToggle,
}: {
  day: ScheduleDay;
  today: string;
  topics: Map<string, ScheduleTopic>;
  disciplineOf: Map<string, string>;
  minutesPerTopic: number;
  examId: string;
  busyId: string | null;
  onToggle: (topic: ScheduleTopic) => void;
}) {
  const isToday = day.date === today;
  const note = dayNote(day);
  return (
    <div className={`rounded-xl border p-3 ${isToday ? 'border-brand-300 bg-brand-50/40 dark:border-brand-800 dark:bg-brand-950/20' : 'border-neutral-200 dark:border-neutral-700'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          {day.kind === 'rest' && <Moon size={14} className="text-neutral-400" />}
          {dayTitle(day, today)}
        </p>
        {day.topicIds.length > 0 && (
          <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
            {plural(day.topicIds.length, 'tópico', 'tópicos')} · {day.minutes} min
          </span>
        )}
      </div>
      {note && <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{note}</p>}
      {day.topicIds.length > 0 && (
        <ul className="mt-1 divide-y divide-neutral-100 dark:divide-neutral-800">
          {day.topicIds.map((id) => {
            const topic = topics.get(id);
            return topic ? (
              <TopicRow key={id} topic={topic} disciplineName={disciplineOf.get(topic.disciplineId) ?? ''} minutes={minutesPerTopic} examId={examId} busy={busyId === id} onToggle={onToggle} />
            ) : null;
          })}
        </ul>
      )}
    </div>
  );
}

/** As escolhas: tempo por dia, tempo por tópico e os dias da semana em que estuda. */
function SettingsCard({ settings, saved, saving, onSave }: { settings: ScheduleSettings; saved: boolean; saving: boolean; onSave: (settings: ScheduleSettings) => void }) {
  const [open, setOpen] = useState(!saved);
  const [perDay, setPerDay] = useState(String(settings.minutesPerDay));
  const [perTopic, setPerTopic] = useState(String(settings.minutesPerTopic));
  const [weekdays, setWeekdays] = useState<number[]>(settings.weekdays);

  // O que veio do servidor (depois de salvar, ou de trocar de concurso) volta ao formulário.
  useEffect(() => {
    setPerDay(String(settings.minutesPerDay));
    setPerTopic(String(settings.minutesPerTopic));
    setWeekdays(settings.weekdays);
  }, [settings.minutesPerDay, settings.minutesPerTopic, settings.weekdays.join(',')]);

  const form: ScheduleSettings = { minutesPerDay: wholeNumber(perDay), minutesPerTopic: wholeNumber(perTopic), weekdays };
  const problem = settingsError(form);
  const changed = settingsChanged(form, settings);

  function toggleDay(weekday: number) {
    setWeekdays((prev) => (prev.includes(weekday) ? prev.filter((d) => d !== weekday) : [...prev, weekday].sort((a, b) => a - b)));
  }

  return (
    <section className="card p-5" aria-label="Suas escolhas para o cronograma">
      <button type="button" className="flex w-full items-start justify-between gap-3 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>
          <span className="block text-sm font-semibold text-neutral-900 dark:text-neutral-100">Seu tempo</span>
          <span className="mt-0.5 block text-xs text-neutral-500 dark:text-neutral-400">
            {settings.minutesPerDay} min por dia · {settings.minutesPerTopic} min por tópico · {topicsPerDayText(settings)}
            {!saved && ' · escolhas padrão: ajuste ao seu tempo'}
          </span>
        </span>
        {open ? <ChevronDown size={18} className="mt-0.5 shrink-0 text-neutral-400" /> : <ChevronRight size={18} className="mt-0.5 shrink-0 text-neutral-400" />}
      </button>

      {open && (
        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!problem && changed) onSave(form);
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label-field" htmlFor="sched-per-day">
                Minutos por dia para estudar tópicos
              </label>
              <input id="sched-per-day" className="input-field" inputMode="numeric" value={perDay} onChange={(e) => setPerDay(e.target.value)} />
              <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">De {MIN_MINUTES_PER_DAY} a {MAX_MINUTES_PER_DAY}. Fora a revisão dos cartões.</p>
            </div>
            <div>
              <label className="label-field" htmlFor="sched-per-topic">
                Minutos por tópico
              </label>
              <input id="sched-per-topic" className="input-field" inputMode="numeric" value={perTopic} onChange={(e) => setPerTopic(e.target.value)} />
              <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">De {MIN_MINUTES_PER_TOPIC} a {MAX_MINUTES_PER_TOPIC}; não mais que o tempo do dia.</p>
            </div>
          </div>

          <fieldset>
            <legend className="label-field">Em que dias você estuda</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {WEEKDAY_CHIP.map((label, weekday) => {
                const on = weekdays.includes(weekday);
                return (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleDay(weekday)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                      on ? 'border-brand-600 bg-brand-600 text-white' : 'border-neutral-200 text-neutral-600 hover:border-brand-400 dark:border-neutral-700 dark:text-neutral-300'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {problem && changed && <p className="text-xs text-red-600 dark:text-red-400">{problem}</p>}
          <button type="submit" className="btn-primary" disabled={saving || !!problem || !changed}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : null}
            Salvar e refazer o cronograma
          </button>
        </form>
      )}
    </section>
  );
}

/**
 * O cronograma até a prova: dia a dia, quais tópicos do edital estudar, repartidos pelo peso de cada disciplina e pelo
 * tempo que você tem. Os últimos dias são só de revisão. Você marca o que estudou, e o plano é refeito a partir de hoje: o
 * que ficou para trás volta nos próximos dias. Só os tópicos que você marca e as suas escolhas são guardados.
 */
export function SchedulePage() {
  const { showToast } = useToast();
  const { focus, choose } = useFocusExam();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let current = true;
    setData(null);
    setError(null);
    scheduleApi
      .get(focus)
      .then((result) => current && setData(result))
      .catch(() => current && setError('Não foi possível carregar o cronograma.'));
    return () => {
      current = false;
    };
  }, [focus]);

  const schedule = data?.schedule ?? null;
  const topics = useMemo(() => new Map((schedule?.topics ?? []).map((t) => [t.id, t])), [schedule]);
  const disciplineOf = useMemo(() => new Map((schedule?.disciplines ?? []).map((d) => [d.id, d.name])), [schedule]);
  const weeks = useMemo(() => (schedule ? groupWeeks(schedule.days, schedule.today) : []), [schedule]);
  const doneTopics = useMemo(() => (schedule?.topics ?? []).filter((t) => t.done), [schedule]);
  const left = useMemo(() => (schedule ? leftOutByDiscipline(schedule.summary.leftOut, schedule.topics, schedule.disciplines) : []), [schedule]);

  async function toggle(topic: ScheduleTopic) {
    setBusyId(topic.id);
    try {
      setData(await scheduleApi.setTopicDone(topic.id, !topic.done));
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Não foi possível marcar o tópico.', 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function save(settings: ScheduleSettings) {
    if (!schedule) return;
    setSaving(true);
    try {
      setData(await scheduleApi.saveSettings(schedule.exam.id, settings));
      showToast('Cronograma refeito com as suas escolhas.');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Não foi possível salvar as escolhas.', 'error');
    } finally {
      setSaving(false);
    }
  }

  const summary = schedule?.summary;
  const message = schedule ? headline(schedule) : null;
  const today = schedule ? schedule.days.find((d) => d.date === schedule.today) : undefined;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <Link to="/painel" className="text-xs text-neutral-500 hover:underline dark:text-neutral-400">
          ← Painel
        </Link>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold text-neutral-900 dark:text-neutral-100">
          <CalendarDays size={24} className="text-brand-600 dark:text-brand-400" />
          Cronograma
        </h1>
        {data && <ExamPicker options={data.exams} selectedId={schedule?.exam.id ?? null} onChange={choose} className="mt-2" />}
        {schedule && (
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            <Link to={`/concursos/${schedule.exam.id}`} className="font-medium hover:text-brand-600 hover:underline">
              {schedule.exam.name}
            </Link>{' '}
            · {formatExamDate(schedule.exam.examDate)} · {schedule.exam.daysLeft === 0 ? 'hoje' : schedule.exam.daysLeft === 1 ? 'amanhã' : `faltam ${schedule.exam.daysLeft} dias`}
          </p>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!data && !error && (
        <p className="flex items-center gap-2 text-sm text-neutral-400 dark:text-neutral-500">
          <Loader2 size={16} className="animate-spin" />
          Carregando...
        </p>
      )}

      {data && !schedule && (
        <div className="card space-y-3 p-6 text-sm text-neutral-600 dark:text-neutral-300">
          <p>
            O cronograma precisa de um concurso com <strong>data da prova</strong> (que ainda não passou) e o edital com as disciplinas e os tópicos. Cadastre a data em
            Concursos → Editar.
          </p>
          <Link to="/concursos" className="btn-primary inline-flex">
            Abrir Concursos
          </Link>
        </div>
      )}

      {schedule && summary && message && (
        <>
          <section className={`rounded-xl border p-4 ${TONE_CLASS[message.tone]}`} aria-label="Resumo do cronograma">
            <p className="text-sm font-semibold">{message.title}</p>
            <p className="mt-0.5 text-sm">{message.message}</p>
            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between text-[11px]">
                <span>
                  {plural(summary.topicsDone, 'tópico estudado', 'tópicos estudados')} de {summary.topicsTotal.toLocaleString('pt-BR')}
                </span>
                <span className="font-medium">{summary.topicsTotal > 0 ? Math.round((summary.topicsDone / summary.topicsTotal) * 100) : 0}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/60 dark:bg-neutral-900/50" role="progressbar" aria-valuemin={0} aria-valuemax={summary.topicsTotal} aria-valuenow={summary.topicsDone}>
                <div className="h-full rounded-full bg-brand-600" style={{ width: `${summary.topicsTotal > 0 ? (summary.topicsDone / summary.topicsTotal) * 100 : 0}%` }} />
              </div>
            </div>
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
              {schedule.disciplines.map((d) => (
                <li key={d.id}>
                  <span className="font-semibold">{d.name}</span> ({d.sharePct}% da prova): {d.done} de {d.topics}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] opacity-80">
              {plural(summary.studyDays, 'dia de estudo', 'dias de estudo')}
              {summary.restDays > 0 && ` · ${plural(summary.restDays, 'dia de descanso', 'dias de descanso')}`} · nos últimos {plural(summary.reviewPhaseDays, 'dia', 'dias')} só revisão (
              <Link to="/reta-final" className="font-medium underline">
                Reta final
              </Link>
              )
            </p>
          </section>

          <SettingsCard settings={schedule.settings} saved={schedule.settingsSaved} saving={saving} onSave={save} />

          {today && (
            <section aria-label="Hoje">
              <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                <Sparkles size={15} className="text-brand-600 dark:text-brand-400" />O que estudar hoje
              </h2>
              <DayBlock day={today} today={schedule.today} topics={topics} disciplineOf={disciplineOf} minutesPerTopic={schedule.settings.minutesPerTopic} examId={schedule.exam.id} busyId={busyId} onToggle={toggle} />
            </section>
          )}

          <section className="space-y-2" aria-label="Semana a semana">
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Dia a dia até a prova</h2>
            {weeks.map((week, index) => (
              <WeekBlock key={week.key} label={week.label} topics={week.topics} defaultOpen={index === 0}>
                <div className="space-y-2">
                  {week.days.map((day) => (
                    <DayBlock key={day.date} day={day} today={schedule.today} topics={topics} disciplineOf={disciplineOf} minutesPerTopic={schedule.settings.minutesPerTopic} examId={schedule.exam.id} busyId={busyId} onToggle={toggle} />
                  ))}
                </div>
              </WeekBlock>
            ))}
          </section>

          {left.length > 0 && (
            <section className="card border-amber-200 p-5 dark:border-amber-900" aria-label="Fora do plano">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
                <AlertTriangle size={15} />
                {plural(summary.leftOut.length, 'tópico não cabe', 'tópicos não cabem')} no tempo que você tem
              </h2>
              <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-300">São os menos prioritários (as disciplinas de maior peso saem por último). Aumente o tempo por dia, estude em mais dias ou marque os que você já domina.</p>
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-700 dark:text-neutral-200">
                {left.map((d) => (
                  <li key={d.id}>
                    <span className="font-semibold">{d.name}</span>: {d.count}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {doneTopics.length > 0 && (
            <WeekBlock label={`Tópicos que você marcou como estudados (${doneTopics.length.toLocaleString('pt-BR')})`} topics={0} defaultOpen={false} hideCount>
              <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {doneTopics.map((topic) => (
                  <TopicRow key={topic.id} topic={topic} disciplineName={disciplineOf.get(topic.disciplineId) ?? ''} minutes={null} examId={schedule.exam.id} busy={busyId === topic.id} onToggle={toggle} />
                ))}
              </ul>
            </WeekBlock>
          )}

          <p className="text-[11px] leading-relaxed text-neutral-400 dark:text-neutral-500">
            Como é feito: os tópicos são repartidos entre as disciplinas na proporção do peso de cada uma na prova (questões × peso no edital), na ordem do edital dentro de cada
            disciplina. Cada tópico ocupa o tempo que você escolheu e o tempo do dia é repartido em tópicos inteiros (a sobra de um dia vai para o seguinte). Nos últimos dias
            antes da prova só se revisa, como na "Meta para a prova". O plano é refeito a cada vez a partir de hoje, com o que você ainda não marcou: o que ficou para trás volta
            nos próximos dias. É uma ordem de estudo sugerida, não uma garantia de nota; só as suas escolhas e os tópicos que você marca são guardados.
          </p>
        </>
      )}
    </div>
  );
}

/** Um bloco que abre e fecha (uma semana do plano, ou a lista dos já estudados). */
function WeekBlock({ label, topics, defaultOpen, hideCount = false, children }: { label: string; topics: number; defaultOpen: boolean; hideCount?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card p-4">
      <button type="button" className="flex w-full items-center justify-between gap-3 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          {label}
          {!hideCount && <span className="ml-2 text-xs font-normal text-neutral-500 dark:text-neutral-400">{plural(topics, 'tópico', 'tópicos')}</span>}
        </span>
        {open ? <ChevronDown size={18} className="shrink-0 text-neutral-400" /> : <ChevronRight size={18} className="shrink-0 text-neutral-400" />}
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}
