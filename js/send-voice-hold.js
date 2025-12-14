/* ============================================================
   [send-voice-hold.js] 보내기 버튼 '꾹 누르기' 음성→텍스트→자동 전송
   ------------------------------------------------------------
   - #msgSendBtn을 짧게 누르면 기존처럼 텍스트 전송(기존 click 핸들러 유지)
   - '꾹 누르기'(기본 450ms) 시 Web Speech API로 음성인식을 시작하고,
     손을 떼면 인식을 종료한 뒤(=끝까지 듣고)
     인식된 텍스트를 메시지로 자동 전송합니다.
   - 버튼 라벨(보내기)은 바꾸지 않습니다.

   [제거 시 함께 삭제/정리할 요소]
   1) games/social-messenger.html 에서 본 스크립트 include 제거
      - <script src="../js/send-voice-hold.js"></script>
   ============================================================ */

(function () {
  var HOLD_MS = 450;

  function toast(text) {
    try {
      var el = document.getElementById("msgStatus");
      if (!el) return;
      el.textContent = text || "";
      el.classList.add("show");
      clearTimeout(el.__toastTimer);
      el.__toastTimer = setTimeout(function () {
        el.classList.remove("show");
      }, 1200);
    } catch (e) {}
  }

  function getRecognitionCtor() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  function bind() {
    var sendBtn = document.getElementById("msgSendBtn");
    var inputEl = document.getElementById("msgInput");
    if (!sendBtn || !inputEl) return;

    var Rec = getRecognitionCtor();
    var recognition = null;
    var holding = false;
    var holdTimer = null;
    var voiceActive = false;
    var ignoreNextClick = false;
    var allowSyntheticClick = false;
    var baseText = "";
    var lastMergedText = "";
    var finalText = "";
    var interimText = "";
    var recognizedSomething = false;
    var hadError = false;

    function startVoice() {
      if (!Rec) {
        toast("이 브라우저는 음성인식을 지원하지 않아요.");
        return;
      }

      // 새 인스턴스로 시작(일부 환경에서 재사용 시 오류 방지)
      try {
        recognition = new Rec();
      } catch (e) {
        toast("음성인식을 시작할 수 없어요.");
        return;
      }

      voiceActive = true;
      ignoreNextClick = true;
      hadError = false;
      recognizedSomething = false;
      finalText = "";
      interimText = "";
      baseText = (inputEl.value || "");
      lastMergedText = baseText;

      toast("🎤 듣는 중… (손을 떼면 전송)");

      try {
        recognition.lang = "ko-KR";
        recognition.interimResults = true;
        recognition.continuous = true;
      } catch (e) {}

      recognition.onresult = function (event) {
        try {
          interimText = "";
          for (var i = event.resultIndex; i < event.results.length; i++) {
            var res = event.results[i];
            if (!res || !res[0]) continue;
            var txt = String(res[0].transcript || "").trim();
            if (!txt) continue;
            if (res.isFinal) {
              finalText += (finalText ? " " : "") + txt;
              recognizedSomething = true;
            } else {
              interimText += (interimText ? " " : "") + txt;
            }
          }

          // interim만 들어오는 환경에서도 '인식 내용 있음'으로 취급
          if (interimText) recognizedSomething = true;

          // 입력창에는 interim+final을 미리 보여줌(확정되면 final로 정리)
          var base = inputEl.__voiceBaseText;
          if (typeof base !== "string") base = inputEl.value || "";
          var merged = (base ? base + " " : "") + (finalText || interimText);
          lastMergedText = merged.trim();
          inputEl.value = lastMergedText;
        } catch (e) {}
      };

      recognition.onerror = function (e) {
        try {
          // not-allowed / service-not-allowed / network 등
          hadError = true;
          toast("음성인식이 차단되었거나 사용할 수 없어요.");
        } catch (e2) {}
      };

      recognition.onend = function () {
        // 사용자가 손을 떼어서 stop()한 경우에도 onend로 들어옴
        voiceActive = false;
        try {
          inputEl.__voiceBaseText = null;
          inputEl.focus();
        } catch (e) {}

        // 인식된 텍스트가 실제로 있을 때만 자동 전송
        // (인식이 없으면 기존 입력값 유지)
        try {
          var toSend = "";
          if (!hadError && recognizedSomething) {
            // final 우선, 없으면 마지막 merged 사용
            var merged2 = lastMergedText || "";
            var candidate = (merged2 || "").trim();

            // baseText만 있는 경우(=인식 내용이 없는 경우) 방지
            var baseTrim = (baseText || "").trim();
            if (candidate && candidate !== baseTrim) {
              toSend = candidate;
            } else if (finalText && finalText.trim()) {
              // baseText가 없거나 같더라도 finalText가 있으면 전송
              toSend = ((baseTrim ? baseTrim + " " : "") + finalText).trim();
            }
          }

          if (toSend) {
            inputEl.value = toSend;
            // long-press 후 발생하는 실제 click은 막되,
            // 여기서의 프로그램적 전송(click)은 통과시킴
            allowSyntheticClick = true;
            try { sendBtn.click(); } catch (eClick) {}
            allowSyntheticClick = false;
          } else {
            // 전송 안 하면 원래 입력값 복원
            inputEl.value = baseText || "";
          }
        } catch (eSend) {}

        // 클릭 전송 방지 플래그는 잠깐 유지
        setTimeout(function () {
          ignoreNextClick = false;
        }, 350);
      };

      try {
        // 현재 입력값을 base로 잡고, 인식 텍스트를 이어붙임
        inputEl.__voiceBaseText = inputEl.value || "";
      } catch (e) {}

      try {
        recognition.start();
      } catch (e) {
        // 이미 시작된 상태 등
        toast("음성인식을 시작할 수 없어요.");
        voiceActive = false;
      }
    }

    function stopVoice() {
      try {
        if (recognition && voiceActive) {
          recognition.stop();
        }
      } catch (e) {
        // ignore
      }
    }

    function onPressStart(ev) {
      // 마우스 우클릭 등 제외
      try {
        if (ev && ev.button != null && ev.button !== 0) return;
      } catch (e) {}

      holding = true;
      clearTimeout(holdTimer);

      holdTimer = setTimeout(function () {
        if (!holding) return;
        startVoice();
      }, HOLD_MS);
    }

    function onPressEnd() {
      holding = false;
      clearTimeout(holdTimer);

      // 길게 눌러 음성모드가 켜졌다면, 손을 떼면 종료
      if (voiceActive) {
        stopVoice();
      }
    }

    // (중요) long-press 후 발생하는 click 전송을 캡처 단계에서 차단
    sendBtn.addEventListener(
      "click",
      function (ev) {
        if (!ignoreNextClick) return;
        if (allowSyntheticClick) return;
        ev.preventDefault();
        ev.stopPropagation();
        if (typeof ev.stopImmediatePropagation === "function") ev.stopImmediatePropagation();
      },
      true
    );

    // Pointer Events 우선
    sendBtn.addEventListener("pointerdown", onPressStart);
    sendBtn.addEventListener("pointerup", onPressEnd);
    sendBtn.addEventListener("pointercancel", onPressEnd);
    sendBtn.addEventListener("pointerleave", onPressEnd);

    // 구형 모바일(혹시) 대비
    sendBtn.addEventListener("touchstart", onPressStart, { passive: true });
    sendBtn.addEventListener("touchend", onPressEnd);
    sendBtn.addEventListener("touchcancel", onPressEnd);

    // 마우스(데스크톱) 대비
    sendBtn.addEventListener("mousedown", onPressStart);
    document.addEventListener("mouseup", onPressEnd);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
