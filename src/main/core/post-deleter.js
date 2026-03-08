const { delay } = require('./browser-manager');
const store = require('../data/store');

async function deletePost(page, postUrl) {
  await page.goto(postUrl, { waitUntil: 'networkidle0', timeout: 30000 });
  await delay(2000);

  // iframe 내부의 게시글일 수 있으므로 프레임 확인
  let frame = page;
  const cafeFrame = page.frames().find(f => f.url().includes('cafe.naver.com/ca-fe/'));
  if (cafeFrame) frame = cafeFrame;

  // 더보기 메뉴 클릭
  const moreBtn = await frame.$('.article_tool .ArticleTool .button_more') ||
                  await frame.$('.tool_area .ArticleTool button[class*="more"]') ||
                  await frame.$('a.link_more') ||
                  await frame.$('button.BaseButton.size_default[aria-haspopup]');

  if (!moreBtn) {
    throw new Error('게시글 더보기 버튼을 찾을 수 없습니다.');
  }
  await moreBtn.click();
  await delay(1000);

  // 삭제 버튼 클릭
  const deleteBtn = await frame.$x("//a[contains(text(),'삭제')]") ||
                    await frame.$x("//button[contains(text(),'삭제')]") ||
                    await frame.$x("//span[contains(text(),'삭제')]/parent::*");

  let clicked = false;
  if (deleteBtn && deleteBtn.length > 0) {
    await deleteBtn[0].click();
    clicked = true;
  }

  if (!clicked) {
    // CSS 셀렉터로 재시도
    const delLink = await frame.$('a.del, button.del, .delete_button, [class*="delete"]');
    if (delLink) {
      await delLink.click();
      clicked = true;
    }
  }

  if (!clicked) {
    throw new Error('삭제 버튼을 찾을 수 없습니다.');
  }

  await delay(1500);

  // 확인 다이얼로그 (page.on('dialog') 에서 자동 accept 설정 필요)
  // 추가 확인 버튼이 있을 수 있음
  const confirmBtn = await frame.$('.confirm_button, .btn_ok, button.BaseButton.color_red') ||
                     await frame.$x("//button[contains(text(),'확인')]");

  if (confirmBtn) {
    if (Array.isArray(confirmBtn) && confirmBtn.length > 0) {
      await confirmBtn[0].click();
    } else if (confirmBtn.click) {
      await confirmBtn.click();
    }
  }

  await delay(2000);
  return true;
}

async function processDueDeletes(browserManager, auth, logFn) {
  const log = logFn || (() => {});
  const dueEntries = store.getDueDeletes();

  if (dueEntries.length === 0) return [];

  log(`삭제 예정 게시글 ${dueEntries.length}건 처리 시작`);
  const results = [];

  // 계정별로 그룹핑
  const grouped = {};
  for (const entry of dueEntries) {
    if (!grouped[entry.accountId]) grouped[entry.accountId] = [];
    grouped[entry.accountId].push(entry);
  }

  for (const [accountId, entries] of Object.entries(grouped)) {
    const account = store.getAccount(accountId);
    if (!account) {
      for (const entry of entries) {
        store.updateDeleteEntry(entry.postUrl, { status: 'failed', error: '계정 없음' });
        results.push({ ...entry, status: 'failed', error: '계정 없음' });
      }
      continue;
    }

    let browser = null;
    try {
      browser = await browserManager.launchBrowser();
      const page = await browserManager.createPage(browser);
      const loginResult = await auth.loginAccount(page, account.id, account.password);

      if (!loginResult.success) {
        for (const entry of entries) {
          store.updateDeleteEntry(entry.postUrl, { status: 'failed', error: '로그인 실패' });
          results.push({ ...entry, status: 'failed', error: '로그인 실패' });
        }
        await browser.close();
        continue;
      }

      for (const entry of entries) {
        try {
          await deletePost(page, entry.postUrl);
          store.updateDeleteEntry(entry.postUrl, { status: 'deleted', deletedAt: new Date().toISOString() });
          results.push({ ...entry, status: 'deleted' });
          log(`삭제 완료: ${entry.postTitle || entry.postUrl}`);
        } catch (e) {
          store.updateDeleteEntry(entry.postUrl, { status: 'failed', error: e.message });
          results.push({ ...entry, status: 'failed', error: e.message });
          log(`삭제 실패: ${entry.postTitle || entry.postUrl} - ${e.message}`);
        }
      }

      await browser.close();
    } catch (e) {
      if (browser) await browser.close().catch(() => {});
      log(`삭제 처리 오류 (${accountId}): ${e.message}`);
    }
  }

  return results;
}

module.exports = { deletePost, processDueDeletes };
