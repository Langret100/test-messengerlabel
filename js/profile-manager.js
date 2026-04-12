/* ============================================================
   [profile-manager.js] 유저 프로필 관리
   ------------------------------------------------------------
   - 프로필 이미지: Google Drive 저장 (Apps Script 업로드)
   - 로컬 캐시: localStorage / IndexedDB(base64) → 즉시 표시
   - 배경 이미지: 개인 기기 로컬만 사용 (Drive 저장 없음)
   - 기어(⚙) 버튼 → 프로필 설정 모달(이름, 이미지, 배경)
   ============================================================ */

(function () {
  if (window.ProfileManager) return;

  /* ---- 상수 ---- */
  var LS_PROFILES  = "ghostProfiles_v2";   // { nickname: { imgUrl, imgLocal, ts } }
  var LS_MY_BG     = "ghostMyBg_v1";       // { nickname: dataUrl }
  var DEFAULT_AVATAR = "data:image/svg+xml," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">' +
    '<circle cx="20" cy="20" r="20" fill="#c7d2fe"/>' +
    '<circle cx="20" cy="15" r="7" fill="#818cf8"/>' +
    '<ellipse cx="20" cy="34" rx="12" ry="9" fill="#818cf8"/>' +
    '</svg>'
  );

  /* ---- 프로필 캐시 읽기/쓰기 ---- */
  function loadProfiles() {
    try {
      var raw = localStorage.getItem(LS_PROFILES);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }

  function saveProfiles(map) {
    try { localStorage.setItem(LS_PROFILES, JSON.stringify(map || {})); } catch (e) {}
  }

  /* ---- 이미지 URL 반환 (로컬 우선, 없으면 Drive URL, 없으면 기본) ---- */
  function getAvatarUrl(nickname) {
    if (!nickname) return DEFAULT_AVATAR;
    var profiles = loadProfiles();
    var p = profiles[nickname];
    if (!p) return DEFAULT_AVATAR;
    return p.imgLocal || p.imgUrl || DEFAULT_AVATAR;
  }

  /* ---- Drive에서 프로필 이미지 불러와 로컬 캐시에 저장 ---- */
  function fetchAndCacheProfile(nickname) {
    if (!nickname) return;
    var profiles = loadProfiles();
    var p = profiles[nickname];
    if (!p || !p.imgUrl) return;

    // 이미 로컬 캐시 있으면 스킵
    if (p.imgLocal) return;

    // Drive 공개 URL → fetch → base64 캐시
    fetch(p.imgUrl)
      .then(function (r) { return r.blob(); })
      .then(function (blob) {
        var reader = new FileReader();
        reader.onload = function () {
          var profs = loadProfiles();
          if (!profs[nickname]) profs[nickname] = {};
          profs[nickname].imgLocal = String(reader.result || "");
          profs[nickname].ts = Date.now();
          saveProfiles(profs);
          // 화면 갱신
          try {
            document.querySelectorAll('[data-profile-nick="' + nickname + '"]').forEach(function (el) {
              el.src = profs[nickname].imgLocal;
            });
          } catch (ex) {}
        };
        reader.readAsDataURL(blob);
      })
      .catch(function () {});
  }

  /* ---- 이미지 업로드 to Drive via Apps Script ---- */
  function uploadProfileImage(nickname, dataUrl) {
    return new Promise(function (resolve, reject) {
      if (!nickname || !dataUrl) return reject(new Error("no data"));
      if (typeof postToSheet !== "function") return reject(new Error("no postToSheet"));

      // chat-photo.js 와 같은 방식으로 Apps Script에 업로드
      // mode: social_upload_profile  → Drive에 "{nickname}_profile.jpg" 로 저장
      postToSheet({
        mode: "social_upload_profile",
        nickname: nickname,
        image: dataUrl
      }).then(function (res) {
        return res.json();
      }).then(function (json) {
        if (!json || !json.ok) return reject(new Error(json && json.error || "upload fail"));
        var url = json.url || "";
        var profs = loadProfiles();
        if (!profs[nickname]) profs[nickname] = {};
        profs[nickname].imgUrl   = url;
        profs[nickname].imgLocal = dataUrl; // 즉시 캐시
        profs[nickname].ts       = Date.now();
        saveProfiles(profs);
        resolve(url);
      }).catch(reject);
    });
  }

  /* ---- 배경 이미지 (로컬만) ---- */
  function getMyBg(nickname) {
    try {
      var raw = localStorage.getItem(LS_MY_BG);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      return (obj && nickname && obj[nickname]) ? obj[nickname] : null;
    } catch (e) { return null; }
  }

  function setMyBg(nickname, dataUrl) {
    try {
      var raw = localStorage.getItem(LS_MY_BG);
      var obj = {};
      try { obj = JSON.parse(raw || "{}"); } catch (e2) {}
      if (dataUrl) obj[nickname] = dataUrl;
      else delete obj[nickname];
      localStorage.setItem(LS_MY_BG, JSON.stringify(obj));
    } catch (e) {}
  }

  /* ---- 프로필 설정 모달 ---- */
  function openProfileModal() {
    var me = "";
    try {
      var raw = localStorage.getItem("ghostUser");
      if (raw) { var u = JSON.parse(raw); me = u && u.nickname ? String(u.nickname) : ""; }
    } catch (e) {}
    if (!me && window.currentUser) me = window.currentUser.nickname || "";

    // 모달 DOM 생성 (중복 방지)
    var existing = document.getElementById("profileModal");
    if (existing) { existing.style.display = "flex"; return; }

    var overlay = document.createElement("div");
    overlay.id = "profileModal";
    overlay.style.cssText = [
      "position:fixed;inset:0;z-index:9000;",
      "display:flex;align-items:center;justify-content:center;",
      "background:rgba(15,23,42,0.55);"
    ].join("");

    var box = document.createElement("div");
    box.style.cssText = [
      "width:min(360px,94vw);background:#fff;border-radius:20px;",
      "padding:22px 18px 18px;box-shadow:0 20px 50px rgba(15,23,42,.25);",
      "display:flex;flex-direction:column;gap:14px;"
    ].join("");

    box.innerHTML = [
      '<div style="display:flex;align-items:center;justify-content:space-between;">',
      '  <span style="font-size:15px;font-weight:800;color:#111827;">프로필 설정</span>',
      '  <button id="profileModalClose" style="border:0;background:transparent;font-size:20px;cursor:pointer;color:#6b7280;">✕</button>',
      '</div>',

      /* 아바타 미리보기 */
      '<div style="display:flex;flex-direction:column;align-items:center;gap:10px;">',
      '  <img id="profilePreviewImg" src="' + getAvatarUrl(me) + '"',
      '    style="width:72px;height:72px;border-radius:50%;object-fit:cover;',
      '           border:2px solid #c7d2fe;background:#e0e7ff;" alt="프로필">',
      '  <button id="profileImgBtn" type="button"',
      '    style="border:1px solid #c7d2fe;background:#eef2ff;color:#4338ca;',
      '           border-radius:10px;padding:6px 14px;font-size:13px;cursor:pointer;">',
      '    프로필 이미지 변경',
      '  </button>',
      '  <input id="profileImgInput" type="file" accept="image/*" style="display:none">',
      '</div>',

      /* 배경 이미지 */
      '<div style="display:flex;flex-direction:column;gap:6px;">',
      '  <span style="font-size:13px;font-weight:700;color:#374151;">채팅 배경</span>',
      '  <div style="display:flex;gap:8px;align-items:center;">',
      '    <button id="profileBgBtn" type="button"',
      '      style="border:1px solid #d1d5db;background:#f9fafb;color:#374151;',
      '             border-radius:10px;padding:6px 14px;font-size:13px;cursor:pointer;">',
      '      배경 이미지 선택',
      '    </button>',
      '    <button id="profileBgClearBtn" type="button"',
      '      style="border:1px solid #fca5a5;background:#fff1f2;color:#dc2626;',
      '             border-radius:10px;padding:6px 10px;font-size:13px;cursor:pointer;">',
      '      초기화',
      '    </button>',
      '  </div>',
      '  <div id="profileBgPreview" style="height:50px;border-radius:10px;background:#f3f4f6;',
      '       border:1px solid #e5e7eb;background-size:cover;background-position:center;"></div>',
      '  <input id="profileBgInput" type="file" accept="image/*" style="display:none">',
      '</div>',

      /* 저장 버튼 */
      '<button id="profileSaveBtn" type="button"',
      '  style="border:0;background:#2563eb;color:#fff;border-radius:12px;',
      '         height:40px;font-size:14px;font-weight:800;cursor:pointer;">',
      '  저장',
      '</button>',
      '<div id="profileSaveStatus" style="font-size:12px;color:#6b7280;text-align:center;min-height:16px;"></div>'
    ].join("");

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    /* 닫기 */
    var closeModal = function () { overlay.style.display = "none"; };
    document.getElementById("profileModalClose").addEventListener("click", closeModal);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) closeModal(); });

    /* 프로필 이미지 선택 */
    var profileImgInput = document.getElementById("profileImgInput");
    var profilePreview  = document.getElementById("profilePreviewImg");
    var pendingProfileImg = null;

    document.getElementById("profileImgBtn").addEventListener("click", function () {
      profileImgInput.click();
    });
    profileImgInput.addEventListener("change", function () {
      var file = profileImgInput.files && profileImgInput.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        // 리사이즈 → 120x120
        var img = new Image();
        img.onload = function () {
          var canvas = document.createElement("canvas");
          canvas.width = 120; canvas.height = 120;
          var ctx = canvas.getContext("2d");
          var side = Math.min(img.width, img.height);
          var sx = (img.width - side) / 2, sy = (img.height - side) / 2;
          ctx.drawImage(img, sx, sy, side, side, 0, 0, 120, 120);
          var dataUrl = canvas.toDataURL("image/jpeg", 0.82);
          pendingProfileImg = dataUrl;
          profilePreview.src = dataUrl;
        };
        img.src = String(reader.result || "");
      };
      reader.readAsDataURL(file);
    });

    /* 배경 이미지 선택 */
    var bgInput    = document.getElementById("profileBgInput");
    var bgPreview  = document.getElementById("profileBgPreview");
    var pendingBg  = getMyBg(me) || null;

    if (pendingBg) bgPreview.style.backgroundImage = "url(" + pendingBg + ")";

    document.getElementById("profileBgBtn").addEventListener("click", function () {
      bgInput.click();
    });
    bgInput.addEventListener("change", function () {
      var file = bgInput.files && bgInput.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        // 배경은 좀 더 크게 리사이즈(800x600)
        var img = new Image();
        img.onload = function () {
          var maxW = 800, maxH = 600;
          var ratio = Math.min(maxW / img.width, maxH / img.height, 1);
          var canvas = document.createElement("canvas");
          canvas.width  = Math.round(img.width  * ratio);
          canvas.height = Math.round(img.height * ratio);
          canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
          var dataUrl = canvas.toDataURL("image/jpeg", 0.75);
          pendingBg = dataUrl;
          bgPreview.style.backgroundImage = "url(" + dataUrl + ")";
        };
        img.src = String(reader.result || "");
      };
      reader.readAsDataURL(file);
    });

    document.getElementById("profileBgClearBtn").addEventListener("click", function () {
      pendingBg = null;
      bgPreview.style.backgroundImage = "";
    });

    /* 저장 */
    document.getElementById("profileSaveBtn").addEventListener("click", function () {
      var statusEl = document.getElementById("profileSaveStatus");
      if (statusEl) statusEl.textContent = "저장 중...";

      // 배경 먼저 로컬 저장
      setMyBg(me, pendingBg);
      applyBackground(me);

      // 프로필 이미지 Drive 업로드
      if (pendingProfileImg) {
        uploadProfileImage(me, pendingProfileImg).then(function () {
          if (statusEl) statusEl.textContent = "저장 완료!";
          refreshAllAvatars();
          setTimeout(closeModal, 900);
        }).catch(function (err) {
          // 업로드 실패해도 로컬 캐시에는 이미 저장됨
          if (statusEl) statusEl.textContent = "이미지 업로드 실패 (로컬 저장됨)";
          refreshAllAvatars();
          setTimeout(closeModal, 1200);
        });
      } else {
        if (statusEl) statusEl.textContent = "저장 완료!";
        setTimeout(closeModal, 700);
      }
    });
  }

  /* ---- 배경 적용 ---- */
  function applyBackground(nickname) {
    try {
      var body = document.getElementById("messengerBody");
      if (!body) return;
      var bg = getMyBg(nickname);
      if (bg) {
        body.style.backgroundImage  = "url(" + bg + ")";
        body.style.backgroundSize   = "cover";
        body.style.backgroundPosition = "center";
        // 반투명 오버레이 효과
        body.style.setProperty("--bg-overlay", "rgba(244,246,251,0.75)");
        if (!body.querySelector(".bg-overlay-layer")) {
          var layer = document.createElement("div");
          layer.className = "bg-overlay-layer";
          layer.style.cssText = [
            "position:absolute;inset:0;pointer-events:none;z-index:0;",
            "background:rgba(244,246,251,0.72);"
          ].join("");
          body.style.position = "relative";
          body.insertBefore(layer, body.firstChild);
        }
      } else {
        body.style.backgroundImage  = "";
        body.style.backgroundSize   = "";
        body.style.backgroundPosition = "";
        var existing = body.querySelector(".bg-overlay-layer");
        if (existing) existing.remove();
      }
    } catch (e) {}
  }

  /* ---- 화면 내 모든 아바타 이미지 갱신 ---- */
  function refreshAllAvatars() {
    try {
      document.querySelectorAll("[data-profile-nick]").forEach(function (el) {
        var nick = el.getAttribute("data-profile-nick");
        if (nick) el.src = getAvatarUrl(nick);
      });
    } catch (e) {}
  }

  /* ---- 기어 버튼 삽입 ---- */
  function injectGearButton() {
    var topbar = document.querySelector(".messenger-topbar");
    if (!topbar || document.getElementById("profileGearBtn")) return;

    var btn = document.createElement("button");
    btn.id = "profileGearBtn";
    btn.type = "button";
    btn.title = "프로필 / 배경 설정";
    btn.style.cssText = [
      "position:absolute;right:14px;top:50%;transform:translateY(-50%);",
      "border:0;background:transparent;font-size:19px;cursor:pointer;",
      "color:#9ca3af;padding:4px 2px;line-height:1;transition:color 0.15s;",
      "-webkit-tap-highlight-color:transparent;user-select:none;"
    ].join("");
    btn.innerHTML = "⚙";
    btn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      var me = safeMyNickname();
      if (!me) { alert("먼저 로그인해 주세요."); return; }
      openProfileModal();
    });
    topbar.appendChild(btn);
  }

  function safeMyNickname() {
    try {
      if (window.currentUser && window.currentUser.nickname) return String(window.currentUser.nickname);
      var raw = localStorage.getItem("ghostUser");
      if (raw) { var u = JSON.parse(raw); if (u && u.nickname) return String(u.nickname); }
    } catch (e) {}
    return "";
  }

  /* ---- 초기화 ---- */
  function init() {
    injectGearButton();
    // 내 배경 복원
    var me = "";
    try {
      var raw = localStorage.getItem("ghostUser");
      if (raw) { var u = JSON.parse(raw); me = u && u.nickname ? String(u.nickname) : ""; }
    } catch (e) {}
    if (!me && window.currentUser) me = window.currentUser.nickname || "";
    if (me) {
      setTimeout(function () { applyBackground(me); }, 200);
    }
    // 로그인 완료 이벤트 후에도 배경 적용
    window.addEventListener("ghost:login-complete", function (ev) {
      try {
        var nick = ev.detail && ev.detail.nickname ? ev.detail.nickname : "";
        if (nick) applyBackground(nick);
      } catch (e) {}
    });
  }

  window.ProfileManager = {
    getAvatarUrl:       getAvatarUrl,
    fetchAndCacheProfile: fetchAndCacheProfile,
    refreshAllAvatars:  refreshAllAvatars,
    openProfileModal:   openProfileModal,
    applyBackground:    applyBackground,
    uploadProfileImage: uploadProfileImage,
    DEFAULT_AVATAR:     DEFAULT_AVATAR
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    setTimeout(init, 0);
  }
})();
