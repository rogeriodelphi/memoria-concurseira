import { useState, type KeyboardEvent } from 'react';
import {
  BarChart3,
  FileText,
  LayoutGrid,
  ListChecks,
  LogOut,
  Network,
  Search,
  Settings,
  Timer,
  X,
} from 'lucide-react';
import { NavLink, useNavigate } from 'react-router-dom';

import { useAuth } from '../contexts/AuthContext';
import { getInitials } from '../utils/initials';

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');

  function submitSearch(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter' || !searchQuery.trim()) return;
    navigate(`/buscar?q=${encodeURIComponent(searchQuery.trim())}`);
    setSearchQuery('');
    onClose();
  }

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex h-screen w-64 shrink-0 flex-col justify-between bg-brand-800 px-4 py-6 text-brand-50 transition-transform duration-200 ease-out print:hidden md:static md:z-auto md:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div>
          <div className="mb-8 flex items-center justify-between gap-2 px-2">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-sm font-bold text-brand-800">
                BC
              </div>
              <span className="text-lg font-bold text-white">Base Concurseira</span>
            </div>
            <button onClick={onClose} className="text-brand-100 hover:text-white md:hidden" aria-label="Fechar menu">
              <X size={20} />
            </button>
          </div>

          <div className="relative mb-4 px-0">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-200"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={submitSearch}
              placeholder="Buscar..."
              className="w-full rounded-lg border border-brand-700 bg-brand-700/60 py-2 pl-9 pr-3 text-sm text-white placeholder:text-brand-200 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-400"
            />
          </div>

          <nav className="space-y-1">
            <NavLink
              to="/colecoes"
              onClick={onClose}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive ? 'bg-white text-brand-800' : 'text-brand-50 hover:bg-brand-700'
                }`
              }
            >
              <LayoutGrid size={18} />
              Coleções
            </NavLink>
            <NavLink
              to="/pomodoro"
              onClick={onClose}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive ? 'bg-white text-brand-800' : 'text-brand-50 hover:bg-brand-700'
                }`
              }
            >
              <Timer size={18} />
              Pomodoro
            </NavLink>
            <NavLink
              to="/mapas-mentais"
              onClick={onClose}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive ? 'bg-white text-brand-800' : 'text-brand-50 hover:bg-brand-700'
                }`
              }
            >
              <Network size={18} />
              Mapas mentais
            </NavLink>
            <NavLink
              to="/resumos"
              onClick={onClose}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive ? 'bg-white text-brand-800' : 'text-brand-50 hover:bg-brand-700'
                }`
              }
            >
              <FileText size={18} />
              Resumos
            </NavLink>
            <NavLink
              to="/bullet-points"
              onClick={onClose}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive ? 'bg-white text-brand-800' : 'text-brand-50 hover:bg-brand-700'
                }`
              }
            >
              <ListChecks size={18} />
              Bullet points
            </NavLink>
            <NavLink
              to="/estatisticas"
              onClick={onClose}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive ? 'bg-white text-brand-800' : 'text-brand-50 hover:bg-brand-700'
                }`
              }
            >
              <BarChart3 size={18} />
              Estatísticas
            </NavLink>
            <NavLink
              to="/configuracoes"
              onClick={onClose}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive ? 'bg-white text-brand-800' : 'text-brand-50 hover:bg-brand-700'
                }`
              }
            >
              <Settings size={18} />
              Configurações
            </NavLink>
          </nav>
        </div>

        <div className="border-t border-brand-700 pt-4">
          <NavLink
            to="/perfil"
            onClick={onClose}
            className={({ isActive }) =>
              `mb-3 flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors ${
                isActive ? 'bg-brand-700' : 'hover:bg-brand-700'
              }`
            }
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-brand-50">
              {user ? getInitials(user.name) : ''}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">{user?.name}</p>
              <p className="truncate text-xs text-brand-200" title={user?.email}>
                {user?.email}
              </p>
            </div>
          </NavLink>
          <button
            onClick={() => void logout()}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-brand-100 transition-colors hover:bg-brand-700"
          >
            <LogOut size={16} />
            Sair
          </button>
        </div>
      </aside>
    </>
  );
}
