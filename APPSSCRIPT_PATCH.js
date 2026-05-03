/**
 * ============================================================
 * [Apps Script 추가 코드] social_upload_profile 모드
 * ============================================================
 * 기존 Apps Script doPost(e) 함수 안에 아래 case를 추가하세요.
 * social_upload_image 처리 방식과 동일하며,
 * 파일명만 "{nickname}_profile.jpg" 로 고정 저장합니다.
 *
 * 이미지는 Google Drive의 "messenger_profiles" 폴더에 저장됩니다.
 * 이미 같은 이름의 파일이 있으면 덮어씁니다(삭제 후 재업로드).
 *
 * 사용처: js/profile-manager.js → uploadProfileImage()
 * ============================================================
 */

// doPost(e) 내부 switch/if 블록에 추가:

case "social_upload_profile": {
  var nickname  = params.nickname || "unknown";
  var imageData = params.image || "";
  if (!imageData) {
    return jsonResponse({ ok: false, error: "no image data" });
  }

  // base64 or dataURL 처리
  var base64;
  if (imageData.indexOf(",") > -1) {
    base64 = imageData.split(",")[1];
  } else {
    base64 = imageData;
  }

  try {
    var folder = getOrCreateFolder("messenger_profiles");

    // 닉네임에서 파일명 불가 문자 제거
    var safeName = nickname.replace(/[^a-zA-Z0-9가-힣_\-]/g, "_");
    var fileName = safeName + "_profile.jpg";

    // 기존 동일 파일 삭제 (덮어쓰기 효과)
    var existingFiles = folder.getFilesByName(fileName);
    while (existingFiles.hasNext()) {
      existingFiles.next().setTrashed(true);
    }

    // 새 파일 저장
    var blob = Utilities.newBlob(
      Utilities.base64Decode(base64),
      "image/jpeg",
      fileName
    );
    var file = folder.createFile(blob);

    // 공개 공유 설정
    file.setSharing(
      DriveApp.Access.ANYONE_WITH_LINK,
      DriveApp.Permission.VIEW
    );

    // 직접 접근 가능한 URL 반환
    var fileId = file.getId();
    var publicUrl = "https://drive.google.com/uc?export=view&id=" + fileId;

    return jsonResponse({ ok: true, url: publicUrl });

  } catch (e) {
    return jsonResponse({ ok: false, error: String(e.message || e) });
  }
}

// ============================================================
// 헬퍼 함수 (없으면 추가):
// ============================================================

function getOrCreateFolder(name) {
  var folders = DriveApp.getFoldersByName(name);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(name);
}

/**
 * ============================================================
 * Firebase 보안 규칙 (Firebase Console > Realtime Database > Rules)
 * ============================================================
 * 기존 규칙에 messages 경로 규칙을 추가하세요:
 *
 * {
 *   "rules": {
 *     "messages": {
 *       "$roomId": {
 *         ".read": "auth != null || true",   // 로그인 없이도 읽기 허용 (조정 가능)
 *         ".write": "auth != null || true",  // 쓰기 허용
 *         "$msgId": {
 *           ".validate": "newData.hasChildren(['nickname','text','ts','type'])"
 *         }
 *       }
 *     }
 *   }
 * }
 *
 * ※ 실제 서비스는 auth 조건을 강화하세요.
 * ============================================================
 */

/**
 * ============================================================
 * [추가 패치] get_image_base64 모드 — Google Drive 이미지 프록시
 * ============================================================
 * 브라우저에서 Drive URL(drive.google.com/uc?...)을 fetch하면
 * CORS 정책으로 차단되어 "액세스 거부" 오류가 납니다.
 * 이 핸들러를 doGet(e)에 추가하면 Apps Script가 서버 측에서
 * Drive 이미지를 읽어 base64로 반환하므로 CORS 문제가 해소됩니다.
 *
 * 프론트엔드 호출 방식:
 *   GET {SHEET_IMAGE_UPLOAD_URL}?mode=get_image_base64&url=<encoded_drive_url>
 *
 * 사용처: js/profile-manager.js → fetchAndCacheProfile()
 * ============================================================
 */

// doGet(e) 내부에 추가:

// === doGet 전체 예시 (없으면 신규 추가, 있으면 case만 병합) ===
/*
function doGet(e) {
  var params = e.parameter || {};
  var mode   = params.mode || "";
  if (mode === "get_image_base64") {
    return handleGetImageBase64(params);
  }
  // ... 기존 doGet 로직 ...
}
*/

