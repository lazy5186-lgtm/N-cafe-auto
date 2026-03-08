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

async function crawlBoards(page, cafeId, cafeName) {
  // cafeName(슬러그)이 있으면 숫자 ID를 자동 추출
  let numericId = cafeId;

  if (cafeName && !/^\d+$/.test(cafeName)) {
    const extracted = await extractNumericId(page, cafeName);
    if (extracted) {
      numericId = extracted;
    }
  }

  // cafeId가 슬러그인 경우도 처리
  if (!/^\d+$/.test(numericId) && cafeName) {
    const extracted = await extractNumericId(page, cafeName);
    if (extracted) numericId = extracted;
  }

  let boardList = await tryNewSPA(page, numericId);

  if (boardList.length === 0) {
    boardList = await tryOldFrames(page, numericId);
  }

  const dropdownBoards = await tryWritePageDropdown(page, numericId);

  if (boardList.length > 0 && dropdownBoards.length > 0) {
    for (const board of boardList) {
      const match = dropdownBoards.find(d =>
        d.menuName.replace(/\s+/g, '') === board.menuName.replace(/\s+/g, '')
      );
      board.dropdownIndex = match ? match.dropdownIndex : -1;
    }
  }

  if (boardList.length === 0 && dropdownBoards.length > 0) {
    boardList = dropdownBoards.map(d => ({
      menuId: null,
      menuName: d.menuName,
      dropdownIndex: d.dropdownIndex,
    }));
  }

  const extractedName = await extractCafeName(page, numericId);

  return { boardList, cafeName: extractedName || cafeName, cafeId: numericId };
}

module.exports = { crawlBoards, extractNumericId };
