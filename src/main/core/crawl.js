const store = require('../data/store');
const { delay } = require('./browser-manager');

function deduplicateBoards(boards) {
  const seen = new Set();
  return boards.filter(b => {
    if (seen.has(b.menuId)) return false;
    seen.add(b.menuId);
    return true;
  });
}

async function tryNewSPA(page, cafeId) {
  try {
    await page.goto(`https://cafe.naver.com/f-e/cafes/${cafeId}`, {
      waitUntil: 'networkidle0', timeout: 30000,
    });
    await page.waitForSelector('a[role="menuitem"][href*="/menus/"]', { timeout: 15000 });
    await delay(1000);

    const boards = await page.$$eval('a[role="menuitem"][href*="/menus/"]', (links) => {
      return links.map(link => {
        const href = link.getAttribute('href') || '';
        const match = href.match(/\/menus\/(\d+)/);
        const menuId = match ? match[1] : null;
        const menuName = link.textContent.trim();
        return { menuId, menuName };
      }).filter(item => item.menuId && item.menuName && item.menuName.length > 0);
    });

    const filtered = boards.filter(b => {
      const numId = parseInt(b.menuId);
      return !isNaN(numId) && numId > 0;
    });

    return deduplicateBoards(filtered);
  } catch (e) {
    return [];
  }
}

async function tryOldFrames(page, cafeId) {
  try {
    await page.goto(`https://cafe.naver.com/f-e/cafes/${cafeId}`, {
      waitUntil: 'networkidle0', timeout: 30000,
    });
    await delay(3000);

    const frames = page.frames();
    for (const frame of frames) {
      try {
        const menuLinks = await frame.$$('#cafe-menu a[id^="menuLink"]');
        if (menuLinks.length > 0) {
          const boards = await frame.$$eval('#cafe-menu a[id^="menuLink"]', (links) => {
            return links.map(link => {
              const rawId = link.id.replace('menuLink', '');
              const menuName = link.textContent.trim();
              return { menuId: rawId, menuName };
            });
          });

          return boards.filter(b => {
            const numId = parseInt(b.menuId);
            return !isNaN(numId) && numId > 0 && b.menuName.length > 0;
          });
        }
      } catch (e) { /* skip inaccessible frames */ }
    }
    return [];
  } catch (e) {
    return [];
  }
}

async function tryWritePageDropdown(page, cafeId) {
  try {
    const writeUrl = `https://cafe.naver.com/f-e/cafes/${cafeId}/articles/write?boardType=L`;
    await page.goto(writeUrl, { waitUntil: 'networkidle0', timeout: 30000 });
    await delay(2000);

    if (!page.url().includes('articles/write')) return [];

    const boardSelectButton = await page.$('.FormSelectButton');
    if (!boardSelectButton) return [];

    await boardSelectButton.click();
    await page.waitForSelector('.option_list .item', { timeout: 10000 });
    await delay(500);

    const boards = await page.$$eval('.option_list .item', (items) => {
      return items.map((item, index) => {
        const text = item.querySelector('.option_text')?.textContent?.trim() || '';
        return { dropdownIndex: index, menuName: text };
      });
    });

    return boards;
  } catch (e) {
    return [];
  }
}

async function extractCafeName(page, cafeId) {
  try {
    let cafeName = await page.evaluate(() => {
      const canonical = document.querySelector('link[rel="canonical"]');
      if (canonical) {
        const match = canonical.href.match(/cafe\.naver\.com\/([a-zA-Z0-9_-]+)/);
        if (match && match[1] !== 'ca-fe' && match[1] !== 'f-e') return match[1];
      }
      const ogUrl = document.querySelector('meta[property="og:url"]');
      if (ogUrl) {
        const match = ogUrl.content.match(/cafe\.naver\.com\/([a-zA-Z0-9_-]+)/);
        if (match && match[1] !== 'ca-fe' && match[1] !== 'f-e') return match[1];
      }
      return null;
    });

    if (!cafeName) {
      await page.goto(`https://cafe.naver.com/f-e/cafes/${cafeId}`, {
        waitUntil: 'networkidle2', timeout: 15000,
      });
      await delay(2000);
      const finalUrl = page.url();
      const urlMatch = finalUrl.match(/cafe\.naver\.com\/([a-zA-Z0-9_-]+)/);
      if (urlMatch && urlMatch[1] !== 'ca-fe' && urlMatch[1] !== 'f-e') {
        cafeName = urlMatch[1];
      }
    }
    return cafeName;
  } catch (e) {
    return null;
  }
}

