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
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  registerHandlers(mainWindow);

  mainWindow.on('closed', () => { mainWindow = null; });
}

// --- 자동 업데이트 ---
function setupAutoUpdater() {
  autoUpdater.requestHeaders = { Authorization: 'token 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' };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '업데이트 발견',
      message: `새 버전 v${info.version}을 다운로드 중입니다...`,
      buttons: ['확인'],
    });
  });

  autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '업데이트 준비 완료',
      message: '새 버전이 다운로드되었습니다. 지금 재시작하여 설치합니다.',
      buttons: ['재시작'],
    }).then(() => {
      autoUpdater.quitAndInstall();
    });
  });

  autoUpdater.on('error', (err) => {
    console.error('업데이트 오류:', err.message);
  });

  autoUpdater.checkForUpdates().catch(() => {});
}

app.whenReady().then(() => {
  store.migrateData();
  store.migrateDataV2();
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
