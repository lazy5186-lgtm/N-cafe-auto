#!/usr/bin/env node
/**
 * N Cafe Auto — 코드스왑 업데이트 서버 (무인증 변형, setup-updater).
 *
 * 배포된 앱이 여기에 물어보고 새 JS 코드를 받아간다. 서버는 **난독화본 `dist-src/` 를 그대로 서빙**한다
 * (설치본을 다시 만들지 않는다 — 코드만 갈아끼우는 방식이라 사용자는 재설치가 필요 없다).
 *
 *   node update-server/server.js                  서버 시작 (기본 포트 9250)
 *   node update-server/server.js --port 9400      포트 지정
 *
 * 배포 절차 ("내 PC + 포트포워딩/DDNS" 모델 — 빌드와 서버가 같은 PC):
 *   1. 코드 수정 → package.json + update-server/version.json 의 version 을 **같이** 올림
 *   2. npm run build  (dist-src/ 재생성 — 난독화 + bytenode)
 *   3. update-server/deploy.bat 더블클릭 (= 빌드 확인 + 서버 재시작)
 *
 * ⚠ version.json 의 version 은 **package.json 의 version 과 맞춰야** 한다.
 *   앱은 실행 중인 코드의 package.json 버전을 보내고 서버는 version.json 과 문자열/숫자 비교만 한다.
 *   올리는 걸 잊으면 사용자는 영원히 "최신"으로 본다 (조용히 틀리는 지점).
 * ⚠ 코드스왑 버전은 **마지막 GitHub 릴리스 버전보다 높아야** 앱이 적용한다(공존 규칙).
 *   같은 버전을 GitHub 릴리스와 코드스왑 양쪽에 동시에 올리지 말 것.
 * ⚠ server.js(특히 INCLUDE)를 고쳤으면 **재시작**해야 반영된다(매니페스트는 요청 시점 계산이지만
 *   server.js 코드는 프로세스가 뜰 때 한 번 읽힌다). deploy.bat 은 그래서 항상 재시작한다.
 * ⚠ 서버→앱 구간은 평문 HTTP다. 이 업데이터는 받은 코드를 그대로 실행하므로, 인터넷에 열면
 *   HTTPS·코드서명이 필요하다. 최소한 포트는 방화벽에서 필요한 만큼만 연다.
 */

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION_PATH = path.join(__dirname, 'version.json');
const DIST_PATH = path.join(__dirname, '..', 'dist-src'); // 난독화 산출물 (npm run build 결과)

// 업데이트로 갈아끼울 대상. dist-src/ 전체를 주지 않고 화이트리스트로 제한한다.
// ⚠ 부트스트랩 진입점은 src/main/app-main.js — /^src\// 가 이걸 포함한다(.js 로더 스텁 + .jsc 둘 다).
// ⚠ package.json 을 빠뜨리면 업데이트 후에도 버전이 그대로라 같은 업데이트를 무한 재다운로드한다.
// ⚠ node_modules / resources(adb 바이너리·아이콘)는 코드스왑 대상이 아니다 — 넣지 않는다.
//    네이티브/바이너리가 바뀌면 그건 GitHub 설치본 릴리스로 나가야 한다.
const INCLUDE = [
  /^src\//,          // src/main/**(app-main.js·index.js 부트스트랩·ipc-handlers·core·engine…), src/renderer/**, src/updater.js, src/shared/**
  /^package\.json$/, // 버전 비교 근거
];

// ── DB / 버전 ─────────────────────────────────────────────────────────────────

const loadVersion = () => { try { return JSON.parse(fs.readFileSync(VERSION_PATH, 'utf8')); } catch { return { version: '0.0.0', changelog: '' }; } };

// ── 매니페스트 ────────────────────────────────────────────────────────────────

function walkDir(dir, cb, base = dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkDir(full, cb, base);
    else cb(full, path.relative(base, full));
  }
}

