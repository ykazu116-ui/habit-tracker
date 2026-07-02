// 習慣トラッカー Service Worker
const CACHE = 'habit-tracker-v23';
const ASSETS = ['./', 'manifest.json', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
// ネットワーク優先・オフライン時はキャッシュ(常に最新版を表示しつつ圏外でも起動可能)
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true })
      .then(hit => hit || caches.match('./')))
  );
});
// アプリからの通知表示要求(バックグラウンドタブ対応)
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'notify') {
    self.registration.showNotification(e.data.title, {
      body: e.data.body,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      tag: e.data.tag || undefined
    });
  }
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(list => {
    if (list.length > 0) return list[0].focus();
    return self.clients.openWindow('./');
  }));
});
