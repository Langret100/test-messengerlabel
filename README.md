# 마이파이 메신저(only) 패키지

이 압축파일은 **유저 간 실시간 대화(메신저)** 기능만 남긴 최소 구성입니다.

※ 참고: 이 zip에는 Apps Script 예시 파일(apps_script 폴더)을 포함하지 않았습니다. 필요하면 따로 추가해 드릴 수 있습니다.

## 사용 흐름
1) `index.html` 실행
2) 로그인/회원가입
3) 로그인 완료 후 메신저가 자동으로 갱신되어 바로 사용

## 포함된 것
- 로그인/회원가입 패널 (`js/login.js`, Apps Script 연동)
- 실시간 톡 화면 (`games/social-messenger.html`, `js/social-messenger.js`)
- 이모티콘 (`js/chat-emoji.js`, `images/emoticon/*`)
- 사진 보내기(📷) + 확대 보기 (`js/chat-photo.js`, `js/social-messenger.js`)
- 메신저 닫기 브릿지 (`js/messenger-close-bridge.js`)

## 제외된 것
- 게임/퀘스트/수첩/게시판/캐릭터/배경/기타 UI 및 모듈(메신저 외 전부)

## 파일 구성
- `index.html` : 메신저 전용 진입점(로그인 → 메신저)
- `js/config.js` : Apps Script 엔드포인트
- `js/ui.js` : `postToSheet()` 등 공용 헬퍼
- `js/login.js` : 로그인 패널
- `js/messenger-only.js` : 로그인 상태 감지 후 메신저 자동 연결/리로드
- `games/social-messenger.html` : 메신저 UI(iframe)
- `js/social-messenger.js` : **메시지는 시트에만 저장** + Firebase는 `signals` 트리거(알림/갱신)만 사용
- `js/chat-photo.js` : 사진 선택/촬영 → 리사이즈 → (선택) Apps Script 업로드
- `apps_script/*(별도)` : (이 zip에는 포함되지 않음 — 필요하면 별도로 추가)
- `images/*` : 로고/파비콘/이모티콘

## 개발/수정 규칙(요청사항 반영)
- **새 기능은 기존 파일에 덧붙이지 말고** 가능한 한 **별도 JS 파일로 분리**합니다(필요하면 폴더로 묶음).
- 추가/수정/삭제 시 이 README의 **변경 로그**에 기록합니다.
- 각 JS 파일 상단에
  - "이 파일이 하는 일"
  - "제거 시 함께 삭제/정리할 요소(HTML/CSS/이미지/스크립트 include 등)"
  를 주석으로 남깁니다.


## 변경 로그
### v9.3.17
- (UI/UX) 메신저 입력창 버튼(😊 / + / 보내기) 및 + 첨부 메뉴 버튼에서
  **롱프레스/우클릭 시 파란 하이라이트 + 컨텍스트 메뉴**가 뜨는 현상을 차단(일반 탭/클릭은 유지)
- 신규 모듈: `js/messenger-press-guard.js` 추가 + `games/social-messenger.html`에 include

### v9.3.16
- (UI) 메신저 상단의 X(닫기) 버튼 제거
- (UI) 상단 오른쪽에 **반투명 전체화면 전환 버튼** 추가(가능한 환경에서 Fullscreen API 토글)
- (입력) **보내기 버튼을 꾹 누르면 음성인식**(Web Speech API) → 텍스트가 입력창에 자동 입력
- 신규 모듈: `js/fullscreen-toggle.js`, `js/send-voice-hold.js` 추가 + `games/social-messenger.html`에 include

### v9.3.15
- (요구사항) + 첨부 메뉴에 **로그아웃** 버튼 추가

### v9.3.14 (fix28 메신저 업그레이드 적용)
- (성능/속도) 최근글 로딩/갱신 로직 보강(느린 응답 섞임 방지, 전송/갱신 체감 개선)
- (중복/정합) 시간값(ts) 파싱을 더 견고하게 처리 + 중복 중계(relay) 메시지 식별 보강
- (알림 표시) 방 목록에 **미확인 새 글 점 표시** 추가(방에 들어가 확인하면 자동 해제)
- (연동) 위 기능을 위해 `js/room-unread-badge.js` 신규 추가 + `games/social-messenger.html`에 CSS/스크립트 include 추가

### v9.3.12
- (중요) Firebase `socialChatRooms`에 메시지 본문을 **저장/구독하지 않음**(기록은 Google Sheet만)
- (실시간) Firebase는 `signals`만 사용: 수신 즉시 삭제 + 송신 측 60초 후 자동 삭제(잔존 최소화)
- (버그 수정) 최근 메시지가 0개일 때 화면이 '빈 회색'으로 남는 문제 수정(빈 안내 렌더)
- (갱신) signals 수신 시 현재 열려있는 방만 최근 30개를 짧게 갱신(속도 유지)

