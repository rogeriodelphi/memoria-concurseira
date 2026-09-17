import { useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlignLeft, ArrowLeft, Lightbulb, Loader2, Sparkles, UploadCloud, X, Youtube } from 'lucide-react';

import { ApiError, mindMapsApi } from '../services/api';

type SourceTab = 'arquivo' | 'topico' | 'texto' | 'youtube';

const SOURCE_TABS: { id: SourceTab; label: string; icon: typeof UploadCloud }[] = [
  { id: 'arquivo', label: 'Arquivo', icon: UploadCloud },
  { id: 'topico', label: 'Tópico', icon: Lightbulb },
  { id: 'texto', label: 'Texto', icon: AlignLeft },
  { id: 'youtube', label: 'YouTube', icon: Youtube },
];

const ACCEPTED_FILE_TYPES = 'application/pdf,image/*,audio/*,video/*';

function isAcceptedFileType(file: File): boolean {
  return (
    file.type === 'application/pdf' ||
    file.type.startsWith('image/') ||
    file.type.startsWith('audio/') ||
    file.type.startsWith('video/')
  );
}

export function MindMapNew() {
  const navigate = useNavigate();

  const [sourceTab, setSourceTab] = useState<SourceTab>('topico');
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [topic, setTopic] = useState('');
  const [text, setText] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pickFile(f: File | null) {
    if (f && !isAcceptedFileType(f)) {
      setError('Formato não suportado. Envie um PDF, imagem, áudio ou vídeo.');
      return;
    }
    setError(null);
    setFile(f);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    pickFile(e.dataTransfer.files?.[0] ?? null);
  }

  function handleFileInput(e: ChangeEvent<HTMLInputElement>) {
    pickFile(e.target.files?.[0] ?? null);
  }

  function canSubmit(): boolean {
    if (sourceTab === 'arquivo') return !!file;
    if (sourceTab === 'topico') return topic.trim().length > 0;
    if (sourceTab === 'texto') return text.trim().length > 0;
    return youtubeUrl.trim().length > 0;
  }

  async function handleGenerate(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit()) return;
    setGenerating(true);
    setError(null);
    try {
      const trimmedTitle = title.trim() || undefined;
      let result;
      if (sourceTab === 'arquivo' && file) {
        result = await mindMapsApi.fromFile(file, trimmedTitle);
      } else if (sourceTab === 'topico') {
        result = await mindMapsApi.fromTopic(topic.trim(), trimmedTitle);
      } else if (sourceTab === 'texto') {
        result = await mindMapsApi.fromText(text.trim(), trimmedTitle);
      } else {
        result = await mindMapsApi.fromYoutube(youtubeUrl.trim(), trimmedTitle);
      }
      navigate(`/mapas-mentais/${result.mindMap.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível gerar o mapa mental.');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        to="/mapas-mentais"
        className="mb-4 flex items-center gap-1.5 text-sm font-medium text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
      >
        <ArrowLeft size={16} />
        Mapas Mentais
      </Link>
      <h1 className="mb-1 text-2xl font-bold text-neutral-900 dark:text-neutral-100">Criar Mapa</h1>
      <p className="mb-6 text-sm text-neutral-500 dark:text-neutral-400">
        Escolha a fonte do conteúdo e deixe a IA organizar em um mapa mental.
      </p>

      <form onSubmit={handleGenerate} className="card space-y-6 p-6">
        <div>
          <label className="label-field">Título (opcional)</label>
          <input
            type="text"
            className="input-field"
            placeholder="Deixe em branco para a IA escolher"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
          />
        </div>

        <div>
          <div className="mb-4 flex gap-1 border-b border-neutral-200 dark:border-neutral-700">
            {SOURCE_TABS.map((tab) => {
              const Icon = tab.icon;
              const active = sourceTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setSourceTab(tab.id);
                    setError(null);
                  }}
                  className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                    active
                      ? 'border-brand-500 text-brand-600 dark:text-brand-400'
                      : 'border-transparent text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200'
                  }`}
                >
                  <Icon size={15} />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {sourceTab === 'arquivo' &&
            (!file ? (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors ${
                  dragOver
                    ? 'border-brand-400 bg-brand-50 dark:bg-brand-950/30'
                    : 'border-neutral-200 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800/60'
                }`}
              >
                <UploadCloud className="text-brand-500" size={28} />
                <label className="cursor-pointer text-sm">
                  <span className="font-semibold text-brand-600 hover:text-brand-700">Selecionar arquivo</span>
                  <span className="text-neutral-500 dark:text-neutral-400"> ou arraste aqui</span>
                  <input type="file" accept={ACCEPTED_FILE_TYPES} className="hidden" onChange={handleFileInput} />
                </label>
                <p className="text-xs text-neutral-400 dark:text-neutral-500">
                  PDFs · imagens · áudio · vídeo · máximo 100 MB
                </p>
              </div>
            ) : (
              <div className="flex items-center justify-between rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800/60">
                <p className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">{file.name}</p>
                <button
                  type="button"
                  onClick={() => setFile(null)}
                  className="text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300"
                >
                  <X size={18} />
                </button>
              </div>
            ))}

          {sourceTab === 'topico' && (
            <input
              type="text"
              className="input-field"
              placeholder="Ex.: Controle de constitucionalidade no Direito Constitucional"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              maxLength={300}
            />
          )}

          {sourceTab === 'texto' && (
            <textarea
              rows={8}
              className="input-field resize-none"
              placeholder="Cole aqui o texto que deseja organizar em mapa mental."
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={100000}
            />
          )}

          {sourceTab === 'youtube' && (
            <input
              type="url"
              className="input-field"
              placeholder="https://www.youtube.com/watch?v=..."
              value={youtubeUrl}
              onChange={(e) => setYoutubeUrl(e.target.value)}
            />
          )}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button type="submit" disabled={!canSubmit() || generating} className="btn-primary w-full">
          {generating ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Gerando mapa mental...
            </>
          ) : (
            <>
              <Sparkles size={16} />
              Gerar Mapa Mental
            </>
          )}
        </button>
        {generating && (
          <p className="text-center text-xs text-neutral-400 dark:text-neutral-500">
            Pode levar alguns instantes, dependendo do conteúdo e da demanda no momento. Não feche esta página.
          </p>
        )}
      </form>
    </div>
  );
}
