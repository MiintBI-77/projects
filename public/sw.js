// Projects notifications. A push carries nothing: this worker asks Projects
// what to show with this device's own sign-in. It never caches pages or data.
const SHOWN = "projects-notifications";

async function lastShown() {
  const hit = await (await caches.open(SHOWN)).match("/last");
  return hit ? Number(await hit.text()) : 0;
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let events = [];
      try {
        const response = await fetch("/api/push/events", {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (response.ok) events = (await response.json()).events ?? [];
      } catch {}
      const since = await lastShown();
      const fresh = events.filter((e) => e.at > since);
      if (fresh.length)
        await (await caches.open(SHOWN)).put(
          "/last",
          new Response(String(Math.max(...fresh.map((e) => e.at)))),
        );
      // Every push must show something; without a sign-in, say so plainly.
      const show = fresh.length
        ? fresh
        : events.length
          ? events.slice(0, 1)
          : [
              {
                id: "projects",
                title: "Projects",
                body: "A conversation is ready or needs you. Open Projects to see it.",
                url: "/",
              },
            ];
      await Promise.all(
        show.map((e) =>
          self.registration.showNotification(e.title, {
            body: e.body,
            tag: e.id,
            icon: "/icon-192.png",
            data: { url: e.url },
          }),
        ),
      );
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Only ever open a Projects page.
  const target = new URL(event.notification.data?.url ?? "/", self.location.origin);
  const url = target.origin === self.location.origin ? target.href : self.location.origin + "/";
  event.waitUntil(
    (async () => {
      for (const client of await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      })) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        try {
          await client.focus();
          await client.navigate(url);
          return;
        } catch {}
      }
      await self.clients.openWindow(url);
    })(),
  );
});

// A browser can replace a subscription; register the new one with the same key.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const key = event.oldSubscription?.options?.applicationServerKey;
      if (!key) return;
      const subscription = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      });
      await fetch("/api/push/subscribe", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
    })(),
  );
});