### v9.3.10
- (버그 수정) 사진 첨부가 깨져 보이는 경우(Drive 미리보기 링크/권한 문제 등) 대비:
  - 이미지 로드 실패 시 "📷 사진 열기" 링크로 자동 대체(사용자 경험 개선)
  - 시트 로그의 `[[IMG]]URL` 토큰도 이미지로 복원 렌더링(호환성)
- (서버) Apps Script 업로드 응답 URL을 **직접 보기 URL**로 반환하는 애드온(`ADDON_social_upload_directurl_v1.gs`) 추가

### v9.3.7
- (버그 수정) 시트/GS 응답의 메시지 필드명이 text/chatlog/message로 섞여 있을 때 말풍선이 비어 보이던 문제 수정
- (호환성) 시트 기록 요청 시 message + text를 함께 전송

### v9.3.4
- (복구) 기본 '전체 대화방(global)'을 방 목록에 항상 고정 표시(나가기 불가). 저장 위치는 시트 탭 '소통' 유지
- (요구사항) 마지막에 열었던 대화방을 다시 켤 때 자동 복원(ghostActiveRoomId 기반)
- (UI) 전체 대화방은 꾹 눌러 나가기 동작 비활성(오작동 방지)

### v9.3.3
- (UX 수정) 방을 선택하지 않은 상태에서 입력창이 '먹통'처럼 보이는 문제를 막기 위해 안내 카드 + "대화방 열기" 버튼 표시(`js/room-guard.js`)
- (UX 수정) 방 선택 전 텍스트/이모티콘 전송 시 명확한 안내 메시지 표시(방 선택 요구)

### v9.3.1
- (버그 수정) Firebase Anonymous Auth가 initializeApp 이전에 호출되어 실패/고착될 수 있는 경로 제거(ensureAnonAuth가 ensureFirebase 선행)
- (보완) 이미지/파일 전송 시에도 signals 신호(push) + lastMyTs 갱신 적용(텍스트와 동일)

- v9.3: 방 이동 시 Firebase 메시지 리스너(쿼리) 확실히 해제(RoomMessageStream) + signals 구독을 "내 소속 방"으로만 제한
- v9.2: 방 목록은 패널 열 때만 서버 갱신(social_rooms), 방 메시지는 방 입장 시에만 최근 30개 로딩(social_recent_room)
- v9.1: Firebase 익명 인증 자동 로그인(auth!=null 규칙 대응) + signals 기반 방별 알림(수신 즉시 삭제, lastMyTs/lastSeenTs)
- v1: 메신저 전용으로 재패키징(메신저 자동 진입)
- v7: 채팅 내 사진/미디어 메시지용 이미지 확대 보기 추가
- v8: 📷 버튼 추가(480x480 리사이즈) + 사진 메시지 기록/불러오기([[IMG]]URL)

### (유지보수) v8.1
- messenger-only.js: 중복 setTimeout 제거
- config.js / ui.js: 파일 상단 주석 표준화


### (유지보수) v8.1.2
- chat-emoji.js: 파일 상단 주석(경로/의존 파일) 정합성 정리
- messenger-only.js / messenger-close-bridge.js: 파일 상단 주석(제거 시 정리 요소) 표준화

### v8.2.0
- (요구사항) 📷 버튼 → + 버튼으로 변경, 첨부 메뉴(사진촬영/이미지 첨부/파일 첨부) 추가
- (요구사항) 파일 첨부 업로드(클라이언트 5MB 제한) 추가
- (요구사항) 이미지 업로드는 480x480 리사이즈(기존 유지) + 사진촬영/이미지첨부 분리
- (요구사항) 내 글(내 메시지) 바로 다음에 다른 사람이 글을 달면 알림음(띠리링) 재생
- js/chat-file.js / apps_script/ADDON_social_upload_file.gs(별도) 추가
- js/social-messenger.js: 파일 메시지 렌더링 + [[FILE]]URL|filename 기록/복원 + 알림음 트리거 + + 메뉴 연동

### v8.2.1
- 로그인 패널 관련 코드를 업로드한 `index.html` / `js/login.js` 기준으로 교체

### v8.2.2
- `js/login.js`: 런타임 오류 가능성을 줄이기 위해 로그인/회원가입 요청 로직을 Promise 기반으로 정리(디자인/기능 동일)
- `js/ui.js`: 현재 동작에 관여하지 않는 보드/게시판 UI 코드 제거, `postToSheet()`만 유지


### v8.2.3
- `js/modules/*` 폴더 제거: `attach-menu`, `notify-sound` 기능을 `js/social-messenger.js`로 통합
- `games/social-messenger.html`에서 modules 스크립트 include 제거


