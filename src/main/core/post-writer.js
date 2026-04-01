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

async function ensureEditorFocus(page) {
  const focused = await page.evaluate(() => {
    const active = document.activeElement;
    if (active && (active.contentEditable === 'true' || active.closest('[contenteditable="true"]'))) {
      return true;
    }
    // contenteditable 요소를 찾아서 focus
    const editable = document.querySelector('[contenteditable="true"]');
    if (editable) {
      editable.focus();
      // 커서를 마지막 paragraph에 배치
      const paragraph = editable.querySelector('.se-text-paragraph:last-child') || editable.querySelector('.se-text-paragraph');
      if (paragraph) {
        const range = document.createRange();
        const sel = window.getSelection();
        range.selectNodeContents(paragraph);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      return true;
    }
    return false;
  });
  return focused;
}

async function typeTextInEditor(page, text) {
  const cleanContent = text.replace(/\*\*(.*?)\*\*/g, '$1');
  const lines = cleanContent.split('\n');
  let typedTotal = 0;
  let useKeyboardType = false;

  // 타이핑 시작 전 에디터 focus 확인
  const editorReady = await ensureEditorFocus(page);
  if (!editorReady) {
    console.log('에디터 focus 실패, keyboard.type 모드로 전환');
    useKeyboardType = true;
  }
  await delay(300);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().length === 0) {
      await page.keyboard.press('Enter');
      await delay(150);
      continue;
    }

    if (useKeyboardType) {
      await page.keyboard.type(line, { delay: 10 });
    } else {
      const inserted = await page.evaluate((t) => {
        return document.execCommand('insertText', false, t);
      }, line);

      if (!inserted) {
        // execCommand 실패 → focus 재확인 후 keyboard.type
        await ensureEditorFocus(page);
        await delay(200);
        await page.keyboard.type(line, { delay: 10 });
        useKeyboardType = true;
      } else {
        // 첫 번째 줄에서만 실제 삽입 확인 (이후는 신뢰)
        if (i === 0 || (i === 1 && typedTotal === 0)) {
          await delay(100);
          const hasContent = await page.evaluate((t) => {
            const paragraphs = document.querySelectorAll('.se-text-paragraph');
            for (const p of paragraphs) {
              if (p.textContent.includes(t.substring(0, 10))) return true;
            }
            return false;
          }, line);

          if (!hasContent) {
            console.log('execCommand 삽입 실패 감지, keyboard.type로 전환');
            await ensureEditorFocus(page);
            await delay(300);
            await page.keyboard.type(line, { delay: 10 });
            useKeyboardType = true;
          }
        }
      }
    }

    typedTotal += line.length;

    if (i < lines.length - 1) {
      await page.keyboard.press('Enter');
      await delay(100);
    }

    if (i > 0 && i % 3 === 0) {
      await delay(200 + Math.random() * 100);
    }
  }

  console.log(`텍스트 입력 완료 (${typedTotal}자)`);
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

  // === 1. 게시판 선택 (선택하면 양식이 로드됨) ===
  const boardSelected = await selectBoard(page, menuId, boardName);
  if (!boardSelected) {
    throw new Error(`게시판 선택 실패: ${boardName || menuId}`);
  }
  console.log('게시판 양식 로드 대기...');
  await delay(3000);

  // === 2. 양식 감지 + 에디터 포커스 ===
  const hasTemplate = await page.evaluate(() => {
    const paragraphs = document.querySelectorAll('.se-text-paragraph');
    for (const p of paragraphs) {
      if (p.textContent.trim().length > 0) return true;
    }
    return false;
  });

  if (hasTemplate) {
    // 양식이 있으면 마지막 paragraph 끝에 커서 배치
    console.log('게시판 양식 감지됨 — 마지막 paragraph 끝으로 이동');
    await page.evaluate(() => {
      const paragraphs = document.querySelectorAll('.se-text-paragraph');
      const last = paragraphs[paragraphs.length - 1];
      last.scrollIntoView({ block: 'center' });
      // contenteditable 요소 명시적 focus
      const editable = last.closest('[contenteditable="true"]');
      if (editable) editable.focus();
      const range = document.createRange();
      const sel = window.getSelection();
      if (last.childNodes.length > 0) {
        const lastChild = last.childNodes[last.childNodes.length - 1];
        if (lastChild.nodeType === 3) {
          range.setStart(lastChild, lastChild.length);
          range.setEnd(lastChild, lastChild.length);
        } else {
          range.setStartAfter(lastChild);
          range.setEndAfter(lastChild);
        }
      } else {
        range.selectNodeContents(last);
        range.collapse(false);
      }
      sel.removeAllRanges();
      sel.addRange(range);
    });
    await delay(500);
    await page.keyboard.press('End');
    await delay(200);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await delay(500);
  } else {
    // 에디터 본문 영역에 포커스 및 커서 배치
    await page.evaluate(() => {
      const paragraph = document.querySelector('.se-text-paragraph');
      if (paragraph) {
        paragraph.scrollIntoView({ block: 'center' });
        // contenteditable 요소 명시적 focus
        const editable = paragraph.closest('[contenteditable="true"]');
        if (editable) editable.focus();
        const range = document.createRange();
        const sel = window.getSelection();
        range.selectNodeContents(paragraph);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      } else {
        // paragraph 없으면 contenteditable 직접 focus
        const editable = document.querySelector('[contenteditable="true"]');
        if (editable) editable.focus();
      }
    });
  }
  await delay(1000);

  // === 3. bodySegments 순서대로 텍스트/이미지 삽입 ===
  for (let si = 0; si < bodySegments.length; si++) {
    const segment = bodySegments[si];
    if (segment.type === 'text') {
      await typeTextInEditor(page, segment.content);
      await delay(500);
    } else if (segment.type === 'image') {
      const uploaded = await uploadImage(page, segment.filePath);
      if (uploaded) {
        // 이미지 삽입 후 에디터 끝으로 포커스 이동
        await page.evaluate(() => {
          const paragraphs = document.querySelectorAll('.se-component-content .se-text-paragraph');
          if (paragraphs.length > 0) {
            const last = paragraphs[paragraphs.length - 1];
            last.click();
            // 커서를 텍스트 끝으로
            const range = document.createRange();
            const sel = window.getSelection();
            range.selectNodeContents(last);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
          }
        });
        await delay(1000);
      }
    }
  }

  await delay(2000);

  // === 3. 제목 입력 ===
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

  // === 5. 공개 설정 ===
  try {
    const openSetBtn = await page.$('.btn_open_set');
    if (openSetBtn) {
      await openSetBtn.click();
      await delay(1000);
      const radioId = (visibility === 'member') ? 'input#member[name="public"]' : 'input#all[name="public"]';
      const radio = await page.$(radioId);
      if (radio) {
        await radio.click();
        console.log(`공개 설정: ${visibility === 'member' ? '멤버공개' : '전체공개'} 선택`);
        await delay(500);
      }
      await openSetBtn.click().catch(() => {});
      await delay(500);
    }
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
