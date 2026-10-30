import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Save, Sparkles } from 'lucide-react';

import { RichTextEditor } from '../components/RichTextEditor';
import { ApiError, summariesApi } from '../services/api';
import type { SummaryMode } from '../types';
import { editorHasContent } from '../utils/flashcardEditor';
import { editorHtmlToText, summaryTitleFromText } from '../utils/summaryText';

const MIN_CHARS = 250;
const MAX_CHARS = 64_000;

export function SummaryNew() {
  const navigate = useNavigate();
  const [html, setHtml] = useState('');
  const [mode, setMode] = useState<SummaryMode>('padrao');
  const [busy, setBusy] = useState<'generate' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A IA recebe o texto com a estrutura (parágrafos, listas, **negrito**); o HTML do editor é o que "Salvar sem IA" guarda.
  const text = useMemo(() => editorHtmlToText(html), [html]);
  const tooLong = text.length > MAX_CHARS;
  const canGenerate = text.length >= MIN_CHARS && !tooLong;
  const canSave = editorHasContent(html);

  async function handleGenerate(e: FormEvent) {
    e.preventDefault();
    if (!canGenerate || busy) return;
    setBusy('generate');
    setError(null);
    try {
      await summariesApi.generate(text, mode);
      navigate('/resumos/meus');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível gerar o resumo.');
    } finally {
      setBusy(null);
    }
  }

  async function handleSave() {
    if (!canSave || busy) return;
    setBusy('save');
    setError(null);
    try {
      const { summary } = await summariesApi.create({ title: summaryTitleFromText(text), content: html, format: 'html' });
      navigate(`/resumos/meus?open=${summary.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar o resumo.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        to="/resumos"
        className="mb-4 flex items-center gap-1.5 text-sm font-medium text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
      >
        <ArrowLeft size={16} />
        Voltar
      </Link>
      <h1 className="mb-6 text-2xl font-bold text-neutral-900 dark:text-neutral-100">Criar Resumo com IA</h1>

      <form onSubmit={handleGenerate} className="card space-y-3 p-6">
        <RichTextEditor
          value={html}
          onChange={setHtml}
          placeholder={`Digite ou cole o conteúdo (para a IA, entre ${MIN_CHARS} e ${MAX_CHARS.toLocaleString('pt-BR')} caracteres)`}
          minHeight="14rem"
          maxHeight="32rem"
        />
        <p className="text-xs text-neutral-400 dark:text-neutral-500">
          Cole com Ctrl+V para manter negrito, listas e parágrafos; Ctrl+Shift+V cola só o texto. &quot;Gerar Resumo&quot;
          manda o texto para a IA resumir; &quot;Salvar sem IA&quot; guarda o que está aqui, com a formatação, como um
          resumo seu.
        </p>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={`text-xs ${tooLong ? 'text-red-600' : 'text-neutral-400 dark:text-neutral-500'}`}>
            Total de caracteres: {text.length.toLocaleString('pt-BR')}
            {tooLong && ` (a IA aceita até ${MAX_CHARS.toLocaleString('pt-BR')})`}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="input-field w-auto"
              value={mode}
              onChange={(e) => setMode(e.target.value as SummaryMode)}
              aria-label="Modo do resumo"
            >
              <option value="padrao">Modo Padrão</option>
              <option value="intensivo">Modo Intensivo</option>
            </select>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!canSave || busy !== null}
              className="btn-secondary shrink-0"
              title="Guarda o texto como está, com a formatação, sem usar a IA"
            >
              {busy === 'save' ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Salvando...
                </>
              ) : (
                <>
                  <Save size={16} />
                  Salvar sem IA
                </>
              )}
            </button>
            <button type="submit" disabled={!canGenerate || busy !== null} className="btn-primary shrink-0">
              {busy === 'generate' ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Gerando...
                </>
              ) : (
                <>
                  <Sparkles size={16} />
                  Gerar Resumo
                </>
              )}
            </button>
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {busy === 'generate' && (
          <p className="text-center text-xs text-neutral-400 dark:text-neutral-500">
            Pode levar alguns instantes, dependendo do tamanho do conteúdo. Não feche esta página.
          </p>
        )}
      </form>
    </div>
  );
}
