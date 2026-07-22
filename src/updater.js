'use strict';
/**
 * 코드스왑 자동 업데이트 클라이언트 — **무인증 변형** (setup-updater).
 *
 * ★ 핵심 설계: **설치본(.exe/asar)을 절대 건드리지 않는다.**
 *   새 코드는 `userData/app/<버전>/` 에 받아두고, 부트스트랩(src/main/index.js)이 실행 시 그쪽을
 *   로드한다. 업데이트가 깨져도 내장 코드로 되돌아가고, 재설치가 필요 없다.
 *
 * ★ N Cafe Auto 는 진입점이 중첩(src/main/app-main.js)이라 버전 폴더도 프로젝트 루트 트리를
 *   그대로 미러링한다(dist-src 구조와 동일). ENTRY 는 그 안의 src/main/app-main.js.
 *
 * ★ electron-updater(GitHub) 와 공존한다. GitHub 설치본이 버전을 올리면(asar 버전 상승)
 *   그보다 낮거나 같은 코드스왑 버전은 **무시**하고 내장을 쓴다(스테일 코드 되돌아가는 사고 방지).
 *   → 한 버전은 GitHub 아니면 코드스왑, 한 채널로만 올린다. 코드스왑 버전은 마지막 GitHub 버전보다
 *     반드시 높아야 적용된다.
 *
 * 파일 배치:
 *   userData/app/<버전>/…        받아둔 코드 (버전별로 통째 보관, 루트 트리 미러)
 *   userData/app/current.json    { version } — 부트스트랩이 읽는 포인터
 *
 * 안전장치:
 *   - 임시 폴더(.tmp-<버전>)에 먼저 받고, 전부 성공 + 해시 일치일 때만 이름을 바꿔 확정한다.
 *   - 받은 파일마다 서버가 준 md5 를 검증한다. 하나라도 어긋나면 통째로 버린다.
 *   - 확정 전에 진입점(src/main/app-main.js) 존재를 확인한다.
 */

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const os = require('node:os');

// ── 경로 ──────────────────────────────────────────────────────────────────────

function userDataDir() {
  // 메인 프로세스에서만 electron 이 잡힌다. 부트스트랩·테스트 폴백을 둔다.
  try {
    return require('electron').app.getPath('userData');
  } catch {
    return path.join(os.homedir(), '.n-cafe-auto');
  }
}

// 부트스트랩이 로드하는 진입점(버전 폴더 루트 기준 상대). 이게 없으면 그 버전은 무효로 본다.
const ENTRY = path.join('src', 'main', 'app-main.js');

// 배포 서버 기본값. ⚠ "내 PC + 포트포워딩/DDNS" 배포:
//   테스트는 localhost 로, 실제 배포 전에는 아래를 **본인 DDNS 주소로 반드시 교체**한다
//   (예: 'http://mycafe.iptime.org:9250'). 고객 앱에는 이 값이 그대로 박혀 나간다.
//   settings.json 의 updateServerUrl 이 있으면 그 값이 우선한다(리빌드 없이 주소 변경 가능).
// ⚠ update-server/server.js 의 포트(9250)와 반드시 일치.
const DEFAULT_SERVER_URL = 'http://127.0.0.1:9250';

const appsRoot = () => path.join(userDataDir(), 'app');
const pointerPath = () => path.join(appsRoot(), 'current.json');
const versionDir = (v) => path.join(appsRoot(), v);

// ── 버전 비교 (semver 라이트: major.minor.patch 숫자 비교) ─────────────────────

