import Select from "./Select";
import { useEffect, useState } from "react";
import "./deviceNotifications.css";

type InstallEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
let installEvent: InstallEvent | null = null;
let registration: Promise<ServiceWorkerRegistration> | undefined;
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installEvent = event as InstallEvent;
  window.dispatchEvent(new Event("srez-install-state"));
});
window.addEventListener("appinstalled", () => {
  installEvent = null;
  window.dispatchEvent(new Event("srez-install-state"));
});
export async function registerDeviceWorker() {
  if (!window.isSecureContext || !("serviceWorker" in navigator)) return null;
  return (registration ??= navigator.serviceWorker
    .register("/sw.js", { scope: "/", updateViaCache: "none" })
    .catch((e) => {
      registration = undefined;
      throw e;
    }));
}
async function within<T>(work: Promise<T>, ms: number) {
  let timer: number | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(
          () =>
            reject(
              new Error(
                "Служба push-уведомлений не ответила. Проверьте соединение и повторите позже.",
              ),
            ),
          ms,
        );
      }),
    ]);
  } finally {
    window.clearTimeout(timer);
  }
}
export async function disconnectDeviceBrowser() {
  try {
    const worker = await navigator.serviceWorker?.getRegistration("/");
    if (!worker) return;
    await within(
      Promise.allSettled([
        worker
          .getNotifications()
          .then((notes) => notes.forEach((note) => note.close())),
        worker.pushManager?.getSubscription().then((sub) => sub?.unsubscribe()),
      ]),
      2000,
    );
  } catch {
    /* The server has already revoked this device. */
  }
}

type User = { username: string; csrf: string };
type Device = {
  namespace: string | null;
  endpointHash: string | null;
  publicKey: string;
  sources: string[];
};
const sourceNames: Record<string, string> = {
  demo: "Сценарий",
  workspace: "Рабочая копия",
  original: "Оригинальный источник",
};
const available = () =>
  window.isSecureContext &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;
const installed = () =>
  matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone;
