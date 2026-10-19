const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');

// 화면 밖 좌표. 어떤 모니터도 여기 있을 수 없다(-2400은 왼쪽 2560 모니터에 걸릴 수 있어 위험).
const OFFSCREEN = { left: -32000, top: -32000, width: 1920, height: 1080 };

// 계정별 영속 크롬 프로필 위치.
// 예전엔 매 실행 새 임시 프로필에 저장 쿠키만 심었다 → 네이버엔 "같은 로그인 세션이 매번 처음 보는
// 기기 + 다른 IP 로 등장"(= 쿠키 탈취 패턴)으로 보여 세션이 끊기고, 재로그인 때 영수증 캡차가 떴다.
// 프로필을 계정별로 유지하면 세션·기기 쿠키·localStorage 가 남아 "같은 기기가 IP 만 바꿔 재방문"이 된다.
// 브라우저 상태라 data/(설정·원고)와 분리해 Local AppData 에 둔다 (Roaming 동기화·OneDrive 잠금 회피).
const PROFILE_ROOT = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'n-cafe-auto', 'profiles');

function getProfileDir(accountId) {
  return path.join(PROFILE_ROOT, String(accountId).replace(/[^a-zA-Z0-9_-]/g, '_'));
}

// 계정 삭제 시 프로필도 지운다 (남겨두면 계정 수만큼 디스크에 쌓인다)
function removeProfile(accountId) {
  try {
    fs.rmSync(getProfileDir(accountId), { recursive: true, force: true });
  } catch (_) {
    // 크롬이 아직 쓰는 중이면 실패 — 다음 삭제 때 다시 시도되므로 무시
  }
}

// 다른 크롬이 이 프로필을 쓰는 중인지 (같은 계정 동시 실행).
// 크롬은 실행 중 프로필의 lockfile 을 잡고 있어 지울 수 없다. 남아 있는데 지워지면 비정상 종료 흔적이다.
// 쓰는 중인 프로필로 띄우면 새 크롬이 기존 크롬에 창만 하나 넘기고 종료하므로 미리 걸러낸다.
function isProfileInUse(dir) {
  const lock = path.join(dir, 'lockfile');
  if (!fs.existsSync(lock)) return false;
  try {
    fs.unlinkSync(lock);
    return false;
  } catch (e) {
    return e.code === 'EBUSY' || e.code === 'EPERM';
  }
}

// 원격 디버깅 포트는 비어 있는 번호를 직접 골라 넘긴다.
// --remote-debugging-port=0(자동 배정, puppeteer 기본)이면 크롬이 navigator.webdriver 를 true 로 만든다 (Chrome 153 실측).
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// 크롬 실행 인자. puppeteer 기본 인자는 쓰지 않는다 (ignoreDefaultArgs: true):
// 기본 인자의 --enable-automation, --disable-features=AcceptCHFrame 등이 "자동화된 크롬"을 드러낸다.
// 아래는 사이트에서 관측되지 않는 안정성 옵션만 골라 둔 것.
const CHROME_ARGS = [
  '--no-first-run',
  '--no-default-browser-check',
  '--hide-crash-restore-bubble',
  // 창이 화면 밖에 있거나 가려져도 타이머·렌더링이 멈추지 않게 (숨김 창 모드에서 필수)
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-popup-blocking',
  '--disable-prompt-on-repost',
  '--disable-hang-monitor',
  // 영속 프로필이 계정 수만큼 쌓이므로 캐시 상한 50MB
  '--disk-cache-size=52428800',
];

function findChromePath() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Google\\Chrome\\Application\\chrome.exe'),
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

