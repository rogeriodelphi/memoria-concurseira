import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ChevronRight, FileText, Loader2, Pencil, Plus, Trash2, Volume2, VolumeX } from 'lucide-react';

import { ApiError, summariesApi } from '../services/api';
import { FormattedText } from '../components/FormattedText';
import { RichTextEditor } from '../components/RichTextEditor';
import { useConfirm } from '../contexts/ConfirmContext';
import { useToast } from '../contexts/ToastContext';
import { useSpeech } from '../hooks/useSpeech';
import type { Summary } from '../types';
import { editorHasContent, toEditorHtml } from '../utils/flashcardEditor';
import { summaryToSpeech } from '../utils/speech';

export function SummaryList() {
  const confirm = useConfirm();
  const { showToast } = useToast();
  const { speak, stop, speaking, loading, canSpeak } = useSpeech();
  const [searchParams] = useSearchParams();
  const [summaries, setSummaries] = useState<Summary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(searchParams.get('open'));

  // Edição de um resumo por vez: o mesmo editor de texto rico dos cartões.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editDirty, setEditDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Fechar ou trocar de resumo para a leitura: ninguém quer ouvir o que acabou de esconder.
  // (O hook também para tudo ao sair da tela.)
  useEffect(() => {
    stop();
  }, [expandedId, stop]);

  function toggleSpeak(summary: Summary) {
    if (speaking === 'text') {
      stop();
      return;
    }
    void speak(summaryToSpeech(summary.title, summary.content, summary.format), 'text');
  }

  function load() {
    summariesApi
      .list()
      .then(({ summaries }) => setSummaries(summaries))
      .catch(() => setError('Não foi possível carregar seus resumos.'));
  }

  useEffect(load, []);

  function startEditing(summary: Summary) {
    stop();
    setExpandedId(summary.id);
    setEditingId(summary.id);
    setEditTitle(summary.title);
    setEditContent(toEditorHtml(summary.content, summary.format));
    setEditDirty(false);
    setEditError(null);
  }

  function stopEditing() {
    setEditingId(null);
    setEditDirty(false);
    setEditError(null);
  }

  // Abrir outro resumo (ou fechar este) no meio de uma edição jogaria fora o que foi
  // digitado; um resumo pode ser longo, então pergunta antes.
  async function toggleExpanded(id: string) {
    if (editingId && editDirty) {
      const discard = await confirm({ message: 'Descartar as alterações feitas neste resumo?', danger: true });
      if (!discard) return;
    }
    stopEditing();
    setExpandedId(expandedId === id ? null : id);
  }

  async function saveEditing() {
    if (!editingId || saving) return;
    if (!editTitle.trim()) {
      setEditError('Informe um título para o resumo.');
      return;
    }
    if (!editorHasContent(editContent)) {
      setEditError('O resumo não pode ficar vazio.');
      return;
    }
    setSaving(true);
    setEditError(null);
    try {
      const { summary } = await summariesApi.update(editingId, {
        title: editTitle,
        content: editContent,
        format: 'html',
      });
      setSummaries((prev) => prev?.map((s) => (s.id === summary.id ? summary : s)) ?? prev);
      stopEditing();
      showToast('Resumo salvo.');
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : 'Não foi possível salvar o resumo.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    const ok = await confirm({ message: 'Excluir este resumo? Essa ação não pode ser desfeita.', danger: true });
    if (!ok) return;
    try {
      await summariesApi.remove(id);
      if (expandedId === id) stop(); // o resumo some da tela: a leitura dele também
      if (editingId === id) stopEditing();
      setSummaries((prev) => prev?.filter((s) => s.id !== id) ?? prev);
      showToast('Resumo excluído.');
    } catch {
      showToast('Não foi possível excluir o resumo.', 'error');
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        to="/resumos"
        className="mb-4 flex items-center gap-1.5 text-sm font-medium text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
      >
        <ArrowLeft size={16} />
        Voltar
      </Link>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Meus Resumos</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/resumos/escrever" className="btn-secondary">
            <Pencil size={16} />
            Escrever sem IA
          </Link>
          <Link to="/resumos/criar" className="btn-primary">
            <Plus size={16} />
            Criar Resumo
          </Link>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {summaries === null && !error && (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">Carregando...</p>
      )}

      {summaries !== null && summaries.length === 0 && (
        <div className="card flex flex-col items-center gap-3 px-6 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400">
            <FileText size={22} />
          </div>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">Você ainda não criou nenhum resumo.</p>
          <Link to="/resumos/criar" className="btn-primary mt-2">
            <Plus size={16} />
            Criar meu primeiro resumo
          </Link>
        </div>
      )}

      {summaries !== null && summaries.length > 0 && (
        <div className="card divide-y divide-neutral-200 dark:divide-neutral-800">
          {summaries.map((s) => {
            const expanded = expandedId === s.id;
            const editing = editingId === s.id;
            return (
              <div key={s.id}>
                <div className="flex items-center gap-2 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => void toggleExpanded(s.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <ChevronRight
                      size={16}
                      className={`shrink-0 text-neutral-400 transition-transform dark:text-neutral-500 ${expanded ? 'rotate-90' : ''}`}
                    />
                    <span className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">
                      {s.title}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => startEditing(s)}
                    disabled={editing}
                    className="shrink-0 rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 disabled:opacity-40 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
                    title="Editar"
                    aria-label="Editar resumo"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(s.id)}
                    className="shrink-0 rounded-lg p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-600 dark:text-neutral-500 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                    title="Excluir"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                {expanded && editing && (
                  <form
                    className="space-y-3 px-4 pb-4 pl-10"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void saveEditing();
                    }}
                  >
                    <div>
                      <label className="label-field" htmlFor={`summary-title-${s.id}`}>
                        Título
                      </label>
                      <input
                        id={`summary-title-${s.id}`}
                        className="input-field"
                        value={editTitle}
                        onChange={(e) => {
                          setEditTitle(e.target.value);
                          setEditDirty(true);
                        }}
                        maxLength={200}
                      />
                    </div>
                    <div>
                      <span className="label-field">Resumo</span>
                      <RichTextEditor
                        value={editContent}
                        onChange={(html) => {
                          setEditContent(html);
                          setEditDirty(true);
                        }}
                        role="answer"
                        placeholder="Texto do resumo"
                      />
                    </div>
                    {editError && <p className="text-sm text-red-600">{editError}</p>}
                    <div className="flex gap-2">
                      <button type="submit" disabled={saving} className="btn-primary">
                        {saving ? (
                          <>
                            <Loader2 size={16} className="animate-spin" />
                            Salvando...
                          </>
                        ) : (
                          'Salvar'
                        )}
                      </button>
                      <button type="button" onClick={stopEditing} disabled={saving} className="btn-secondary">
                        Cancelar
                      </button>
                    </div>
                  </form>
                )}
                {expanded && !editing && (
                  <div className="px-4 pb-4 pl-10">
                    {canSpeak && (
                      <button
                        type="button"
                        onClick={() => toggleSpeak(s)}
                        className="mb-3 flex items-center gap-1 text-xs font-medium text-neutral-400 hover:text-brand-600 dark:text-neutral-500 dark:hover:text-brand-400"
                      >
                        {loading === 'text' ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : speaking === 'text' ? (
                          <VolumeX size={14} />
                        ) : (
                          <Volume2 size={14} />
                        )}
                        {loading === 'text' ? 'Preparando voz...' : speaking === 'text' ? 'Parar' : 'Ouvir'}
                      </button>
                    )}
                    {/* Justificado por padrão, como a resposta de um cartão; o que o usuário alinha no editor prevalece. */}
                    <FormattedText
                      value={s.content}
                      format={s.format}
                      role="answer"
                      className={`text-sm text-neutral-600 dark:text-neutral-300 ${s.format === 'plain' ? 'whitespace-pre-wrap' : ''}`}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
