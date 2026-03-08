const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function getDataDir() {
  if (app && app.isPackaged) {
    return path.join(process.resourcesPath, 'data');
  }
  return path.join(__dirname, '..', '..', '..', 'data');
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readJSON(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    console.error(`JSON 읽기 오류 (${filePath}):`, e.message);
    return fallback;
  }
}

function writeJSON(filePath, data) {
  try {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error(`JSON 쓰기 오류 (${filePath}):`, e.message);
    return false;
  }
}

function getAccountsPath() {
  return path.join(getDataDir(), 'accounts.json');
}

function getManuscriptsPath() {
  return path.join(getDataDir(), 'manuscripts.json');
}

function getDeleteSchedulePath() {
  return path.join(getDataDir(), 'delete-schedule.json');
}

function getCookiesDir() {
  return path.join(getDataDir(), 'cookies');
}

function getCookiePath(userId) {
  return path.join(getCookiesDir(), `${userId}_cookies.json`);
}

function getLogsDir() {
  return path.join(getDataDir(), 'logs');
}

function getCrawlCacheDir() {
  return path.join(getDataDir(), 'crawl-cache');
}

// === 계정 (새 통합 구조) ===

function loadAccounts() {
  return readJSON(getAccountsPath(), []);
}

function saveAccounts(accounts) {
  return writeJSON(getAccountsPath(), accounts);
}

function getAccount(accountId) {
  const accounts = loadAccounts();
  const acc = accounts.find(a => a.id === accountId) || null;
  if (acc && !acc.standaloneComments) acc.standaloneComments = [];
  return acc;
}

function addAccount(account) {
  const accounts = loadAccounts();
  if (accounts.find(a => a.id === account.id)) return false;
  accounts.push(account);
  return saveAccounts(accounts);
}

function updateAccount(accountId, updates) {
  const accounts = loadAccounts();
  const idx = accounts.findIndex(a => a.id === accountId);
  if (idx === -1) return false;
  accounts[idx] = { ...accounts[idx], ...updates };
  return saveAccounts(accounts);
}

function deleteAccount(accountId) {
  let accounts = loadAccounts();
  accounts = accounts.filter(a => a.id !== accountId);
  // 쿠키 파일도 삭제
  const cookiePath = getCookiePath(accountId);
  if (fs.existsSync(cookiePath)) {
    try { fs.unlinkSync(cookiePath); } catch (e) { /* ignore */ }
  }
  return saveAccounts(accounts);
}

// === 데이터 마이그레이션 ===

function migrateData() {
  const accountsPath = getAccountsPath();
  const manuscriptsPath = getManuscriptsPath();

  const oldAccounts = readJSON(accountsPath, null);
  const oldManuscripts = readJSON(manuscriptsPath, null);

  // 마이그레이션이 필요한지 확인: 기존 accounts가 단순 {id, password} 배열이고 manuscripts.json이 존재할 때
  if (!oldAccounts || !Array.isArray(oldAccounts) || oldAccounts.length === 0) return;

  // 이미 마이그레이션된 구조인지 확인 (features 필드가 있으면 이미 새 구조)
  if (oldAccounts[0] && oldAccounts[0].features) return;

  // 기존 manuscripts 데이터
  const msData = oldManuscripts || { cafeId: '', cafeName: '', manuscripts: [] };

  // 계정별로 manuscripts 그룹핑
  const msGrouped = {};
  for (const ms of (msData.manuscripts || [])) {
    const accId = ms.accountId;
    if (!msGrouped[accId]) msGrouped[accId] = [];
    msGrouped[accId].push({
      id: ms.id,
      boardMenuId: ms.boardMenuId || '',
      boardName: ms.boardName || '',
      post: ms.post || { title: '', bodySegments: [] },
      comments: ms.comments || [],
      enabled: ms.enabled !== false,
      autoDeleteDate: null,
    });
  }

  // 새 계정 구조로 변환
  const newAccounts = oldAccounts.map(acc => ({
    id: acc.id,
    password: acc.password,
    cafeId: msData.cafeId || '',
    cafeName: msData.cafeName || '',
    features: {
      posting: true,
      comment: true,
      ipChange: false,
      nicknameChange: false,
      autoDelete: false,
    },
    nickname: '',
    ipChangeConfig: {
      interfaceName: '',
    },
    boards: [],
    manuscripts: msGrouped[acc.id] || [],
    standaloneComments: [],
  }));

  saveAccounts(newAccounts);

  // 기존 manuscripts.json 백업 후 삭제
  if (fs.existsSync(manuscriptsPath)) {
    const backupPath = manuscriptsPath + '.bak';
    try {
      fs.copyFileSync(manuscriptsPath, backupPath);
      fs.unlinkSync(manuscriptsPath);
    } catch (e) {
      console.error('manuscripts.json 백업/삭제 오류:', e.message);
    }
  }

  console.log('데이터 마이그레이션 완료');
}

