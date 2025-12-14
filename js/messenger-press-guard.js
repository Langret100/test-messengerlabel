/* ============================================================
   [messenger-press-guard.js] 메신저 버튼 롱프레스/우클릭 메뉴 방지
   ------------------------------------------------------------
   - 메신저 입력창의 버튼(😊 / + / 보내기)과 + 첨부 메뉴 버튼을
     '꾹 누르기(롱프레스)' 또는 마우스 우클릭 시
     파란 하이라이트(탭 하이라이트) 및 컨텍스트 메뉴가 뜨는 현상을
     기능 손상 없이 최소 범위로 차단합니다.
   - 일반 탭/클릭 동작(전송/패널 열기 등)은 그대로 유지합니다.

   [적용 대상]
   - games/social-messenger.html 의 .messenger-input-bar 내부 버튼
   - + 첨부 메뉴(.msg-attach-menu) 내부 버튼(.msg-attach-item)

   [제거 시 함께 삭제/정리할 요소]
   1) js/messenger-press-guard.js
   2) games/social-messenger.html 의 <script src="../js/messenger-press-guard.js"></script>
   ============================================================ */

(function () {
  if (window.__WG_MESSENGER_PRESS_GUARD__) return;
  window.__WG_MESSENGER_PRESS_GUARD__ = true;

  var TARGET_SELECTOR = [
    ".messenger-input-bar button",
    ".msg-attach-menu .msg-attach-item"
  ].join(",");

  function ensureStyleOnce() {
    if (document.getElementById("wgPressGuardStyle")) return;
    var style = document.createElement("style");
    style.id = "wgPressGuardStyle";
    style.textContent = [
      TARGET_SELECTOR + "{",
      "-webkit-tap-highlight-color: transparent;",
      "-webkit-touch-callout: none;",
      "-webkit-user-select: none;",
      "user-select: none;",
      "touch-action: manipulation;",
      "}",
      TARGET_SELECTOR + ":focus{outline:none;}"
    ].join("");
    document.head.appendChild(style);
  }

  function isTarget(el) {
    try {
      if (!el) return false;
      var t = el.closest ? el.closest(TARGET_SELECTOR) : null;
      return !!t;
    } catch (e) {
      return false;
    }
  }

  function bind() {
    ensureStyleOnce();

    // 컨텍스트 메뉴(롱프레스/우클릭) 차단: 버튼에서만
    document.addEventListener(
      "contextmenu",
      function (e) {
        if (!isTarget(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
      },
      true
    );

    // 롱프레스 중 텍스트 선택/드래그 시도 방지(버튼에서만)
    document.addEventListener(
      "selectstart",
      function (e) {
        if (!isTarget(e.target)) return;
        e.preventDefault();
      },
      true
    );

    document.addEventListener(
      "dragstart",
      function (e) {
        if (!isTarget(e.target)) return;
        e.preventDefault();
      },
      true
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
