import { useCallback, useEffect, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlignLeft,
  CheckSquare,
  Clock,
  Copy,
  Download,
  Eye,
  EyeOff,
  FilePlus2,
  FileText,
  GraduationCap,
  Lightbulb,
  ListChecks,
  Loader2,
  Mic,
  Network,
  NotebookText,
  Pencil,
  Plus,
  Repeat,
  Search,
  Sparkles,
  Star,
  Target,
  Trash2,
  UploadCloud,
  X,
  Youtube,
} from 'lucide-react';

import {
  ApiError,
  bulletPointsApi,
  collectionsApi,
  documentsApi,
  exportAnki,
  exportPdf,
  flashcardsApi,
  mindMapsApi,
  summariesApi,
  transcribeApi,
} from '../services/api';
import { useConfirm } from '../contexts/ConfirmContext';
import { useToast } from '../contexts/ToastContext';
import { RichTextEditor } from '../components/RichTextEditor';
import { FormattedText } from '../components/FormattedText';
import { toEditorHtml } from '../utils/flashcardEditor';
import type {
  CollectionDetail as CollectionDetailType,
  CollectionStats,
  CollectionSummary,
  Difficulty,
  Flashcard,
  GenerationOptions,
} from '../types';

const QUANTITY_PRESETS = ['auto', '10', '20', '50', '100', '200', 'custom'] as const;

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

const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  facil: 'Fácil',
  medio: 'Médio',
  dificil: 'Difícil',
};

const DIFFICULTY_BADGE: Record<Difficulty, string> = {
  facil: 'bg-brand-100 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300',
  medio: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  dificil: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300',
};

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function defaultOptions(): GenerationOptions {
  return { quantity: 'auto', difficulty: 'medio', cardType: 'pergunta_resposta', depth: 'normal', focus: '' };
}

// Pra buscar dentro de um flashcard em HTML sem que tags/atributos de
// marcação virem "texto" pesquisável (ex.: buscar "div" não deveria achar
// todo cartão formatado só por causa da tag).
function toSearchableText(value: string, format: Flashcard['format']): string {
  if (format !== 'html') return value;
  return value.replace(/<[^>]+>/g, ' ');
}

const GENERATION_MIN_CHARS = 250;
const GENERATION_MAX_CHARS = 64_000;

function flashcardPlainText(value: string, format: Flashcard['format']): string {
  return toSearchableText(value, format).replace(/\s+/g, ' ').trim();
}

/**
 * Junta pergunta+resposta de todos os flashcards num único texto pra
 * alimentar resumo/mapa mental/bullet points — que só aceitam texto puro,
 * não sabem nada sobre coleção/flashcard. Corta em GENERATION_MAX_CHARS pra
 * nunca estourar o limite aceito pelos endpoints, mesmo em coleções muito
 * grandes.
 */
function flashcardsToText(cards: Flashcard[]): string {
  const joined = cards
    .map((fc) => `Pergunta: ${flashcardPlainText(fc.question, fc.format)}\nResposta: ${flashcardPlainText(fc.answer, fc.format)}`)
    .join('\n\n');
  return joined.length > GENERATION_MAX_CHARS ? joined.slice(0, GENERATION_MAX_CHARS) : joined;
}


