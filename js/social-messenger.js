/* ============================================================
   [social-messenger.js] 소통 채팅 메신저형 전체 화면 뷰
   ------------------------------------------------------------
   - games/social-messenger.html 안에서만 사용
   - Firebase Realtime Database "socialChatRooms/{roomId}" 경로와 Apps Script를 활용해
     기존 소통 채팅(마이파-톡)과 같은 방/기록을 사용합니다.
   - 기본 채팅창 모드와 관계없이, 이 화면에서는 항상 "소통 채팅"처럼 동작합니다.
   - 이모티콘(:e1: ~ :e12:)은 chat-emoji.js 의 renderTextWithEmojis 로 렌더링합니다.

   [제거 시 함께 삭제할 요소]
   1) games/social-messenger.html
   2) js/social-messenger.js
   3) js/game-manager.js 의 window.launchMessenger 정의
   4) js/actions.js 의 data-action="social-messenger" 분기
   5) index.html 플러스 메뉴의 "📱 실시간 톡 보기" 버튼
   ============================================================ */
(function () {
  if (window.SocialMessengerView) return;
  window.SocialMessengerView = true;

  // Firebase 설정: social-chat-firebase.js 와 동일
/* GITHUB_PAGES_SECRET_INJECT
 * 공개 GitHub 저장소에서 Google API Key(AIza...) 노출 경고를 피하기 위해,
 * apiKey 값은 커밋하지 않고 "__FIREBASE_API_KEY__" 플레이스홀더로 둡니다.
 * GitHub Pages 배포 시 GitHub Actions(.github/workflows/pages.yml)가
 * Secrets(FIREBASE_API_KEY)에 저장된 실제 키로 이 값을 치환해서 배포합니다.
 */

  var FIREBASE_CONFIG = {
    apiKey: "__FIREBASE_API_KEY__",
    authDomain: "web-ghost-c447b.firebaseapp.com",
    databaseURL: "https://web-ghost-c447b-default-rtdb.firebaseio.com",
    projectId: "web-ghost-c447b",
    storageBucket: "web-ghost-c447b.firebasestorage.app",
    messagingSenderId: "198377381878",
    appId: "1:198377381878:web:83b56b1b4d63138d27b1d7"
  };

  var app, db, ref;
  var bodyEl, statusEl, msgInput, sendBtn, emojiBtn, emojiPanel, cameraBtn, closeBtn;
  var zoomOverlay, zoomImg;
  var myId = null;
  var myNickname = null;
  var messages = [];
  var MAX_BUFFER = 30;
  

  // ---- fix28: robust ts parse + sheet<->relay dedupe helpers ----
  function __smParseTs(v) {
    try {
      if (typeof v === "number" && isFinite(v)) return v;
      if (typeof v === "string") {
        var t = v.trim();
        if (/^\d{10,13}$/.test(t)) return Number(t);
        var p = Date.parse(t);
        if (!isNaN(p)) return p;
        var n = Number(t);
        if (!isNaN(n)) return n;
      }
    } catch (e) {}
    return 0;
  }

  function __smSigOf(user_id, text) {
    return String(user_id || "") + "|" + String(text || "").trim();
  }

  function __smBuildRelayMidIndex(list) {
    var idx = {};
    try {
      (list || []).forEach(function (m) {
        if (!m || !m.mid) return;
        var ts = __smParseTs(m.ts || 0);
        var b = Math.floor(ts / 5000);
        var sig = __smSigOf(m.user_id, m.text);
        for (var d = -2; d <= 2; d++) {
          var k = sig + "|" + String(b + d);
          if (!idx[k]) idx[k] = String(m.mid);
        }
      });
    } catch (e) {}
    return idx;
  }

  function __smTryAttachMidFromRelayIndex(m, idx) {
    try {
      if (!m || m.mid) return;
      var ts = __smParseTs(m.ts || 0);
      var b = Math.floor(ts / 5000);
      var sig = __smSigOf(m.user_id, m.text);
      var deltas = [0, -1, 1, -2, 2, -3, 3];
      for (var i = 0; i < deltas.length; i++) {
        var k = sig + "|" + String(b + deltas[i]);
        if (idx[k]) { m.mid = idx[k]; return; }
      }
    } catch (e) {}
  }
  // ---- end fix28 helpers ----

var __loadSeq = 0; // 방별 최근글 요청 순번(느린 응답 섞임 방지)
// 대화방(rooms)
  var currentRoomId = null;
  var currentRoomMeta = null;
  
  var listenStartedAt = Date.now();



// ------------------------------------------------------------
// (통합) + 버튼 첨부 메뉴 / 알림음 모듈
// - 기존 js/modules/* 의 attach-menu.js, notify-sound.js 를
//   본 파일로 통합했습니다(동작/디자인 동일).
// ------------------------------------------------------------

var AttachMenu = (function () {
  function buildMenu(root) {
    var menu = document.createElement("div");
    menu.className = "msg-attach-menu";
    menu.setAttribute("aria-hidden", "true");

    function makeItem(label, action) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "msg-attach-item";
      btn.textContent = label;
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        try { action && action(); } catch (err) {}
      });
      return btn;
    }

    menu.appendChild(makeItem("📷 사진촬영", function () { menu._fire && menu._fire("takePhoto"); }));
menu.appendChild(makeItem("🔎 QR 링크 스캔", function () { menu._fire && menu._fire("scanQr"); }));
menu.appendChild(makeItem("🖼️ 이미지 첨부", function () { menu._fire && menu._fire("pickImage"); }));
menu.appendChild(makeItem("📎 파일 첨부", function () { menu._fire && menu._fire("pickFile"); }));

// 알림 설정(켜짐/꺼짐 표시)
var notifyBtn = makeItem("", function () { menu._fire && menu._fire("toggleNotify"); });
menu._notifyBtn = notifyBtn;
menu.appendChild(notifyBtn);

    // 로그아웃(요청: + 메뉴에 추가)
    menu.appendChild(makeItem("🚪 로그아웃", function () { menu._fire && menu._fire("logout"); }));

    root.appendChild(menu);
    return menu;
  }

  function init(options) {
    // options: { buttonEl, containerEl, onTakePhoto, onScanQr, onPickImage, onPickFile }
    options = options || {};
    var btn = options.buttonEl;
    var container = options.containerEl || (btn ? btn.parentElement : null);
    if (!btn || !container) return null;

    // 중복 바인딩 방지(동작 영향 없이 안전장치)
    if (btn.__attachMenuBound) return btn.__attachMenuApi || null;

    var existing = container.querySelector(":scope > .msg-attach-menu");
    var menu = existing || buildMenu(container);

    function closeMenu() {
      menu.classList.remove("open");
      menu.setAttribute("aria-hidden", "true");
    }
    function openMenu() {
      if (menu._notifyBtn && typeof options.getNotifyLabel === "function") {
        menu._notifyBtn.textContent = options.getNotifyLabel();
      }
      menu.classList.add("open");
      menu.setAttribute("aria-hidden", "false");
    }
    function toggleMenu() {
      if (menu.classList.contains("open")) closeMenu();
      else openMenu();
    }

    menu._fire = function (type) {
      closeMenu();
      if (type === "takePhoto") return options.onTakePhoto && options.onTakePhoto();
      if (type === "scanQr") return options.onScanQr && options.onScanQr();
      if (type === "pickImage") return options.onPickImage && options.onPickImage();
      if (type === "pickFile") return options.onPickFile && options.onPickFile();
      if (type === "toggleNotify") return options.onToggleNotify && options.onToggleNotify();
      if (type === "logout") return options.onLogout && options.onLogout();
    };

    btn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      toggleMenu();
    });

    document.addEventListener("click", function (e) {
      if (!menu.classList.contains("open")) return;
      if (e.target === btn || btn.contains(e.target)) return;
      if (menu.contains(e.target)) return;
      closeMenu();
    });

    window.addEventListener("resize", closeMenu);
    container.addEventListener("scroll", closeMenu, { passive: true });

    var api = { open: openMenu, close: closeMenu, element: menu };
    btn.__attachMenuBound = true;
    btn.__attachMenuApi = api;
    return api;
  }

  return { init: init };
})();

var NotifySound = (function () {
  var ctx = null;
  var masterGain = null;
  var keepAliveOsc = null;
  var enabled = false;
  var bound = false;

  function ensureContext() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    masterGain = ctx.createGain();
    masterGain.gain.value = 1.0;
    masterGain.connect(ctx.destination);
    return ctx;
  }

  function tryResume() {
    try {
      var c = ensureContext();
      if (!c) return;
      if (c.state === "suspended") c.resume();
    } catch (e) {}
  }

  function startKeepAlive() {
    try {
      var c = ensureContext();
      if (!c || !masterGain) return;
      if (keepAliveOsc) return;
      keepAliveOsc = c.createOscillator();
      var g = c.createGain();
      g.gain.value = 0.00001;
      keepAliveOsc.frequency.value = 1;
      keepAliveOsc.connect(g);
      g.connect(masterGain);
      keepAliveOsc.start();
    } catch (e) {}
  }

  function armByUserGesture() {
    if (enabled) return;
    tryResume();
    enabled = true;
    startKeepAlive();
  }

  function bindUserGesture(target) {
    if (bound) return;
    bound = true;
    target = target || document;

    var once = function () {
      armByUserGesture();
      try {
        target.removeEventListener("pointerdown", once);
        target.removeEventListener("touchstart", once);
        target.removeEventListener("mousedown", once);
        target.removeEventListener("click", once);
      } catch (e) {}
    };

    target.addEventListener("pointerdown", once, { passive: true });
    target.addEventListener("touchstart", once, { passive: true });
    target.addEventListener("mousedown", once, { passive: true });
    target.addEventListener("click", once, { passive: true });

    document.addEventListener("visibilitychange", function () {
      if (!enabled) return;
      tryResume();
    });
  }

  function playDdiring() {
    if (!enabled) return false;
    var c = ensureContext();
    if (!c || !masterGain) return false;
    tryResume();

    var now = c.currentTime;
    var scheduleTone = function (freq, t, dur) {
      var osc = c.createOscillator();
      var g = c.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, t);

      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.8, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

      osc.connect(g);
      g.connect(masterGain);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    };

    scheduleTone(880, now + 0.00, 0.18);
    scheduleTone(1320, now + 0.20, 0.22);
    return true;
  }

  return { bindUserGesture: bindUserGesture, playDdiring: playDdiring };
})()

