# 메신저 업데이트 안내

## 변경 사항 요약

### 1. 메시지 저장/로딩 → Firebase (빠른 실시간)
- **기존**: 매번 구글 시트에서 전체 데이터 로딩 (느림)
- **변경**: Firebase Realtime DB에서 실시간 구독 (빠름)
- **백업**: 구글 시트에는 여전히 메시지 기록 저장됨 (백업 유지)

### 2. 30일 자동 정리
- Firebase에 저장된 메시지 중 30일 이전 것은 자동 삭제
- 구글 시트 백업 데이터는 삭제 없이 그대로 유지

### 3. 카톡 스타일 UI
- 모든 메시지에 **보낸이 이름 + 시간** 표시
- 상대방 메시지에 **프로필 아바타** 표시 (원형)
- 날짜별 구분선 표시

### 4. 프로필 이미지
- 상단 **⚙ 기어 버튼** 클릭 → 프로필 설정 모달
- 프로필 이미지: Google Drive에 저장 (`messenger_profiles` 폴더)
- 로컬 캐시: 처음 로딩 후 기기에 저장 → 재접속 시 즉시 표시
- 기본 프로필: 보라색 실루엣 아이콘

### 5. 배경 이미지 (개인별)
- ⚙ 버튼 → "채팅 배경" 에서 본인 기기 이미지 선택
- Drive 저장 없이 로컬에만 저장 (개인 기기 전용)
- 배경 위에 반투명 오버레이 적용 (가독성 유지)

---

## 적용 방법

### Step 1: 새 JS 파일 추가
아래 파일 2개가 새로 추가됩니다:
- `js/firebase-messages.js` — Firebase 메시지 저장/로딩
- `js/profile-manager.js` — 프로필 이미지 관리

### Step 2: Apps Script 수정
`APPSSCRIPT_PATCH.js` 파일을 참고하여 기존 Apps Script에
`social_upload_profile` case를 추가하세요.

### Step 3: Firebase 규칙 설정
`APPSSCRIPT_PATCH.js` 하단의 Firebase 보안 규칙을 확인하고
Firebase Console에서 적용하세요.

---

## 파일 구조 변경

```
js/
  firebase-messages.js   ← 신규: Firebase 메시지 모듈
  profile-manager.js     ← 신규: 프로필 관리 모듈
  social-messenger.js    ← 수정: Firebase 기반으로 재작성
  chat-photo.js          ← 수정: openCamera/openGallery 추가
  chat-file.js           ← 수정: open() 메서드 추가
games/
  social-messenger.html  ← 수정: 새 스크립트 include + CSS 추가
APPSSCRIPT_PATCH.js      ← 신규: Apps Script 추가 코드 안내
```
