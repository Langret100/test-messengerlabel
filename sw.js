/* ============================================================
   Firebase Messaging SDK - 백그라운드 푸시 수신용
   ============================================================ */
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "__FIREBASE_API_KEY__",
  authDomain: "web-ghost-c447b.firebaseapp.com",
  databaseURL: "https://web-ghost-c447b-default-rtdb.firebaseio.com",
  projectId: "web-ghost-c447b",
  storageBucket: "web-ghost-c447b.firebasestorage.app",
  messagingSenderId: "198377381878",
  appId: "1:198377381878:web:83b56b1b4d63138d27b1d7"
});

var messaging = firebase.messaging();

// 백그라운드 푸시 수신 (앱이 꺼져 있을 때)
messaging.onBackgroundMessage(function(payload) {
  var title  = (payload.notification && payload.notification.title)  || '마이파이';
  var body   = (payload.notification && payload.notification.body)   || '새 메시지가 있어요.';
  var roomId = (payload.data && payload.data.room_id) || '';
  var icon   = './images/icons/icon-192x192.png';
  var badge  = './images/icons/icon-192x192.png';

  self.registration.showNotification(title, {
    body:     body,
    icon:     icon,
    badge:    badge,
    tag:      'mypai-msg-' + (roomId || 'global'),
    renotify: true,
    vibrate:  [200, 100, 200],
    data:     { roomId: roomId, url: './' }
  });
});

/* ============================================================
   [sw.js] Service Worker - 마이파이 PWA
   ============================================================ */

var CACHE_NAME = "mypai-v4";
var CACHE_URLS = [
  "./games/social-messenger.html",
  "./js/config.js",
  "./js/profile-manager.js",
  "./js/pwa-manager.js",
  "./js/social-messenger.js",
  "./js/fcm-push.js",
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
  if (e.request.method !== "GET") return;
  var url = e.request.url;
  if (url.indexOf("script.google.com") > -1 ||
      url.indexOf("firebaseio.com") > -1 ||
      url.indexOf("googleapis.com") > -1 ||
      url.indexOf("gstatic.com") > -1) {
    return;
  }
  e.respondWith(
    fetch(e.request)
      .then(function (res) {
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
          return cached || new Response("", { status: 503, statusText: "Offline" });
        });
      })
  );
});

/* ════════════════════════════════════════════════════════
   FCM 푸시 메시지 수신
   ════════════════════════════════════════════════════════ */
self.addEventListener("push", function (e) {
  if (!e.data) return;

  var data;
  try { data = e.data.json(); } catch (err) { data = { title: "마이파이", body: e.data.text() }; }

  var title   = data.title || "마이파이";
  var body    = data.body  || "새 메시지가 있어요.";
  var roomId  = data.room_id || "";
  var count   = Number(data.unread || 1);
  var icon    = "./images/icons/icon-192x192.png";
  var badge   = "./images/icons/icon-192x192.png";
  var tag     = "mypai-msg-" + (roomId || "global");

  var opts = {
    body:    body,
    icon:    icon,
    badge:   badge,
    tag:     tag,
    renotify: true,
    silent:  false,
    vibrate: [200, 100, 200],
    data:    { roomId: roomId, url: "./" }
  };

  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clients) {
      var isForeground = clients.some(function (c) {
        return c.visibilityState === "visible";
      });

      var tasks = [];

      // 앱이 백그라운드/종료 상태일 때만 시스템 알림 표시
      if (!isForeground) {
        tasks.push(self.registration.showNotification(title, opts));
      }

      // 앱 아이콘 배지 업데이트 (항상)
      if (self.navigator && self.navigator.setAppBadge) {
        tasks.push(
          self.navigator.setAppBadge(count).catch(function(){})
        );
      }

      // 열린 클라이언트에 배지 카운트 전달 (포그라운드 배지 갱신용)
      clients.forEach(function (client) {
        client.postMessage({ type: "FCM_PUSH_RECEIVED", roomId: roomId, count: count });
      });

      return Promise.all(tasks);
    })
  );
});

/* ── 알림 클릭 → 앱 열기 + 해당 방으로 이동 ── */
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var roomId = (e.notification.data && e.notification.data.roomId) || "";
  var targetUrl = (e.notification.data && e.notification.data.url) || "./";

  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clients) {
      // 이미 앱 창이 열려있으면 포커스 + 방 이동 메시지
      for (var i = 0; i < clients.length; i++) {
        var c = clients[i];
        if (c.url.indexOf(targetUrl.replace("./", "")) > -1 && "focus" in c) {
          c.focus();
          if (roomId) c.postMessage({ type: "FCM_OPEN_ROOM", roomId: roomId });
          return;
        }
      }
      // 앱이 닫혀있으면 새로 열기
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl + (roomId ? "#room=" + roomId : ""));
      }
    })
  );
});

/* ── 앱 배지 제어 (클라이언트 postMessage) ── */
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
