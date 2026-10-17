import net from 'node:net';

/**
 * Em que endereço o servidor escuta. Sem `BIND_ADDRESS`, escuta em todas as interfaces (como
 * sempre foi). Com `BIND_ADDRESS=127.0.0.1`, só o próprio PC alcança a porta, e o acesso pelo
 * celular passa a existir apenas pelo Tailscale (o `tailscale serve` conecta em localhost).
 *
 * Um valor inválido derruba a subida com uma mensagem clara, em vez de cair no padrão em silêncio:
 * quem pediu para restringir o acesso não deve ficar achando que restringiu quando não foi assim.
 */
export function bindAddress(env: NodeJS.ProcessEnv): string | undefined {
  const raw = env.BIND_ADDRESS?.trim();
  if (!raw) return undefined;
  if (raw === 'localhost' || net.isIP(raw) !== 0) return raw;
  throw new Error(`BIND_ADDRESS inválido: "${raw}". Use um endereço IP (ex.: 127.0.0.1) ou "localhost".`);
}

const NEVER_STALE = new Set(['index.html', 'sw.js', 'manifest.webmanifest', 'offline.html']);

/**
 * O `Cache-Control` de um arquivo do site, pelo caminho relativo à pasta `dist`.
 *
 * - `assets/*` são gerados com o hash do conteúdo no nome (o Vite troca o nome quando o arquivo
 *   muda), então podem ficar guardados por um ano: o celular não pergunta nada ao PC para
 *   abrir o app uma segunda vez.
 * - A porta de entrada (index.html), o service worker e o manifest nunca podem ficar velhos:
 *   é por eles que uma versão nova chega.
 * - O resto segue o padrão do Express.
 */
export function cacheControlFor(relativePath: string): string | undefined {
  const path = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (path.startsWith('assets/')) return 'public, max-age=31536000, immutable';
  if (NEVER_STALE.has(path)) return 'no-cache';
  return undefined;
}