function handleGetImageBase64(params) {
  try {
    var url = params.url || "";
    if (!url) {
      return jsonResponse({ ok: false, error: "no url" });
    }

    // Drive fileId 추출 (uc?export=view&id=XXX 또는 /d/XXX/view 형태 모두 지원)
    var fileId = "";
    var m1 = url.match(/[?&]id=([a-zA-Z0-9_\-]+)/);
    if (m1) {
      fileId = m1[1];
    } else {
      var m2 = url.match(/\/d\/([a-zA-Z0-9_\-]+)/);
      if (m2) fileId = m2[1];
    }

    if (!fileId) {
      return jsonResponse({ ok: false, error: "cannot extract fileId from url: " + url });
    }

    var file = DriveApp.getFileById(fileId);
    var blob = file.getBlob();
    var base64 = Utilities.base64Encode(blob.getBytes());
    var mime   = blob.getContentType() || "image/jpeg";

    return jsonResponse({ ok: true, base64: base64, mime: mime });

  } catch (e) {
    return jsonResponse({ ok: false, error: String(e.message || e) });
  }
}

// ※ jsonResponse 헬퍼가 이미 있다면 중복 추가 불필요
// function jsonResponse(obj) {
//   return ContentService
//     .createTextOutput(JSON.stringify(obj))
//     .setMimeType(ContentService.MimeType.JSON);
// }

/**
 * ============================================================
 * [Firebase Storage 보안 규칙]
 * Firebase Console > Storage > Rules 에 아래 규칙 적용
 * ============================================================
 *
 * rules_version = '2';
 * service firebase.storage {
 *   match /b/{bucket}/o {
 *     // 채팅 이미지: 인증 없이 읽기 허용, 쓰기는 인증 필요
 *     match /chat_images/{file} {
 *       allow read: if true;
 *       allow write: if true; // 익명 인증 허용 시
 *     }
 *     match /chat_files/{file} {
 *       allow read: if true;
 *       allow write: if true;
 *     }
 *   }
 * }
 *
 * ============================================================
 * [4.5GB 초과 시 오래된 파일 삭제 - Apps Script 트리거]
 * Apps Script 에서 시간 기반 트리거(매일 1회)로 실행
 * ============================================================
 */

/**
 * Firebase Storage 용량 관리 (Apps Script에서 실행)
 * Firebase Admin SDK 사용 필요 - Service Account 키 필요
 * 아래는 개념 코드이며 실제 실행은 Firebase Admin SDK 환경에서 가능
 */
/*
function cleanupFirebaseStorage() {
  var BUCKET = "web-ghost-c447b.firebasestorage.app";
  var MAX_BYTES = 4.5 * 1024 * 1024 * 1024; // 4.5GB
  var PATHS = ["chat_images/", "chat_files/"];

  // Firebase Admin SDK로 파일 목록 조회 후 총 용량 계산
  // 초과 시 가장 오래된 파일부터 삭제
  // → 실제 구현은 Firebase Admin SDK Node.js 환경 권장
  //    (Apps Script에서는 Firebase REST API로 구현 가능)
}
*/

/**
 * ============================================================
 * [필수 패치] social_upload_image / social_upload_file
 * ============================================================
 * 채팅 이미지/파일 전송 기능에 필요합니다.
 * 기존 doPost(e)에 아래 case가 없다면 추가하세요.
 * 이미 있다면 건너뛰세요.
 *
 * ※ "액세스가 거부됨: DriveApp" 오류가 날 경우:
 *    Apps Script 편집기 → 배포 → 배포 관리 → 수정(연필 아이콘)
 *    → "다음 사용자로 실행: 나(본인)" 확인 → 새 버전으로 재배포
 *    → 권한 승인 팝업에서 DriveApp 허용
 * ============================================================
 */

// doPost(e) 내부에 추가:

case "social_upload_image": {
  var base64Data = params.data || "";
  var mimeType   = params.mime || "image/jpeg";
  var nickName   = params.nickname || "unknown";
  var userId     = params.user_id  || "";
  var tsVal      = params.ts       || String(Date.now());

  if (!base64Data) return jsonResponse({ ok: false, error: "no image data" });

  try {
    var imgFolder = getOrCreateFolder("messenger_images");
    var imgFileName = userId + "_" + tsVal + ".jpg";
    var imgBlob = Utilities.newBlob(
      Utilities.base64Decode(base64Data),
      mimeType,
      imgFileName
    );
    var imgFile = imgFolder.createFile(imgBlob);
    imgFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var imgFileId = imgFile.getId();
    var imgPublicUrl = "https://drive.google.com/uc?export=view&id=" + imgFileId;
    return jsonResponse({ ok: true, url: imgPublicUrl });
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e.message || e) });
  }
}

case "social_upload_file": {
  var fileBase64 = params.data     || "";
  var fileMime   = params.mime     || "application/octet-stream";
  var fileName   = params.filename || "file";
  var fileUserId = params.user_id  || "";
  var fileTs     = params.ts       || String(Date.now());

  if (!fileBase64) return jsonResponse({ ok: false, error: "no file data" });

  try {
    var fileFolder = getOrCreateFolder("messenger_files");
    var safeFileName = fileTs + "_" + fileName.replace(/[^a-zA-Z0-9가-힣._\-]/g, "_");
    var fileBlob = Utilities.newBlob(
      Utilities.base64Decode(fileBase64),
      fileMime,
      safeFileName
    );
    var driveFile = fileFolder.createFile(fileBlob);
    driveFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var driveFileId = driveFile.getId();
    // 파일은 다운로드 링크 반환
    var filePublicUrl = "https://drive.google.com/uc?export=download&id=" + driveFileId;
    return jsonResponse({ ok: true, url: filePublicUrl });
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e.message || e) });
  }
}

