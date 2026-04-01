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
  try {
    const allPs = await page.$$('.se-text-paragraph');
    if (allPs.length > 0) {
      const last = allPs[allPs.length - 1];
      await last.evaluate(el => el.scrollIntoView({ block: 'center' }));
      await last.click();
      await delay(300);
      return true;
    }
    await page.click('.se-component-content');
    await delay(300);
    return true;
  } catch (e) {
    console.log('에디터 focus 실패:', e.message);
    return false;
  }
}

async function typeTextInEditor(page, text) {
  const cleanContent = text.replace(/\*\*(.*?)\*\*/g, '$1');
  const lines = cleanContent.split('\n');
  let typedTotal = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim().length === 0) {
      await page.keyboard.press('Enter');
      await delay(150);
      continue;
    }

    // execCommand로 한 줄 삽입 (줄 단위 개별 evaluate)
    const inserted = await page.evaluate((t) => {
      return document.execCommand('insertText', false, t);
    }, line);

    if (!inserted) {
      // execCommand 실패 시 keyboard.type 폴백
      console.log(`execCommand 실패 (줄 ${i}), keyboard.type 폴백`);
      await page.keyboard.type(line, { delay: 10 });
    }

    typedTotal += line.length;

    // 다음 줄이 있으면 Enter
    if (i < lines.length - 1) {
      await page.keyboard.press('Enter');
      await delay(100);
    }

    // 매 3줄마다 렌더링 대기
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

  // === 1. 게시판 선택 (안내 문구/양식 로드) ===
  const boardSelected = await selectBoard(page, menuId, boardName);
  if (!boardSelected) {
    throw new Error(`게시판 선택 실패: ${boardName || menuId}`);
  }

  // 안내 문구 로드 완료 대기 (고정 시간 대신 실제 로드 확인)
  console.log('게시판 양식 로드 대기...');
  let hasTemplate = false;
  try {
    await page.waitForFunction(() => {
      // se-is-empty 클래스가 없는 텍스트 모듈 = 안내 문구 있음
      return !!document.querySelector('.se-module.se-module-text:not(.se-is-empty)');
    }, { timeout: 10000 });
    hasTemplate = true;
    console.log('게시판 안내 문구 감지됨');
  } catch (e) {
    console.log('안내 문구 없음, 빈 에디터에서 작성');
  }
  await delay(2000);

  // === 2. 에디터 포커스 + 작성 위치 설정 ===
  // 커서 위치 확인
  const cursorInfo = await page.evaluate(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return '선택 없음';
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    const text = (node.textContent || '').trim();
    const offset = range.startOffset;
    return `"${text.substring(Math.max(0, offset - 10), offset)}|${text.substring(offset, offset + 10)}" (offset:${offset})`;
  });
  console.log('커서 위치:', cursorInfo);

  if (hasTemplate) {
    // 안내 문구 있음 → SmartEditor가 자동 focus + 커서를 안내 문구 끝에 배치
    // 클릭 없이 Enter만 치면 안내 문구 다음에 새 줄 생성
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await delay(500);
    console.log('안내 문구 끝에서 Enter 2회 → 작성 시작');
  } else {
    // 안내 문구 없음 → 에디터 auto-focus 안 되므로 직접 클릭
    const editorBody = await page.$('.se-component-content .se-text-paragraph');
    if (editorBody) {
      await editorBody.click();
    } else {
      await page.click('.se-component-content');
    }
    await delay(1500);
    console.log('빈 에디터 클릭 → 작성 시작');
  }

  // === 3. 본문 작성 ===
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

  // === 4. 제목 입력 ===
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
