/* ============================================================
   [signals.js] 방별 휘발성 알림 신호(signals) 구독/전송
   ------------------------------------------------------------
   - Firebase Realtime Database /signals/<roomId>/ 아래에
     { user_id, ts } 형태의 1회성 신호를 push하여 알림 트리거로 사용합니다.
   - 수신 측은 child_added 즉시 해당 신호 노드를 remove() 해서
     Firebase에 쌓이지 않게 유지합니다.
   - 알림 조건(Reply):
     "내가 그 방에 마지막으로 쓴 글(lastMyTs) 이후에,
      다른 사람이 쓴 신호가 들어오면" 알림.
     + 이미 그 방을 본 시각(lastSeenTs) 이전 신호는 무시합니다.

   [제거 시 함께 삭제/수정할 요소]
   1) games/social-messenger.html 의 signals.js include 제거
   2) js/social-messenger.js 의 SignalBus 연동부 제거
   3) js/chat-rooms.js 의 SignalBus.syncRooms 호출부 제거
   ============================================================ */

(function () {
  var db = null;
  var onNotify = null;
  var onSignal = null;
  var getMyId = null;

  var subscribed = {}; // roomId -> { ref, handler }
  var wantedRoomIds = [];

  var LS_KEY_MY = "signal_lastMyTs_v1";
  var LS_KEY_SEEN = "signal_lastSeenTs_v1";

  var lastMyTs = {};
  var lastSeenTs = {};

  function loadState() {
    try {
      var a = localStorage.getItem(LS_KEY_MY);
      if (a) lastMyTs = JSON.parse(a) || {};
    } catch (e) { lastMyTs = {}; }
    try {
      var b = localStorage.getItem(LS_KEY_SEEN);
      if (b) lastSeenTs = JSON.parse(b) || {};
    } catch (e) { lastSeenTs = {}; }
  }

  function saveState() {
    try { localStorage.setItem(LS_KEY_MY, JSON.stringify(lastMyTs || {})); } catch (e) {}
    try { localStorage.setItem(LS_KEY_SEEN, JSON.stringify(lastSeenTs || {})); } catch (e) {}
  }

  function safeMyId() {
    try {
      if (typeof getMyId === "function") return getMyId() || "";
    } catch (e) {}
    return "";
  }

  function normalizeRoomIds(list) {
    var arr = Array.isArray(list) ? list : [];
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var id = arr[i];
      if (!id) continue;
      id = String(id);
      if (out.indexOf(id) >= 0) continue;
      out.push(id);
    }
    if (out.length > 30) out = out.slice(0, 30);
    return out;
  }

  function shouldNotify(roomId, senderId, ts) {
    var myId = safeMyId();
    if (!roomId) return false;
    ts = Number(ts || 0);

    if (senderId && myId && String(senderId) === String(myId)) return false;

    var tMy = Number(lastMyTs[roomId] || 0);
    var tSeen = Number(lastSeenTs[roomId] || 0);

    if (ts <= tMy) return false;
    if (ts <= tSeen) return false;
    return true;
  }

  function handleSignal(roomId, snap) {
    try {
      if (snap && typeof snap.exists === "function" && !snap.exists()) return;
      var val = (snap && snap.val) ? (snap.val() || {}) : {};
      var senderId = val.user_id || val.sender || val.u || "";
      var ts = Number(val.ts || val.t || Date.now());

      // 수신 즉시 삭제(쌓이지 않게)
      try { if (snap && snap.ref && snap.ref.remove) snap.ref.remove(); } catch (e) {}

      // 모든 signals 수신을 현재 UI에 전달(현재 방 갱신용)
      try {
        if (typeof onSignal === "function") {
          onSignal({ roomId: roomId, user_id: senderId, ts: ts, raw: val });
        }
      } catch (eSig) {}

      if (!shouldNotify(roomId, senderId, ts)) return;

      if (typeof onNotify === "function") {
        onNotify({ roomId: roomId, user_id: senderId, ts: ts, raw: val });
      }
    } catch (e2) {
      try { if (snap && snap.ref && snap.ref.remove) snap.ref.remove(); } catch (e3) {}
    }
  }

  function subscribeRoom(roomId) {
    if (!db || !db.ref || !roomId) return;
    if (subscribed[roomId]) return;

    var r = db.ref("signals/" + roomId + "/last");
    var handler = function (snap) { handleSignal(roomId, snap); };
    r.on("value", handler);
    subscribed[roomId] = { ref: r, handler: handler };
  }

  function unsubscribeRoom(roomId) {
    var h = subscribed[roomId];
    if (!h) return;
    try { h.ref.off("child_added", h.handler); } catch (e) {}
    try { h.ref.off(); } catch (e2) {}
    delete subscribed[roomId];
  }

  function syncSubscriptions(roomIds) {
    wantedRoomIds = normalizeRoomIds(roomIds);
    if (!db) return;

    Object.keys(subscribed).forEach(function (rid) {
      if (wantedRoomIds.indexOf(rid) < 0) unsubscribeRoom(rid);
    });
    wantedRoomIds.forEach(function (rid) { subscribeRoom(rid); });
  }

  function attach(opts) {
    opts = opts || {};
    if (opts.db) db = opts.db;
    if (typeof opts.onNotify === "function") onNotify = opts.onNotify;
    if (typeof opts.onSignal === "function") onSignal = opts.onSignal;
    if (typeof opts.getMyId === "function") getMyId = opts.getMyId;

    if (wantedRoomIds && wantedRoomIds.length) syncSubscriptions(wantedRoomIds);
  }

  function push(roomId, senderId, ts) {
    if (!db || !db.ref || !roomId) return Promise.resolve();
    var payload = { user_id: senderId || "", ts: Number(ts || Date.now()) };
    try {
      var pushed = db.ref("signals/" + roomId + "/last");
      pushed.set(payload);

      // 송신 측에서도 일정 시간 후 자동 삭제(수신자가 없을 때도 Firebase에 오래 남지 않게)
      try {
        setTimeout(function () { try { pushed.remove(); } catch (e0) {} }, 60000);
      } catch (e1) {}

      return pushed;
    } catch (e) {
      return Promise.resolve();
    }
  }

  function markMy(roomId, ts) {
    if (!roomId) return;
    var t = Number(ts || Date.now());
    var prev = Number(lastMyTs[roomId] || 0);
    if (t > prev) {
      lastMyTs[roomId] = t;
      saveState();
    }
  }

  function markSeen(roomId, ts) {
    if (!roomId) return;
    var t = Number(ts || Date.now());
    var prev = Number(lastSeenTs[roomId] || 0);
    if (t > prev) {
      lastSeenTs[roomId] = t;
      saveState();
    }
  }

  loadState();

  window.SignalBus = {
    attach: attach,
    syncRooms: syncSubscriptions,
    push: push,
    markMyTs: markMy,
    markSeenTs: markSeen,
    getState: function () {
      return {
        wanted: (wantedRoomIds || []).slice(),
        subscribed: Object.keys(subscribed),
        lastMyTs: lastMyTs,
        lastSeenTs: lastSeenTs
      };
    }
  };
})();