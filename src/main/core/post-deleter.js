const { delay } = require('./browser-manager');

// 네이버 "삭제됨/없는 글" 안내 문구 패턴 (DOM 검사 + alert 메시지 공용 — 단일 출처)
const GONE_RE = /삭제되었거나|삭제된 게시|삭제된 글|존재하지 않는 게시|없는 게시|이동되었거나|삭제 되었거나/;

// 게시글 하단 "삭제" 버튼 클릭 (iframe 포함 모든 프레임 탐색).
// 주의: 게시글 페이지에는 '삭제'가 게시글 것 말고도 **댓글마다** 있다.
// 댓글이 달린(주로 오래된) 글에서 댓글 삭제를 잘못 누르면 정작 게시글은 안 지워진다.
// → 댓글 영역을 명시적으로 제외하고, 게시글 하단 버튼/수정+삭제 액션바를 우선한다.
// 반환: { frame, how } (how = 어느 전략으로 찾았는지, 진단용) 또는 null
async function clickDeleteButton(page) {
  const allFrames = [page, ...page.frames()];
  for (const frame of allFrames) {
    try {
      const how = await frame.evaluate(() => {
        const textOf = (el) => {
          const span = el.querySelector('.BaseButton__txt');
          return (span ? span.textContent : (el.textContent || '')).replace(/\s+/g, ' ').trim();
        };
        // 댓글/답글 영역 내부 요소는 게시글 삭제가 아니므로 제외
        const inComment = (el) => !!el.closest(
          '.CommentItem, .CommentBox, .comment_area, [class*="Comment"], [class*="comment"], .u_cbox, #cbox_module'
        );

        // 1) 명시적 게시글 하단 버튼 영역
        const bottomSel = '.ArticleBottomBtns a.BaseButton, .ArticleBottomBtns button, .article_bottom a, .end_btn a, .end_btn button';
        for (const a of document.querySelectorAll(bottomSel)) {
          if (textOf(a) === '삭제' && !inComment(a)) { a.click(); return 'bottom'; }
        }

        // 2) 수정+삭제가 같은 작은 컨테이너에 있으면 게시글 액션바로 간주
        const cands = document.querySelectorAll('a[role="button"], button, a.BaseButton');
        for (const el of cands) {
          if (textOf(el) !== '삭제' || inComment(el)) continue;
          let node = el.parentElement;
          for (let i = 0; i < 3 && node; i++, node = node.parentElement) {
            const t = (node.textContent || '').replace(/\s+/g, '');
            if (t.length < 40 && t.includes('수정') && t.includes('삭제')) { el.click(); return 'pair'; }
          }
        }

        // 3) 최후: 댓글 영역이 아닌 첫 '삭제' (게시글 본문이 댓글보다 DOM 앞이라 보통 게시글 것)
        for (const el of cands) {
          if (textOf(el) === '삭제' && !inComment(el)) { el.click(); return 'first-non-comment'; }
        }
        return null;
      });
      if (how) return { frame, how };
    } catch (e) {
      // 접근 불가 프레임 무시
    }
  }
  return null;
}

// 네이버가 네이티브 confirm() 대신 레이어 팝업(모달)으로 바꾼 경우 대비:
// 화면에 뜬 팝업/레이어 안의 "삭제"·"확인" 버튼을 눌러 삭제를 완료한다.
// (팝업/레이어 컨테이너 안으로 범위를 한정해 원래 삭제 버튼 재클릭·오작동 방지)
async function clickConfirmModal(page) {
  const allFrames = [page, ...page.frames()];
  for (const frame of allFrames) {
    try {
      const clicked = await frame.evaluate(() => {
        const visible = (el) => {
          if (!el) return false;
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return r.width > 1 && r.height > 1 && s.visibility !== 'hidden' && s.display !== 'none';
        };
        const containers = document.querySelectorAll(
          '[class*="Popup"],[class*="popup"],[class*="Layer"],[class*="layer"],[role="dialog"],[role="alertdialog"]'
        );
        for (const c of containers) {
          if (!visible(c)) continue;
          const btns = c.querySelectorAll('button, a[role="button"], a.btn_ok, .btn_ok, a.button, .button, a');
          for (const b of btns) {
            const t = (b.textContent || '').trim();
            if ((t === '삭제' || t === '확인' || t === '예') && visible(b)) { b.click(); return t; }
          }
        }
        return null;
      });
      if (clicked) return clicked;
    } catch (e) {
      // 접근 불가 프레임 무시
    }
  }
  return null;
}