/** a>b → 1, a<b → -1, 같음 → 0. 'v' 접두어/비숫자는 무시. 문자열 비교로는 1.8.9<1.8.10 오판. */
function cmpVersion(a, b) {
  const norm = (s) => String(s || '0').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pa = norm(a);
  const pb = norm(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

function readVersionAt(rootDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')).version || '0.0.0';
  } catch {
    return null;
  }
}

// ── 코드 루트 결정 (부트스트랩이 쓴다) ────────────────────────────────────────

/**
 * 실행할 코드가 어디인지 고른다. 받아둔 버전이 멀쩡하고 **설치본보다 최신**이면 그쪽, 아니면 내장.
 * **여기서 절대 예외를 던지면 안 된다** — 던지면 앱이 아예 안 뜬다. 뭐가 잘못되면 내장으로 간다.
 * @param {string} bundledRoot 설치본 코드 루트 (부트스트랩의 <root>)
 */
function resolveCodeRoot(bundledRoot) {
  try {
    const ptr = JSON.parse(fs.readFileSync(pointerPath(), 'utf8'));
    if (!ptr || !ptr.version) return bundledRoot;
    const dir = versionDir(ptr.version);
    if (!fs.existsSync(path.join(dir, ENTRY))) return bundledRoot; // 반쪽 다운로드 방어

    // electron-updater 로 설치본이 더 최신이 됐으면(asar 버전 ≥ 코드스왑 버전) 스테일 무시.
    const bundledVer = readVersionAt(bundledRoot);
    if (bundledVer && cmpVersion(ptr.version, bundledVer) <= 0) {
      try { revertToBundled(); } catch { /* noop */ }
      return bundledRoot;
    }
    return dir;
  } catch {
    return bundledRoot;
  }
}

/** 지금 로드될 코드의 코드스왑 버전(내장이면 null). resolveCodeRoot 와 판정을 맞춘다. */
function activeUpdateVersion(bundledRoot) {
  try {
    const ptr = JSON.parse(fs.readFileSync(pointerPath(), 'utf8'));
    if (!ptr || !ptr.version) return null;
    if (!fs.existsSync(path.join(versionDir(ptr.version), ENTRY))) return null;
    if (bundledRoot) {
      const bundledVer = readVersionAt(bundledRoot);
      if (bundledVer && cmpVersion(ptr.version, bundledVer) <= 0) return null;
    }
    return ptr.version;
  } catch {
    return null;
  }
}

/** 받아둔 업데이트를 버리고 내장 코드로 되돌린다 (문제 생겼을 때 탈출구). */
function revertToBundled() {
  try { fs.rmSync(appsRoot(), { recursive: true, force: true }); } catch { /* noop */ }
}

// ── HTTP ──────────────────────────────────────────────────────────────────────

function request(urlStr, opts = {}, body = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: opts.headers || {},
      timeout: opts.timeout || 30000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('서버 응답 시간 초과')));
    if (body) req.write(body);
    req.end();
  });
}

async function postJson(serverUrl, route, payload) {
  const body = JSON.stringify(payload);
  const r = await request(serverUrl + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  }, body);
  let data;
  try { data = JSON.parse(r.body.toString('utf8')); } catch { data = { error: '서버 응답을 해석할 수 없습니다' }; }
  return { status: r.status, data };
}

const normalizeUrl = (u) => String(u || '').trim().replace(/\/+$/, '');

// ── API (무인증 — 키/deviceId 없음) ─────────────────────────────────────────────

async function ping(serverUrl) {
  const r = await request(normalizeUrl(serverUrl) + '/api/ping', { timeout: 8000 });
  if (r.status !== 200) throw new Error(`서버에 연결했지만 응답이 이상합니다 (${r.status})`);
  try { return JSON.parse(r.body.toString('utf8')); } catch { throw new Error('업데이트 서버가 아닌 것 같습니다'); }
}

async function checkUpdate(serverUrl, currentVersion) {
  const r = await postJson(normalizeUrl(serverUrl), '/api/check', { version: currentVersion });
  if (r.status !== 200) throw new Error(r.data.error || `업데이트 확인 실패 (${r.status})`);
  return r.data; // { hasUpdate, version, changelog }
}

async function fetchManifest(serverUrl) {
  const r = await postJson(normalizeUrl(serverUrl), '/api/manifest', {});
  if (r.status !== 200) throw new Error(r.data.error || `매니페스트 실패 (${r.status})`);
  return r.data;
}