// === 쿠키 ===

function saveCookies(userId, cookies) {
  ensureDir(getCookiesDir());
  return writeJSON(getCookiePath(userId), cookies);
}

function loadCookies(userId) {
  const cookiePath = getCookiePath(userId);
  if (!fs.existsSync(cookiePath)) return null;
  const parsed = readJSON(cookiePath, null);
  if (!parsed) return null;
  return Array.isArray(parsed) ? parsed : (parsed.cookies || []);
}

// === 실행 로그 ===

function saveExecutionLog(log) {
  ensureDir(getLogsDir());
  const fileName = `execution_${log.executionId}.json`;
  return writeJSON(path.join(getLogsDir(), fileName), log);
}

function listExecutionLogs() {
  const logsDir = getLogsDir();
  ensureDir(logsDir);
  try {
    return fs.readdirSync(logsDir)
      .filter(f => f.startsWith('execution_') && f.endsWith('.json'))
      .sort().reverse()
      .map(f => {
        const data = readJSON(path.join(logsDir, f), null);
        return data ? { fileName: f, executionId: data.executionId, timestamp: data.timestamp, resultCount: (data.results || []).length } : null;
      })
      .filter(Boolean);
  } catch (e) {
    return [];
  }
}

function loadExecutionLog(fileName) {
  return readJSON(path.join(getLogsDir(), fileName), null);
}

// === 크롤 캐시 ===

function saveCrawlCache(cafeId, data) {
  ensureDir(getCrawlCacheDir());
  return writeJSON(path.join(getCrawlCacheDir(), `${cafeId}.json`), data);
}

function loadCrawlCache(cafeId) {
  return readJSON(path.join(getCrawlCacheDir(), `${cafeId}.json`), null);
}

// === 자동삭제 스케줄 ===

function loadDeleteSchedule() {
  return readJSON(getDeleteSchedulePath(), []);
}

function saveDeleteSchedule(schedule) {
  return writeJSON(getDeleteSchedulePath(), schedule);
}

function addDeleteEntry(entry) {
  const schedule = loadDeleteSchedule();
  schedule.push({
    accountId: entry.accountId,
    postUrl: entry.postUrl,
    postTitle: entry.postTitle || '',
    deleteDate: entry.deleteDate,
    status: 'pending',
    createdAt: new Date().toISOString(),
  });
  return saveDeleteSchedule(schedule);
}

function getDueDeletes() {
  const schedule = loadDeleteSchedule();
  const now = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return schedule.filter(e => e.status === 'pending' && e.deleteDate <= now);
}

function updateDeleteEntry(postUrl, updates) {
  const schedule = loadDeleteSchedule();
  const idx = schedule.findIndex(e => e.postUrl === postUrl);
  if (idx === -1) return false;
  schedule[idx] = { ...schedule[idx], ...updates };
  return saveDeleteSchedule(schedule);
}

module.exports = {
  getDataDir, ensureDir, readJSON, writeJSON,
  loadAccounts, saveAccounts, getAccount, addAccount, updateAccount, deleteAccount,
  migrateData,
  saveCookies, loadCookies,
  saveExecutionLog, listExecutionLogs, loadExecutionLog,
  saveCrawlCache, loadCrawlCache,
  loadDeleteSchedule, saveDeleteSchedule, addDeleteEntry, getDueDeletes, updateDeleteEntry,
};