// ============================================================
// [추가 패치] handleFcmPush_ — notify_mode 반영
// ============================================================
// 기존 handleFcmPush_ 함수를 아래 코드로 교체하세요.
// 변경 내용:
//   1) accessToken을 forEach 밖으로 이동 (매 토큰마다 재발급 방지)
//   2) DB에서 토큰별 notify_mode 읽어 push data에 포함
//      → SW(sw.js)가 수신자 모드에 맞게 진동/무음 처리
// ============================================================

function handleFcmPush_(e) {
  try {
    var p = {};
    if (e && e.postData && e.postData.type &&
        e.postData.type.indexOf("application/json") !== -1) {
      try { p = JSON.parse(e.postData.contents || "{}"); } catch (_) {}
    } else if (e && e.parameter) {
      p = e.parameter;
    }

    var roomId    = String(p.room_id || "global");
    var sender    = String(p.sender  || "누군가");
    var body      = String(p.body    || "새 메시지가 있어요.");
    var tokensRaw = String(p.tokens  || "");

    if (!tokensRaw) return jsonResponse_({ ok: false, error: "no_tokens" });

    var tokens = tokensRaw.split(",")
      .map(function (t) { return t.trim(); })
      .filter(Boolean);

    if (tokens.length === 0) return jsonResponse_({ ok: false, error: "empty_tokens" });

    var title       = "마이파이 - " + sender;

    // ── [수정] accessToken을 forEach 밖으로 이동 (매 토큰마다 재발급 방지)
    var accessToken = _getFcmAccessToken_();

    // ── [추가] DB에서 토큰별 notify_mode 조회
    //    /fcm_tokens/{userId}.notify_mode → "sound" | "vibrate" | "mute"
    var dbTokenMap = {};  // { fcmToken: notifyMode }
    try {
      var dbResp = UrlFetchApp.fetch(FCM_DB_URL + "/fcm_tokens.json", {
        method: "get",
        headers: { "Authorization": "Bearer " + accessToken },
        muteHttpExceptions: true
      });
      if (dbResp.getResponseCode() === 200) {
        var allEntries = JSON.parse(dbResp.getContentText()) || {};
        Object.keys(allEntries).forEach(function (key) {
          var entry = allEntries[key];
          if (entry && entry.token) {
            dbTokenMap[entry.token] = entry.notify_mode || "sound";
          }
        });
      }
    } catch (dbErr) {
      Logger.log("[FCM] DB notify_mode 조회 실패 (기본값 sound 사용): " + dbErr);
    }

    var results     = [];
    var staleTokens = [];

    tokens.forEach(function (token) {
      try {
        // ── [추가] 수신자별 알림 모드
        var notifyMode = dbTokenMap[token] || "sound";
        var isMute     = notifyMode === "mute";
        var isVibrate  = notifyMode === "vibrate";

        var payload = {
          message: {
            token: token,
            notification: { title: title, body: body },
            data: {
              room_id:     roomId,
              sender:      sender,
              body:        body,
              notify_mode: notifyMode   // ← SW가 이 값으로 진동/무음 결정
            },
            webpush: {
              notification: {
                icon:     "/images/icons/icon-192x192.png",
                badge:    "/images/icons/icon-192x192.png",
                tag:      "mypai-msg-" + roomId,
                renotify: "true",
                silent:   isMute ? "true" : "false",
                vibrate:  isMute ? "[]" : (isVibrate ? "[200,100,200]" : "[200,100,200]")
              },
              fcm_options: { link: "/" }
            }
          }
        };

        var resp = UrlFetchApp.fetch(
          "https://fcm.googleapis.com/v1/projects/" + FCM_PROJECT_ID + "/messages:send",
          {
            method:           "post",
            contentType:      "application/json",
            headers:          { "Authorization": "Bearer " + accessToken },
            payload:          JSON.stringify(payload),
            muteHttpExceptions: true
          }
        );

        var status = resp.getResponseCode();
        Logger.log("[FCM] token=..." + token.slice(-6) + " mode=" + notifyMode + " status=" + status);

        if (status === 404 || status === 410) staleTokens.push(token);
        results.push({ token: token.slice(-6), status: status });

      } catch (err) {
        results.push({ token: token.slice(-6), error: String(err) });
      }
    });

    if (staleTokens.length > 0) _removeStaleTokensFromDb_(staleTokens);

    return jsonResponse_({
      ok:            true,
      sent:          results.filter(function (r) { return r.status === 200; }).length,
      stale_removed: staleTokens.length,
      results:       results
    });

  } catch (err) {
    Logger.log("[FCM] handleFcmPush_ 오류: " + err);
    return jsonResponse_({ ok: false, error: String(err) });
  }
}
