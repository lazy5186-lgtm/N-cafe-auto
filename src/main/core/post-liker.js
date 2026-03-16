const { delay } = require('./browser-manager');

/**
 * 게시글에 좋아요 클릭
 */
async function likePost(page, articleUrl) {
  console.log('좋아요 클릭 시작:', articleUrl);

  await page.goto(articleUrl, { waitUntil: 'networkidle2', timeout: 30000 });
  await delay(3000);

  // iframe 접근
  const frameHandle = await page.$('#cafe_main');
  if (!frameHandle) {
    throw new Error('cafe_main iframe을 찾을 수 없습니다');
  }
  const frame = await frameHandle.contentFrame();
  if (!frame) {
    throw new Error('iframe 컨텐츠에 접근할 수 없습니다');
  }
  console.log('iframe 접근 성공');

  // 좋아요 버튼 찾기 및 클릭 (동작 확인된 방식)
  const likeResult = await frame.evaluate(() => {
    const likeSelectors = [
      '.like_article .u_likeit_list_btn',
      '.ReactionLikeIt .u_likeit_list_btn',
      'a[title*="좋아요"]',
      '.u_likeit_list_btn',
    ];

    for (const selector of likeSelectors) {
      const likeButton = document.querySelector(selector);
      if (likeButton) {
        likeButton.click();
        return { success: true, selector: selector };
      }
    }

    return { success: false, selector: null };
  });

  if (!likeResult.success) {
    throw new Error('좋아요 버튼을 찾을 수 없습니다');
  }

  console.log(`좋아요 클릭 성공 (${likeResult.selector})`);
  await delay(2000);
  return { success: true, alreadyLiked: false };
}

/**
 * CafeMemberNetworkArticleListV3 API로 회원의 게시글 목록 가져오기
 */
async function fetchMemberArticles(page, cafeId, memberKey, pageNum, perPage) {
  perPage = perPage || 15;
  pageNum = pageNum || 1;

  const result = await page.evaluate(async (cafeId, memberKey, pageNum, perPage) => {
    try {
      const url = `https://apis.naver.com/cafe-web/cafe-mobile/CafeMemberNetworkArticleListV3?search.cafeId=${cafeId}&search.memberKey=${memberKey}&search.perPage=${perPage}&search.page=${pageNum}&requestFrom=A`;
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'accept': 'application/json, text/plain, */*',
          'x-cafe-product': 'pc',
        },
        credentials: 'include',
      });

      if (!res.ok) return { error: `HTTP ${res.status}` };

      const json = await res.json();

      // 500 에러 체크
      if (json.message && json.message.status === '500') {
        return { error: `서버 오류: ${json.message.error ? json.message.error.msg : '알 수 없음'}` };
      }

      // 응답 구조 탐색
      let articleList = null;
      if (json.message && json.message.result) {
        articleList = json.message.result.articleList || json.message.result.articles;
      }
      if (!articleList && json.result) {
        articleList = json.result.articleList || json.result.articles;
      }
      if (!articleList) {
        articleList = json.articleList || json.articles;
      }

      if (!Array.isArray(articleList)) {
        const keys = Object.keys(json);
        let deepKeys = '';
        if (json.message) {
          deepKeys += ' message:' + Object.keys(json.message).join(',');
          if (json.message.result && typeof json.message.result === 'object') {
            deepKeys += ' result:' + Object.keys(json.message.result).join(',');
          }
        }
        return { error: 'articleList not found', keys: keys.join(','), deepKeys, sample: JSON.stringify(json).substring(0, 800) };
      }

      const articles = articleList.map(a => {
        let id = a.articleId || a.articleid || a.id || '';
        if (!id && a.item) {
          id = a.item.articleId || a.item.articleid || a.item.id || '';
        }
        let subject = a.subject || a.title || '';
        if (!subject && a.item) {
          subject = a.item.subject || a.item.title || '';
        }
        return {
          articleId: String(id),
          subject,
          memberKey: a.writerMemberKey || a.memberKey || '',
          memberNickname: a.writernickname || a.memberNickname || '',
          writeDateTimestamp: a.writeDateTimestamp || 0,
        };
      });

      let totalCount = articles.length;
      if (json.message && json.message.result) {
        totalCount = json.message.result.totalCount || json.message.result.articleCount || totalCount;
      }

      return { articles, totalCount };
    } catch (e) {
      return { error: e.message };
    }
  }, cafeId, memberKey, pageNum, perPage);

  return result;
}

