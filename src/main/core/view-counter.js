const { delay, randomDelay } = require('./browser-manager');
const auth = require('./auth');

// User-Agent 풀 (더 다양하게)
const VIEW_USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36 OPR/113.0.0.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
];

function getRandomViewUA() {
  return VIEW_USER_AGENTS[Math.floor(Math.random() * VIEW_USER_AGENTS.length)];
}

/**
 * 새 시크릿 컨텍스트 + 페이지를 생성 (매 조회마다 완전히 격리된 세션)
 */
async function createIsolatedPage(browser) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();

  // 랜덤 User-Agent
  const ua = getRandomViewUA();
  await page.setUserAgent(ua);

  // 뷰포트 설정
  const screen = await page.evaluate(() => ({
    width: window.screen.availWidth,
    height: window.screen.availHeight,
  }));
  await page.setViewport({ width: screen.width, height: screen.height });

  // 자동화 감지 방지
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    // canvas fingerprint 랜덤화
    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function(type) {
      const ctx = this.getContext('2d');
      if (ctx) {
        const style = ctx.fillStyle;
        ctx.fillStyle = 'rgba(0,0,0,0.01)';
        ctx.fillRect(0, 0, 1, 1);
        ctx.fillStyle = style;
      }
      return origToDataURL.apply(this, arguments);
    };
  });

  // dialog 자동 승인
  page.on('dialog', async (dialog) => {
    try { await dialog.accept(); } catch (_) {}
  });

  return { context, page, userAgent: ua };
}

/**
 * 시크릿 컨텍스트 폐기 (쿠키, 캐시, storage 모두 삭제)
 */
async function destroyContext(context) {
  try {
    await context.close();
  } catch (_) {}
}

/**
 * 링크 접속하여 조회수 올리기
 */
async function visitLink(page, url) {
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    // 페이지 로딩 완료 대기 (2~4초)
    await randomDelay(2000, 4000);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

module.exports = {
  createIsolatedPage,
  destroyContext,
  visitLink,
  getRandomViewUA,
};
