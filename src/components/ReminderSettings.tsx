import { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, Loader2, Send } from 'lucide-react';

import { useToast } from '../contexts/ToastContext';
import { ApiError, remindersApi } from '../services/api';
import { currentEnvironment, reminderSupport, reminderTimeLabel, urlBase64ToUint8Array } from '../utils/reminders';

const DEFAULT_TIME = '19:00';
/** Se o navegador não registrou o service worker, `serviceWorker.ready` nunca responde: não espera para sempre. */
const READY_TIMEOUT_MS = 4000;
const PERMISSION_DENIED = 'permissão negada';

async function readyRegistration(): Promise<ServiceWorkerRegistration | null> {
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), READY_TIMEOUT_MS));
  return Promise.race([navigator.serviceWorker.ready, timeout]);
}

type Loaded = { publicKey: string; time: string | null; devices: number };

/**
 * O lembrete diário de estudo no celular: uma notificação, na hora escolhida, se houver cartões para
 * revisar e a pessoa ainda não tiver estudado hoje. Cada aparelho se inscreve por si (o navegador pede
 * permissão); a hora vale para a conta toda. Tudo é opcional e começa desligado.
 */
export function ReminderSettings() {
  const { showToast } = useToast();
  const support = reminderSupport(currentEnvironment());
  const supported = support.ok;

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [thisDevice, setThisDevice] = useState<boolean | null>(null); // null = ainda verificando
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const [draftTime, setDraftTime] = useState(DEFAULT_TIME);
  const [busy, setBusy] = useState<'enable' | 'disable' | 'time' | 'test' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const data = await remindersApi.get();
    setLoaded(data);
    setDraftTime(data.time ?? DEFAULT_TIME);
    return data;
  }, []);

  useEffect(() => {
    if (!supported) return;
    setPermission(Notification.permission);
    refresh().catch(() => setError('Não foi possível carregar o lembrete.'));
    readyRegistration()
      .then((registration) => registration?.pushManager.getSubscription() ?? null)
      .then((subscription) => setThisDevice(subscription !== null))
      .catch(() => setThisDevice(false));
  }, [supported, refresh]);

  if (!support.ok) {
    return (
      <div className="card mt-6 p-6">
        <h2 className="mb-1 text-sm font-semibold text-neutral-900 dark:text-neutral-100">Lembrete de estudo</h2>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">{support.message}</p>
      </div>
    );
  }

  /** Roda uma ação mostrando o erro dela (do servidor, se houver) em vez de deixar a promessa solta. */
  async function attempt(kind: NonNullable<typeof busy>, action: () => Promise<void>, fallbackMessage: string) {
    if (busy) return;
    setBusy(kind);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiError || (err instanceof Error && err.message === PERMISSION_DENIED) ? err.message : fallbackMessage);
    } finally {
      setBusy(null);
    }
  }

  const enable = () =>
    attempt(
      'enable',
      async () => {
        if (!loaded) return;
        const result = await Notification.requestPermission();
        setPermission(result);
        if (result !== 'granted') throw new Error(PERMISSION_DENIED);
        const registration = await readyRegistration();
        if (!registration) {
          setError('O app ainda não terminou de se preparar neste aparelho. Recarregue a página e tente de novo.');
          return;
        }
        const subscription =
          (await registration.pushManager.getSubscription()) ??
          (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(loaded.publicKey),
          }));
        await remindersApi.subscribe(subscription.toJSON());
        // Primeira vez: já deixa uma hora combinada, que dá para trocar logo abaixo.
        if (!loaded.time) await remindersApi.setTime(draftTime);
        await refresh();
        setThisDevice(true);
        showToast('Lembrete ativado neste aparelho.');
      },
      'Não foi possível ativar o lembrete neste aparelho.',
    );

  const disable = () =>
    attempt(
      'disable',
      async () => {
        const registration = await readyRegistration();
        const subscription = await registration?.pushManager.getSubscription();
        if (subscription) {
          await remindersApi.unsubscribe(subscription.endpoint);
          await subscription.unsubscribe();
        }
        await refresh();
        setThisDevice(false);
        showToast('Lembrete desativado neste aparelho.');
      },
      'Não foi possível desativar o lembrete neste aparelho.',
    );

  const saveTime = (time: string | null) =>
    attempt(
      'time',
      async () => {
        await remindersApi.setTime(time);
        await refresh();
        showToast(time ? `Lembrete diário às ${reminderTimeLabel(time)}.` : 'Lembrete diário desligado.');
      },
      'Não foi possível salvar o horário.',
    );

  const sendTest = () =>
    attempt(
      'test',
      async () => {
        await remindersApi.test();
        showToast('Teste enviado: a notificação deve aparecer em instantes.');
      },
      'Não foi possível enviar o teste.',
    );

  const denied = permission === 'denied';
  const enabledHere = thisDevice === true;
  const dirty = loaded !== null && draftTime !== (loaded.time ?? DEFAULT_TIME);

  return (
    <div className="card mt-6 p-6">
      <h2 className="mb-1 text-sm font-semibold text-neutral-900 dark:text-neutral-100">Lembrete de estudo</h2>
      <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
        Uma notificação por dia, na hora que você escolher, só se houver cartões para revisar e você ainda não tiver estudado
        hoje. O computador precisa estar ligado nessa hora.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {enabledHere ? (
          <button type="button" className="btn-secondary" onClick={() => void disable()} disabled={busy !== null}>
            {busy === 'disable' ? <Loader2 size={16} className="animate-spin" /> : <BellOff size={16} />}
            Desativar neste aparelho
          </button>
        ) : (
          <button
            type="button"
            className="btn-primary"
            onClick={() => void enable()}
            disabled={busy !== null || !loaded || denied || thisDevice === null}
          >
            {busy === 'enable' ? <Loader2 size={16} className="animate-spin" /> : <Bell size={16} />}
            Ativar neste aparelho
          </button>
        )}
        {enabledHere && (
          <button type="button" className="btn-secondary" onClick={() => void sendTest()} disabled={busy !== null}>
            {busy === 'test' ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            Enviar um teste
          </button>
        )}
      </div>

      {denied && (
        <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">
          As notificações estão bloqueadas para este app. Libere-as nas configurações do navegador ou do celular e volte aqui.
        </p>
      )}

      {loaded && (
        <form
          className="mt-4 flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void saveTime(draftTime);
          }}
        >
          <div>
            <label className="label-field" htmlFor="reminder-time">
              Horário do lembrete
            </label>
            <input
              id="reminder-time"
              type="time"
              className="input-field w-36"
              value={draftTime}
              onChange={(e) => setDraftTime(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="btn-primary" disabled={busy !== null || !dirty || draftTime === ''}>
            {busy === 'time' ? <Loader2 size={16} className="animate-spin" /> : null}
            Salvar horário
          </button>
          {loaded.time && (
            <button type="button" className="btn-secondary" disabled={busy !== null} onClick={() => void saveTime(null)}>
              Desligar o lembrete
            </button>
          )}
        </form>
      )}

      {error && (
        <p className="mt-3 text-sm text-red-600">
          {error === PERMISSION_DENIED ? 'Sem a permissão do navegador não dá para mostrar notificações.' : error}
        </p>
      )}

      {loaded && (
        <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
          {loaded.time ? `Lembrete diário às ${reminderTimeLabel(loaded.time)}` : 'Lembrete desligado'}
          {' · '}
          {loaded.devices === 0 ? 'nenhum aparelho ativado' : loaded.devices === 1 ? '1 aparelho ativado' : `${loaded.devices} aparelhos ativados`}
          {thisDevice === false && loaded.devices > 0 ? ' (este não)' : ''}
        </p>
      )}
    </div>
  );
}