/**
 * 로그인된 계정의 memberKey(base64url)를 가져오기
 *
 * CafeMemberInfo API에는 base64url memberKey가 없음.
 * 대신 게시판 글 목록 API (cafe-boardlist-api)의 writerInfo.memberKey에서 추출.
 * 로그인된 계정의 nickName과 매칭하여 본인의 memberKey를 찾음.
 */
/**
 * 게시판 글 목록 한 페이지에서 모든 작성자 추출 (두 가지 응답 구조 모두 처리)
 */
async function fetchWritersFromPage(page, cafeId, pageNum) {
  return await page.evaluate(async (cafeId, pageNum) => {
    try {
      const url = `https://apis.naver.com/cafe-web/cafe-boardlist-api/v1/cafes/${cafeId}/menus/0/articles?page=${pageNum}&pageSize=50&sortBy=TIME&viewType=L`;
      const res = await fetch(url, {
        headers: { 'accept': 'application/json, text/plain, */*', 'referer': 'https://cafe.naver.com/' },
        credentials: 'include',
      });
      if (!res.ok) return [];
      const json = await res.json();

      let articleList = null;
      if (json.result && json.result.articleList) articleList = json.result.articleList;
      else if (json.message && json.message.result && json.message.result.articleList) articleList = json.message.result.articleList;
      if (!Array.isArray(articleList)) return [];

      const writers = [];
      for (const art of articleList) {
        // 구조 1: nested (art.item.writerInfo)
        if (art.item && art.item.writerInfo && art.item.writerInfo.memberKey) {
          writers.push({
            memberKey: art.item.writerInfo.memberKey,
            nickName: art.item.writerInfo.nickName || '',
          });
        }
        // 구조 2: flat (art.writerMemberKey)
        else if (art.writerMemberKey) {
          writers.push({
            memberKey: art.writerMemberKey,
            nickName: art.writernickname || '',
          });
        }
      }
      return writers;
    } catch (e) { return []; }
  }, cafeId, pageNum);
}