/** dist-src/ 를 훑어 파일별 md5 를 낸다. 클라이언트는 이걸 자기 것과 비교해 바뀐 것만 받는다. */
function generateManifest() {
  const ver = loadVersion();
  const files = [];
  walkDir(DIST_PATH, (full, rel) => {
    const p = rel.replace(/\\/g, '/');
    if (!INCLUDE.some((re) => re.test(p))) return;
    files.push({
      path: p,
      hash: crypto.createHash('md5').update(fs.readFileSync(full)).digest('hex'),
      size: fs.statSync(full).size,
    });
  });
  return { version: ver.version, changelog: ver.changelog, files };
}

// ── 버전 비교 (major.minor.patch 숫자) ──────────────────────────────────────────

function cmpVersion(a, b) {
  const norm = (s) => String(s || '0').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pa = norm(a);
  const pb = norm(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

// ── HTTP 헬퍼 ─────────────────────────────────────────────────────────────────

const parseBody = (req) => new Promise((resolve) => {
  let b = '';
  req.on('data', (c) => { b += c; if (b.length > 1e6) req.destroy(); }); // 과도한 본문 차단
  req.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve({}); } });
});

const json = (res, data, status = 200) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
};

const log = (m) => console.log(`[${new Date().toLocaleTimeString('ko-KR')}] ${m}`);

// ── 서버 ──────────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const route = url.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  try {
    // 서버 살아있는지 확인용 (앱의 "연결 테스트")
    if (route === '/api/ping') {
      return json(res, { ok: true, service: 'n-cafe-auto-update', version: loadVersion().version });
    }

    // 업데이트 있나 (무인증)
    if (route === '/api/check' && req.method === 'POST') {
      const { version } = await parseBody(req);
      const ver = loadVersion();
      const hasUpdate = cmpVersion(ver.version, version) > 0;
      log(`[CHECK] v${version} → ${hasUpdate ? 'v' + ver.version + ' 있음' : '최신'}`);
      return json(res, { hasUpdate, version: ver.version, changelog: ver.changelog });
    }

    // 파일 목록 + 해시 (무인증)
    if (route === '/api/manifest' && req.method === 'POST') {
      const m = generateManifest();
      log(`[MANIFEST] ${m.files.length}개 파일 (v${m.version})`);
      return json(res, m);
    }

    // 파일 1개 다운로드 (무인증)
    if (route === '/api/file' && req.method === 'GET') {
      const rel = url.searchParams.get('path') || '';
      // 경로 탈출 차단 (../ 로 서버 파일을 빼가지 못하게)
      const full = path.resolve(DIST_PATH, rel);
      if (!full.startsWith(path.resolve(DIST_PATH) + path.sep)) return json(res, { error: '잘못된 경로' }, 400);
      if (!INCLUDE.some((re) => re.test(rel.replace(/\\/g, '/')))) return json(res, { error: '허용되지 않은 파일' }, 400);
      if (!fs.existsSync(full)) return json(res, { error: '파일 없음' }, 404);

      const buf = fs.readFileSync(full);
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': buf.length });
      return res.end(buf);
    }

    json(res, { error: 'Not Found' }, 404);
  } catch (err) {
    log(`[ERROR] ${err.message}`);
    json(res, { error: '서버 오류' }, 500);
  }
});

// ── 시작 ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const portIdx = args.indexOf('--port');
// 기본 9250 — src/updater.js 의 DEFAULT_SERVER_URL 포트와 맞춰야 한다. 한쪽만 바꾸면 앱이 못 찾는다.
const port = portIdx !== -1 && args[portIdx + 1] ? parseInt(args[portIdx + 1], 10) : 9250;

server.listen(port, () => {
  const ver = loadVersion();
  const distOk = fs.existsSync(DIST_PATH);
  console.log('');
  console.log('  ==========================================');
  console.log('   N Cafe Auto — 코드스왑 업데이트 서버');
  console.log('  ==========================================');
  console.log(`   포트      : ${port}`);
  console.log(`   버전      : ${ver.version}`);
  console.log(`   dist-src/ : ${distOk ? '있음' : '❌ 없음 — npm run build 먼저'}`);
  console.log('  ------------------------------------------');
  console.log('   무인증 — 라이선스/키 없음 (모든 설치본이 받아감)');
  console.log('  ==========================================');
  console.log('');
});
