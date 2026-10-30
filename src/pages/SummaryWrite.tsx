import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Save } from 'lucide-react';

import { RichTextEditor } from '../components/RichTextEditor';
import { ApiError, summariesApi } from '../services/api';
import { editorHasContent } from '../utils/flashcardEditor';
import { editorHtmlToText, summaryTitleFromText } from '../utils/summaryText';

const MAX_TITLE_CHARS = 200;

/** Um resumo escrito (ou colado) pelo usuário, guardado como está: sem IA, com a formatação. */
export function SummaryWrite() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [html, setHtml] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sem título digitado, vale a primeira linha do texto.
  const text = useMemo(() => editorHtmlToText(html), [html]);
  const canSave = editorHasContent(html);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!canSave || saving) return;
    setSaving(true);
    setError(null);
    try {
      const { summary } = await summariesApi.create({
        title: title.trim() || summaryTitleFromText(text),
        content: html,
        format: 'html',
      });
      navigate(`/resumos/meus?open=${summary.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar o resumo.');
    } finally {
      setSaving(false);
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
      <h1 className="mb-6 text-2xl font-bold text-neutral-900 dark:text-neutral-100">Criar Resumo sem IA</h1>

      <form onSubmit={handleSave} className="card space-y-4 p-6">
        <div>
          <label className="label-field" htmlFor="summary-write-title">
            Título
          </label>
          <input
            id="summary-write-title"
            className="input-field"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={MAX_TITLE_CHARS}
            placeholder="Se ficar em branco, vale a primeira linha do texto"
          />
        </div>
        <div>
          <span className="label-field">Resumo</span>
          <RichTextEditor
            value={html}
            onChange={setHtml}
            placeholder="Digite ou cole o seu resumo"
            minHeight="18rem"
            maxHeight="36rem"
          />
          <p className="mt-1.5 text-xs text-neutral-400 dark:text-neutral-500">
            Cole com Ctrl+V para manter negrito, listas e parágrafos; Ctrl+Shift+V cola só o texto. O resumo é guardado
            como está aqui, com a formatação, e pode ser editado depois em Meus Resumos.
          </p>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-neutral-400 dark:text-neutral-500">
            Total de caracteres: {text.length.toLocaleString('pt-BR')}
          </p>
          <button type="submit" disabled={!canSave || saving} className="btn-primary shrink-0">
            {saving ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Salvando...
              </>
            ) : (
              <>
                <Save size={16} />
                Salvar resumo
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
