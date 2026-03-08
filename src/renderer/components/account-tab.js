const AccountTab = {
  _accounts: [],

  createPanel(account, allAccounts) {
    const panel = document.createElement('div');
    panel.className = 'tab-panel';
    panel.id = `tab-panel-${account.id}`;
    panel.dataset.accountId = account.id;

    const features = account.features || {
      posting: true, comment: true, ipChange: false,
      nicknameChange: false, autoDelete: false,
    };

    panel.innerHTML = `
      <!-- 설정 서브탭 -->
      <div class="subtab-content active" data-subtab="settings">
        <div class="panel-header">
          <h2>${account.id}</h2>
          <div class="form-row">
            <button class="btn btn-sm btn-primary btn-login-test">로그인 테스트</button>
            <span class="login-status"></span>
            <button class="btn btn-sm btn-danger btn-delete-account">계정 삭제</button>
          </div>
        </div>

        <div class="feature-toggles">
          <label class="toggle-switch">
            <input type="checkbox" data-feature="ipChange" ${features.ipChange ? 'checked' : ''}>
            <span class="toggle-slider"></span>
            <span class="toggle-text">IP변경</span>
          </label>
          <label class="toggle-switch">
            <input type="checkbox" data-feature="nicknameChange" ${features.nicknameChange ? 'checked' : ''}>
            <span class="toggle-slider"></span>
            <span class="toggle-text">닉네임 변경</span>
          </label>
          <label class="toggle-switch">
            <input type="checkbox" data-feature="autoDelete" ${features.autoDelete ? 'checked' : ''}>
            <span class="toggle-slider"></span>
            <span class="toggle-text">자동삭제</span>
          </label>
        </div>

        <div class="section-card">
          <div class="section-title">카페 설정</div>
          <div class="form-row">
            <input type="text" class="input cafe-name" placeholder="카페 이름 (예: globping)" value="${account.cafeName || ''}" style="width:220px;">
            <input type="text" class="input cafe-id" placeholder="카페 ID (자동)" value="${account.cafeId || ''}" readonly style="width:140px;">
            <button class="btn btn-sm btn-primary btn-crawl">게시판 크롤링</button>
            <span class="crawl-status" style="font-size:12px; color:#8892b0;"></span>
          </div>
        </div>

        <div class="section-card section-nickname" style="display:${features.nicknameChange ? 'block' : 'none'};">
          <div class="section-title">닉네임</div>
          <div class="form-row">
            <input type="text" class="input nickname-input" placeholder="변경할 닉네임" value="${account.nickname || ''}" style="width:200px;">
          </div>
        </div>

        <div class="section-card section-ip" style="display:${features.ipChange ? 'block' : 'none'};">
          <div class="section-title">IP 변경 설정</div>
          <div class="form-row">
            <input type="text" class="input iface-input" placeholder="인터페이스 이름 (자동감지)" value="${(account.ipChangeConfig && account.ipChangeConfig.interfaceName) || ''}" style="width:220px;">
            <button class="btn btn-sm btn-secondary btn-check-iface">인터페이스 확인</button>
            <button class="btn btn-sm btn-primary btn-test-ip">IP 변경 테스트</button>
            <span class="ip-status" style="font-size:12px; color:#8892b0;"></span>
          </div>
        </div>

        <div style="margin-top:16px; text-align:right;">
          <button class="btn btn-success btn-save-account">계정 설정 저장</button>
        </div>
      </div>

      <!-- 원고 서브탭 -->
      <div class="subtab-content" data-subtab="manuscripts">
        <div class="section-card preset-section">
          <div class="section-title">프리셋</div>
          <div class="form-row" style="gap:8px; align-items:center;">
            <select class="input preset-select" style="width:220px;">
              <option value="">프리셋 선택...</option>
            </select>
            <button class="btn btn-sm btn-primary btn-preset-load">불러오기</button>
            <button class="btn btn-sm btn-danger btn-preset-delete">삭제</button>
            <span style="margin-left:auto;"></span>
            <input type="text" class="input preset-name-input" placeholder="프리셋 이름" style="width:160px;">
            <button class="btn btn-sm btn-success btn-preset-save">현재 원고 저장</button>
          </div>
        </div>
        <div class="section-card section-manuscripts">
          <div class="section-title">원고</div>
          <div class="manuscripts-layout">
            <div class="ms-list-panel">
              <div class="ms-list-header">
                <strong>원고 목록</strong>
                <button class="btn btn-sm btn-primary btn-add-ms">+ 추가</button>
              </div>
              <div class="ms-list"></div>
            </div>
            <div class="ms-editor-panel" style="display:none;">
              <div class="ms-editor-header">
                <h3>원고 편집</h3>
                <label class="toggle-label">
                  <input type="checkbox" class="ms-enabled" checked> 활성화
                </label>
              </div>
              <div class="form-group">
                <label>게시판</label>
                <select class="input ms-board"></select>
              </div>
              <div class="form-group">
                <label>게시글 제목</label>
                <input type="text" class="input ms-title" placeholder="게시글 제목">
              </div>
              <div class="form-group">
                <label>본문 (텍스트/이미지 세그먼트)</label>
                <div class="ms-segments segments-container"></div>
                <div class="form-row" style="margin-top:8px;">
                  <button class="btn btn-sm btn-secondary btn-add-text-seg">+ 텍스트</button>
                  <button class="btn btn-sm btn-secondary btn-add-img-seg">+ 이미지</button>
                </div>
              </div>
              <div class="form-group section-auto-delete" style="display:${features.autoDelete ? 'block' : 'none'};">
                <label>자동 삭제 날짜</label>
                <input type="date" class="input ms-auto-delete-date">
              </div>
              <div class="form-group section-ms-comments">
                <label>댓글 (글 작성 후 자동 댓글)</label>
                <div class="ms-comments-list"></div>
                <button class="btn btn-sm btn-secondary btn-add-ms-comment" style="margin-top:4px;">+ 댓글 추가</button>
              </div>
              <div class="form-row" style="margin-top:16px;">
                <button class="btn btn-success btn-save-ms">원고 저장</button>
                <button class="btn btn-danger btn-delete-ms">삭제</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 실행 서브탭 -->
      <div class="subtab-content" data-subtab="execution">
        <div class="section-card">
          <div class="section-title">실행</div>
          <div class="form-row" style="margin-bottom:12px;">
            <button class="btn btn-primary btn-exec-start">시작</button>
            <button class="btn btn-secondary btn-exec-pause" disabled>일시정지</button>
            <button class="btn btn-secondary btn-exec-resume" disabled>재개</button>
            <button class="btn btn-danger btn-exec-stop" disabled>중지</button>
          </div>
          <div class="progress-bar-container">
            <div class="progress-bar exec-progress-bar" style="width:0%"></div>
          </div>
          <div class="exec-progress-text progress-text">대기 중</div>
          <div class="exec-log log-area"></div>
        </div>

        <div class="section-card">
          <div class="section-title">결과</div>
          <div class="form-row" style="margin-bottom:8px;">
            <select class="input result-select" style="width:300px;">
              <option value="">실행 이력 선택...</option>
            </select>
            <button class="btn btn-secondary btn-export-csv">CSV 내보내기</button>
          </div>
          <table class="data-table">
            <thead>
              <tr>
                <th>게시판</th>
                <th>제목</th>
                <th>URL</th>
                <th>상태</th>
                <th>시간</th>
                <th>댓글</th>
              </tr>
            </thead>
            <tbody class="results-tbody"></tbody>
          </table>
        </div>
      </div>
    `;

    this._bindEvents(panel, account, allAccounts);
    return panel;
  },

  _bindEvents(panel, account, allAccounts) {
    const accountId = account.id;

    // --- 기능 토글 ---
    panel.querySelectorAll('.feature-toggles input[data-feature]').forEach(input => {
      input.addEventListener('change', () => {
        const feature = input.dataset.feature;
        const checked = input.checked;

        if (feature === 'ipChange') {
          const sec = panel.querySelector('.section-ip');
          if (sec) sec.style.display = checked ? 'block' : 'none';
        }
        if (feature === 'nicknameChange') {
          const sec = panel.querySelector('.section-nickname');
          if (sec) sec.style.display = checked ? 'block' : 'none';
        }
        if (feature === 'autoDelete') {
          panel.querySelectorAll('.section-auto-delete').forEach(s => s.style.display = checked ? 'block' : 'none');
        }
      });
    });

    // --- 로그인 테스트 ---
    panel.querySelector('.btn-login-test').addEventListener('click', async () => {
      const statusEl = panel.querySelector('.login-status');
      statusEl.textContent = '테스트 중...';
      statusEl.style.color = '#ffa726';

      const result = await window.api.loginTest(accountId);
      if (result.success) {
        statusEl.textContent = '로그인 성공';
        statusEl.style.color = '#66bb6a';
      } else {
        statusEl.textContent = `실패: ${result.error || '알 수 없음'}`;
        statusEl.style.color = '#ef5350';
      }
    });

    // --- 계정 삭제 ---
    panel.querySelector('.btn-delete-account').addEventListener('click', async () => {
      if (!confirm(`"${accountId}" 계정을 삭제하시겠습니까?`)) return;
      await window.api.deleteAccount(accountId);
      // app.js에서 처리
      document.dispatchEvent(new CustomEvent('account-deleted', { detail: { accountId } }));
    });

    // --- 카페 크롤링 ---
    panel.querySelector('.btn-crawl').addEventListener('click', async () => {
      const cafeName = panel.querySelector('.cafe-name').value.trim();
      if (!cafeName) return alert('카페 이름을 입력하세요. (예: globping)');

      const statusEl = panel.querySelector('.crawl-status');
      statusEl.textContent = '크롤링 중...';

      const result = await window.api.crawlBoards(cafeName, accountId);
      if (result.success) {
        panel._boards = result.boardList || [];
        // 숫자 ID가 자동 추출되었으면 표시
        if (result.cafeId) {
          panel.querySelector('.cafe-id').value = result.cafeId;
        }
        statusEl.textContent = `${panel._boards.length}개 게시판 발견`;
        this._updateBoardSelects(panel);
      } else {
        statusEl.textContent = `실패: ${result.error}`;
      }
    });

    // --- IP 인터페이스 확인 ---
    panel.querySelector('.btn-check-iface').addEventListener('click', async () => {
      const ifaceName = panel.querySelector('.iface-input').value.trim();
      const result = await window.api.checkInterface(ifaceName || null);
      const statusEl = panel.querySelector('.ip-status');
      if (result.exists) {
        statusEl.textContent = `감지됨: ${result.name} (${result.ip || 'IP 없음'})`;
        statusEl.style.color = '#66bb6a';
        if (result.name) panel.querySelector('.iface-input').value = result.name;
      } else {
        statusEl.textContent = '인터페이스를 찾을 수 없습니다';
        statusEl.style.color = '#ef5350';
      }
    });

    // --- IP 변경 테스트 ---
    panel.querySelector('.btn-test-ip').addEventListener('click', async () => {
      const ifaceName = panel.querySelector('.iface-input').value.trim();
      const statusEl = panel.querySelector('.ip-status');
      statusEl.textContent = 'IP 변경 중...';
      statusEl.style.color = '#ffa726';

      const result = await window.api.changeIP(ifaceName || null);
      if (result.success) {
        statusEl.textContent = `새 IP: ${result.ip || '확인 불가'}`;
        statusEl.style.color = '#66bb6a';
      } else {
        statusEl.textContent = `실패: ${result.error}`;
        statusEl.style.color = '#ef5350';
      }
    });

    // --- 프리셋 ---
    panel._presets = account.presets || [];
    this._renderPresetSelect(panel);

    panel.querySelector('.btn-preset-save').addEventListener('click', async () => {
      const nameInput = panel.querySelector('.preset-name-input');
      const name = nameInput.value.trim();
      if (!name) return alert('프리셋 이름을 입력하세요.');

      // 현재 편집중인 원고 데이터 수집
      if (panel._selectedMsIndex >= 0) this._collectMsData(panel);

      // 원고 deep copy
      const snapshot = JSON.parse(JSON.stringify(panel._manuscripts));
      const existing = panel._presets.findIndex(p => p.name === name);
      if (existing >= 0) {
        if (!confirm(`"${name}" 프리셋을 덮어쓰시겠습니까?`)) return;
        panel._presets[existing].manuscripts = snapshot;
        panel._presets[existing].savedAt = new Date().toISOString();
      } else {
        panel._presets.push({ name, manuscripts: snapshot, savedAt: new Date().toISOString() });
      }

      await this._saveAccountData(panel, account);
      this._renderPresetSelect(panel);
      nameInput.value = '';
      alert(`프리셋 "${name}" 저장됨`);
    });

    panel.querySelector('.btn-preset-load').addEventListener('click', async () => {
      const select = panel.querySelector('.preset-select');
      const idx = parseInt(select.value);
      if (isNaN(idx)) return alert('프리셋을 선택하세요.');

      const preset = panel._presets[idx];
      if (!preset) return;
      if (!confirm(`"${preset.name}" 프리셋을 불러오시겠습니까?\n현재 원고가 교체됩니다.`)) return;

      panel._manuscripts = JSON.parse(JSON.stringify(preset.manuscripts));
      panel._selectedMsIndex = -1;
      panel.querySelector('.ms-editor-panel').style.display = 'none';
      await this._saveAccountData(panel, account);
      this._renderMsList(panel, allAccounts);
      alert(`프리셋 "${preset.name}" 불러옴`);
    });

    panel.querySelector('.btn-preset-delete').addEventListener('click', async () => {
      const select = panel.querySelector('.preset-select');
      const idx = parseInt(select.value);
      if (isNaN(idx)) return alert('프리셋을 선택하세요.');

      const preset = panel._presets[idx];
      if (!preset) return;
      if (!confirm(`"${preset.name}" 프리셋을 삭제하시겠습니까?`)) return;

      panel._presets.splice(idx, 1);
      await this._saveAccountData(panel, account);
      this._renderPresetSelect(panel);
    });

    // --- 원고 관련 ---
    panel._boards = account.boards || [];
    panel._manuscripts = account.manuscripts || [];
    panel._selectedMsIndex = -1;

    panel.querySelector('.btn-add-ms').addEventListener('click', () => {
      const ms = {
        id: 'ms-' + Date.now().toString(36),
        boardMenuId: '',
        boardName: '',
        post: { title: '새 게시글', bodySegments: [{ type: 'text', content: '' }] },
        comments: [],
        enabled: true,
        autoDeleteDate: null,
      };
      panel._manuscripts.push(ms);
      this._renderMsList(panel, allAccounts);
      this._selectMs(panel, panel._manuscripts.length - 1, allAccounts);
    });

    panel.querySelector('.btn-save-ms').addEventListener('click', async () => {
      if (panel._selectedMsIndex < 0) return;
      this._collectMsData(panel);
      await this._saveAccountData(panel, account);
      this._renderMsList(panel, allAccounts);
      alert('원고 저장됨');
    });

    panel.querySelector('.btn-delete-ms').addEventListener('click', async () => {
      if (panel._selectedMsIndex < 0) return;
      if (!confirm('이 원고를 삭제하시겠습니까?')) return;
      panel._manuscripts.splice(panel._selectedMsIndex, 1);
      panel._selectedMsIndex = -1;
      panel.querySelector('.ms-editor-panel').style.display = 'none';
      await this._saveAccountData(panel, account);
      this._renderMsList(panel, allAccounts);
    });

    panel.querySelector('.btn-add-text-seg').addEventListener('click', () => {
      if (panel._selectedMsIndex < 0) return;
      this._renderTextSegment(panel.querySelector('.ms-segments'), '');
    });

    panel.querySelector('.btn-add-img-seg').addEventListener('click', () => {
      if (panel._selectedMsIndex < 0) return;
      this._renderImageSegment(panel.querySelector('.ms-segments'), '');
    });

    panel.querySelector('.btn-add-ms-comment').addEventListener('click', () => {
      if (panel._selectedMsIndex < 0) return;
      this._renderMsCommentItem(panel.querySelector('.ms-comments-list'), { accountId: '', text: '', imagePath: null }, allAccounts);
    });

    // --- 실행 ---
    const startBtn = panel.querySelector('.btn-exec-start');
    const pauseBtn = panel.querySelector('.btn-exec-pause');
    const resumeBtn = panel.querySelector('.btn-exec-resume');
    const stopBtn = panel.querySelector('.btn-exec-stop');

    startBtn.addEventListener('click', async () => {
      // 실행 전 현재 UI 상태를 저장
      if (panel._selectedMsIndex >= 0) this._collectMsData(panel);
      await this._saveAccountData(panel, account);

      // 실행 서브탭으로 전환
      if (typeof switchSubtab === 'function') switchSubtab('execution');

      const logArea = panel.querySelector('.exec-log');
      logArea.innerHTML = '';
      this._appendLog(panel, '실행을 시작합니다...');
      this._setExecButtons(panel, 'running');

      const result = await window.api.executionStart(accountId);
      if (!result.success) {
        this._appendLog(panel, `시작 실패: ${result.error}`, 'error');
        this._setExecButtons(panel, 'idle');
      }
    });

    pauseBtn.addEventListener('click', async () => {
      await window.api.executionPause(accountId);
      this._setExecButtons(panel, 'paused');
    });

    resumeBtn.addEventListener('click', async () => {
      await window.api.executionResume(accountId);
      this._setExecButtons(panel, 'running');
    });

    stopBtn.addEventListener('click', async () => {
      await window.api.executionStop(accountId);
      this._setExecButtons(panel, 'idle');
      this._appendLog(panel, '실행이 중지되었습니다.', 'error');
    });

    // --- 결과 ---
    panel.querySelector('.result-select').addEventListener('change', async (e) => {
      const fileName = e.target.value;
      if (!fileName) { this._renderResults(panel, []); return; }
      const log = await window.api.loadResultDetail(fileName);
      if (log && log.results) {
        // 이 계정의 결과만 필터링
        const filtered = log.results.filter(r => r.accountId === accountId);
        this._renderResults(panel, filtered);
      }
    });

    panel.querySelector('.btn-export-csv').addEventListener('click', async () => {
      const select = panel.querySelector('.result-select');
      if (!select.value) return alert('실행 이력을 선택하세요.');
      const result = await window.api.exportCsv(select.value);
      if (result.success) alert(`CSV 저장 완료: ${result.filePath}`);
      else if (!result.cancelled) alert('CSV 저장 실패');
    });

    // --- 계정 설정 저장 ---
    panel.querySelector('.btn-save-account').addEventListener('click', async () => {
      await this._saveAccountData(panel, account);
      alert('계정 설정이 저장되었습니다.');
    });

    // 초기 원고 목록 렌더
    this._renderMsList(panel, allAccounts);
  },

  // --- 원고 목록 렌더 ---
  _renderMsList(panel, allAccounts) {
    const list = panel.querySelector('.ms-list');
    list.innerHTML = '';

    panel._manuscripts.forEach((ms, i) => {
      const div = document.createElement('div');
      div.className = 'ms-list-item' + (i === panel._selectedMsIndex ? ' active' : '') + (!ms.enabled ? ' disabled' : '');
      div.innerHTML = `
        <div class="ms-item-title">${ms.post.title || '(제목 없음)'}</div>
        <div class="ms-item-sub">${ms.boardName || '게시판 미선택'}</div>
      `;
      div.addEventListener('click', () => this._selectMs(panel, i, allAccounts));
      list.appendChild(div);
    });
  },

  _selectMs(panel, index, allAccounts) {
    panel._selectedMsIndex = index;
    this._renderMsList(panel, allAccounts);
    this._renderMsEditor(panel, allAccounts);
  },

  _renderMsEditor(panel, allAccounts) {
    const editor = panel.querySelector('.ms-editor-panel');
    if (panel._selectedMsIndex < 0) { editor.style.display = 'none'; return; }
    editor.style.display = 'block';

    const ms = panel._manuscripts[panel._selectedMsIndex];

    panel.querySelector('.ms-enabled').checked = ms.enabled;
    panel.querySelector('.ms-title').value = ms.post.title || '';

    // 게시판
    const boardSelect = panel.querySelector('.ms-board');
    boardSelect.innerHTML = '<option value="">게시판 선택...</option>';
    const boards = panel._boards || [];
    boards.forEach(b => {
      boardSelect.innerHTML += `<option value="${b.menuId || ''}" ${b.menuId === ms.boardMenuId ? 'selected' : ''}>${b.menuName}</option>`;
    });
    if (ms.boardMenuId && !boards.find(b => b.menuId === ms.boardMenuId)) {
      boardSelect.innerHTML += `<option value="${ms.boardMenuId}" selected>${ms.boardName || ms.boardMenuId}</option>`;
    }

    // 세그먼트
    const segContainer = panel.querySelector('.ms-segments');
    segContainer.innerHTML = '';
    (ms.post.bodySegments || []).forEach(seg => {
      if (seg.type === 'text') this._renderTextSegment(segContainer, seg.content);
      else if (seg.type === 'image') this._renderImageSegment(segContainer, seg.filePath);
    });

    // 자동삭제 날짜
    const dateInput = panel.querySelector('.ms-auto-delete-date');
    if (dateInput) dateInput.value = ms.autoDeleteDate || '';

    // 댓글
    const cmtList = panel.querySelector('.ms-comments-list');
    cmtList.innerHTML = '';
    const accts = AccountTab._accounts.length > 0 ? AccountTab._accounts : allAccounts;
    (ms.comments || []).forEach(cmt => {
      this._renderMsCommentItem(cmtList, cmt, accts);
    });
  },

  _collectMsData(panel) {
    const ms = panel._manuscripts[panel._selectedMsIndex];
    if (!ms) return;

    ms.enabled = panel.querySelector('.ms-enabled').checked;
    ms.post.title = panel.querySelector('.ms-title').value.trim();

    const boardSelect = panel.querySelector('.ms-board');
    const selectedOpt = boardSelect.options[boardSelect.selectedIndex];
    ms.boardMenuId = boardSelect.value;
    ms.boardName = selectedOpt ? selectedOpt.textContent : '';

    // 세그먼트
    ms.post.bodySegments = [];
    panel.querySelectorAll('.ms-segments .segment-item').forEach(item => {
      const type = item.dataset.type;
      if (type === 'text') {
        const ta = item.querySelector('textarea');
        ms.post.bodySegments.push({ type: 'text', content: ta ? ta.value : '' });
      } else if (type === 'image') {
        const pathSpan = item.querySelector('.seg-image-path');
        ms.post.bodySegments.push({ type: 'image', filePath: pathSpan ? pathSpan.dataset.path || '' : '' });
      }
    });

    // 댓글 수집
    ms.comments = [];
    panel.querySelectorAll('.ms-comments-list > .ms-comment-item').forEach(item => {
      const accountSelect = item.querySelector('.ms-cmt-account');
      const textInput = item.querySelector('.ms-cmt-text');
      const imgSpan = item.querySelector('.ms-cmt-image-path');

      // 대댓글 수집
      const replies = [];
      item.querySelectorAll('.ms-reply-list > .ms-reply-item').forEach(replyEl => {
        const rAcct = replyEl.querySelector('.ms-reply-account');
        const rText = replyEl.querySelector('.ms-reply-text');
        const rImg = replyEl.querySelector('.ms-reply-image-path');
        replies.push({
          accountId: rAcct ? rAcct.value : '',
          text: rText ? rText.value : '',
          imagePath: rImg ? rImg.dataset.path || null : null,
        });
      });

      ms.comments.push({
        accountId: accountSelect ? accountSelect.value : '',
        text: textInput ? textInput.value : '',
        imagePath: imgSpan ? imgSpan.dataset.path || null : null,
        replies,
      });
    });

    // 자동삭제 날짜
    const dateInput = panel.querySelector('.ms-auto-delete-date');
    ms.autoDeleteDate = (dateInput && dateInput.value) ? dateInput.value : null;
  },

  _updateBoardSelects(panel) {
    // 편집기가 열려있으면 게시판 목록 업데이트
    if (panel._selectedMsIndex >= 0) {
      const ms = panel._manuscripts[panel._selectedMsIndex];
      const boardSelect = panel.querySelector('.ms-board');
      const currentVal = boardSelect.value;
      boardSelect.innerHTML = '<option value="">게시판 선택...</option>';
      (panel._boards || []).forEach(b => {
        boardSelect.innerHTML += `<option value="${b.menuId || ''}" ${b.menuId === currentVal ? 'selected' : ''}>${b.menuName}</option>`;
      });
      if (ms.boardMenuId && !(panel._boards || []).find(b => b.menuId === ms.boardMenuId)) {
        boardSelect.innerHTML += `<option value="${ms.boardMenuId}" selected>${ms.boardName || ms.boardMenuId}</option>`;
      }
    }
  },

  _renderPresetSelect(panel) {
    const select = panel.querySelector('.preset-select');
    select.innerHTML = '<option value="">프리셋 선택...</option>';
    (panel._presets || []).forEach((p, i) => {
      const date = p.savedAt ? new Date(p.savedAt).toLocaleDateString('ko-KR') : '';
      const msCount = (p.manuscripts || []).length;
      select.innerHTML += `<option value="${i}">${p.name} (${msCount}개 원고, ${date})</option>`;
    });
  },

  async _saveAccountData(panel, account) {
    // features 수집
    const features = {};
    panel.querySelectorAll('.feature-toggles input[data-feature]').forEach(input => {
      features[input.dataset.feature] = input.checked;
    });

    const updates = {
      cafeId: panel.querySelector('.cafe-id').value.trim(),
      cafeName: panel.querySelector('.cafe-name').value.trim(),
      features,
      nickname: panel.querySelector('.nickname-input').value.trim(),
      ipChangeConfig: {
        interfaceName: panel.querySelector('.iface-input').value.trim(),
      },
      boards: panel._boards || [],
      manuscripts: panel._manuscripts || [],
      presets: panel._presets || [],
    };

    await window.api.updateAccount(account.id, updates);
  },

  // --- 세그먼트 렌더 ---
  _renderTextSegment(container, content) {
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

  _renderImageSegment(container, filePath) {
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

  // --- 원고 댓글 렌더 ---
  _renderMsCommentItem(container, cmt, allAccounts) {
    const div = document.createElement('div');
    div.className = 'ms-comment-item';
    const accts = AccountTab._accounts.length > 0 ? AccountTab._accounts : allAccounts;

    let accountOptions = '<option value="">계정 선택...</option>';
    accts.forEach(a => {
      accountOptions += `<option value="${a.id}" ${a.id === cmt.accountId ? 'selected' : ''}>${a.id}</option>`;
    });

    div.innerHTML = `
      <div class="ms-cmt-row">
        <select class="input ms-cmt-account" style="width:150px;">${accountOptions}</select>
        <span class="seg-image-path ms-cmt-image-path" data-path="${cmt.imagePath || ''}" style="font-size:11px; flex:1;">${cmt.imagePath || '이미지 없음'}</span>
        <button class="btn btn-sm btn-secondary btn-ms-cmt-img">이미지</button>
        <button class="btn-cmt-delete" title="삭제">&#10005;</button>
      </div>
      <textarea class="input ms-cmt-text" placeholder="댓글 내용" style="width:100%; margin-top:4px;">${cmt.text || ''}</textarea>
      <div class="ms-reply-list"></div>
      <button class="btn btn-sm btn-secondary btn-add-ms-reply" style="margin-top:4px; font-size:11px;">+ 대댓글</button>
    `;
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
      this._renderMsReplyItem(replyList, { accountId: '', text: '', imagePath: null }, accts);
    });

    // 기존 대댓글 렌더
    (cmt.replies || []).forEach(reply => {
      this._renderMsReplyItem(replyList, reply, accts);
    });

    container.appendChild(div);
  },

  _renderMsReplyItem(container, reply, allAccounts) {
    const div = document.createElement('div');
    div.className = 'ms-reply-item';
    const accts = AccountTab._accounts.length > 0 ? AccountTab._accounts : allAccounts;

    let accountOptions = '<option value="">계정 선택...</option>';
    accts.forEach(a => {
      accountOptions += `<option value="${a.id}" ${a.id === reply.accountId ? 'selected' : ''}>${a.id}</option>`;
    });

    div.innerHTML = `
      <div class="ms-reply-row">
        <span class="ms-reply-arrow">&#8627;</span>
        <select class="input ms-reply-account" style="width:140px;">${accountOptions}</select>
        <span class="seg-image-path ms-reply-image-path" data-path="${reply.imagePath || ''}" style="font-size:11px; flex:1;">${reply.imagePath || '이미지 없음'}</span>
        <button class="btn btn-sm btn-secondary btn-ms-reply-img" style="font-size:11px;">이미지</button>
        <button class="btn-reply-delete" title="삭제">&#10005;</button>
      </div>
      <textarea class="input ms-reply-text" placeholder="대댓글 내용" style="width:100%; margin-top:2px; min-height:32px;">${reply.text || ''}</textarea>
    `;
    div.querySelector('.btn-reply-delete').addEventListener('click', () => div.remove());
    div.querySelector('.btn-ms-reply-img').addEventListener('click', async () => {
      const path = await window.api.selectImage();
      if (path) {
        const span = div.querySelector('.ms-reply-image-path');
        span.textContent = path;
        span.dataset.path = path;
      }
    });
    container.appendChild(div);
  },

  // --- 실행 UI 헬퍼 ---
  _appendLog(panel, msg, type) {
    const logArea = panel.querySelector('.exec-log');
    const div = document.createElement('div');
    div.className = 'log-entry' + (type ? ' ' + type : '');
    const time = new Date().toLocaleTimeString('ko-KR');
    div.textContent = `[${time}] ${msg}`;
    logArea.appendChild(div);
    logArea.scrollTop = logArea.scrollHeight;
  },

  updateProgress(panel, data) {
    const bar = panel.querySelector('.exec-progress-bar');
    const text = panel.querySelector('.exec-progress-text');
    const percent = data.total > 0 ? Math.round((data.current / data.total) * 100) : 0;
    bar.style.width = percent + '%';
    text.textContent = `${data.current} / ${data.total} (${percent}%) - ${data.detail || ''}`;
  },

  onComplete(panel, log) {
    this._setExecButtons(panel, 'idle');
    const successCount = (log.results || []).filter(r => r.status === 'success').length;
    const failCount = (log.results || []).filter(r => r.status === 'failed').length;
    this._appendLog(panel, `실행 완료! 성공: ${successCount}, 실패: ${failCount}`, 'success');
    panel.querySelector('.exec-progress-bar').style.width = '100%';
  },

  _setExecButtons(panel, state) {
    const startBtn = panel.querySelector('.btn-exec-start');
    const pauseBtn = panel.querySelector('.btn-exec-pause');
    const resumeBtn = panel.querySelector('.btn-exec-resume');
    const stopBtn = panel.querySelector('.btn-exec-stop');

    if (state === 'running') {
      startBtn.disabled = true; pauseBtn.disabled = false;
      resumeBtn.disabled = true; stopBtn.disabled = false;
    } else if (state === 'paused') {
      startBtn.disabled = true; pauseBtn.disabled = true;
      resumeBtn.disabled = false; stopBtn.disabled = false;
    } else {
      startBtn.disabled = false; pauseBtn.disabled = true;
      resumeBtn.disabled = true; stopBtn.disabled = true;
    }
  },

  // --- 결과 ---
  _renderResults(panel, results) {
    const tbody = panel.querySelector('.results-tbody');
    tbody.innerHTML = '';

    for (const r of results) {
      const tr = document.createElement('tr');
      const statusClass = r.status === 'success' ? 'status-success' : 'status-failed';
      const time = r.timestamp ? new Date(r.timestamp).toLocaleString('ko-KR') : '';

      const cmtSummary = (r.comments || []).map(c => {
        const icon = c.status === 'success' ? 'O' : 'X';
        return `${c.accountId}(${icon})`;
      }).join(', ') || '-';

      tr.innerHTML = `
        <td>${r.boardName}</td>
        <td>${r.postTitle}</td>
        <td>${r.postUrl ? `<a href="#" class="result-link" data-url="${r.postUrl}">${r.postUrl.substring(0, 40)}...</a>` : '-'}</td>
        <td class="${statusClass}">${r.status}${r.error ? ` (${r.error})` : ''}</td>
        <td>${time}</td>
        <td style="font-size:11px;">${cmtSummary}</td>
      `;
      tbody.appendChild(tr);
    }

    tbody.querySelectorAll('.result-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        window.api.openExternal(link.dataset.url);
      });
    });
  },

  async loadResultsList(panel, accountId) {
    const logs = await window.api.loadResultsList();
    const select = panel.querySelector('.result-select');
    select.innerHTML = '<option value="">실행 이력 선택...</option>';
    // 이 계정 관련 로그만 필터 (executionId에 accountId 포함)
    const filtered = logs.filter(l => l.executionId && l.executionId.includes(accountId));
    for (const log of filtered) {
      const opt = document.createElement('option');
      opt.value = log.fileName;
      opt.textContent = `${log.executionId} (${log.resultCount}건)`;
      select.appendChild(opt);
    }
    // 필터링된게 없으면 전체 목록도 표시
    if (filtered.length === 0) {
      for (const log of logs) {
        const opt = document.createElement('option');
        opt.value = log.fileName;
        opt.textContent = `${log.executionId} (${log.resultCount}건)`;
        select.appendChild(opt);
      }
    }
  },
};
