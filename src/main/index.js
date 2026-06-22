const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');
const { registerHandlers, cleanup } = require('./ipc-handlers');
const store = require('./data/store');
const nicknameGenerator = require('./core/nickname-generator');

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
});

app.on('window-all-closed', () => {
  cleanup();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
