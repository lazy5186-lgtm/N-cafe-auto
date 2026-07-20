const { delay } = require('./browser-manager');
const store = require('../data/store');

// 네이버 메인은 광고/트래킹 요청이 끊이지 않아 networkidle0(연결 0개 500ms)에 도달하지
// 못하는 경우가 많다. 그러면 30초를 헛되이 기다린 뒤 타임아웃 → "로그인 실패"로 잘못 판정되고,
// 화면엔 빈 페이지만 떠 있게 된다. 로그인 여부는 DOM만 있으면 판별되므로 domcontentloaded 로 충분하다.
async function checkLoginStatus(page) {
  try {
    await page.goto('https://www.naver.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await delay(1500);
    // 로그인된 상태의 네이버 메인에도 '화면에 보이지 않는' 로그인 링크가 남아 있다.
    // (예: <a href="https://nid.naver.com/nidlogin.login">네이버로그인</a>)
    // 따라서 보이는 요소만 로그인 버튼으로 인정해야 오탐이 없다.
    // .MyView-module__my_login___tOTgr 는 네이버가 리빌드할 때마다 바뀌는 해시 클래스라
    // 단독으로 두면 취약해서, 보이는 로그인 링크를 보조 신호로 함께 본다.
    const loginButtonVisible = await page.evaluate(() => {
      const isVisible = (el) =>
        !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      const selectors = [
        '.MyView-module__my_login___tOTgr',
        '.link_login',
        '.gnb_login',
        'a[href*="nid.naver.com/nidlogin.login"]',
      ];
      for (const selector of selectors) {
        try {
          for (const el of document.querySelectorAll(selector)) {
            if (!isVisible(el)) continue;
            const text = el.textContent || el.innerText || '';
            if (text.includes('로그인') || (el.href || '').includes('nidlogin')) return true;
          }
        } catch (_) {
          // 선택자 오류 무시
        }
      }
      return false;
    });
    return !loginButtonVisible;
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

    // 실제 키 입력 이벤트로 타이핑한다. .value 직접 주입은 네이버 로그인 폼의
    // 봇 탐지 필드(bvsd)가 빈 채로 전송돼 캡차로 빠질 위험이 있다.
    await page.click('#id');
    await page.type('#id', userId, { delay: 90 });
    await delay(700);
    await page.click('#pw');
    await page.type('#pw', userPw, { delay: 90 });

    // 로그인 상태 유지 (네이버 V4 로그인 폼: #keep -> #loginStay)
    const keepLoginCheckbox = await page.$('#loginStay');
    if (keepLoginCheckbox) {
      const isChecked = await page.evaluate(el => el.checked, keepLoginCheckbox);
      if (!isChecked) await page.click('label[for="loginStay"]');
    }

    // IP 보안 OFF (네이버 V4 로그인 폼: #switch -> #switchIP)
    // 이 체크박스는 value 속성이 없어 .value 가 항상 "on" 이므로 반드시 .checked 로 판정해야 한다.
    const ipSecurityCheckbox = await page.$('#switchIP');
    if (ipSecurityCheckbox) {
      const isOn = await page.evaluate(el => el.checked, ipSecurityCheckbox);
      if (isOn) await page.click('label[for="switchIP"]');
    }

    // 로그인 버튼 (.btn_login 은 없어졌고, 반응형으로 row/column 두 개가 공존한다)
    const loginBtnSelector = await page.evaluate(() => {
      for (const id of ['loginBtn_row', 'loginBtn_column']) {
        const el = document.getElementById(id);
        if (el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length)) {
          return '#' + id;
        }
      }
      return null;
    });
    if (!loginBtnSelector) {
      console.error('로그인 버튼을 찾지 못했습니다. (네이버 로그인 폼 변경 가능성)');
      return false;
    }
    await page.click(loginBtnSelector);
    await delay(3000);

    // 새로운 기기(브라우저) 등록 확인 화면 처리.
    // 로그인 자체는 성공한 상태이며, 이 화면을 넘기지 않으면 세션이 확정되지 않는다.
    if (page.url().includes('deviceConfirm')) {
      await page.evaluate(() => {
        const nodes = [...document.querySelectorAll('a, button, input[type=submit]')];
        const label = (el) => (el.innerText || el.value || '').trim();
        const target = nodes.find(el => label(el) === '등록안함')
          || nodes.find(el => label(el).includes('등록안함'));
        if (target) target.click();
      });
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      await delay(1500);
    }

    // 로그인 실패 사유 파악 (#err_common .error_message 는 없어졌다)
    const failure = await page.evaluate(() => {
      const isVisible = (el) =>
        !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      for (const box of document.querySelectorAll('.form_message.error, .error_message')) {
        const text = (box.innerText || box.textContent || '').trim();
        if (isVisible(box) && text) return text;
      }
      const bodyText = document.body.innerText || '';
      if (bodyText.includes('자동입력 방지') || bodyText.includes('보안문자')) return '캡차(자동입력 방지) 요구';
      const frame = document.querySelector('iframe[id^="ncaptcha"]');
      if (frame && isVisible(frame)) return '캡차 노출';
      if (bodyText.includes('회원님의 아이디를 보호하고 있습니다')) return '계정 보호조치';
      return null;
    });
    if (failure) {
      console.error('로그인 실패:', failure);
      return false;
    }

    if (page.url().includes('nidlogin.login')) {
      console.error('로그인 실패: 로그인 페이지에 머물러 있습니다.');
      return false;
    }

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
