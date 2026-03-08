const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:123.0) Gecko/20100101 Firefox/123.0",
  "Mozilla/5.0 (X11; Linux x86_64; rv:123.0) Gecko/20100101 Firefox/123.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edge/121.0.0.0 Safari/537.36",
];

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
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

  const browser = await puppeteer.launch({
    executablePath: execPath,
    headless: false,
    ignoreHTTPSErrors: true,
    defaultViewport: null,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-infobars',
      '--disable-automation',
      '--disable-blink-features=AutomationControlled',
      '--ignore-certificate-errors',
      '--start-maximized',
    ],
  });

  return browser;
}

async function setupPage(page) {
  const screen = await page.evaluate(() => ({
    width: window.screen.availWidth,
    height: window.screen.availHeight,
  }));
  await page.setViewport({ width: screen.width, height: screen.height });
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
  await page.setUserAgent(getRandomUserAgent());
  page.on('dialog', async (dialog) => { await dialog.accept(); });
}

async function createPage(browser) {
  const page = await browser.newPage();
  await setupPage(page);
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
