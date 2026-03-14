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
 */
async function crawlComments(frame) {
  console.log('댓글 크롤링 시작...');

  // 댓글 더보기 버튼 모두 클릭
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

      if (!isReply) {
        lastParentId = commentId;
      }

      if (textEl) {
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
      await textarea.click();
      await delay(500);

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

  // 이미지 첨부
  if (imagePath && fs.existsSync(imagePath)) {
    console.log('댓글 이미지 첨부 시도:', imagePath);
    try {
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
 * 대댓글(답글) 작성 — 대댓글/대대댓글 모두 지원
 * 네이버 카페에서 대댓글은 모두 flat 구조 (부모 댓글 아래 reply로 표시)
 * 대대댓글은 reply의 "답글쓰기"를 클릭하면 @멘션 형태로 작성됨
 */
async function writeReply(page, frame, targetCommentText, replyText, replyImagePath) {
  console.log(`대댓글 작성 시작: 대상="${targetCommentText.substring(0, 30)}" 답글="${replyText.substring(0, 30)}"`);

  // 0. 기존에 열린 답글 입력창이 있으면 닫기
  await frame.evaluate(() => {
    const cancelBtns = document.querySelectorAll('.comment_list .CommentWriter .btn_cancel');
    cancelBtns.forEach(btn => btn.click());
  });
  await delay(500);

  // 0-1. 댓글 더보기 버튼 모두 클릭 (숨겨진 댓글 로드)
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

  // 0-2. 댓글 목록이 로드될 때까지 대기
  for (let wait = 0; wait < 5; wait++) {
    const hasComments = await frame.evaluate(() => document.querySelectorAll('.CommentItem').length > 0);
    if (hasComments) break;
    console.log(`댓글 로드 대기 중... (${wait + 1}/5)`);
    await delay(1500);
  }

  // 1. 대상 댓글/대댓글 찾아서 답글쓰기 클릭 (재시도 포함)
  //    역순으로 검색하여 가장 최근(마지막)에 매칭되는 항목을 선택
  //    → 동일 텍스트가 있을 때 대댓글(후순위)이 부모 댓글(선순위)보다 우선 매칭
  const findAndClickReply = async (searchText, keyLen) => {
    return await frame.evaluate((searchText, keyLen) => {
      // 공백/줄바꿈 정규화 함수
      const normalize = (s) => s.replace(/[\s\n\r\t]+/g, ' ').trim();

      const items = Array.from(document.querySelectorAll('.CommentItem'));
      const searchKey = normalize(searchText).substring(0, keyLen);
      const debugInfo = items.map((item, idx) => {
        const te = item.querySelector('.text_comment');
        return `[${idx}] ${item.classList.contains('CommentItem--reply') ? 'reply' : 'parent'}: "${te ? normalize(te.innerText || te.textContent).substring(0, 40) : '(no text)'}"`;
      });

      // 역순으로 탐색 (최신/하위 항목 우선)
      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        const textEl = item.querySelector('.text_comment');
        if (!textEl) continue;
        const text = normalize(textEl.innerText || textEl.textContent);
        if (!text.includes(searchKey)) continue;

        // 답글쓰기 버튼 찾기 — 여러 셀렉터 시도
        const commentBox = item.querySelector('.comment_box') || item;

        // 방법 1: comment_info_button
        let replyBtn = Array.from(commentBox.querySelectorAll('.comment_info_button'))
          .find(b => b.textContent.trim().includes('답글'));

        // 방법 2: 일반 button/a 태그에서 답글 텍스트 찾기
        if (!replyBtn) {
          replyBtn = Array.from(commentBox.querySelectorAll('a, button'))
            .find(b => b.textContent.trim().includes('답글쓰기') || b.textContent.trim() === '답글');
        }

        if (replyBtn) {
          item.scrollIntoView({ block: 'center' });
          replyBtn.click();
          return {
            found: true,
            commentId: item.id || '',
            isReply: item.classList.contains('CommentItem--reply'),
            matchedText: text.substring(0, 40),
            matchedIndex: i,
            totalComments: items.length,
            debugInfo,
          };
        }
      }
      return { found: false, totalComments: items.length, debugInfo };
    }, searchText, keyLen);
  };

  // 재시도 루프: 댓글이 늦게 로드될 수 있으므로 여러 번 시도
  let targetFound = null;
  for (let retry = 0; retry < 3; retry++) {
    targetFound = await findAndClickReply(targetCommentText, 30);
    if (targetFound.found) break;

    // 30자 매칭 실패 → 15자로 재시도
    targetFound = await findAndClickReply(targetCommentText, 15);
    if (targetFound.found) break;

    console.log(`대상 댓글 검색 실패 (${retry + 1}/3), 재시도...`);
    console.log(`현재 댓글 수: ${targetFound.totalComments}`);
    if (targetFound.debugInfo) {
      targetFound.debugInfo.forEach(d => console.log(`  ${d}`));
    }
    await delay(2000);
  }

  if (!targetFound || !targetFound.found) {
    console.log('=== 댓글 검색 최종 실패 ===');
    if (targetFound && targetFound.debugInfo) {
      targetFound.debugInfo.forEach(d => console.log(`  ${d}`));
    }
    throw new Error(`대상 댓글을 찾을 수 없습니다: "${targetCommentText.substring(0, 30)}..."`);
  }

  console.log(`대상 댓글 발견 (index: ${targetFound.matchedIndex}/${targetFound.totalComments}, ID: ${targetFound.commentId}, isReply: ${targetFound.isReply}, text: "${targetFound.matchedText}")`);

  await delay(2000);

  // 2. 답글 입력 영역 찾기 — comment_list 안의 CommentWriter
  const writerSelector = '.comment_list .CommentWriter .comment_inbox_text';

  let textareaFound = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    textareaFound = await frame.evaluate((sel) => !!document.querySelector(sel), writerSelector);
    if (textareaFound) break;
    console.log(`답글 입력 영역 대기 중... (${attempt + 1}/10)`);
    await delay(1000);
  }

  if (!textareaFound) {
    throw new Error('답글 입력 영역을 찾을 수 없습니다');
  }

  const textarea = await frame.$(writerSelector);
  if (!textarea) {
    throw new Error('답글 입력 textarea를 찾을 수 없습니다');
  }

  // textarea 클릭 후 포커스
  await textarea.click();
  await delay(500);

  // 기존 @멘션 확인 (대대댓글에서 자동 삽입됨)
  const existingText = await frame.evaluate((sel) => {
    const ta = document.querySelector(sel);
    return ta ? ta.value : '';
  }, writerSelector);

  if (existingText.trim()) {
    console.log(`기존 멘션 발견: "${existingText.trim()}"`);
    // 커서를 텍스트 끝으로 이동
    await frame.evaluate((sel) => {
      const ta = document.querySelector(sel);
      if (ta) {
        const len = ta.value.length;
        ta.setSelectionRange(len, len);
        ta.focus();
      }
    }, writerSelector);
    await delay(200);
    // 키보드로 직접 입력 (Vue.js 이벤트 정상 트리거)
    await textarea.type(' ' + replyText, { delay: 30 });
  } else {
    // 멘션 없음 — 키보드로 직접 입력
    await textarea.type(replyText, { delay: 30 });
  }

  console.log('답글 텍스트 입력 완료');
  await delay(1000);

  // 3. 이미지 첨부
  if (replyImagePath && fs.existsSync(replyImagePath)) {
    console.log('답글 이미지 첨부 시도:', replyImagePath);
    try {
      const writerScope = '.comment_list .CommentWriter';
      const imgButton = await frame.$(`${writerScope} label.button_file`);
      if (imgButton) {
        const [fileChooser] = await Promise.all([
          page.waitForFileChooser({ timeout: 5000 }),
          imgButton.click(),
        ]);
        await fileChooser.accept([replyImagePath]);
        console.log('답글 이미지 업로드 완료 (fileChooser)');
        await delay(3000);
      } else {
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

  // 4. 등록 버튼 클릭
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
