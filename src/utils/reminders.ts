/**
 * O que a tela de lembrete decide sem React: se o navegador consegue receber notificações do app e como
 * converter a chave pública do servidor para o formato que a inscrição de push pede.
 */

/** A chave VAPID chega em base64url; `pushManager.subscribe` quer os bytes. */
export function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padded = base64Url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (base64Url.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export interface ReminderEnvironment {
  isSecureContext: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
}

export type ReminderSupport = { ok: true } | { ok: false; reason: 'insecure' | 'unsupported'; message: string };

/** Notificação push pede página segura (https), service worker, push e notificações. Quando falta algo, o que fazer. */
export function reminderSupport(env: ReminderEnvironment): ReminderSupport {
  if (!env.isSecureContext) {
    return {
      ok: false,
      reason: 'insecure',
      message:
        'Os lembretes só funcionam por um endereço seguro (https). No celular, abra o app pelo endereço do Tailscale (https://…ts.net) e instale-o.',
    };
  }
  if (!env.hasServiceWorker || !env.hasPushManager || !env.hasNotification) {
    return {
      ok: false,
      reason: 'unsupported',
      message:
        'Este navegador não oferece notificações para apps da web. No iPhone, instale o app (Compartilhar → Adicionar à Tela de Início) e abra-o por esse ícone.',
    };
  }
  return { ok: true };
}

/** O que o navegador atual oferece, lido da janela. */
export function currentEnvironment(): ReminderEnvironment {
  return {
    isSecureContext: typeof window !== 'undefined' && window.isSecureContext,
    hasServiceWorker: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
    hasPushManager: typeof window !== 'undefined' && 'PushManager' in window,
    hasNotification: typeof window !== 'undefined' && 'Notification' in window,
  };
}

/** "19:30" → "19h30"; "19:00" → "19h". */
export function reminderTimeLabel(time: string): string {
  const [hour, minute] = time.split(':');
  return minute === '00' ? `${Number(hour)}h` : `${Number(hour)}h${minute}`;
}
