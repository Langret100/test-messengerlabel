/* ============================================================
   [pwa-manager.js] PWA 설치 + 앱 배지 관리
   ------------------------------------------------------------
   - Service Worker 등록
   - 홈화면 추가 버튼 (프로필 설정 모달에서 호출)
   - 앱 배지: 내가 들어간 방에 새 글 오면 카톡처럼 빨간 숫자
   - 배지 카운트: localStorage로 방별 미확인 수 관리
   ============================================================ */

(function () {
  if (window.PwaManager) return;

  var SW_PATH = "../sw.js";
  var SW_SCOPE = "../";
  var LS_UNREAD = "ghostUnreadCounts_v1";  // { roomId: count }
  var swReg = null;
  var deferredPrompt = null; // beforeinstallprompt 이벤트

  /* ── Service Worker 등록 ── */
  function registerSW() {
    if (!("serviceWorker" in navigator)) return Promise.resolve(null);
    return navigator.serviceWorker.register(SW_PATH, { scope: SW_SCOPE })
      .then(function (reg) {
        swReg = reg;
        return reg;
      })
      .catch(function (e) {
        console.warn("[PWA] SW 등록 실패:", e.message || e);
        return null;
      });
  }

  /* ── 홈화면 추가 가능 여부 ── */
  function canInstall() {
    return !!deferredPrompt;
  }

  /* ── 홈화면 추가 요청 ── */
  function install() {
    if (!deferredPrompt) {
      // iOS Safari: 직접 안내 (beforeinstallprompt 없음)
      if (/iphone|ipad|ipod/i.test(navigator.userAgent)) {
        showIosInstallGuide();
        return Promise.resolve("ios_guide");
      }
      return Promise.resolve("not_available");
    }
    deferredPrompt.prompt();
    return deferredPrompt.userChoice.then(function (result) {
      deferredPrompt = null;
      return result.outcome; // "accepted" | "dismissed"
    });
  }

  /* iOS Safari 설치 안내 */
  function showIosInstallGuide() {
    var existing = document.getElementById("iosInstallGuide");
    if (existing) { existing.style.display = "flex"; return; }

    var box = document.createElement("div");
    box.id = "iosInstallGuide";
    box.style.cssText = [
      "position:fixed;bottom:0;left:0;right:0;z-index:9999;",
      "background:#1e293b;color:#fff;padding:16px 20px 28px;",
      "border-radius:20px 20px 0 0;display:flex;flex-direction:column;gap:10px;",
      "box-shadow:0 -4px 30px rgba(0,0,0,0.35);"
    ].join("");
    box.innerHTML = [
      "<div style='display:flex;justify-content:space-between;align-items:center;'>",
      "  <span style='font-size:15px;font-weight:800;'>📱 홈화면에 추가하기</span>",
      "  <button onclick=\"document.getElementById('iosInstallGuide').remove()\" style='border:0;background:transparent;color:#94a3b8;font-size:20px;cursor:pointer;'>✕</button>",
      "</div>",
      "<div style='font-size:13px;color:#cbd5e1;line-height:1.6;'>",
      "  <b>Safari</b>에서 아래 버튼을 탭하세요:<br>",
      "  <span style='font-size:16px;'>⬆️</span> <b>공유 버튼</b> → <b>홈 화면에 추가</b>",
      "</div>",
      "<div style='display:flex;justify-content:center;margin-top:4px;'>",
      "  <div style='width:40px;height:4px;border-radius:2px;background:#475569;'></div>",
      "</div>"
    ].join("");
    document.body.appendChild(box);
  }

  /* ── 앱 배지 (미확인 메시지 수) ── */

  function getUnreadCounts() {
    try { return JSON.parse(localStorage.getItem(LS_UNREAD) || "{}"); } catch (e) { return {}; }
  }
  function saveUnreadCounts(obj) {
    try { localStorage.setItem(LS_UNREAD, JSON.stringify(obj || {})); } catch (e) {}
  }

  /* 특정 방 미확인 수 증가 */
  function incrementUnread(roomId) {
    if (!roomId) return;
    var counts = getUnreadCounts();
    counts[roomId] = (counts[roomId] || 0) + 1;
    saveUnreadCounts(counts);
    _applyBadge();
    _updateRoomBadgeUI(roomId, counts[roomId]);
  }

  /* 특정 방 미확인 초기화 (입장 시) */
  function clearUnread(roomId) {
    if (!roomId) return;
    var counts = getUnreadCounts();
    delete counts[roomId];
    saveUnreadCounts(counts);
    _applyBadge();
    _updateRoomBadgeUI(roomId, 0);
  }

  /* 전체 미확인 수 합산 */
  function getTotalUnread() {
    var counts = getUnreadCounts();
    return Object.keys(counts).reduce(function (sum, k) { return sum + (counts[k] || 0); }, 0);
  }

  /* 앱 배지 실제 적용 */
  function _applyBadge() {
    var total = getTotalUnread();
    // 1) SW를 통한 앱 배지 (PWA 설치 상태일 때 앱 아이콘에 표시)
    if (swReg && swReg.active) {
      try {
        swReg.active.postMessage({ type: "SET_BADGE", count: total });
      } catch (e) {}
    }
    // 2) 직접 API (일부 브라우저)
    try {
      if (navigator.setAppBadge) {
        total > 0 ? navigator.setAppBadge(total) : navigator.clearAppBadge();
      }
    } catch (e) {}
    // 3) 탭 타이틀에도 표시
    try {
      var base = "마이메신저";
      document.title = total > 0 ? ("(" + total + ") " + base) : base;
    } catch (e) {}
  }

  /* 방 목록 아이템의 배지 UI 갱신 */
  function _updateRoomBadgeUI(roomId, count) {
    try {
      var items = document.querySelectorAll('[data-room-id="' + roomId + '"]');
      items.forEach(function (item) {
        // 기존 RoomUnreadBadge가 만든 요소 재활용, 없으면 새로 생성
        var badge = item.querySelector(".room-unread-badge");
        if (!badge) {
          badge = document.createElement("span");
          badge.className = "room-unread-badge";
          item.appendChild(badge);
        }
        if (count > 0) {
          badge.textContent = count > 99 ? "99+" : String(count);
          badge.classList.add("show");
        } else {
          badge.textContent = "";
          badge.classList.remove("show");
        }
      });
    } catch (e) {}
  }

  /* 모든 방 배지 UI 복원 (페이지 로드 시) */
  function restoreAllBadgeUI() {
    var counts = getUnreadCounts();
    Object.keys(counts).forEach(function (roomId) {
      _updateRoomBadgeUI(roomId, counts[roomId]);
    });
    _applyBadge();
  }

  /* ── 초기화 ── */
  function init() {
    // Service Worker 등록
    registerSW().then(function () {
      restoreAllBadgeUI();
    });

    // beforeinstallprompt 캐치 (Android Chrome 등)
    window.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();
      deferredPrompt = e;
      // 설치 버튼 활성화
      var btn = document.getElementById("pwaInstallBtn");
      if (btn) btn.style.display = "flex";
    });

    // 앱 설치 완료
    window.addEventListener("appinstalled", function () {
      deferredPrompt = null;
      var btn = document.getElementById("pwaInstallBtn");
      if (btn) btn.style.display = "none";
    });

    // 현재 방 입장 시 미확인 초기화 이벤트 리스닝
    window.addEventListener("ghost:room-entered", function (ev) {
      try {
        var roomId = ev.detail && ev.detail.roomId ? ev.detail.roomId : "";
        if (roomId) clearUnread(roomId);
      } catch (e) {}
    });
  }

  window.PwaManager = {
    install:          install,
    canInstall:       canInstall,
    incrementUnread:  incrementUnread,
    clearUnread:      clearUnread,
    getTotalUnread:   getTotalUnread,
    restoreAllBadgeUI: restoreAllBadgeUI,
    registerSW:       registerSW
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    setTimeout(init, 0);
  }
})();
