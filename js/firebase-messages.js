/* ============================================================
   [firebase-messages.js] Firebase Realtime DB 메시지 저장/로딩
   ------------------------------------------------------------
   - 메시지 저장: Firebase /messages/{roomId}/{msgId}
   - 메시지 로딩: limitToLast(100) 기반 실시간 구독
   - 30일 지난 메시지 자동 삭제(Firebase에서만, 구글 시트는 유지)
   - 구글 시트는 백업 전용으로만 사용

   Firebase 데이터 구조:
   /messages/{roomId}/{pushId}: {
     user_id, nickname, text, ts, type, url (optional)
   }
   ============================================================ */

(function () {
  if (window.FirebaseMessages) return;

  var DAYS_30 = 10 * 24 * 60 * 60 * 1000; // 10일 보관
  var MSG_LIMIT = 100;

  /* ---- Firebase 준비 여부 확인 ---- */
  function isFirebaseReady() {
    try {
      return (
        typeof firebase !== "undefined" &&
        firebase.apps &&
        firebase.apps.length > 0
      );
    } catch (e) { return false; }
  }

  function getDb() {
    try {
      if (!isFirebaseReady()) return null;
      return firebase.database();
    } catch (e) { return null; }
  }

  function roomRef(roomId) {
    var db = getDb();
    if (!db || !roomId) return null;
    // Firebase key에 불가한 문자 제거
    var safeId = String(roomId).replace(/[.#$\[\]\/]/g, "_");
    return db.ref("messages/" + safeId);
  }

  /* ---- 30일 이전 메시지 삭제 (Firebase 전용) ---- */
  function pruneOldMessages(roomId) {
    var ref = roomRef(roomId);
    if (!ref) return;
    var cutoff = Date.now() - DAYS_30;
    ref.orderByChild("ts").endAt(cutoff).once("value").then(function (snap) {
      if (!snap.exists()) return;
      var updates = {};
      snap.forEach(function (child) {
        updates[child.key] = null; // null = 삭제
      });
      if (Object.keys(updates).length > 0) {
        ref.update(updates).catch(function () {});
      }
    }).catch(function () {});
  }

  /* ---- 메시지 저장 ---- */
  function saveMessage(roomId, msgData) {
    var ref = roomRef(roomId);
    if (!ref) return Promise.reject(new Error("Firebase not ready"));
    var payload = {
      user_id:  msgData.user_id  || "",
      nickname: msgData.nickname || "익명",
      text:     msgData.text     || "",
      ts:       msgData.ts       || Date.now(),
      type:     msgData.type     || "text"
    };
    if (msgData.url)      payload.url      = msgData.url;
    if (msgData.fileName) payload.fileName = msgData.fileName;
    return ref.push(payload);
  }

  /* ---- 실시간 구독 (방 전환 시 반드시 unsubscribe 후 재구독) ---- */
  function subscribe(roomId, onMessage, limit) {
    if (!isFirebaseReady()) {
      console.warn("[FirebaseMessages] Firebase가 아직 초기화되지 않았습니다. config.js 의 FIREBASE_CONFIG 를 확인하세요.");
      return null;
    }
    var ref = roomRef(roomId);
    if (!ref) return null;
    limit = Math.max(1, Number(limit || MSG_LIMIT));

    // ts 기준 정렬 + 최근 N개
    var q = ref.orderByChild("ts").limitToLast(limit);

    var handler = function (snap) {
      try {
        var val = snap.val();
        if (!val) return;
        onMessage({ key: snap.key, val: val });
      } catch (e) {}
    };
    q.on("child_added", handler);

    // 30일 청소 (구독 시점에 1회, 비동기)
    setTimeout(function () {
      try { pruneOldMessages(roomId); } catch (e) {}
    }, 2000);

    return { ref: q, handler: handler };
  }

  function unsubscribe(sub) {
    if (!sub || !sub.ref) return;
    try { sub.ref.off("child_added", sub.handler); } catch (e) {}
    try { sub.ref.off(); } catch (e2) {}
  }

  window.FirebaseMessages = {
    saveMessage:       saveMessage,
    subscribe:         subscribe,
    unsubscribe:       unsubscribe,
    pruneOldMessages:  pruneOldMessages,
    roomRef:           roomRef,
    isReady:           isFirebaseReady
  };
})();