export function CollectionDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { showToast } = useToast();

  const [collection, setCollection] = useState<CollectionDetailType | null>(null);
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [stats, setStats] = useState<CollectionStats | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const [sourceTab, setSourceTab] = useState<SourceTab>('arquivo');
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [topic, setTopic] = useState('');
  const [text, setText] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');

  const [showTranscribe, setShowTranscribe] = useState(false);
  const [transcribeYoutubeUrl, setTranscribeYoutubeUrl] = useState('');
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);

  const [options, setOptions] = useState<GenerationOptions>(defaultOptions());
  const [quantityPreset, setQuantityPreset] = useState<(typeof QUANTITY_PRESETS)[number]>('auto');
  const [customQuantity, setCustomQuantity] = useState(30);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generateProgress, setGenerateProgress] = useState(0);

  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQuestion, setEditQuestion] = useState('');
  const [editAnswer, setEditAnswer] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [generatingMindMap, setGeneratingMindMap] = useState(false);
  const [generatingBulletPoints, setGeneratingBulletPoints] = useState(false);

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [otherCollections, setOtherCollections] = useState<CollectionSummary[] | null>(null);
  const [copyTargetId, setCopyTargetId] = useState('');
  const [copyMode, setCopyMode] = useState<'copy' | 'move'>('copy');
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  const [showNewCardModal, setShowNewCardModal] = useState(false);
  const [newCardQuestion, setNewCardQuestion] = useState('');
  const [newCardAnswer, setNewCardAnswer] = useState('');
  const [newCardDifficulty, setNewCardDifficulty] = useState<Difficulty>('medio');
  const [savingNewCard, setSavingNewCard] = useState(false);
  const [newCardError, setNewCardError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!id) return;
    collectionsApi
      .get(id)
      .then(({ collection, flashcards }) => {
        setCollection(collection);
        setFlashcards(flashcards);
        setShowUploadForm(flashcards.length === 0);
      })
      .catch(() => setLoadError('Não foi possível carregar esta coleção.'));
    collectionsApi.stats(id).then(setStats).catch(() => {});
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // A IA responde tudo de uma vez (não dá pra saber "quantos flashcards já
  // foram gerados" enquanto a geração está em andamento), então essa barra é
  // uma estimativa animada — sobe rápido no início, desacelera perto de 90%
  // e só chega a 100% quando a resposta realmente volta.
  useEffect(() => {
    if (!generating) {
      setGenerateProgress(0);
      return;
    }
    const startedAt = Date.now();
    const interval = setInterval(() => {
      const elapsedSeconds = (Date.now() - startedAt) / 1000;
      setGenerateProgress(90 * (1 - Math.exp(-elapsedSeconds / 18)));
    }, 200);
    return () => clearInterval(interval);
  }, [generating]);

  function pickFile(f: File | null) {
    if (f && !isAcceptedFileType(f)) {
      setGenerateError('Formato não suportado. Envie um PDF, imagem, áudio ou vídeo.');
      return;
    }
    setGenerateError(null);
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

  async function applyTranscription(getText: () => Promise<{ text: string }>) {
    if (text.trim()) {
      const ok = await confirm({ message: 'Isso vai substituir o texto atual neste campo. Continuar?' });
      if (!ok) return;
    }
    setTranscribing(true);
    setTranscribeError(null);
    try {
      const { text: transcribed } = await getText();
      setText(transcribed);
      setShowTranscribe(false);
      setTranscribeYoutubeUrl('');
      showToast('Transcrição concluída!');
    } catch (err) {
      setTranscribeError(err instanceof ApiError ? err.message : 'Não foi possível transcrever.');
    } finally {
      setTranscribing(false);
    }
  }

  function handleTranscribeFileInput(e: ChangeEvent<HTMLInputElement>) {
    const transcribeFile = e.target.files?.[0];
    e.target.value = '';
    if (!transcribeFile) return;
    applyTranscription(() => transcribeApi.fromFile(transcribeFile));
  }

  function handleTranscribeYoutube() {
    if (!transcribeYoutubeUrl.trim()) return;
    applyTranscription(() => transcribeApi.fromYoutube(transcribeYoutubeUrl.trim()));
  }

  function canSubmit(): boolean {
    if (sourceTab === 'arquivo') return !!file;
    if (sourceTab === 'topico') return topic.trim().length > 0;
    if (sourceTab === 'texto') return text.trim().length > 0;
    return youtubeUrl.trim().length > 0;
  }

  async function handleGenerate(e: FormEvent) {
    e.preventDefault();
    if (!id || !canSubmit()) return;
    setGenerating(true);
    setGenerateError(null);

    const finalOptions: GenerationOptions = {
      ...options,
      quantity: quantityPreset === 'auto' ? 'auto' : quantityPreset === 'custom' ? customQuantity : Number(quantityPreset),
    };

    try {
      if (sourceTab === 'arquivo' && file) {
        await documentsApi.fromFile(id, file, finalOptions);
      } else if (sourceTab === 'topico') {
        await documentsApi.fromTopic(id, topic.trim(), finalOptions);
      } else if (sourceTab === 'texto') {
        await documentsApi.fromText(id, text.trim(), finalOptions);
      } else if (sourceTab === 'youtube') {
        await documentsApi.fromYoutube(id, youtubeUrl.trim(), finalOptions);
      } else {
        return;
      }
      setFile(null);
      setTopic('');
      setText('');
      setYoutubeUrl('');
      setShowUploadForm(false);
      load();
      showToast('Flashcards gerados com sucesso!');
    } catch (err) {
      setGenerateError(err instanceof ApiError ? err.message : 'Não foi possível gerar os flashcards.');
    } finally {
      setGenerating(false);
    }
  }

  async function handleDeleteFlashcard(fcId: string) {
    const ok = await confirm({ message: 'Excluir este flashcard? Essa ação não pode ser desfeita.', danger: true });
    if (!ok) return;
    try {
      await flashcardsApi.remove(fcId);
      setFlashcards((prev) => prev.filter((f) => f.id !== fcId));
      showToast('Flashcard excluído.');
      if (id) collectionsApi.stats(id).then(setStats).catch(() => {});
    } catch {
      showToast('Não foi possível excluir o flashcard.', 'error');
    }
  }

  async function toggleFavorite(fc: Flashcard) {
    const nextFavorite = !fc.favorite;
    setFlashcards((prev) => prev.map((f) => (f.id === fc.id ? { ...f, favorite: nextFavorite } : f)));
    try {
      await flashcardsApi.update(fc.id, { favorite: nextFavorite });
      if (id) collectionsApi.stats(id).then(setStats).catch(() => {});
    } catch {
      setFlashcards((prev) => prev.map((f) => (f.id === fc.id ? { ...f, favorite: !nextFavorite } : f)));
      showToast('Não foi possível atualizar o favorito.', 'error');
    }
  }

  function startEdit(fc: Flashcard) {
    setEditingId(fc.id);
    setEditQuestion(toEditorHtml(fc.question, fc.format));
    setEditAnswer(toEditorHtml(fc.answer, fc.format));
  }

  async function saveEdit(fcId: string) {
    try {
      const { flashcard } = await flashcardsApi.update(fcId, {
        question: editQuestion,
        answer: editAnswer,
        format: 'html',
      });
      setFlashcards((prev) => prev.map((f) => (f.id === fcId ? flashcard : f)));
      setEditingId(null);
      showToast('Flashcard atualizado.');
    } catch {
      showToast('Não foi possível salvar as alterações.', 'error');
    }
  }

  function toggleSelected(fcId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(fcId)) next.delete(fcId);
      else next.add(fcId);
      return next;
    });
  }

  function exitSelectionMode() {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }

  async function openCopyModal() {
    setCopyError(null);
    setCopyTargetId('');
    setCopyMode('copy');
    setShowCopyModal(true);
    if (!otherCollections) {
      try {
        const { collections } = await collectionsApi.list();
        // Nome sozinho não basta pra identificar a coleção certa: é comum
        // reaproveitar o mesmo nome (ex.: "Redes de Computadores") em várias
        // coleções diferenciadas só pelo assunto — por isso a ordenação e a
        // opção do select abaixo também levam o assunto em conta.
        const sorted = collections
          .filter((c) => c.id !== id)
          .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR') || a.subject.localeCompare(b.subject, 'pt-BR'));
        setOtherCollections(sorted);
      } catch {
        setOtherCollections([]);
      }
    }
  }

  async function handleCopyConfirm() {
    if (!copyTargetId || selectedIds.size === 0) return;
    setCopying(true);
    setCopyError(null);
    try {
      const { flashcards: transferred, count, skippedDuplicates } = await flashcardsApi.copyToCollection(
        [...selectedIds],
        copyTargetId,
        copyMode,
      );
      const verb = copyMode === 'move' ? 'movido' : 'copiado';
      const parts = [count > 0 ? `${count} flashcard${count === 1 ? '' : 's'} ${verb}${count === 1 ? '' : 's'}` : null];
      if (skippedDuplicates > 0) {
        parts.push(
          `${skippedDuplicates} já ${skippedDuplicates === 1 ? 'existia' : 'existiam'} na coleção de destino e ${
            skippedDuplicates === 1 ? 'foi ignorado' : 'foram ignorados'
          }`,
        );
      }
      showToast(`${parts.filter(Boolean).join(' · ')}.`, skippedDuplicates > 0 && count === 0 ? 'error' : 'success');
      if (copyMode === 'move' && transferred.length > 0) {
        // Só remove localmente os que realmente saíram (não os ignorados
        // por duplicidade, que continuam nesta coleção).
        const movedIds = new Set(transferred.map((f) => f.id));
        setFlashcards((prev) => prev.filter((f) => !movedIds.has(f.id)));
      }
      setShowCopyModal(false);
      exitSelectionMode();
    } catch (err) {
      setCopyError(err instanceof ApiError ? err.message : 'Não foi possível copiar os flashcards.');
    } finally {
      setCopying(false);
    }
  }

  function openNewCardModal() {
    setNewCardQuestion('');
    setNewCardAnswer('');
    setNewCardDifficulty('medio');
    setNewCardError(null);
    setShowNewCardModal(true);
  }

  async function handleCreateCard() {
    if (!id) return;
    const questionText = newCardQuestion.replace(/<[^>]+>/g, '').trim();
    const answerText = newCardAnswer.replace(/<[^>]+>/g, '').trim();
    if (!questionText || !answerText) {
      setNewCardError('Preencha a pergunta e a resposta.');
      return;
    }
    setSavingNewCard(true);
    setNewCardError(null);
    try {
      await flashcardsApi.create(id, {
        question: newCardQuestion,
        answer: newCardAnswer,
        difficulty: newCardDifficulty,
      });
      setShowNewCardModal(false);
      load();
      showToast('Flashcard adicionado com sucesso!');
    } catch (err) {
      setNewCardError(err instanceof ApiError ? err.message : 'Não foi possível salvar o flashcard.');
    } finally {
      setSavingNewCard(false);
    }
  }

  async function handleDeleteCollection() {
    if (!id) return;
    const ok = await confirm({
      message: 'Excluir esta coleção e todos os seus flashcards? Essa ação não pode ser desfeita.',
      danger: true,
    });
    if (!ok) return;
    try {
      await collectionsApi.remove(id);
      showToast('Coleção excluída.');
      navigate('/colecoes');
    } catch {
      showToast('Não foi possível excluir a coleção.', 'error');
    }
  }

  async function handleExport() {
    if (!id || !collection) return;
    setExporting(true);
    try {
      await exportAnki(id, collection.name.toLowerCase().replace(/\s+/g, '_'));
      showToast('Exportado para Anki com sucesso.');
    } catch {
      showToast('Não foi possível exportar para o Anki.', 'error');
    } finally {
      setExporting(false);
    }
  }

  async function handleGenerateSummary() {
    const text = flashcardsToText(flashcards);
    if (text.length < GENERATION_MIN_CHARS) {
      showToast('Esta coleção tem conteúdo insuficiente para gerar um resumo.', 'error');
      return;
    }
    setGeneratingSummary(true);
    try {
      await summariesApi.generate(text, 'padrao');
      showToast('Resumo gerado com sucesso!');
      navigate('/resumos/meus');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Não foi possível gerar o resumo.', 'error');
    } finally {
      setGeneratingSummary(false);
    }
  }

  async function handleGenerateMindMap() {
    const text = flashcardsToText(flashcards);
    if (text.length < GENERATION_MIN_CHARS) {
      showToast('Esta coleção tem conteúdo insuficiente para gerar um mapa mental.', 'error');
      return;
    }
    setGeneratingMindMap(true);
    try {
      const { mindMap } = await mindMapsApi.fromText(text, collection?.name);
      showToast('Mapa mental gerado com sucesso!');
      navigate(`/mapas-mentais/${mindMap.id}`);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Não foi possível gerar o mapa mental.', 'error');
    } finally {
      setGeneratingMindMap(false);
    }
  }

  async function handleGenerateBulletPoints() {
    const text = flashcardsToText(flashcards);
    if (text.length < GENERATION_MIN_CHARS) {
      showToast('Esta coleção tem conteúdo insuficiente para gerar bullet points.', 'error');
      return;
    }
    setGeneratingBulletPoints(true);
    try {
      await bulletPointsApi.generate(text);
      showToast('Bullet points gerados com sucesso!');
      navigate('/bullet-points/meus');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Não foi possível gerar os bullet points.', 'error');
    } finally {
      setGeneratingBulletPoints(false);
    }
  }

  async function handleExportPdf() {
    if (!id || !collection) return;
    setExportingPdf(true);
    try {
      await exportPdf(id, collection.name.toLowerCase().replace(/\s+/g, '_'));
      showToast('PDF exportado com sucesso.');
    } catch {
      showToast('Não foi possível exportar o PDF.', 'error');
    } finally {
      setExportingPdf(false);
    }
  }

  const query = searchQuery.trim().toLowerCase();
  const filteredFlashcards = query
    ? flashcards.filter(
        (fc) =>
          toSearchableText(fc.question, fc.format).toLowerCase().includes(query) ||
          toSearchableText(fc.answer, fc.format).toLowerCase().includes(query),
      )
    : flashcards;

  if (loadError) return <p className="text-sm text-red-600">{loadError}</p>;
  if (!collection) return <p className="text-sm text-neutral-400 dark:text-neutral-500">Carregando...</p>;

  return (
    <div>
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">{collection.name}</h1>
          {collection.subject && (
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{collection.subject}</p>
          )}
          {collection.description && (
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{collection.description}</p>
          )}
          <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
            {collection.category} · {flashcards.length} flashcard{flashcards.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={openNewCardModal} className="btn-secondary">
            <FilePlus2 size={16} />
            Novo cartão
          </button>
          {flashcards.length > 0 && !showUploadForm && (
            <button onClick={() => setShowUploadForm(true)} className="btn-secondary">
              <Plus size={16} />
              Adicionar cartões
            </button>
          )}
          {flashcards.length > 0 && (
            <Link to={`/colecoes/${collection.id}/estudar`} className="btn-secondary">
              <GraduationCap size={16} />
              Estudar
            </Link>
          )}
          {flashcards.length > 0 && (
            <button onClick={handleExportPdf} disabled={exportingPdf} className="btn-secondary">
              <FileText size={16} />
              {exportingPdf ? 'Exportando...' : 'Exportar para PDF'}
            </button>
          )}
          {flashcards.length > 0 && (
            <button onClick={handleGenerateSummary} disabled={generatingSummary} className="btn-secondary">
              <NotebookText size={16} />
              {generatingSummary ? 'Gerando resumo...' : 'Gerar Resumo'}
            </button>
          )}
          {flashcards.length > 0 && (
            <button onClick={handleGenerateMindMap} disabled={generatingMindMap} className="btn-secondary">
              <Network size={16} />
              {generatingMindMap ? 'Gerando mapa mental...' : 'Gerar Mapa Mental'}
            </button>
          )}
          {flashcards.length > 0 && (
            <button onClick={handleGenerateBulletPoints} disabled={generatingBulletPoints} className="btn-secondary">
              <ListChecks size={16} />
              {generatingBulletPoints ? 'Gerando bullet points...' : 'Gerar Bullet points'}
            </button>
          )}
          {flashcards.length > 0 && (
            <button onClick={handleExport} disabled={exporting} className="btn-primary">
              <Download size={16} />
              {exporting ? 'Exportando...' : 'Exportar para Anki'}
            </button>
          )}
          <button onClick={handleDeleteCollection} className="btn-secondary text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40">
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {stats && stats.totals.flashcards > 0 && (
        <div className="card mb-6 flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
          <div className="flex items-center gap-2 text-sm">
            <Repeat size={15} className="shrink-0 text-neutral-400 dark:text-neutral-500" />
            <span className="font-semibold text-neutral-900 dark:text-neutral-100">{stats.totals.reviews}</span>
            <span className="text-neutral-500 dark:text-neutral-400">revisões</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Target size={15} className="shrink-0 text-neutral-400 dark:text-neutral-500" />
            <span className="font-semibold text-neutral-900 dark:text-neutral-100">
              {stats.totals.reviews > 0 ? `${stats.accuracyPct}%` : '—'}
            </span>
            <span className="text-neutral-500 dark:text-neutral-400">de acerto</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Clock size={15} className="shrink-0 text-neutral-400 dark:text-neutral-500" />
            <span className="font-semibold text-neutral-900 dark:text-neutral-100">{stats.totals.dueCount}</span>
            <span className="text-neutral-500 dark:text-neutral-400">pendentes</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Star size={15} className="shrink-0 text-neutral-400 dark:text-neutral-500" />
            <span className="font-semibold text-neutral-900 dark:text-neutral-100">{stats.totals.favoriteCount}</span>
            <span className="text-neutral-500 dark:text-neutral-400">favoritos</span>
          </div>
        </div>
      )}

      {showUploadForm && (
        <form onSubmit={handleGenerate} className="card mb-8 space-y-6 p-6">
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
                      setGenerateError(null);
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
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">{file.name}</p>
                    <p className="text-xs text-neutral-400 dark:text-neutral-500">{formatSize(file.size)}</p>
                  </div>
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
              <div>
                <input
                  type="text"
                  className="input-field"
                  placeholder="Ex.: Controle de constitucionalidade no Direito Constitucional"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  maxLength={300}
                />
                <p className="mt-2 text-xs text-neutral-400 dark:text-neutral-500">
                  A IA usa o próprio conhecimento para gerar os flashcards, sem precisar de um arquivo.
                </p>
              </div>
            )}

            {sourceTab === 'texto' && (
              <div>
                <div className="mb-2 flex items-center justify-end">
                  <button
                    type="button"
                    onClick={() => setShowTranscribe((s) => !s)}
                    className="flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-400"
                  >
                    <Mic size={13} />
                    Transcrever de áudio/vídeo
                  </button>
                </div>

                {showTranscribe && (
                  <div className="mb-3 space-y-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-800/60">
                    <label className="btn-secondary w-full cursor-pointer justify-center">
                      <UploadCloud size={16} />
                      Selecionar arquivo de áudio/vídeo
                      <input
                        type="file"
                        accept="audio/*,video/*"
                        className="hidden"
                        onChange={handleTranscribeFileInput}
                        disabled={transcribing}
                      />
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="url"
                        className="input-field"
                        placeholder="ou cole um link do YouTube"
                        value={transcribeYoutubeUrl}
                        onChange={(e) => setTranscribeYoutubeUrl(e.target.value)}
                        disabled={transcribing}
                      />
                      <button
                        type="button"
                        className="btn-secondary shrink-0"
                        disabled={!transcribeYoutubeUrl.trim() || transcribing}
                        onClick={handleTranscribeYoutube}
                      >
                        Transcrever
                      </button>
                    </div>
                    {transcribing && (
                      <p className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                        <Loader2 size={13} className="animate-spin" />
                        Transcrevendo... pode levar alguns minutos em horários de pico. Não feche esta página.
                      </p>
                    )}
                    {transcribeError && <p className="text-xs text-red-600">{transcribeError}</p>}
                  </div>
                )}

                <textarea
                  rows={8}
                  className="input-field resize-none"
                  placeholder="Cole aqui o texto que deseja transformar em flashcards."
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  maxLength={100000}
                />
              </div>
            )}

            {sourceTab === 'youtube' && (
              <div>
                <input
                  type="url"
                  className="input-field"
                  placeholder="https://www.youtube.com/watch?v=..."
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                />
                <p className="mt-2 text-xs text-neutral-400 dark:text-neutral-500">
                  Funciona com vídeos públicos do YouTube.
                </p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label-field">Quantidade</label>
              <select
                className="input-field"
                value={quantityPreset}
                onChange={(e) => setQuantityPreset(e.target.value as typeof quantityPreset)}
              >
                <option value="auto">Automática</option>
                <option value="10">10</option>
                <option value="20">20</option>
                <option value="50">50</option>
                <option value="100">100</option>
                <option value="200">200</option>
                <option value="custom">Personalizada</option>
              </select>
              {quantityPreset === 'custom' && (
                <input
                  type="number"
                  min={1}
                  max={300}
                  className="input-field mt-2"
                  value={customQuantity}
                  onChange={(e) => setCustomQuantity(Number(e.target.value))}
                />
              )}
            </div>

            <div>
              <label className="label-field">Dificuldade</label>
              <select
                className="input-field"
                value={options.difficulty}
                onChange={(e) => setOptions((o) => ({ ...o, difficulty: e.target.value as GenerationOptions['difficulty'] }))}
              >
                <option value="facil">Fácil</option>
                <option value="medio">Médio</option>
                <option value="dificil">Difícil</option>
                <option value="misto">Misto</option>
              </select>
            </div>

            <div>
              <label className="label-field">Tipo</label>
              <select
                className="input-field"
                value={options.cardType}
                onChange={(e) => setOptions((o) => ({ ...o, cardType: e.target.value as GenerationOptions['cardType'] }))}
              >
                <option value="pergunta_resposta">Pergunta e resposta</option>
                <option value="verdadeiro_falso">Verdadeiro ou falso</option>
                <option value="multipla_escolha">Múltipla escolha</option>
                <option value="conceito_definicao">Conceito e definição</option>
                <option value="misto">Misto</option>
              </select>
            </div>

            <div>
              <label className="label-field">Profundidade</label>
              <select
                className="input-field"
                value={options.depth}
                onChange={(e) => setOptions((o) => ({ ...o, depth: e.target.value as GenerationOptions['depth'] }))}
              >
                <option value="essencial">Essencial</option>
                <option value="normal">Normal</option>
                <option value="avancado">Avançado</option>
              </select>
            </div>
          </div>

          <div>
            <label className="label-field">Foco (opcional)</label>
            <textarea
              rows={2}
              className="input-field resize-none"
              placeholder="Ex.: Priorize os assuntos mais importantes para concursos públicos."
              value={options.focus}
              onChange={(e) => setOptions((o) => ({ ...o, focus: e.target.value }))}
            />
          </div>

          {generateError && <p className="text-sm text-red-600">{generateError}</p>}

          <div className="flex items-center gap-3">
            <button type="submit" disabled={!canSubmit() || generating} className="btn-primary">
              {generating ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Gerando flashcards com IA...
                </>
              ) : (
                <>
                  <Sparkles size={16} />
                  Gerar Flashcards com IA
                </>
              )}
            </button>
            {flashcards.length > 0 && (
              <button type="button" className="btn-secondary" onClick={() => setShowUploadForm(false)}>
                Cancelar
              </button>
            )}
          </div>
          {generating && (
            <div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                <div
                  className="h-full rounded-full bg-brand-500 transition-[width] duration-200 ease-linear"
                  style={{ width: `${generateProgress}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-neutral-400 dark:text-neutral-500">
                {Math.round(generateProgress)}% · pode levar alguns minutos, dependendo do conteúdo e da demanda no
                momento. Não feche esta página.
              </p>
            </div>
          )}
        </form>
      )}

      {flashcards.length > 0 && (
        <>
          <div className="mb-4 flex items-center gap-2">
            <div className="relative flex-1">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 dark:text-neutral-500"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar por pergunta ou resposta..."
                className="input-field pl-9 pr-9"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300"
                  aria-label="Limpar busca"
                >
                  <X size={16} />
                </button>
              )}
            </div>
            {!selectionMode && (
              <button type="button" className="btn-secondary shrink-0" onClick={() => setSelectionMode(true)}>
                <CheckSquare size={16} />
                Selecionar
              </button>
            )}
          </div>

          {query && (
            <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
              {filteredFlashcards.length} de {flashcards.length} flashcard{flashcards.length === 1 ? '' : 's'}
            </p>
          )}

          {selectionMode && (
            <div className="card mb-4 flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="flex items-center gap-3 text-sm">
                <span className="font-medium text-neutral-700 dark:text-neutral-300">
                  {selectedIds.size} selecionado{selectedIds.size === 1 ? '' : 's'}
                </span>
                <button
                  type="button"
                  className="text-brand-600 hover:underline dark:text-brand-400"
                  onClick={() => setSelectedIds(new Set(filteredFlashcards.map((fc) => fc.id)))}
                >
                  Selecionar todos
                </button>
                {selectedIds.size > 0 && (
                  <button
                    type="button"
                    className="text-neutral-500 hover:underline dark:text-neutral-400"
                    onClick={() => setSelectedIds(new Set())}
                  >
                    Limpar
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn-secondary" onClick={exitSelectionMode}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={selectedIds.size === 0}
                  onClick={openCopyModal}
                >
                  <Copy size={16} />
                  Copiar/mover para coleção
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {query && filteredFlashcards.length === 0 && (
        <div className="card px-6 py-10 text-center text-sm text-neutral-500 dark:text-neutral-400">
          Nenhum flashcard encontrado para "{searchQuery.trim()}".
        </div>
      )}

      {filteredFlashcards.length > 0 && (
        <div className="space-y-3">
          {filteredFlashcards.map((fc) => {
            const isRevealed = revealed[fc.id];
            const isEditing = editingId === fc.id;
            return (
              <div key={fc.id} className="card p-5">
                {isEditing ? (
                  <div className="space-y-3">
                    <div>
                      <label className="label-field">Pergunta</label>
                      <RichTextEditor value={editQuestion} onChange={setEditQuestion} />
                    </div>
                    <div>
                      <label className="label-field">Resposta</label>
                      <RichTextEditor value={editAnswer} onChange={setEditAnswer} />
                    </div>
                    <div className="flex gap-2">
                      <button className="btn-primary" onClick={() => saveEdit(fc.id)}>
                        Salvar
                      </button>
                      <button className="btn-secondary" onClick={() => setEditingId(null)}>
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-4">
                    {selectionMode && (
                      <input
                        type="checkbox"
                        className="mt-1.5 h-4 w-4 shrink-0 accent-brand-600"
                        checked={selectedIds.has(fc.id)}
                        onChange={() => toggleSelected(fc.id)}
                        aria-label="Selecionar flashcard"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${DIFFICULTY_BADGE[fc.difficulty]}`}>
                          {DIFFICULTY_LABEL[fc.difficulty]}
                        </span>
                        {fc.sourcePage && (
                          <span className="text-xs text-neutral-400 dark:text-neutral-500">pág. {fc.sourcePage}</span>
                        )}
                      </div>
                      <FormattedText
                        value={fc.question}
                        format={fc.format}
                        className="font-medium text-neutral-900 dark:text-neutral-100"
                      />
                      {isRevealed && (
                        <FormattedText
                          value={fc.answer}
                          format={fc.format}
                          className="mt-2 text-sm text-neutral-600 dark:text-neutral-400"
                        />
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => toggleFavorite(fc)}
                        className={`rounded-lg p-2 transition-colors ${
                          fc.favorite
                            ? 'text-amber-500 hover:bg-amber-50 hover:text-amber-600 dark:hover:bg-amber-950/40'
                            : 'text-neutral-400 hover:bg-neutral-100 hover:text-amber-500 dark:text-neutral-500 dark:hover:bg-neutral-800'
                        }`}
                        title={fc.favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
                      >
                        <Star size={16} fill={fc.favorite ? 'currentColor' : 'none'} />
                      </button>
                      <button
                        onClick={() => setRevealed((r) => ({ ...r, [fc.id]: !r[fc.id] }))}
                        className="rounded-lg p-2 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
                        title={isRevealed ? 'Ocultar resposta' : 'Mostrar resposta'}
                      >
                        {isRevealed ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                      <button
                        onClick={() => startEdit(fc)}
                        className="rounded-lg p-2 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
                        title="Editar"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        onClick={() => handleDeleteFlashcard(fc.id)}
                        className="rounded-lg p-2 text-neutral-400 hover:bg-red-50 hover:text-red-600 dark:text-neutral-500 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                        title="Excluir"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showCopyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="card w-full max-w-sm p-6">
            <h2 className="mb-1.5 text-base font-semibold text-neutral-900 dark:text-neutral-100">
              {copyMode === 'move' ? 'Mover para coleção' : 'Copiar para coleção'}
            </h2>

            <div className="mt-3 grid grid-cols-2 gap-1 rounded-lg bg-neutral-100 p-1 dark:bg-neutral-800">
              <button
                type="button"
                onClick={() => setCopyMode('copy')}
                className={`rounded-md py-1.5 text-sm font-medium transition-colors ${
                  copyMode === 'copy'
                    ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100'
                    : 'text-neutral-500 dark:text-neutral-400'
                }`}
              >
                Copiar
              </button>
              <button
                type="button"
                onClick={() => setCopyMode('move')}
                className={`rounded-md py-1.5 text-sm font-medium transition-colors ${
                  copyMode === 'move'
                    ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100'
                    : 'text-neutral-500 dark:text-neutral-400'
                }`}
              >
                Mover
              </button>
            </div>

            <p className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">
              {selectedIds.size} flashcard{selectedIds.size === 1 ? '' : 's'} selecionado
              {selectedIds.size === 1 ? '' : 's'}.{' '}
              {copyMode === 'move'
                ? 'Eles saem desta coleção e passam a pertencer só à coleção de destino.'
                : 'Os originais continuam nesta coleção.'}{' '}
              Cartões já existentes na coleção de destino são ignorados.
            </p>

            {otherCollections === null ? (
              <p className="mt-4 text-sm text-neutral-400 dark:text-neutral-500">Carregando coleções...</p>
            ) : otherCollections.length === 0 ? (
              <p className="mt-4 text-sm text-neutral-400 dark:text-neutral-500">
                Você não tem outra coleção ainda. Crie uma nova para copiar estes flashcards para ela.
              </p>
            ) : (
              <div className="mt-4">
                <label className="label-field">Coleção de destino</label>
                <select
                  className="input-field"
                  value={copyTargetId}
                  onChange={(e) => setCopyTargetId(e.target.value)}
                >
                  <option value="">Selecione...</option>
                  {otherCollections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.subject ? ` — ${c.subject}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {copyError && <p className="mt-3 text-sm text-red-600">{copyError}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setShowCopyModal(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={!copyTargetId || copying}
                onClick={handleCopyConfirm}
              >
                {copying ? `${copyMode === 'move' ? 'Movendo' : 'Copiando'}...` : copyMode === 'move' ? 'Mover' : 'Copiar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showNewCardModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="card w-full max-w-lg space-y-4 p-6">
            <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Novo cartão</h2>

            <div>
              <label className="label-field">Pergunta</label>
              <RichTextEditor value={newCardQuestion} onChange={setNewCardQuestion} />
            </div>
            <div>
              <label className="label-field">Resposta</label>
              <RichTextEditor value={newCardAnswer} onChange={setNewCardAnswer} />
            </div>
            <div>
              <label className="label-field">Dificuldade</label>
              <select
                className="input-field"
                value={newCardDifficulty}
                onChange={(e) => setNewCardDifficulty(e.target.value as Difficulty)}
              >
                <option value="facil">Fácil</option>
                <option value="medio">Médio</option>
                <option value="dificil">Difícil</option>
              </select>
            </div>

            {newCardError && <p className="text-sm text-red-600">{newCardError}</p>}

            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setShowNewCardModal(false)}>
                Cancelar
              </button>
              <button type="button" className="btn-primary" disabled={savingNewCard} onClick={handleCreateCard}>
                {savingNewCard ? 'Salvando...' : 'Salvar cartão'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