async function request<T>(
  init?: RequestInit,
  path = "/api/push/device",
): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw Object.assign(
      new Error(result.message || "Не удалось получить настройки устройства"),
      { statusCode: response.status },
    );
  }
  return response.json();
}
async function endpointHash(endpoint: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(endpoint),
  );
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
function applicationKey(subscription: PushSubscription) {
  const bytes = subscription.options.applicationServerKey;
  if (!bytes) return null;
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function DeviceNotifications({
  user,
  namespace,
}: {
  user: User | null;
  namespace: string;
}) {
  const [device, setDevice] = useState<Device | null>(null);
  const [source, setSource] = useState(namespace);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [canInstall, setCanInstall] = useState(!!installEvent);
  const [isInstalled, setInstalled] = useState(installed);
  useEffect(() => {
    const update = () => {
      setCanInstall(!!installEvent);
      setInstalled(installed());
    };
    window.addEventListener("srez-install-state", update);
    return () => window.removeEventListener("srez-install-state", update);
  }, []);
  useEffect(() => {
    let active = true;
    setDevice(null);
    setEnabled(false);
    setMessage("");
    if (!user) return;
    async function load() {
      try {
        const config = await request<Device>();
        let matches = false;
        if (
          config.endpointHash &&
          available() &&
          Notification.permission === "granted"
        ) {
          await registerDeviceWorker();
          const worker = await navigator.serviceWorker.ready;
          const sub = await worker.pushManager.getSubscription();
          matches = !!(
            sub &&
            applicationKey(sub) === config.publicKey &&
            (await endpointHash(sub.endpoint)) === config.endpointHash
          );
        }
        if (!active) return;
        setDevice(config);
        setSource(
          config.namespace ??
            (config.sources.includes(namespace)
              ? namespace
              : config.sources[0]),
        );
        setEnabled(matches);
        if (config.namespace && !matches)
          setMessage(
            "Подписка браузера изменилась. Включите уведомления повторно.",
          );
      } catch (e) {
        if (active) setMessage((e as Error).message);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [user?.username, user?.csrf, namespace, refresh]);
  if (!user) return null;
  const headers = {
    "Content-Type": "application/json",
    "X-CSRF-Token": user.csrf,
  };
  async function enable() {
    if (!device || !source) return;
    setBusy(true);
    setMessage("");
    try {
      const permission =
        Notification.permission === "granted"
          ? "granted"
          : await Notification.requestPermission();
      if (permission !== "granted") {
        setMessage(
          permission === "denied"
            ? "Разрешите уведомления в настройках этого сайта в браузере."
            : "Запрос разрешения закрыт.",
        );
        return;
      }
      const worker = await navigator.serviceWorker.ready;
      let sub = await worker.pushManager.getSubscription();
      if (
        sub &&
        (applicationKey(sub) !== device.publicKey ||
          (await endpointHash(sub.endpoint)) !== device.endpointHash)
      ) {
        await sub.unsubscribe();
        sub = null;
      }
      sub ??= await within(
        worker.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: device.publicKey,
        }),
        25_000,
      );
      await request({
        method: "POST",
        headers,
        body: JSON.stringify({ subscription: sub.toJSON(), namespace: source }),
      });
      setDevice({
        ...device,
        namespace: source,
        endpointHash: await endpointHash(sub.endpoint),
      });
      setEnabled(true);
      setMessage("Уведомления включены.");
    } catch (e) {
      const error = e as Error;
      setMessage(
        error.name === "NotAllowedError"
          ? "Проверьте разрешение на уведомления в браузере и настройках системы."
          : error.name === "Error"
            ? error.message
            : "Служба push-уведомлений недоступна. Повторите позже.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function disable() {
    setBusy(true);
    try {
      await request({
        method: "DELETE",
        headers: { "X-CSRF-Token": user!.csrf },
      });
      await disconnectDeviceBrowser();
      setEnabled(false);
      setDevice((d) => d && { ...d, namespace: null, endpointHash: null });
      setMessage("Уведомления отключены.");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function testDelivery() {
    setBusy(true);
    try {
      await request(
        { method: "POST", headers, body: "{}" },
        "/api/push/device/test",
      );
      setMessage(
        "Служба доставки приняла проверочное уведомление. Проверьте уведомления устройства.",
      );
    } catch (e) {
      if ((e as { statusCode?: number }).statusCode === 410) {
        setEnabled(false);
        setDevice((d) => d && { ...d, namespace: null, endpointHash: null });
      }
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="content login device-notifications"
      aria-labelledby="device-alerts-heading"
    >
      <h2 id="device-alerts-heading">Уведомления на этом устройстве</h2>
      <p>
        Узнавайте о критичных инцидентах, назначениях координаторам и решениях,
        даже когда приложение закрыто.
      </p>
      {device && (
        <label>
          Источник уведомлений
          <Select
            value={source}
            disabled={busy || !available()}
            onChange={(e) => setSource(e.target.value)}
          >
            {device.sources.map((s) => (
              <option key={s} value={s}>
                {sourceNames[s] ?? s}
              </option>
            ))}
          </Select>
        </label>
      )}
      {!available() && (
        <p>
          {window.isSecureContext
            ? "В этом режиме браузера push-уведомления недоступны. На iPhone или iPad откройте приложение с экрана «Домой»."
            : "Для push-уведомлений откройте сайт по HTTPS."}
        </p>
      )}
      <div className="device-actions">
        {device && available() && (!enabled || source !== device.namespace) && (
          <button
            type="button"
            disabled={busy || !source}
            onClick={() => void enable()}
          >
            {enabled ? "Сменить источник" : "Включить уведомления"}
          </button>
        )}
        {enabled && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void testDelivery()}
          >
            Проверить уведомление
          </button>
        )}
        {device?.namespace && (
          <button type="button" disabled={busy} onClick={() => void disable()}>
            Отключить уведомления
          </button>
        )}
        {!device && message && (
          <button type="button" onClick={() => setRefresh((n) => n + 1)}>
            Повторить
          </button>
        )}
      </div>
      <p role="status">
        {message ||
          (busy
            ? "Обновляем подписку…"
            : enabled
              ? "Включены на этом устройстве."
              : !device
                ? "Проверяем подписку…"
                : "Выключены на этом устройстве.")}
      </p>
      {!isInstalled && (
        <div className="device-install">
          <h3>Приложение «Срез»</h3>
          {canInstall ? (
            <button
              type="button"
              onClick={async () => {
                const prompt = installEvent;
                if (!prompt) return;
                installEvent = null;
                setCanInstall(false);
                try {
                  await prompt.prompt();
                  await prompt.userChoice;
                } catch {
                  setMessage("Откройте меню браузера для установки.");
                }
              }}
            >
              Установить приложение
            </button>
          ) : (
            <p>
              Установите приложение из меню браузера. На iPhone или iPad в меню
              «Поделиться» выберите «На экран „Домой“».
            </p>
          )}
        </div>
      )}
    </section>
  );
}
