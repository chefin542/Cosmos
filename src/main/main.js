const path = require('path');
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  nativeImage,
  nativeTheme,
  net,
  safeStorage,
  screen,
  shell,
} = require('electron');
const os = require('os');
const { readJson, writeJson, isNotesData } = require('./store');
const { configurePaths } = require('./paths');
const { createLogger } = require('./logger');
const { loadSettings, saveSettings, publicSettings, pickLlm } = require('./settings');
const llm = require('./llm');
const { importClaudeSettings } = require('./claude-import');

const TITLEBAR_HEIGHT = 40;
const MIN_WIDTH = 520;
const MIN_HEIGHT = 360;
const ASSETS = path.join(__dirname, '..', '..', 'assets');

const PATHS = configurePaths(app);
const NOTES_FILE = PATHS.notesFile;
const WINDOW_FILE = PATHS.windowFile;
// npm run debug (또는 COSMOS_DEBUG=1) 로 실행하면 개발자 도구가 열린 채로 시작한다.
const DEBUG = process.env.COSMOS_DEBUG === '1' || process.argv.includes('--cosmos-debug');
const log = createLogger(PATHS.logDir);
let lastLlmError = null;

process.on('uncaughtException', (err) => log.error('처리되지 않은 오류', { message: err.message, stack: err.stack }));
process.on('unhandledRejection', (err) => log.error('처리되지 않은 Promise 오류', { message: String(err?.message || err), stack: err?.stack }));

let win = null;
let tray = null;
let winState = readJson(WINDOW_FILE, {});
let saveWindowTimer = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(() => {
    log.info('앱 시작', { version: app.getVersion(), electron: process.versions.electron, os: `${os.platform()} ${os.release()}`, userData: PATHS.userData });
    setupMenu();
    setupIpc();
    createWindow();
    createTray();
  });
  app.on('window-all-closed', () => app.quit());
}

// ---------------------------------------------------------------- 창

function restoredBounds() {
  const b = winState.bounds;
  if (!b) return { width: 960, height: 640 };
  const height = winState.collapsed ? winState.expandedHeight || 640 : b.height;
  const bounds = { x: b.x, y: b.y, width: b.width, height };
  // 저장된 위치가 현재 연결된 모니터 밖이면 위치는 버리고 크기만 쓴다.
  const area = screen.getDisplayMatching(bounds).workArea;
  const visible =
    bounds.x < area.x + area.width &&
    bounds.x + bounds.width > area.x &&
    bounds.y < area.y + area.height &&
    bounds.y + TITLEBAR_HEIGHT > area.y;
  return visible ? bounds : { width: bounds.width, height: bounds.height };
}

