const { delay } = require('./browser-manager');

async function deletePost(page, postUrl) {
  // dialog(confirm) 자동 수락
  const dialogHandler = async (dialog) => {
    try { await dialog.accept(); } catch (e) { /* 이미 처리됨 */ }
  };
  page.on('dialog', dialogHandler);

  try {
    await page.goto(postUrl, { waitUntil: 'networkidle0', timeout: 30000 });
    await delay(3000);

    // iframe 포함 모든 프레임에서 삭제 버튼 찾기
    const allFrames = [page, ...page.frames()];
    let found = false;

    for (const frame of allFrames) {
      try {
        const clicked = await frame.evaluate(() => {
          // ArticleBottomBtns 안의 삭제 버튼
          const links = document.querySelectorAll('.ArticleBottomBtns a.BaseButton, .ArticleBottomBtns button');
          for (const a of links) {
            const txt = a.querySelector('.BaseButton__txt');
            if (txt && txt.textContent.trim() === '삭제') {
              a.click();
              return true;
            }
          }
          // fallback: 모든 a/button
          const allEls = document.querySelectorAll('a[role="button"], button');
          for (const el of allEls) {
            const span = el.querySelector('.BaseButton__txt');
            const text = span ? span.textContent.trim() : el.textContent.trim();
            if (text === '삭제') {
              el.click();
              return true;
            }
          }
          return false;
        });

        if (clicked) {
          found = true;
          console.log('삭제 버튼 클릭 완료 (frame:', frame.url().substring(0, 50), ')');
          break;
        }
      } catch (e) {
        // 접근 불가 프레임 무시
      }
    }

    if (!found) {
      throw new Error('삭제 버튼을 찾을 수 없습니다.');
    }

    // confirm 대화상자는 dialog 핸들러가 자동 수락
    await delay(3000);
    return true;
  } finally {
    page.off('dialog', dialogHandler);
  }
}

module.exports = { deletePost };
