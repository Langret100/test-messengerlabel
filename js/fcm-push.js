/* ============================================================
   [fcm-push.js] FCM 웹 푸시 알림 모듈
   ------------------------------------------------------------
   흐름:
   1) 로그인 후 FCM 토큰 발급 (VAPID 키 필요)
   2) Firebase DB /fcm_tokens/{userId}/{roomId} 에 토큰 저장
      - 내가 방문한 방(ghostRoomVisited_v1) 기준으로만 저장
   3) 메시지 전송 시 Apps Script에 push_notify 요청
   4) Apps Script가 해당 방 구독자들에게 FCM 푸시 발송
   5) sw.js가 수신 → 시스템 알림 + 배지 표시

   [제거 시]
   1) index.html 에서 <script src="js/fcm-push.js"> 제거
   2) sw.js 의 FCM 관련 블록 제거
   3) Firebase DB /fcm_tokens 경로 삭제
   ============================================================ */

(function () {
  'use strict';

  // ── VAPID 공개 키 (Firebase 콘솔 → 프로젝트 설정 → 클라우드 메시징 → 웹 푸시 인증서)
  // GitHub Actions 배포 시 BDqiw7D__zWr5JzQ-RSZjbgowJv_9A752te_4OINq8s-EMyHr9oUgPbcCrImmKcorq_4p239To9XUsRMdiFyOQc 가 실제 키로 치환됩니다.
  var VAPID_KEY = 'BDqiw7D__zWr5JzQ-RSZjbgowJv_9A752te_4OINq8s-EMyHr9oUgPbcCrImmKcorq_4p239To9XUsRMdiFyOQc';

  var LS_VISITED   = 'ghostRoomVisited_v1';
  var LS_FCM_TOKEN = 'ghostFcmToken_v1';
  var DB_TOKENS    = 'fcm_tokens'; // Firebase DB 경로

  var _token = null;
  var _userId = null;

  /* ── Firebase DB 접근 ── */
  function getDb() {
    try {
      if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length > 0) {
        return firebase.database();
      }
    } catch (e) {}
    return null;
  }

  /* ── 현재 유저 ID ── */
  function getMyUserId() {
    try {
      if (window.currentUser && window.currentUser.user_id) return String(window.currentUser.user_id);
      var raw = localStorage.getItem('ghostUser');
      if (raw) { var u = JSON.parse(raw); if (u && u.user_id) return String(u.user_id); }
    } catch (e) {}
    return '';
  }

  /* ── 방문한 방 목록 ── */
  function getVisitedRoomIds() {
    var ids = ['global'];
    try {
      var raw = localStorage.getItem(LS_VISITED);
      if (raw) {
        var map = JSON.parse(raw) || {};
        Object.keys(map).forEach(function (rid) {
          if (ids.indexOf(rid) < 0) ids.push(rid);
        });
      }
    } catch (e) {}
    return ids;
  }

  /* ── FCM 토큰 발급 ── */
  function requestToken() {
    return new Promise(function (resolve, reject) {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        return reject(new Error('Push 미지원 환경'));
      }
      if (!VAPID_KEY) {
        return reject(new Error('VAPID 키 미설정'));
      }
      navigator.serviceWorker.ready.then(function (reg) {
        try {
          var messaging = firebase.messaging();
          messaging.getToken({ vapidKey: VAPID_KEY, serviceWorkerRegistration: reg })
            .then(function (token) {
              if (token) {
                _token = token;
                localStorage.setItem(LS_FCM_TOKEN, token);
                resolve(token);
              } else {
                reject(new Error('토큰 없음'));
              }
            })
            .catch(reject);
        } catch (e) { reject(e); }
      }).catch(reject);
    });
  }

  /* ── DB에 토큰 저장: /fcm_tokens/{userId}/token + rooms[] ── */
  function saveTokenToDb(token, userId) {
    var db = getDb();
    if (!db || !token || !userId) return;
    var rooms = getVisitedRoomIds();
    var safe = userId.replace(/[.#$\[\]]/g, '_');
    db.ref(DB_TOKENS + '/' + safe).set({
      token:    token,
      user_id:  userId,
      rooms:    rooms.join(','),  // 쉼표 구분 문자열
      ts:       Date.now()
    }).catch(function (e) {
      console.warn('[FCM] 토큰 저장 실패:', e.message || e);
    });
  }

  /* ── 알림 권한 요청 + 토큰 발급 + DB 저장 ── */
  function init(userId) {
    _userId = userId || getMyUserId();
    if (!_userId) return;

    // 이미 토큰 있으면 DB만 갱신
    var cached = localStorage.getItem(LS_FCM_TOKEN);
    if (cached) {
      _token = cached;
      saveTokenToDb(cached, _userId);
    }

    // 알림 권한 확인
    if (!('Notification' in window)) return;
    if (Notification.permission === 'denied') return;

    if (Notification.permission === 'granted') {
      requestToken()
        .then(function (token) { saveTokenToDb(token, _userId); })
        .catch(function (e) { console.warn('[FCM] 토큰 발급 실패:', e.message || e); });
    } else {
      // 권한 미결정 → 첫 사용자 인터랙션(터치/클릭) 시 자동 요청
      function _askPermission() {
        document.removeEventListener('click', _askPermission);
        document.removeEventListener('touchstart', _askPermission);
        Notification.requestPermission().then(function (perm) {
          if (perm === 'granted') {
            requestToken()
              .then(function (token) { saveTokenToDb(token, _userId); })
              .catch(function (e) { console.warn('[FCM] 토큰 발급 실패:', e.message || e); });
          }
        });
      }
      document.addEventListener('click', _askPermission, { once: true, passive: true });
      document.addEventListener('touchstart', _askPermission, { once: true, passive: true });
      // ghost:fcm-request-permission 이벤트로도 트리거 가능 (하위 호환)
      window.addEventListener('ghost:fcm-request-permission', function handler() {
        window.removeEventListener('ghost:fcm-request-permission', handler);
        _askPermission();
      });
    }
  }

  /* ── 방문 방 목록 변경 시 토큰 갱신 ── */
  window.addEventListener('ghost:visited-rooms-updated', function () {
    if (_token && _userId) saveTokenToDb(_token, _userId);
  });

  /* ── 로그인 완료 시 자동 초기화 ── */
  window.addEventListener('ghost:login-complete', function (ev) {
    try {
      var nick = ev.detail && ev.detail.user_id ? ev.detail.user_id : getMyUserId();
      setTimeout(function () { init(nick); }, 1000);
    } catch (e) {}
  });

  /* ── 외부 노출 ── */
  window.FcmPush = {
    init: init,
    getToken: function () { return _token; },
    refreshRooms: function () {
      if (_token && _userId) saveTokenToDb(_token, _userId);
    }
  };

})();
