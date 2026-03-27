// MsHelpers — Manuscript segment & comment DOM rendering helpers

// 댓글에서 선택된 계정에만 색상 부여 (선택 순서대로)
const COMMENT_COLORS = [
  '#64ffda', // 민트
  '#ff6b6b', // 빨강
  '#ffd93d', // 노랑
  '#6bcb77', // 초록
  '#4d96ff', // 파랑
  '#ff922b', // 주황
  '#cc5de8', // 보라
  '#20c997', // 청록
  '#ff8787', // 연분홍
  '#74c0fc', // 하늘
  '#f06595', // 핑크
  '#a9e34b', // 라임
  '#fcc419', // 골드
  '#3bc9db', // 시안
  '#da77f2', // 라벤더
  '#ff8c42', // 코랄
  '#69db7c', // 연초록
  '#748ffc', // 인디고
  '#e599f7', // 연보라
  '#38d9a9', // 에메랄드
];

// 댓글에서 선택된 계정 → 색상 매핑
let _usedAccountColors = {};
let _usedColorIndex = 0;

function resetCommentColors() {
  _usedAccountColors = {};
  _usedColorIndex = 0;
}

function getCommentAccountColor(accountId) {
  if (!accountId) return null;
  if (!_usedAccountColors[accountId]) {
    _usedAccountColors[accountId] = COMMENT_COLORS[_usedColorIndex % COMMENT_COLORS.length];
    _usedColorIndex++;
  }
  return _usedAccountColors[accountId];
}

function applyItemColor(el, accountId) {
  const color = getCommentAccountColor(accountId);
  if (color) {
    el.style.borderLeftWidth = '4px';
    el.style.borderLeftStyle = 'solid';
    el.style.borderLeftColor = color;
    el.style.backgroundColor = color + '1A';
  } else {
    el.style.borderLeftWidth = '4px';
    el.style.borderLeftStyle = 'solid';
    el.style.borderLeftColor = '#8892b0';
    el.style.backgroundColor = '';
  }
}

// select 요소에 색상 적용 + 옵션들에도 색상 반영
function applySelectColor(select) {
  const color = getCommentAccountColor(select.value);
  select.style.color = color || '';
  // 모든 옵션에 이미 사용된 계정 색상 표시
  for (let i = 0; i < select.options.length; i++) {
    const opt = select.options[i];
    const optColor = opt.value ? (_usedAccountColors[opt.value] || '') : '';
    opt.style.color = optColor || '#e0e0e0';
    opt.style.fontWeight = optColor ? '700' : '';
    opt.style.backgroundColor = optColor ? optColor + '1A' : '';
  }
}

// 모든 댓글/대댓글 + 게시 계정의 색상을 현재 매핑 기준으로 갱신
function refreshAllCommentColors() {
  // 게시 계정 드롭다운도 갱신
  const msAccountSelect = document.getElementById('ms-account');
  if (msAccountSelect) {
    applySelectColor(msAccountSelect);
  }
  // 댓글
  document.querySelectorAll('.ms-comment-item').forEach(el => {
    const select = el.querySelector('.ms-cmt-account');
    if (select) {
      applyItemColor(el, select.value);
      applySelectColor(select);
    }
  });
  // 대댓글
  document.querySelectorAll('.ms-reply-item').forEach(el => {
    const select = el.querySelector('.ms-reply-account');
    if (select) {
      applyItemColor(el, select.value);
      applySelectColor(select);
    }
  });
}

