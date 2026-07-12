const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:138.0) Gecko/20100101 Firefox/138.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:138.0) Gecko/20100101 Firefox/138.0",
  "Mozilla/5.0 (X11; Linux x86_64; rv:138.0) Gecko/20100101 Firefox/138.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36 Edg/137.0.0.0",
];

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1536, height: 864 },
  { width: 1440, height: 900 },
  { width: 1680, height: 1050 },
  { width: 1280, height: 720 },
];

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function getRandomViewport() {
  return VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)];
}

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

async function launchBrowser(chromePath) {
  const execPath = chromePath || findChromePath();
  if (!execPath) {
    throw new Error('Chrome을 찾을 수 없습니다. Chrome이 설치되어 있는지 확인하세요.');
  }

  // 설정에서 헤드리스 모드 읽기
  let headless = false;
  try {
    const store = require('../data/store');
    const settings = store.loadSettings();
    headless = settings.headless || false;
  } catch (e) { /* ignore */ }

  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-infobars',
    '--disable-automation',
    '--disable-blink-features=AutomationControlled',
    '--ignore-certificate-errors',
  ];

  if (headless) {
    // 헤드리스일 땐 창 생성 플래그(--start-maximized)를 넣지 않는다.
    // 일부 Windows/Chrome 조합에서 신형 헤드리스(--headless=new)가
    // --start-maximized 를 처리해 빈 흰색 창을 띄우는 문제가 있음.
    // 만약 창이 생겨도 안 보이도록 화면 밖에 배치하고, GPU 렌더 이슈를 회피한다.
    args.push('--window-size=1920,1080', '--window-position=-2400,-2400', '--disable-gpu');
  } else {
    args.push('--start-maximized');
  }

  const browser = await puppeteer.launch({
    executablePath: execPath,
    headless: headless ? true : false,
    ignoreHTTPSErrors: true,
    defaultViewport: null,
    args,
  });

  // 헤드리스인데도 창이 화면에 뜨는 문제 방지 (v1.8.4).
  // 신형 헤드리스(--headless=new)는 일부 Chrome 빌드에서 창을 실제로 그리는데,
  // --window-position 런치 플래그는 puppeteer가 만든 "메인 창"에만 적용되고
  // 사이트가 window.open 으로 여는 팝업(예: 네이버 새 기기/캡차 인증 창)에는
  // 상속되지 않아 화면 안에 흰 창으로 뜬다. 그래서 새로 생기는 모든 page 타겟의
  // 창을 CDP(Browser.setWindowBounds)로 화면 밖으로 강제 이동한다.
  if (headless) {
    await hideBrowserWindows(browser);
  }

  return browser;
}

async function moveWindowOffscreen(page) {
  try {
    const session = await page.createCDPSession();
    const { windowId } = await session.send('Browser.getWindowForTarget');
    await session.send('Browser.setWindowBounds', {
      windowId,
      bounds: { left: -2400, top: -2400, width: 1920, height: 1080, windowState: 'normal' },
    });
    await session.detach().catch(() => {});
  } catch (_) {
    // CDP 미지원/이미 닫힌 창 등은 무시
  }
}

async function hideBrowserWindows(browser) {
  // 이미 열려 있는 페이지 처리
  try {
    const pages = await browser.pages();
    for (const p of pages) await moveWindowOffscreen(p);
  } catch (_) { /* ignore */ }
  // 이후 생기는 팝업/새 탭 처리
  browser.on('targetcreated', async (target) => {
    if (target.type() !== 'page') return;
    try {
      const p = await target.page();
      if (p) await moveWindowOffscreen(p);
    } catch (_) { /* ignore */ }
  });
}

async function setupPage(page, options) {
  const viewport = (options && options.randomFingerprint) ? getRandomViewport() : null;
  if (viewport) {
    await page.setViewport(viewport);
  } else {
    const screen = await page.evaluate(() => ({
      width: window.screen.availWidth,
      height: window.screen.availHeight,
    }));
    await page.setViewport({ width: screen.width, height: screen.height });
  }
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
  await page.setUserAgent(getRandomUserAgent());
  page.on('dialog', async (dialog) => { try { await dialog.accept(); } catch (_) {} });
}

async function createPage(browser, options) {
  const page = await browser.newPage();
  await setupPage(page, options);
  return page;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomDelay(min = 1000, max = 3000) {
  return delay(Math.floor(Math.random() * (max - min)) + min);
}

module.exports = {
  findChromePath,
  launchBrowser,
  setupPage,
  createPage,
  delay,
  randomDelay,
};
