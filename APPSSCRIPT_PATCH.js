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