var NotifySetting = (function () {
  // 알림(띠리링 + 백그라운드 시스템 알림 시도) ON/OFF 설정
  // - 기본값: 켜짐 (KEY가 없거나 "1"이면 켜짐, "0"이면 꺼짐)
  // - 시스템 알림은 권한(granted)일 때 + 화면이 보이지 않을 때(document.hidden)만 "시도"합니다.
  // - Service Worker / Push 는 사용하지 않습니다(앱이 실행 중일 때만 동작).
  var KEY = "mypai_notify_enabled";

  function getPermission() {
    if (!("Notification" in window)) return "unsupported";
    try { return Notification.permission || "default"; } catch (e) { return "default"; }
  }

  function isEnabled() {
    try {
      var v = localStorage.getItem(KEY);
      return v !== "0"; // 기본 ON
    } catch (e) {
      return true;
    }
  }

  function setEnabled(v) {
    try { localStorage.setItem(KEY, v ? "1" : "0"); } catch (e) {}
  }

  function getMenuLabel() {
    var perm = getPermission();
    var on = isEnabled();

    if (perm === "denied") return on ? "🔔 알림: 켜짐(차단됨)" : "🔕 알림: 꺼짐(차단됨)";
    if (perm === "unsupported") return on ? "🔔 알림: 켜짐(지원안함)" : "🔕 알림: 꺼짐(지원안함)";
    if (perm === "default" && on) return "🔔 알림: 켜짐(권한 필요)";
    return on ? "🔔 알림: 켜짐" : "🔕 알림: 꺼짐";
  }

  function requestPermission() {
    if (!("Notification" in window)) return Promise.resolve("unsupported");
    try {
      var p = Notification.requestPermission();
      if (p && typeof p.then === "function") return p;
    } catch (e) {}
    return new Promise(function (resolve) {
      try { Notification.requestPermission(function (perm) { resolve(perm); }); }
      catch (e2) { resolve("default"); }
    });
  }

  function toggle(showStatus) {
    var next = !isEnabled();
    setEnabled(next);

    if (!next) {
      showStatus && showStatus("알림을 껐어요.");
      return Promise.resolve(false);
    }

    // 켜는 경우: 시스템 알림은 권한이 있으면 백그라운드에서만 시도
    var perm = getPermission();
    if (perm === "default") {
      // 사용자가 "알림 켜기"를 눌렀을 때만 권한 요청(자동 팝업 방지)
      showStatus && showStatus("백그라운드 알림을 쓰려면 권한이 필요해요.");
      return requestPermission().then(function (p) {
        if (p === "granted") showStatus && showStatus("알림을 켰어요.");
        else if (p === "denied") showStatus && showStatus("브라우저 설정에서 알림 허용이 필요해요.");
        else showStatus && showStatus("알림 권한이 아직 없어요.");
        return true;
      });
    }

    if (perm === "denied") {
      showStatus && showStatus("알림은 켜졌지만, 시스템 알림은 차단돼 있어요.");
      return Promise.resolve(true);
    }

    showStatus && showStatus("알림을 켰어요.");
    return Promise.resolve(true);
  }

  function maybeShow(msg) {
    if (!isEnabled()) return;
    if (getPermission() !== "granted") return;

    // 보이는 상태에서는 시스템 알림 생략(중복 방지)
    try {
      if (typeof document !== "undefined" && document.visibilityState === "visible") return;
    } catch (e) {}

    var title = "새 메시지";
    var body = "새 메시지가 도착했어요.";
    try {
      var t = msg && msg.type || "text";
      var summary = "";
      if (t === "image") summary = "사진";
      else if (t === "file") summary = "파일";
      else summary = (msg && msg.text) ? String(msg.text) : "메시지";
      body = (msg && msg.nickname ? (msg.nickname + " : ") : "") + summary;
      if (body.length > 80) body = body.slice(0, 77) + "...";
    } catch (e2) {}

    var opts = {
      body: body,
      tag: "mypai-social-chat",
      renotify: true
    };

    try { new Notification(title, opts); } catch (e3) {}
  }

  return {
    isEnabled: isEnabled,
    getMenuLabel: getMenuLabel,
    toggle: toggle,
    maybeShow: maybeShow
  };
})();