function createWindow() {
  win = new BrowserWindow({
    ...restoredBounds(),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    frame: false,
    show: false,
    title: 'Cosmos 메모장',
    icon: path.join(ASSETS, 'icon.png'),
    alwaysOnTop: Boolean(winState.alwaysOnTop),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16181d' : '#f7f7f5',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  setupDebugging(win.webContents);

  win.once('ready-to-show', () => {
    if (winState.collapsed) {
      winState.collapsed = false;
      setCollapsed(true);
    }
    win.show();
  });

  for (const evt of ['maximize', 'unmaximize', 'show', 'hide', 'always-on-top-changed']) {
    win.on(evt, () => {
      sendState();
      updateTrayMenu();
    });
  }
  win.on('resize', scheduleWindowSave);
  win.on('move', scheduleWindowSave);
  win.on('close', saveWindowState);
  win.on('closed', () => {
    win = null;
  });
}

function windowStatus() {
  return {
    alwaysOnTop: Boolean(win?.isAlwaysOnTop()),
    collapsed: Boolean(winState.collapsed),
    maximized: Boolean(win?.isMaximized()),
    platform: process.platform,
  };
}

function sendState() {
  if (win && !win.isDestroyed()) win.webContents.send('win:state', windowStatus());
}

function scheduleWindowSave() {
  clearTimeout(saveWindowTimer);
  saveWindowTimer = setTimeout(saveWindowState, 500);
}

function saveWindowState() {
  clearTimeout(saveWindowTimer);
  if (!win || win.isDestroyed()) return;
  if (!win.isMaximized() && !win.isMinimized()) winState.bounds = win.getBounds();
  winState.alwaysOnTop = win.isAlwaysOnTop();
  try {
    writeJson(WINDOW_FILE, winState);
  } catch (err) {
    console.error('[window] 상태 저장 실패:', err.message);
  }
}

function setAlwaysOnTop(on) {
  if (!win) return;
  win.setAlwaysOnTop(on);
  saveWindowState();
  sendState();
  updateTrayMenu();
}

// 접기: 창을 제목 표시줄 높이로 줄인다. 펼치면 원래 높이로 돌아간다.
function setCollapsed(collapsed) {
  if (!win || collapsed === Boolean(winState.collapsed)) return;
  if (collapsed) {
    if (win.isMaximized()) win.unmaximize();
    const b = win.getBounds();
    winState.expandedHeight = b.height;
    win.setMinimumSize(MIN_WIDTH, TITLEBAR_HEIGHT);
    win.setBounds({ ...b, height: TITLEBAR_HEIGHT });
    win.setResizable(false);
    win.setMaximizable(false);
  } else {
    const b = win.getBounds();
    win.setResizable(true);
    win.setMaximizable(true);
    win.setMinimumSize(MIN_WIDTH, MIN_HEIGHT);
    win.setBounds({ ...b, height: Math.max(MIN_HEIGHT, winState.expandedHeight || 640) });
  }
  winState.collapsed = collapsed;
  saveWindowState();
  sendState();
  updateTrayMenu();
}

// 트레이로 숨기기: 작업 표시줄(macOS는 Dock)에서도 사라지고 트레이 아이콘만 남는다.
function hideToTray() {
  if (!win) return;
  win.setSkipTaskbar(true);
  win.hide();
  app.dock?.hide();
}

function showWindow() {
  if (!win) return;
  win.setSkipTaskbar(false);
  app.dock?.show();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// ---------------------------------------------------------------- 트레이

function createTray() {
  const icon = nativeImage.createFromPath(path.join(ASSETS, 'tray.png'));
  tray = new Tray(icon);
  tray.setToolTip('Cosmos 메모장');
  tray.on('click', () => (win?.isVisible() ? hideToTray() : showWindow()));
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;
  const visible = Boolean(win?.isVisible());
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: visible ? '트레이로 숨기기' : '메모장 열기',
        click: () => (visible ? hideToTray() : showWindow()),
      },
      {
        label: '새 메모',
        click: () => {
          showWindow();
          if (winState.collapsed) setCollapsed(false);
          win?.webContents.send('app:new-note');
        },
      },
      { type: 'separator' },
      {
        label: '항상 위에 표시',
        type: 'checkbox',
        checked: Boolean(win?.isAlwaysOnTop()),
        click: (item) => setAlwaysOnTop(item.checked),
      },
      {
        label: '창 접기',
        type: 'checkbox',
        checked: Boolean(winState.collapsed),
        click: (item) => setCollapsed(item.checked),
      },
      { type: 'separator' },
      { label: '종료', click: () => app.quit() },
    ]),
  );
}

// ---------------------------------------------------------------- 메뉴

function setupMenu() {
  // macOS는 복사/붙여넣기 단축키가 편집 메뉴에 묶여 있어서 메뉴가 필요하다.
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }]));
  } else {
    Menu.setApplicationMenu(null);
  }
}

// ---------------------------------------------------------------- IPC

function fromOurWindow(event) {
  return Boolean(win) && event.sender === win.webContents;
}

function saveNotes(data) {
  if (!isNotesData(data)) throw new Error('잘못된 메모 데이터입니다.');
  try {
    writeJson(NOTES_FILE, data);
  } catch (err) {
    log.error('메모 저장 실패', { message: err.message });
    throw err;
  }
}

// ---------------------------------------------------------------- 디버깅

