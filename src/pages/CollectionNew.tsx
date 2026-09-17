import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { collectionsApi, ApiError } from '../services/api';

const CATEGORIES = [
  'Concursos',
  'Faculdade',
  'Certificações',
  'Idiomas',
  'Programação',
  'Direito',
  'Medicina',
  'Outros',
];

export function CollectionNew() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [existingNames, setExistingNames] = useState<string[]>([]);

  useEffect(() => {
    collectionsApi
      .list()
      .then(({ collections }) => {
        setExistingNames(Array.from(new Set(collections.map((c) => c.name))));
      })
      .catch(() => {});
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { collection } = await collectionsApi.create({ name, subject, description, category });
      navigate(`/colecoes/${collection.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível criar a coleção.');
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-2xl font-bold text-neutral-900 dark:text-neutral-100">Criando nova coleção</h1>
      <p className="mb-8 text-sm text-neutral-500 dark:text-neutral-400">
        Dê um nome para a coleção. No próximo passo você escolhe a fonte (arquivo, tópico, texto ou YouTube) e a IA gera os flashcards.
      </p>

      <form onSubmit={handleSubmit} className="card space-y-5 p-6">
        <div>
          <label className="label-field" htmlFor="name">
            Nome da coleção
          </label>
          <input
            id="name"
            required
            autoFocus
            className="input-field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Direito Administrativo"
            list="existing-collection-names"
            autoComplete="off"
          />
          <datalist id="existing-collection-names">
            {existingNames.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </div>

        <div>
          <label className="label-field" htmlFor="subject">
            Assunto
          </label>
          <input
            id="subject"
            className="input-field"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Adicione um assunto para essa coleção"
          />
        </div>

        <div>
          <label className="label-field" htmlFor="description">
            Descrição
          </label>
          <textarea
            id="description"
            rows={3}
            className="input-field resize-none"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Adicione uma descrição para essa coleção"
          />
        </div>

        <div>
          <label className="label-field" htmlFor="category">
            Categoria
          </label>
          <select
            id="category"
            className="input-field"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button type="submit" disabled={submitting} className="btn-primary w-full">
          {submitting ? 'Criando...' : 'Continuar'}
        </button>
      </form>
    </div>
  );
}