// 삭제 결과 검증: 글 URL을 다시 열어 상태를 판정한다.
//  - 'deleted' : 삭제 안내 alert/문구가 뜸, 또는 삭제버튼·본문이 모두 사라짐
//  - 'exists'  : 삭제버튼 또는 본문이 아직 있음 (미삭제)
//  - 'login'   : 세션 만료로 로그인 페이지로 튕김 → 삭제 확인 불가
// sawGoneDialog(): 이 재접속 중 뜬 네이티브 alert 메시지가 "삭제됨" 문구인지 여부
async function checkPostState(page, postUrl, sawGoneDialog) {
  try {
    await page.goto(postUrl, { waitUntil: 'networkidle0', timeout: 30000 });
  } catch (e) {
    // 타임아웃/에러도 아래 검사로 진행
  }
  await delay(2000);

  // (결함2) 삭제 안내가 네이티브 alert 로 떠 handler 가 이미 수락한 경우 → 메시지로 확정
  if (sawGoneDialog()) return 'deleted';

  // (결함1) 세션 만료 → 로그인 페이지로 튕긴 경우: '삭제됨'으로 오판하면 안 됨
  if (/nid\.naver\.com|nidlogin/.test(page.url())) return 'login';
  try {
    const loginForm = await page.evaluate(
      () => !!(document.querySelector('#id') && document.querySelector('#pw'))
    );
    if (loginForm) return 'login';
  } catch (e) { /* ignore */ }

  const allFrames = [page, ...page.frames()];
  let sawExists = false;
  for (const frame of allFrames) {
    try {
      const state = await frame.evaluate((reSrc) => {
        const re = new RegExp(reSrc);
        const body = document.body ? (document.body.innerText || '') : '';
        if (re.test(body)) return 'gone';
        // 삭제 버튼이 아직 있으면 글이 남아있음
        const btns = document.querySelectorAll('.ArticleBottomBtns a.BaseButton, .ArticleBottomBtns button, a[role="button"], button');
        for (const b of btns) {
          const span = b.querySelector('.BaseButton__txt');
          const t = (span ? span.textContent : (b.textContent || '')).trim();
          if (t === '삭제') return 'exists';
        }
        // 본문 컨테이너가 그대로면 남아있음
        if (document.querySelector('.ArticleContentBox, .article_container, .se-viewer, .ArticleTitle, .title_area')) {
          return 'exists';
        }
        return 'unknown';
      }, GONE_RE.source);
      if (state === 'gone') return 'deleted';
      if (state === 'exists') sawExists = true;
    } catch (e) {
      // 접근 불가 프레임 무시
    }
  }
  if (sawExists) return 'exists';
  // 삭제 안내문도 없고 버튼·본문도 사라짐(예: 삭제 후 게시판으로 리다이렉트) → 삭제된 것으로 간주
  return 'deleted';
}

async function deletePost(page, postUrl) {
  // dialog(네이티브 confirm/alert) 자동 수락 + 메시지 캡처(삭제 성공 판정용)
  const dialogMessages = [];
  const dialogHandler = async (dialog) => {
    try { dialogMessages.push(dialog.message() || ''); } catch (e) { /* ignore */ }
    try { await dialog.accept(); } catch (e) { /* 이미 처리됨 */ }
  };
  page.on('dialog', dialogHandler);

  try {
    await page.goto(postUrl, { waitUntil: 'networkidle0', timeout: 30000 });
    await delay(3000);

    // (결함3) iframe 늦은 로딩 대비 1회 재시도
    let hit = await clickDeleteButton(page);
    if (!hit) {
      await delay(2000);
      hit = await clickDeleteButton(page);
    }
    if (!hit) {
      throw new Error('삭제 버튼을 찾을 수 없습니다.');
    }
    // how 가 'first-non-comment' 로 자주 찍히면 게시글 하단 버튼 셀렉터(.ArticleBottomBtns 등)가
    // 네이버 변경으로 깨진 신호 → 셀렉터 갱신 필요.
    console.log('삭제 버튼 클릭 완료 (how:', hit.how, ', frame:', hit.frame.url().substring(0, 50), ')');

    // 네이티브 confirm 이면 위 dialogHandler 가 자동 수락한다.
    // 레이어 팝업(모달)로 바뀐 경우엔 여기서 확인 버튼을 눌러 완료한다.
    await delay(1200);
    const modal = await clickConfirmModal(page);
    if (modal) console.log('삭제 확인 팝업 버튼 클릭:', modal);

    await delay(2500);

    // 실제 삭제 검증 — 재접속 중 뜨는 alert 는 여기 이후의 메시지만 본다
    const preLen = dialogMessages.length;
    const sawGoneDialog = () => dialogMessages.slice(preLen).some((m) => GONE_RE.test(m));
    const state = await checkPostState(page, postUrl, sawGoneDialog);

    if (state === 'deleted') return true;
    if (state === 'login') {
      throw new Error('세션 만료로 삭제 확인 불가 — 재로그인 후 재시도하세요.');
    }
    // 'exists'
    throw new Error('삭제 확인 실패 — 글이 그대로 남아있습니다 (네이버 삭제 확인창 변경 가능성).');
  } finally {
    page.off('dialog', dialogHandler);
  }
}

module.exports = { deletePost };
