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
    // 타겟 단락 결정: 마지막 이미지보다 뒤에 있는 텍스트 컴포넌트의 마지막 단락을 우선 선택
    // (이미지 여러 개 섞인 원고에서도 항상 "가장 최근 이미지 이후"에 커서를 놓도록)
    const targetPicked = await page.evaluate(() => {
      // 이전 실행의 마커 잔존 방지
      document.querySelectorAll('[data-__focus_target="1"]').forEach(el => el.removeAttribute('data-__focus_target'));

      const textComps = Array.from(document.querySelectorAll('.se-component.se-text'));
      if (textComps.length === 0) return { ok: false, reason: 'no-text-component' };

      const imageComps = Array.from(document.querySelectorAll('.se-component.se-image'));
      let targetComp = textComps[textComps.length - 1];

      if (imageComps.length > 0) {
        const lastImg = imageComps[imageComps.length - 1];
        // 마지막 이미지보다 뒤에 오는 첫 텍스트 컴포넌트 선택 (없으면 마지막 텍스트 컴포넌트 사용)
        const afterImageTexts = textComps.filter(tc => {
          const pos = lastImg.compareDocumentPosition(tc);
          return !!(pos & Node.DOCUMENT_POSITION_FOLLOWING);
        });
        if (afterImageTexts.length > 0) {
          targetComp = afterImageTexts[0];
        }
      }

      const paras = targetComp.querySelectorAll('.se-text-paragraph');
      if (paras.length === 0) return { ok: false, reason: 'no-paragraph-in-target' };
      const lastPara = paras[paras.length - 1];
      lastPara.setAttribute('data-__focus_target', '1');
      return {
        ok: true,
        compClass: targetComp.className,
        text: (lastPara.textContent || '').trim().slice(0, 20),
        totalTextComps: textComps.length,
        totalImgComps: imageComps.length,
      };
    });

    console.log(`[focusEditorByClick] 타겟 선정:`, JSON.stringify(targetPicked));
    if (!targetPicked.ok) {
      await page.click('.se-component-content').catch(() => {});
      await delay(300);
      return false;
    }

    const last = await page.$('[data-__focus_target="1"]');
    if (!last) {
      console.log('[focusEditorByClick] 타겟 마커 요소를 찾을 수 없음');
      return false;
    }

    // SmartEditor 부유 툴바/오버레이가 클릭을 가로채는 문제 회피
    await page.evaluate(() => {
      const overlays = document.querySelectorAll(
        '.se-floating-material-menu-line, .se-side-menu-container, .se-toolbar-floating, ' +
        '.se-drop-indicator, [class*="se-floating"]'
      );
      overlays.forEach(el => {
        el.dataset.__prevPe = el.style.pointerEvents || '';
        el.style.pointerEvents = 'none';
      });
    });

    await last.evaluate(el => el.scrollIntoView({ block: 'center' }));
    await last.click();
    await delay(300);

    // 오버레이 pointer-events 원복
    await page.evaluate(() => {
      const overlays = document.querySelectorAll(
        '.se-floating-material-menu-line, .se-side-menu-container, .se-toolbar-floating, ' +
        '.se-drop-indicator, [class*="se-floating"]'
      );
      overlays.forEach(el => {
        el.style.pointerEvents = el.dataset.__prevPe || '';
        delete el.dataset.__prevPe;
      });
      // 타겟 마커 제거
      document.querySelectorAll('[data-__focus_target="1"]').forEach(el => el.removeAttribute('data-__focus_target'));
    });

    // 클릭 직후 커서 위치 검증
    const afterClick = await page.evaluate(() => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return { ok: false, reason: 'no-selection' };
      const n = sel.focusNode;
      const el = n && (n.nodeType === 1 ? n : n.parentElement);
      if (!el) return { ok: false, reason: 'no-focus-element' };
      const comp = el.closest('.se-component');
      const ae = document.activeElement;
      return {
        ok: true,
        focusComp: comp ? comp.className : '(none)',
        focusElTag: el.tagName,
        focusElClass: (el.className || '').slice(0, 60),
        activeElement: ae ? (ae.tagName + '.' + (ae.className || '')).slice(0, 60) : null,
        inSeText: !!el.closest('.se-component.se-text'),
      };
    });
    console.log('[focusEditorByClick] 클릭 후:', JSON.stringify(afterClick));
    return afterClick.ok && afterClick.inSeText;
  } catch (e) {
    console.log('에디터 focus 실패:', e.message);
    return false;
  }
}

