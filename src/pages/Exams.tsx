import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, Plus, Target } from 'lucide-react';

import { examsApi } from '../services/api';
import { daysLeftLabel, formatExamDate, plural } from '../utils/exam';
import type { ExamSummary } from '../types';

function ExamCard({ exam }: { exam: ExamSummary }) {
  const { overall } = exam;
  const countdown = daysLeftLabel(exam.daysLeft);
  const subtitle = [exam.position, exam.board].filter(Boolean).join(' · ');

  return (
    <Link to={`/concursos/${exam.id}`} className="card block p-5 transition-shadow hover:shadow-md">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-neutral-900 dark:text-neutral-100">{exam.name}</h2>
          {subtitle && <p className="truncate text-sm text-neutral-500 dark:text-neutral-400">{subtitle}</p>}
        </div>
        {countdown && (
          <span
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
              exam.daysLeft !== null && exam.daysLeft >= 0
                ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300'
                : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400'
            }`}
            title={formatExamDate(exam.examDate)}
          >
            <CalendarDays size={13} />
            {countdown}
          </span>
        )}
      </div>

      <div className="mb-1.5 flex items-center justify-between text-sm">
        <span className="text-neutral-600 dark:text-neutral-300">
          {overall.coveragePct === null ? 'Sem tópicos' : `${overall.coveragePct}% com material`}
        </span>
        <span className="text-xs text-neutral-400 dark:text-neutral-500">
          {overall.coveredTopics} de {plural(overall.topicCount, 'tópico', 'tópicos')}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
        <div className="h-full rounded-full bg-brand-500" style={{ width: `${overall.coveragePct ?? 0}%` }} />
      </div>

      <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
        {plural(overall.disciplineCount, 'disciplina', 'disciplinas')} · {plural(overall.cards, 'cartão', 'cartões')}
        {overall.dueCards > 0 && ` · ${overall.dueCards.toLocaleString('pt-BR')} para revisar`}
      </p>
    </Link>
  );
}

export function Exams() {
  const [exams, setExams] = useState<ExamSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    examsApi
      .list()
      .then(({ exams: list }) => setExams(list))
      .catch(() => setError('Não foi possível carregar os concursos.'));
  }, []);

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="mb-1 text-2xl font-bold text-neutral-900 dark:text-neutral-100">Concursos</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            O conteúdo programático do edital cruzado com o que você já estudou.
          </p>
        </div>
        <Link to="/concursos/novo" className="btn-primary">
          <Plus size={16} />
          Novo concurso
        </Link>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!exams && !error && <p className="text-sm text-neutral-400 dark:text-neutral-500">Carregando...</p>}

      {exams && exams.length === 0 && (
        <div className="card flex flex-col items-center gap-3 px-6 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400">
            <Target size={22} />
          </div>
          <p className="max-w-md text-sm text-neutral-500 dark:text-neutral-400">
            Cadastre um concurso enviando o edital: a IA monta a lista de disciplinas e tópicos, e você vê quais já têm material
            nas suas coleções e como anda o estudo de cada um.
          </p>
          <Link to="/concursos/novo" className="btn-primary mt-2">
            Cadastrar concurso
          </Link>
        </div>
      )}

      {exams && exams.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {exams.map((exam) => (
            <ExamCard key={exam.id} exam={exam} />
          ))}
        </div>
      )}
    </div>
  );
}
