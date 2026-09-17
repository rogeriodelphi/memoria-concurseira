import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Sparkles } from 'lucide-react';

import { ApiError, bulletPointsApi } from '../services/api';

const MIN_CHARS = 250;
const MAX_CHARS = 64_000;

export function BulletPointsNew() {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = text.trim().length >= MIN_CHARS && text.length <= MAX_CHARS;

  async function handleGenerate(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setGenerating(true);
    setError(null);
    try {
      await bulletPointsApi.generate(text.trim());
      navigate('/bullet-points/meus');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível gerar os bullet points.');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        to="/bullet-points"
        className="mb-4 flex items-center gap-1.5 text-sm font-medium text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
      >
        <ArrowLeft size={16} />
        Voltar
      </Link>
      <h1 className="mb-6 text-2xl font-bold text-neutral-900 dark:text-neutral-100">Criar Bullet points com IA</h1>

      <form onSubmit={handleGenerate} className="card space-y-3 p-6">
        <textarea
          rows={10}
          className="input-field resize-none"
          placeholder={`Insira o conteúdo (entre ${MIN_CHARS} e ${MAX_CHARS.toLocaleString('pt-BR')} caracteres)`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={MAX_CHARS}
        />

        <div className="flex items-center justify-between">
          <p className="text-xs text-neutral-400 dark:text-neutral-500">
            Total de caracteres: {text.length.toLocaleString('pt-BR')}
          </p>
          <button type="submit" disabled={!canSubmit || generating} className="btn-primary shrink-0">
            {generating ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Gerando...
              </>
            ) : (
              <>
                <Sparkles size={16} />
                Gerar Bullet points
              </>
            )}
          </button>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {generating && (
          <p className="text-center text-xs text-neutral-400 dark:text-neutral-500">
            Pode levar alguns instantes, dependendo do tamanho do conteúdo. Não feche esta página.
          </p>
        )}
      </form>
    </div>
  );
}
