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
    commentDelay: { enabled: true, minSeconds: 60, maxSeconds: 100 },
    commentContinueOnFail: true,
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

// === 이미지 이식(portability) ===
// 원고/프리셋은 이미지를 "외부 파일 경로"로만 참조한다. 그런데 사용자가 이미지를 보통
// 다운로드/카카오톡 받은 파일 같은 임시 폴더에서 추가하기 때문에, 시간이 지나면
// (Windows 저장소 센스가 다운로드 30일 자동 삭제 등) 원본이 사라져 프리셋을 불러와도
// 이미지가 안 올라간다. → 이미지를 앱 소유 폴더로 복사/동봉해 self-contained로 만든다.

function getPresetImagesDir() {
  return path.join(getDataDir(), 'preset-images');
}

// manuscripts 배열의 모든 이미지 경로 필드(본문 세그먼트 + 댓글/대댓글 재귀)에 fn 적용 후 치환
function forEachImageRef(manuscripts, fn) {
  (manuscripts || []).forEach((m) => {
    const segs = ((m.post || {}).bodySegments) || [];
    segs.forEach((s) => {
      if (s.type === 'image' && s.filePath) s.filePath = fn(s.filePath);
    });
    const walk = (arr) => (arr || []).forEach((c) => {
      if (c.imagePath) c.imagePath = fn(c.imagePath);
      walk(c.replies);
    });
    walk(m.comments);
  });
}

// 외부 폴더의 이미지를 앱 소유 폴더(data/preset-images)로 복사하고 경로를 재작성.
// payload({manuscripts, presets})를 제자리 수정하고 { 원본경로: 새경로 } 맵을 반환한다.
// 원본이 이미 없으면(복구 불가) 경로 그대로 두고, 이미 앱 폴더 안이면 건너뛴다(idempotent).
function localizeImages(payload, stamp) {
  const baseDir = getPresetImagesDir();
  const baseNorm = path.normalize(baseDir).toLowerCase();
  const map = {};
  let count = 0;
  const localize = (p) => {
    if (typeof p !== 'string' || !p || p.startsWith('embed://')) return p;
    if (map[p]) return map[p];
    try {
      if (path.normalize(p).toLowerCase().startsWith(baseNorm)) return p; // 이미 앱 폴더
      if (!fs.existsSync(p)) return p;                                     // 원본 없음 → 유지
      ensureDir(baseDir);
      const ext = path.extname(p) || '.img';
      const safeBase = path.basename(p, ext).replace(/[^\w가-힣.-]/g, '_').slice(0, 40);
      const dest = path.join(baseDir, `${stamp}-${count}-${safeBase}${ext}`);
      fs.copyFileSync(p, dest);
      map[p] = dest;
      count++;
      return dest;
    } catch (e) {
      return p;
    }
  };
  const all = (payload.manuscripts || []).concat(
    (payload.presets || []).flatMap((pr) => pr.manuscripts || [])
  );
  forEachImageRef(all, localize);
  return map;
}

// 시작 시 마이그레이션 — 기존 원고/프리셋의 외부 이미지를 (아직 존재하는 동안) 앱 폴더로 복사.
// 다운로드 폴더 등이 비워지기 전에 한 번이라도 실행되면 이미지가 영구 보존된다.
function migrateLocalizeImages() {
  try {
    const data = loadGlobalManuscripts();
    const map = localizeImages(data, Date.now());
    if (Object.keys(map).length) {
      saveGlobalManuscripts(data);
      console.log(`[migrate] 외부 이미지 ${Object.keys(map).length}개를 앱 폴더로 복사(로컬화)`);
    }
  } catch (e) {
    console.error('이미지 로컬화 마이그레이션 실패:', e.message);
  }
}

// 내보내기: 이미지 파일을 읽어 base64로 담고, 경로 필드를 토큰(embed://...)으로 치환.
// 다른 PC/사용자에게 프리셋·데이터를 넘겨도 이미지가 함께 가도록 한다. { images, embedded, missing } 반환.
function embedImages(manuscripts) {
  const images = {};
  const seen = new Map();
  const missing = [];
  let counter = 0;
  forEachImageRef(manuscripts, (p) => {
    if (typeof p !== 'string' || !p) return p;
    if (p.startsWith('embed://')) return p;
    if (seen.has(p)) return seen.get(p);
    try {
      if (!fs.existsSync(p)) { missing.push(p); return p; }
      const buf = fs.readFileSync(p);
      const ext = path.extname(p).toLowerCase() || '.img';
      const token = `embed://img-${counter++}${ext}`;
      images[token] = buf.toString('base64');
      seen.set(p, token);
      return token;
    } catch (e) {
      missing.push(p);
      return p;
    }
  });
  return { images, embedded: Object.keys(images).length, missing };
}

// 불러오기: _images 토큰을 이 PC의 로컬 파일로 풀고 경로 필드를 로컬 절대경로로 치환. 복원 개수 반환.
function materializeImages(manuscripts, images, stamp) {
  if (!images || Object.keys(images).length === 0) return 0;
  const importDir = path.join(getPresetImagesDir(), String(stamp));
  ensureDir(importDir);
  const written = new Map();
  forEachImageRef(manuscripts, (p) => {
    if (typeof p !== 'string' || !images[p]) return p;
    if (written.has(p)) return written.get(p);
    try {
      const fileName = p.replace('embed://', '') || `img-${written.size}`;
      const outPath = path.join(importDir, fileName);
      fs.writeFileSync(outPath, Buffer.from(images[p], 'base64'));
      written.set(p, outPath);
      return outPath;
    } catch (e) {
      return p;
    }
  });
  return written.size;
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
  forEachImageRef, localizeImages, migrateLocalizeImages, embedImages, materializeImages,
  migrateData, migrateDataV2,
  saveCookies, loadCookies,
  saveExecutionLog, listExecutionLogs, loadExecutionLog, appendDailyLog,
  saveCrawlCache, loadCrawlCache,
  loadNicknameWords, saveNicknameWords,
  loadDeleteSchedule, saveDeleteSchedule, addDeleteEntry, removeDeleteEntries, getDueDeletes, updateDeleteEntry,
};
