/* ============================================================
   [profile-manager.js] 유저 프로필 관리
   ------------------------------------------------------------
   프로필 이미지
   - 업로드: chat-photo.js 와 동일 방식 (SHEET_IMAGE_UPLOAD_URL + mode=social_upload_image)
             기존 이미지 저장 폴더와 같은 곳에 저장됨
   - Firebase /profiles/{nickname} 에 URL 저장 → 다른 유저도 조회 가능
   - 로컬 캐시(localStorage) → 재접속 시 즉시 표시
   배경 이미지: 로컬 기기에만 저장
   기어(⚙) 버튼: topbar 우측
   ============================================================ */

(function () {
  if (window.ProfileManager) return;

  var LS_PROFILES = "ghostProfiles_v3";
  var LS_MY_BG    = "ghostMyBg_v1";
  var FB_PROFILES = "profiles";

  var DEFAULT_AVATAR = "data:image/svg+xml," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">' +
    '<circle cx="20" cy="20" r="20" fill="#c7d2fe"/>' +
    '<circle cx="20" cy="15" r="7" fill="#818cf8"/>' +
    '<ellipse cx="20" cy="34" rx="12" ry="9" fill="#818cf8"/></svg>'
  );

  function loadProfiles() {
    try { return JSON.parse(localStorage.getItem(LS_PROFILES) || "{}"); } catch (e) { return {}; }
  }
  function saveProfiles(map) {
    try { localStorage.setItem(LS_PROFILES, JSON.stringify(map || {})); } catch (e) {}
  }

  function fbProfileRef(nickname) {
    try {
      if (typeof firebase === "undefined") return null;
      var db = firebase.database();
      var safe = String(nickname || "").replace(/[.#$\[\]\/]/g, "_");
      return db.ref(FB_PROFILES + "/" + safe);
    } catch (e) { return null; }
  }

  function getAvatarUrl(nickname) {
    if (!nickname) return DEFAULT_AVATAR;
    var p = loadProfiles()[nickname];
    return (p && (p.imgLocal || p.imgUrl)) ? (p.imgLocal || p.imgUrl) : DEFAULT_AVATAR;
  }

  function fetchAndCacheProfile(nickname) {
    if (!nickname) return;
    var profs = loadProfiles();
    // 1시간 이내 캐시 있으면 스킵
    if (profs[nickname] && profs[nickname].imgLocal &&
        (Date.now() - (profs[nickname].ts || 0)) < 3600000) return;

    var ref = fbProfileRef(nickname);
    if (!ref) return;

    ref.once("value").then(function (snap) {
      var val = snap.val();
      if (!val || !val.imgUrl) return;
      var url = val.imgUrl;

      var cur = loadProfiles();
      if (!cur[nickname]) cur[nickname] = {};
      if (cur[nickname].imgUrl !== url) cur[nickname].imgLocal = "";
      cur[nickname].imgUrl = url;
      cur[nickname].ts = Date.now();
      saveProfiles(cur);

      // Drive URL → base64 로컬 캐시
      fetch(url).then(function (r) { return r.blob(); }).then(function (blob) {
        var reader = new FileReader();
        reader.onload = function () {
          var cc = loadProfiles();
          if (!cc[nickname]) cc[nickname] = {};
          cc[nickname].imgLocal = String(reader.result || "");
          cc[nickname].ts = Date.now();
          saveProfiles(cc);
          document.querySelectorAll('[data-profile-nick="' + nickname + '"]').forEach(function (el) {
            el.src = cc[nickname].imgLocal;
          });
        };
        reader.readAsDataURL(blob);
      }).catch(function () {
        document.querySelectorAll('[data-profile-nick="' + nickname + '"]').forEach(function (el) {
          el.src = url;
        });
      });
    }).catch(function () {});
  }

  /* ── 이미지 업로드: chat-photo.js 와 완전히 동일한 방식 ── */
  function uploadProfileImage(nickname, dataUrl) {
    return new Promise(function (resolve, reject) {
      if (!nickname || !dataUrl) return reject(new Error("no data"));
      var uploadUrl = window.SHEET_IMAGE_UPLOAD_URL || window.SHEET_WRITE_URL || "";
      if (!uploadUrl) return reject(new Error("SHEET_IMAGE_UPLOAD_URL not configured"));

      var base64 = dataUrl, mime = "image/jpeg";
      if (dataUrl.indexOf(",") > -1) {
        var sp = dataUrl.split(",");
        base64 = sp[1];
        var m = sp[0].match(/:(.*?);/);
        if (m) mime = m[1];
      }

      var body = new URLSearchParams();
      body.append("mode",     "social_upload_image");
      body.append("mime",     mime);
      body.append("data",     base64);
      // user_id는 실제 user_id 사용 (없으면 빈값 - Apps Script가 허용하는 형태)
      body.append("user_id",  (window.currentUser && window.currentUser.user_id) ? String(window.currentUser.user_id) : "");
      body.append("nickname", nickname);
      body.append("ts",       String(Date.now()));

      fetch(uploadUrl, {
        method: "POST",
        body: body
      })
        .then(function (res) { return res.json(); })
        .then(function (json) {
          var url = (json && (json.url || json.image_url)) || "";
          if (!url) return reject(new Error((json && json.error) || "no url returned"));

          // 로컬 캐시
          var profs = loadProfiles();
          if (!profs[nickname]) profs[nickname] = {};
          profs[nickname].imgUrl   = url;
          profs[nickname].imgLocal = dataUrl;
          profs[nickname].ts       = Date.now();
          saveProfiles(profs);

          // Firebase /profiles/{nickname} 저장 → 다른 유저가 읽어갈 수 있음
          var ref = fbProfileRef(nickname);
          if (ref) ref.set({ imgUrl: url, nickname: nickname, ts: Date.now() }).catch(function () {});

          resolve(url);
        })
        .catch(reject);
    });
  }

  function getMyBg(nickname) {
    try {
      var obj = JSON.parse(localStorage.getItem(LS_MY_BG) || "{}");
      return (nickname && obj[nickname]) ? obj[nickname] : null;
    } catch (e) { return null; }
  }
  function setMyBg(nickname, dataUrl) {
    try {
      var obj = {};
      try { obj = JSON.parse(localStorage.getItem(LS_MY_BG) || "{}"); } catch (e) {}
      if (dataUrl) obj[nickname] = dataUrl; else delete obj[nickname];
      localStorage.setItem(LS_MY_BG, JSON.stringify(obj));
    } catch (e) {}
  }

  function applyBackground(nickname) {
    try {
      var target = document.getElementById("messengerBody") ||
                   document.querySelector(".messenger-body");
      if (!target) return;
      var old = target.querySelector(".bg-overlay-layer");
      if (old) old.remove();
      var bg = getMyBg(nickname);
      if (bg) {
        target.style.backgroundImage    = "url(" + bg + ")";
        target.style.backgroundSize     = "cover";
        target.style.backgroundPosition = "center";
        target.style.position           = "relative";
        var layer = document.createElement("div");
        layer.className = "bg-overlay-layer";
        layer.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:0;background:rgba(244,246,251,0.72);";
        target.insertBefore(layer, target.firstChild);
      } else {
        target.style.backgroundImage = "";
        target.style.backgroundSize  = "";
      }
    } catch (e) {}
  }

  function refreshAllAvatars() {
    try {
      document.querySelectorAll("[data-profile-nick]").forEach(function (el) {
        el.src = getAvatarUrl(el.getAttribute("data-profile-nick"));
      });
    } catch (e) {}
  }

  function safeMyNickname() {
    try {
      if (window.currentUser && window.currentUser.nickname) return String(window.currentUser.nickname);
      var raw = localStorage.getItem("ghostUser");
      if (raw) { var u = JSON.parse(raw); if (u && u.nickname) return String(u.nickname); }
    } catch (e) {}
    return "";
  }

  /* ── 프로필 설정 모달 ── */
  function openProfileModal() {
    var me = safeMyNickname();
    if (!me) { alert("먼저 로그인해 주세요."); return; }

    var existing = document.getElementById("profileModal");
    if (existing) { existing.style.display = "flex"; return; }

    var overlay = document.createElement("div");
    overlay.id = "profileModal";
    overlay.style.cssText = "position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,0.55);";

    var box = document.createElement("div");
    box.style.cssText = "width:min(360px,94vw);background:#fff;border-radius:20px;padding:22px 18px 18px;box-shadow:0 20px 50px rgba(15,23,42,.25);display:flex;flex-direction:column;gap:14px;";
    box.innerHTML = [
      "<div style='display:flex;align-items:center;justify-content:space-between;'>",
      "<span style='font-size:15px;font-weight:800;color:#111827;'>프로필 설정</span>",
      "<button id='pmClose' style='border:0;background:transparent;font-size:20px;cursor:pointer;color:#6b7280;'>✕</button></div>",
      "<div style='display:flex;flex-direction:column;align-items:center;gap:10px;'>",
      "<img id='pmPreview' src='" + getAvatarUrl(me) + "' style='width:72px;height:72px;border-radius:50%;object-fit:cover;border:2px solid #c7d2fe;background:#e0e7ff;'>",
      "<button id='pmImgBtn' type='button' style='border:1px solid #c7d2fe;background:#eef2ff;color:#4338ca;border-radius:10px;padding:6px 14px;font-size:13px;cursor:pointer;'>프로필 이미지 변경</button>",
      "<input id='pmImgInput' type='file' accept='image/*' style='display:none'></div>",
      "<div style='display:flex;flex-direction:column;gap:6px;'>",
      "<span style='font-size:13px;font-weight:700;color:#374151;'>채팅 배경</span>",
      "<div style='display:flex;gap:8px;'>",
      "<button id='pmBgBtn' type='button' style='border:1px solid #d1d5db;background:#f9fafb;color:#374151;border-radius:10px;padding:6px 14px;font-size:13px;cursor:pointer;'>배경 선택</button>",
      "<button id='pmBgClear' type='button' style='border:1px solid #fca5a5;background:#fff1f2;color:#dc2626;border-radius:10px;padding:6px 10px;font-size:13px;cursor:pointer;'>초기화</button></div>",
      "<div id='pmBgPreview' style='height:50px;border-radius:10px;background:#f3f4f6;border:1px solid #e5e7eb;background-size:cover;background-position:center;'></div>",
      "<input id='pmBgInput' type='file' accept='image/*' style='display:none'></div>",
      "<button id='pmSave' type='button' style='border:0;background:#2563eb;color:#fff;border-radius:12px;height:40px;font-size:14px;font-weight:800;cursor:pointer;'>저장</button>",
      "<div id='pmStatus' style='font-size:12px;color:#6b7280;text-align:center;min-height:16px;'></div>",
      /* 하단 버튼 행: 웹앱 추가 + 로그아웃 */
      "<div style='display:flex;gap:8px;'>",
      "  <button id='pwaInstallBtn' type='button' style='flex:1;border:1px solid #16a34a;background:#f0fdf4;color:#16a34a;border-radius:12px;height:38px;font-size:13px;font-weight:700;cursor:pointer;'>📱 바탕화면에 추가</button>",
      "  <button id='pmLogoutBtn' type='button' style='flex:0 0 auto;border:1px solid #fca5a5;background:#fff1f2;color:#dc2626;border-radius:12px;height:38px;padding:0 14px;font-size:13px;font-weight:700;cursor:pointer;'>로그아웃</button>",
      "</div>"
    ].join("");
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    var close = function () { overlay.style.display = "none"; };
    document.getElementById("pmClose").addEventListener("click", close);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });

    var pendingImg = null;
    document.getElementById("pmImgBtn").addEventListener("click", function () {
      document.getElementById("pmImgInput").click();
    });
    document.getElementById("pmImgInput").addEventListener("change", function () {
      var file = this.files && this.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var img = new Image();
        img.onload = function () {
          var c = document.createElement("canvas");
          c.width = 120; c.height = 120;
          var ctx = c.getContext("2d");
          var s = Math.min(img.width, img.height);
          ctx.drawImage(img, (img.width-s)/2, (img.height-s)/2, s, s, 0, 0, 120, 120);
          pendingImg = c.toDataURL("image/jpeg", 0.85);
          document.getElementById("pmPreview").src = pendingImg;
        };
        img.src = String(reader.result || "");
      };
      reader.readAsDataURL(file);
    });

    var pendingBg = getMyBg(me) || null;
    var bgPrev = document.getElementById("pmBgPreview");
    if (pendingBg) bgPrev.style.backgroundImage = "url(" + pendingBg + ")";

    document.getElementById("pmBgBtn").addEventListener("click", function () {
      document.getElementById("pmBgInput").click();
    });
    document.getElementById("pmBgInput").addEventListener("change", function () {
      var file = this.files && this.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var img = new Image();
        img.onload = function () {
          var ratio = Math.min(800/img.width, 600/img.height, 1);
          var c = document.createElement("canvas");
          c.width = Math.round(img.width*ratio); c.height = Math.round(img.height*ratio);
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          pendingBg = c.toDataURL("image/jpeg", 0.78);
          bgPrev.style.backgroundImage = "url(" + pendingBg + ")";
        };
        img.src = String(reader.result || "");
      };
      reader.readAsDataURL(file);
    });
    document.getElementById("pmBgClear").addEventListener("click", function () {
      pendingBg = null; bgPrev.style.backgroundImage = "";
    });

    document.getElementById("pmSave").addEventListener("click", function () {
      var st = document.getElementById("pmStatus");
      st.textContent = "저장 중...";
      setMyBg(me, pendingBg);
      applyBackground(me);
      if (pendingImg) {
        uploadProfileImage(me, pendingImg)
          .then(function () { st.textContent = "✅ 저장 완료!"; refreshAllAvatars(); refreshGearButton(me); setTimeout(close, 900); })
          .catch(function (err) { st.textContent = "⚠️ 업로드 실패: " + (err && err.message || "오류"); refreshAllAvatars(); });
      } else {
        st.textContent = "✅ 저장 완료!"; setTimeout(close, 700);
      }
    });

    /* PWA 설치 버튼 */
    var pwaBtn = document.getElementById("pwaInstallBtn");
    if (pwaBtn) {
      var isStandalone = window.matchMedia("(display-mode: standalone)").matches ||
                         window.navigator.standalone === true;
      if (isStandalone) {
        pwaBtn.textContent = "✅ 이미 설치됨";
        pwaBtn.disabled = true;
        pwaBtn.style.opacity = "0.5";
      }
      pwaBtn.addEventListener("click", function () {
        if (window.PwaManager) {
          window.PwaManager.install().then(function (result) {
            if (result === "accepted") {
              pwaBtn.textContent = "✅ 설치 완료!";
              pwaBtn.disabled = true;
            }
            // ios_guide, not_available 등은 PwaManager 내부에서 처리
          });
        }
      });
    }

    /* 로그아웃 버튼 */
    var logoutBtn = document.getElementById("pmLogoutBtn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", function () {
        if (confirm("로그아웃 하시겠어요?")) {
          try {
            // login.js의 logoutGhostUser 사용
            if (typeof window.logoutGhostUser === "function") {
              window.logoutGhostUser();
            } else {
              localStorage.removeItem("ghostUser");
              window.currentUser = null;
              window.__loginConfirmed = false;
            }
          } catch (e) {}
          close();
          // 로그인 패널 열기
          setTimeout(function () {
            if (typeof window.openLoginPanel === "function") window.openLoginPanel();
          }, 200);
        }
      });
    }
  }

  function injectGearButton() {
    var topbar = document.querySelector(".messenger-topbar");
    if (!topbar || document.getElementById("profileGearBtn")) return;
    var btn = document.createElement("button");
    btn.id = "profileGearBtn"; btn.type = "button"; btn.title = "프로필/배경 설정";
    btn.style.cssText = "position:absolute;right:10px;top:50%;transform:translateY(-50%);border:0;background:transparent;padding:0;cursor:pointer;line-height:0;";

    var img = document.createElement("img");
    img.id = "profileGearImg";
    img.style.cssText = "width:32px;height:32px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,0.7);background:#e0e7ff;display:block;";
    img.src = DEFAULT_AVATAR;
    img.alt = "내 프로필";
    img.onerror = function () { this.src = DEFAULT_AVATAR; };
    btn.appendChild(img);

    btn.addEventListener("click", function (e) { e.stopPropagation(); openProfileModal(); });
    topbar.appendChild(btn);
  }

  /* 내 프로필 이미지로 버튼 갱신 */
  function refreshGearButton(nickname) {
    var img = document.getElementById("profileGearImg");
    if (!img) return;
    var url = getAvatarUrl(nickname);
    if (url) img.src = url;
  }

  function init() {
    injectGearButton();
    var me = safeMyNickname();
    if (me) { applyBackground(me); refreshGearButton(me); }
    window.addEventListener("ghost:login-complete", function (ev) {
      try {
        var nick = (ev.detail && ev.detail.nickname) ? ev.detail.nickname : safeMyNickname();
        if (!nick) return;
        applyBackground(nick);
        fetchAndCacheProfile(nick);
        injectGearButton();
        // 프로필 이미지 로컬 캐시 로드 후 버튼 갱신
        setTimeout(function () { refreshGearButton(nick); }, 300);
      } catch (e) {}
    });
  }

  window.ProfileManager = {
    getAvatarUrl:         getAvatarUrl,
    fetchAndCacheProfile: fetchAndCacheProfile,
    refreshAllAvatars:    refreshAllAvatars,
    uploadProfileImage:   uploadProfileImage,
    openProfileModal:     openProfileModal,
    applyBackground:      applyBackground,
    refreshGearButton:    refreshGearButton,
    DEFAULT_AVATAR:       DEFAULT_AVATAR
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    setTimeout(init, 0);
  }
})();
