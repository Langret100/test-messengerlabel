/* ============================================================
   [sw.js] Service Worker - 마이메신저 PWA
   ============================================================ */

var CACHE_NAME = "mymessenger-v1";
var CACHE_URLS = [
  "./games/social-messenger.html",
  "./js/config.js",
  "./js/profile-manager.js",
  "./js/pwa-manager.js",
  "./js/social-messenger.js",
  "./images/icons/icon-192x192.png",
  "./images/icons/icon-512x512.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(CACHE_URLS).catch(function () {});
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE_NAME; })
            .map(function (k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function (e) {
  // 네트워크 우선, 실패 시 캐시
  e.respondWith(
    fetch(e.request).then(function (res) {
      var clone = res.clone();
      caches.open(CACHE_NAME).then(function (cache) {
        if (e.request.method === "GET") cache.put(e.request, clone);
      });
      return res;
    }).catch(function () {
      return caches.match(e.request);
    })
  );
});

/* ── 앱 배지 업데이트 (클라이언트 postMessage) ── */
self.addEventListener("message", function (e) {
  if (!e.data) return;
  var count = Number(e.data.count) || 0;
  if (e.data.type === "SET_BADGE") {
    try {
      if (self.navigator && self.navigator.setAppBadge) {
        count > 0 ? self.navigator.setAppBadge(count) : self.navigator.clearAppBadge();
      }
    } catch (err) {}
  }
  if (e.data.type === "CLEAR_BADGE") {
    try {
      if (self.navigator && self.navigator.clearAppBadge) self.navigator.clearAppBadge();
    } catch (err) {}
  }
});