async function extractNumericId(page, cafeName) {
  try {
    await page.goto(`https://cafe.naver.com/${cafeName}`, {
      waitUntil: 'networkidle2', timeout: 30000,
    });
    await delay(2000);

    const numericId = await page.evaluate(() => {
      // 방법 1: script 태그에서 cafeId 추출
      const scripts = document.querySelectorAll('script');
      for (const s of scripts) {
        const text = s.textContent || '';
        // g_cafeId, cafeId, cafe_id 등 다양한 패턴
        const m = text.match(/["']?(?:g_)?cafe[_]?[Ii]d["']?\s*[:=]\s*["']?(\d+)["']?/);
        if (m) return m[1];
      }
      // 방법 2: iframe src에서 추출
      const iframe = document.querySelector('#cafe_main');
      if (iframe && iframe.src) {
        const m = iframe.src.match(/clubid=(\d+)/i) || iframe.src.match(/cafes\/(\d+)/);
        if (m) return m[1];
      }
      // 방법 3: 링크에서 추출
      const links = document.querySelectorAll('a[href*="cafes/"]');
      for (const a of links) {
        const m = a.href.match(/cafes\/(\d+)/);
        if (m) return m[1];
      }
      // 방법 4: meta 태그
      const metas = document.querySelectorAll('meta');
      for (const meta of metas) {
        const content = meta.content || '';
        const m = content.match(/cafes\/(\d+)/);
        if (m) return m[1];
      }
      return null;
    });

    return numericId;
  } catch (e) {
    return null;
  }
}

/**
 * SideMenuList API로 게시판 목록 가져오기 (브라우저 내 fetch)
 */
async function fetchBoardsAPI(page, cafeId) {
  try {
    const result = await page.evaluate(async (id) => {
      try {
        const res = await fetch(`https://apis.naver.com/cafe-web/cafe2/SideMenuList?cafeId=${id}`, {
          method: 'GET',
          headers: {
            'accept': 'application/json, text/plain, */*',
          },
          credentials: 'include',
        });

        if (!res.ok) return { error: `HTTP ${res.status}` };

        const json = await res.json();

        // 응답 구조: message.result.menus[]
        let menus = null;
        if (json.message && json.message.result) {
          menus = json.message.result.menus;
        }
        if (!menus && json.result) {
          menus = json.result.menus;
        }
        if (!menus && json.menus) {
          menus = json.menus;
        }

        if (!Array.isArray(menus)) {
          return { error: 'menus not found', sample: JSON.stringify(json).substring(0, 500) };
        }

        // 실제 게시판만 필터 (구분선/폴더 제외)
        const excludeTypes = ['S', 'F']; // S=구분선, F=폴더
        const boards = menus
          .filter(m => m.menuId && m.menuName && !excludeTypes.includes(m.menuType))
          .map(m => ({
            menuId: String(m.menuId),
            menuName: m.menuName.trim(),
            menuType: m.menuType || '',
            boardType: m.boardType || '',
          }));

        return { boards };
      } catch (e) {
        return { error: e.message };
      }
    }, cafeId);

    if (result.error) {
      console.log('SideMenuList API 오류:', result.error);
      if (result.sample) console.log('응답 샘플:', result.sample);
      return [];
    }

    console.log(`API로 게시판 ${result.boards.length}개 발견`);
    return result.boards;
  } catch (e) {
    console.log('fetchBoardsAPI 예외:', e.message);
    return [];
  }
}

async function crawlBoards(page, cafeId, cafeName) {
  let numericId = cafeId;

  // 숫자 ID가 아닌 경우만 추출 시도
  if (!/^\d+$/.test(numericId) && cafeName) {
    if (/^\d+$/.test(cafeName)) {
      numericId = cafeName;
    } else {
      const extracted = await extractNumericId(page, cafeName);
      if (extracted) numericId = extracted;
    }
  }

  // API 호출 전 네이버 도메인 진입 (쿠키/CORS 필요)
  const currentUrl = page.url();
  if (!currentUrl.includes('naver.com')) {
    await page.goto('https://cafe.naver.com', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await delay(1000);
  }

  // 1순위: API 방식 (빠름)
  let boardList = await fetchBoardsAPI(page, numericId);

  if (boardList.length > 0) {
    return { boardList, cafeName: cafeName, cafeId: numericId };
  }

  // 2순위: DOM 기반 fallback (느림)
  console.log('API 실패, DOM 크롤링 시도...');
  boardList = await tryNewSPA(page, numericId);

  if (boardList.length === 0) {
    boardList = await tryOldFrames(page, numericId);
  }

  if (boardList.length === 0) {
    const dropdownBoards = await tryWritePageDropdown(page, numericId);
    if (dropdownBoards.length > 0) {
      boardList = dropdownBoards.map(d => ({
        menuId: null,
        menuName: d.menuName,
        dropdownIndex: d.dropdownIndex,
      }));
    }
  }

  const extractedName = await extractCafeName(page, numericId);
  return { boardList, cafeName: extractedName || cafeName, cafeId: numericId };
}

/**
 * 계정의 쿠키를 이용해 가입한 카페 목록을 가져옴
 * Puppeteer 브라우저 내에서 fetch()로 호출 (실제 브라우저 요청과 동일)
 */
async function fetchJoinedCafesFromPage(page) {
  return await page.evaluate(async () => {
    try {
      const res = await fetch('https://apis.naver.com/cafe-home-web/cafe-home/v1/cafes/join?perPage=300', {
        method: 'GET',
        headers: {
          'accept': 'application/json, text/plain, */*',
          'x-cafe-product': 'mweb',
        },
        credentials: 'include',
      });

      if (!res.ok) return { error: `HTTP ${res.status}` };

      const json = await res.json();

      // 500 에러 (로그인 안됨 등) 체크
      if (json.message && json.message.status === '500') {
        const errMsg = json.message.error ? json.message.error.msg : '서버 오류';
        return { error: errMsg, needLogin: true };
      }

      // 응답 구조 탐색
      let cafeList = null;
      if (json.message && json.message.result) {
        cafeList = json.message.result.cafeList || json.message.result.cafes;
      }
      if (!cafeList && json.result) {
        cafeList = json.result.cafeList || json.result.cafes;
      }
      if (!cafeList && json.data) {
        cafeList = json.data.cafeList || json.data.cafes || json.data;
      }
      if (!cafeList && Array.isArray(json)) {
        cafeList = json;
      }

      if (!Array.isArray(cafeList)) {
        return { error: '카페 목록을 찾을 수 없습니다', keys: Object.keys(json).join(','), sample: JSON.stringify(json).substring(0, 300) };
      }

      return {
        cafes: cafeList.map(cafe => ({
          cafeId: String(cafe.cafeId || cafe.id || ''),
          cafeName: cafe.cafeUrl || cafe.url || cafe.cafeSlug || cafe.cafeUri || '',
          cafeTitle: cafe.cafeName || cafe.name || cafe.title || cafe.cafeTitle || '',
        })).filter(c => c.cafeId),
      };
    } catch (e) {
      return { error: e.message };
    }
  });
}

async function fetchJoinedCafes(accountId) {
  const cookies = store.loadCookies(accountId);
  if (!cookies || cookies.length === 0) {
    throw new Error('저장된 쿠키가 없습니다. 먼저 로그인 테스트를 실행하세요.');
  }

  const browserManager = require('./browser-manager');
  const auth = require('./auth');
  let browser = null;

  try {
    browser = await browserManager.launchBrowser();
    const page = await browserManager.createPage(browser);
    await page.setCookie(...cookies);

    // 네이버 카페 모바일 페이지로 이동 (쿠키 활성화)
    await page.goto('https://m.cafe.naver.com', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await delay(1000);

    // 1차 시도: 쿠키로 API 호출
    let result = await fetchJoinedCafesFromPage(page);

    // 쿠키 만료 시 자동 재로그인 후 재시도
    if (result.needLogin || (result.error && result.error.includes('로그인'))) {
      console.log(`쿠키 만료, ${accountId} 재로그인 시도...`);
      const account = store.getAccount(accountId);
      if (account) {
        const loginResult = await auth.loginAccount(page, account.id, account.password);
        if (loginResult.success) {
          console.log(`${accountId} 재로그인 성공 (${loginResult.method})`);
          await page.goto('https://m.cafe.naver.com', { waitUntil: 'domcontentloaded', timeout: 15000 });
          await delay(1000);
          result = await fetchJoinedCafesFromPage(page);
        } else {
          await browser.close();
          throw new Error('쿠키 만료 및 재로그인 실패. 로그인 테스트를 다시 실행하세요.');
        }
      } else {
        await browser.close();
        throw new Error('쿠키 만료. 계정 정보를 찾을 수 없어 재로그인 불가.');
      }
    }

    await browser.close();

    if (result.error) {
      console.error('카페 목록 오류:', result.error);
      if (result.sample) console.log('응답 샘플:', result.sample);
      throw new Error(result.error);
    }

    console.log(`가입 카페 ${result.cafes.length}개 발견 (${accountId})`);
    return result.cafes;
  } catch (e) {
    if (browser) await browser.close().catch(() => {});
    throw e;
  }
}

module.exports = { crawlBoards, extractNumericId, fetchJoinedCafes };
