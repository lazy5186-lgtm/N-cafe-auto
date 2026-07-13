const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

// 화면 밖 좌표. 어떤 모니터도 여기 있을 수 없다(-2400은 왼쪽 2560 모니터에 걸릴 수 있어 위험).
const OFFSCREEN = { left: -32000, top: -32000, width: 1920, height: 1080 };

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

// options.log — 실행 로그(UI)로 진단 줄을 내보내기 위한 콜백
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

  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-infobars',
    '--disable-automation',
    '--disable-blink-features=AutomationControlled',
    '--ignore-certificate-errors',
  ];

  if (headless) {
    // 헤드리스일 땐 창 생성 플래그(--start-maximized)를 넣지 않는다 (puppeteer #13145).
    // 창이 생기더라도 어떤 모니터에도 걸리지 않는 좌표에 둔다.
    args.push(`--window-size=${OFFSCREEN.width},${OFFSCREEN.height}`,
              `--window-position=${OFFSCREEN.left},${OFFSCREEN.top}`,
              '--disable-gpu');
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

  // 헤드리스가 "실제로" 걸렸는지 검증한다.
  // browser.version()은 헤드리스에서도 "Chrome/x"를 돌려줘 구분이 안 되고,
  // browser.userAgent()만 "HeadlessChrome/x"로 구분된다.
  let chromeUA = '';
  try { chromeUA = await browser.userAgent(); } catch (_) {}
  const realHeadless = /Headless/i.test(chromeUA);
  const chromeVer = (chromeUA.match(/Chrome\/([\d.]+)/) || [])[1] || '알 수 없음';
  log(`[브라우저] Chrome ${chromeVer} · 헤드리스 설정=${headless ? 'ON' : 'OFF'} · 실제=${realHeadless ? '헤드리스' : '일반 창'}`);

  if (headless) {
    if (!realHeadless) {
      // 여기 걸리면 크롬이 --headless 를 무시한 것 → 화면에 흰 창이 뜬다.
      // 자동화 자체는 계속 되므로, 창만 OS 레벨에서 숨겨 정상 동작시킨다.
      log('⚠️ 크롬이 헤드리스로 뜨지 않았습니다 (크롬 버전 문제) — 창을 강제로 숨깁니다');
    }
    await hideBrowserWindows(browser, log, !realHeadless);
  }

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

// Win32 ShowWindow(SW_HIDE)로 해당 크롬 프로세스의 "보이는" 창을 전부 숨긴다.
// CDP로 못 옮기는 창(크롬이 헤드리스를 무시하고 띄운 창 포함)까지 확실히 사라지고,
// 숨긴 뒤에도 자동화는 정상 동작한다(검증 완료). 다른 크롬 창은 PID로 걸러 건드리지 않는다.
function hideChromeWindowsWin32(pid) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32' || !pid) return resolve(0);
    const script = `
$ErrorActionPreference='SilentlyContinue'
$ProgressPreference='SilentlyContinue'
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class NCAHide {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
}
"@
$n = 0
$cb = [NCAHide+EnumProc]{
  param($h, $l)
  $p = 0
  [void][NCAHide]::GetWindowThreadProcessId($h, [ref]$p)
  if ($p -eq ${pid} -and [NCAHide]::IsWindowVisible($h)) {
    $sb = New-Object System.Text.StringBuilder 256
    [void][NCAHide]::GetClassName($h, $sb, 256)
    if ($sb.ToString() -like 'Chrome_WidgetWin*') { [void][NCAHide]::ShowWindow($h, 0); $script:n++ }
  }
  return $true
}
[void][NCAHide]::EnumWindows($cb, [IntPtr]::Zero)
Write-Output "hidden=$n"
`;
    const b64 = Buffer.from(script, 'utf16le').toString('base64');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', b64],
      { timeout: 15000, windowsHide: true },
      (err, stdout) => {
        if (err) return resolve(null);
        const m = /hidden=(\d+)/.exec(String(stdout));
        resolve(m ? parseInt(m[1], 10) : 0);
      });
  });
}

// forceHide=true 는 "헤드리스를 켰는데 크롬이 일반 창을 띄운" 비정상 상황에서만.
// 정상 헤드리스면 애초에 화면에 그려지는 창이 없으므로 PowerShell을 부르지 않는다
// (불필요한 프로세스 생성 + 백신 오탐 회피).
async function hideBrowserWindows(browser, log = () => {}, forceHide = false) {
  const pid = browser.process() ? browser.process().pid : null;

  let sweeping = false;
  let pending = false;
  const sweep = async () => {
    if (!forceHide || !pid) return;
    if (sweeping) { pending = true; return; }
    sweeping = true;
    try {
      const n = await hideChromeWindowsWin32(pid);
      if (n === null) log('⚠️ 창 숨김 실패(PowerShell 실행 불가) — 빈 크롬 창이 보일 수 있습니다');
      else if (n > 0) log(`[브라우저] 화면에 뜬 크롬 창 ${n}개를 숨겼습니다`);
    } finally {
      sweeping = false;
      if (pending) { pending = false; setTimeout(sweep, 300); }
    }
  };

  try {
    const pages = await browser.pages();
    for (const p of pages) await moveWindowOffscreen(p);
  } catch (_) { /* ignore */ }
  await sweep();

  // 새 탭/팝업이 생기면 크롬이 숨긴 창을 다시 표시하므로 주기적으로도 쓸어준다
  if (forceHide) {
    const timer = setInterval(sweep, 5000);
    if (timer.unref) timer.unref();
    browser.on('disconnected', () => clearInterval(timer));
  }

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
    sweep();
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

// 우리가 직접 연 탭인지 구분하기 위한 표시 (targetcreated 로그 노이즈 제거용)
let lastOwnPageAt = 0;

async function createPage(browser, options) {
  lastOwnPageAt = Date.now();
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
