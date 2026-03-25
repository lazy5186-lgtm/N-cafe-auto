const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function getDataDir() {
  if (app && app.isPackaged) {
    // 프로덕션: 사용자별 AppData 폴더 (개인 데이터 보호)
    const dir = path.join(app.getPath('userData'), 'data');
    ensureDir(dir);
    return dir;
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

function getSettingsPath() {
  return path.join(getDataDir(), 'settings.json');
}

function getGlobalManuscriptsPath() {
  return path.join(getDataDir(), 'global-manuscripts.json');
}

function getDeleteSchedulePath() {
  return path.join(getDataDir(), 'delete-schedule.json');
}

function getNicknameWordsPath() {
  return path.join(getDataDir(), 'nickname-words.json');
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

// === 계정 (V2: 간소화) ===

function loadAccounts() {
  return readJSON(getAccountsPath(), []);
}

function saveAccounts(accounts) {
  return writeJSON(getAccountsPath(), accounts);
}

function getAccount(accountId) {
  const accounts = loadAccounts();
  return accounts.find(a => a.id === accountId) || null;
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
  const cookiePath = getCookiePath(accountId);
  if (fs.existsSync(cookiePath)) {
    try { fs.unlinkSync(cookiePath); } catch (e) { /* ignore */ }
  }
  return saveAccounts(accounts);
}

// === 설정 (V2: 글로벌) ===

function loadSettings() {
  return readJSON(getSettingsPath(), {
    ipChange: { enabled: false, interfaceName: '' },
    nicknameChange: { enabled: false },
  });
}

function saveSettings(settings) {
  return writeJSON(getSettingsPath(), settings);
}

// === 원고 (V2: 글로벌) ===

function loadGlobalManuscripts() {
  return readJSON(getGlobalManuscriptsPath(), { manuscripts: [], presets: [] });
}

function saveGlobalManuscripts(data) {
  return writeJSON(getGlobalManuscriptsPath(), data);
}

// === 데이터 마이그레이션 ===

// V1: 분리된 manuscripts.json → accounts.json 통합
function migrateData() {
  const accountsPath = getAccountsPath();
  const oldMsPath = path.join(getDataDir(), 'manuscripts.json');

  const oldAccounts = readJSON(accountsPath, null);
  const oldManuscripts = readJSON(oldMsPath, null);

  if (!oldAccounts || !Array.isArray(oldAccounts) || oldAccounts.length === 0) return;
  if (oldAccounts[0] && oldAccounts[0].features) return; // 이미 V1 완료

  const msData = oldManuscripts || { cafeId: '', cafeName: '', manuscripts: [] };
  const msGrouped = {};
  for (const ms of (msData.manuscripts || [])) {
    const accId = ms.accountId;
    if (!msGrouped[accId]) msGrouped[accId] = [];
    msGrouped[accId].push({
      id: ms.id, boardMenuId: ms.boardMenuId || '', boardName: ms.boardName || '',
      post: ms.post || { title: '', bodySegments: [] },
      comments: ms.comments || [], enabled: ms.enabled !== false, autoDeleteDate: null,
    });
  }

  const newAccounts = oldAccounts.map(acc => ({
    id: acc.id, password: acc.password,
    cafeId: msData.cafeId || '', cafeName: msData.cafeName || '',
    features: { posting: true, comment: true, ipChange: false, nicknameChange: false, autoDelete: false },
    nickname: '', ipChangeConfig: { interfaceName: '' },
    boards: [], manuscripts: msGrouped[acc.id] || [],
  }));
  saveAccounts(newAccounts);

  if (fs.existsSync(oldMsPath)) {
    try {
      fs.copyFileSync(oldMsPath, oldMsPath + '.bak');
      fs.unlinkSync(oldMsPath);
    } catch (e) { /* ignore */ }
  }
  console.log('데이터 마이그레이션 V1 완료');
}

// V2: per-account 구조 → 글로벌 설정/원고 분리
function migrateDataV2() {
  const settingsPath = getSettingsPath();
  if (fs.existsSync(settingsPath)) return; // 이미 V2 완료

  const accounts = loadAccounts();
  if (!accounts || accounts.length === 0) return;
  if (!accounts[0].features) return; // V1 형식 아님 (이미 V2이거나 원시 형식)

  // 설정 추출
  const firstAcc = accounts[0];
  const settings = {
    ipChange: {
      enabled: firstAcc.features.ipChange || false,
      interfaceName: (firstAcc.ipChangeConfig && firstAcc.ipChangeConfig.interfaceName) || '',
    },
    nicknameChange: {
      enabled: firstAcc.features.nicknameChange || false,
    },
  };

  // 모든 원고/프리셋 수집
  const allManuscripts = [];
  const allPresets = [];

  for (const acc of accounts) {
    if (acc.manuscripts) {
      for (const ms of acc.manuscripts) {
        allManuscripts.push({
          ...ms,
          accountId: acc.id,
          cafeId: acc.cafeId || '',
          cafeName: acc.cafeName || '',
          boards: acc.boards || [],
          autoDelete: !!(acc.features && acc.features.autoDelete),
        });
      }
    }
    if (acc.presets) {
      for (const p of acc.presets) {
        const presetMs = (p.manuscripts || []).map(ms => ({
          ...ms,
          accountId: acc.id,
          cafeId: acc.cafeId || '',
          cafeName: acc.cafeName || '',
          boards: acc.boards || [],
          autoDelete: !!(acc.features && acc.features.autoDelete),
        }));
        allPresets.push({
          name: accounts.length > 1 ? `${acc.id} - ${p.name}` : p.name,
          manuscripts: presetMs,
          savedAt: p.savedAt,
        });
      }
    }
  }

  saveSettings(settings);
  saveGlobalManuscripts({ manuscripts: allManuscripts, presets: allPresets });

  // 계정 간소화
  const simpleAccounts = accounts.map(a => ({
    id: a.id,
    password: a.password,
    nickname: a.nickname || '',
  }));
  saveAccounts(simpleAccounts);

  console.log('데이터 마이그레이션 V2 완료');
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

function getDesktopLogDir() {
  const desktop = app ? app.getPath('desktop') : path.join(require('os').homedir(), 'Desktop');
  return path.join(desktop, 'NCafeAuto 로그');
}

function appendDailyLog(lines) {
  if (!lines || lines.length === 0) return;
  const logDir = getDesktopLogDir();
  ensureDir(logDir);
  const date = new Date().toISOString().slice(0, 10);
  const filePath = path.join(logDir, `${date}.txt`);
  const content = lines.join('\n') + '\n\n';
  try {
    fs.appendFileSync(filePath, content, 'utf8');
  } catch (e) {
    console.error('일별 로그 저장 실패:', e.message);
  }
}

// === 크롤 캐시 ===

function saveCrawlCache(cafeId, data) {
  ensureDir(getCrawlCacheDir());
  return writeJSON(path.join(getCrawlCacheDir(), `${cafeId}.json`), data);
}

function loadCrawlCache(cafeId) {
  return readJSON(path.join(getCrawlCacheDir(), `${cafeId}.json`), null);
}

// === 닉네임 단어 ===

function loadNicknameWords() {
  return readJSON(getNicknameWordsPath(), { adjectives: [], nouns: [] });
}

function saveNicknameWords(data) {
  return writeJSON(getNicknameWordsPath(), data);
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
  // 중복 방지
  if (entry.postUrl && schedule.find(e => e.postUrl === entry.postUrl)) return;
  schedule.push({
    accountId: entry.accountId,
    postUrl: entry.postUrl,
    postTitle: entry.postTitle || '',
    boardName: entry.boardName || '',
    status: 'posted',
    createdAt: new Date().toISOString(),
  });
  return saveDeleteSchedule(schedule);
}

function removeDeleteEntries(postUrls) {
  const schedule = loadDeleteSchedule();
  const filtered = schedule.filter(e => !postUrls.includes(e.postUrl));
  return saveDeleteSchedule(filtered);
}

function getDueDeletes() {
  const schedule = loadDeleteSchedule();
  const now = new Date().toISOString().slice(0, 10);
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
  loadSettings, saveSettings,
  loadGlobalManuscripts, saveGlobalManuscripts,
  migrateData, migrateDataV2,
  saveCookies, loadCookies,
  saveExecutionLog, listExecutionLogs, loadExecutionLog, appendDailyLog,
  saveCrawlCache, loadCrawlCache,
  loadNicknameWords, saveNicknameWords,
  loadDeleteSchedule, saveDeleteSchedule, addDeleteEntry, removeDeleteEntries, getDueDeletes, updateDeleteEntry,
};
