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
