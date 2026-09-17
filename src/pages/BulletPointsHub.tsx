import { Link } from 'react-router-dom';
import { List, ListChecks } from 'lucide-react';

export function BulletPointsHub() {
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-neutral-900 dark:text-neutral-100">Bullet points</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link
          to="/bullet-points/criar"
          className="card flex flex-col items-center gap-2 p-8 text-center transition-shadow hover:shadow-lg"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400">
            <ListChecks size={22} />
          </div>
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Criar Bullet points com IA</h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Crie bullet points de forma automática com a inteligência artificial.
          </p>
        </Link>
        <Link
          to="/bullet-points/meus"
          className="card flex flex-col items-center gap-2 p-8 text-center transition-shadow hover:shadow-lg"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400">
            <List size={22} />
          </div>
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Meus Bullet points</h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">Acesse seus bullet points salvos.</p>
        </Link>
      </div>
    </div>
  );
}