// F12 또는 Ctrl+Shift+I: 개발자 도구. 화면(렌더러)의 오류는 로그 파일에도 남긴다.
function setupDebugging(contents) {
  contents.on('before-input-event', (event, input) => {
    const devtools =
      input.type === 'keyDown' &&
      (input.key === 'F12' || ((input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i'));
    if (devtools) {
      contents.toggleDevTools();
      event.preventDefault();
    }
  });
  contents.on('console-message', (...args) => {
    // Electron 버전에 따라 (event) 또는 (event, level, message, line, sourceId) 형태로 온다.
    const e = args[0];
    const level = typeof e.level === 'string' ? e.level : ['debug', 'info', 'warning', 'error'][args[1]];
    if (level !== 'error') return;
    const message = e.message ?? args[2];
    const where = `${e.sourceId ?? args[4] ?? ''}:${e.lineNumber ?? args[3] ?? ''}`;
    log.error('화면 오류', { message, where });
  });
  contents.on('render-process-gone', (_e, details) => log.error('화면 프로세스 종료', details));
  if (DEBUG) contents.openDevTools({ mode: 'detach' });
}

// 설정 → "진단 정보 복사". 사내 Claude Code 등에 붙여 넣어 문제를 설명할 때 쓴다.
function diagnostics() {
  const settings = loadSettings(PATHS.settingsFile, safeStorage).llm;
  return [
    '# Cosmos 메모장 진단 정보',
    `- 앱 버전: ${app.getVersion()} (Electron ${process.versions.electron}, Chrome ${process.versions.chrome})`,
    `- OS: ${os.platform()} ${os.release()} ${os.arch()}`,
    `- 데이터 폴더: ${PATHS.userData}`,
    `- 로그 파일: ${log.file}`,
    `- 키 암호화 사용 가능: ${safeStorage.isEncryptionAvailable()}`,
    '',
    '## AI 연결 설정 (키 값 제외)',
    '```json',
    JSON.stringify(llm.describe(settings), null, 2),
    '```',
    '',
    '## 마지막 AI 오류',
    lastLlmError ? ['```json', JSON.stringify(lastLlmError, null, 2), '```'].join('\n') : '없음',
  ].join('\n');
}

function setupIpc() {
  ipcMain.handle('data:load', (event) => {
    if (!fromOurWindow(event)) return null;
    return readJson(NOTES_FILE, null);
  });

  ipcMain.handle('data:save', (event, data) => {
    if (!fromOurWindow(event)) return false;
    saveNotes(data);
    return true;
  });

  // 창이 닫히기 직전(beforeunload)에 쓰는 동기 저장
  ipcMain.on('data:save-sync', (event, data) => {
    if (!fromOurWindow(event)) {
      event.returnValue = false;
      return;
    }
    try {
      saveNotes(data);
      event.returnValue = true;
    } catch (err) {
      console.error('[data] 저장 실패:', err.message);
      event.returnValue = false;
    }
  });

  ipcMain.handle('win:get-state', (event) => (fromOurWindow(event) ? windowStatus() : null));

  // ---- 설정 · AI 연결
  ipcMain.handle('settings:get', (event) => {
    if (!fromOurWindow(event)) return null;
    return publicSettings(loadSettings(PATHS.settingsFile, safeStorage));
  });

  // apiKey 가 빈 문자열이면 저장된 키를 그대로 둔다. clearKey 가 true면 지운다.
  ipcMain.handle('settings:save', (event, incoming) => {
    if (!fromOurWindow(event)) return null;
    const current = loadSettings(PATHS.settingsFile, safeStorage);
    const next = pickLlm(incoming?.llm);
    next.apiKey = incoming?.llm?.clearKey ? '' : incoming?.llm?.apiKey || current.llm.apiKey;
    saveSettings(PATHS.settingsFile, { llm: next }, safeStorage);
    log.info('AI 연결 설정 저장', llm.describe(next));
    return publicSettings({ llm: next });
  });

  // purpose: 'test'(연결 테스트) | 'summary'(정리 요약). 테스트는 저장 전 입력값으로도 할 수 있다.
  ipcMain.handle('llm:complete', async (event, { purpose, request, draft } = {}) => {
    if (!fromOurWindow(event)) return null;
    const saved = loadSettings(PATHS.settingsFile, safeStorage).llm;
    let settings = saved;
    if (draft) {
      settings = pickLlm(draft);
      settings.apiKey = draft.apiKey || saved.apiKey;
    }
    const req = purpose === 'test' ? llm.TEST_REQUEST : request;
    if (typeof req?.system !== 'string' || typeof req?.prompt !== 'string') {
      return { ok: false, error: { kind: 'config', message: '잘못된 요청입니다.' } };
    }
    const info = { purpose, ...llm.describe(settings), promptChars: req?.prompt?.length ?? 0 };
    log.info('AI 요청 시작', info);
    try {
      const result = await llm.complete(settings, req, { fetch: net.fetch });
      log.info('AI 요청 성공', { purpose, ms: result.ms, model: result.model, stopReason: result.stopReason, usage: result.usage });
      lastLlmError = null;
      return { ok: true, text: result.text, model: result.model, truncated: result.truncated, ms: result.ms };
    } catch (err) {
      const e = err instanceof llm.LlmError ? err.toJSON() : { kind: 'unknown', message: `예상하지 못한 오류: ${err.message}`, detail: err.stack };
      lastLlmError = { at: new Date().toISOString(), ...info, ...e };
      log.error('AI 요청 실패', lastLlmError);
      return { ok: false, error: e };
    }
  });

  // 서버의 모델 목록 (GET /v1/models). draft 는 저장 전 입력값.
  ipcMain.handle('llm:models', async (event, { draft } = {}) => {
    if (!fromOurWindow(event)) return null;
    const saved = loadSettings(PATHS.settingsFile, safeStorage).llm;
    const settings = draft ? { ...pickLlm(draft), apiKey: draft.apiKey || saved.apiKey } : saved;
    try {
      const models = await llm.listModels(settings, { fetch: net.fetch });
      log.info('모델 목록 받음', { count: models.length, ...llm.describe(settings) });
      return { ok: true, models };
    } catch (err) {
      const e = err instanceof llm.LlmError ? err.toJSON() : { kind: 'unknown', message: err.message };
      log.warn('모델 목록 실패', { ...llm.describe(settings), ...e });
      return { ok: false, error: e };
    }
  });

  // "Claude Code 설정 가져오기": 찾은 값을 현재 설정에 합쳐 바로 저장한다.
  // 키는 화면으로 보내지 않고 main 에서 저장만 한다.
  ipcMain.handle('claude:import', (event) => {
    if (!fromOurWindow(event)) return null;
    const result = importClaudeSettings();
    const current = loadSettings(PATHS.settingsFile, safeStorage).llm;
    const { found } = result;
    const foundSomething = Boolean(found.baseURL || found.apiKey || found.model);
    if (foundSomething) {
      const next = { ...current, enabled: true, format: found.format };
      for (const key of ['baseURL', 'apiKey', 'authType', 'model', 'extraHeaders']) {
        if (found[key] !== undefined) next[key] = found[key];
      }
      saveSettings(PATHS.settingsFile, { llm: next }, safeStorage);
    }
    log.info('Claude 설정 가져오기', { sources: result.sources, notes: result.notes, models: result.models.length });
    return {
      saved: foundSomething,
      settings: publicSettings(loadSettings(PATHS.settingsFile, safeStorage)),
      models: result.models,
      sources: result.sources,
      notes: result.notes,
    };
  });

  // ---- 문제 해결
  ipcMain.handle('app:open-logs', async (event) => {
    if (!fromOurWindow(event)) return null;
    const fs = require('fs');
    fs.mkdirSync(PATHS.logDir, { recursive: true });
    return shell.openPath(PATHS.logDir);
  });

  ipcMain.handle('app:diagnostics', (event) => {
    if (!fromOurWindow(event)) return null;
    return diagnostics();
  });

  const actions = {
    'toggle-always-on-top': () => setAlwaysOnTop(!win.isAlwaysOnTop()),
    'toggle-collapse': () => setCollapsed(!winState.collapsed),
    'hide-to-tray': hideToTray,
    minimize: () => win.minimize(),
    'toggle-maximize': () => {
      if (winState.collapsed) return;
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    },
    close: () => app.quit(),
  };
  ipcMain.on('win:action', (event, name) => {
    if (fromOurWindow(event) && Object.hasOwn(actions, name)) actions[name]();
  });
}
