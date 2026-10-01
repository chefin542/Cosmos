const path = require('path');
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  nativeImage,
  nativeTheme,
  screen,
} = require('electron');
const { readJson, writeJson, isNotesData } = require('./store');

const TITLEBAR_HEIGHT = 40;
const MIN_WIDTH = 520;
const MIN_HEIGHT = 360;
const ASSETS = path.join(__dirname, '..', '..', 'assets');

app.setPath(
  'userData',
  process.env.COSMOS_USER_DATA || path.join(app.getPath('appData'), 'cosmos-notes'),
);
const NOTES_FILE = path.join(app.getPath('userData'), 'notes.json');
const WINDOW_FILE = path.join(app.getPath('userData'), 'window-state.json');

let win = null;
let tray = null;
let winState = readJson(WINDOW_FILE, {});
let saveWindowTimer = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(() => {
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
  writeJson(NOTES_FILE, data);
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
