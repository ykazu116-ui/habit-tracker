// 習慣トラッカー Service Worker v24
const CACHE = 'habit-tracker-v24';
const DATA_CACHE = 'habit-data';
const ASSETS = ['./', 'manifest.json', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE && k !== DATA_CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
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

// ── アプリからの通知表示要求(バックグラウンドタブ対応) ──
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

// ── バックグラウンド定期チェック: アプリを閉じていてもリマインダーを通知 ──
// アプリ側がsave()のたびに /reminder-snapshot に最新状況を書き込む。
// 端末が数時間おきにこのイベントを起動し、リマインダー時刻を過ぎても
// 未完了の習慣があればまとめて1件の通知を出す(同じ日に二重通知はしない)。
function logicalKey(cutoff) {
  const d = new Date();
  if (d.getHours() < (cutoff || 0)) d.setDate(d.getDate() - 1);
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
async function checkReminders() {
  try {
    const c = await caches.open(DATA_CACHE);
    const res = await c.match('/reminder-snapshot');
    if (!res) return;
    const snap = await res.json();
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const day = logicalKey(snap.cutoff);
    const sentRes = await c.match('/reminder-sent');
    const sent = sentRes ? await sentRes.json() : {};
    const due = (snap.habits || []).filter(h => {
      if (!h.rem || !h.rem.active || !h.rem.time) return false;
      if (!(h.dows || [0,1,2,3,4,5,6]).includes(now.getDay())) return false;
      // スナップショット時点でチェック済み(同じ論理日の場合のみ有効な情報)
      if (snap.dayKey === day && h.checked) return false;
      const [hh, mm] = h.rem.time.split(':').map(Number);
      if (nowMin < hh * 60 + mm) return false; // まだ時刻前
      if (sent[h.id + '_' + day]) return false; // この日すでに通知済み
      return true;
    });
    if (!due.length) return;
    due.forEach(h => { sent[h.id + '_' + day] = true; });
    // 古い記録を掃除(当日以外は破棄)
    Object.keys(sent).forEach(k => { if (!k.endsWith('_' + day)) delete sent[k]; });
    await c.put('/reminder-sent', new Response(JSON.stringify(sent), { headers: { 'Content-Type': 'application/json' } }));
    const names = due.map(h => h.name).join('・');
    await self.registration.showNotification('📌 未完了の習慣があります', {
      body: due.length === 1
        ? '今日の「' + names + '」がまだ完了していません。'
        : '今日はあと ' + due.length + ' 件: ' + names,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      tag: 'bg-reminder'
    });
  } catch (e) {}
}
self.addEventListener('periodicsync', e => {
  if (e.tag === 'habit-reminders') e.waitUntil(checkReminders());
});
