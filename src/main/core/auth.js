const { delay } = require('./browser-manager');
const store = require('../data/store');

// 로그인 세션 쿠키가 걸리는 도메인들. page.cookies() 를 인자 없이 부르면 "현재 페이지 URL" 쿠키만 나와
// nid/cafe 전용 쿠키가 저장에서 빠진다 → 명시적으로 모은다.
const COOKIE_URLS = [
  'https://www.naver.com',
  'https://nid.naver.com',
  'https://cafe.naver.com',
  'https://m.cafe.naver.com',
];

// 캡차가 떴을 때 사람이 풀 때까지 기다리는 최대 시간
const HUMAN_LOGIN_TIMEOUT = 3 * 60 * 1000;

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

// 헤드리스(숨김 창) 설정이면 사람이 캡차를 풀 수 없다
function isHiddenMode() {
  try {
    return !!store.loadSettings().headless;
  } catch (_) {
    return false;
  }
}

function onLoginForm(url) {
  return /nid\.naver\.com\/nidlogin\.login/.test(url || '');
}

// 사람처럼 한 글자씩 (글자당 100~300ms). 고정 간격(page.type 의 delay)은 기계적인 리듬이 그대로 드러난다.
async function typeHuman(page, selector, text) {
  await page.click(selector);
  // 프로필이 아이디를 기억해 칸이 채워져 있으면 이어 붙지 않게 먼저 비운다
  const hasValue = await page.$eval(selector, (el) => !!el.value).catch(() => false);
  if (hasValue) {
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
  }
  for (const ch of text) {
    await page.keyboard.type(ch);
    await delay(100 + Math.random() * 200);
  }
}

// 동작 사이 간격 (0.5~2초)
function humanPause() {
  return delay(500 + Math.random() * 1500);
}

// 로그인 버튼을 누른 뒤 로그인 폼을 벗어날 때까지 (고정 3초 대기는 느린 회선에서 성공도 실패로 봤다).
// 서버가 로그인 폼을 다시 돌려주면(캡차·비밀번호 오류) 새 문서라 표시가 사라진다 → 그때 바로 멈춘다.
async function waitLeaveLoginForm(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!onLoginForm(page.url())) return true;
    const reloaded = await page.evaluate(() => !window.__ncaSubmitted).catch(() => false);
    if (reloaded) return false;
    await delay(500);
  }
  return !onLoginForm(page.url());
}

// 로그인 폼에 머물렀을 때 이유 파악
async function readLoginState(page) {
  try {
    return await page.evaluate(() => {
      const isVisible = (el) =>
        !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
      const body = document.body ? (document.body.innerText || '') : '';
      // (#err_common .error_message 는 없어졌다)
      let message = null;
      for (const box of document.querySelectorAll('.form_message.error, .error_message')) {
        const text = (box.innerText || box.textContent || '').trim();
        if (isVisible(box) && text) { message = text; break; }
      }
      const captcha = /자동\s?입력\s?방지|보안문자|영수증/.test(body)
        || [...document.querySelectorAll('iframe[id^="ncaptcha"], #captcha, #rcapt, [id*="captcha"], [class*="captcha"]')]
          .some(isVisible);
      const id = document.querySelector('#id');
      const pw = document.querySelector('#pw');
      return {
        message,
        captcha,
        idEmpty: !!id && isVisible(id) && !id.value,
        // 사람이 입력 중인 칸은 건드리지 않는다
        pwEmpty: !!pw && isVisible(pw) && !pw.value && document.activeElement !== pw,
        // 이 페이지(로드)에서 이미 다시 채웠는지 — 새 페이지가 뜨면 초기화된다
        refilled: !!window.__ncaRefilled,
      };
    });
  } catch (_) {
    return { message: null, captcha: false, idEmpty: false, pwEmpty: false, refilled: true };
  }
}

// 캡차 등 추가 확인을 사람이 크롬 창에서 풀 때까지 기다린다.
// 캡차 화면은 비밀번호 칸을 비워서 다시 보여준다 → 사람이 비밀번호를 몰라도 되게 한 번 다시 채워 둔다.
// (새 페이지가 뜬 직후에만 채운다 — 사람이 캡차 답을 치는 중에 포커스를 빼앗지 않도록)
async function waitForHumanLogin(page, userId, userPw, log) {
  const deadline = Date.now() + HUMAN_LOGIN_TIMEOUT;
  while (Date.now() < deadline) {
    if (page.isClosed()) return false;
    if (!onLoginForm(page.url())) return true;
    const st = await readLoginState(page);
    if (st.pwEmpty && !st.refilled) {
      try {
        if (st.idEmpty) await typeHuman(page, '#id', userId);
        await typeHuman(page, '#pw', userPw);
        await page.evaluate(() => { window.__ncaRefilled = true; });
        log('비밀번호를 다시 입력해 두었습니다 — 캡차 답만 입력하고 [로그인]을 눌러주세요');
      } catch (_) {
        // 페이지 전환 중이면 다음 바퀴에서 다시 본다
      }
    }
    await delay(1000);
  }
  return !onLoginForm(page.url());
}