// options.log       — 실행 로그(UI)로 진단 줄을 내보내기 위한 콜백
// options.accountId — 지정하면 그 계정 전용 영속 프로필로 띄운다 (없으면 임시 프로필, 닫을 때 삭제)
async function launchBrowser(chromePath, options = {}) {
  const log = typeof options.log === 'function' ? options.log : () => {};
  const execPath = chromePath || findChromePath();
  if (!execPath) {
    throw new Error('Chrome을 찾을 수 없습니다. Chrome이 설치되어 있는지 확인하세요.');
  }

  // 설정에서 헤드리스 모드 읽기.
  // 예전엔 실패를 조용히 삼켜서 headless=false(= 창 뜨는 모드)로 폴백했다 —
  // 고객이 "헤드리스를 켰는데 창이 뜬다"고 해도 원인을 알 방법이 없었으므로 반드시 남긴다.
  let headless = false;
  try {
    const store = require('../data/store');
    headless = !!store.loadSettings().headless;
  } catch (e) {
    log(`⚠️ 설정을 읽지 못했습니다 — 헤드리스가 꺼진 상태로 진행합니다 (${e.message})`);
  }

  // 헤드리스 설정이어도 진짜 헤드리스(--headless)로 띄우지 않는다.
  // 헤드리스 크롬은 UA 에 "HeadlessChrome" 이 박혀 그 자체로 봇 신호다 (예전엔 UA 위조로 가렸지만
  // 그 위조가 sec-ch-ua 헤더를 지워 더 큰 신호가 됐다). 대신 일반 창을 화면 밖 좌표에 띄운다.
  // OS 레벨로 숨기지(ShowWindow SW_HIDE) 않는 이유: 숨긴 창은 페이지가 visibilityState=hidden,
  // requestAnimationFrame 정지, outerWidth=0 이 된다 (실측). 화면 밖 창은 전부 정상이고 작업표시줄 버튼만 남는다.
  const args = [...CHROME_ARGS];
  if (headless) {
    args.push(`--window-size=${OFFSCREEN.width},${OFFSCREEN.height}`,
              `--window-position=${OFFSCREEN.left},${OFFSCREEN.top}`);
  } else {
    args.push('--start-maximized');
  }

  // 계정 프로필이 다른 크롬에 잡혀 있거나(같은 계정 동시 실행) 손상됐으면 임시 프로필로라도 진행한다
  let profileDir = options.accountId ? getProfileDir(options.accountId) : null;
  if (profileDir && fs.existsSync(profileDir) && isProfileInUse(profileDir)) {
    log(`⚠️ ${options.accountId} 프로필을 다른 크롬이 사용 중입니다 — 이번엔 임시 프로필로 진행합니다`);
    profileDir = null;
  }
  const attempts = profileDir ? [profileDir, null] : [null];
  let browser = null;
  let usedProfile = null;
  let lastErr = null;
  for (const dir of attempts) {
    try {
      if (dir) fs.mkdirSync(dir, { recursive: true });
      const port = await getFreePort();
      browser = await puppeteer.launch({
        executablePath: execPath,
        headless: false,
        ignoreDefaultArgs: true,
        ignoreHTTPSErrors: true,
        defaultViewport: null,
        args: [...args, `--remote-debugging-port=${port}`, ...(dir ? [`--user-data-dir=${dir}`] : []), 'about:blank'],
      });
      usedProfile = dir;
      break;
    } catch (e) {
      lastErr = e;
      if (dir) log(`⚠️ 계정 프로필로 크롬을 열지 못했습니다 (${String(e.message).split('\n')[0]}) — 임시 프로필로 진행합니다`);
    }
  }
  if (!browser) throw lastErr;

  let chromeUA = '';
  try { chromeUA = await browser.userAgent(); } catch (_) {}
  const chromeVer = (chromeUA.match(/Chrome\/([\d.]+)/) || [])[1] || '알 수 없음';
  log(`[브라우저] Chrome ${chromeVer} · 프로필=${usedProfile ? options.accountId : '임시'} · ${headless ? '숨김 창(헤드리스 설정)' : '일반 창'}`);

  if (headless) await hideBrowserWindows(browser, log);

  return browser;
}

async function moveWindowOffscreen(page) {
  try {
    const session = await page.createCDPSession();
    const { windowId } = await session.send('Browser.getWindowForTarget');
    await session.send('Browser.setWindowBounds', {
      windowId,
      bounds: { ...OFFSCREEN, windowState: 'normal' },
    });
    await session.detach().catch(() => {});
  } catch (_) {
    // CDP 미지원/이미 닫힌 창 등은 무시
  }
}

// 숨김 창 모드(헤드리스 설정): 모든 창을 화면 밖 좌표로 보낸다.
async function hideBrowserWindows(browser, log = () => {}) {
  try {
    const pages = await browser.pages();
    for (const p of pages) await moveWindowOffscreen(p);
  } catch (_) { /* ignore */ }

  // 사이트가 window.open으로 여는 팝업(네이버 새 기기/캡차 인증 등)은 런치 플래그를
  // 물려받지 않는다. 팝업 URL을 로그에 남겨 "흰 창"의 정체를 추적 가능하게 한다.
  browser.on('targetcreated', async (target) => {
    if (target.type() !== 'page') return;
    const url = target.url() || '';
    // createPage()가 직접 연 탭(about:blank)은 우리 것이므로 로그에서 제외.
    // 그 외의 빈 창은 "흰 창"의 유력 용의자라 반드시 남긴다.
    const isOwnNewPage = (!url || url === 'about:blank') && (Date.now() - lastOwnPageAt < 3000);
    if (!isOwnNewPage) log(`[브라우저] 새 창/팝업: ${url || '(빈 창)'}`);
    try {
      const p = await target.page();
      if (p) await moveWindowOffscreen(p);
    } catch (_) { /* ignore */ }
  });
}

