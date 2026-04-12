const CACHE_NAME = 'sleep-tracker-v20';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const isAppAsset = ['.html', '.css', '.js'].some(ext => url.pathname.endsWith(ext))
    || url.pathname === '/' || url.pathname.endsWith('/');

  if (isAppAsset) {
    // Network-first: 常に最新版を取得、失敗時のみキャッシュ
    e.respondWith(
      fetch(e.request).then(res => {
        caches.open(CACHE_NAME).then(c => c.put(e.request, res.clone()));
        return res;
      }).catch(() => caches.match(e.request))
    );
  } else {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
  }
});

// Web Push（サーバーからのプッシュ）
self.addEventListener('push', e => {
  let data = { title: '神睡眠トラッカー', body: 'そろそろ眠る時間ですよ 🌙' };
  try {
    if (e.data) data = e.data.json();
  } catch {}
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      tag: 'bedtime-reminder',
      requireInteraction: false,
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url && 'focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow('./');
    })
  );
});

// ---- Periodic Background Sync ----

self.addEventListener('periodicsync', e => {
  if (e.tag === 'bedtime-reminder') {
    e.waitUntil(checkAndShowReminder());
  }
});

function openSettingsDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('sleep-tracker-db', 1);
    req.onupgradeneeded = ev => {
      ev.target.result.createObjectStore('settings');
    };
    req.onsuccess = ev => resolve(ev.target.result);
    req.onerror = ev => reject(ev.target.error);
  });
}

async function getSettingsFromDB() {
  try {
    const db = await openSettingsDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('settings', 'readonly');
      const req = tx.objectStore('settings').get('main');
      req.onsuccess = e => resolve(e.target.result || {});
      req.onerror = e => reject(e.target.error);
    });
  } catch {
    return {};
  }
}

async function checkAndShowReminder() {
  const s = await getSettingsFromDB();
  if (!s.reminderEnabled || !s.reminderTime) return;

  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  // 設定時刻の前後5分以内なら通知（バックグラウンド同期は正確な時刻に来ない場合がある）
  const [rh, rm] = s.reminderTime.split(':').map(Number);
  const reminderTotal = rh * 60 + rm;
  const nowTotal = now.getHours() * 60 + now.getMinutes();
  const diff = Math.abs(nowTotal - reminderTotal);

  if (diff <= 5) {
    await self.registration.showNotification('神睡眠トラッカー', {
      body: 'そろそろ眠る時間ですよ 🌙',
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      tag: 'bedtime-reminder',
      requireInteraction: false,
    });
  }
}
