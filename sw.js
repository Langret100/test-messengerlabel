/* ============================================================
   Firebase Messaging SDK - 백그라운드 푸시 수신용
   ============================================================ */
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

// Firebase Messaging 초기화 (백그라운드 수신용)
// __FIREBASE_API_KEY__ 는 GitHub Actions 배포 시 실제 키로 치환됩니다.
var _fbMessaging = null;
try {
  firebase.initializeApp({
    apiKey: "__FIREBASE_API_KEY__",
    authDomain: "web-ghost-c447b.firebaseapp.com",
    databaseURL: "https://web-ghost-c447b-default-rtdb.firebaseio.com",
    projectId: "web-ghost-c447b",
    storageBucket: "web-ghost-c447b.firebasestorage.app",
    messagingSenderId: "198377381878",
    appId: "1:198377381878:web:83b56b1b4d63138d27b1d7"
  });
  _fbMessaging = firebase.messaging();
} catch (e) {
  console.warn('[SW] Firebase 초기화 실패 (배포 환경에서는 자동 치환됨):', e.message || e);
}

// 백그라운드 FCM 수신 (onBackgroundMessage는 push 이벤트와 중복 처리 방지를 위해 비활성)
// → push 이벤트 핸들러가 모든 케이스를 처리함 (아래 참고)
// _fbMessaging && _fbMessaging.onBackgroundMessage(function(payload) { ... });

/* ============================================================
   [sw.js] Service Worker - 마이파이 PWA
   ============================================================ */

/* ── SW 내부 배지 카운트 (메모리, 재시작 시 초기화) ── */
var _badgeCount = 0;

var CACHE_NAME = "mypai-v6";
var CACHE_URLS = [
  "./games/social-messenger.html",
  "./js/config.js",
  "./js/profile-manager.js",
  "./js/pwa-manager.js",
  "./js/social-messenger.js",
  "./js/fcm-push.js",
  "./sound/alarm.mp3",
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

  var title  = data.title    || data.notification_title || "마이파이";
  var body   = data.body     || data.notification_body  || "새 메시지가 있어요.";
  var roomId = data.room_id  || (data.data && data.data.room_id) || "";
  var icon   = "./images/icons/icon-192x192.png";
  var badge  = "./images/icons/icon-192x192.png";
  var tag    = "mypai-msg-" + (roomId || "global");

  // 배지 카운트 누적 (SW 내부 관리)
  _badgeCount += 1;

  // scope 기준 절대경로 (notificationclick에서 PWA로 열기 위해 필수)
  var scope   = self.registration.scope;
  var appUrl  = scope + "games/social-messenger.html";

  var opts = {
    body:     body,
    icon:     icon,
    badge:    badge,
    tag:      tag,
    renotify: true,
    silent:   false,
    vibrate:  [200, 100, 200],
    data:     { roomId: roomId, url: appUrl }
  };

  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clients) {
      var isForeground = clients.some(function (c) {
        return c.visibilityState === "visible";
      });

      var tasks = [];

      // 백그라운드/종료 상태일 때만 시스템 알림 표시
      if (!isForeground) {
        tasks.push(self.registration.showNotification(title, opts));
      }

      // 앱 배지 누적값으로 업데이트
      if (self.navigator && self.navigator.setAppBadge) {
        tasks.push(self.navigator.setAppBadge(_badgeCount).catch(function(){}));
      }

      // 포그라운드 클라이언트에 알림 전달 (소리/진동/배지 갱신)
      clients.forEach(function (client) {
        client.postMessage({ type: "FCM_PUSH_RECEIVED", roomId: roomId, count: _badgeCount });
      });

      return Promise.all(tasks);
    })
  );
});

/* ── 알림 클릭 → PWA 앱으로 열기 + 해당 방으로 이동 ── */
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var roomId = (e.notification.data && e.notification.data.roomId) || "";

  // SW 등록 scope 기준 절대경로 생성 (브라우저 열림 방지 핵심)
  // self.registration.scope = "https://도메인/" (루트)
  var scope = self.registration.scope; // 끝에 "/" 포함
  var appUrl = scope + "games/social-messenger.html" + (roomId ? "?room=" + roomId : "");

  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clients) {

      // 1) 이미 열린 PWA/브라우저 창 중 같은 origin 창 찾기
      for (var i = 0; i < clients.length; i++) {
        var c = clients[i];
        if (!c.url) continue;
        // social-messenger 또는 같은 origin의 어떤 창이든
        if (c.url.indexOf(scope) === 0 && "focus" in c) {
          return c.focus().then(function (wc) {
            // 방 이동 메시지 전달
            if (roomId) wc.postMessage({ type: "FCM_OPEN_ROOM", roomId: roomId });
            // URL이 다른 페이지면 navigate
            if (wc.url.indexOf("social-messenger") === -1) {
              return wc.navigate(appUrl);
            }
          }).catch(function () {
            return self.clients.openWindow(appUrl);
          });
        }
      }

      // 2) 열린 창 없으면 PWA scope 내 URL로 새 창 열기
      //    scope 내 절대경로를 쓰면 Android Chrome이 브라우저 대신 PWA로 열음
      return self.clients.openWindow(appUrl);
    })
  );
});

/* ── 앱 배지 제어 (클라이언트 postMessage) ── */
self.addEventListener("message", function (e) {
  if (!e.data) return;
  var count = Number(e.data.count) || 0;
  if (e.data.type === "SET_BADGE") {
    _badgeCount = count;
    try {
      if (self.navigator && self.navigator.setAppBadge) {
        count > 0 ? self.navigator.setAppBadge(count) : self.navigator.clearAppBadge();
      }
    } catch (err) {}
  }
  if (e.data.type === "CLEAR_BADGE") {
    _badgeCount = 0;
    try {
      if (self.navigator && self.navigator.clearAppBadge) self.navigator.clearAppBadge();
    } catch (err) {}
  }
});