// UA·해상도·navigator.webdriver 를 위조하지 않는다 (2026-09 실측 — 위조가 오히려 봇 신호였다):
//  - setUserAgent() 는 sec-ch-ua 헤더와 navigator.userAgentData 를 지워 "UA 는 크롬인데 클라이언트 힌트 없음"이
//    되고, 풀에 섞여 있던 Firefox UA 는 크롬 엔진(window.chrome 등)과 정면으로 모순됐다.
//  - 랜덤 setViewport 는 1920 창 안에 1366 화면이 들어간, 실제 브라우저에선 불가능한 크기를 만들었다.
//  - webdriver 덮어쓰기는 navigator 에 자체 속성 흔적을 남긴다. --enable-automation 을 빼고 디버깅 포트를
//    직접 지정하므로(getFreePort) 원래부터 false 다.
async function setupPage(page) {
  page.on('dialog', async (dialog) => { try { await dialog.accept(); } catch (_) {} });
}

// 우리가 직접 연 탭인지 구분하기 위한 표시 (targetcreated 로그 노이즈 제거용)
let lastOwnPageAt = 0;

async function createPage(browser) {
  lastOwnPageAt = Date.now();
  const page = await browser.newPage();
  await setupPage(page);
  return page;
}

// 탭이 다른 탭 뒤로 밀렸거나 창이 최소화되면 페이지가 visibilityState=hidden 이 되어 렌더링이 멈춘다.
// 그 상태에서 ElementHandle.click() 은 내부의 IntersectionObserver 콜백을 영원히 기다리다
// protocolTimeout(180초) 으로 "Runtime.callFunctionOn timed out" 을 낸다 (2026-10 실측: 숨김 창 + 백그라운드 탭/최소화).
// bringToFront 는 창을 화면 밖 좌표 그대로 둔 채 normal 상태로 되돌린다. 일반 창 모드에서 포커스를
// 뺏지 않도록 hidden 일 때만 호출한다.
async function ensureForeground(page, log = () => {}) {
  const vis = await page.evaluate(() => document.visibilityState).catch(() => null);
  if (vis !== 'hidden') return;
  log('[브라우저] 작업 탭이 가려져 있어 앞으로 가져옵니다 (탭 전환/창 최소화 감지)');
  await page.bringToFront().catch(() => {});
  await delay(300);
}

/**
 * ElementHandle.click() 은 페이지가 렌더링을 멈춘 상태(백그라운드 탭·최소화)면 180초 동안 멈춘다.
 * (같은 상태에서 keyboard.type / evaluate / waitForSelector 는 정상 — 클릭만 문제, 2026-10 실측)
 * 클릭 전에 가려졌는지 확인해 앞으로 가져오고, 그래도 10초 안에 끝나지 않으면 DOM focus+click 으로 대신한다 (렌더링 없이도 동작).
 */
async function clickWithFallback(handle, log = () => {}) {
  // 가려져 있으면 먼저 앞으로 — 그러면 진짜 클릭이 바로 통한다 (폴백은 그 사이 다시 가려질 때 대비)
  try { await ensureForeground(handle.frame.page(), log); } catch (_) {}
  const result = await Promise.race([
    handle.click().then(() => 'ok'),
    delay(10000).then(() => 'timeout'),
  ]);
  if (result === 'timeout') {
    log('⚠️ 클릭 응답 없음(10초, 화면이 가려진 상태) — 직접 클릭으로 대신합니다');
    await handle.evaluate((el) => { el.focus(); el.click(); });
  }
}

// page.click(selector) 대체 — 요소가 없으면 page.click 과 같은 에러를 낸다
async function clickSelector(page, selector, log = () => {}) {
  const handle = await page.$(selector);
  if (!handle) throw new Error(`No element found for selector: ${selector}`);
  await clickWithFallback(handle, log);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomDelay(min = 1000, max = 3000) {
  return delay(Math.floor(Math.random() * (max - min)) + min);
}

module.exports = {
  findChromePath,
  getProfileDir,
  removeProfile,
  launchBrowser,
  setupPage,
  createPage,
  ensureForeground,
  clickWithFallback,
  clickSelector,
  delay,
  randomDelay,
};
