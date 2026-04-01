const path = require('path');
const fs = require('fs');
const { delay } = require('./browser-manager');

async function navigateToWritePage(page, cafeId, menuId) {
  const writeUrl = `https://cafe.naver.com/ca-fe/cafes/${cafeId}/articles/write?boardType=L`;
  let success = false;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await page.goto(writeUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      if (page.url().includes('articles/write')) {
        success = true;
        break;
      }
      console.log(`글쓰기 페이지 접속 실패, 재시도 (${attempt}/3)...`);
      await delay(3000);
    } catch (e) {
      console.log(`글쓰기 페이지 접속 에러 (${attempt}/3):`, e.message);
      if (attempt < 3) await delay(3000);
    }
  }

  if (!success) throw new Error('글쓰기 페이지 접속 실패');

  try {
    await page.waitForSelector('.se-component-content', { timeout: 30000 });
    console.log('에디터 로드 완료');
  } catch (e) {
    throw new Error('에디터 로드 실패');
  }
  await delay(2000);
}

async function uploadImage(page, filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    console.log('이미지 파일 없음:', filePath);
    return false;
  }

  try {
    console.log('이미지 업로드 시도:', filePath);
    // input[type="file"]에 직접 업로드 (헤드리스 호환)
    const fileInput = await page.$('.se-image-toolbar-button input[type="file"], input[type="file"][accept*="image"]');
    if (fileInput) {
      await fileInput.uploadFile(filePath);
      await page.evaluate(() => {
        const input = document.querySelector('.se-image-toolbar-button input[type="file"], input[type="file"][accept*="image"]');
        if (input) input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      console.log('이미지 업로드 완료 (uploadFile)');
      await delay(4000);
      return true;
    }
    // 폴백: fileChooser 방식
    const [fileChooser] = await Promise.all([
      page.waitForFileChooser({ timeout: 10000 }),
      page.click('button.se-image-toolbar-button'),
    ]);
    await fileChooser.accept([filePath]);
    console.log('이미지 업로드 완료 (fileChooser)');
    await delay(4000);
    return true;
  } catch (e) {
    console.error('이미지 업로드 실패:', e.message);
    return false;
  }
}

async function focusEditorByClick(page) {
  // Puppeteer 클릭으로 에디터 focus (원본 코드 방식)
  try {
    const paragraph = await page.$('.se-text-paragraph');
    if (paragraph) {
      await paragraph.evaluate(el => el.scrollIntoView({ block: 'center' }));
      await paragraph.click();
      await delay(300);
      return true;
    }
    const editable = await page.$('[contenteditable="true"]');
    if (editable) {
      await editable.click();
      await delay(300);
      return true;
    }
    return false;
  } catch (e) {
    console.log('에디터 focus 실패:', e.message);
    return false;
  }
}

async function typeTextInEditor(page, text) {
  const cleanContent = text.replace(/\*\*(.*?)\*\*/g, '$1');
  const lines = cleanContent.split('\n');

  // 모든 텍스트를 한 번의 page.evaluate에서 execCommand로 삽입
  // (keyboard.type/keyboard.press 사용 안 함 — 탐지 방지)
  await page.evaluate((lineArr) => {
    for (let i = 0; i < lineArr.length; i++) {
      const line = lineArr[i];
      if (line.length > 0) {
        document.execCommand('insertText', false, line);
      }
      if (i < lineArr.length - 1) {
        document.execCommand('insertParagraph');
      }
    }
  }, lines);

  const totalChars = lines.reduce((sum, l) => sum + l.length, 0);

  // 삽입 확인
  const firstLine = lines.find(l => l.trim().length > 0) || '';
  if (firstLine.length > 0) {
    await delay(200);
    const hasContent = await page.evaluate((t) => {
      const paragraphs = document.querySelectorAll('.se-text-paragraph');
      for (const p of paragraphs) {
        if (p.textContent.includes(t.substring(0, Math.min(t.length, 10)))) return true;
      }
      return false;
    }, firstLine);

    if (!hasContent) {
      console.log('텍스트 삽입 실패, 에디터 재focus 후 재시도');
      await focusEditorByClick(page);
      // 재시도: focus 직후 같은 evaluate에서 커서 배치 + 삽입
      await page.evaluate((lineArr) => {
        // 커서를 마지막 paragraph 끝에 배치
        const paragraphs = document.querySelectorAll('.se-text-paragraph');
        const last = paragraphs[paragraphs.length - 1];
        if (last) {
          const range = document.createRange();
          const sel = window.getSelection();
          range.selectNodeContents(last);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
        }
        for (let i = 0; i < lineArr.length; i++) {
          const line = lineArr[i];
          if (line.length > 0) {
            document.execCommand('insertText', false, line);
          }
          if (i < lineArr.length - 1) {
            document.execCommand('insertParagraph');
          }
        }
      }, lines);
    }
  }

  console.log(`텍스트 입력 완료 (${totalChars}자)`);
}

async function selectBoard(page, menuId, boardName) {
  console.log(`게시판 선택 시도: menuId=${menuId}, name="${boardName}"`);

  try {
    await page.waitForSelector('.FormSelectButton', { timeout: 10000 });
    const boardSelectButton = await page.$('.FormSelectButton');
    if (!boardSelectButton) {
      console.log('게시판 선택 버튼을 찾을 수 없습니다.');
      return false;
    }

    await boardSelectButton.click();
    await page.waitForSelector('.option_list .item', { timeout: 10000 });
    await delay(500);

    const boardItems = await page.$$('.option_list .item');
    let boardFound = false;

    // 1차: 이름 매칭
    if (boardName) {
      const normalizedTarget = boardName.replace(/\s+/g, '').toLowerCase();
      for (let i = 0; i < boardItems.length; i++) {
        const optionText = await boardItems[i].$eval('.option_text', el => el.textContent.trim()).catch(() => '');
        const normalizedOption = optionText.replace(/\s+/g, '').toLowerCase();
        if (normalizedOption === normalizedTarget) {
          await boardItems[i].click();
          console.log(`게시판 이름 매칭 선택: "${optionText}"`);
          boardFound = true;
          break;
        }
      }
    }

    // 2차: data-value로 menuId 매칭
    if (!boardFound && menuId) {
      for (let i = 0; i < boardItems.length; i++) {
        const dataValue = await boardItems[i].evaluate(el => {
          return el.getAttribute('data-value') || el.querySelector('[data-value]')?.getAttribute('data-value') || '';
        });
        if (String(dataValue) === String(menuId)) {
          await boardItems[i].click();
          const optionText = await boardItems[i].$eval('.option_text', el => el.textContent.trim()).catch(() => '');
          console.log(`게시판 data-value 매칭 선택: "${optionText}" (menuId=${dataValue})`);
          boardFound = true;
          break;
        }
      }
    }

    // 3차: 첫 번째 게시판 선택 (폴백)
    if (!boardFound && boardItems.length > 0) {
      // 드롭다운 목록 출력
      const availableBoards = await page.$$eval('.option_list .item', elements =>
        elements.map(el => el.querySelector('.option_text')?.textContent?.trim() || '')
      );
      console.log('사용 가능한 게시판:', availableBoards.join(', '));

      await boardItems[0].click();
      console.log(`첫 번째 게시판으로 대체 선택: "${availableBoards[0]}"`);
      boardFound = true;
    }

    if (!boardFound) {
      // 드롭다운 닫기
      await page.keyboard.press('Escape');
      console.log('게시판 선택 실패');
      return false;
    }

    await delay(2000);
    return true;
  } catch (e) {
    console.log('게시판 선택 에러:', e.message);
    return false;
  }
}

async function writePost(page, cafeId, menuId, title, bodySegments, boardName, visibility) {
  await navigateToWritePage(page, cafeId, menuId);

  // === 1. 본문 작성 (게시판 선택 전 — 에디터 re-init 없이 안정 상태) ===
  await focusEditorByClick(page);
  await delay(1000);

  for (let si = 0; si < bodySegments.length; si++) {
    const segment = bodySegments[si];
    if (segment.type === 'text') {
      await typeTextInEditor(page, segment.content);
      await delay(500);
    } else if (segment.type === 'image') {
      const uploaded = await uploadImage(page, segment.filePath);
      if (uploaded) {
        await focusEditorByClick(page);
        await delay(1000);
      }
    }
  }

  await delay(2000);

  // === 2. 제목 입력 ===
  console.log('제목 입력 중...');
  await page.waitForSelector('.textarea_input', { timeout: 10000 });
  const titleElement = await page.$('.textarea_input');
  if (titleElement) {
    await titleElement.click();
    await delay(300);
    await page.keyboard.type(title, { delay: 30 });
    console.log(`제목 입력 완료: "${title}"`);
    await delay(1000);
  } else {
    throw new Error('제목 요소를 찾을 수 없습니다');
  }

  // === 3. 게시판 선택 (본문/제목 작성 후 — 양식이 기존 내용 위에 로드됨) ===
  const boardSelected = await selectBoard(page, menuId, boardName);
  if (!boardSelected) {
    throw new Error(`게시판 선택 실패: ${boardName || menuId}`);
  }
  console.log('게시판 선택 완료, 양식 로드 대기...');
  await delay(3000);

  // === 4. 공개 설정 (DOM 새로 조회) ===
  try {
    await page.waitForSelector('.btn_open_set', { timeout: 5000 });
    await page.click('.btn_open_set');
    await delay(1000);
    const radioSelector = (visibility === 'member') ? 'input#member[name="public"]' : 'input#all[name="public"]';
    await page.waitForSelector(radioSelector, { timeout: 5000 });
    await page.click(radioSelector);
    console.log(`공개 설정: ${visibility === 'member' ? '멤버공개' : '전체공개'} 선택`);
    await delay(500);
    await page.click('.btn_open_set').catch(() => {});
    await delay(500);
  } catch (e) {
    console.log('공개 설정 변경 실패 (무시):', e.message);
  }

  // === 6. 등록 버튼 클릭 ===
  console.log('등록 버튼 클릭...');
  await page.waitForSelector('.BaseButton--skinGreen', { timeout: 10000 });
  const writeButton = await page.$('.BaseButton--skinGreen');
  if (!writeButton) throw new Error('등록 버튼을 찾을 수 없습니다');

  // 등록 전 현재 URL 기억
  const writePageUrl = page.url();

  await writeButton.click();
  console.log('등록 버튼 클릭 완료, 네비게이션 대기...');

  // 네비게이션 대기 (최대 10초)
  try {
    await page.waitForNavigation({ timeout: 10000 });
  } catch (e) {
    console.log('네비게이션 타임아웃, 현재 URL 확인...');
  }

  await delay(1000);

  // === 6. 등록 결과 확인 ===
  const currentUrl = page.url();

  // 글쓰기 페이지에서 벗어났는지 확인
  if (currentUrl.includes('articles/write')) {
    // 아직 글쓰기 페이지 → 등록 실패 가능성
    // 에러 메시지 확인
    const errorMsg = await page.evaluate(() => {
      const errEl = document.querySelector('.error_message, .alert_text, [class*="error"]');
      return errEl ? errEl.textContent.trim() : null;
    });
    if (errorMsg) {
      throw new Error(`게시글 등록 실패: ${errorMsg}`);
    }

    // 한번 더 등록 시도 (팝업 확인 후)
    console.log('등록이 완료되지 않음, 재시도...');
    await delay(2000);
    const retryButton = await page.$('.BaseButton--skinGreen');
    if (retryButton) {
      await retryButton.click();
      try {
        await page.waitForNavigation({ timeout: 30000 });
      } catch (e) { /* ignore */ }
      await delay(3000);
    }
  }

  const finalUrl = page.url();

  // URL에 articles/ 또는 게시글 번호가 포함되어 있으면 성공
  if (finalUrl.includes('articles/') && !finalUrl.includes('articles/write')) {
    console.log(`게시글 등록 성공! URL: ${finalUrl}`);
    return finalUrl;
  }

  // cafe.naver.com에 있고 write 페이지가 아니면 성공으로 간주
  if (finalUrl.includes('cafe.naver.com') && !finalUrl.includes('articles/write')) {
    console.log(`게시글 등록 추정 성공. URL: ${finalUrl}`);
    return finalUrl;
  }

  // 여전히 write 페이지면 실패
  throw new Error('게시글 등록에 실패했습니다. 글쓰기 페이지에서 벗어나지 못했습니다.');
}

module.exports = { writePost, navigateToWritePage, uploadImage, typeTextInEditor, selectBoard };
