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
