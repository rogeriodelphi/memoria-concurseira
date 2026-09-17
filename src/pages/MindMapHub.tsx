import { Link } from 'react-router-dom';
import { Compass, Network } from 'lucide-react';

export function MindMapHub() {
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-neutral-900 dark:text-neutral-100">Mapas Mentais</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link
          to="/mapas-mentais/criar"
          className="card flex flex-col items-center gap-2 p-8 text-center transition-shadow hover:shadow-lg"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400">
            <Compass size={22} />
          </div>
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Criar Mapa</h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Crie seu mapa mental com o auxílio de nosso assistente virtual.
          </p>
        </Link>
        <Link
          to="/mapas-mentais/meus"
          className="card flex flex-col items-center gap-2 p-8 text-center transition-shadow hover:shadow-lg"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400">
            <Network size={22} />
          </div>
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Meus Mapas</h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">Visualize e gerencie seus mapas mentais.</p>
        </Link>
      </div>
    </div>
  );
}
