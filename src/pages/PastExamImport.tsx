import { memo, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Check, Image as ImageIcon, Loader2, Trash2, Upload } from 'lucide-react';

import { AlternativesEditor } from '../components/questions/AlternativesEditor';
import { useToast } from '../contexts/ToastContext';
import { AI_USAGE_EVENT, ApiError } from '../services/api';
import { questionBankApi } from '../services/questionBankApi';
import type { QbDraft, QbDraftMeta, QbDraftQuestion, QbImportJob } from '../types';
import { groupProvas, isFromSite, updateProva } from '../utils/questionBank';

const MAX_PDF_MB = 30;
const POLL_MS = 2000;
const LEVELS = ['', 'Fundamental', 'Médio', 'Técnico', 'Superior'];
const ANNULLED = 'ANULADA';

type KeyMode = 'same' | 'file' | 'text';

const needsAttention = (q: QbDraftQuestion) => q.suspect || q.needsFigure || (!q.answer && !q.annulled);

function PdfPicker({
  file,
  onPick,
  onError,
  label,
}: {
  file: File | null;
  onPick: (file: File | null) => void;
  onError: (message: string) => void;
  label: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div>
      <input
        ref={input}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => {
          const picked = e.target.files?.[0] ?? null;
          if (picked && picked.size > MAX_PDF_MB * 1024 * 1024) {
            onPick(null);
            onError(`O PDF passa de ${MAX_PDF_MB} MB. Envie só a prova, sem outros cadernos.`);
            return;
          }
          onPick(picked);
        }}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-neutral-200 px-6 py-8 text-center transition-colors hover:border-brand-400 hover:bg-brand-50/40 dark:border-neutral-700 dark:hover:border-brand-600 dark:hover:bg-brand-950/20"
      >
        <Upload size={22} className="text-neutral-400" />
        {file ? (
          <span className="text-sm font-medium text-neutral-800 dark:text-neutral-100">{file.name}</span>
        ) : (
          <span className="text-sm text-neutral-500 dark:text-neutral-400">{label}</span>
        )}
        <span className="text-xs text-neutral-400 dark:text-neutral-500">Até {MAX_PDF_MB} MB. PDFs escaneados também funcionam.</span>
      </button>
    </div>
  );
}

// ---------- revisão ----------

