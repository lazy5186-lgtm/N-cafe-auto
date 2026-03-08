const fs = require('fs');
const { delay } = require('./browser-manager');

async function navigateToArticle(page, articleUrl) {
  console.log('게시글 이동:', articleUrl);
  await page.goto(articleUrl, { waitUntil: 'networkidle2', timeout: 30000 });
  await delay(3000);

  // iframe 접근 시도
  let frame = page;
  const frameHandle = await page.$('#cafe_main');
  if (frameHandle) {
    const contentFrame = await frameHandle.contentFrame();
    if (contentFrame) {
      frame = contentFrame;
      console.log('iframe 접근 성공');
    }
  }
  return frame;
}

/**
 * 게시글의 댓글 목록 크롤링
 * @returns {Array<{ commentId, nickname, text, date, isReply }>}
 */
async function crawlComments(frame) {
  console.log('댓글 크롤링 시작...');

  // 댓글 더보기 버튼이 있으면 모두 클릭
  let moreClicked = true;
  while (moreClicked) {
    moreClicked = await frame.evaluate(() => {
      const moreBtn = document.querySelector('.comment_more_box .btn_more, .btn_comment_more, a.btn_more');
      if (moreBtn && moreBtn.offsetParent !== null) {
        moreBtn.click();
        return true;
      }
      return false;
    });
    if (moreClicked) await delay(1500);
  }

  const comments = await frame.evaluate(() => {
    const results = [];
    const items = document.querySelectorAll('.CommentItem');
    let lastParentId = '';
    for (const item of items) {
      const nicknameEl = item.querySelector('.comment_nickname');
      const textEl = item.querySelector('.text_comment');
      const dateEl = item.querySelector('.comment_info_date');
      const isReply = item.classList.contains('CommentItem--reply');
      const commentId = item.id || '';

      // 부모 댓글이면 lastParentId 갱신
      if (!isReply) {
        lastParentId = commentId;
      }

      if (textEl) {
        // 대댓글의 경우 멘션된 닉네임 추출 (text_nickname)
        const mentionEl = item.querySelector('.text_nickname');
        results.push({
          commentId,
          nickname: nicknameEl ? nicknameEl.textContent.trim() : '',
          text: textEl.textContent.trim(),
          date: dateEl ? dateEl.textContent.trim() : '',
          isReply,
          parentCommentId: isReply ? lastParentId : '',
          mentionNickname: mentionEl ? mentionEl.textContent.trim() : '',
        });
      }
    }
    return results;
  });

  console.log(`댓글 ${comments.length}개 크롤링 완료`);
  return comments;
}

