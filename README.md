# Cosmos
먼 먼 우주의 먼지 하나

## Cosmos 메모장

과학 명언과 함께하는 데스크톱 메모장입니다. (Electron, Windows · macOS · Linux)

Google Keep, Simplenote, Apple Notes에서 공통으로 쓰는 핵심 기능만 골라 담았고,
화면 하단에는 과학 명언이 **10분마다** 바뀌어 나타납니다.

### 기능

**창 (오른쪽 위 버튼 · 트레이 메뉴)**
- **항상 위에 표시**: 다른 창 위에 메모장을 띄워 둡니다.
- **창 접기**: 창을 제목 표시줄 높이로 줄이고, 다시 누르면 원래 크기로 펼칩니다.
- **트레이로 숨기기**: 작업 표시줄(macOS는 Dock)에서 사라지고 트레이 아이콘만 남습니다.
  트레이 아이콘을 클릭하거나 트레이 메뉴의 "메모장 열기"로 다시 엽니다.
- 창 위치·크기, 항상 위, 접힘 상태는 다음 실행 때도 유지됩니다.

**메모**
- 입력하는 즉시 자동 저장 (창을 닫기 직전 입력도 저장)
- 제목·본문·체크리스트 항목 전체 검색
- 고정: 중요한 메모를 목록 맨 위에 둡니다.
- 체크리스트: 완료 항목은 아래로 모이고, 일반 메모와 서로 변환할 수 있습니다.
  (Enter 새 항목, 빈 항목에서 Backspace 삭제, ↑/↓ 이동)
- 휴지통: 삭제 후 실행 취소, 복원, 영구 삭제. 30일이 지나면 자동으로 비워집니다.
- 테마: 시스템 설정 / 라이트 / 다크
- 내용 없이 만든 새 메모는 다른 메모로 넘어가면 자동으로 지워집니다.

**달력 · 주간/연간 정리** (1.1)
- 달력 탭: 기록이 있는 날에 점이 찍히고, 날짜를 누르면 그날 쓰거나 고친 메모와 완료한 할 일이 나옵니다.
- 주간 정리(월~일)·연간 정리: 새 메모·고친 메모·완료한 할 일·기록한 날 통계, 요일별/월별 기록, 남은 할 일.
- "메모로 저장"으로 정리 결과를 메모로 남길 수 있습니다. (정리 메모는 다음 통계에서 빠집니다)
- 1.1부터 "고친 날"과 "할 일을 완료한 시각"을 기록합니다. 1.0에서 쓴 메모는 만든 날·마지막 수정일만 반영됩니다.

**AI 요약 (선택)**
- 설정(⚙)에서 사내 LLM이나 Claude API를 연결하면 정리 화면에서 "AI 요약 만들기"를 쓸 수 있습니다.
- Anthropic(Claude) 형식과 OpenAI 호환 형식을 지원합니다. 사내 Claude Code 설정값을 그대로 옮기면 됩니다
  (설정 화면의 "사내 Claude Code 설정을 그대로 옮기는 방법" 참고).
- "보낼 내용 보기"로 서버에 보내는 내용을 미리 확인할 수 있습니다.
- API 키는 운영체제 보안 저장소로 암호화해 이 PC에만 저장합니다.
- 연결이 안 되면: 설정 → "연결 테스트", "로그 폴더 열기", "진단 정보 복사".
  개발자용 디버깅 안내는 [CLAUDE.md](CLAUDE.md)에 있습니다.

**과학 명언**
- 뉴턴, 아인슈타인, 퀴리, 세이건, 파인만 등의 명언 30개를 한국어로 보여 줍니다.
- 10분마다 바뀌며, 상단의 얇은 막대로 다음 교체까지 남은 시간을 보여 줍니다.
- 한 바퀴를 다 돌 때까지 같은 명언이 다시 나오지 않습니다. ↻ 버튼으로 바로 넘길 수 있습니다.
- 출처를 확인할 수 있는 명언만 넣었습니다.

**단축키**: `Ctrl+N` 새 메모 · `Ctrl+Shift+N` 새 체크리스트 · `Ctrl+F` 검색 · `Ctrl+S` 바로 저장 · `Ctrl+,` 설정 · `F12` 개발자 도구
(macOS는 `Ctrl` 대신 `Cmd`)

### 설치 (일반 사용자)

[Releases 페이지](https://github.com/chefin542/Cosmos/releases)에서 최신 `cosmos-notes-…-win-x64.exe`를 내려받아 실행하세요.
"Windows의 PC 보호" 창이 뜨면 **추가 정보 → 실행**을 누릅니다.

### 실행 (개발)

```bash
npm install
npm start          # 실행
npm run debug      # 개발자 도구를 연 채로 실행
npm run llm:check  # AI 연결만 터미널에서 확인
```

### 설치 파일 만들기

```bash
npm run dist:win     # Windows 설치 파일 (.exe)
npm run dist:mac     # macOS (.dmg) — macOS에서 실행
npm run dist:linux   # Linux (.AppImage)
```

결과물은 `dist/` 폴더에 생깁니다.

### 테스트

```bash
npm test
```

### 데이터 위치

메모는 사용자 데이터 폴더의 `cosmos-notes/notes.json`에, 설정은 `settings.json`에, 로그는 `logs/`에 저장됩니다.

| OS | 경로 |
| --- | --- |
| Windows | `%APPDATA%\cosmos-notes\` |
| macOS | `~/Library/Application Support/cosmos-notes/` |
| Linux | `~/.config/cosmos-notes/` |

### 구조

```
src/main/main.js       창 · 트레이 · 저장 (메인 프로세스)
src/main/store.js      JSON 파일 저장 (임시 파일에 쓴 뒤 교체)
src/preload.js         화면에 노출하는 안전한 API
src/main/llm.js        AI 연결 (Anthropic / OpenAI 호환 형식)
src/main/settings.js   설정 저장 (API 키 암호화)
src/main/logger.js     로그 파일
src/renderer/          화면 (index.html, styles.css, app.js, *-view.js)
src/renderer/notes.js  메모 데이터 처리 (정렬·검색·휴지통·변환·기록 날짜)
src/renderer/review.js 날짜별 기록·주간/연간 정리 계산
src/renderer/quotes.js 과학 명언과 10분 교체 로직
scripts/llm-check.js   AI 연결 진단 도구
scripts/make-icons.js  아이콘 PNG 생성
```

자세한 구조·데이터 형식·디버깅 방법은 [CLAUDE.md](CLAUDE.md)를 보세요.