const QuestionRow = memo(function QuestionRow({
  question,
  onChange,
  onRemove,
}: {
  question: QbDraftQuestion;
  onChange: (number: number, patch: Partial<QbDraftQuestion>) => void;
  onRemove: (number: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const n = question.number;
  const answerValue = question.annulled ? ANNULLED : question.answer;

  return (
    <li className={`card p-4 ${needsAttention(question) ? 'border-amber-300 dark:border-amber-700/70' : ''}`}>
      <div className="flex items-start gap-3">
        <span className="flex h-8 min-w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 px-2 text-sm font-bold text-brand-800 dark:bg-brand-950/50 dark:text-brand-200">
          {question.sourceId || n}
        </span>
        <div className="min-w-0 flex-1">
          {question.prova && (
            <p className="mb-1 truncate text-xs text-neutral-500 dark:text-neutral-400" title={question.prova}>
              {question.prova}
            </p>
          )}
          <p className="line-clamp-3 whitespace-pre-wrap text-sm text-neutral-800 dark:text-neutral-200">{question.statement}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {question.suspect && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950/60 dark:text-amber-200" title="O texto não bate com o do PDF">
                <AlertTriangle size={11} /> Confira o texto
              </span>
            )}
            {question.needsFigure && (
              <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                <ImageIcon size={11} /> Depende de figura
              </span>
            )}
            {!question.answer && !question.annulled && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">Sem gabarito</span>
            )}
            {question.comment && (
              <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-800 dark:bg-brand-950/50 dark:text-brand-200">Gabarito comentado</span>
            )}
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <input
              className="input-field py-2"
              value={question.discipline}
              onChange={(e) => onChange(n, { discipline: e.target.value })}
              placeholder="Disciplina"
              maxLength={160}
              aria-label={`Disciplina da questão ${n}`}
            />
            <input
              className="input-field py-2"
              value={question.subject}
              onChange={(e) => onChange(n, { subject: e.target.value })}
              placeholder="Assunto"
              maxLength={160}
              aria-label={`Assunto da questão ${n}`}
            />
            <select
              className="input-field py-2"
              value={answerValue}
              onChange={(e) => onChange(n, e.target.value === ANNULLED ? { answer: '', annulled: true } : { answer: e.target.value, annulled: false })}
              aria-label={`Gabarito da questão ${n}`}
            >
              <option value="">Sem gabarito</option>
              {question.alternatives.map((a) => (
                <option key={a.letter} value={a.letter}>
                  Gabarito: {a.letter}
                </option>
              ))}
              <option value={ANNULLED}>Anulada</option>
            </select>
          </div>

          <button type="button" onClick={() => setOpen((v) => !v)} className="mt-2 text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300">
            {open ? 'Fechar o texto' : 'Ver e editar o texto'}
          </button>
          {open && (
            <div className="mt-3 space-y-3">
              <div>
                <label className="label-field text-xs" htmlFor={`sup-${n}`}>Texto de apoio (se houver)</label>
                <textarea id={`sup-${n}`} className="input-field resize-y" rows={3} value={question.support} onChange={(e) => onChange(n, { support: e.target.value })} maxLength={12000} />
              </div>
              <div>
                <label className="label-field text-xs" htmlFor={`st-${n}`}>Enunciado</label>
                <textarea id={`st-${n}`} className="input-field resize-y" rows={4} value={question.statement} onChange={(e) => onChange(n, { statement: e.target.value })} maxLength={6000} />
              </div>
              <div>
                <label className="label-field text-xs" htmlFor={`cm-${n}`}>Gabarito comentado (se houver)</label>
                <textarea id={`cm-${n}`} className="input-field resize-y" rows={5} value={question.comment} onChange={(e) => onChange(n, { comment: e.target.value })} maxLength={12000} />
              </div>
              <div>
                <p className="label-field text-xs">Alternativas</p>
                <AlternativesEditor
                  alternatives={question.alternatives}
                  onChange={(alternatives) =>
                    onChange(n, {
                      alternatives,
                      answer: alternatives.some((a) => a.letter === question.answer) ? question.answer : '',
                    })
                  }
                />
              </div>
              {question.suspect && (
                <button type="button" onClick={() => onChange(n, { suspect: false })} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300">
                  <Check size={13} /> Já conferi o texto: tirar o aviso
                </button>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => onRemove(n)}
          className="rounded-lg p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
          title="Tirar esta questão da importação"
          aria-label={`Tirar a questão ${n}`}
        >
          <Trash2 size={16} />
        </button>
      </div>
    </li>
  );
});

function Review({ draft, jobId }: { draft: QbDraft; jobId: string }) {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [meta, setMeta] = useState<{ name: string; board: string; organ: string; year: string; position: string; level: string }>({
    name: draft.meta.name,
    board: draft.meta.board,
    organ: draft.meta.organ,
    year: draft.meta.year ? String(draft.meta.year) : '',
    position: draft.meta.position,
    level: draft.meta.level,
  });
  const [questions, setQuestions] = useState<QbDraftQuestion[]>(draft.questions);
  const [onlyAttention, setOnlyAttention] = useState(false);
  const [busy, setBusy] = useState(false);

  const change = useCallback((number: number, patch: Partial<QbDraftQuestion>) => {
    setQuestions((prev) => prev.map((q) => (q.number === number ? { ...q, ...patch } : q)));
  }, []);
  const remove = useCallback((number: number) => {
    setQuestions((prev) => prev.filter((q) => q.number !== number));
  }, []);

  const siteMode = useMemo(() => isFromSite(questions), [questions]);
  const provas = useMemo(() => groupProvas(questions, meta.name), [questions, meta.name]);
  const editProva = (key: string, patch: Parameters<typeof updateProva>[3]) => setQuestions((prev) => updateProva(prev, key, meta.name, patch));
  const attention = useMemo(() => questions.filter(needsAttention).length, [questions]);
  const withoutAnswer = useMemo(() => questions.filter((q) => !q.answer && !q.annulled).length, [questions]);
  const shown = onlyAttention ? questions.filter(needsAttention) : questions;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (provas.some((p) => p.name.trim().length < 2)) {
      showToast(siteMode ? 'Toda prova precisa de um nome.' : 'Dê um nome à prova.', 'error');
      return;
    }
    setBusy(true);
    try {
      const body: QbDraftMeta & { questions: QbDraftQuestion[]; jobId: string } = {
        ...meta,
        year: meta.year ? Number(meta.year) : null,
        questions,
        jobId,
      };
      const { exams, added, skipped } = await questionBankApi.saveExam(body);
      const extra = skipped > 0 ? ` ${skipped} já ${skipped === 1 ? 'estava' : 'estavam'} no banco e não ${skipped === 1 ? 'entrou' : 'entraram'} de novo.` : '';
      if (exams.length === 0) {
        showToast('Todas as questões já estavam no banco.');
        navigate('/questoes');
        return;
      }
      showToast(
        exams.length === 1
          ? `Prova importada com ${added} ${added === 1 ? 'questão' : 'questões'}.${extra}`
          : `${added} questões importadas em ${exams.length} provas.${extra}`,
      );
      navigate(exams.length === 1 ? `/questoes?prova=${exams[0].id}` : '/questoes/provas');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Não foi possível salvar a prova.', 'error');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save}>
      <h1 className="mb-1 text-2xl font-bold text-neutral-900 dark:text-neutral-100">{siteMode ? 'Conferir as questões' : 'Conferir a prova'}</h1>
      <p className="mb-5 text-sm text-neutral-500 dark:text-neutral-400">
        A IA leu {questions.length} {questions.length === 1 ? 'questão' : 'questões'} do PDF. Confira os dados e o gabarito antes de salvar: nada é gravado até você confirmar.
      </p>

      {draft.warnings.length > 0 && (
        <div className="mb-5 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-700/70 dark:bg-amber-950/30" role="alert">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200">
            <AlertTriangle size={16} /> Atenção
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-amber-900 dark:text-amber-200">
            {draft.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {siteMode ? (
        <section className="card mb-5 p-5" aria-label="Provas encontradas">
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            {provas.length} {provas.length === 1 ? 'prova encontrada' : 'provas encontradas'}
          </h2>
          <p className="mb-3 mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            Cada questão vem com a sua prova, banca, órgão e ano. As questões se juntam em uma prova por nome; corrija aqui o que a IA leu errado.
          </p>
          <ul className="space-y-3">
            {provas.map((p, index) => (
              <li key={index} className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-700">
                <label className="label-field text-xs" htmlFor={`pv-name-${index}`}>
                  Nome da prova <span className="font-normal text-neutral-400">({p.count} {p.count === 1 ? 'questão' : 'questões'})</span>
                </label>
                <input id={`pv-name-${index}`} className="input-field py-2" value={p.name} onChange={(e) => editProva(p.key, { name: e.target.value })} maxLength={300} />
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  <input className="input-field py-2" value={p.board} onChange={(e) => editProva(p.key, { board: e.target.value })} placeholder="Banca" maxLength={160} aria-label={`Banca da prova ${index + 1}`} />
                  <input className="input-field py-2" value={p.organ} onChange={(e) => editProva(p.key, { organ: e.target.value })} placeholder="Órgão" maxLength={160} aria-label={`Órgão da prova ${index + 1}`} />
                  <input
                    className="input-field py-2"
                    inputMode="numeric"
                    value={p.year ?? ''}
                    onChange={(e) => editProva(p.key, { year: Number(e.target.value.replace(/\D/g, '').slice(0, 4)) || null })}
                    placeholder="Ano"
                    aria-label={`Ano da prova ${index + 1}`}
                  />
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label-field" htmlFor="im-position">Cargo (vale para todas)</label>
              <input id="im-position" className="input-field" value={meta.position} onChange={(e) => setMeta({ ...meta, position: e.target.value })} maxLength={160} />
            </div>
            <div>
              <label className="label-field" htmlFor="im-level">Nível (vale para todas)</label>
              <select id="im-level" className="input-field" value={meta.level} onChange={(e) => setMeta({ ...meta, level: e.target.value })}>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {l || 'Não informado'}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>
      ) : (
        <section className="card mb-5 space-y-3 p-5">
          <div>
            <label className="label-field" htmlFor="im-name">Nome da prova</label>
            <input id="im-name" className="input-field" value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} maxLength={120} placeholder="Ex.: FGV 2023 - Analista do TJ" required />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="label-field" htmlFor="im-board">Banca</label>
              <input id="im-board" className="input-field" value={meta.board} onChange={(e) => setMeta({ ...meta, board: e.target.value })} maxLength={160} />
            </div>
            <div>
              <label className="label-field" htmlFor="im-organ">Órgão</label>
              <input id="im-organ" className="input-field" value={meta.organ} onChange={(e) => setMeta({ ...meta, organ: e.target.value })} maxLength={160} />
            </div>
            <div>
              <label className="label-field" htmlFor="im-year">Ano</label>
              <input id="im-year" className="input-field" inputMode="numeric" value={meta.year} onChange={(e) => setMeta({ ...meta, year: e.target.value.replace(/\D/g, '').slice(0, 4) })} />
            </div>
            <div>
              <label className="label-field" htmlFor="im-level">Nível</label>
              <select id="im-level" className="input-field" value={meta.level} onChange={(e) => setMeta({ ...meta, level: e.target.value })}>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {l || 'Não informado'}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="label-field" htmlFor="im-position">Cargo</label>
            <input id="im-position" className="input-field" value={meta.position} onChange={(e) => setMeta({ ...meta, position: e.target.value })} maxLength={160} />
          </div>
        </section>
      )}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          {questions.length} {questions.length === 1 ? 'questão' : 'questões'} · {withoutAnswer} sem gabarito · {attention} pedem atenção
        </p>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
          <input type="checkbox" checked={onlyAttention} onChange={(e) => setOnlyAttention(e.target.checked)} className="h-4 w-4 accent-brand-600" />
          Mostrar só as que pedem atenção
        </label>
      </div>

      {shown.length === 0 ? (
        <p className="card px-4 py-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
          {questions.length === 0 ? 'Todas as questões foram tiradas da importação.' : 'Nenhuma questão pede atenção.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {shown.map((q) => (
            <QuestionRow key={q.number} question={q} onChange={change} onRemove={remove} />
          ))}
        </ul>
      )}

      <div className="sticky bottom-0 -mx-1 mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200 bg-white/95 px-1 py-4 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/95">
        <Link to="/questoes" className="text-sm font-medium text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200">
          Descartar
        </Link>
        <button type="submit" className="btn-primary" disabled={busy || questions.length === 0 || provas.some((p) => p.name.trim().length < 2)}>
          {busy && <Loader2 size={16} className="animate-spin" />}
          Salvar {questions.length} {questions.length === 1 ? 'questão' : 'questões'}
        </button>
      </div>
    </form>
  );
}

// ---------- página ----------

export function PastExamImport() {
  const { showToast } = useToast();
  const [params, setParams] = useSearchParams();
  const jobId = params.get('job');

  const [file, setFile] = useState<File | null>(null);
  const [keyMode, setKeyMode] = useState<KeyMode>('same');
  const [keyFile, setKeyFile] = useState<File | null>(null);
  const [keyText, setKeyText] = useState('');
  const [board, setBoard] = useState('');
  const [year, setYear] = useState('');
  const [position, setPosition] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [job, setJob] = useState<QbImportJob | null>(null);
  const [lost, setLost] = useState(false);

  // Acompanha a leitura no servidor até terminar.
  useEffect(() => {
    if (!jobId || job?.status === 'done' || job?.status === 'error' || lost) return;
    let alive = true;
    const tick = async () => {
      try {
        const { job: next } = await questionBankApi.importStatus(jobId);
        if (!alive) return;
        setJob(next);
        if (next.status !== 'running') window.dispatchEvent(new Event(AI_USAGE_EVENT));
      } catch {
        if (alive) setLost(true);
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [jobId, job?.status, lost]);

  function restart() {
    setJob(null);
    setLost(false);
    setError(null);
    setParams({}, { replace: true });
  }

  async function start(event: FormEvent) {
    event.preventDefault();
    if (!file || starting) return;
    if (keyMode === 'file' && !keyFile) {
      setError('Escolha o PDF do gabarito, ou mude a opção do gabarito.');
      return;
    }
    if (keyMode === 'text' && keyText.trim().length < 5) {
      setError('Cole o gabarito, ou mude a opção do gabarito.');
      return;
    }
    setError(null);
    setStarting(true);
    try {
      const { job: started } = await questionBankApi.startImport(
        file,
        { file: keyMode === 'file' ? keyFile : null, text: keyMode === 'text' ? keyText : '' },
        { board, year, position },
      );
      setJob(started);
      setParams({ job: started.id }, { replace: true });
    } catch (err) {
      const text = err instanceof ApiError ? err.message : 'Não foi possível enviar o PDF.';
      setError(text);
      showToast(text, 'error');
    } finally {
      setStarting(false);
    }
  }

  const back = (
    <Link to="/questoes" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-neutral-500 hover:text-brand-600 dark:text-neutral-400 dark:hover:text-brand-400">
      <ArrowLeft size={16} />
      Questões
    </Link>
  );

  // Leitura terminada: revisão.
  if (job?.status === 'done' && job.draft) {
    return (
      <div className="mx-auto max-w-4xl">
        {back}
        <Review draft={job.draft} jobId={job.id} />
      </div>
    );
  }

  // Lendo (ou o servidor perdeu o trabalho, ou deu erro).
  if (jobId) {
    const progress = job?.progress;
    const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
    return (
      <div className="mx-auto max-w-xl">
        {back}
        <div className="card p-6 text-center">
          {job?.status === 'error' || lost ? (
            <>
              <AlertTriangle size={28} className="mx-auto text-amber-500" />
              <h1 className="mt-3 text-lg font-semibold text-neutral-900 dark:text-neutral-100">Não foi possível ler a prova</h1>
              <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
                {lost ? 'A importação foi perdida (o servidor reiniciou ou o tempo passou). Envie o PDF de novo.' : job?.error}
              </p>
              <button type="button" onClick={restart} className="btn-primary mt-5">
                Tentar de novo
              </button>
            </>
          ) : (
            <>
              <Loader2 size={28} className="mx-auto animate-spin text-brand-600" />
              <h1 className="mt-3 text-lg font-semibold text-neutral-900 dark:text-neutral-100">{progress?.stage ?? 'Preparando a leitura'}</h1>
              <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                A IA lê a prova por partes. Pode levar alguns minutos: você pode sair desta tela e voltar, o endereço guarda o andamento.
              </p>
              {progress && progress.total > 0 && (
                <div className="mt-5">
                  <div className="h-2 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                    <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                    Parte {Math.min(progress.done + 1, progress.total)} de {progress.total}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  // Formulário.
  const radio = (mode: KeyMode, label: string) => (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
      <input type="radio" name="key-mode" checked={keyMode === mode} onChange={() => setKeyMode(mode)} className="h-4 w-4 accent-brand-600" />
      {label}
    </label>
  );

  return (
    <div className="mx-auto max-w-2xl">
      {back}
      <h1 className="mb-1 text-2xl font-bold text-neutral-900 dark:text-neutral-100">Importar uma prova</h1>
      <p className="mb-6 text-sm text-neutral-500 dark:text-neutral-400">
        Envie o PDF de uma prova antiga da banca. A IA copia as questões e as alternativas como estão no PDF (sem reescrever nada) e
        junta o gabarito. Você confere tudo antes de salvar.
      </p>

      <form onSubmit={start} className="card space-y-5 p-6">
        <div>
          <p className="label-field">PDF da prova</p>
          <PdfPicker file={file} onPick={setFile} onError={setError} label="Clique para escolher o PDF da prova" />
        </div>

        <fieldset>
          <legend className="label-field">Onde está o gabarito?</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {radio('same', 'No mesmo PDF (ou ainda não tenho)')}
            {radio('file', 'Em outro PDF')}
            {radio('text', 'Vou colar')}
          </div>
          {keyMode === 'file' && (
            <div className="mt-3">
              <PdfPicker file={keyFile} onPick={setKeyFile} onError={setError} label="Clique para escolher o PDF do gabarito" />
            </div>
          )}
          {keyMode === 'text' && (
            <textarea
              className="input-field mt-3 resize-y"
              rows={5}
              maxLength={20000}
              value={keyText}
              onChange={(e) => setKeyText(e.target.value)}
              placeholder="Cole a tabela do gabarito, ex.: 1-A 2-C 3-E 4-B (anuladas: X ou ANULADA)"
              aria-label="Gabarito colado"
            />
          )}
          <p className="mt-2 text-xs text-neutral-400 dark:text-neutral-500">
            Sem o gabarito a prova é importada do mesmo jeito; você informa a alternativa certa depois, questão por questão.
          </p>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label-field" htmlFor="h-board">Banca (opcional)</label>
            <input id="h-board" className="input-field" value={board} onChange={(e) => setBoard(e.target.value)} maxLength={160} placeholder="Ex.: FGV" />
          </div>
          <div>
            <label className="label-field" htmlFor="h-year">Ano (opcional)</label>
            <input id="h-year" className="input-field" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="Ex.: 2023" />
          </div>
          <div>
            <label className="label-field" htmlFor="h-position">Cargo (opcional)</label>
            <input id="h-position" className="input-field" value={position} onChange={(e) => setPosition(e.target.value)} maxLength={160} placeholder="Ex.: Analista" />
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end">
          <button type="submit" className="btn-primary" disabled={!file || starting}>
            {starting ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            Ler a prova
          </button>
        </div>
      </form>
    </div>
  );
}