async function fetchMemberKey(page, cafeId) {
  try {
    // 1단계 (최우선): cafe-cafeinfo-api members API — 현재 로그인 사용자의 memberKey 직접 반환
    console.log('members API로 memberKey 직접 조회...');
    const membersResult = await page.evaluate(async (cafeId) => {
      try {
        const res = await fetch(`https://apis.naver.com/cafe-web/cafe-cafeinfo-api/v1.0/cafes/${cafeId}/members`, {
          headers: {
            'accept': '*/*',
            'x-cafe-product': 'pc',
            'referer': 'https://cafe.naver.com/',
          },
          credentials: 'include',
        });
        if (!res.ok) return { error: `HTTP ${res.status}` };
        const text = await res.text();
        // 응답 전체에서 memberKey 추출
        const m = text.match(/"memberKey"\s*:\s*"([A-Za-z0-9_-]{20,})"/);
        if (m) return { memberKey: m[1] };
        // 디버그: 응답 일부 반환
        return { error: 'memberKey not found', sample: text.substring(0, 500) };
      } catch (e) {
        return { error: e.message };
      }
    }, cafeId);

    if (membersResult && membersResult.memberKey) {
      console.log('members API에서 memberKey 추출 성공:', membersResult.memberKey);
      return { memberKey: membersResult.memberKey };
    }
    console.log('members API 결과:', membersResult);

    // 2단계: CafeMemberInfo로 닉네임 확인 + 다른 직접 API 시도
    const memberInfo = await page.evaluate(async (cafeId) => {
      try {
        const res = await fetch(`https://apis.naver.com/cafe-web/cafe2/CafeMemberInfo?cafeId=${cafeId}`, {
          headers: { 'accept': 'application/json', 'x-cafe-product': 'pc' },
          credentials: 'include',
        });
        if (!res.ok) return { error: `HTTP ${res.status}` };
        const json = await res.json();
        const result = json.message && json.message.result ? json.message.result : json.result;
        if (result) {
          return { nickName: result.nickName || '', memberId: result.memberId || '' };
        }
        return { error: 'no result' };
      } catch (e) {
        return { error: e.message };
      }
    }, cafeId);

    console.log('로그인 계정 정보:', memberInfo);
    const nickName = memberInfo.nickName || '';

    // 3단계: 카페 SPA 페이지 로드 → __NEXT_DATA__ / DOM에서 추출
    console.log('SPA 페이지에서 memberKey 추출 시도...');
    await page.goto(`https://cafe.naver.com/ca-fe/cafes/${cafeId}`, {
      waitUntil: 'networkidle2', timeout: 25000,
    });
    await delay(2000);

    // __NEXT_DATA__ + DOM에서 memberKey 추출
    const spaKey = await page.evaluate((nickName) => {
      // DOM 링크에서 먼저 시도
      const links = document.querySelectorAll('a[href*="/members/"]');
      for (const link of links) {
        const m = link.href.match(/\/members\/([A-Za-z0-9_-]{20,})/);
        if (m) return { memberKey: m[1], method: 'dom-link' };
      }

      // __NEXT_DATA__에서 추출
      const nextData = document.getElementById('__NEXT_DATA__');
      if (nextData) {
        const text = nextData.textContent;

        // 닉네임 근처의 memberKey 찾기
        if (nickName) {
          const nickIdx = text.indexOf(nickName);
          if (nickIdx !== -1) {
            const nearby = text.substring(Math.max(0, nickIdx - 500), nickIdx + 500);
            const m = nearby.match(/"memberKey"\s*:\s*"([A-Za-z0-9_-]{20,})"/);
            if (m) return { memberKey: m[1], method: 'next-data-nick' };
          }
        }

        // 유일한 memberKey가 있으면 사용
        const allKeys = [];
        const matches = text.matchAll(/"memberKey"\s*:\s*"([A-Za-z0-9_-]{20,})"/g);
        for (const m of matches) {
          if (!allKeys.includes(m[1])) allKeys.push(m[1]);
        }
        if (allKeys.length === 1) return { memberKey: allKeys[0], method: 'next-data-only' };
      }

      return null;
    }, nickName);

    if (spaKey && spaKey.memberKey) {
      console.log(`SPA에서 memberKey 추출 (${spaKey.method}):`, spaKey.memberKey);
      return { memberKey: spaKey.memberKey };
    }

    // 4단계: "내 활동" 클릭 → URL 리다이렉트에서 추출
    console.log('"내 활동" 클릭...');
    await page.evaluate(() => {
      const links = document.querySelectorAll('a');
      for (const a of links) {
        const text = a.textContent.trim();
        if (text === '내 활동' || text === '내활동' || text.includes('My') || text.includes('내 프로필')) {
          a.click();
          return true;
        }
      }
      return false;
    });
    await delay(3000);

    const currentUrl = page.url();
    const urlMatch = currentUrl.match(/\/members\/([A-Za-z0-9_-]{20,})/);
    if (urlMatch) {
      console.log('URL에서 memberKey 추출:', urlMatch[1]);
      return { memberKey: urlMatch[1] };
    }

    // 리다이렉트 후 DOM 재확인
    const domKey2 = await page.evaluate(() => {
      const links = document.querySelectorAll('a[href*="/members/"]');
      for (const link of links) {
        const m = link.href.match(/\/members\/([A-Za-z0-9_-]{20,})/);
        if (m) return m[1];
      }
      const nextData = document.getElementById('__NEXT_DATA__');
      if (nextData) {
        const m = nextData.textContent.match(/"memberKey"\s*:\s*"([A-Za-z0-9_-]{20,})"/);
        if (m) return m[1];
      }
      return null;
    });

    if (domKey2) {
      console.log('내 활동 후 DOM에서 memberKey 추출:', domKey2);
      return { memberKey: domKey2 };
    }

    // 5단계 (최종 fallback): 게시판 글 목록에서 닉네임 매칭
    if (nickName) {
      console.log('게시판 글 목록에서 닉네임 매칭 시도...');
      for (let pg = 1; pg <= 10; pg++) {
        const writers = await fetchWritersFromPage(page, cafeId, pg);
        if (writers.length === 0) break;

        const match = writers.find(w => w.nickName === nickName);
        if (match) {
          console.log(`페이지 ${pg}에서 닉네임 매칭 memberKey:`, match.memberKey);
          return { memberKey: match.memberKey };
        }
      }
    }

    return {
      error: '이 계정의 memberKey를 찾을 수 없습니다.',
      debug: `닉네임: ${nickName || '?'}`,
    };
  } catch (e) {
    return { error: e.message };
  }
}

module.exports = { likePost, fetchMemberArticles, fetchMemberKey };
