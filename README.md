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

**과학 명언**
- 뉴턴, 아인슈타인, 퀴리, 세이건, 파인만 등의 명언 30개를 한국어로 보여 줍니다.
- 10분마다 바뀌며, 상단의 얇은 막대로 다음 교체까지 남은 시간을 보여 줍니다.
- 한 바퀴를 다 돌 때까지 같은 명언이 다시 나오지 않습니다. ↻ 버튼으로 바로 넘길 수 있습니다.
- 출처를 확인할 수 있는 명언만 넣었습니다.

**단축키**: `Ctrl+N` 새 메모 · `Ctrl+Shift+N` 새 체크리스트 · `Ctrl+F` 검색 · `Ctrl+S` 바로 저장
(macOS는 `Ctrl` 대신 `Cmd`)

### 실행

```bash
npm install
npm start
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

메모는 사용자 데이터 폴더의 `cosmos-notes/notes.json`에 저장됩니다.

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
src/renderer/          화면 (index.html, styles.css, app.js)
src/renderer/notes.js  메모 데이터 처리 (정렬·검색·휴지통·변환)
src/renderer/quotes.js 과학 명언과 10분 교체 로직
scripts/make-icons.js  아이콘 PNG 생성
```
