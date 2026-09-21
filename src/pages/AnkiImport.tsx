import { useEffect, useState, type ChangeEvent, type DragEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2, UploadCloud, X } from 'lucide-react';

import { ApiError, ankiImportApi, collectionsApi } from '../services/api';
import { useToast } from '../contexts/ToastContext';
import type { AnkiImportPreview, AnkiImportResult, CollectionSummary } from '../types';

type Destination = 'new' | 'existing';

function plural(n: number, singular: string, pluralForm: string): string {
  return `${n.toLocaleString('pt-BR')} ${n === 1 ? singular : pluralForm}`;
}

function StatTile({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <div className={`rounded-xl p-4 ${className}`}>
      <p className="text-xl font-bold">{value.toLocaleString('pt-BR')}</p>
      <p className="text-xs font-medium">{label}</p>
    </div>
  );
}

export function AnkiImport() {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [preview, setPreview] = useState<AnkiImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [destination, setDestination] = useState<Destination>('new');
  const [newName, setNewName] = useState('');
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [existingId, setExistingId] = useState('');
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    collectionsApi
      .list()
      .then(({ collections }) =>
        setCollections(
          [...collections].sort(
            (a, b) => a.name.localeCompare(b.name, 'pt-BR') || a.subject.localeCompare(b.subject, 'pt-BR'),
          ),
        ),
      )
      .catch(() => {});
  }, []);

  function reset() {
    setFile(null);
    setPreview(null);
    setError(null);
  }

  async function pickFile(picked: File | null) {
    if (!picked) return;
    if (!/\.apkg$/i.test(picked.name)) {
      setError('Formato não suportado. Envie um arquivo .apkg do Anki.');
      return;
    }
    setFile(picked);
    setPreview(null);
    setError(null);
    setAnalyzing(true);
    try {
      const result = await ankiImportApi.preview(picked);
      setPreview(result);
      setNewName(result.suggestedName);
    } catch (err) {
      setFile(null);
      setError(err instanceof ApiError ? err.message : 'Não foi possível ler o arquivo.');
    } finally {
      setAnalyzing(false);
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    void pickFile(e.dataTransfer.files?.[0] ?? null);
  }

  function handleFileInput(e: ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null;
    e.target.value = '';
    void pickFile(picked);
  }

  const destinationValid = destination === 'new' ? newName.trim().length >= 2 : existingId !== '';
  const canImport = !!file && !!preview && preview.importable > 0 && destinationValid && !importing;

  async function handleImport() {
    if (!file || !canImport) return;
    setImporting(true);
    setError(null);
    let result: AnkiImportResult;
    try {
      result = await ankiImportApi.import(
        file,
        destination === 'new' ? { newCollectionName: newName.trim() } : { collectionId: existingId },
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível importar os cartões.');
      setImporting(false);
      return;
    }
    // Fora do try de propósito: a importação já foi gravada, então um problema
    // aqui (aviso, navegação) nunca pode aparecer como "falha ao importar" —
    // o usuário tentaria de novo achando que nada foi salvo.
    setImporting(false);
    const skipped = result.duplicates > 0 ? ` · ${plural(result.duplicates, 'repetido ignorado', 'repetidos ignorados')}` : '';
    showToast(`${plural(result.imported, 'cartão importado', 'cartões importados')}${skipped}.`);
    navigate(result.collection ? `/colecoes/${result.collection.id}` : '/colecoes');
  }

  const duplicatesTotal = preview ? preview.duplicatesExisting + preview.duplicatesInFile : 0;

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        to="/colecoes"
        className="mb-4 flex items-center gap-1.5 text-sm font-medium text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
      >
        <ArrowLeft size={16} />
        Coleções
      </Link>
      <h1 className="mb-1 text-2xl font-bold text-neutral-900 dark:text-neutral-100">Importar do Anki</h1>
      <p className="mb-6 text-sm text-neutral-500 dark:text-neutral-400">
        Envie um arquivo <span className="font-medium">.apkg</span>. Cartões repetidos — com a mesma resposta de um
        cartão que você já tem — nunca são importados.
      </p>

      <div className="card space-y-6 p-6">
        {!file ? (
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
              <span className="font-semibold text-brand-600 hover:text-brand-700">Selecionar arquivo .apkg</span>
              <span className="text-neutral-500 dark:text-neutral-400"> ou arraste aqui</span>
              <input type="file" accept=".apkg" className="hidden" onChange={handleFileInput} />
            </label>
            <p className="text-xs text-neutral-400 dark:text-neutral-500">
              No Anki: Arquivo → Exportar → formato "Pacote de baralho do Anki (*.apkg)"
            </p>
          </div>
        ) : (
          <div className="flex items-center justify-between rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800/60">
            <p className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">{file.name}</p>
            <button
              type="button"
              onClick={reset}
              disabled={analyzing || importing}
              className="text-neutral-400 hover:text-neutral-600 disabled:opacity-50 dark:text-neutral-500 dark:hover:text-neutral-300"
              aria-label="Trocar arquivo"
            >
              <X size={18} />
            </button>
          </div>
        )}

        {analyzing && (
          <p className="flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
            <Loader2 size={16} className="animate-spin" />
            Lendo o arquivo e comparando com os seus cartões...
          </p>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        {preview && (
          <>
            <div>
              <h2 className="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                {plural(preview.totalNotes, 'cartão encontrado', 'cartões encontrados')} no arquivo
              </h2>
              <div className="grid grid-cols-3 gap-3">
                <StatTile
                  label="Novos (serão importados)"
                  value={preview.importable}
                  className="bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300"
                />
                <StatTile
                  label="Repetidos (ignorados)"
                  value={duplicatesTotal}
                  className="bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                />
                <StatTile
                  label="Vazios (ignorados)"
                  value={preview.empty}
                  className="bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                />
              </div>

              <ul className="mt-4 space-y-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                {preview.duplicatesExisting > 0 && (
                  <li>{plural(preview.duplicatesExisting, 'cartão já existe', 'cartões já existem')} nas suas coleções.</li>
                )}
                {preview.duplicatesInFile > 0 && (
                  <li>
                    {plural(preview.duplicatesInFile, 'cartão repetido', 'cartões repetidos')} dentro do próprio
                    arquivo (só o primeiro entra).
                  </li>
                )}
                {preview.clozeConverted > 0 && (
                  <li>
                    {plural(preview.clozeConverted, 'cartão de lacuna (cloze) convertido', 'cartões de lacuna (cloze) convertidos')}:
                    a lacuna vira "[...]" na pergunta e a frase completa fica na resposta.
                  </li>
                )}
                {preview.images.embedded + preview.images.skipped > 0 && (
                  <li>
                    Imagens: {preview.images.embedded.toLocaleString('pt-BR')} incluídas nos cartões
                    {preview.images.skipped > 0 &&
                      `, ${preview.images.skipped.toLocaleString('pt-BR')} ignoradas (grandes demais, de sites externos ou ausentes do arquivo)`}
                    .
                  </li>
                )}
                <li>Áudios e o agendamento de revisão do Anki não são importados — os cartões entram como novos.</li>
              </ul>

              {preview.duplicateSamples.length > 0 && (
                <details className="mt-4 rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-700">
                  <summary className="cursor-pointer text-sm font-medium text-neutral-700 dark:text-neutral-300">
                    Ver cartões repetidos que serão ignorados
                  </summary>
                  <ul className="mt-2 space-y-2">
                    {preview.duplicateSamples.map((s, i) => (
                      <li key={i} className="text-xs">
                        <p className="text-neutral-800 dark:text-neutral-200">{s.question || '(sem texto)'}</p>
                        <p className="text-neutral-400 dark:text-neutral-500">
                          {s.existsIn ? `já existe em "${s.existsIn}"` : 'repetido dentro do próprio arquivo'}
                        </p>
                      </li>
                    ))}
                    {duplicatesTotal > preview.duplicateSamples.length && (
                      <li className="text-xs text-neutral-400 dark:text-neutral-500">
                        …e mais {(duplicatesTotal - preview.duplicateSamples.length).toLocaleString('pt-BR')}.
                      </li>
                    )}
                  </ul>
                </details>
              )}

              {preview.sample.length > 0 && (
                <details className="mt-3 rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-700">
                  <summary className="cursor-pointer text-sm font-medium text-neutral-700 dark:text-neutral-300">
                    Ver exemplos do que será importado
                  </summary>
                  <ul className="mt-2 space-y-2">
                    {preview.sample.map((s, i) => (
                      <li key={i} className="text-xs">
                        <p className="font-medium text-neutral-800 dark:text-neutral-200">{s.question}</p>
                        <p className="text-neutral-500 dark:text-neutral-400">{s.answer}</p>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>

            {preview.importable === 0 ? (
              <div className="flex items-start gap-2 rounded-lg bg-neutral-50 px-4 py-3 text-sm text-neutral-600 dark:bg-neutral-800/60 dark:text-neutral-300">
                <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-500" />
                Não há nada novo para importar: todos os cartões deste arquivo já existem nas suas coleções ou estão
                vazios.
              </div>
            ) : (
              <>
                <div>
                  <h2 className="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">Destino</h2>
                  <div className="space-y-3">
                    <label className="flex cursor-pointer items-start gap-3">
                      <input
                        type="radio"
                        name="destination"
                        className="mt-1 accent-brand-600"
                        checked={destination === 'new'}
                        onChange={() => setDestination('new')}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">Nova coleção</p>
                        <input
                          type="text"
                          className="input-field mt-1.5"
                          value={newName}
                          onChange={(e) => setNewName(e.target.value)}
                          onFocus={() => setDestination('new')}
                          maxLength={120}
                          placeholder="Nome da nova coleção"
                        />
                      </div>
                    </label>
                    <label className="flex cursor-pointer items-start gap-3">
                      <input
                        type="radio"
                        name="destination"
                        className="mt-1 accent-brand-600"
                        checked={destination === 'existing'}
                        onChange={() => setDestination('existing')}
                        disabled={collections.length === 0}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">Coleção existente</p>
                        <select
                          className="input-field mt-1.5"
                          value={existingId}
                          onChange={(e) => {
                            setExistingId(e.target.value);
                            setDestination('existing');
                          }}
                          disabled={collections.length === 0}
                        >
                          <option value="">
                            {collections.length === 0 ? 'Você ainda não tem coleções' : 'Selecione...'}
                          </option>
                          {collections.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                              {c.subject ? ` — ${c.subject}` : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    </label>
                  </div>
                </div>

                <button type="button" onClick={handleImport} disabled={!canImport} className="btn-primary w-full">
                  {importing ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Importando...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={16} />
                      Importar {plural(preview.importable, 'cartão', 'cartões')}
                    </>
                  )}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
