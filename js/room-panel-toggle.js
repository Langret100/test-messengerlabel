/* ============================================================
   [room-panel-toggle.js] 상단바 "현재 대화방" 버튼으로 방 목록 토글
   ------------------------------------------------------------
   - 상단바(로고 왼쪽)에 현재 보고 있는 대화방 이름을 버튼처럼 표시
   - 버튼을 누를 때만 대화방 목록(roomPanel)이 슬라이드로 열리고,
     닫혀 있으면 채팅창을 넓게 볼 수 있음
   - roomTitle(#roomTitle) 변경을 감지해 버튼 라벨을 자동 동기화

   [제거 시 함께 삭제/정리할 요소]
   1) games/social-messenger.html 의 #topRoomBtn(버튼), #roomBackdrop(배경)
   2) games/social-messenger.html 의 .messenger-topbar-roombtn / .room-backdrop /
      .room-panel.open 관련 CSS
   3) games/social-messenger.html 의 room-panel-toggle.js include
   ============================================================ */

(function () {
  var btn = null;
  var panel = null;
  var backdrop = null;
  var listEl = null;
  var titleEl = null;

  function getTitleText() {
    try {
      var t = (titleEl && titleEl.textContent) ? String(titleEl.textContent).trim() : "";
      return t || "대화방";
    } catch (e) {}
    return "대화방";
  }

  function syncButtonLabel() {
    if (!btn) return;
    try {
      // textContent로 넣어야 ::after(▾)가 유지됨
      btn.textContent = getTitleText();
    } catch (e) {}
  }

  function isMobile() {
    return window.innerWidth <= 600;
  }

  function openPanel() {
    if (!isMobile()) return; // 데스크탑은 항상 열려있음
    if (panel) panel.classList.add("open");
    if (backdrop) backdrop.classList.add("open");
    if (btn) btn.setAttribute("aria-expanded", "true");
    try {
      if (window.ChatRooms && typeof window.ChatRooms.reload === "function") {
        window.ChatRooms.reload();
      }
    } catch (e) {}
  }

  function closePanel() {
    if (!isMobile()) return;
    if (panel) panel.classList.remove("open");
    if (backdrop) backdrop.classList.remove("open");
    if (btn) btn.setAttribute("aria-expanded", "false");
  }

  function togglePanel() {
    if (!isMobile()) return;
    if (!panel) return;
    if (panel.classList.contains("open")) closePanel();
    else openPanel();
  }

  function bindAutoCloseOnRoomPick() {
    if (!listEl) return;
    listEl.addEventListener("click", function (ev) {
      var node = ev && ev.target ? ev.target : null;
      while (node && node !== listEl) {
        if (node.classList && node.classList.contains("room-item")) {
          closePanel();
          return;
        }
        node = node.parentNode;
      }
    });
  }

  function bindTitleObserver() {
    if (!titleEl || typeof MutationObserver === "undefined") return;
    try {
      var obs = new MutationObserver(function () {
        syncButtonLabel();
      });
      obs.observe(titleEl, { childList: true, characterData: true, subtree: true });
    } catch (e) {}
  }

  function init() {
    btn = document.getElementById("topRoomBtn");
    panel = document.getElementById("roomPanel");
    backdrop = document.getElementById("roomBackdrop");
    listEl = document.getElementById("roomList");
    titleEl = document.getElementById("roomTitle");

    if (!panel) return;

    // 데스크탑: 패널 항상 열림 상태 유지 (open 클래스 불필요 - flex layout)
    // 모바일: 기본 닫힘
    if (isMobile()) {
      if (panel) panel.classList.remove("open");
      if (backdrop) backdrop.classList.remove("open");
    }

    syncButtonLabel();

    if (btn) btn.addEventListener("click", togglePanel);
    if (backdrop) backdrop.addEventListener("click", closePanel);

    document.addEventListener("keydown", function (e) {
      if (!e) return;
      if (e.key === "Escape") closePanel();
    });

    bindAutoCloseOnRoomPick();
    bindTitleObserver();

    // 시작 시 방 목록 즉시 로드
    try {
      if (window.ChatRooms && typeof window.ChatRooms.reload === "function") {
        window.ChatRooms.reload();
      }
    } catch (e) {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    setTimeout(init, 0);
  }
})();
