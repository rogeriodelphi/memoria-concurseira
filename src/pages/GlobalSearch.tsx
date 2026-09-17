import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FileText, Layers, ListChecks, Network, Search as SearchIcon } from 'lucide-react';

import { searchApi } from '../services/api';
import type { SearchResults } from '../types';

const MIN_QUERY_LENGTH = 2;

export function GlobalSearch() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') ?? '');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = query.trim();
    setSearchParams(q ? { q } : {}, { replace: true });

    if (q.length < MIN_QUERY_LENGTH) {
      setResults(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const timeout = setTimeout(() => {
      searchApi
        .search(q)
        .then(setResults)
        .catch(() => setResults(null))
        .finally(() => setLoading(false));
    }, 300);

    return () => clearTimeout(timeout);
  }, [query]);

  const totalResults = results
    ? results.collections.length + results.summaries.length + results.mindMaps.length + results.bulletPoints.length
    : 0;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-2xl font-bold text-neutral-900 dark:text-neutral-100">Buscar</h1>

      <div className="relative mb-6">
        <SearchIcon
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 dark:text-neutral-500"
        />
        <input
          type="text"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar em coleções, resumos, mapas mentais e bullet points..."
          className="input-field pl-9"
        />
      </div>

      {query.trim().length > 0 && query.trim().length < MIN_QUERY_LENGTH && (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">Digite ao menos {MIN_QUERY_LENGTH} caracteres.</p>
      )}

      {loading && <p className="text-sm text-neutral-400 dark:text-neutral-500">Buscando...</p>}

      {!loading && results && query.trim().length >= MIN_QUERY_LENGTH && totalResults === 0 && (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">Nenhum resultado para "{query.trim()}".</p>
      )}

      {!loading && results && totalResults > 0 && (
        <div className="space-y-6">
          {results.collections.length > 0 && (
            <section>
              <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                <Layers size={13} />
                Coleções
              </h2>
              <div className="card divide-y divide-neutral-200 dark:divide-neutral-800">
                {results.collections.map((c) => (
                  <Link
                    key={c.id}
                    to={`/colecoes/${c.id}`}
                    className="block px-4 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
                  >
                    <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{c.name}</p>
                    {c.subject && <p className="text-xs text-neutral-400 dark:text-neutral-500">{c.subject}</p>}
                  </Link>
                ))}
              </div>
            </section>
          )}

          {results.summaries.length > 0 && (
            <section>
              <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                <FileText size={13} />
                Resumos
              </h2>
              <div className="card divide-y divide-neutral-200 dark:divide-neutral-800">
                {results.summaries.map((s) => (
                  <Link
                    key={s.id}
                    to={`/resumos/meus?open=${s.id}`}
                    className="block px-4 py-3 text-sm font-medium text-neutral-900 hover:bg-neutral-50 dark:text-neutral-100 dark:hover:bg-neutral-800/60"
                  >
                    {s.title}
                  </Link>
                ))}
              </div>
            </section>
          )}

          {results.mindMaps.length > 0 && (
            <section>
              <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                <Network size={13} />
                Mapas mentais
              </h2>
              <div className="card divide-y divide-neutral-200 dark:divide-neutral-800">
                {results.mindMaps.map((m) => (
                  <Link
                    key={m.id}
                    to={`/mapas-mentais/${m.id}`}
                    className="block px-4 py-3 text-sm font-medium text-neutral-900 hover:bg-neutral-50 dark:text-neutral-100 dark:hover:bg-neutral-800/60"
                  >
                    {m.title}
                  </Link>
                ))}
              </div>
            </section>
          )}

          {results.bulletPoints.length > 0 && (
            <section>
              <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                <ListChecks size={13} />
                Bullet points
              </h2>
              <div className="card divide-y divide-neutral-200 dark:divide-neutral-800">
                {results.bulletPoints.map((b) => (
                  <Link
                    key={b.id}
                    to={`/bullet-points/meus?open=${b.id}`}
                    className="block px-4 py-3 text-sm font-medium text-neutral-900 hover:bg-neutral-50 dark:text-neutral-100 dark:hover:bg-neutral-800/60"
                  >
                    {b.title}
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
