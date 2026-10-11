import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

import { ExamStructureEditor } from '../components/ExamStructureEditor';
import { ApiError, examsApi } from '../services/api';
import { examToDraft } from '../utils/exam';
import type { ExamDraft } from '../types';

export function ExamEdit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<ExamDraft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    examsApi
      .get(id)
      .then((detail) => setDraft(examToDraft(detail)))
      .catch(() => setLoadError('Não foi possível carregar o concurso.'));
  }, [id]);

  async function handleSave() {
    if (!draft || !id) return;
    if (draft.name.trim().length < 2) {
      setSaveError('Informe um nome para o concurso.');
      return;
    }
    if (draft.disciplines.some((d) => !d.name.trim())) {
      setSaveError('Toda disciplina precisa de um nome.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await examsApi.update(id, draft);
      navigate(`/concursos/${id}`);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Não foi possível salvar as alterações.');
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        to={`/concursos/${id}`}
        className="mb-4 flex items-center gap-1.5 text-sm font-medium text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
      >
        <ArrowLeft size={16} />
        Voltar ao concurso
      </Link>
      <h1 className="mb-1 text-2xl font-bold text-neutral-900 dark:text-neutral-100">Editar concurso</h1>
      <p className="mb-6 text-sm text-neutral-500 dark:text-neutral-400">
        Os vínculos com suas coleções são mantidos nos tópicos que você só renomear ou mudar de lugar. Apagar um tópico apaga o
        vínculo dele.
      </p>

      {loadError && <p className="text-sm text-red-600">{loadError}</p>}
      {!draft && !loadError && <p className="text-sm text-neutral-400 dark:text-neutral-500">Carregando...</p>}

      {draft && (
        <>
          <ExamStructureEditor value={draft} onChange={setDraft} />
          {saveError && <p className="mt-4 text-sm text-red-600">{saveError}</p>}
          <div className="mt-6 flex justify-end gap-3">
            <Link to={`/concursos/${id}`} className="btn-secondary">
              Cancelar
            </Link>
            <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Salvando...' : 'Salvar alterações'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
