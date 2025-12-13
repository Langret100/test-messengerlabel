/* ============================================================
   [messenger-only.js] 메신저 전용 진입/상태 감지 스크립트
   ------------------------------------------------------------
   - index.html에서 로드되며, 로그인 상태(ghostUser)를 감지해
     games/social-messenger.html(iframe)로 자동 진입/리로드를 처리합니다.
   - 메신저를 '닫기' 상태로 전환하는 오버레이(#closedOverlay) UI도 함께 관리합니다.

   [제거 시 함께 삭제/정리할 요소]
   1) index.html 에서 <script src="js/messenger-only.js"></script> 제거
   2) index.html 의 #messengerFrame / #closedOverlay / #reopenBtn 관련 HTML/CSS
   3) (선택) login.js 의 openLoginPanel() 호출 흐름(메신저 전용 진입 로직) 정리
   ============================================================ */

(function () {
  var frame, closedOverlay, reopenBtn;
  var lastUserId = null;

  function safeParseUser() {
    try {
      var raw = localStorage.getItem("ghostUser");
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || !obj.user_id) return null;
      return obj;
    } catch (e) {
      return null;
    }
  }

  function setCurrentUserFromStorage() {
    var u = safeParseUser();
    if (u) {
      window.currentUser = u;
      lastUserId = u.user_id;
    } else {
      // 저장된 사용자가 없으면 현재 사용자도 비움(로그인 패널 노출 보장)
      window.currentUser = null;
      lastUserId = null;
    }
  }

  function openMessenger(forceReload) {
    if (!frame) return;
    closedOverlay && closedOverlay.classList.remove("open");

    var target = "games/social-messenger.html";
    if (forceReload) {
      try {
        frame.src = "about:blank";
      } catch (e) {}
      setTimeout(function () {
        frame.src = target;
      }, 30);
      return;
    }

    if (!frame.src || frame.src === "about:blank" || frame.src.endsWith("/about:blank")) {
      frame.src = target;
    }
  }

  function closeMessenger() {
    if (!frame) return;
    try { frame.src = "about:blank"; } catch (e) {}
    closedOverlay && closedOverlay.classList.add("open");
  }

  // messenger-close-bridge.js 가 보내는 메시지 수신
  function onMessage(ev) {
    var data = ev && ev.data;
    if (!data) return;
    if (data.type === "WG_EXIT_GAME") {
      closeMessenger();
    }
  }

  // iframe 내부에서 부모로 exitGame 직접 호출하는 경우 대응
  window.exitGame = closeMessenger;

  function startLoginWatch() {
    // login.js 는 자체적으로 패널을 띄우고, 성공 시 localStorage에 ghostUser 저장
    // → 이를 감지해서 iframe을 리로드해 myId를 반영
    setInterval(function () {
      var u = safeParseUser();
      var uid = u && u.user_id ? String(u.user_id) : null;

      if (uid && uid !== lastUserId) {
        setCurrentUserFromStorage();
        // 로그인 직후에는 메신저를 새로 로드해서 입력/전송이 바로 되게
        openMessenger(true);
      }
    }, 400);
  }

  function init() {
    frame = document.getElementById("messengerFrame");
    closedOverlay = document.getElementById("closedOverlay");
    reopenBtn = document.getElementById("reopenBtn");

    setCurrentUserFromStorage();
    openMessenger(false);

    // 비로그인 상태라면, 로그인 패널을 확실히 띄움(로드 순서/브라우저 차이 대비)
    setTimeout(function () {
      try {
        if (!safeParseUser() && typeof window.openLoginPanel === "function") {
          window.openLoginPanel();
        }
      } catch (e) {}
    }, 60);

    window.addEventListener("message", onMessage);

    if (reopenBtn) {
      reopenBtn.addEventListener("click", function () {
        openMessenger(true);
        // 로그인 안 했으면 로그인 패널이 자동으로 뜨도록
        try {
          if (!safeParseUser() && typeof window.openLoginPanel === "function") {
            window.openLoginPanel();
          }
        } catch (e) {}
      });
    }

    startLoginWatch();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