async function writeComment(page, frame, text, imagePath) {
  console.log(`댓글 작성 시작: "${text.substring(0, 30)}..."`);

  // 댓글 입력 영역 찾기 - 여러 셀렉터 시도
  const textareaSelectors = [
    '.comment_inbox_text',
    '.CommentWriter textarea',
    'textarea[placeholder*="댓글"]',
    '.comment_box textarea',
  ];

  let textareaFound = false;
  for (const sel of textareaSelectors) {
    const textarea = await frame.$(sel);
    if (textarea) {
      // 클릭하여 포커스
      await textarea.click();
      await delay(500);

      // 텍스트 입력
      await frame.evaluate((selector, commentText) => {
        const ta = document.querySelector(selector);
        if (ta) {
          ta.focus();
          ta.value = commentText;
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          ta.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, sel, text);

      textareaFound = true;
      console.log(`댓글 텍스트 입력 완료 (${sel})`);
      break;
    }
  }

  if (!textareaFound) {
    throw new Error('댓글 입력 영역을 찾을 수 없습니다');
  }

  await delay(1000);

  // 이미지 첨부 (있는 경우)
  if (imagePath && fs.existsSync(imagePath)) {
    console.log('댓글 이미지 첨부 시도:', imagePath);
    try {
      // 상단 댓글 작성 영역의 label.button_file 찾기
      // comment_list 밖(하단)의 CommentWriter 안에 있는 label.button_file
      const imgButton = await frame.$('.comment_attach label.button_file, label.button_file');
      if (imgButton) {
        const [fileChooser] = await Promise.all([
          page.waitForFileChooser({ timeout: 5000 }),
          imgButton.click(),
        ]);
        await fileChooser.accept([imagePath]);
        console.log('댓글 이미지 업로드 완료 (fileChooser)');
        await delay(3000);
      } else {
        console.log('댓글 이미지 첨부 버튼을 찾을 수 없습니다');
      }
    } catch (e) {
      console.error('댓글 이미지 첨부 실패:', e.message);
    }
  }

  // 등록 버튼 클릭
  const submitSelectors = [
    '.btn_register',
    '.button.btn_register',
    'a[role="button"].btn_register',
    '.register_box a',
    '.comment_box .btn_submit',
  ];

  let submitted = false;
  for (const sel of submitSelectors) {
    const btn = await frame.$(sel);
    if (btn) {
      await btn.click();
      submitted = true;
      console.log(`댓글 등록 버튼 클릭 (${sel})`);
      break;
    }
  }

  if (!submitted) {
    // evaluate로 시도
    submitted = await frame.evaluate(() => {
      const selectors = ['.btn_register', 'a.btn_register', '.register_box a'];
      for (const sel of selectors) {
        const btn = document.querySelector(sel);
        if (btn) { btn.click(); return true; }
      }
      return false;
    });
  }

  if (!submitted) {
    throw new Error('댓글 등록 버튼을 찾을 수 없습니다');
  }

  await delay(3000);
  console.log('댓글 등록 완료');
  return true;
}

/**
 * 대댓글(답글) 작성
 * @param {*} page - 메인 page 객체
 * @param {*} frame - iframe 또는 page
 * @param {string} targetCommentText - 대상 댓글 텍스트 (부분 매칭)
 * @param {string} replyText - 답글 내용
 * @param {string|null} replyImagePath - 답글 이미지 경로
 */
async function writeReply(page, frame, targetCommentText, replyText, replyImagePath) {
  console.log(`대댓글 작성 시작: 대상="${targetCommentText.substring(0, 30)}" 답글="${replyText.substring(0, 30)}"`);

  // 0. 기존에 열린 답글 입력창이 있으면 닫기
  await frame.evaluate(() => {
    const cancelBtn = document.querySelector('.comment_list .CommentWriter .btn_cancel');
    if (cancelBtn) cancelBtn.click();
  });
  await delay(500);

  // 1. 대상 댓글 찾아서 답글쓰기 클릭
  const targetFound = await frame.evaluate((searchText) => {
    const items = document.querySelectorAll('.CommentItem');
    for (const item of items) {
      const textEl = item.querySelector('.text_comment');
      if (!textEl) continue;
      const text = textEl.textContent.trim();
      if (text.includes(searchText.substring(0, 30))) {
        const replyBtn = Array.from(item.querySelectorAll('.comment_info_button'))
          .find(b => b.textContent.trim().includes('답글'));
        if (replyBtn) {
          replyBtn.click();
          return { found: true, commentId: item.id };
        }
      }
    }
    return { found: false };
  }, targetCommentText);

  if (!targetFound.found) {
    throw new Error(`대상 댓글을 찾을 수 없습니다: "${targetCommentText.substring(0, 30)}..."`);
  }

  console.log(`대상 댓글 발견 (ID: ${targetFound.commentId}), 답글 입력 대기...`);
  await delay(2000);

  // 2. 답글 입력 영역 찾기 — comment_list 안의 CommentWriter만 대상
  //    (상위 댓글 입력란은 comment_list 밖 하단에 있으므로 제외됨)
  const writerSelector = '.comment_list .CommentWriter .comment_inbox_text';

  let textareaFound = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    textareaFound = await frame.evaluate((sel) => !!document.querySelector(sel), writerSelector);
    if (textareaFound) break;
    await delay(1000);
  }

  if (!textareaFound) {
    throw new Error('답글 입력 영역을 찾을 수 없습니다');
  }

  const textarea = await frame.$(writerSelector);
  if (textarea) {
    await textarea.click();
    await delay(300);
  }

  await frame.evaluate((sel, text) => {
    const ta = document.querySelector(sel);
    if (ta) {
      ta.focus();
      ta.value = text;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, writerSelector, replyText);

  console.log('답글 텍스트 입력 완료');
  await delay(1000);

  // 3. 이미지 첨부 — reply writer 안의 label.button_file 클릭 → fileChooser
  if (replyImagePath && fs.existsSync(replyImagePath)) {
    console.log('답글 이미지 첨부 시도:', replyImagePath);
    try {
      const writerScope = '.comment_list .CommentWriter';

      // label.button_file 찾기 (for="attachN" 형태의 label)
      const imgButton = await frame.$(`${writerScope} label.button_file`);
      if (imgButton) {
        // fileChooser는 메인 page에서 대기해야 iframe 내부 input도 감지됨
        const [fileChooser] = await Promise.all([
          page.waitForFileChooser({ timeout: 5000 }),
          imgButton.click(),
        ]);
        await fileChooser.accept([replyImagePath]);
        console.log('답글 이미지 업로드 완료 (fileChooser)');
        await delay(3000);
      } else {
        // label을 못 찾으면 input[type="file"]을 직접 찾아 클릭
        const fileInput = await frame.$(`${writerScope} input[type="file"]`);
        if (fileInput) {
          const [fileChooser] = await Promise.all([
            page.waitForFileChooser({ timeout: 5000 }),
            frame.evaluate((scope) => {
              const input = document.querySelector(scope + ' input[type="file"]');
              if (input) input.click();
            }, writerScope),
          ]);
          await fileChooser.accept([replyImagePath]);
          console.log('답글 이미지 업로드 완료 (input click)');
          await delay(3000);
        } else {
          console.log('답글 이미지 첨부 버튼을 찾을 수 없습니다');
        }
      }
    } catch (e) {
      console.error('답글 이미지 첨부 실패:', e.message);
    }
  }

  // 4. 등록 버튼 클릭 — comment_list 안의 CommentWriter의 등록 버튼만
  const submitted = await frame.evaluate(() => {
    const writer = document.querySelector('.comment_list .CommentWriter');
    if (!writer) return false;
    const btn = writer.querySelector('.btn_register');
    if (btn) { btn.click(); return true; }
    return false;
  });

  if (!submitted) {
    throw new Error('답글 등록 버튼을 찾을 수 없습니다');
  }

  await delay(3000);
  console.log('대댓글 등록 완료');
  return true;
}

module.exports = { navigateToArticle, crawlComments, writeComment, writeReply };
