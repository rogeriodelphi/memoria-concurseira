import { FilePlus2 } from 'lucide-react';
import { Link, NavLink } from 'react-router-dom';

const TABS = [
  { to: '/questoes', label: 'Questões', end: true },
  { to: '/questoes/provas', label: 'Provas', end: false },
  { to: '/questoes/cadernos', label: 'Cadernos', end: false },
];

/** As três telas do banco de questões e o atalho para importar uma prova. */
export function BankTabs() {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 dark:border-neutral-800">
      <nav className="-mb-px flex gap-1" aria-label="Banco de questões">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              `border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-300'
                  : 'border-transparent text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200'
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <Link to="/questoes/importar" className="btn-secondary mb-2 py-2">
        <FilePlus2 size={16} />
        Importar prova (PDF)
      </Link>
    </div>
  );
}