const MsHelpers = {
  renderTextSegment(container, content) {
    const div = document.createElement('div');
    div.className = 'segment-item';
    div.dataset.type = 'text';
    div.innerHTML = `
      <div class="seg-type">TEXT</div>
      <div class="seg-actions">
        <button class="btn-seg-up" title="위로">&#9650;</button>
        <button class="btn-seg-down" title="아래로">&#9660;</button>
        <button class="btn-seg-delete" title="삭제">&#10005;</button>
      </div>
      <textarea placeholder="텍스트 내용...">${content}</textarea>
    `;
    this._bindSegActions(div, container);
    container.appendChild(div);
  },

  renderImageSegment(container, filePath) {
    const div = document.createElement('div');
    div.className = 'segment-item';
    div.dataset.type = 'image';
    div.innerHTML = `
      <div class="seg-type">IMAGE</div>
      <div class="seg-actions">
        <button class="btn-seg-up" title="위로">&#9650;</button>
        <button class="btn-seg-down" title="아래로">&#9660;</button>
        <button class="btn-seg-delete" title="삭제">&#10005;</button>
      </div>
      <span class="seg-image-path" data-path="${filePath || ''}">${filePath || '(이미지 선택 안됨)'}</span>
      <button class="btn btn-sm btn-secondary btn-select-img" style="margin-top:4px;">이미지 선택</button>
    `;
    div.querySelector('.btn-select-img').addEventListener('click', async () => {
      const path = await window.api.selectImage();
      if (path) {
        const span = div.querySelector('.seg-image-path');
        span.textContent = path;
        span.dataset.path = path;
      }
    });
    this._bindSegActions(div, container);
    container.appendChild(div);
  },

  _bindSegActions(div, container) {
    div.querySelector('.btn-seg-delete').addEventListener('click', () => div.remove());
    div.querySelector('.btn-seg-up').addEventListener('click', () => {
      const prev = div.previousElementSibling;
      if (prev) container.insertBefore(div, prev);
    });
    div.querySelector('.btn-seg-down').addEventListener('click', () => {
      const next = div.nextElementSibling;
      if (next) container.insertBefore(next, div);
    });
  },

  renderCommentItem(container, cmt, allAccounts) {
    const div = document.createElement('div');
    div.className = 'ms-comment-item';

    let accountOptions = '<option value="">계정 선택...</option>';
    allAccounts.forEach(a => {
      accountOptions += `<option value="${a.id}" ${a.id === cmt.accountId ? 'selected' : ''}>${a.id}</option>`;
    });

    div.innerHTML = `
      <div class="ms-cmt-row">
        <select class="input ms-cmt-account" style="width:150px;">${accountOptions}</select>
        <label style="font-size:11px; color:#8892b0; display:flex; align-items:center; gap:3px; cursor:pointer;">
          <input type="checkbox" class="ms-cmt-random-nick" ${cmt.randomNickname ? 'checked' : ''}> 랜덤닉
        </label>
        <input type="text" class="input ms-cmt-custom-nick" placeholder="닉네임" value="${cmt.nickname || ''}" style="width:100px; font-size:11px; padding:2px 6px;${cmt.randomNickname ? ' opacity:0.4;' : ''}" ${cmt.randomNickname ? 'disabled' : ''}>
        <span class="seg-image-path ms-cmt-image-path" data-path="${cmt.imagePath || ''}" style="font-size:11px; flex:1;">${cmt.imagePath || '이미지 없음'}</span>
        <button class="btn btn-sm btn-secondary btn-ms-cmt-img">이미지</button>
        <button class="btn-cmt-delete" title="삭제">&#10005;</button>
      </div>
      <textarea class="input ms-cmt-text" placeholder="댓글 내용" style="width:100%; margin-top:4px;">${cmt.text || ''}</textarea>
      <div class="ms-reply-list"></div>
      <button class="btn btn-sm btn-secondary btn-add-ms-reply" style="margin-top:4px; font-size:11px;">+ 대댓글</button>
    `;

    // 초기 색상 적용
    const accountSelect = div.querySelector('.ms-cmt-account');
    if (cmt.accountId) {
      getCommentAccountColor(cmt.accountId); // 색상 등록
    }
    applyItemColor(div, cmt.accountId);
    applySelectColor(accountSelect);

    // 계정 변경 시 색상 갱신
    accountSelect.addEventListener('change', () => {
      if (accountSelect.value) {
        getCommentAccountColor(accountSelect.value); // 새 계정이면 색상 등록
      }
      refreshAllCommentColors(); // 전체 갱신
    });

    // 랜덤닉 체크 시 커스텀 닉네임 비활성화
    const cmtRandomNick = div.querySelector('.ms-cmt-random-nick');
    const cmtCustomNick = div.querySelector('.ms-cmt-custom-nick');
    cmtRandomNick.addEventListener('change', () => {
      cmtCustomNick.disabled = cmtRandomNick.checked;
      cmtCustomNick.style.opacity = cmtRandomNick.checked ? '0.4' : '1';
      if (cmtRandomNick.checked) cmtCustomNick.value = '';
    });

    div.querySelector('.btn-cmt-delete').addEventListener('click', () => div.remove());
    div.querySelector('.btn-ms-cmt-img').addEventListener('click', async () => {
      const path = await window.api.selectImage();
      if (path) {
        const span = div.querySelector('.ms-cmt-image-path');
        span.textContent = path;
        span.dataset.path = path;
      }
    });

    const replyList = div.querySelector('.ms-reply-list');
    div.querySelector('.btn-add-ms-reply').addEventListener('click', () => {
      this.renderReplyItem(replyList, { accountId: '', text: '', imagePath: null, replies: [] }, allAccounts, 1);
    });

    (cmt.replies || []).forEach(reply => {
      this.renderReplyItem(replyList, reply, allAccounts, 1);
    });

    container.appendChild(div);
  },

  renderReplyItem(container, reply, allAccounts, depth) {
    depth = depth || 1;
    const div = document.createElement('div');
    div.className = 'ms-reply-item';
    if (depth > 1) div.classList.add('ms-reply-nested');

    let accountOptions = '<option value="">계정 선택...</option>';
    allAccounts.forEach(a => {
      accountOptions += `<option value="${a.id}" ${a.id === reply.accountId ? 'selected' : ''}>${a.id}</option>`;
    });

    const arrows = '\u21B3'.repeat(Math.min(depth, 3));

    div.innerHTML = `
      <div class="ms-reply-row">
        <span class="ms-reply-arrow">${arrows}</span>
        <select class="input ms-reply-account" style="width:140px;">${accountOptions}</select>
        <label style="font-size:11px; color:#8892b0; display:flex; align-items:center; gap:3px; cursor:pointer;">
          <input type="checkbox" class="ms-reply-random-nick" ${reply.randomNickname ? 'checked' : ''}> 랜덤닉
        </label>
        <input type="text" class="input ms-reply-custom-nick" placeholder="닉네임" value="${reply.nickname || ''}" style="width:90px; font-size:11px; padding:2px 6px;${reply.randomNickname ? ' opacity:0.4;' : ''}" ${reply.randomNickname ? 'disabled' : ''}>
        <span class="seg-image-path ms-reply-image-path" data-path="${reply.imagePath || ''}" style="font-size:11px; flex:1;">${reply.imagePath || '이미지 없음'}</span>
        <button class="btn btn-sm btn-secondary btn-ms-reply-img" style="font-size:11px;">이미지</button>
        <button class="btn-reply-delete" title="삭제">&#10005;</button>
      </div>
      <textarea class="input ms-reply-text" placeholder="대댓글 내용" style="width:100%; margin-top:2px; min-height:32px;">${reply.text || ''}</textarea>
      <div class="ms-reply-sub-list"></div>
      <button class="btn btn-sm btn-secondary btn-add-sub-reply" style="margin-top:4px; font-size:11px;">+ 대댓글</button>
    `;

    // 초기 색상 적용
    const accountSelect = div.querySelector('.ms-reply-account');
    if (reply.accountId) {
      getCommentAccountColor(reply.accountId);
    }
    applyItemColor(div, reply.accountId);
    applySelectColor(accountSelect);

    // 계정 변경 시 색상 갱신
    accountSelect.addEventListener('change', () => {
      if (accountSelect.value) {
        getCommentAccountColor(accountSelect.value);
      }
      refreshAllCommentColors();
    });

    // 랜덤닉 체크 시 커스텀 닉네임 비활성화
    const replyRandomNick = div.querySelector('.ms-reply-random-nick');
    const replyCustomNick = div.querySelector('.ms-reply-custom-nick');
    replyRandomNick.addEventListener('change', () => {
      replyCustomNick.disabled = replyRandomNick.checked;
      replyCustomNick.style.opacity = replyRandomNick.checked ? '0.4' : '1';
      if (replyRandomNick.checked) replyCustomNick.value = '';
    });

    div.querySelector('.btn-reply-delete').addEventListener('click', () => div.remove());
    div.querySelector('.btn-ms-reply-img').addEventListener('click', async () => {
      const path = await window.api.selectImage();
      if (path) {
        const span = div.querySelector('.ms-reply-image-path');
        span.textContent = path;
        span.dataset.path = path;
      }
    });

    const subList = div.querySelector('.ms-reply-sub-list');
    div.querySelector('.btn-add-sub-reply').addEventListener('click', () => {
      this.renderReplyItem(subList, { accountId: '', text: '', imagePath: null, replies: [] }, allAccounts, depth + 1);
    });

    (reply.replies || []).forEach(subReply => {
      this.renderReplyItem(subList, subReply, allAccounts, depth + 1);
    });

    container.appendChild(div);
  },
};
