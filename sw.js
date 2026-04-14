/* ============================================================
   [sw.js] Service Worker - 마이메신저 PWA
   ============================================================ */

var CACHE_NAME = "mypai-v3";
var CACHE_URLS = [
  "./games/social-messenger.html",
  "./js/config.js",
  "./js/profile-manager.js",
  "./js/pwa-manager.js",
  "./js/social-messenger.js",
  "./images/icons/icon-192x192.png",
  "./images/icons/favicon-32x32.png",
  "./images/icons/favicon.ico"
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
  // GET 요청만 캐시 처리, 나머지는 그냥 통과
  if (e.request.method !== "GET") return;

  // Apps Script / Firebase 요청은 캐시 안 함
  var url = e.request.url;
  if (url.indexOf("script.google.com") > -1 ||
      url.indexOf("firebaseio.com") > -1 ||
      url.indexOf("googleapis.com") > -1) {
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then(function (res) {
        // 유효한 응답만 캐시
        if (res && res.status === 200 && res.type === "basic") {
          var clone = res.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(e.request, clone);
          });
        }
        return res;
      })
      .catch(function () {
        return caches.match(e.request).then(function (cached) {
          // 캐시에도 없으면 빈 Response 반환 (TypeError 방지)
          return cached || new Response("", {
            status: 503,
            statusText: "Offline"
          });
        });
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
