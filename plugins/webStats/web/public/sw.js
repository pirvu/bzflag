// Service worker: shows the push notifications sent by the webStats server.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data && event.data.text() };
  }
  event.waitUntil(self.registration.showNotification(data.title || 'BZFlag', {
    body: data.body || '',
    tag: data.tag,
    renotify: !!data.tag,
    icon: 'icon.svg',
    badge: 'icon.svg',
    data: { url: data.url || '' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // relative to where the page lives, which may be a sub path like /stats/
  const url = new URL(event.notification.data?.url || '', self.registration.scope).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (client.url.startsWith(self.registration.scope)) {
        await client.focus();
        return client.navigate(url);
      }
    }
    return self.clients.openWindow(url);
  })());
});
