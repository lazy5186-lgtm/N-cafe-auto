const path = require('path');
const fs = require('fs');
const { delay } = require('./browser-manager');

async function navigateToWritePage(page, cafeId, menuId) {
  const writeUrl = `https://cafe.naver.com/ca-fe/cafes/${cafeId}/articles/write?boardType=L&menuId=${menuId}`;
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
    const [fileChooser] = await Promise.all([
      page.waitForFileChooser({ timeout: 10000 }),
      page.click('button.se-image-toolbar-button'),
    ]);
    await fileChooser.accept([filePath]);
    console.log('이미지 파일 선택 완료, 업로드 대기...');
    // 이미지 업로드 완료 대기 (이미지 컴포넌트가 나타날 때까지)
    await delay(4000);
    console.log('이미지 업로드 완료');
    return true;
  } catch (e) {
    console.error('이미지 업로드 실패:', e.message);
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

    const inserted = await page.evaluate((t) => {
      return document.execCommand('insertText', false, t);
    }, line);

    if (!inserted) {
      await page.keyboard.type(line, { delay: 10 });
    }

    typedTotal += line.length;

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

  // === 1. 에디터 포커스 ===
  const editorBody = await page.$('.se-component-content .se-text-paragraph');
  if (editorBody) {
    await editorBody.click();
  } else {
    await page.click('.se-component-content');
  }
  await delay(1500);

  // === 2. bodySegments 순서대로 텍스트/이미지 삽입 ===
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

  // === 4. 게시판 선택 (드롭다운) ===
  await selectBoard(page, menuId, boardName);
  await delay(2000);

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

  // 네비게이션 대기 (최대 30초)
  try {
    await page.waitForNavigation({ timeout: 30000 });
  } catch (e) {
    console.log('네비게이션 타임아웃, 현재 URL 확인...');
  }

  await delay(3000);

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
