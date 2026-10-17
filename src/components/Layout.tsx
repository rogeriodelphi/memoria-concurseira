import { Menu } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { useAuth } from '../contexts/AuthContext';
import { Sidebar } from './Sidebar';

export function Layout() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Fecha o drawer automaticamente ao trocar de rota (ex.: link clicado no
  // menu mobile) — sem isso ele ficaria aberto por cima da próxima página.
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  if (loading) {
    return (
      <div className="flex h-screen h-dvh items-center justify-center bg-neutral-50 text-neutral-400 dark:bg-neutral-950 dark:text-neutral-500">
        Carregando...
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  // `h-dvh` acompanha a área realmente visível no celular (a barra de endereço do navegador some e
  // volta); só com `h-screen` o fim da página ficava escondido atrás dela. `h-screen` fica de reserva.
  return (
    <div className="flex h-screen h-dvh bg-neutral-50 dark:bg-neutral-950 print:h-auto">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col print:block">
        <header className="flex items-center gap-3 border-b border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900 print:hidden md:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="tap-area text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
            aria-label="Abrir menu"
          >
            <Menu size={22} />
          </button>
          <span className="text-sm font-bold text-neutral-900 dark:text-neutral-100">Base Concurseira</span>
        </header>
        <main className="flex-1 overflow-y-auto print:overflow-visible">
          <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 md:px-8 md:py-8 print:max-w-none print:p-0">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
