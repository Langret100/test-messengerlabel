/* ============================================================
   [messenger-close-bridge.js] (옵션) iframe 닫기 브릿지
   ------------------------------------------------------------
   - games/social-messenger.html 안의 X 버튼 클릭 시,
     부모(index.html)의 오버레이 종료(exitGame)로 안전하게 연결합니다.
   - 같은 출처 호출이 막히는 환경(file://, null origin 등)에서는 postMessage로 우회합니다.

   [제거 시 함께 삭제/정리할 요소]
   1) games/social-messenger.html 에서 <script src="../js/messenger-close-bridge.js"></script> 제거
   2) games/social-messenger.html 의 닫기 버튼(#topCloseBtn) 동작이
      부모 종료 로직에 의존하는 경우, 대체 동작(예: window.close) 확인
   ============================================================ */

(function(){
  function requestClose(){
    // 1) 같은 출처에서 가능한 경우: 부모의 exitGame 직접 호출
    try{
      if (window.parent && typeof window.parent.exitGame === "function"){
        window.parent.exitGame();
        return;
      }
    }catch(e){}

    // 2) postMessage 방식 (file://, null origin 등 환경에서도 동작하도록)
    try{
      if (window.parent && window.parent.postMessage){
        window.parent.postMessage({ type: "WG_EXIT_GAME" }, "*");
        return;
      }
    }catch(e){}

    // 3) 마지막 fallback: top으로도 시도
    try{
      if (window.top && window.top.postMessage){
        window.top.postMessage({ type: "WG_EXIT_GAME" }, "*");
      }
    }catch(e){}
  }

  function bind(){
    const btn = document.getElementById("topCloseBtn");
    if (!btn) return;
    btn.addEventListener("click", function(ev){
      ev.preventDefault();
      requestClose();
    });
  }

  if (document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }

  // 필요 시 다른 스크립트에서도 호출할 수 있도록 노출
  window.requestMessengerClose = requestClose;
})();
