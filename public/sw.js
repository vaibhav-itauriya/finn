// FINN service worker: shows pushed alerts and opens the right screen when one is tapped.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let p = { title: "FINN", body: "Something in your portfolio needs a look.", url: "/" };
  try {
    p = { ...p, ...e.data.json() };
  } catch (_) {}
  e.waitUntil(
    self.registration.showNotification(p.title, {
      body: p.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: p.tag,
      data: { url: p.url },
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin).href;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.startsWith(self.location.origin) && "focus" in w) {
          w.navigate(url);
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
