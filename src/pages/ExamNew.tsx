import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, FileText, Loader2, PenLine, Sparkles, Upload } from 'lucide-react';

import { ExamStructureEditor } from '../components/ExamStructureEditor';
import { useConfirm } from '../contexts/ConfirmContext';
import { ApiError, examsApi } from '../services/api';
import { emptyExamDraft, plural } from '../utils/exam';
import type { ExamDraft } from '../types';

const MIN_CHARS = 40;
const MAX_CHARS = 350_000;
const MAX_PDF_MB = 30;

type Source = 'text' | 'pdf';

const tabClass = (active: boolean) =>
  `flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
    active
      ? 'bg-brand-600 text-white shadow-card'
      : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700'
  }`;

export function ExamNew() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [draft, setDraft] = useState<ExamDraft | null>(null);
  const [fromAi, setFromAi] = useState(false);

  const [source, setSource] = useState<Source>('text');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [position, setPosition] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const canAnalyze =
    source === 'text' ? text.trim().length >= MIN_CHARS && text.length <= MAX_CHARS : file !== null;

  function pickFile(picked: File | null) {
    setError(null);
    if (picked && picked.size > MAX_PDF_MB * 1024 * 1024) {
      setFile(null);
      setError(`O PDF passa de ${MAX_PDF_MB} MB. Cole só o trecho do conteúdo programático.`);
      return;
    }
    setFile(picked);
  }

  async function handleAnalyze(e: FormEvent) {
    e.preventDefault();
    if (!canAnalyze) return;
    setAnalyzing(true);
    setError(null);
    try {
      const { draft: extracted } =
        source === 'text'
          ? await examsApi.extractFromText(text.trim(), position.trim())
          : await examsApi.extractFromFile(file!, position.trim());
      setDraft(extracted);
      setFromAi(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível analisar o edital.');
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleBack() {
    const ok = await confirm({
      message: 'Voltar descarta o que você já revisou aqui. Continuar?',
      confirmLabel: 'Descartar e voltar',
      danger: true,
    });
    if (!ok) return;
    setDraft(null);
    setFromAi(false);
    setSaveError(null);
  }

  async function handleSave() {
    if (!draft) return;
    if (draft.name.trim().length < 2) {
      setSaveError('Informe um nome para o concurso.');
      return;
    }
    if (draft.disciplines.length === 0) {
      setSaveError('Adicione ao menos uma disciplina.');
      return;
    }
    if (draft.disciplines.some((d) => !d.name.trim())) {
      setSaveError('Toda disciplina precisa de um nome.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const { id } = await examsApi.create(draft);
      navigate(`/concursos/${id}`);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Não foi possível salvar o concurso.');
      setSaving(false);
    }
  }

  const topicCount = draft ? draft.disciplines.reduce((n, d) => n + d.topics.length, 0) : 0;

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        to="/concursos"
        className="mb-4 flex items-center gap-1.5 text-sm font-medium text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
      >
        <ArrowLeft size={16} />
        Concursos
      </Link>

      {!draft ? (
        <>
          <h1 className="mb-1 text-2xl font-bold text-neutral-900 dark:text-neutral-100">Novo concurso</h1>
          <p className="mb-6 text-sm text-neutral-500 dark:text-neutral-400">
            Envie o edital ou cole o conteúdo programático. A IA monta a lista de disciplinas e tópicos, e você confere antes
            de salvar.
          </p>

          <form onSubmit={handleAnalyze} className="card space-y-4 p-6">
            <div className="flex gap-2">
              <button type="button" className={tabClass(source === 'text')} onClick={() => setSource('text')}>
                <FileText size={16} />
                Colar texto
              </button>
              <button type="button" className={tabClass(source === 'pdf')} onClick={() => setSource('pdf')}>
                <Upload size={16} />
                Enviar PDF
              </button>
            </div>

            {source === 'text' ? (
              <div>
                <textarea
                  rows={12}
                  className="input-field resize-y"
                  placeholder="Cole aqui o conteúdo programático do edital (ou o edital inteiro)"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  maxLength={MAX_CHARS}
                />
                <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
                  {text.length.toLocaleString('pt-BR')} caracteres. Colar só o conteúdo programático é mais rápido e preciso do
                  que o edital inteiro.
                </p>
              </div>
            ) : (
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-neutral-200 px-6 py-10 text-center transition-colors hover:border-brand-400 hover:bg-brand-50/40 dark:border-neutral-700 dark:hover:border-brand-600 dark:hover:bg-brand-950/20"
                >
                  <Upload size={22} className="text-neutral-400" />
                  {file ? (
                    <span className="text-sm font-medium text-neutral-800 dark:text-neutral-100">{file.name}</span>
                  ) : (
                    <span className="text-sm text-neutral-500 dark:text-neutral-400">Clique para escolher o PDF do edital</span>
                  )}
                  <span className="text-xs text-neutral-400 dark:text-neutral-500">Até {MAX_PDF_MB} MB. PDFs escaneados também funcionam.</span>
                </button>
              </div>
            )}

            <div>
              <label className="label-field">Cargo (opcional)</label>
              <input
                className="input-field"
                value={position}
                onChange={(e) => setPosition(e.target.value)}
                placeholder="Ajuda quando o edital tem vários cargos, ex.: Analista de TI"
                maxLength={120}
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                className="flex items-center gap-1.5 text-sm font-medium text-neutral-500 hover:text-brand-600 dark:text-neutral-400 dark:hover:text-brand-400"
                onClick={() => {
                  setDraft(emptyExamDraft());
                  setFromAi(false);
                }}
              >
                <PenLine size={15} />
                Montar do zero, sem IA
              </button>
              <button type="submit" disabled={!canAnalyze || analyzing} className="btn-primary">
                {analyzing ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Analisando...
                  </>
                ) : (
                  <>
                    <Sparkles size={16} />
                    Analisar edital com IA
                  </>
                )}
              </button>
            </div>
            {analyzing && (
              <p className="text-center text-xs text-neutral-400 dark:text-neutral-500">
                Pode levar de alguns segundos a um minuto, conforme o tamanho do edital. Não feche esta página.
              </p>
            )}
          </form>
        </>
      ) : (
        <>
          <h1 className="mb-1 text-2xl font-bold text-neutral-900 dark:text-neutral-100">
            {fromAi ? 'Revise o que a IA encontrou' : 'Montar o concurso'}
          </h1>
          <p className="mb-6 text-sm text-neutral-500 dark:text-neutral-400">
            {fromAi
              ? `${plural(draft.disciplines.length, 'disciplina', 'disciplinas')} e ${plural(topicCount, 'tópico', 'tópicos')}. A IA pode agrupar ou separar tópicos de um jeito diferente do edital: corrija o que for preciso antes de salvar.`
              : 'Preencha os dados, as disciplinas e os tópicos. Você pode ajustar tudo depois.'}
          </p>

          <ExamStructureEditor value={draft} onChange={setDraft} />

          {saveError && <p className="mt-4 text-sm text-red-600">{saveError}</p>}
          <div className="mt-6 flex items-center justify-between gap-3">
            <button type="button" className="btn-secondary" onClick={handleBack} disabled={saving}>
              Voltar
            </button>
            <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Salvando...' : 'Salvar concurso'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
