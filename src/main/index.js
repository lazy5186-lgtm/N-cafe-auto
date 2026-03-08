const { app, BrowserWindow } = require('electron');
const path = require('path');
const { registerHandlers, cleanup } = require('./ipc-handlers');
const store = require('./data/store');

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

app.whenReady().then(() => {
  // 데이터 마이그레이션 (기존 구조 → 새 구조)
  store.migrateData();
  createWindow();
});

app.on('window-all-closed', () => {
  cleanup();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