async function downloadFile(serverUrl, rel) {
  const u = new URL(normalizeUrl(serverUrl) + '/api/file');
  u.searchParams.set('path', rel);
  const r = await request(u.toString(), { timeout: 60000 });
  if (r.status !== 200) throw new Error(`다운로드 실패: ${rel} (${r.status})`);
  return r.body;
}

/**
 * 새 버전을 통째로 받아 `userData/app/<버전>/` 에 확정한다.
 * 임시 폴더에 전부 받고 해시까지 맞았을 때만 확정하므로, 중간에 끊겨도 기존 코드는 그대로다.
 */
async function applyUpdate(serverUrl, onProgress = () => {}) {
  serverUrl = normalizeUrl(serverUrl);
  const manifest = await fetchManifest(serverUrl);
  const ver = manifest.version;
  if (!ver) throw new Error('서버가 버전을 주지 않았습니다.');

  onProgress({ phase: 'manifest', message: `파일 ${manifest.files.length}개 확인` });

  const finalDir = versionDir(ver);
  const tmpDir = path.join(appsRoot(), `.tmp-${ver}`);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  // 이미 받아둔 같은 버전이 있으면 거기서 재사용해 다운로드를 줄인다.
  const prevDir = fs.existsSync(finalDir) ? finalDir : null;

  let done = 0;
  for (const f of manifest.files) {
    const dest = path.join(tmpDir, f.path);
    // 경로 탈출 방어 — 서버가 이상한 경로를 줘도 tmpDir 밖으로 못 나간다
    if (!path.resolve(dest).startsWith(path.resolve(tmpDir) + path.sep)) {
      throw new Error(`위험한 경로가 포함돼 있습니다: ${f.path}`);
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });

    let buf = null;
    if (prevDir) {
      const cand = path.join(prevDir, f.path);
      try {
        const local = fs.readFileSync(cand);
        if (crypto.createHash('md5').update(local).digest('hex') === f.hash) buf = local;
      } catch { /* 없으면 그냥 받는다 */ }
    }
    if (!buf) {
      buf = await downloadFile(serverUrl, f.path);
      const got = crypto.createHash('md5').update(buf).digest('hex');
      if (got !== f.hash) throw new Error(`파일이 손상됐습니다: ${f.path}`);
    }
    fs.writeFileSync(dest, buf);
    done++;
    onProgress({ phase: 'download', current: done, total: manifest.files.length, message: f.path });
  }

  if (!fs.existsSync(path.join(tmpDir, ENTRY))) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw new Error(`받은 코드에 진입점(${ENTRY})이 없습니다. 서버의 dist-src/ 와 INCLUDE 목록을 확인하세요.`);
  }

  // 확정 — 여기서부터 되돌릴 수 없다. 앞의 검증을 전부 통과한 뒤에만 온다.
  fs.rmSync(finalDir, { recursive: true, force: true });
  fs.renameSync(tmpDir, finalDir);
  fs.mkdirSync(appsRoot(), { recursive: true });
  fs.writeFileSync(pointerPath(), JSON.stringify({ version: ver, appliedAt: new Date().toISOString() }, null, 2), 'utf8');

  // 오래된 버전 정리 (지금 것만 남긴다)
  try {
    for (const d of fs.readdirSync(appsRoot())) {
      if (d !== ver && d !== 'current.json') fs.rmSync(path.join(appsRoot(), d), { recursive: true, force: true });
    }
  } catch { /* 정리 실패는 치명적 아님 */ }

  onProgress({ phase: 'done', message: `v${ver} 적용 완료` });
  return { version: ver, files: done };
}

module.exports = {
  DEFAULT_SERVER_URL,
  cmpVersion,
  ping, checkUpdate, fetchManifest, applyUpdate,
  resolveCodeRoot, activeUpdateVersion, revertToBundled,
};
