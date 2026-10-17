import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import './index.css';

// Só no app em produção (o servidor de desenvolvimento não tem /sw.js) e só onde o navegador
// permite: HTTPS ou localhost. O service worker apenas mostra a página "Sem conexão" quando o
// celular não alcança o PC (ver public/sw.js); uma falha ao registrá-lo não atrapalha o app.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
