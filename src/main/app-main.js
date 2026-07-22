const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');
const { registerHandlers, cleanup } = require('./ipc-handlers');
const store = require('./data/store');
const nicknameGenerator = require('./core/nickname-generator');
const updater = require('../updater');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'N Cafe Auto',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // 파일 드래그앤드롭 수신을 위해 sandbox 비활성화 (Electron 30 기본 true)
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  registerHandlers(mainWindow);

  // 파일 드래그드롭 시 브라우저가 file:// URL로 네비게이션하는 기본 동작 차단
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file://') && !url.endsWith('index.html')) {
      console.log('[main] 파일 URL 네비게이션 차단:', url);
      event.preventDefault();
    }
  });
  // 드롭으로 새 창을 여는 시도도 차단
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    console.log('[main] 새 창 열기 차단:', url);
    return { action: 'deny' };
  });

  // 개발 모드(패키징 안 됨)에서는 DevTools 자동 오픈 — 드래그앤드롭 등 디버깅 용이
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // F12 / Ctrl+Shift+I 로 DevTools 토글 (기본 메뉴가 없어도 작동)
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.type !== 'keyDown') return;
    const isF12 = input.key === 'F12';
    const isCtrlShiftI = input.control && input.shift && (input.key === 'I' || input.key === 'i');
    if (isF12 || isCtrlShiftI) {
      if (mainWindow.webContents.isDevToolsOpened()) {
        mainWindow.webContents.closeDevTools();
      } else {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
      }
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// --- 자동 업데이트 ---
function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('update:available', { version: info.version });
  });

  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('update:progress', { percent: Math.round(progress.percent) });
  });

  autoUpdater.on('update-downloaded', (info) => {
    mainWindow?.webContents.send('update:downloaded', { version: info.version });
  });

  autoUpdater.on('update-not-available', () => {
    mainWindow?.webContents.send('update:notAvailable');
  });

  autoUpdater.on('error', (err) => {
    console.error('업데이트 오류:', err.message);
    mainWindow?.webContents.send('update:error', { message: err.message });
  });

  autoUpdater.checkForUpdatesAndNotify();
}

// --- 코드스왑 자동 업데이트 (자체 서버, electron-updater 와 공존) ---
// 지금 실행 중인 코드의 버전(내장이면 asar, 코드스왑본이면 그 버전).
// app.getVersion() 은 항상 asar 버전이라 코드스왑 적용 후 잘못 비교된다 → 실행 코드의 package.json 을 읽는다.
function runningCodeVersion() {
  try {
    return require(path.join(__dirname, '..', '..', 'package.json')).version;
  } catch {
    return app.getVersion();
  }
}

function codeUpdateServerUrl() {
  try {
    const s = store.loadSettings();
    if (s && typeof s.updateServerUrl === 'string' && s.updateServerUrl.trim()) return s.updateServerUrl.trim();
  } catch { /* 아래 기본값 */ }
  return updater.DEFAULT_SERVER_URL;
}

// 시작 몇 초 뒤 조용히 확인 → 새 버전이면 백그라운드로 받아두고 렌더러에 알림(강제 재시작 안 함).
// 서버가 꺼져 있거나 못 찾으면 그냥 조용히 넘어간다 (앱 사용을 막지 않는다).
async function setupCodeUpdater() {
  await new Promise((r) => setTimeout(r, 4000));
  const serverUrl = codeUpdateServerUrl();
  try {
    const current = runningCodeVersion();
    const res = await updater.checkUpdate(serverUrl, current);
    if (!res.hasUpdate) return;
    if (updater.cmpVersion(res.version, current) <= 0) return; // 안전: 더 높을 때만
    const applied = await updater.applyUpdate(serverUrl, (p) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('upd:progress', p);
    });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('upd:ready', { version: applied.version, changelog: res.changelog || '' });
    }
    console.log('[code-update] 적용 완료 v' + applied.version + ' — 재시작 대기');
  } catch (e) {
    console.log('[code-update] 확인 건너뜀:', e.message);
  }
}

app.whenReady().then(() => {
  store.migrateData();
  store.migrateDataV2();
  // 외부(다운로드/카톡 등) 이미지가 아직 남아있는 동안 앱 폴더로 복사해 영구 보존
  store.migrateLocalizeImages();
  // 커스텀 닉네임 단어 로드
  const nickWords = store.loadNicknameWords();
  nicknameGenerator.setCustomWords(nickWords.adjectives, nickWords.nouns);
  createWindow();
  setupAutoUpdater();
  setupCodeUpdater(); // 자체 코드스왑 서버 확인 (백그라운드)
});

app.on('window-all-closed', () => {
  cleanup();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
