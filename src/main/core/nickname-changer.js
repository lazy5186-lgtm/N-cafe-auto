const { delay } = require('./browser-manager');

async function changeNickname(page, browser, cafeId, newNickname) {
  if (!newNickname || newNickname.trim().length === 0) return { success: true, skipped: true };

  try {
    // 1. 카페 메인 페이지로 이동 (카페 이름/슬러그로 접속)
    await page.goto(`https://cafe.naver.com/${cafeId}`, {
      waitUntil: 'networkidle2', timeout: 30000,
    });
    await delay(3000);

    // 2. "나의활동" 탭 클릭
    const myActionClicked = await page.evaluate(() => {
      // old-style 셀렉터 (onclick 방식)
      const btn1 = document.querySelector('.info-action-tab button[onclick*="showMyAction"]');
      if (btn1) { btn1.click(); return 'old-style'; }
      // old-style fallback: tit-action-on
      const btn2 = document.querySelector('li.tit-action-on button');
      if (btn2) { btn2.click(); return 'old-style-fallback'; }
      // SPA 셀렉터
      const btn3 = document.querySelector('button[aria-controls="tab_my"]');
      if (btn3) { btn3.click(); return 'spa'; }
      // role=tab 텍스트 매칭
      const tabBtns = document.querySelectorAll('button[role="tab"]');
      for (const b of tabBtns) {
        if (b.textContent.trim() === '나의활동') { b.click(); return 'tab-text'; }
      }
      // 최종 fallback: 모든 버튼에서 텍스트 매칭
      const allBtns = document.querySelectorAll('button');
      for (const b of allBtns) {
        if (b.textContent.trim() === '나의활동') { b.click(); return 'text-fallback'; }
      }
      return null;
    });

    if (!myActionClicked) {
      return { success: false, error: '"나의활동" 탭을 찾을 수 없습니다' };
    }
    await delay(3000);

    // 3. "프로필 변경하기" 링크 클릭 → 팝업 창 열림
    //    실제 HTML: <a class="lab_thmb" onclick="cafeMemberInfoEdit(event)">프로필 변경하기</a>
    //    .ia-action-data .prfl_thmb 안에 있음

    // 팝업 창을 감지하기 위한 준비
    const popupPagePromise = new Promise((resolve) => {
      browser.once('targetcreated', async (target) => {
        if (target.type() === 'page') {
          const newPage = await target.page();
          resolve(newPage);
        }
      });
      // 10초 후 타임아웃
      setTimeout(() => resolve(null), 10000);
    });

    const profileEditClicked = await page.evaluate(() => {
      // 방법 1: onclick="cafeMemberInfoEdit" 링크
      const link1 = document.querySelector('a[onclick*="cafeMemberInfoEdit"]');
      if (link1) { link1.click(); return 'onclick-link'; }
      // 방법 2: .lab_thmb 클래스 링크
      const link2 = document.querySelector('a.lab_thmb');
      if (link2) { link2.click(); return 'lab_thmb'; }
      // 방법 3: .prfl_thmb 안의 링크
      const link3 = document.querySelector('.prfl_thmb a');
      if (link3) { link3.click(); return 'prfl_thmb-a'; }
      // 방법 4: "프로필 변경하기" 텍스트를 포함하는 a 태그
      const allLinks = document.querySelectorAll('a');
      for (const a of allLinks) {
        if (a.textContent.trim().includes('프로필 변경')) { a.click(); return 'text-match'; }
      }
      // 방법 5: SPA 버튼 (class*="btn_edit")
      const btn = document.querySelector('button[class*="btn_edit"]');
      if (btn) { btn.click(); return 'spa-btn'; }
      return null;
    });

    if (!profileEditClicked) {
      return { success: false, error: '"프로필 변경하기" 링크를 찾을 수 없습니다' };
    }

    // 4. 팝업 창 대기
    let popupPage = await popupPagePromise;

    if (!popupPage) {
      // 팝업이 열리지 않은 경우 — 직접 URL 접속 시도 (fallback)
      // memberId 추출 시도
      const memberInfo = await page.evaluate(() => {
        // .prfl_info a 에서 memberId 추출
        const profileLink = document.querySelector('.ia-action-data .prfl_info a');
        if (profileLink) {
          const href = profileLink.getAttribute('href') || '';
          const memberMatch = href.match(/members\/([^/?]+)/);
          if (memberMatch) return { memberId: memberMatch[1] };
        }
        // 다른 방법: 모든 a 태그에서 members 패턴
        const allLinks = document.querySelectorAll('a[href*="members/"]');
        for (const a of allLinks) {
          const href = a.getAttribute('href') || '';
          const m = href.match(/members\/([^/?]+)/);
          if (m) return { memberId: m[1] };
        }
        // cafeId 추출
        const scripts = document.querySelectorAll('script');
        for (const s of scripts) {
          const text = s.textContent || '';
          const m = text.match(/["']?(?:g_)?cafe[_]?[Ii]d["']?\s*[:=]\s*["']?(\d+)["']?/);
          if (m) return { numericCafeId: m[1] };
        }
        return null;
      });

      if (memberInfo && memberInfo.memberId) {
        // 숫자 카페 ID 추출
        let numericCafeId = memberInfo.numericCafeId;
        if (!numericCafeId) {
          numericCafeId = await page.evaluate(() => {
            const scripts = document.querySelectorAll('script');
            for (const s of scripts) {
              const text = s.textContent || '';
              const m = text.match(/["']?(?:g_)?cafe[_]?[Ii]d["']?\s*[:=]\s*["']?(\d+)["']?/);
              if (m) return m[1];
            }
            const links = document.querySelectorAll('a[href*="cafes/"]');
            for (const a of links) {
              const m = a.href.match(/cafes\/(\d+)/);
              if (m) return m[1];
            }
            return null;
          });
        }

        if (numericCafeId) {
          const profileUrl = `https://cafe.naver.com/ca-fe/cafes/${numericCafeId}/members/${memberInfo.memberId}/profile-setting`;

          // 새 페이지에서 직접 접속
          popupPage = await browser.newPage();
          // 기존 페이지 쿠키 복사
          const cookies = await page.cookies();
          await popupPage.setCookie(...cookies);

          await popupPage.goto(profileUrl, { waitUntil: 'networkidle2', timeout: 30000 });
          await delay(2000);

          // "비정상적인 접근입니다." 팝업 처리 — 확인 버튼 클릭
          const abnormalPopupHandled = await popupPage.evaluate(() => {
            // BaseButton--gray 확인 버튼
            const grayBtn = document.querySelector('a.BaseButton.BaseButton--gray');
            if (grayBtn) {
              const txt = grayBtn.querySelector('.BaseButton__txt');
              if (txt && txt.textContent.trim() === '확인') { grayBtn.click(); return true; }
            }
            // 일반 확인 버튼
            const allBtns = document.querySelectorAll('a.BaseButton, button.BaseButton, button');
            for (const b of allBtns) {
              const span = b.querySelector('.BaseButton__txt');
              if (span && span.textContent.trim() === '확인') { b.click(); return true; }
              if (b.textContent.trim() === '확인') { b.click(); return true; }
            }
            return false;
          });

          if (abnormalPopupHandled) {
            await delay(2000);
          }
        }
      }
    }

    if (!popupPage) {
      return { success: false, error: '프로필 변경 팝업 창을 열 수 없습니다' };
    }

    // 팝업 페이지가 로드될 때까지 대기
    await popupPage.waitForSelector('.profile_form', { timeout: 15000 }).catch(() => null);
    await delay(1000);

    // 5. 별명 textarea 찾기 (팝업 페이지에서)
    const textareaSelector = '.profile_form .text_area textarea';
    await popupPage.waitForSelector(textareaSelector, { timeout: 10000 }).catch(() => null);

    const textarea = await popupPage.$(textareaSelector);
    if (!textarea) {
      await popupPage.close().catch(() => {});
      return { success: false, error: '별명 입력 필드를 찾을 수 없습니다' };
    }

    // 6. 별명 입력 + 중복 시 재시도
    const isRandom = newNickname === 'random';
    const nickGen = isRandom ? require('./nickname-generator') : null;
    const maxAttempts = isRandom ? 5 : 1;
    let finalNickname = isRandom ? nickGen.generateNickname() : newNickname;

    const clearAndType = async (nick) => {
      const deleteBtn = await popupPage.$('.profile_form .btn_delete');
      if (deleteBtn) {
        await deleteBtn.click();
        await delay(500);
      } else {
        await textarea.click();
        await popupPage.keyboard.down('Control');
        await popupPage.keyboard.press('a');
        await popupPage.keyboard.up('Control');
        await delay(200);
        await popupPage.keyboard.press('Backspace');
        await delay(300);
      }
      await textarea.click();
      await delay(200);
      await textarea.type(nick, { delay: 80 });
      await delay(1500);
    };

    const checkMessage = async () => {
      return await popupPage.evaluate(() => {
        const msgEl = document.querySelector('.profile_form .msg_area .msg');
        if (!msgEl) return 'none';
        const text = msgEl.textContent.trim();
        if (text.includes('사용할 수 있는 별명')) return 'available';
        if (text.includes('이미 사용 중')) return 'duplicate';
        return text;
      });
    };

    let isAvailable = false;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await clearAndType(finalNickname);
      console.log(`닉네임 시도 (${attempt}/${maxAttempts}): "${finalNickname}"`);

      let result = await checkMessage();
      if (result === 'none') {
        await delay(2000);
        result = await checkMessage();
      }

      if (result === 'available') {
        isAvailable = true;
        break;
      }

      if (result === 'duplicate' && isRandom && attempt < maxAttempts) {
        console.log(`"${finalNickname}" 중복, 재시도...`);
        finalNickname = nickGen.generateNicknameWithNumber();
        continue;
      }

      // 사용 불가
      if (attempt === maxAttempts) {
        await popupPage.close().catch(() => {});
        return { success: false, error: `별명 사용 불가: ${result}` };
      }
    }

    if (!isAvailable) {
      await popupPage.close().catch(() => {});
      return { success: false, error: '사용 가능한 별명을 찾지 못했습니다' };
    }

    // 8. 확인 버튼 클릭
    const confirmClicked = await popupPage.evaluate(() => {
      const btn = document.querySelector('a.BaseButton.BaseButton--green');
      if (btn) { btn.click(); return true; }
      const allBtns = document.querySelectorAll('a.BaseButton, button.BaseButton');
      for (const b of allBtns) {
        const span = b.querySelector('.BaseButton__txt');
        if (span && span.textContent.trim() === '확인') { b.click(); return true; }
      }
      return false;
    });

    if (!confirmClicked) {
      await popupPage.close().catch(() => {});
      return { success: false, error: '확인 버튼을 찾을 수 없습니다' };
    }

    await delay(3000);
    await popupPage.close().catch(() => {});
    return { success: true, nickname: finalNickname };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

module.exports = { changeNickname };
