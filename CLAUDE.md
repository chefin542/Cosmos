# CLAUDE.md — Cosmos 메모장 개발·디버깅 안내

Electron 데스크톱 메모장. 화면 문구와 주석은 한국어로 쓴다.
빌드 단계가 없다: 화면 코드는 브라우저용 ES 모듈 그대로, main 프로세스는 CommonJS 그대로 실행된다.

## 명령

```bash
npm install          # 처음 한 번
npm start            # 앱 실행
npm run debug        # 개발자 도구를 연 채로 실행 (앱 안에서는 F12 / Ctrl+Shift+I)
npm test             # 단위 테스트 (node --test, 앱을 띄우지 않음)
npm run llm:check    # 앱 없이 AI 연결만 확인. 아래 "AI 연결 디버깅" 참고
npm run dist:win     # Windows 설치 파일 → dist/
```

변경 후에는 `npm test`를 돌린다. 순수 로직(`notes.js`, `review.js`, `llm.js`, `settings.js`)을 고치면 `test/`에 테스트를 더한다.

## 구조

```
src/main/main.js        창·트레이·IPC·로그 연결 (main 프로세스 진입점)
src/main/llm.js         LLM 호출. Anthropic 형식(@anthropic-ai/sdk) / OpenAI 호환 형식(fetch). electron 을 import 하지 않음
src/main/settings.js    settings.json 읽기/쓰기, API 키 암호화(safeStorage)
src/main/store.js       JSON 파일 원자적 저장 (임시 파일 → rename)
src/main/logger.js      logs/cosmos.log, 비밀 값 가리기(redact)
src/main/paths.js       데이터 파일 위치 (COSMOS_USER_DATA 로 바꿀 수 있음)
src/preload.js          화면에 노출하는 API: window.cosmos.*
src/renderer/app.js     화면 상태·메모 목록·편집기·체크리스트·명언 바, 다른 화면 모듈 연결(ctx)
src/renderer/calendar-view.js   사이드바 "달력" 탭
src/renderer/review-view.js     주간·연간 정리 화면 + AI 요약 버튼
src/renderer/settings-view.js   설정 화면 (테마, AI 연결, 문제 해결)
src/renderer/notes.js   메모 데이터 순수 함수 (정렬·검색·휴지통·변환·기록 날짜)
src/renderer/review.js  날짜별 기록·주간/연간 집계·AI 프롬프트 만들기 (순수 함수)
src/renderer/quotes.js  과학 명언과 10분 교체 로직
scripts/llm-check.js    터미널용 AI 연결 진단 (Electron main 으로 실행)
scripts/make-icons.js   아이콘 PNG 생성
.github/workflows/build-windows.yml   push 하면 Windows 설치 파일을 만들어 Releases 에 올림
```

화면(renderer)은 `sandbox: true`, `contextIsolation: true` 라서 Node API를 못 쓴다.
파일·네트워크·LLM 은 모두 main 프로세스에서 하고, 화면은 `window.cosmos.*`(preload)로 요청한다.
CSP 때문에 인라인 `<script>`와 외부 리소스는 쓸 수 없다.

## IPC 채널 (preload.js ↔ main.js)

| window.cosmos.*      | 채널               | 하는 일 |
|----------------------|--------------------|---------|
| loadData / saveData / saveDataSync | data:load / data:save / data:save-sync | notes.json 읽기·쓰기 (창 닫힐 때는 동기 저장) |
| getSettings / saveSettings | settings:get / settings:save | AI 설정. 화면에는 키 대신 `hasKey` 만 보낸다 |
| llmComplete({purpose, request, draft}) | llm:complete | purpose `test`(연결 테스트, draft=저장 전 입력값) / `summary`(request={system,prompt}). 결과 `{ok, text}` 또는 `{ok:false, error:{kind,message,status,detail}}` |
| openLogs / getDiagnostics | app:open-logs / app:diagnostics | 로그 폴더 열기 / 진단 정보 텍스트 |
| windowAction(name) | win:action | toggle-always-on-top, toggle-collapse, hide-to-tray, minimize, toggle-maximize, close |

## 데이터 파일 (사용자 데이터 폴더)

