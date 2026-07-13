const { delay } = require('./browser-manager');
const store = require('../data/store');

// 네이버 메인은 광고/트래킹 요청이 끊이지 않아 networkidle0(연결 0개 500ms)에 도달하지
// 못하는 경우가 많다. 그러면 30초를 헛되이 기다린 뒤 타임아웃 → "로그인 실패"로 잘못 판정되고,
// 화면엔 빈 페이지만 떠 있게 된다. 로그인 여부는 DOM만 있으면 판별되므로 domcontentloaded 로 충분하다.
async function checkLoginStatus(page) {
  try {
    await page.goto('https://www.naver.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await delay(1500);
    const loginButton = await page.$('.MyView-module__my_login___tOTgr');
    return !loginButton;
  } catch (e) {
    console.error('로그인 상태 확인 에러:', e.message);
    return false;
  }
}

async function performLogin(page, userId, userPw) {
  try {
    await page.goto('https://nid.naver.com/nidlogin.login', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#id', { timeout: 15000 });
    await delay(1000);

    await page.evaluate((id, pw) => {
      document.querySelector('#id').value = id;
      document.querySelector('#pw').value = pw;
    }, userId, userPw);

    const keepLoginCheckbox = await page.$('#keep');
    if (keepLoginCheckbox) {
      const isChecked = await page.evaluate(el => el.checked, keepLoginCheckbox);
      if (!isChecked) await keepLoginCheckbox.click();
    }

    const ipSecurityCheckbox = await page.$('#switch');
    if (ipSecurityCheckbox) {
      const isOn = await page.evaluate(el => el.value === 'on', ipSecurityCheckbox);
      if (isOn) await ipSecurityCheckbox.click();
    }

    await page.click('.btn_login');
    await delay(3000);

    await page.goto('https://www.naver.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await delay(2000);

    return true;
  } catch (e) {
    console.error('로그인 에러:', e.message);
    return false;
  }
}

async function loginWithCookies(page, userId) {
  const cookies = store.loadCookies(userId);
  if (!cookies || cookies.length === 0) return false;
  try {
    await page.setCookie(...cookies);
    const loggedIn = await checkLoginStatus(page);
    if (loggedIn) return true;
    return false;
  } catch (e) {
    return false;
  }
}

async function loginAccount(page, userId, userPw) {
  // 1. 쿠키 로그인 시도
  const cookieLogin = await loginWithCookies(page, userId);
  if (cookieLogin) return { success: true, method: 'cookie' };

  // 2. 직접 로그인
  const directLogin = await performLogin(page, userId, userPw);
  if (directLogin) {
    const isLoggedIn = await checkLoginStatus(page);
    if (isLoggedIn) {
      const cookies = await page.cookies();
      store.saveCookies(userId, cookies);
      return { success: true, method: 'direct' };
    }
  }

  return { success: false, method: 'failed' };
}

async function saveCookiesAfterAction(page, userId) {
  try {
    const cookies = await page.cookies();
    store.saveCookies(userId, cookies);
  } catch (e) {
    // ignore
  }
}

module.exports = {
  checkLoginStatus,
  performLogin,
  loginWithCookies,
  loginAccount,
  saveCookiesAfterAction,
};
