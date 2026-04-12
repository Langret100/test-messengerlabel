/* ============================================================
   [social-messenger.js]  메인 채팅 로직 (Firebase 기반 재작성)
   ------------------------------------------------------------
   - 메시지 저장/로딩: Firebase Realtime DB (빠른 실시간)
   - 백업: 구글 시트 (기존 postToSheet 유지, 쓰기만)
   - 30일 이전 Firebase 메시지 자동 삭제 (시트는 유지)
   - 카톡 스타일: 프로필 이미지 + 보낸이 이름 + 시간 표시
   - 프로필 이미지: Google Drive 저장, 로컬 캐시로 즉시 표시
   ============================================================ */

(function () {

  /* ===== Firebase 초기화 (config.js 에서 window.FIREBASE_CONFIG 를 세팅하거나
     index.html 에서 이미 initializeApp 했으면 그걸 사용) ===== */
  var db = null;
  function ensureDb() {
    if (db) return db;
    try { db = firebase.database(); } catch (e) {}
    return db;
  }

  /* ===== 현재 유저 ===== */
  function myNickname() {
    try {
      if (window.currentUser && window.currentUser.nickname) return String(window.currentUser.nickname);
      var raw = localStorage.getItem("ghostUser");
      if (raw) { var u = JSON.parse(raw); if (u && u.nickname) return String(u.nickname); }
    } catch (e) {}
    return "익명";
  }

  /* ===== 방 변경 콜백 ===== */
  var currentRoomId = null;
  var currentSub    = null; // Firebase 구독 핸들
  var msgKeySet     = {};   // 중복 방지

  window.__onRoomChanged = function (roomId, roomObj) {
    roomId = roomId ? String(roomId).trim() : "";
    if (currentRoomId === roomId) return;
    currentRoomId = roomId;

    // 이전 구독 해제
    if (window.FirebaseMessages) {
      window.FirebaseMessages.unsubscribe(currentSub);
    } else if (window.RoomMessageStream) {
      window.RoomMessageStream.stop();
    }
    currentSub  = null;
    msgKeySet   = {};
    lastDateStr = "";  // ← 방 전환 시 날짜 구분선 초기화

    var body = document.getElementById("messengerBody");
    if (!body) return;

    if (!roomId) {
      if (window.RoomGuard) window.RoomGuard.renderNoRoomHint(body);
      return;
    }

    body.innerHTML = '<div class="empty-hint" id="loadingHint">대화 내역 불러오는 중...</div>';

    // Firebase 미설정 안내
    if (window.FirebaseMessages && !window.FirebaseMessages.isReady()) {
      body.innerHTML = [
        '<div class="empty-hint" style="color:#ef4444;padding:16px;line-height:1.6;">',
        '⚠️ Firebase 설정이 필요합니다.<br>',
        '<small>js/config.js 의 <b>FIREBASE_CONFIG</b> 값을<br>',
        'Firebase Console에서 복사해서 채워 주세요.</small>',
        '</div>'
      ].join("");
      return;
    }

    // Firebase 구독
    if (window.FirebaseMessages) {
      currentSub = window.FirebaseMessages.subscribe(roomId, function (item) {
        onFirebaseMessage(item.key, item.val, body);
      }, 100);
    }

    // 로딩 힌트 제거 (첫 메시지 받은 후 or 1.5초 후)
    setTimeout(function () {
      var hint = document.getElementById("loadingHint");
      if (hint) {
        if (!hint.nextSibling) {
          hint.textContent = "아직 대화가 없어요. 첫 메시지를 보내 보세요!";
        } else {
          hint.remove();
        }
      }
    }, 1500);
  };

  /* ===== Firebase 메시지 수신 → 말풍선 렌더 ===== */
  function onFirebaseMessage(key, val, body) {
    if (!val || !key) return;
    if (msgKeySet[key]) return;
    msgKeySet[key] = true;

    // 로딩 힌트 제거
    var hint = document.getElementById("loadingHint");
    if (hint) hint.remove();

    var me = myNickname();
    var myUid = (window.currentUser && window.currentUser.user_id) || "";
    // user_id 있으면 우선 비교, 없으면 nickname 비교
    var isMe = myUid
      ? (String(val.user_id || "") === myUid)
      : (String(val.nickname || "") === me);

    // 날짜 구분선
    var ts = Number(val.ts || 0);
    insertDateSeparatorIfNeeded(body, ts);

    // 말풍선 생성
    var row = buildMessageRow(val, isMe);
    body.appendChild(row);

    // 맨 아래 스크롤 (새 메시지가 화면 아래쪽에 있을 때만)
    var isNearBottom = (body.scrollHeight - body.scrollTop - body.clientHeight) < 120;
    if (isNearBottom || isMe) {
      requestAnimationFrame(function () {
        body.scrollTop = body.scrollHeight;
      });
    }
  }

  /* ===== 날짜 구분선 ===== */
  var lastDateStr = "";
  function insertDateSeparatorIfNeeded(body, ts) {
    if (!ts) return;
    var d = new Date(ts);
    var str = d.getFullYear() + "." + pad(d.getMonth()+1) + "." + pad(d.getDate());
    if (str === lastDateStr) return;
    lastDateStr = str;
    var sep = document.createElement("div");
    sep.className = "date-separator";
    sep.innerHTML = "<span>" + str + "</span>";
    body.appendChild(sep);
  }

  /* ===== 말풍선 행 생성 (카톡 스타일) ===== */
  function buildMessageRow(val, isMe) {
    var row = document.createElement("div");
    row.className = "msg-row " + (isMe ? "me" : "other");

    var inner = document.createElement("div");
    inner.className = "msg-inner";

    if (!isMe) {
      // 왼쪽: 프로필 이미지
      var avatar = buildAvatar(val.nickname || "익명");
      inner.appendChild(avatar);
    }

    var contentWrap = document.createElement("div");
    contentWrap.className = "msg-content-wrap";
    contentWrap.style.cssText = "display:flex;flex-direction:column;gap:2px;" + (isMe ? "align-items:flex-end;" : "align-items:flex-start;");

    // 보낸이 이름 (상대방만)
    if (!isMe) {
      var nameEl = document.createElement("div");
      nameEl.className = "msg-sender-name";
      nameEl.textContent = val.nickname || "익명";
      nameEl.style.cssText = "font-size:11px;font-weight:700;color:#374151;padding-left:4px;margin-bottom:1px;";
      contentWrap.appendChild(nameEl);
    }

    // 시간 + 버블 행
    var bubbleRow = document.createElement("div");
    bubbleRow.style.cssText = "display:flex;align-items:flex-end;gap:4px;" + (isMe ? "flex-direction:row-reverse;" : "");

    var bubble = buildBubble(val);
    var timeEl = buildTimeEl(val.ts);

    bubbleRow.appendChild(bubble);
    bubbleRow.appendChild(timeEl);
    contentWrap.appendChild(bubbleRow);

    inner.appendChild(contentWrap);
    row.appendChild(inner);
    return row;
  }

  /* ===== 아바타 이미지 ===== */
  function buildAvatar(nickname) {
    var wrap = document.createElement("div");
    wrap.style.cssText = "flex:0 0 auto;width:34px;height:34px;margin-right:4px;align-self:flex-start;";

    var img = document.createElement("img");
    img.className = "msg-avatar";
    img.setAttribute("data-profile-nick", nickname);
    img.src = window.ProfileManager ? window.ProfileManager.getAvatarUrl(nickname)
            : (window.ProfileManager && window.ProfileManager.DEFAULT_AVATAR) || "";
    img.alt = nickname;
    img.style.cssText = "width:34px;height:34px;border-radius:50%;object-fit:cover;background:#e0e7ff;";
    img.onerror = function () {
      this.onerror = null;
      this.src = window.ProfileManager ? window.ProfileManager.DEFAULT_AVATAR : "";
    };

    // 백그라운드에서 Drive 이미지 캐시 보완
    if (window.ProfileManager) {
      setTimeout(function () {
        window.ProfileManager.fetchAndCacheProfile(nickname);
      }, 300);
    }

    wrap.appendChild(img);
    return wrap;
  }

  /* ===== 말풍선 내용 ===== */
  function buildBubble(val) {
    var bubble = document.createElement("div");
    bubble.className = "bubble";

    var type = String(val.type || "text");

    if (type === "image" || type === "photo") {
      bubble.classList.add("photo-bubble");
      var img = document.createElement("img");
      img.className = "chat-photo";
      img.src = val.url || "";
      img.alt = "사진";
      img.setAttribute("data-zoomable", "1");
      img.loading = "lazy";
      img.addEventListener("click", function () {
        openZoom(val.url || "", val.url || "");
      });
      bubble.appendChild(img);

    } else if (type === "file") {
      bubble.classList.add("file-bubble");
      var a = document.createElement("a");
      a.href = val.url || "#";
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.className = "file-link";
      a.textContent = "📎 " + (val.fileName || "파일 다운로드");
      bubble.appendChild(a);

    } else if (type === "emoji") {
      bubble.classList.add("emoji-only");
      var eImg = document.createElement("img");
      eImg.src = val.url || "";
      eImg.alt = "이모티콘";
      eImg.className = "chat-emoji";
      bubble.appendChild(eImg);

    } else {
      // 텍스트 (링크 처리)
      var text = String(val.text || "");
      if (typeof window.linkifyText === "function") {
        bubble.innerHTML = window.linkifyText(text);
      } else {
        bubble.textContent = text;
      }
    }
    return bubble;
  }

  /* ===== 시간 표시 ===== */
  function buildTimeEl(ts) {
    var el = document.createElement("div");
    el.className = "msg-meta";
    if (ts) {
      var d = new Date(Number(ts));
      var h = d.getHours(), m = d.getMinutes();
      var ampm = h < 12 ? "오전" : "오후";
      h = h % 12 || 12;
      el.textContent = ampm + " " + h + ":" + pad(m);
    }
    return el;
  }

  function pad(n) { return n < 10 ? "0" + n : String(n); }

  /* ===== 줌 오버레이 ===== */
  function openZoom(src, href) {
    var overlay = document.getElementById("imageZoomOverlay");
    var img     = document.getElementById("imageZoomImg");
    var link    = document.getElementById("imageZoomOpenLink");
    if (!overlay || !img) return;
    img.src = src;
    if (link) link.href = href || src;
    overlay.classList.add("open");
    try { document.body.classList.add("no-scroll"); } catch (e) {}
  }

  /* ===== 메시지 전송 ===== */
  function sendMessage() {
    var input = document.getElementById("msgInput");
    if (!input) return;
    var text = (input.value || "").trim();
    if (!text) return;
    if (!currentRoomId) {
      if (window.RoomGuard) window.RoomGuard.openRoomPanel();
      return;
    }

    var me = myNickname();
    input.value = "";

    var msgData = {
      user_id:  (window.currentUser && window.currentUser.user_id) || "",
      nickname: me,
      text:     text,
      ts:       Date.now(),
      type:     "text"
    };

    // 1) Firebase 저장 (빠른 경로)
    if (window.FirebaseMessages) {
      window.FirebaseMessages.saveMessage(currentRoomId, msgData).catch(function () {});
    }

    // 2) 구글 시트 백업 (느린 경로, 실패해도 무관)
    if (typeof postToSheet === "function") {
      try {
        postToSheet({
          mode:    "social_send",
          room_id: currentRoomId,
          nickname: me,
          message: text,
          ts:      msgData.ts
        }).catch(function () {});
      } catch (e) {}
    }
  }

  /* ===== 이모티콘/사진 전송 (외부에서 호출) ===== */
  window.sendChatEmoji = function (url) {
    if (!currentRoomId) return;
    var me = myNickname();
    var msgData = {
      user_id:  (window.currentUser && window.currentUser.user_id) || "",
      nickname: me,
      text:     "",
      ts:       Date.now(),
      type:     "emoji",
      url:      url
    };
    if (window.FirebaseMessages) {
      window.FirebaseMessages.saveMessage(currentRoomId, msgData).catch(function () {});
    }
    if (typeof postToSheet === "function") {
      try {
        postToSheet({ mode: "social_send", room_id: currentRoomId, nickname: me, message: "[이모티콘]", ts: msgData.ts }).catch(function () {});
      } catch (e) {}
    }
  };

  window.sendChatPhoto = function (url, originalUrl) {
    if (!currentRoomId) return;
    var me = myNickname();
    var msgData = {
      user_id:  (window.currentUser && window.currentUser.user_id) || "",
      nickname: me,
      text:     "",
      ts:       Date.now(),
      type:     "photo",
      url:      url
    };
    if (window.FirebaseMessages) {
      window.FirebaseMessages.saveMessage(currentRoomId, msgData).catch(function () {});
    }
    if (typeof postToSheet === "function") {
      try {
        postToSheet({ mode: "social_send", room_id: currentRoomId, nickname: me, message: "[사진]", ts: msgData.ts }).catch(function () {});
      } catch (e) {}
    }
  };

  window.sendChatFile = function (url, fileName) {
    if (!currentRoomId) return;
    var me = myNickname();
    var msgData = {
      user_id:  (window.currentUser && window.currentUser.user_id) || "",
      nickname: me,
      text:     "",
      ts:       Date.now(),
      type:     "file",
      url:      url,
      fileName: fileName || "파일"
    };
    if (window.FirebaseMessages) {
      window.FirebaseMessages.saveMessage(currentRoomId, msgData).catch(function () {});
    }
  };

  /* ===== 상태 토스트 ===== */
  function showStatus(msg, ms) {
    var el = document.getElementById("msgStatus");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove("show"); }, ms || 1800);
  }
  window.showBubble = showStatus;

  /* ===== 이미지 줌 닫기 ===== */
  function initZoomOverlay() {
    var overlay = document.getElementById("imageZoomOverlay");
    if (!overlay) return;
    overlay.addEventListener("click", function (e) {
      var link = document.getElementById("imageZoomOpenLink");
      if (link && (e.target === link || link.contains(e.target))) return;
      overlay.classList.remove("open");
      try { document.body.classList.remove("no-scroll"); } catch (e2) {}
    });
  }

  /* ===== 전송 버튼/엔터 ===== */
  function initSendControls() {
    var sendBtn = document.getElementById("msgSendBtn");
    var input   = document.getElementById("msgInput");
    if (sendBtn) sendBtn.addEventListener("click", sendMessage);
    if (input)   input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
  }

  /* ===== 첨부 메뉴 (+ 버튼) ===== */
  function initAttachMenu() {
    var cameraBtn = document.getElementById("msgCameraBtn");
    if (!cameraBtn) return;

    // 첨부 메뉴 DOM
    var menu = document.createElement("div");
    menu.className = "msg-attach-menu";
    menu.innerHTML = [
      '<button class="msg-attach-item" id="attachCamera">📷 사진촬영</button>',
      '<button class="msg-attach-item" id="attachImage">🖼 이미지 첨부</button>',
      '<button class="msg-attach-item" id="attachFile">📎 파일 첨부</button>'
    ].join("");

    var inputBar = document.querySelector(".messenger-input-bar");
    if (inputBar) inputBar.appendChild(menu);

    cameraBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      menu.classList.toggle("open");
    });
    document.addEventListener("click", function () { menu.classList.remove("open"); });

    var attachCamera = document.getElementById("attachCamera");
    var attachImage  = document.getElementById("attachImage");
    var attachFile   = document.getElementById("attachFile");

    if (attachCamera) attachCamera.addEventListener("click", function () {
      menu.classList.remove("open");
      if (window.ChatPhoto) window.ChatPhoto.openCamera();
    });
    if (attachImage) attachImage.addEventListener("click", function () {
      menu.classList.remove("open");
      if (window.ChatPhoto) window.ChatPhoto.openGallery();
    });
    if (attachFile) attachFile.addEventListener("click", function () {
      menu.classList.remove("open");
      if (window.ChatFile) window.ChatFile.open();
    });
  }

  /* ===== 이모지 패널 ===== */
  function initEmojiPanel() {
    var emojiBtn   = document.getElementById("msgEmojiBtn");
    var emojiPanel = document.getElementById("msgEmojiPanel");
    if (!emojiBtn || !emojiPanel) return;

    // 패널 그리드 구성 (아직 안 만들어진 경우)
    if (!emojiPanel.dataset.__built) {
      emojiPanel.dataset.__built = "1";
      var basePath = window.CHAT_EMOJI_BASE_PATH || "../images/emoticon/";
      var grid = document.createElement("div");
      grid.className = "emoji-grid";
      for (var i = 1; i <= 12; i++) {
        (function (idx) {
          var btn = document.createElement("button");
          btn.type = "button";
          btn.className = "emoji-item";
          btn.setAttribute("data-emoji-idx", idx);
          var img = document.createElement("img");
          img.className = "chat-emoji";
          img.src = basePath + "e" + idx + ".png";
          img.alt = "이모티콘" + idx;
          img.width = 72; img.height = 72;
          btn.appendChild(img);
          grid.appendChild(btn);
        })(i);
      }
      emojiPanel.appendChild(grid);
    }

    emojiBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      emojiPanel.classList.toggle("open");
    });
    document.addEventListener("click", function () {
      emojiPanel.classList.remove("open");
    });

    emojiPanel.addEventListener("click", function (e) {
      var btn = e.target.closest(".emoji-item");
      if (!btn) return;
      var idx = btn.getAttribute("data-emoji-idx");
      if (!idx) return;
      var basePath2 = window.CHAT_EMOJI_BASE_PATH || "../images/emoticon/";
      var url = basePath2 + "e" + idx + ".png";
      // Firebase로 이모티콘 전송
      if (typeof window.sendChatEmoji === "function") {
        window.sendChatEmoji(url);
      }
      emojiPanel.classList.remove("open");
    });
  }

  /* ===== 초기화 ===== */
  function init() {
    ensureDb();

    initSendControls();
    initAttachMenu();
    initEmojiPanel();
    initZoomOverlay();

    // 대화방 초기화
    if (window.ChatRooms) {
      window.ChatRooms.init().then(function () {
        var rid = window.ChatRooms.getActiveRoomId();
        if (rid) window.__onRoomChanged(rid, window.ChatRooms.getActiveRoom());
      });
    }

    // 프로필 초기화 (기어 버튼 등)
    if (window.ProfileManager) {
      // 이미 init은 profile-manager.js 에서 자동 호출됨
    }

    // unread badge 연동
    if (window.RoomUnreadBadge && typeof window.RoomUnreadBadge.init === "function") {
      try { window.RoomUnreadBadge.init(); } catch (e) {}
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // 전역 노출 (다른 모듈에서 방 정보 접근용)
  window.__getSocialRoomId = function () { return currentRoomId; };

})();