// 아이디/비밀번호 직접 로그인.
// options.interactive — 캡차가 뜨면 사람이 풀 때까지 기다릴지 (숨김 창이면 볼 수 없으니 false)
async function performLogin(page, userId, userPw, options = {}) {
  const log = typeof options.log === 'function' ? options.log : () => {};
  const interactive = !!options.interactive;
  try {
    await page.goto('https://nid.naver.com/nidlogin.login', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#id', { timeout: 15000 });
    await humanPause();

    // 실제 키 입력 이벤트로 타이핑한다. .value 직접 주입은 네이버 로그인 폼의
    // 봇 탐지 필드(bvsd)가 빈 채로 전송돼 캡차로 빠질 위험이 있다.
    await typeHuman(page, '#id', userId);
    await humanPause();
    await typeHuman(page, '#pw', userPw);
    await humanPause();

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
      log('❌ 로그인 버튼을 찾지 못했습니다 (네이버 로그인 폼 변경 가능성)');
      return false;
    }
    await page.evaluate(() => { window.__ncaSubmitted = true; });
    await page.click(loginBtnSelector);
    await waitLeaveLoginForm(page, 10000);

    // 로그인 폼에 머물렀다 = 캡차 / 비밀번호 오류 / 기타 추가 확인
    if (onLoginForm(page.url())) {
      const st = await readLoginState(page);
      const reason = st.captcha ? '캡차(자동입력 방지)' : (st.message || '로그인 페이지에 머물러 있음');
      const badCredential = !st.captcha && st.message
        && /아이디|비밀번호/.test(st.message) && /잘못|일치/.test(st.message);
      if (badCredential) {
        log(`❌ 로그인 실패: ${st.message}`);
        return false;
      }
      if (!interactive) {
        log(`❌ 로그인 실패: ${reason} — 헤드리스(숨김 창) 설정이라 직접 풀 수 없습니다. 헤드리스를 끄고 [로그인 테스트]로 한 번 통과시키면 이후엔 계정 프로필에 로그인이 유지됩니다`);
        return false;
      }
      log(`⚠️ 로그인 추가 확인 필요: ${reason} — 크롬 창에서 직접 풀고 [로그인]을 눌러주세요 (최대 3분 대기)`);
      if (!(await waitForHumanLogin(page, userId, userPw, log))) {
        log('❌ 3분 안에 로그인이 끝나지 않아 실패 처리합니다');
        return false;
      }
      log('✅ 로그인 추가 확인 통과');
      await delay(1500);
    }

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

    const isProtected = await page.evaluate(
      () => (document.body ? document.body.innerText || '' : '').includes('회원님의 아이디를 보호하고 있습니다')
    ).catch(() => false);
    if (isProtected) {
      log(`❌ 로그인 실패: 계정 보호조치 (${page.url()})`);
      return false;
    }

    await page.goto('https://www.naver.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await delay(2000);

    return true;
  } catch (e) {
    log(`❌ 로그인 에러: ${e.message}`);
    return false;
  }
}

// 이 브라우저(프로필)에 네이버 로그인 쿠키가 이미 있는지 — 네트워크 없이 확인
async function hasSessionCookie(page) {
  try {
    return (await page.cookies('https://www.naver.com')).some((c) => c.name === 'NID_AUT');
  } catch (_) {
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

// 로그인 없이 세션만 필요한 작업(카페 목록·게시판 크롤링 등)용.
// 계정 프로필에 세션이 있으면 그대로 두고, 없을 때만 저장 쿠키를 심는다.
// (프로필의 더 최신 세션을 오래된 저장 쿠키로 덮어쓰면 오히려 로그아웃될 수 있다)
async function restoreSession(page, userId) {
  if (await hasSessionCookie(page)) return 'profile';
  const cookies = store.loadCookies(userId);
  if (!cookies || cookies.length === 0) return 'none';
  await page.setCookie(...cookies);
  return 'cookie';
}

// options.log         — 실행 로그 콜백 (캡차 안내 등 사람이 봐야 하는 줄)
// options.interactive — 캡차 때 사람을 기다릴지. 생략 시 헤드리스 설정이 꺼져 있으면 기다린다
async function loginAccount(page, userId, userPw, options = {}) {
  const log = typeof options.log === 'function' ? options.log : () => {};

  // 1. 계정 프로필에 남아 있는 세션 (영속 프로필이면 대부분 여기서 끝난다)
  if (await hasSessionCookie(page) && await checkLoginStatus(page)) {
    await saveCookiesAfterAction(page, userId);
    return { success: true, method: 'profile' };
  }

  // 2. 저장된 쿠키 (프로필이 비어 있거나 — 첫 실행·임시 프로필 — 세션이 끊긴 경우)
  if (await loginWithCookies(page, userId)) {
    await saveCookiesAfterAction(page, userId);
    return { success: true, method: 'cookie' };
  }

  // 3. 아이디/비밀번호 직접 입력
  log(`${userId}: 저장된 세션으로 로그인되지 않아 아이디/비밀번호로 로그인합니다`);
  const interactive = options.interactive !== undefined ? !!options.interactive : !isHiddenMode();
  const directLogin = await performLogin(page, userId, userPw, { log, interactive });
  if (directLogin) {
    const isLoggedIn = await checkLoginStatus(page);
    if (isLoggedIn) {
      await saveCookiesAfterAction(page, userId);
      return { success: true, method: 'direct' };
    }
    log(`❌ ${userId}: 로그인 절차는 끝났지만 네이버 메인에서 로그인 상태가 확인되지 않습니다`);
  }

  return { success: false, method: 'failed' };
}

async function saveCookiesAfterAction(page, userId) {
  try {
    const cookies = await page.cookies(...COOKIE_URLS);
    if (cookies.length > 0) store.saveCookies(userId, cookies);
  } catch (e) {
    // ignore
  }
}

module.exports = {
  checkLoginStatus,
  performLogin,
  loginWithCookies,
  restoreSession,
  loginAccount,
  saveCookiesAfterAction,
};