### v8.2.4
- (요구사항) + 버튼 첨부 메뉴에 **알림 설정(켜짐/꺼짐/차단됨 표시)** 항목 추가
- 알림 설정이 켜진 경우에만 알림음(띠리링) 재생 + (탭이 보이지 않을 때) 시스템 알림 표시 시도

### v8.2.7
- (요구사항) 이미 로그인 상태에서 로그인창을 1회 표시할 때, 로그인창 앞에 '로그인 완료!' 오버레이만 잠깐 보여주고 자동으로 닫힘(폼/로그아웃 버튼 노출 없음)

### v9.0.0
- (요구사항) **대화방 여러 개** 지원(대화방 목록/방 전환/방 생성/꾹 눌러 나가기)
- 기존 대화는 **전체 대화방(global)** 으로 유지(나가기 불가, 목록 1번 고정)
- 대화 기록은 스프레드시트 탭 **'대화방'** 1개에서 **가로(컬럼)로 방을 생성**하고, 각 방 메시지는 그 아래로 누적(샘플 Apps Script: `apps_script/CHAT_ROOMS_MESSENGER.gs(별도)`)
- 신규 모듈: `js/chat-rooms.js` 추가 + `games/social-messenger.html`, `js/social-messenger.js` 연동

### v9.0.1
- (요구사항) 상단바(마이파이 로고 왼쪽)에 **현재 대화방명 버튼** 추가 → 누를 때만 대화방 목록이 열리고, 기본은 채팅창을 넓게 보기
- `games/social-messenger.html`: 상단바 버튼/배경(#roomBackdrop) 및 CSS(슬라이드 패널) 추가
- 신규 모듈: `js/room-panel-toggle.js` 추가(방 목록 토글 + 현재 방명 자동 동기화)




### v9.0.2
- (요구사항) 대화방 입장 비밀번호(선택) 지원: 비밀번호로 1회 입장하면 참여자로 등록되어 다음부터 비번 없이 입장
- (수정) '대화방' 시트 구조: 5행에 password, 메시지는 6행부터 저장
- (수정) 대화방 목록은 모두 표시(초대 전용/비번 필요 상태 표시)

### v9.0.3
- (요구사항) '대화방' 시트에서 **A열 라벨열** 사용 지원: A1이 `room_id`이면 방 데이터는 B열부터 시작(자동 감지)
- (문서) README에 '대화방 시트 입력 방식' 정리
- (요구사항) 대화방 생성 시 **2명 조건 제거**(혼자도 생성 가능) + **초대 기능 제거**
- (요구사항) 방 입장은 **방 목록에서 선택해서 입장**(자동 입장 제거)
- (요구사항) 1인당 생성 가능한 방 **최대 3개 제한**(4번째 시도 시 생성 불가)
- (요구사항) 내 메시지에서는 **닉네임 표시 제거**, 작성시간은 **말풍선 반대쪽(좌측)으로** 표시
- (요구사항) 채팅 텍스트에서 **URL 자동 하이퍼링크**(http(s)://, www.)
- (요구사항) 유튜브 링크는 **썸네일 미리보기 카드** 표시(oEmbed로 제목 시도, 실패 시 기본 제목)
- (요구사항) + 첨부 메뉴에 **QR 링크 스캔** 추가(카메라로 QR 인식 → 링크를 메시지로 전송)

## 대화방 시트 입력 방식
- A열에 `room_id / title / members / created_at / password / --- messages ---` 같은 라벨을 두고 싶으면, **방 데이터는 B열부터** 쓰면 됩니다(라벨열 자동 감지).
- 라벨을 안 둘 거면, **A열부터** 바로 방 데이터(1~5행 메타, 6행~ 메시지)를 쓰면 됩니다.

### v9.3.2
- (요구사항) Firebase Auth(익명 sign-in) 사용하지 않음: `signInAnonymously()` 호출 제거(Realtime DB는 공개 규칙 기반 relay로만 사용)
- (요구사항) 방 입장 시 **members**(3행) 자동 등록: `social_room_enter` 호출로 멤버 추가
- (요구사항) 이미 멤버인 경우 비밀번호 재입력 없이 입장(목록에서 멤버 여부로 판단)
- (요구사항) 방에서 마지막 멤버가 나가면 **방 컬럼 전체 삭제**
- (성능) 메시지 기록/읽기에서 컬럼별 lastRow 캐시(`WG_LASTROW_<roomId>`) 사용 → 누적 메시지 많아져도 느려지지 않게 개선
- (성능) 최근 메시지는 방 선택 시에만 **최근 30개**만 로딩, 선택되지 않은 방의 메시지는 불러오지 않음
- (시트) 공개방은 members 셀에 `public|` 접두어를 사용(멤버 목록을 유지하면서도 공개방 판별 가능)
