import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Flag, Loader2, PlayCircle, Snowflake } from 'lucide-react';

import { ExamPicker, useFocusExam } from '../components/ExamPicker';
import { studyPlanApi } from '../services/api';
import type { FinalStretch, FinalStretchDiscipline } from '../types';
import { formatExamDate } from '../utils/exam';
import { retaFrozenNote } from '../utils/frozen';
import { coverageNote, disciplineFacts, gainText, masteryTone, phaseInfo, queueHeadline, queueNotes, remainingText, type MasteryTone, type Tone } from '../utils/finalStretch';
import { plural } from '../utils/performance';

const PHASE_CLASS: Record<Tone, string> = {
  green: 'border-brand-200 bg-brand-50 text-brand-800 dark:border-brand-900 dark:bg-brand-950/40 dark:text-brand-200',
  amber: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
  red: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200',
};

const BAR_CLASS: Record<MasteryTone, string> = {
  good: 'bg-emerald-500',
  ok: 'bg-amber-400',
  bad: 'bg-red-500',
  none: 'bg-neutral-300 dark:bg-neutral-600',
};

function DisciplineItem({ d, focus, examId }: { d: FinalStretchDiscipline; focus: boolean; examId: string }) {
  return (
    <li
      className={`rounded-xl border p-4 ${
        focus ? 'border-brand-300 bg-brand-50/40 dark:border-brand-800 dark:bg-brand-950/20' : 'border-neutral-200 dark:border-neutral-700'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-medium text-neutral-900 dark:text-neutral-100">
            {d.rank !== null && (
              <span className="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[11px] font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">{d.rank}º</span>
            )}
            {d.name}
            {focus && <span className="rounded-full bg-brand-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">Foco</span>}
          </p>
          <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{disciplineFacts(d).join(' · ')}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-lg font-bold text-neutral-900 dark:text-neutral-100">{gainText(d.gainPct)}</p>
          <p className="text-[11px] text-neutral-500 dark:text-neutral-400">da prova em aberto</p>
        </div>
      </div>

      {d.hasCards ? (
        <>
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between text-[11px] text-neutral-500 dark:text-neutral-400">
              <span>Domínio estimado</span>
              <span className="font-medium text-neutral-700 dark:text-neutral-300">{d.masteryPct ?? 0}%</span>
            </div>
            <div
              className="h-2 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800"
              role="img"
              aria-label={`Domínio estimado de ${d.name}: ${d.masteryPct ?? 0}%`}
            >
              <div className={`h-full rounded-full ${BAR_CLASS[masteryTone(d.masteryPct)]}`} style={{ width: `${Math.max(2, d.masteryPct ?? 0)}%` }} />
            </div>
          </div>
          <p className="mt-2 text-[11px] text-neutral-500 dark:text-neutral-400">
            {plural(d.dueCards, 'vencido', 'vencidos')} · {plural(d.newCards, 'novo', 'novos')} · {plural(d.cards, 'cartão', 'cartões')} no total
          </p>
        </>
      ) : (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
          Esta disciplina não tem cartões, então não entra no foco.{' '}
          <Link to={`/concursos/${examId}`} className="font-medium underline">
            Ligue coleções aos tópicos dela
          </Link>{' '}
          para o app poder revisá-la.
        </p>
      )}
    </li>
  );
}

/**
 * Reta final: para onde olhar nas últimas semanas antes da prova. Mostra, do concurso de data mais próxima, quanto
 * da prova ainda está em aberto em cada disciplina (o peso dela vezes o que falta dominar) e abre uma sessão de
 * revisão só com os cartões do edital, repartidos por essa prioridade. Só leitura: nada muda até você avaliar os
 * cartões, e a revisão global e o limite diário continuam como são.
 */
export function FinalStretchPage() {
  const [data, setData] = useState<FinalStretch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { focus, choose } = useFocusExam();

  useEffect(() => {
    let current = true;
    setData(null);
    setError(null);
    studyPlanApi
      .finalStretch(focus)
      .then((result) => current && setData(result))
      .catch(() => current && setError('Não foi possível carregar a reta final.'));
    return () => {
      current = false;
    };
  }, [focus]);

  const exam = data?.exam ?? null;
  const phase = data?.phase ? phaseInfo(data.phase, exam!.daysLeft) : null;
  const withCards = data ? data.disciplines.filter((d) => d.hasCards) : [];

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <Link to="/painel" className="text-xs text-neutral-500 hover:underline dark:text-neutral-400">
          ← Painel
        </Link>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold text-neutral-900 dark:text-neutral-100">
          <Flag size={24} className="text-brand-600 dark:text-brand-400" />
          Reta final
        </h1>
        {data && <ExamPicker options={data.exams} selectedId={exam?.id ?? null} onChange={choose} className="mt-2" />}
        {exam && (
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            <Link to={`/concursos/${exam.id}`} className="font-medium hover:text-brand-600 hover:underline">
              {exam.name}
            </Link>{' '}
            · {formatExamDate(exam.examDate)} · {exam.daysLeft === 0 ? 'hoje' : exam.daysLeft === 1 ? 'amanhã' : remainingText(exam.daysLeft).toLowerCase()}
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

      {data && !exam && (
        <div className="card space-y-3 p-6 text-sm text-neutral-600 dark:text-neutral-300">
          <p>
            A reta final precisa de um concurso com <strong>data da prova</strong> (que ainda não passou) e as disciplinas do edital. Cadastre a data em Concursos
            → Editar.
          </p>
          <Link to="/concursos" className="btn-primary inline-flex">
            Abrir Concursos
          </Link>
        </div>
      )}

      {data && exam && data.disciplines.length === 0 && (
        <div className="card space-y-3 p-6 text-sm text-neutral-600 dark:text-neutral-300">
          <p>Este concurso ainda não tem disciplinas no edital, então não há como saber onde está o peso da prova. Cadastre o edital para a reta final funcionar.</p>
          <Link to={`/concursos/${exam.id}`} className="btn-primary inline-flex">
            Abrir o concurso
          </Link>
        </div>
      )}

      {data && exam && data.disciplines.length > 0 && phase && (
        <>
          <div className={`rounded-xl border p-4 ${PHASE_CLASS[phase.tone]}`}>
            <p className="text-sm font-semibold">{phase.title}</p>
            <p className="mt-0.5 text-sm">{phase.message}</p>
          </div>

          <section className="card p-5" aria-label="Foco de hoje">
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Foco de hoje</h2>
            <p className="mt-1 text-xl font-bold text-neutral-900 dark:text-neutral-100">{queueHeadline(data.queue)}</p>
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              Só cartões das coleções ligadas ao edital, repartidos pela prioridade abaixo: a disciplina com mais prova em aberto recebe mais vagas. A sessão é
              embaralhada.
              {data.phase === 'content' && ' Até um terço dela é reservado a cartões novos, para a cobertura não parar por causa dos vencidos.'}
            </p>
            {data.queue.total > 0 && (
              <Link to="/reta-final/estudar" className="btn-primary mt-3 inline-flex">
                <PlayCircle size={16} />
                Estudar o foco agora ({plural(data.queue.total, 'cartão', 'cartões')})
              </Link>
            )}
            {queueNotes(data.queue, data.phase).length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-neutral-500 dark:text-neutral-400">
                {queueNotes(data.queue, data.phase).map((note) => (
                  <li key={note}>• {note}</li>
                ))}
              </ul>
            )}
          </section>

          <section className="card p-5" aria-label="Onde há mais prova em aberto">
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Onde há mais prova em aberto</h2>
            <p className="mb-4 mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
              Da disciplina mais urgente à menos. As {data.focus.length === 1 ? 'primeira' : `${data.focus.length} primeiras`} são o foco.
            </p>

            {coverageNote(data.topics, data.coveredTopics) && (
              <p className="mb-4 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>
                  {coverageNote(data.topics, data.coveredTopics)}{' '}
                  <Link to={`/concursos/${exam.id}`} className="font-medium underline">
                    Veja os tópicos sem material
                  </Link>{' '}
                  (lá a IA pode gerar os cartões, que você confere antes de estudar).
                </span>
              </p>
            )}

            {data.frozenCollections > 0 && (
              <p className="mb-4 flex items-start gap-2 rounded-lg bg-sky-50 p-3 text-xs text-sky-800 dark:bg-sky-950/30 dark:text-sky-300">
                <Snowflake size={14} className="mt-0.5 shrink-0" />
                <span>{retaFrozenNote(data.frozenCollections)}</span>
              </p>
            )}

            {data.uncoveredSharePct > 0 && (
              <p className="mb-4 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>
                  Cerca de {data.uncoveredSharePct}% da prova está em disciplinas sem nenhum cartão
                  {data.frozenCollections > 0 && ' (ou só com coleções congeladas)'}: o app não tem o que revisar nelas. Vale criar ou ligar cartões a essas
                  disciplinas.
                </span>
              </p>
            )}

            {withCards.length === 0 && (
              <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-300">Nenhuma coleção está ligada às disciplinas do edital, então a fila do foco fica vazia.</p>
            )}

            <ul className="space-y-3">
              {data.disciplines.map((d) => (
                <DisciplineItem key={d.id} d={d} focus={data.focus.includes(d.id)} examId={exam.id} />
              ))}
            </ul>
          </section>

          <p className="text-[11px] leading-relaxed text-neutral-400 dark:text-neutral-500">
            Como é calculado: a parte da prova ainda em aberto numa disciplina é o peso dela (questões × peso no edital) vezes o que falta dominar. O domínio é
            quanto dos cartões você já viu × o seu acerto (Bom ou Fácil) nos últimos 30 dias × a fração dos tópicos do edital que têm cartão (sem tópicos
            cadastrados, essa parte não entra); com poucas revisões o acerto é puxado para 60%, para um punhado de revisões não decidir sozinho. É uma estimativa para escolher onde gastar o tempo, não uma previsão de nota. A carga de cada dia até a prova está na
            "Meta para a prova", no Painel.
          </p>
        </>
      )}
    </div>
  );
}
