import { Link } from 'react-router-dom';
import { FileText, List } from 'lucide-react';

export function SummaryHub() {
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-neutral-900 dark:text-neutral-100">Resumos</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link
          to="/resumos/criar"
          className="card flex flex-col items-center gap-2 p-8 text-center transition-shadow hover:shadow-lg"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400">
            <FileText size={22} />
          </div>
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Criar Resumo com IA</h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Crie resumos de forma automática com a inteligência artificial.
          </p>
        </Link>
        <Link
          to="/resumos/meus"
          className="card flex flex-col items-center gap-2 p-8 text-center transition-shadow hover:shadow-lg"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400">
            <List size={22} />
          </div>
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Meus Resumos</h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">Acesse seus resumos salvos.</p>
        </Link>
      </div>
    </div>
  );
}