Windows `%APPDATA%\cosmos-notes\`, macOS `~/Library/Application Support/cosmos-notes/`, Linux `~/.config/cosmos-notes/`.
`COSMOS_USER_DATA=<폴더>` 환경 변수로 다른 폴더를 쓸 수 있다 (테스트용).

- `notes.json` — `{ version, prefs: { theme }, notes: [...] }`
  - note: `id, type('text'|'checklist'), kind('note'|'review'), title, body, items[], pinned, createdAt, updatedAt, editDays[], deletedAt`
  - item: `id, text, done, doneAt`
  - `editDays`: 쓰거나 고친 날짜 키(`YYYY-MM-DD`, 로컬 시간). 달력·정리의 기준. `markEdited()`로만 갱신한다.
  - `doneAt`: 완료 시각. 날짜를 모르면 null (1.0 데이터, 일반 메모→체크리스트 변환으로 생긴 [x] 항목).
  - `kind: 'review'`: 정리 결과를 저장한 메모. 달력·정리 통계에서 뺀다.
  - 읽을 때 `normalizeData()`가 모든 필드를 검증·보정한다. 형식을 바꾸면 여기서 옛 데이터를 변환한다.
- `settings.json` — `{ llm: { enabled, format, baseURL, authType, model, maxTokens, timeoutSec, extraHeaders, apiKeyEnc | apiKeyPlain } }`
  - 키는 safeStorage(Windows DPAPI 등)로 암호화한 `apiKeyEnc`. 암호화를 못 쓰는 환경에서만 `apiKeyPlain`.
- `window-state.json` — 창 위치·크기·항상 위·접힘 상태
- `logs/cosmos.log` — 1MB 넘으면 `cosmos.log.1` 로 넘어감

## AI 연결 디버깅

흐름: `review-view.js` → `window.cosmos.llmComplete` → `main.js` `llm:complete` → `llm.complete()` → 서버.
main 프로세스는 Electron `net.fetch`(Chromium 네트워크: 시스템 프록시·OS 인증서 저장소 사용)로 요청한다.

1. 사용자에게 설정 → "진단 정보 복사" 결과를 받는다 (키는 들어 있지 않음, 마지막 오류 포함).
2. `logs/cosmos.log`에서 `AI 요청 시작/성공/실패` 줄을 본다. 프롬프트 본문은 기록하지 않고 길이만 남긴다.
3. 터미널에서 같은 설정으로 재현한다:
   ```bash
   npm run llm:check                        # 저장된 설정으로 연결 테스트
   npm run llm:check -- "한 줄로 자기소개해"  # 원하는 질문
   # 환경 변수로 덮어쓰기 (저장된 설정보다 우선)
   COSMOS_LLM_BASE_URL=https://llm.example.com COSMOS_LLM_MODEL=model-name \
   COSMOS_LLM_API_KEY=... COSMOS_LLM_AUTH=bearer COSMOS_LLM_FORMAT=anthropic npm run llm:check
   ```
   (Windows PowerShell: `$env:COSMOS_LLM_MODEL="..."; npm run llm:check`)

오류 종류(`error.kind`)별로 흔한 원인:

| kind | 흔한 원인 |
|------|-----------|
| config | 모델/키/주소 누락, 주소가 http(s):// 로 시작하지 않음, 추가 헤더 형식 오류 |
| auth (401/403) | 키 오류, 인증 방식 불일치 — Claude Code 의 `ANTHROPIC_AUTH_TOKEN`은 Bearer, `ANTHROPIC_API_KEY`는 x-api-key |
| not_found (404) | Anthropic 형식인데 주소 끝에 `/v1`을 붙임(SDK가 `/v1/messages`를 붙인다), 형식을 잘못 고름, 모델 이름 오류 |
| bad_request (400) | 모델이 max_tokens 값을 허용하지 않음, 게이트웨이가 요구하는 헤더 누락 |
| network | 사내망/VPN 미연결, 사내 인증서·프록시 문제, 주소 오타 |
| timeout | 서버가 느림 → 고급 설정의 시간 제한을 늘린다 |
| bad_response | 답이 비어 있음(출력 토큰 부족 — thinking 모델은 max_tokens를 넉넉히), OpenAI 형식에서 JSON 이 아닌 응답 |

새 LLM 형식이나 헤더가 필요하면 `src/main/llm.js`만 고치고 `test/llm.test.js`에 가짜 서버 테스트를 더한다.

## 규칙

- API 키·토큰을 로그, 진단 정보, 화면, 오류 메시지에 남기지 않는다. 로그에 객체를 남길 때는 logger 가 `redact()`한다.
- 화면 문구·오류 메시지는 한국어로, 사용자가 다음에 할 일을 알려 주게 쓴다.
- 날짜 키는 항상 `notes.js`의 `dayKey()`(로컬 시간)로 만든다. 한 주는 월요일 시작, 주차는 ISO 8601.
- 한글 입력 중(IME 조합)에는 Enter 처리를 하지 않는다 (`e.isComposing || e.keyCode === 229`).
- 릴리스: `package.json`의 version 을 올려 push 하면 GitHub Actions 가 `v<version>` 릴리스에 Windows 설치 파일을 올린다.
