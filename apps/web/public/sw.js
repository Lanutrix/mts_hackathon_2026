// Personal data and authenticated API responses are always read from the network.
self.addEventListener("install", (event) =>
  event.waitUntil(self.skipWaiting()),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (
    req.mode !== "navigate" ||
    req.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/")
  )
    return;
  event.respondWith(
    fetch(req).catch(
      () =>
        new Response(
          '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Срез · Нет связи</title><body><main><h1>Нет соединения</h1><p>Для просмотра инцидентов подключитесь к сети.</p><a href="">Попробовать снова</a></main></body></html>',
          {
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "no-store",
            },
          },
        ),
    ),
  );
});

self.addEventListener("push", (event) => {
  let data;
  try {
    data = event.data?.json();
  } catch {
    /* A provider may omit the payload. */
  }
  event.waitUntil(
    self.registration.showNotification("Срез", {
      body:
        data?.kind === "test"
          ? "Проверочное уведомление получено."
          : "В журнале инцидентов есть обновление.",
      lang: "ru",
      icon: "/srez-192.png",
      tag: data?.kind === "test" ? "srez-device-test" : "srez-incidents",
      data: {
        kind: data?.kind,
        namespace: data?.namespace,
        incident: data?.incident,
        binding: data?.binding,
      },
    }),
  );
});

async function currentDevice() {
  const response = await fetch("/api/push/device", {
    credentials: "same-origin",
    cache: "no-store",
  });
  return response.ok ? response.json() : null;
}
self.addEventListener("notificationclick", (event) => {
  const data = event.notification.data;
  event.notification.close();
  event.waitUntil(
    (async () => {
      let path = "/notifications";
      const current = await currentDevice().catch(() => null);
      // An already queued message may arrive after logout or a change of account.
      if (
        current?.binding &&
        current.binding === data?.binding &&
        current.namespace === data.namespace &&
        ["workspace", "original", "demo"].includes(data.namespace)
      ) {
        if (data.kind === "test") path = "/preferences";
        else if (
          typeof data.incident === "string" &&
          /^[a-zA-Z0-9_-][a-zA-Z0-9._-]{0,119}$/.test(data.incident)
        )
          path = "/incident/" + encodeURIComponent(data.incident);
        path += "?ns=" + encodeURIComponent(data.namespace);
      }
      const target = new URL(path, self.location.origin).href;
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const existing = windows.find((client) => client.url === target);
      if (existing) return existing.focus();
      return self.clients.openWindow(target);
    })(),
  );
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      if (!event.oldSubscription) return;
      try {
        const current = await currentDevice();
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(event.oldSubscription.endpoint),
        );
        const previousHash = Array.from(new Uint8Array(digest), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join("");
        if (!current?.namespace || current.endpointHash !== previousHash)
          return;
        const me = await fetch("/api/me", {
          credentials: "same-origin",
          cache: "no-store",
        }).then((r) => r.json());
        if (!me.user?.csrf || Notification.permission !== "granted") return;
        const subscription =
          event.newSubscription ??
          (await self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: current.publicKey,
          }));
        await fetch("/api/push/device", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": me.user.csrf,
          },
          body: JSON.stringify({
            namespace: current.namespace,
            previousHash,
            subscription,
          }),
        });
      } catch {
        /* Settings reconciles with the current browser subscription on the next visit. */
      }
    })(),
  );
});