async function typeTextInEditor(page, text) {
  const cleanContent = text.replace(/\*\*(.*?)\*\*/g, '$1');
  const lines = cleanContent.split('\n');
  let typedTotal = 0;

  // 타이핑 시작 직전 커서/포커스 상태 덤프
  const preState = await page.evaluate(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return { selection: '(empty)' };
    const n = sel.focusNode;
    const el = n && (n.nodeType === 1 ? n : n.parentElement);
    if (!el) return { selection: '(no-element)' };
    const comp = el.closest('.se-component');
    const ae = document.activeElement;
    return {
      compClass: comp ? comp.className : '(none)',
      elTag: el.tagName,
      elClass: (el.className || '').slice(0, 60),
      inSeNode: !!el.closest('.__se-node') || (el.tagName === 'SPAN' && el.classList.contains('__se-node')),
      activeElement: ae ? (ae.tagName + '.' + (ae.className || '')).slice(0, 60) : null,
    };
  });
  console.log(`[typeTextInEditor] 시작 전 커서:`, JSON.stringify(preState));

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim().length === 0) {
      await page.keyboard.press('Enter');
      await delay(150);
      continue;
    }

    // execCommand로 한 줄 삽입 (줄 단위 개별 evaluate)
    const result = await page.evaluate((t) => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return { ok: false, reason: 'no-selection' };
      const node = sel.focusNode;
      if (!node) return { ok: false, reason: 'no-focus-node' };
      const ownerEl = node.nodeType === 1 ? node : node.parentElement;
      if (!ownerEl) return { ok: false, reason: 'no-owner-el' };
      // isContentEditable 프로퍼티는 상속된 contenteditable까지 반영
      const isEditable = ownerEl.isContentEditable || document.designMode === 'on';
      if (!isEditable) return { ok: false, reason: 'not-editable' };
      if (ownerEl.closest('.se-image')) return { ok: false, reason: 'in-image-component' };
      // 가장 가까운 contenteditable 조상 (길이 비교용). 없으면 ownerEl 자체 사용
      let editable = ownerEl;
      while (editable && editable.contentEditable !== 'true' && editable !== document.body) {
        editable = editable.parentElement;
      }
      if (!editable) editable = ownerEl;
      const beforeLen = (editable.textContent || '').length;
      const cmdOk = document.execCommand('insertText', false, t);
      const afterLen = (editable.textContent || '').length;
      if (!cmdOk) return { ok: false, reason: 'exec-returned-false' };
      if (afterLen <= beforeLen) return { ok: false, reason: 'no-length-change', before: beforeLen, after: afterLen };
      return { ok: true, before: beforeLen, after: afterLen };
    }, line);
    const inserted = result.ok;
    if (!inserted) {
      console.log(`[typeTextInEditor] execCommand 실패 (line="${line.slice(0, 20)}"): ${result.reason}`, result);
    }

    if (!inserted) {
      // execCommand 실패 시 포커스 재설정 후 keyboard.type 폴백
      await page.evaluate(() => {
        // 마지막 이미지보다 뒤에 있는 텍스트 컴포넌트 우선 (여러 이미지 섞인 원고 대응)
        const textComps = Array.from(document.querySelectorAll('.se-component.se-text'));
        if (textComps.length === 0) return;
        const imageComps = Array.from(document.querySelectorAll('.se-component.se-image'));
        let targetComp = textComps[textComps.length - 1];
        if (imageComps.length > 0) {
          const lastImg = imageComps[imageComps.length - 1];
          const afterImageTexts = textComps.filter(tc =>
            !!(lastImg.compareDocumentPosition(tc) & Node.DOCUMENT_POSITION_FOLLOWING)
          );
          if (afterImageTexts.length > 0) targetComp = afterImageTexts[0];
        }
        const paras = targetComp.querySelectorAll('.se-text-paragraph');
        if (paras.length === 0) return;
        const lastP = paras[paras.length - 1];
        // SmartEditor는 .__se-node span 안쪽에 커서가 있어야 텍스트 입력을 받음
        const innerNode = lastP.querySelector('.__se-node') || lastP;
        if (innerNode.focus) innerNode.focus();
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(innerNode);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      });
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

    // 각 item의 (dataValue, optionText) 쌍을 수집 (매번 evaluate 호출 줄이기 + 로깅용)
    const itemsInfo = [];
    for (let i = 0; i < boardItems.length; i++) {
      const info = await boardItems[i].evaluate(el => ({
        dataValue: el.getAttribute('data-value') || el.querySelector('[data-value]')?.getAttribute('data-value') || '',
        text: (el.querySelector('.option_text')?.textContent || '').trim(),
      }));
      itemsInfo.push(info);
    }

    // 1차: data-value (menuId) 매칭 — 가장 정확, 이름 중복된 게시판 구분 가능
    if (menuId) {
      for (let i = 0; i < boardItems.length; i++) {
        if (String(itemsInfo[i].dataValue) === String(menuId)) {
          await boardItems[i].click();
          console.log(`게시판 menuId 매칭 선택: "${itemsInfo[i].text}" (menuId=${itemsInfo[i].dataValue})`);
          boardFound = true;
          break;
        }
      }
    }

    // 2차: 이름 매칭 (menuId 못 찾은 경우만) — 같은 이름 다수이면 첫 번째 선택됨
    // HTML 엔티티 정규화: `&bull;` / `•` 둘 다 같은 것으로 취급
    if (!boardFound && boardName) {
      const normalize = (s) => String(s || '')
        .replace(/&bull;/gi, '•')
        .replace(/&middot;/gi, '·')
        .replace(/&amp;/gi, '&')
        .replace(/\s+/g, '')
        .toLowerCase();
      const normalizedTarget = normalize(boardName);
      const matches = itemsInfo
        .map((info, i) => ({ ...info, idx: i }))
        .filter(info => normalize(info.text) === normalizedTarget);

      if (matches.length > 1) {
        console.log(`⚠️ 이름 "${boardName}"으로 ${matches.length}개 매칭됨: ${matches.map(m => `menuId=${m.dataValue}`).join(', ')} — 첫 번째 선택 (menuId 정보로 정확히 선택하려면 게시판 크롤링 후 다시 선택하세요)`);
      }
      if (matches.length >= 1) {
        await boardItems[matches[0].idx].click();
        console.log(`게시판 이름 매칭 선택: "${matches[0].text}" (menuId=${matches[0].dataValue})`);
        boardFound = true;
      }
    }

    if (!boardFound) {
      // 드롭다운 닫기
      await page.keyboard.press('Escape');
      console.log(`❌ 게시판 선택 실패: menuId=${menuId}, name="${boardName}"`);
      console.log('드롭다운의 사용 가능한 게시판 목록:');
      itemsInfo.forEach(info => console.log(`  - "${info.text}" (menuId=${info.dataValue})`));
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
  // text/image 세그먼트가 임의 개수, 임의 순서로 섞여도 동작하도록 각 세그먼트를 독립 처리
  for (let si = 0; si < bodySegments.length; si++) {
    const segment = bodySegments[si];
    try {
      if (segment.type === 'text') {
        await typeTextInEditor(page, segment.content);
        await delay(500);
      } else if (segment.type === 'image') {
        const uploaded = await uploadImage(page, segment.filePath);

        // 이미지 선택 모드 해제
        await page.keyboard.press('Escape');
        await delay(500);

        // 파일 업로더 iframe이 focus를 잡고 있을 수 있음 → 해제
        // (여러 이미지 연속 업로드 시 focus가 누적되어 후속 조작 실패하는 문제 방지)
        await page.evaluate(() => {
          const ae = document.activeElement;
          if (ae && ae.tagName === 'IFRAME' && ae.blur) ae.blur();
        });
        await delay(200);

        // 에디터 포커스 복구 (이미지 뒤의 빈 텍스트 컴포넌트 클릭)
        const focused = await focusEditorByClick(page);
        if (!focused) {
          console.log(`[세그먼트 ${si}] 이미지 후 에디터 포커스 실패 — 다음 세그먼트가 있으면 입력 불가능할 수 있음`);
        }
        await delay(500);

        // 다음 세그먼트가 있으면 Enter로 새 단락 생성 (첫 텍스트 작업과 동일 방식)
        // SmartEditor 네이티브 Enter 핸들러가 새 <p><span class="__se-node"/></p> 생성 + 커서 배치
        if (si < bodySegments.length - 1) {
          await page.keyboard.press('Enter');
          await delay(300);
        }

        console.log(`[세그먼트 ${si}] 이미지 ${uploaded ? '업로드 완료' : '업로드 실패'}`);
      }
    } catch (e) {
      // 한 세그먼트 실패가 전체 포스트를 중단시키지 않도록 격리
      console.error(`[세그먼트 ${si} (${segment.type})] 처리 중 오류:`, e.message);
    }
  }

  await delay(2000);

  // === 4. 제목 입력 ===
  console.log('제목 입력 중...');
  await page.waitForSelector('.textarea_input', { timeout: 10000 });

  // 이미지 업로드/에디터 조작 과정에서 iframe이 focus를 잡고 있을 수 있음 → 명시적으로 해제
  await page.evaluate(() => {
    const ae = document.activeElement;
    if (ae && ae.tagName === 'IFRAME' && ae.blur) ae.blur();
  });
  await delay(200);

  const titleElement = await page.$('.textarea_input');
  if (titleElement) {
    await titleElement.evaluate(el => el.scrollIntoView({ block: 'center' }));
    await titleElement.click();
    await delay(300);
    // JS focus 중복 호출 — click만으로 focus가 안 잡히는 케이스 방어
    await titleElement.evaluate(el => el.focus && el.focus());
    await delay(200);

    // 현재 activeElement 검증
    const focusedTag = await page.evaluate(() => {
      const ae = document.activeElement;
      return ae ? `${ae.tagName}.${(ae.className || '').slice(0, 40)}` : '(none)';
    });
    console.log(`[제목] focus 후 activeElement: ${focusedTag}`);

    // 기존 값 초기화 (textarea/input/contenteditable 모두 대응)
    await titleElement.evaluate(el => {
      if ('value' in el) el.value = '';
      else el.textContent = '';
    });

    await page.keyboard.type(title, { delay: 30 });
    await delay(500);

    // 실제로 제목 input에 값이 들어갔는지 검증
    const typedTitle = await titleElement.evaluate(el => 'value' in el ? el.value : el.textContent);
    console.log(`[제목] 입력 검증: "${typedTitle}" (목표="${title}")`);
    if (!typedTitle || typedTitle.trim() !== title.trim()) {
      console.log('[제목] 입력 실패 감지 — JS로 value 직접 설정 + input 이벤트 발송');
      await titleElement.evaluate((el, v) => {
        if ('value' in el) {
          el.value = v;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          el.textContent = v;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, title);
      await delay(500);
    }
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

  // 네비게이션 대기 (최대 30초)
  try {
    await page.waitForNavigation({ timeout: 30000 });
  } catch (e) {
    console.log('네비게이션 타임아웃, 현재 URL 확인...');
  }

  await delay(1000);

  // === 6. 등록 결과 확인 ===
  const currentUrl = page.url();

  // 글쓰기 페이지에서 벗어났는지 확인
  if (currentUrl.includes('articles/write')) {
    // 에러 메시지 확인
    const errorMsg = await page.evaluate(() => {
      const errEl = document.querySelector('.error_message, .alert_text');
      return errEl ? errEl.textContent.trim() : null;
    });

    // "등록 중" 이외의 에러 → 즉시 실패
    if (errorMsg && !errorMsg.includes('등록 중')) {
      throw new Error(`게시글 등록 실패: ${errorMsg}`);
    }

    // "등록 중입니다" 로딩 상태 → 버튼 재클릭 없이 네비게이션만 대기
    console.log('"등록 중" 상태 감지, 추가 대기 중... (최대 30초)');
    try {
      await page.waitForNavigation({ timeout: 30000 });
    } catch (e) {
      console.log('추가 네비게이션 대기 타임아웃');
    }
    await delay(1000);
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