;

  function isEmojiOnlyText(text) {
    if (!text || typeof text !== "string") return false;
    var compact = text.replace(/\s+/g, "");
    return /^(?:\:e(0?[1-9]|1[0-2])\:)+$/.test(compact);
  }

  // [[FILE]]<url>|<encodeURIComponent(filename)> 형태 파싱
  function parseFileToken(raw) {
    if (!raw || typeof raw !== "string") return null;
    if (raw.indexOf("[[FILE]]") !== 0) return null;
    var rest = raw.replace("[[FILE]]", "");
    var parts = rest.split("|");
    var url = (parts[0] || "").trim();
    var encName = parts.slice(1).join("|");
    var name = "파일";
    try {
      if (encName) name = decodeURIComponent(encName.trim());
    } catch (e) {
      if (encName) name = encName.trim();
    }
    if (!url) return null;
    return { url: url, name: name };
  }

  // [[IMG]]<url> 형태 파싱
  function parseImageToken(raw) {
    if (!raw || typeof raw !== "string") return null;
    if (raw.indexOf("[[IMG]]") !== 0) return null;
    var url = raw.replace("[[IMG]]", "").trim();
    if (!url) return null;
    return { url: url };
  }

  // Drive URL에서 FILEID 추출
  function extractDriveId(url) {
    url = String(url || "").trim();
    if (!url) return "";
    try {
      // https://drive.google.com/file/d/FILEID/view?...
      var m = url.match(/drive\.google\.com\/file\/d\/([^\/\?]+)/i);
      if (m && m[1]) return m[1];
      // https://drive.google.com/open?id=FILEID
      var m2 = url.match(/drive\.google\.com\/open\?id=([^&]+)/i);
      if (m2 && m2[1]) return m2[1];
      // https://drive.google.com/uc?id=FILEID&...
      var m3 = url.match(/drive\.google\.com\/uc\?[^#]*id=([^&]+)/i);
      if (m3 && m3[1]) return m3[1];
      // 이미 fileId만 온 경우
      if (/^[a-zA-Z0-9_-]{10,}$/.test(url) && url.indexOf("http") !== 0) return url;
    } catch (e) {}
    return "";
  }

  // Drive '미리보기 페이지' URL을 <img>에서 보이는 직접 URL로 변환(구버전 호환)
  function normalizeDriveUrl(url) {
    url = String(url || "").trim();
    if (!url) return "";
    try {
      var id = extractDriveId(url);
      if (id) return "https://drive.google.com/uc?export=view&id=" + id;
    } catch (e) {}
    return url;
  }

  // 채팅 목록에서는 가벼운 썸네일로 보여주기(데이터 절약)
  function toChatThumbUrl(url) {
    url = String(url || "").trim();
    if (!url) return "";
    try {
      var id = extractDriveId(url);
      if (id) {
        // w480 정도면 모바일에서도 충분히 선명(표시 크기는 CSS로 제한)
        return "https://drive.google.com/thumbnail?id=" + id + "&sz=w480";
      }
    } catch (e) {}
    // Drive가 아니면 그대로(또는 normalize)
    return normalizeDriveUrl(url);
  }

    function getFirebasePath(roomId) {
    // Firebase Realtime DB 에 메시지를 저장합니다.
    // 경로: /messages/{roomId}
    if (!roomId) return null;
    var safeId = String(roomId).replace(/[.#$\[\]\/]/g, "_");
    return "messages/" + safeId;
  }

  // 30일 이전 Firebase 메시지 삭제 (Firebase만, 시트는 유지)
  var __lastPruneTs = {};
  function __pruneOldFirebaseMessages(roomId) {
    if (!roomId) return;
    var now = Date.now();
    if (__lastPruneTs[roomId] && (now - __lastPruneTs[roomId]) < 60000) return; // 1분 쓰로틀
    __lastPruneTs[roomId] = now;
    try {
      var cutoff = now - (10 * 24 * 60 * 60 * 1000); // 10일
      var __fbDb2 = ensureFirebase();
      var __fbPath2 = getFirebasePath(roomId);
      if (!__fbDb2 || !__fbPath2) return;
      __fbDb2.ref(__fbPath2).orderByChild("ts").endAt(cutoff).once("value").then(function (snap) {
        if (!snap.exists()) return;
        var updates = {};
        snap.forEach(function (child) { updates[child.key] = null; });
        if (Object.keys(updates).length > 0) __fbDb2.ref(__fbPath2).update(updates).catch(function(){});
      }).catch(function(){});
    } catch (e) {}
  }

  // Firebase 메시지 실시간 구독 핸들 (방 전환 시 해제용)
  var __fbMsgSub = null;

  function stopFirebaseMsgListen() {
    try {
      if (__fbMsgSub && __fbMsgSub.ref) {
        __fbMsgSub.ref.off("child_added", __fbMsgSub.handler);
        __fbMsgSub = null;
      }
    } catch (e) {}
  }

  function startFirebaseMsgListen(roomId) {
    stopFirebaseMsgListen();
    var __fbPath3 = getFirebasePath(roomId);
    var __fbDb3 = ensureFirebase();
    if (!__fbDb3 || !__fbPath3) return;

    var subStartTs = Date.now();
    var q = __fbDb3.ref(__fbPath3).orderByChild("ts").limitToLast(100);

    // ── 1단계: once("value")로 초기 메시지 전체를 한 번에 로딩 ──
    q.once("value").then(function (snap) {
      if (currentRoomId !== roomId) return; // 방 바뀌면 무시

      if (snap.exists()) {
        var newMsgs = [];
        snap.forEach(function (child) {
          var val = child.val();
          if (!val) return;
          // 중복 체크
          for (var i = 0; i < messages.length; i++) {
            if (messages[i] && (messages[i].key === child.key)) return;
          }
          var msg = {
            key:       child.key,
            mid:       val.mid || child.key,
            user_id:   val.user_id  || "",
            nickname:  val.nickname || "익명",
            text:      val.text     || "",
            type:      val.type === "photo" ? "image" : (val.type || "text"),
            image_url: val.url || val.image_url || "",
            file_url:  val.url || val.file_url  || "",
            file_name: val.fileName || val.file_name || "",
            ts:        val.ts || Date.now(),
            room_id:   roomId,
            _firebase: true,
            _isNew:    false
          };
          newMsgs.push(msg);
        });

        if (newMsgs.length > 0) {
          messages = messages.concat(newMsgs);
          messages.sort(function (a, b) { return (__smParseTs(a.ts) - __smParseTs(b.ts)); });
          if (messages.length > MAX_BUFFER * 2) messages.splice(0, messages.length - MAX_BUFFER * 2);
          renderAll(); // 한 번만 전체 렌더
        }
      }

      // ── 2단계: 이후 새 메시지만 child_added로 실시간 수신 ──
      var newMsgHandler = function (snap2) {
        try {
          if (currentRoomId !== roomId) return;
          var val2 = snap2.val();
          if (!val2) return;

          // 이미 있으면 스킵
          for (var i = 0; i < messages.length; i++) {
            if (messages[i] && messages[i].key === snap2.key) return;
          }

          // once("value") 이후 시점의 메시지만 처리
          if (Number(val2.ts || 0) <= subStartTs) return;

          var msg2 = {
            key:       snap2.key,
            mid:       val2.mid || snap2.key,
            user_id:   val2.user_id  || "",
            nickname:  val2.nickname || "익명",
            text:      val2.text     || "",
            type:      val2.type === "photo" ? "image" : (val2.type || "text"),
            image_url: val2.url || val2.image_url || "",
            file_url:  val2.url || val2.file_url  || "",
            file_name: val2.fileName || val2.file_name || "",
            ts:        val2.ts || Date.now(),
            room_id:   roomId,
            _firebase: true,
            _isNew:    true
          };

          // mid 기반 dedup (relay와 공유)
          var inMid2 = val2.mid || "";
          if (inMid2 && __hasRelay(inMid2)) return;
          if (inMid2) __rememberRelay(inMid2);

          // _local 메시지 교체 여부 확인
          var wasLocal = false;
          for (var di2 = messages.length - 1; di2 >= 0; di2--) {
            var mm2 = messages[di2];
            if (!mm2) continue;
            if (inMid2 && mm2.mid && mm2.mid === inMid2 && (mm2._local || mm2._relay)) {
              messages.splice(di2, 1);
              wasLocal = true;
              break;
            }
          }

          messages.push(msg2);
          messages.sort(function (a, b) { return (__smParseTs(a.ts) - __smParseTs(b.ts)); });
          // _local 교체 시 renderAll(날짜구분선 재계산), 신규 메시지면 appendNewMessage
          if (wasLocal) {
            renderAll();
          } else {
            appendNewMessage(msg2);
          }

          // 봤음 갱신
          try {
            if (window.SignalBus && typeof window.SignalBus.markSeenTs === "function") {
              window.SignalBus.markSeenTs(roomId, msg2.ts);
            }
          } catch (e0) {}

          // 알림음: 다른 사람 메시지 (구독 시작 후 1.5초 이후, 내 메시지 제외)
          try {
            if (msg2.user_id && String(msg2.user_id) !== String(myId || "") &&
                (Date.now() - subStartTs) > 1500) {
              if (NotifySetting && NotifySetting.isEnabled && NotifySetting.isEnabled()) {
                NotifySound.playDdiring();
                if (NotifySetting.maybeShow) NotifySetting.maybeShow(msg2);
              }
            }
          } catch (eSound) {}

          // 배지: 내가 현재 보고 있는 방이 아닐 때
          var msgRoomId = String(msg2.room_id || roomId || "");
          var isMyCurrentRoom = (msgRoomId === String(currentRoomId || ""));
          if (!isMyCurrentRoom) {
            // 방 목록 빨간 점
            try {
              if (window.RoomUnreadBadge && typeof window.RoomUnreadBadge.mark === "function") {
                window.RoomUnreadBadge.mark(msgRoomId, msg2.ts);
              }
            } catch (eBadge) {}
            // 앱 아이콘 숫자 배지 (항상 - 앱 열려있어도 다른 방이면 표시)
            try {
              if (window.PwaManager) window.PwaManager.incrementUnread(msgRoomId);
            } catch (ePwaBadge) {}
          }
        } catch (e) {}
      };

      // child_added는 startAfter 없이 쓰면 기존 데이터도 발화하므로
      // ts > subStartTs 조건으로 새 메시지만 처리
      var liveQ = __fbDb3.ref(__fbPath3).orderByChild("ts").startAt(subStartTs + 1);
      liveQ.on("child_added", newMsgHandler);
      __fbMsgSub = { ref: liveQ, handler: newMsgHandler };

      // 30일 청소
      setTimeout(function () { __pruneOldFirebaseMessages(roomId); }, 3000);

    }).catch(function (e) {
      console.warn("[Firebase] 초기 로딩 실패:", e.message || e);
    });
  }

  function stopListen() {
    // 방 이동 시 이전 방 리스너 확실히 해제(중복 수신/성능 저하 방지)
    try {
      if (window.RoomMessageStream && typeof window.RoomMessageStream.stop === "function") {
        window.RoomMessageStream.stop();
      }
    } catch (e0) {}

    stopFirebaseMsgListen();

    // 혹시 남아있는 ref 리스너까지 정리(안전망)
    try {
      if (ref && typeof ref.off === "function") ref.off();
    } catch (e) {}
  }


  // ------------------------------------------------------------
  // Firebase Anonymous Auth (규칙 auth != null 대응)
  // - 앱 시작 시 익명 로그인 자동 수행(사용자에게 구글 로그인 요구 X)
  // - init 이후 signInAnonymously() 1회 보장
  // ------------------------------------------------------------
  var __anonAuthPromise = null;

  function ensureAnonAuth() {
    // 익명 Auth를 쓰지 않는 구성(Realtime DB를 "relay"로만 사용)
    // - Auth 관련 네트워크 호출(identitytoolkit/securetoken) 자체를 하지 않음
    // - DB 접근은 rules에서 해당 경로를 unauth 허용하도록 설정 필요
    return Promise.resolve(true);
  }


  function ensureFirebase() {
    if (!window.firebase || !firebase.initializeApp) {
      console.warn("[messenger] Firebase SDK 가 없습니다.");
      showStatus("실시간 서버 연결에 실패했어요.");
      return null;
    }
    try {
      if (firebase.apps && firebase.apps.length > 0) {
        app = firebase.app();
      } else {
        app = firebase.initializeApp(FIREBASE_CONFIG);
      }
      db = firebase.database();
      var __p = getFirebasePath(currentRoomId);
      ref = __p ? db.ref(__p) : null;
      return db;
    } catch (e) {
      console.error("[messenger] Firebase 초기화 실패:", e);
      showStatus("연결 중 문제가 발생했어요.");
      return null;
    }
  }

  function loadUserFromStorage() {
    try {
      var raw = localStorage.getItem("ghostUser");
      if (!raw) return;
      var obj = JSON.parse(raw);
      if (!obj || !obj.user_id) return;
      myId = obj.user_id;
      myNickname = obj.nickname || obj.username || "익명";
    } catch (e) {
      console.warn("[messenger] ghostUser 파싱 실패:", e);
    }
  }

  function getSafeNickname() {
    if (myNickname && String(myNickname).trim()) return String(myNickname).trim();
    if (window.currentUser && window.currentUser.nickname) {
      return String(window.currentUser.nickname).trim();
    }
    return "익명";
  }

  function requireLogin() {
    if (myId) return true;
    showStatus("소통 채팅을 쓰려면 먼저 로그인해 주세요.");
    try {
      if (window.parent && typeof window.parent.openLoginPanel === "function") {
        window.parent.openLoginPanel();
      }
    } catch (e) {}
    return false;
  }

  function showStatus(text) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.classList.add("show");
    clearTimeout(showStatus._timer);
    showStatus._timer = setTimeout(function () {
      statusEl.classList.remove("show");
    }, 1600);
  }

  function formatDateKey(ts) {
    var d = new Date(ts || Date.now());
    var y = d.getFullYear();
    var m = (d.getMonth() + 1).toString().padStart(2, "0");
    var day = d.getDate().toString().padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function formatDateLabel(ts) {
    var d = new Date(ts || Date.now());
    var y = d.getFullYear();
    var m = (d.getMonth() + 1).toString().padStart(2, "0");
    var day = d.getDate().toString().padStart(2, "0");
    return y + "." + m + "." + day;
  }

  function appendDateSeparator(ts) {
    if (!bodyEl) return;
    var wrap = document.createElement("div");
    wrap.className = "date-separator";
    var span = document.createElement("span");
    span.textContent = formatDateLabel(ts);
    wrap.appendChild(span);
    bodyEl.appendChild(wrap);
  }

  function appendMessage(msg) {
    if (!bodyEl) return;
    var wrapper = document.createElement("div");
    // user_id 있으면 우선 비교, 없으면 nickname으로 fallback
    var isMe = myId && msg.user_id
      ? (msg.user_id === myId)
      : (msg.nickname && myNickname && msg.nickname === myNickname);
    wrapper.className = "msg-row " + (isMe ? "me" : "other");

    var bubble = document.createElement("div");
    bubble.className = "bubble";

    // 메시지 타입: text | image | file
    var type = msg.type || "text";
    var text = msg.text || "";

    if (type === "image" && msg.image_url) {
      bubble.classList.add("photo-bubble");
      var img = document.createElement("img");
      img.className = "chat-photo";
      img.setAttribute("data-zoomable", "1");
      img.alt = "사진";
      img.loading = "lazy";
      img.dataset.fullsrc = normalizeDriveUrl(msg.image_url);
      img.src = toChatThumbUrl(msg.image_url);
      img.onerror = function () {
        try {
          bubble.innerHTML = "";
          bubble.classList.remove("photo-bubble");
          bubble.classList.add("file-bubble");
          var aErr = document.createElement("a");
          aErr.className = "file-link";
          aErr.href = msg.image_url;
          aErr.target = "_blank";
          aErr.rel = "noopener";
          aErr.textContent = "📷 사진 열기";
          bubble.appendChild(aErr);
        } catch (e) {}
      };
      bubble.appendChild(img);
    } else if (type === "file" && (msg.file_url || msg.file_name)) {
      bubble.classList.add("file-bubble");
      var a = document.createElement("a");
      a.className = "file-link";
      a.href = msg.file_url || "#";
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = "📎 " + (msg.file_name || "파일 열기");
      bubble.appendChild(a);
    } else {
      // 시트 기록(텍스트)에서 [[IMG]]/[[FILE]]로 복원되는 경우
      var parsedImg = parseImageToken(text);
      if (parsedImg) {
        bubble.classList.add("photo-bubble");
        var img2 = document.createElement("img");
        img2.className = "chat-photo";
        img2.setAttribute("data-zoomable", "1");
        img2.alt = "사진";
        img2.loading = "lazy";
        img2.dataset.fullsrc = normalizeDriveUrl(parsedImg.url);
        img2.src = toChatThumbUrl(parsedImg.url);
        img2.onerror = function () {
          try {
            bubble.innerHTML = "";
            bubble.classList.remove("photo-bubble");
            bubble.classList.add("file-bubble");
            var aImg = document.createElement("a");
            aImg.className = "file-link";
            aImg.href = parsedImg.url;
            aImg.target = "_blank";
            aImg.rel = "noopener";
            aImg.textContent = "📷 사진 열기";
            bubble.appendChild(aImg);
          } catch (e) {}
        };
        bubble.appendChild(img2);
      } else {
      var parsedFile = parseFileToken(text);
      if (parsedFile) {
        bubble.classList.add("file-bubble");
        var a2 = document.createElement("a");
        a2.className = "file-link";
        a2.href = parsedFile.url;
        a2.target = "_blank";
        a2.rel = "noopener";
        a2.textContent = "📎 " + (parsedFile.name || "파일 열기");
        bubble.appendChild(a2);
      } else {
      var emojiOnly = isEmojiOnlyText(text);
      if (emojiOnly) bubble.classList.add("emoji-only");
      if (typeof window.renderTextWithEmojis === "function") {
        try {
          window.renderTextWithEmojis(text, bubble);
        } catch (e) {
          bubble.textContent = text;
        }
      } else {
        bubble.textContent = text;
      }
      }
      }
    }

    // 링크 자동 변환 + 유튜브 미리보기(텍스트 메시지)
    if (type === "text") {
      try {
        if (window.ChatLinkify && typeof window.ChatLinkify.enhanceBubble === "function") {
          window.ChatLinkify.enhanceBubble(bubble, text);
        }
      } catch (e) {}
    }


    // ── 카톡 스타일 조립 ──────────────────────────────────────
    //
    //  [other]  [아바타] [이름]
    //           [버블] [시간]
    //
    //  [me]              [시간] [버블]
    //
    var inner = document.createElement("div");
    inner.className = "msg-inner";

    if (!isMe) {
      // 아바타
      var avatarWrap = document.createElement("div");
      avatarWrap.style.cssText = "flex:0 0 auto;width:36px;margin-right:6px;align-self:flex-start;";
      var avatarImg = document.createElement("img");
      avatarImg.className = "msg-avatar";
      avatarImg.setAttribute("data-profile-nick", msg.nickname || "익명");
      avatarImg.alt = msg.nickname || "익명";
      avatarImg.style.cssText = "width:36px;height:36px;border-radius:50%;object-fit:cover;background:#e0e7ff;display:block;";
      // 프로필 이미지: ProfileManager 캐시 우선, 없으면 기본 아바타
      avatarImg.src = (window.ProfileManager && window.ProfileManager.getAvatarUrl)
        ? window.ProfileManager.getAvatarUrl(msg.nickname || "")
        : "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="#c7d2fe"/><circle cx="20" cy="15" r="7" fill="#818cf8"/><ellipse cx="20" cy="34" rx="12" ry="9" fill="#818cf8"/></svg>');
      avatarImg.onerror = function () {
        this.onerror = null;
        this.src = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="#c7d2fe"/><circle cx="20" cy="15" r="7" fill="#818cf8"/><ellipse cx="20" cy="34" rx="12" ry="9" fill="#818cf8"/></svg>');
      };
      // 클릭 시 프로필 이미지 확대 보기
      avatarImg.style.cursor = "pointer";
      avatarImg.addEventListener("click", function () {
        showProfileZoom(msg.nickname || "익명", this.src);
      });
      // 백그라운드 Drive 캐시
      if (window.ProfileManager && window.ProfileManager.fetchAndCacheProfile) {
        setTimeout(function () { window.ProfileManager.fetchAndCacheProfile(msg.nickname || ""); }, 400);
      }
      avatarWrap.appendChild(avatarImg);
      inner.appendChild(avatarWrap);
    }

    // 콘텐츠 래퍼 (이름 + [버블+시간])
    var contentWrap = document.createElement("div");
    contentWrap.style.cssText = "display:flex;flex-direction:column;gap:2px;" + (isMe ? "align-items:flex-end;" : "align-items:flex-start;");

    // 상대방 이름
    if (!isMe) {
      var nameEl = document.createElement("div");
      nameEl.className = "msg-sender-name";
      nameEl.textContent = msg.nickname || "익명";
      contentWrap.appendChild(nameEl);
    }

    // 버블 + 시간 행
    var bubbleRow = document.createElement("div");
    bubbleRow.style.cssText = "display:flex;align-items:flex-end;gap:4px;" + (isMe ? "flex-direction:row-reverse;" : "");

    // 시간
    var timeEl = document.createElement("div");
    timeEl.className = "msg-meta";
    if (msg.ts) {
      var d = new Date(__smParseTs(msg.ts) || Date.now());
      var hh = d.getHours();
      var mm = d.getMinutes().toString().padStart(2, "0");
      var ampm = hh < 12 ? "오전" : "오후";
      hh = hh % 12 || 12;
      timeEl.textContent = ampm + " " + hh + ":" + mm;
    }

    bubbleRow.appendChild(bubble);
    bubbleRow.appendChild(timeEl);
    contentWrap.appendChild(bubbleRow);

    inner.appendChild(contentWrap);
    wrapper.appendChild(inner);

    bodyEl.appendChild(wrapper);

    // 맨 아래에 가까우면 자동 스크롤
    var isNearBottom = (bodyEl.scrollHeight - bodyEl.scrollTop - bodyEl.clientHeight) < 150;
    if (isNearBottom || isMe) bodyEl.scrollTop = bodyEl.scrollHeight;
  }

  // ------------------------------------------------------------
  // 이미지 확대 보기 (사진/미디어 메시지용)
  //  - img.chat-photo 또는 [data-zoomable="1"] 클릭 시 전체 화면 확대
  //  - 다시 누르면(오버레이 클릭) 닫힘
  // ------------------------------------------------------------
  function initImageZoom() {
    zoomOverlay = document.getElementById("imageZoomOverlay");
    zoomImg = document.getElementById("imageZoomImg");
    var zoomLink = document.getElementById("imageZoomOpenLink");
    if (!zoomOverlay || !zoomImg || !bodyEl) return;

    function openZoom(src) {
      if (!src) return;

      // 원본 열기 링크
      try {
        if (zoomLink) {
          zoomLink.href = src;
          zoomLink.style.display = "block";
        }
      } catch (e0) {}

      // Drive 링크는 여러 방식으로 폴백 시도
      var tries = [];
      try {
        tries.push(src);
        var id = null;
        try { id = extractDriveId(src); } catch (e1) { id = null; }
        if (id) {
          tries.push("https://drive.google.com/uc?export=download&id=" + id);
          tries.push("https://drive.google.com/thumbnail?id=" + id + "&sz=w2048");
        }
      } catch (e2) {
        tries = [src];
      }

      zoomImg.dataset.tryIndex = "0";
      zoomImg.dataset.tryList = JSON.stringify(tries);
      zoomImg.src = tries[0];

      zoomOverlay.classList.add("open");
      zoomOverlay.setAttribute("aria-hidden", "false");
      document.body.classList.add("no-scroll");
    }
    function closeZoom() {
      zoomOverlay.classList.remove("open");
      zoomOverlay.setAttribute("aria-hidden", "true");
      zoomImg.removeAttribute("src");
      document.body.classList.remove("no-scroll");
    }

    // 확대 이미지 로드 실패 시 Drive 폴백(다운로드/큰 썸네일) 순서로 재시도
    zoomImg.onerror = function () {
      try {
        var list = [];
        try { list = JSON.parse(zoomImg.dataset.tryList || "[]") || []; } catch (e1) { list = []; }
        var i = Number(zoomImg.dataset.tryIndex || "0");
        if (i + 1 < list.length) {
          zoomImg.dataset.tryIndex = String(i + 1);
          zoomImg.src = list[i + 1];
          return;
        }
        // 모두 실패하면 원본 열기 링크만 남김
        if (zoomLink) zoomLink.style.display = "block";
      } catch (e0) {}
    };

    // 채팅 내 이미지 클릭(이벤트 위임)
    bodyEl.addEventListener("click", function (e) {
      var img = e.target && e.target.closest ? e.target.closest("img") : null;
      if (!img) return;
      var isZoomable = img.classList.contains("chat-photo") || img.getAttribute("data-zoomable") === "1";
      if (!isZoomable) return;
      e.preventDefault();
      e.stopPropagation();
      openZoom(img.dataset.fullsrc || img.currentSrc || img.src);
    });

    // 오버레이를 누르면 닫힘(다시 누르면 돌아가기)
    zoomOverlay.addEventListener("click", function () {
      closeZoom();
    });

    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && zoomOverlay.classList.contains("open")) {
        closeZoom();
      }
    });
  }

  /* ── 렌더링 최적화 ──────────────────────────────────────────
     - 초기 로딩: 배치 처리 (100개를 한 번에 그림)
     - 새 메시지: appendMessage만 (전체 재렌더 안 함)
     ──────────────────────────────────────────────────────── */
  var _renderBatchTimer = null;
  var _lastRenderedCount = 0;
  var _lastRenderedDateKey = null; // 마지막으로 렌더된 날짜 key 추적

  /* 전체 재렌더 (방 전환 / 시트 폴백 등 전체 갱신 필요 시) */
  function renderAll() {
    if (!bodyEl) return;
    _lastRenderedCount = 0;
    _lastRenderedDateKey = null;
    bodyEl.innerHTML = "";
    if (!messages || messages.length === 0) {
      var empty = document.createElement("div");
      empty.className = "empty-hint";
      empty.textContent = "아직 올라온 소통 메시지가 없어요. 먼저 말을 걸어 볼래요?";
      bodyEl.appendChild(empty);
      return;
    }
    var frag = document.createDocumentFragment();
    var lastKey = null;
    var tempBody = { appendChild: function (el) { frag.appendChild(el); } };
    messages.forEach(function (m) {
      if (!m) return;
      var ts = m.ts || Date.now();
      var key = formatDateKey(ts);
      if (lastKey !== key) {
        var sep = document.createElement("div");
        sep.className = "date-separator";
        sep.setAttribute("data-date-key", key);
        sep.innerHTML = "<span>" + formatDateLabel(ts) + "</span>";
        frag.appendChild(sep);
        lastKey = key;
        _lastRenderedDateKey = key;
      }
      // appendMessage를 bodyEl 대신 frag에
      var _orig = bodyEl;
      bodyEl = tempBody;
      appendMessage(m);
      bodyEl = _orig;
    });
    bodyEl.appendChild(frag);
    _lastRenderedCount = messages.length;
    bodyEl.scrollTop = bodyEl.scrollHeight;
  }

  /* 새 메시지 1개 추가 (전체 재렌더 없이 append only) */

  /* ── 프로필 이미지 확대 보기 ── */
  function showProfileZoom(nickname, imgSrc) {
    var existing = document.getElementById("profileZoomOverlay");
    if (existing) existing.remove();

    var overlay = document.createElement("div");
    overlay.id = "profileZoomOverlay";
    overlay.style.cssText = "position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(0,0,0,0.75);animation:fadeIn .15s ease;";

    var img = document.createElement("img");
    img.src = imgSrc;
    img.style.cssText = "max-width:min(280px,80vw);max-height:min(280px,80vw);border-radius:50%;object-fit:cover;border:3px solid rgba(255,255,255,0.3);box-shadow:0 8px 40px rgba(0,0,0,0.5);";

    var nameEl = document.createElement("div");
    nameEl.textContent = nickname;
    nameEl.style.cssText = "color:#fff;font-size:15px;font-weight:700;margin-top:14px;text-shadow:0 1px 4px rgba(0,0,0,0.5);text-align:center;";

    overlay.appendChild(img);
    overlay.appendChild(nameEl);

    // 상태메시지 영역 (비동기 로드)
    var statusEl = document.createElement("div");
    statusEl.style.cssText = "color:rgba(255,255,255,0.82);font-size:13px;margin-top:6px;max-width:min(260px,76vw);text-align:center;line-height:1.5;word-break:break-all;text-shadow:0 1px 3px rgba(0,0,0,0.4);min-height:18px;";
    overlay.appendChild(statusEl);

    overlay.addEventListener("click", function () { overlay.remove(); });
    document.body.appendChild(overlay);

    // 클릭 시에만 statusMsg 불러옴 (서버 부담 최소화)
    if (window.ProfileManager && typeof window.ProfileManager.fetchStatusMsg === "function") {
      window.ProfileManager.fetchStatusMsg(nickname, function (msg) {
        if (msg && overlay.parentNode) statusEl.textContent = msg;
      });
    }
  }

  function appendNewMessage(msg) {
    if (!bodyEl || !msg) return;
    // 빈 힌트 제거
    var hint = bodyEl.querySelector(".empty-hint");
    if (hint) hint.remove();

    var ts = msg.ts || Date.now();
    var key = formatDateKey(ts);
    // JS 변수로 직접 추적 - querySelector는 :last-of-type 오작동으로 사용 안 함
    if (_lastRenderedDateKey !== key) {
      var sep2 = document.createElement("div");
      sep2.className = "date-separator";
      sep2.setAttribute("data-date-key", key);
      sep2.innerHTML = "<span>" + formatDateLabel(ts) + "</span>";
      bodyEl.appendChild(sep2);
      _lastRenderedDateKey = key;
    }
    appendMessage(msg);
    _lastRenderedCount++;
  }

  // loadRecentFromSheet: 제거됨
  // 글은 Firebase에서만 로드. 시트는 백업 쓰기 전용.
  // (Firebase가 비어있어도 시트 폴백 없음 - 데이터 정합성 보장)
  function loadRecentFromSheet(roomId) { return; }



  // signals 수신에 따라 현재 방의 최근글(30개)만 '짧게' 갱신 (속도/혼선 방지)
  var __roomRefreshTimer = null;
  

function isVisitedRoomForNotify(roomId) {
  try {
    if (!roomId) return false;
    if (String(roomId) === "global") return true;
    var raw = localStorage.getItem("ghostRoomVisited_v1");
    if (!raw) return false;
    var map = JSON.parse(raw) || {};
    return !!map[String(roomId)];
  } catch (e) {
    return false;
  }
}

// ------------------------------------------------------------
// (B안) Firebase를 "저장소"가 아니라 "중계"로만 사용해 실시간 속도 확보
// - SignalBus(/signals/<room>/q)의 onMessage를 받아 현재 방 UI에 즉시 반영합니다.
// - 중복/에코 방지용 mid(메시지 ID) 기반 디듀프를 포함합니다.
// ------------------------------------------------------------
var __relaySeen = {};
var __relaySeenOrder = [];
var __RELAY_SEEN_MAX = 240;

function __rememberRelay(mid) {
  try {
    if (!mid) return;
    mid = String(mid);
    if (__relaySeen[mid]) return;
    __relaySeen[mid] = 1;
    __relaySeenOrder.push(mid);
    if (__relaySeenOrder.length > __RELAY_SEEN_MAX) {
      var old = __relaySeenOrder.splice(0, __relaySeenOrder.length - __RELAY_SEEN_MAX);
      old.forEach(function (k) { delete __relaySeen[k]; });
    }
  } catch (e) {}
}

function __hasRelay(mid) {
  try { return !!(__relaySeen && mid && __relaySeen[String(mid)]); } catch (e) { return false; }
}

function __removeByMid(mid) {
  try {
    if (!mid) return false;
    mid = String(mid);
    var removed = false;
    for (var i = messages.length - 1; i >= 0; i--) {
      var it = messages[i];
      if (!it) continue;
      if (String(it.mid || it.key || "") === mid) {
        messages.splice(i, 1);
        removed = true;
      }
    }
    if (removed) renderAll();
    return removed;
  } catch (e) { return false; }
}

function __toMessageFromRelay(msgInfo) {
  var txt = (msgInfo && msgInfo.text != null) ? String(msgInfo.text) : "";
  var m = {
    key: (msgInfo.mid || ("relay_" + (msgInfo.ts || Date.now()))),
    mid: msgInfo.mid || "",
    user_id: msgInfo.user_id || "",
    nickname: msgInfo.nickname || "익명",
    text: txt,
    ts: msgInfo.ts || Date.now(),
    room_id: msgInfo.roomId || currentRoomId || "",
    _relay: true
  };

  // 토큰 기반 타입 복원([[IMG]] / [[FILE]])
  try {
    if (txt.indexOf("[[IMG]]") === 0) {
      m.type = "image";
      m.image_url = txt.replace("[[IMG]]", "").trim();
      m.text = "";
    } else if (txt.indexOf("[[FILE]]") === 0) {
      var pf = (typeof parseFileToken === "function") ? parseFileToken(txt) : null;
      if (pf) {
        m.type = "file";
        m.file_url = pf.url;
        m.file_name = pf.name;
        m.text = "";
      } else {
        m.type = "text";
      }
    } else {
      m.type = "text";
    }
  } catch (e2) {
    m.type = "text";
  }

  return m;
}

function __applyRelayMessage(msgInfo) {
  try {
    if (!msgInfo || !msgInfo.roomId) return;
    if (!currentRoomId) return;
    if (String(msgInfo.roomId) !== String(currentRoomId)) return;

    // retract(전송 실패/취소) 처리
    if (String(msgInfo.kind || "") === "retract") {
      __removeByMid(msgInfo.mid || "");
      return;
    }

    var mid = msgInfo.mid || "";
    if (mid && __hasRelay(mid)) return;
    if (mid) __rememberRelay(mid);

    var m = __toMessageFromRelay(msgInfo);

    // 현재 방에서 보고 있을 때는 lastSeenTs 갱신(알림 오탐 방지)
    try {
      if (window.SignalBus && typeof window.SignalBus.markSeenTs === "function") {
        window.SignalBus.markSeenTs(currentRoomId || "", m.ts || Date.now());
      }
    } catch (eSeen) {}

    // _local 교체 여부에 따라 renderAll or appendNewMessage
    var relayWasLocal = false;
    for (var ri = messages.length - 2; ri >= 0; ri--) {
      var rm = messages[ri];
      if (!rm) continue;
      if (m.mid && rm.mid && rm.mid === m.mid && (rm._local)) {
        messages.splice(ri, 1);
        relayWasLocal = true;
        break;
      }
    }
    messages.push(m);
    if (messages.length > MAX_BUFFER) messages.splice(0, messages.length - MAX_BUFFER);
    if (relayWasLocal) {
      renderAll();
    } else {
      appendNewMessage(m);
    }
  } catch (e) {}
}

function scheduleRoomRefresh(roomId) {
    // Firebase 실시간 구독으로 대체됨 - 시트 재로딩 불필요
    return;
  }

  // ── startListen: startFirebaseMsgListen으로 완전 통합, 더 이상 사용 안 함 ──
  // 두 리스너가 동시에 같은 Firebase 경로를 구독해 메시지가 2개씩 렌더되는 문제 수정
  function startListen() { return; }

  // logToSheet: 제거됨 (데드코드, 호출 없음)

    function sendTextMessage(text) {
    var clean = (text || "").trim();
    if (!clean) {
      showStatus("보낼 내용을 입력해 주세요.");
      return;
    }
    if (!requireLogin()) return;

    if (!currentRoomId) {
      showStatus("상단 왼쪽 '대화방' 버튼을 눌러 방을 선택해 주세요.");
      try {
        if (window.RoomGuard && typeof window.RoomGuard.renderNoRoomHint === "function") {
          window.RoomGuard.renderNoRoomHint(bodyEl);
        }
      } catch (e0) {}
      return;
    }

    var now = Date.now();

    // 즉시 화면에 반영(낙관적 렌더)
    var __mid = "m_" + now + "_" + Math.random().toString(16).slice(2);
    var __localKey = "local_" + __mid;
    var __localMsg = {
      key: __localKey,
      mid: __mid,
      user_id: myId || "",
      nickname: getSafeNickname(),
      text: clean,
      type: "text",
      ts: now,
      room_id: currentRoomId || "",
      _local: true
    };

    try {
      messages.push(__localMsg);
      if (messages.length > MAX_BUFFER) messages.splice(0, messages.length - MAX_BUFFER);
      appendNewMessage(__localMsg); // append only - 전체 재렌더 없음
      if (window.SignalBus && typeof window.SignalBus.markSeenTs === "function") {
        window.SignalBus.markSeenTs(currentRoomId || "", now);
      }
      if (window.SignalBus && typeof window.SignalBus.markMyTs === "function") {
        window.SignalBus.markMyTs(currentRoomId || "", now);
      }
    } catch (e0) {}

    // (B안) Firebase signals 큐로 즉시 중계(시트 저장과는 별개)
    try {
      __rememberRelay(__mid);
      if (window.SignalBus && typeof window.SignalBus.push === "function") {
        window.SignalBus.push(currentRoomId || "", {
          kind: "chat",
          mid: __mid,
          room_id: currentRoomId || "",
          user_id: myId || "",
          nickname: getSafeNickname(),
          text: clean,
          ts: now
        });
      }
    } catch (eRelay) {}

    // Firebase Realtime DB 에 메시지 저장 (빠른 실시간 로딩용)
    try {
      var __fbPath = getFirebasePath(currentRoomId);
      var __fbDb = ensureFirebase();
      if (__fbDb && __fbPath) {
        __fbDb.ref(__fbPath).push({
          mid:      __mid,
          user_id:  myId || "",
          nickname: getSafeNickname(),
          text:     clean,
          type:     "text",
          ts:       now,
          room_id:  currentRoomId || ""
        }).then(function () {
          console.log("[Firebase] 메시지 저장 성공 →", __fbPath);
        }).catch(function (e) {
          console.warn("[Firebase] 메시지 저장 실패:", e.message || e);
        });
        __pruneOldFirebaseMessages(currentRoomId);
      } else {
        console.warn("[Firebase] DB 없음 - ensureFirebase() 실패");
      }
    } catch (eFbSave) {
      console.warn("[Firebase] 저장 예외:", eFbSave);
    }

    // 1) 시트에 기록 (백업 저장소)
    try {
      if (typeof window.postToSheet !== "function") throw new Error("postToSheet missing");

      window.postToSheet({
        mode: "social_chat_room",
        room_id: currentRoomId || "",
        mid: __mid,
        user_id: myId || "",
        nickname: getSafeNickname(),
        message: clean,
        text: clean,
        ts: now
      }).then(function (res) {
        if (!res || !res.ok) console.warn("[messenger] 텍스트 시트 백업 응답 이상(무시)");
      }).catch(function (err) {
        console.warn("[messenger] 시트 백업 실패(무시):", err);
      });
    } catch (e) {
      console.warn("[messenger] 시트 백업 예외(무시):", e);
    }
  }

  function sendCurrentMessage() {
    if (!msgInput) return;
    var text = (msgInput.value || "").trim();
    if (!text) {
      showStatus("보낼 내용을 입력해 주세요.");
      return;
    }
    // 입력창은 미리 비우고 전송(키 입력 반복 방지)
    msgInput.value = "";
    sendTextMessage(text);
  }

  function buildEmojiPanel() {
    emojiBtn = document.getElementById("msgEmojiBtn");
    emojiPanel = document.getElementById("msgEmojiPanel");
    if (!emojiBtn || !emojiPanel || !msgInput) return;

    if (!emojiPanel.dataset.built) {
      emojiPanel.dataset.built = "1";
      var grid = document.createElement("div");
      grid.className = "emoji-grid";
      for (var i = 1; i <= 12; i++) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "emoji-item";
        btn.setAttribute("data-code", "e" + i);

        var img = document.createElement("img");
        img.className = "chat-emoji";
        img.src = "../images/emoticon/e" + i + ".png";
        img.alt = ":e" + i + ":";
        btn.appendChild(img);
        grid.appendChild(btn);
      }
      emojiPanel.appendChild(grid);
    }

    function closePanel() {
      emojiPanel.classList.remove("open");
    }

    emojiBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (emojiPanel.classList.contains("open")) {
        emojiPanel.classList.remove("open");
      } else {
        emojiPanel.classList.add("open");
      }
    });

    emojiPanel.addEventListener("click", function (e) {
      var btn = e.target.closest(".emoji-item");
      if (!btn) return;
      var code = btn.getAttribute("data-code");
      if (!code) return;
      var token = ":" + code + ":";

      // 방 선택 전에는 전송 불가
      if (!currentRoomId) {
        showStatus("상단 왼쪽 '대화방' 버튼을 눌러 방을 선택해 주세요.");
        try {
          if (window.RoomGuard && typeof window.RoomGuard.renderNoRoomHint === "function") {
            window.RoomGuard.renderNoRoomHint(bodyEl);
          }
        } catch (e0) {}
        closePanel();
        return;
      }

      // [요청사항] 실시간 톡 보기에서는 이모티콘을 고르면 즉시 전송
      sendTextMessage(token);
      try { msgInput.focus(); } catch (e2) {}
      closePanel();
    });

    document.addEventListener("click", function (e) {
      if (!emojiPanel.classList.contains("open")) return;
      if (e.target === emojiBtn || emojiBtn.contains(e.target)) return;
      if (emojiPanel.contains(e.target)) return;
      emojiPanel.classList.remove("open");
    });
  }

  function attachEvents() {
    if (!sendBtn || !msgInput) return;
    sendBtn.addEventListener("click", function () {
      sendCurrentMessage();
    });
    msgInput.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        sendCurrentMessage();
      }
    });

    closeBtn = document.getElementById("topCloseBtn");
    if (closeBtn) {
      closeBtn.addEventListener("click", function () {
        try {
          if (window.parent && typeof window.parent.exitGame === "function") {
            window.parent.exitGame();
          } else {
            window.close();
          }
        } catch (e) {
          window.close();
        }
      });
    }

    buildEmojiPanel();

    // + 첨부 메뉴(사진촬영/이미지/파일)
    cameraBtn = document.getElementById("msgCameraBtn");
    if (cameraBtn && AttachMenu && typeof AttachMenu.init === "function") {
      AttachMenu.init({
          buttonEl: cameraBtn,
          containerEl: cameraBtn.parentElement,
          onTakePhoto: async function () {
            if (!requireLogin()) return;
            if (!window.ChatPhoto || typeof window.ChatPhoto.pickAndUpload !== "function") {
              showStatus("사진 기능이 준비되지 않았어요.");
              return;
            }
            try {
              showStatus("사진 촬영 준비 중...");
              var result = await window.ChatPhoto.pickAndUpload({
                capture: true,
                size: 480,
                quality: 0.78,
                user_id: myId || "",
                nickname: getSafeNickname()
              });
              if (!result || !result.url) {
                showStatus("사진 업로드에 실패했어요.");
                return;
              }
              sendImageMessage(result.url);
            } catch (e) {
              console.warn("[messenger] take photo error:", e);
              showStatus("사진 전송에 실패했어요.");
            }
          },
                    onScanQr: async function () {
            if (!requireLogin()) return;
            if (!window.QRLinkScanner || typeof window.QRLinkScanner.start !== "function") {
              showStatus("QR 스캔 기능이 준비되지 않았어요.");
              return;
            }
            try {
              window.QRLinkScanner.start({
                onResult: function (val) {
                  try {
                    if (!val) return;
                    sendTextMessage(String(val));
                  } catch (e) {}
                }
              });
            } catch (e) {
              showStatus("QR 스캔을 시작할 수 없어요.");
            }
          },
onPickImage: async function () {
            if (!requireLogin()) return;
            if (!window.ChatPhoto || typeof window.ChatPhoto.pickAndUpload !== "function") {
              showStatus("이미지 기능이 준비되지 않았어요.");
              return;
            }
            try {
              showStatus("이미지 준비 중...");
              var result2 = await window.ChatPhoto.pickAndUpload({
                capture: false,
                size: 480,
                quality: 0.78,
                user_id: myId || "",
                nickname: getSafeNickname()
              });
              if (!result2 || !result2.url) {
                showStatus("이미지 업로드에 실패했어요.");
                return;
              }
              sendImageMessage(result2.url);
            } catch (e2) {
              console.warn("[messenger] pick image error:", e2);
              showStatus("이미지 전송에 실패했어요.");
            }
          },
          onPickFile: async function () {
            if (!requireLogin()) return;
            if (!window.ChatFile || typeof window.ChatFile.pickAndUpload !== "function") {
              showStatus("파일 기능이 준비되지 않았어요.");
              return;
            }
            try {
              showStatus("파일 준비 중...");
              var fr = await window.ChatFile.pickAndUpload({
                maxBytes: 5 * 1024 * 1024,
                user_id: myId || "",
                nickname: getSafeNickname()
              });
              if (!fr || !fr.url) {
                showStatus("파일 업로드에 실패했어요.");
                return;
              }
              sendFileMessage(fr.url, fr.filename, fr.mime, fr.size);
            } catch (e3) {
              console.warn("[messenger] file error:", e3);
              if (String(e3 && e3.message || "").indexOf("file too large") >= 0) {
                showStatus("파일은 5MB를 넘길 수 없어요.");
              } else {
                showStatus("파일 전송에 실패했어요.");
              }
            }
          },
          getNotifyLabel: function () { return NotifySetting.getMenuLabel(); },
          onToggleNotify: function () { NotifySetting.toggle(showStatus); },
          onLogout: function () {
            // iframe 내부 → 부모(index.html)로 로그아웃 요청
            try {
              // 1) 같은 출처라면 부모 전역 함수 직접 호출
              if (window.parent && typeof window.parent.logoutGhostUser === "function") {
                window.parent.logoutGhostUser();
              }
              if (window.parent && typeof window.parent.openLoginPanel === "function") {
                // 로그아웃 후 바로 로그인창 띄우기
                window.parent.openLoginPanel();
              }
            } catch (e) {}

            // 2) postMessage fallback (file:// 등 환경)
            try {
              if (window.parent && window.parent.postMessage) {
                window.parent.postMessage({ type: "WG_LOGOUT" }, "*");
              }
            } catch (e2) {}

            // 3) 현재 iframe 상태도 즉시 잠그기
            try {
              localStorage.removeItem("ghostUser");
            } catch (e3) {}
            myId = null;
            myNickname = null;
            showStatus("로그아웃 되었어요.");
          }
        });
    }
  }

    function sendImageMessage(imageUrl) {
    if (!imageUrl) return;
    if (!requireLogin()) return;

    if (!currentRoomId) {
      showStatus("상단 왼쪽 '대화방' 버튼을 눌러 방을 선택해 주세요.");
      return;
    }

    var now = Date.now();
    var token = "[[IMG]]" + imageUrl;

    // 낙관적 렌더
    var __mid = "mimg_" + now + "_" + Math.random().toString(16).slice(2);
    var __localKey = "local_img_" + __mid;
    var __localMsg = {
      key: __localKey,
      mid: __mid,
      user_id: myId || "",
      nickname: getSafeNickname(),
      type: "image",
      image_url: imageUrl,
      text: "",
      ts: now,
      room_id: currentRoomId || "",
      _local: true
    };

    try {
      messages.push(__localMsg);
      if (messages.length > MAX_BUFFER) messages.splice(0, messages.length - MAX_BUFFER);
      appendNewMessage(__localMsg);
      if (window.SignalBus && typeof window.SignalBus.markSeenTs === "function") {
        window.SignalBus.markSeenTs(currentRoomId || "", now);
      }
      if (window.SignalBus && typeof window.SignalBus.markMyTs === "function") {
        window.SignalBus.markMyTs(currentRoomId || "", now);
      }
    } catch (e0) {}

    // (B안) Firebase signals 큐로 즉시 중계
    try {
      __rememberRelay(__mid);
      if (window.SignalBus && typeof window.SignalBus.push === "function") {
        window.SignalBus.push(currentRoomId || "", {
          kind: "chat",
          mid: __mid,
          room_id: currentRoomId || "",
          user_id: myId || "",
          nickname: getSafeNickname(),
          text: token,
          ts: now
        });
      }
    } catch (eRelay) {}

    // Firebase 이미지 메시지 저장
    try {
      var __fbPathImg = getFirebasePath(currentRoomId);
      var __fbDbImg = ensureFirebase();
      if (__fbDbImg && __fbPathImg) {
        __fbDbImg.ref(__fbPathImg).push({
          mid: __mid, user_id: myId || "", nickname: getSafeNickname(),
          text: "", type: "image", url: imageUrl, image_url: imageUrl,
          ts: now, room_id: currentRoomId || ""
        }).catch(function (e) {
          console.warn("[messenger] Firebase 이미지 저장 실패:", e.message || e);
        });
      }
    } catch (eFbImg) {}

    try {
      if (typeof window.postToSheet !== "function") throw new Error("postToSheet missing");

      window.postToSheet({
        mode: "social_chat_room",
        room_id: currentRoomId || "",
        mid: __mid,
        user_id: myId || "",
        nickname: getSafeNickname(),
        message: token,
        text: token,
        ts: now
      }).then(function (res) {
        if (!res || !res.ok) console.warn("[messenger] 이미지 시트 백업 응답 이상(무시)");
      }).catch(function (err) {
        console.warn("[messenger] 이미지 시트 백업 실패(무시):", err);
      });
    } catch (e) {
      console.warn("[messenger] 이미지 시트 백업 예외(무시):", e);
    }
  }

    function sendFileMessage(fileUrl, fileName, fileMime, fileSize) {
    if (!fileUrl) return;
    if (!requireLogin()) return;

    if (!currentRoomId) {
      showStatus("상단 왼쪽 '대화방' 버튼을 눌러 방을 선택해 주세요.");
      return;
    }

    var now = Date.now();

    var safeName = "";
    try { safeName = encodeURIComponent(String(fileName || "파일")); } catch (e2) { safeName = String(fileName || "파일"); }
    var token = "[[FILE]]" + fileUrl + "|" + safeName;

    // 낙관적 렌더
    var __mid = "mfile_" + now + "_" + Math.random().toString(16).slice(2);
    var __localKey = "local_file_" + __mid;
    var __localMsg = {
      key: __localKey,
      mid: __mid,
      user_id: myId || "",
      nickname: getSafeNickname(),
      type: "file",
      file_url: fileUrl,
      file_name: fileName || "파일",
      file_mime: fileMime || "application/octet-stream",
      file_size: fileSize || 0,
      text: "",
      ts: now,
      room_id: currentRoomId || "",
      _local: true
    };

    try {
      messages.push(__localMsg);
      if (messages.length > MAX_BUFFER) messages.splice(0, messages.length - MAX_BUFFER);
      appendNewMessage(__localMsg);
      if (window.SignalBus && typeof window.SignalBus.markSeenTs === "function") {
        window.SignalBus.markSeenTs(currentRoomId || "", now);
      }
      if (window.SignalBus && typeof window.SignalBus.markMyTs === "function") {
        window.SignalBus.markMyTs(currentRoomId || "", now);
      }
    } catch (e0) {}

    // (B안) Firebase signals 큐로 즉시 중계
    try {
      __rememberRelay(__mid);
      if (window.SignalBus && typeof window.SignalBus.push === "function") {
        window.SignalBus.push(currentRoomId || "", {
          kind: "chat",
          mid: __mid,
          room_id: currentRoomId || "",
          user_id: myId || "",
          nickname: getSafeNickname(),
          text: token,
          ts: now
        });
      }
    } catch (eRelay) {}

    // Firebase 파일 메시지 저장
    try {
      var __fbPathFile = getFirebasePath(currentRoomId);
      var __fbDbFile = ensureFirebase();
      if (__fbDbFile && __fbPathFile) {
        __fbDbFile.ref(__fbPathFile).push({
          mid: __mid, user_id: myId || "", nickname: getSafeNickname(),
          text: "", type: "file", url: fileUrl, file_url: fileUrl,
          fileName: fileName || "", file_name: fileName || "",
          ts: now, room_id: currentRoomId || ""
        }).catch(function (e) {
          console.warn("[messenger] Firebase 파일 저장 실패:", e.message || e);
        });
      }
    } catch (eFbFile) {}

    try {
      if (typeof window.postToSheet !== "function") throw new Error("postToSheet missing");

      window.postToSheet({
        mode: "social_chat_room",
        room_id: currentRoomId || "",
        mid: __mid,
        user_id: myId || "",
        nickname: getSafeNickname(),
        message: token,
        text: token,
        ts: now
      }).then(function (res) {
        if (!res || !res.ok) console.warn("[messenger] 파일 시트 백업 응답 이상(무시)");
      }).catch(function (err) {
        console.warn("[messenger] 파일 시트 백업 실패(무시):", err);
      });
    } catch (e) {
      console.warn("[messenger] 파일 시트 백업 예외(무시):", e);
    }
  }


  function clearChatView() {
    try {
      if (bodyEl) bodyEl.innerHTML = "";
    } catch (e) {}
    messages = [];
    lastKey = null;
    _lastRenderedDateKey = null;
  }

  function switchRoom(roomId, meta) {
    roomId = (roomId === undefined || roomId === null) ? "" : String(roomId);
    roomId = roomId.trim();

    currentRoomId = roomId || null;
    currentRoomMeta = meta || null;

    // 방이 선택되지 않았으면: 리스너/뷰 초기화만
    if (!currentRoomId) {
      stopListen();
      clearChatView();
      showStatus("상단 왼쪽 '대화방' 버튼을 눌러 방을 선택해 주세요.");
      try {
        if (window.RoomGuard && typeof window.RoomGuard.renderNoRoomHint === "function") {
          window.RoomGuard.renderNoRoomHint(bodyEl);
        }
      } catch (eHint) {}
      try {
        var titleEl0 = document.getElementById("roomTitle");
        if (titleEl0) titleEl0.textContent = "대화방";
      } catch (e0) {}
      return;
    }

    // 방 입장: lastSeenTs 갱신(알림 오탐 방지)
    try {
      if (window.SignalBus && typeof window.SignalBus.markSeenTs === "function") {
        window.SignalBus.markSeenTs(currentRoomId, Date.now());
      }
    } catch (e1) {}

    // Firebase ref 갱신
    stopListen();
    try {
      var db0 = ensureFirebase();
      if (db0 && db) {
        var p = getFirebasePath(currentRoomId);
        ref = p ? db.ref(p) : null;
      }
    } catch (e2) {}

    clearChatView();
    // Firebase에서 먼저 빠르게 로딩 (구독 시작)
    startFirebaseMsgListen(currentRoomId);

    // 방 입장 → 미확인 배지 초기화
    try {
      if (window.PwaManager) window.PwaManager.clearUnread(currentRoomId);
      window.dispatchEvent(new CustomEvent("ghost:room-entered", { detail: { roomId: currentRoomId } }));
    } catch (eBadge) {}

    // 구글 시트 백업 로딩: Firebase에서 아무것도 못 받았을 때만 (3초 대기 후 판단)
    var _roomForSheet = currentRoomId;
    setTimeout(function () {
      if (currentRoomId !== _roomForSheet) return; // 방이 바뀌면 스킵
      if (messages.length > 0) return; // Firebase에서 이미 불러왔으면 스킵
      loadRecentFromSheet(_roomForSheet); // Firebase 데이터 없을 때만 시트 폴백
    }, 3000);

    // 상단 상태
    try {
      var titleEl = document.getElementById("roomTitle");
      if (titleEl && meta && meta.name) titleEl.textContent = meta.name;
    } catch (e3) {}
  }

  // chat-rooms.js 에서 방이 바뀔 때 호출
  try {
    window.__onRoomChanged = function (roomId, meta) {
      switchRoom(roomId, meta);
    };
  } catch (e) {}
  function init() {
    bodyEl = document.getElementById("messengerBody");
    statusEl = document.getElementById("msgStatus");
    msgInput = document.getElementById("msgInput");
    sendBtn = document.getElementById("msgSendBtn");

    loadUserFromStorage();

    // (알림음 정책) 첫 터치/클릭 이후에만 소리 재생 가능 → 미리 바인딩
    NotifySound.bindUserGesture(document);
    // signals 알림(방별 reply 감지) 초기화
    try {
      if (window.SignalBus && typeof window.SignalBus.attach === "function") {
        ensureAnonAuth().then(function () {
          try {
            var db0 = ensureFirebase();
            if (db0) {
              window.SignalBus.attach({
                db: db0,
                getMyId: function () { return myId || ""; },
                onSignal: function (info) {
                  // 큐 기반 중계(onMessage)가 기본. onSignal은 fallback 용도로만 남깁니다.
                },
                onMessage: function (msgInfo) {
                  try { __applyRelayMessage(msgInfo); } catch (e) {}
                },
                onNotify: function (info) {
                  // 현재 열려있는 방이면 알림 생략
                  if (info && info.roomId && currentRoomId && info.roomId === currentRoomId) return;


// 방문(입장)하지 않은 방은 알림/소리/점 표시를 하지 않음
try {
  if (!isVisitedRoomForNotify(info.roomId)) return;
} catch (eV) {}

                  // 방 목록에 "새 글"(미확인) 표시
                  try {
                    if (window.RoomUnreadBadge && typeof window.RoomUnreadBadge.mark === "function") {
                      window.RoomUnreadBadge.mark(info.roomId, info.ts);
                    }
                  } catch (eBadge) {}

                  if (NotifySetting && NotifySetting.isEnabled && NotifySetting.isEnabled()) {
                    NotifySound.playDdiring();
                    if (NotifySetting.maybeShow) {
                      NotifySetting.maybeShow({
                        room_id: info.roomId,
                        user_id: info.user_id,
                        ts: info.ts,
                        nickname: "알림",
                        text: "새 메시지"
                      });
                    }
                  }
                }
              });
            }
          } catch (e2) {}
        }).catch(function () {});
      }
    } catch (e) {}

attachEvents();

    initImageZoom();

    // 대화방 초기화
    // - 방 목록은 "방 목록 패널을 열 때만" 서버에서 갱신합니다.
    // - 현재 방은 localStorage(ghostActiveRoomId/Name) 기반으로 복원합니다.
    try {
      if (window.ChatRooms && typeof window.ChatRooms.init === "function") {
        window.ChatRooms.init(); // 여기서는 목록 API를 호출하지 않음
      }
    } catch (e0) {}

        var initialRoomId = "";
    var initialRoomName = "";
    try {
      var rid = localStorage.getItem("ghostActiveRoomId");
      var rname = localStorage.getItem("ghostActiveRoomName");
      if (rid && String(rid).trim()) initialRoomId = String(rid).trim();
      if (rname && String(rname).trim()) initialRoomName = String(rname).trim();
    } catch (e1) {}

    // 저장된 방이 있으면 그 방으로, 없으면 기본 '전체 대화방(global)'로 접속
    if (!initialRoomId) {
      initialRoomId = "global";
      if (!initialRoomName) initialRoomName = "전체 대화방";
    }

    switchRoom(initialRoomId, { room_id: initialRoomId, name: initialRoomName || (initialRoomId === "global" ? "전체 대화방" : "대화방"), is_global: (initialRoomId === "global"), can_leave: (initialRoomId !== "global") });

    // 시작 시 현재 방은 이미 보고 있는 상태로 간주 → 미확인 표시 제거
    try {
      if (window.RoomUnreadBadge && typeof window.RoomUnreadBadge.clear === "function") {
        window.RoomUnreadBadge.clear(initialRoomId);
      }
    } catch (eBadgeInit) {}

    // 프로필 매니저: 기어버튼 삽입 + 배경 복원
    try {
      if (window.ProfileManager) {
        if (typeof window.ProfileManager.applyBackground === "function") {
          var _me = myNickname || "";
          if (_me) window.ProfileManager.applyBackground(_me);
        }
      }
    } catch (ePm) {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    setTimeout(init, 0);
  }
})();