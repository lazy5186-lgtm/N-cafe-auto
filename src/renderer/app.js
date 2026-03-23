// N Cafe Auto — Global Tab Controller

// Toast 알림 (alert 대체 — 포커스 소실 방지)
function showToast(message, duration) {
  duration = duration || 2000;
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = 'toast-msg';
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast-fade');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// === State ===
let accounts = [];
let settings = {};
let manuscripts = [];
let presets = [];
let selectedMsIndex = -1;
let nicknameWordsData = { adjectives: [], nouns: [], defaultAdjectives: [], defaultNouns: [] };
let _removeLogListener = null;
let _removeProgressListener = null;
let _removeCompleteListener = null;
let _removeLikeLogListener = null;
let _removeLikeProgressListener = null;
let _removeLikeCompleteListener = null;

// === 단축키 시스템 ===
const SHORTCUT_DEFS = [
  // 탭 이동
  { id: 'tab-settings',    key: 'F1',            label: '설정 탭',       category: '탭 이동' },
  { id: 'tab-manuscripts', key: 'F2',            label: '원고 탭',       category: '탭 이동' },
  { id: 'tab-execution',   key: 'F3',            label: '실행 탭',       category: '탭 이동' },
  { id: 'tab-delete',      key: 'F4',            label: '삭제 탭',       category: '탭 이동' },
  { id: 'tab-like',        key: 'F5',            label: '좋아요 탭',     category: '탭 이동' },
  { id: 'tab-shortcuts',   key: 'F6',            label: '단축키 탭',     category: '탭 이동' },
  // 실행
  { id: 'exec-start',      key: 'Ctrl+Enter',    label: '실행 시작',     category: '실행' },
  { id: 'exec-stop',       key: 'Ctrl+Escape',   label: '실행 중지',     category: '실행' },
  { id: 'exec-pause',      key: 'Ctrl+P',        label: '실행 일시정지', category: '실행' },
  { id: 'exec-resume',     key: 'Ctrl+R',        label: '실행 재개',     category: '실행' },
  // 좋아요
  { id: 'like-start',      key: 'Ctrl+L',        label: '좋아요 시작',   category: '좋아요' },
  { id: 'like-stop',       key: 'Ctrl+Shift+L',  label: '좋아요 중지',   category: '좋아요' },
  // 설정
  { id: 'save-settings',   key: 'Ctrl+S',        label: '설정 저장',        category: '설정' },
  { id: 'ip-toggle',       key: 'Ctrl+Shift+P',  label: 'IP 변경 ON/OFF',  category: '설정' },
  { id: 'ip-change',       key: 'Ctrl+I',        label: 'IP 변경 테스트',   category: '설정' },
  { id: 'ip-check-iface',  key: 'Ctrl+Shift+I',  label: '인터페이스 확인',  category: '설정' },
  { id: 'adb-check',       key: 'Ctrl+Shift+A',  label: '기기 확인',       category: '설정' },
  { id: 'headless-toggle', key: 'Ctrl+H',        label: '헤드리스 ON/OFF', category: '설정' },
];

let shortcuts = {}; // { id: { key, label, category, enabled } }
let _shortcutListening = null;

function loadShortcuts() {
  const saved = settings.shortcuts || {};
  shortcuts = {};
  for (const def of SHORTCUT_DEFS) {
    const savedItem = saved[def.id];
    shortcuts[def.id] = {
      key: (savedItem && savedItem.key) || (typeof savedItem === 'string' ? savedItem : def.key),
      label: def.label,
      category: def.category,
      enabled: savedItem && savedItem.enabled !== undefined ? savedItem.enabled : true,
    };
  }
}

function getShortcutSaveData() {
  const data = {};
  for (const [id, sc] of Object.entries(shortcuts)) {
    data[id] = { key: sc.key, enabled: sc.enabled };
  }
  return data;
}

function keyEventToString(e) {
  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');

  const key = e.key;
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return null;

  if (key === ' ') parts.push('Space');
  else if (key === 'Escape') parts.push('Escape');
  else if (key === 'Enter') parts.push('Enter');
  else if (key.startsWith('F') && key.length <= 3 && !isNaN(key.slice(1))) parts.push(key);
  else if (key.length === 1) parts.push(key.toUpperCase());
  else parts.push(key);

  return parts.join('+');
}

function matchShortcut(e, shortcutKey) {
  if (!shortcutKey) return false;
  const parts = shortcutKey.split('+');
  const needCtrl = parts.includes('Ctrl');
  const needShift = parts.includes('Shift');
  const needAlt = parts.includes('Alt');
  const mainKey = parts.filter(p => !['Ctrl', 'Shift', 'Alt'].includes(p)).join('+');

  if (e.ctrlKey !== needCtrl) return false;
  if (e.shiftKey !== needShift) return false;
  if (e.altKey !== needAlt) return false;

  const eventKey = e.key === ' ' ? 'Space' : e.key === 'Escape' ? 'Escape' : e.key === 'Enter' ? 'Enter' : (e.key.length === 1 ? e.key.toUpperCase() : e.key);
  return eventKey === mainKey;
}

const TAB_MAP = {
  'tab-settings': 'settings',
  'tab-manuscripts': 'manuscripts',
  'tab-execution': 'execution',
  'tab-delete': 'delete-manage',
  'tab-like': 'like',
  'tab-shortcuts': 'shortcuts',
};

function executeShortcutAction(actionId) {
  // 탭 전환
  if (TAB_MAP[actionId]) {
    const btn = document.querySelector(`.tab-nav .tab-btn[data-tab="${TAB_MAP[actionId]}"]`);
    if (btn) btn.click();
    return;
  }

  // 버튼 매핑
  const btnMap = {
    'exec-start': 'btn-exec-start',
    'exec-stop': 'btn-exec-stop',
    'exec-pause': 'btn-exec-pause',
    'exec-resume': 'btn-exec-resume',
    'like-start': 'btn-like-start',
    'like-stop': 'btn-like-stop',
    'save-settings': 'btn-save-settings',
  };

  if (btnMap[actionId]) {
    const el = document.getElementById(btnMap[actionId]);
    if (el && !el.disabled) el.click();
    return;
  }

  // IP 변경 토글
  if (actionId === 'ip-toggle') {
    const toggle = document.getElementById('toggle-ip-change');
    if (toggle) {
      toggle.checked = !toggle.checked;
      toggle.dispatchEvent(new Event('change', { bubbles: true }));
      showToast(`IP 변경: ${toggle.checked ? 'ON' : 'OFF'}`);
    }
    return;
  }

  // IP 변경 테스트
  if (actionId === 'ip-change') {
    const btn = document.getElementById('btn-test-adb');
    if (btn) btn.click();
    return;
  }

  // 인터페이스 확인
  if (actionId === 'ip-check-iface') {
    const btn = document.getElementById('btn-check-iface');
    if (btn) btn.click();
    return;
  }

  // ADB 기기 확인
  if (actionId === 'adb-check') {
    const btn = document.getElementById('btn-check-adb');
    if (btn) btn.click();
    return;
  }

  // 헤드리스 토글
  if (actionId === 'headless-toggle') {
    const toggle = document.getElementById('toggle-headless');
    if (toggle) {
      toggle.checked = !toggle.checked;
      showToast(`헤드리스 모드: ${toggle.checked ? 'ON' : 'OFF'}`);
      // 자동 저장
      document.getElementById('btn-save-settings').click();
    }
    return;
  }
}

function setupShortcutListener() {
  document.addEventListener('keydown', (e) => {
    // 키 입력 대기 모드 (단축키 변경 중)
    if (_shortcutListening) {
      e.preventDefault();
      e.stopPropagation();
      const keyStr = keyEventToString(e);
      if (!keyStr) return;

      shortcuts[_shortcutListening].key = keyStr;
      _shortcutListening = null;
      renderShortcutSections();
      return;
    }

    // input/textarea 포커스 시 무시
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    for (const [actionId, sc] of Object.entries(shortcuts)) {
      if (sc.enabled && matchShortcut(e, sc.key)) {
        e.preventDefault();
        executeShortcutAction(actionId);
        return;
      }
    }
  });
}

function renderShortcutSections() {
  const container = document.getElementById('shortcut-sections');
  container.innerHTML = '';

  // 카테고리별 그룹핑
  const categories = {};
  for (const [id, sc] of Object.entries(shortcuts)) {
    if (!categories[sc.category]) categories[sc.category] = [];
    categories[sc.category].push({ id, ...sc });
  }

  for (const [catName, items] of Object.entries(categories)) {
    const section = document.createElement('div');
    section.style.cssText = 'margin-bottom:16px;';
    section.innerHTML = `<div style="font-size:13px; font-weight:600; color:#64ffda; margin-bottom:8px; padding-bottom:4px; border-bottom:1px solid #1b2838;">${catName}</div>`;

    const table = document.createElement('table');
    table.className = 'data-table';
    table.innerHTML = '<thead><tr><th style="width:8%;">활성</th><th style="width:32%;">기능</th><th style="width:35%;">단축키</th><th style="width:25%;"></th></tr></thead>';
    const tbody = document.createElement('tbody');

    for (const item of items) {
      const tr = document.createElement('tr');
      const isListening = _shortcutListening === item.id;
      tr.style.opacity = item.enabled ? '1' : '0.4';
      tr.innerHTML = `
        <td>
          <label class="toggle-switch" style="margin:0;">
            <input type="checkbox" class="shortcut-toggle" data-id="${item.id}" ${item.enabled ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
        </td>
        <td>${item.label}</td>
        <td>
          <kbd style="background:#1b2838; padding:3px 10px; border-radius:4px; font-size:12px; color:${isListening ? '#64ffda' : '#ccd6f6'}; border:1px solid ${isListening ? '#64ffda' : '#233554'};">
            ${isListening ? '키 입력 대기 중...' : item.key}
          </kbd>
        </td>
        <td>
          <button class="btn btn-sm btn-secondary shortcut-change-btn" data-id="${item.id}">${isListening ? '취소' : '변경'}</button>
        </td>
      `;
      tbody.appendChild(tr);
    }

    table.appendChild(tbody);
    section.appendChild(table);
    container.appendChild(section);
  }

  // 이벤트: 활성 토글
  container.querySelectorAll('.shortcut-toggle').forEach(toggle => {
    toggle.addEventListener('change', () => {
      const id = toggle.dataset.id;
      shortcuts[id].enabled = toggle.checked;
      renderShortcutSections();
    });
  });

  // 이벤트: 변경 버튼
  container.querySelectorAll('.shortcut-change-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      _shortcutListening = _shortcutListening === id ? null : id;
      renderShortcutSections();
    });
  });
}

async function saveShortcutSettings() {
  settings.shortcuts = getShortcutSaveData();
  await window.api.saveSettings(settings);
  showToast('단축키 설정이 저장되었습니다.');
}

function setupShortcuts() {
  loadShortcuts();
  renderShortcutSections();
  setupShortcutListener();

  // 기본값 복원
  document.getElementById('btn-shortcut-reset').addEventListener('click', () => {
    for (const def of SHORTCUT_DEFS) {
      shortcuts[def.id].key = def.key;
      shortcuts[def.id].enabled = true;
    }
    renderShortcutSections();
    showToast('단축키가 기본값으로 복원되었습니다.');
  });

  // 저장
  document.getElementById('btn-shortcut-save').addEventListener('click', saveShortcutSettings);
}

// === Tab Switching ===
function setupTabs() {
  document.querySelectorAll('.tab-nav .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab-nav .tab-btn').forEach(b =>
        b.classList.toggle('active', b === btn)
      );
      document.querySelectorAll('.tab-content > .tab-panel').forEach(p =>
        p.classList.toggle('active', p.dataset.tab === tab)
      );
    });
  });
}

// =============================================
// 설정 탭
// =============================================

async function renderAccountsTable() {
  const tbody = document.getElementById('accounts-tbody');
  tbody.innerHTML = '';

  for (const acc of accounts) {
    const hasCookies = await window.api.hasCookies(acc.id);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${acc.id}</td>
      <td class="pw-display">\u2022\u2022\u2022\u2022\u2022\u2022</td>
      <td>
        <button class="btn btn-sm btn-primary btn-login-test" data-id="${acc.id}">테스트</button>
        <span class="login-status" data-id="${acc.id}" style="color:${hasCookies ? '#66bb6a' : ''}">${hasCookies ? '성공' : ''}</span>
      </td>
      <td><button class="btn btn-sm btn-danger btn-delete-account" data-id="${acc.id}">삭제</button></td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll('.btn-login-test').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const statusEl = tbody.querySelector(`.login-status[data-id="${id}"]`);
      statusEl.textContent = '테스트 중...';
      statusEl.style.color = '#ffa726';
      const result = await window.api.loginTest(id);
      if (result.success) {
        statusEl.textContent = '성공';
        statusEl.style.color = '#66bb6a';
      } else {
        statusEl.textContent = `실패: ${result.error || ''}`;
        statusEl.style.color = '#ef5350';
      }
    });
  });

  tbody.querySelectorAll('.btn-delete-account').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      if (!confirm(`"${id}" 계정을 삭제하시겠습니까?`)) return;
      await window.api.deleteAccount(id);
      accounts = accounts.filter(a => a.id !== id);
      renderAccountsTable();
    });
  });
}

function setupAddAccount() {
  document.getElementById('btn-add-account').addEventListener('click', async () => {
    const idInput = document.getElementById('new-account-id');
    const pwInput = document.getElementById('new-account-pw');
    const id = idInput.value.trim();
    const pw = pwInput.value.trim();
    if (!id || !pw) return showToast('아이디와 비밀번호를 입력하세요.');
    if (accounts.find(a => a.id === id)) return showToast('이미 등록된 아이디입니다.');

    const result = await window.api.addAccount({ id, password: pw });
    if (!result.success) return showToast('계정 추가 실패');

    accounts.push({ id, password: pw, nickname: '' });
    idInput.value = '';
    pwInput.value = '';
    renderAccountsTable();
  });

  // Enter 키
  document.getElementById('new-account-pw').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-add-account').click();
  });

  // 일괄 추가 (엑셀 복사 붙여넣기)
  document.getElementById('btn-bulk-add').addEventListener('click', async () => {
    const textarea = document.getElementById('bulk-account-input');
    const statusEl = document.getElementById('bulk-add-status');
    const raw = textarea.value.trim();
    if (!raw) return showToast('붙여넣기할 내용이 없습니다.');

    const lines = raw.split('\n').filter(l => l.trim());
    let added = 0;
    let skipped = 0;

    for (const line of lines) {
      // 탭, 쉼표, 공백 구분 지원
      const parts = line.split(/[\t,]+/).map(s => s.trim());
      if (parts.length < 2) { skipped++; continue; }

      const id = parts[0];
      const pw = parts[1];
      if (!id || !pw) { skipped++; continue; }
      if (accounts.find(a => a.id === id)) { skipped++; continue; }

      const result = await window.api.addAccount({ id, password: pw });
      if (result.success) {
        accounts.push({ id, password: pw, nickname: '' });
        added++;
      } else {
        skipped++;
      }
    }

    textarea.value = '';
    renderAccountsTable();
    statusEl.textContent = `${added}개 추가, ${skipped}개 스킵`;
    setTimeout(() => { statusEl.textContent = ''; }, 5000);
  });

  // 전체 로그인 테스트
  document.getElementById('btn-login-all').addEventListener('click', async () => {
    const btn = document.getElementById('btn-login-all');
    btn.disabled = true;
    btn.textContent = '테스트 중...';

    let success = 0;
    let fail = 0;
    for (const acc of accounts) {
      const statusEl = document.querySelector(`.login-status[data-id="${acc.id}"]`);
      if (statusEl) {
        statusEl.textContent = '테스트 중...';
        statusEl.style.color = '#ffa726';
      }
      const result = await window.api.loginTest(acc.id);
      if (statusEl) {
        if (result.success) {
          statusEl.textContent = '성공';
          statusEl.style.color = '#66bb6a';
          success++;
        } else {
          statusEl.textContent = `실패: ${result.error || ''}`;
          statusEl.style.color = '#ef5350';
          fail++;
        }
      }
    }

    btn.disabled = false;
    btn.textContent = '전체 로그인 테스트';
    showToast(`로그인 테스트 완료: 성공 ${success}, 실패 ${fail}`);
  });
}


function setupSettingsToggles() {
  // IP 상태 이벤트 수신
  window.api.onIpStatus((data) => {
    const statusEl = document.getElementById('adb-status');
    if (statusEl) {
      statusEl.textContent = data.msg;
      statusEl.style.color = data.msg.includes('실패') ? '#ef5350' : '#ffa726';
    }
  });

  // 헤드리스 모드
  const headlessToggle = document.getElementById('toggle-headless');
  headlessToggle.checked = settings.headless || false;

  const ipToggle = document.getElementById('toggle-ip-change');
  const ipSettings = document.querySelector('.ip-settings');

  ipToggle.checked = settings.ipChange && settings.ipChange.enabled;
  ipSettings.style.display = ipToggle.checked ? 'block' : 'none';

  ipToggle.addEventListener('change', () => {
    ipSettings.style.display = ipToggle.checked ? 'block' : 'none';
  });

  // 인터페이스 확인
  document.getElementById('btn-check-iface').addEventListener('click', async () => {
    const statusEl = document.getElementById('adb-status');
    statusEl.textContent = '확인 중...';
    statusEl.style.color = '#ffa726';
    const result = await window.api.checkInterface(null);
    if (result.exists) {
      statusEl.textContent = `인터페이스: ${result.name} (${result.ip || 'IP 없음'})`;
      statusEl.style.color = '#66bb6a';
    } else {
      statusEl.textContent = '인터페이스를 찾을 수 없습니다';
      statusEl.style.color = '#ef5350';
    }
  });

  // ADB 기기 확인
  document.getElementById('btn-check-adb').addEventListener('click', async () => {
    const statusEl = document.getElementById('adb-status');
    statusEl.textContent = '확인 중...';
    statusEl.style.color = '#ffa726';
    const result = await window.api.checkAdbDevice(null);
    if (result.success) {
      statusEl.textContent = `연결됨: ${result.model || result.serial}`;
      statusEl.style.color = '#66bb6a';
    } else {
      statusEl.textContent = result.error;
      statusEl.style.color = '#ef5350';
    }
  });

  // IP 변경 테스트
  document.getElementById('btn-test-adb').addEventListener('click', async () => {
    const statusEl = document.getElementById('adb-status');
    statusEl.textContent = 'IP 변경 중...';
    statusEl.style.color = '#ffa726';
    const result = await window.api.changeIP(null);
    if (result.success) {
      statusEl.textContent = `새 IP: ${result.ip || '확인 불가'}`;
      statusEl.style.color = '#66bb6a';
    } else {
      statusEl.textContent = `실패: ${result.error}`;
      statusEl.style.color = '#ef5350';
    }
  });

  // 설정 저장
  document.getElementById('btn-save-settings').addEventListener('click', async () => {
    settings = {
      ...settings,
      headless: headlessToggle.checked,
      ipChange: {
        enabled: ipToggle.checked,
        method: 'adb',
        adb: {},
      },
      shortcuts: getShortcutSaveData(),
    };
    await window.api.saveSettings(settings);
    showToast('설정이 저장되었습니다.');
  });

  // 닉네임 단어 관리
  setupNicknameWords();
}

function updateWordCounts() {
  const adjText = document.getElementById('nick-adjectives').value.trim();
  const nounText = document.getElementById('nick-nouns').value.trim();
  const adjCount = adjText ? adjText.split('\n').filter(l => l.trim()).length : 0;
  const nounCount = nounText ? nounText.split('\n').filter(l => l.trim()).length : 0;
  document.getElementById('adj-count').textContent = adjCount;
  document.getElementById('noun-count').textContent = nounCount;
}

async function setupNicknameWords() {
  nicknameWordsData = await window.api.loadNicknameWords();

  const adjTextarea = document.getElementById('nick-adjectives');
  const nounTextarea = document.getElementById('nick-nouns');

  // 커스텀 단어가 있으면 커스텀, 없으면 기본값 표시
  const adjList = nicknameWordsData.adjectives.length > 0 ? nicknameWordsData.adjectives : nicknameWordsData.defaultAdjectives;
  const nounList = nicknameWordsData.nouns.length > 0 ? nicknameWordsData.nouns : nicknameWordsData.defaultNouns;

  adjTextarea.value = adjList.join('\n');
  nounTextarea.value = nounList.join('\n');
  updateWordCounts();

  adjTextarea.addEventListener('input', updateWordCounts);
  nounTextarea.addEventListener('input', updateWordCounts);

  // 저장
  document.getElementById('btn-nick-words-save').addEventListener('click', async () => {
    const adjectives = adjTextarea.value.split('\n').map(l => l.trim()).filter(Boolean);
    const nouns = nounTextarea.value.split('\n').map(l => l.trim()).filter(Boolean);
    await window.api.saveNicknameWords({ adjectives, nouns });
    showToast(`닉네임 단어 저장됨 (형용사 ${adjectives.length}개, 명사 ${nouns.length}개)`);
  });

  // 기본값 복원
  document.getElementById('btn-nick-reset').addEventListener('click', () => {
    adjTextarea.value = nicknameWordsData.defaultAdjectives.join('\n');
    nounTextarea.value = nicknameWordsData.defaultNouns.join('\n');
    updateWordCounts();
    showToast('기본 단어로 복원됨 (저장 버튼을 눌러야 적용됩니다)');
  });
}

// =============================================
// 원고 탭
// =============================================

function renderMsList() {
  const list = document.getElementById('ms-list');
  list.innerHTML = '';

  manuscripts.forEach((ms, i) => {
    const div = document.createElement('div');
    div.className = 'ms-list-item' + (i === selectedMsIndex ? ' active' : '') + (!ms.enabled ? ' disabled' : '');
    div.innerHTML = `
      <div style="display:flex; align-items:center; gap:6px;">
        <div style="flex:1; min-width:0;">
          <div class="ms-item-title">${ms.post.title || '(제목 없음)'}</div>
          <div class="ms-item-sub">${ms.accountId || '계정 미선택'} \u00B7 ${ms.boardName || '게시판 미선택'}</div>
        </div>
        <button class="btn-ms-remove" title="삭제" style="background:none; border:none; color:#ef5350; font-size:16px; cursor:pointer; padding:2px 6px; flex-shrink:0;">&minus;</button>
      </div>
    `;
    div.querySelector('.btn-ms-remove').addEventListener('click', async (e) => {
      e.stopPropagation();
      manuscripts.splice(i, 1);
      if (selectedMsIndex === i) {
        selectedMsIndex = -1;
        document.getElementById('ms-editor').style.display = 'none';
      } else if (selectedMsIndex > i) {
        selectedMsIndex--;
      }
      await saveAllManuscripts();
      renderMsList();
    });
    div.addEventListener('click', () => selectMs(i));
    list.appendChild(div);
  });
}

function selectMs(index) {
  if (selectedMsIndex >= 0) collectMsData();
  selectedMsIndex = index;
  renderMsList();
  renderMsEditor();
}

function renderMsEditor() {
  const editor = document.getElementById('ms-editor');
  if (selectedMsIndex < 0) { editor.style.display = 'none'; return; }
  editor.style.display = 'block';

  const ms = manuscripts[selectedMsIndex];

  document.getElementById('ms-enabled').checked = ms.enabled;

  // 게시 계정
  const msAccount = document.getElementById('ms-account');
  msAccount.innerHTML = '<option value="">계정 선택...</option>';
  accounts.forEach(a => {
    msAccount.innerHTML += `<option value="${a.id}" ${a.id === ms.accountId ? 'selected' : ''}>${a.id}</option>`;
  });
  // 게시 계정도 색상 시스템에 등록
  if (ms.accountId) {
    getCommentAccountColor(ms.accountId);
  }
  applySelectColor(msAccount);

  // 카페
  document.getElementById('ms-cafe-name').value = ms.cafeName || '';
  document.getElementById('ms-cafe-id').value = ms.cafeId || '';
  renderCafeSelect(ms);

  // 게시판
  const boardSelect = document.getElementById('ms-board');
  boardSelect.innerHTML = '<option value="">게시판 선택...</option>';
  (ms.boards || []).forEach(b => {
    boardSelect.innerHTML += `<option value="${b.menuId || ''}" ${b.menuId === ms.boardMenuId ? 'selected' : ''}>${b.menuName}</option>`;
  });
  if (ms.boardMenuId && !(ms.boards || []).find(b => b.menuId === ms.boardMenuId)) {
    boardSelect.innerHTML += `<option value="${ms.boardMenuId}" selected>${ms.boardName || ms.boardMenuId}</option>`;
  }

  // 랜덤 닉네임
  document.getElementById('ms-random-nickname').checked = ms.randomNickname || false;

  // 공개 설정
  const visibility = ms.visibility || 'public';
  document.querySelector(`input[name="ms-visibility"][value="${visibility}"]`).checked = true;

  // 제목
  document.getElementById('ms-title').value = ms.post.title || '';

  // 세그먼트
  const segContainer = document.getElementById('ms-segments');
  segContainer.innerHTML = '';
  (ms.post.bodySegments || []).forEach(seg => {
    if (seg.type === 'text') MsHelpers.renderTextSegment(segContainer, seg.content);
    else if (seg.type === 'image') MsHelpers.renderImageSegment(segContainer, seg.filePath);
  });

  // 댓글
  const cmtList = document.getElementById('ms-comments-list');
  cmtList.innerHTML = '';
  resetCommentColors();
  (ms.comments || []).forEach(cmt => {
    MsHelpers.renderCommentItem(cmtList, cmt, accounts);
  });
  // 모든 댓글 렌더링 후 드롭다운 옵션 색상 일괄 갱신
  refreshAllCommentColors();
}

function collectMsData() {
  if (selectedMsIndex < 0) return;
  const ms = manuscripts[selectedMsIndex];

  ms.enabled = document.getElementById('ms-enabled').checked;
  ms.accountId = document.getElementById('ms-account').value;

  // 카페 드롭다운에서 값 추출
  const cafeSelectVal = document.getElementById('ms-cafe-select').value;
  if (cafeSelectVal) {
    const [selectedCafeName, selectedCafeId] = cafeSelectVal.split('||');
    ms.cafeName = selectedCafeName || '';
    ms.cafeId = selectedCafeId || '';
  } else {
    ms.cafeName = document.getElementById('ms-cafe-name').value.trim();
    ms.cafeId = document.getElementById('ms-cafe-id').value.trim();
  }

  const boardSelect = document.getElementById('ms-board');
  const selectedOpt = boardSelect.options[boardSelect.selectedIndex];
  ms.boardMenuId = boardSelect.value;
  ms.boardName = selectedOpt ? selectedOpt.textContent : '';

  ms.randomNickname = document.getElementById('ms-random-nickname').checked;
  ms.visibility = document.querySelector('input[name="ms-visibility"]:checked').value || 'public';
  ms.post.title = document.getElementById('ms-title').value.trim();

  // 세그먼트
  ms.post.bodySegments = [];
  document.querySelectorAll('#ms-segments .segment-item').forEach(item => {
    const type = item.dataset.type;
    if (type === 'text') {
      const ta = item.querySelector('textarea');
      ms.post.bodySegments.push({ type: 'text', content: ta ? ta.value : '' });
    } else if (type === 'image') {
      const pathSpan = item.querySelector('.seg-image-path');
      ms.post.bodySegments.push({ type: 'image', filePath: pathSpan ? pathSpan.dataset.path || '' : '' });
    }
  });

  // 댓글 (재귀)
  const collectReplies = (containerEl) => {
    const replies = [];
    containerEl.querySelectorAll(':scope > .ms-reply-item').forEach(replyEl => {
      const rAcct = replyEl.querySelector(':scope > .ms-reply-row .ms-reply-account');
      const rNick = replyEl.querySelector(':scope > .ms-reply-row .ms-reply-random-nick');
      const rText = replyEl.querySelector(':scope > .ms-reply-text');
      const rImg = replyEl.querySelector(':scope > .ms-reply-row .ms-reply-image-path');
      const subList = replyEl.querySelector(':scope > .ms-reply-sub-list');
      replies.push({
        accountId: rAcct ? rAcct.value : '',
        randomNickname: rNick ? rNick.checked : false,
        text: rText ? rText.value : '',
        imagePath: rImg ? rImg.dataset.path || null : null,
        replies: subList ? collectReplies(subList) : [],
      });
    });
    return replies;
  };

  ms.comments = [];
  document.querySelectorAll('#ms-comments-list > .ms-comment-item').forEach(item => {
    const accountSelect = item.querySelector('.ms-cmt-account');
    const nickCheck = item.querySelector('.ms-cmt-random-nick');
    const textInput = item.querySelector('.ms-cmt-text');
    const imgSpan = item.querySelector('.ms-cmt-image-path');
    const replyList = item.querySelector('.ms-reply-list');
    ms.comments.push({
      accountId: accountSelect ? accountSelect.value : '',
      randomNickname: nickCheck ? nickCheck.checked : false,
      text: textInput ? textInput.value : '',
      imagePath: imgSpan ? imgSpan.dataset.path || null : null,
      replies: replyList ? collectReplies(replyList) : [],
    });
  });
}

// 계정별 가입 카페 캐시
const _cafeCache = {};
const _boardCache = {};

function applyBoardList(boards) {
  if (selectedMsIndex >= 0) {
    manuscripts[selectedMsIndex].boards = boards;
  }
  const boardSelect = document.getElementById('ms-board');
  const currentVal = boardSelect.value;
  boardSelect.innerHTML = '<option value="">게시판 선택...</option>';
  boards.forEach(b => {
    const opt = document.createElement('option');
    opt.value = b.menuId || '';
    opt.textContent = b.menuName;
    if (b.menuId === currentVal) opt.selected = true;
    boardSelect.appendChild(opt);
  });
}

async function fetchBoardsForCafe(cafeIdOrName, accountId) {
  if (!cafeIdOrName || !accountId) return;
  const statusEl = document.getElementById('ms-crawl-status');
  statusEl.textContent = '게시판 불러오는 중...';

  const result = await window.api.crawlBoards(cafeIdOrName, accountId);
  if (result.success) {
    const boards = result.boardList || [];
    const cacheKey = `${accountId}||${cafeIdOrName}`;
    _boardCache[cacheKey] = boards;

    if (selectedMsIndex >= 0 && result.cafeId) {
      manuscripts[selectedMsIndex].cafeId = result.cafeId;
      document.getElementById('ms-cafe-id').value = result.cafeId;
    }
    statusEl.textContent = `${boards.length}개 게시판 발견`;
    applyBoardList(boards);
  } else {
    statusEl.textContent = `실패: ${result.error}`;
  }
}

function renderCafeSelect(ms) {
  const select = document.getElementById('ms-cafe-select');
  select.innerHTML = '';

  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = '카페 선택...';
  select.appendChild(defaultOpt);

  // 현재 드롭다운에서 선택된 계정 우선, 없으면 저장된 값
  const currentAccount = document.getElementById('ms-account').value || ms.accountId || '';
  const cachedCafes = _cafeCache[currentAccount] || [];

  cachedCafes.forEach(cafe => {
    const opt = document.createElement('option');
    opt.value = `${cafe.cafeName}||${cafe.cafeId}`;
    opt.textContent = `${cafe.cafeTitle} (${cafe.cafeName})`;
    if (cafe.cafeName === ms.cafeName || cafe.cafeId === ms.cafeId) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });

  // 현재 원고에 카페가 설정되어 있지만 캐시에 없으면 직접 추가
  if (ms.cafeName && !cachedCafes.find(c => c.cafeName === ms.cafeName)) {
    const opt = document.createElement('option');
    opt.value = `${ms.cafeName}||${ms.cafeId || ''}`;
    opt.textContent = ms.cafeName + (ms.cafeId ? ` (${ms.cafeId})` : '');
    opt.selected = true;
    select.appendChild(opt);
  }
}

async function fetchCafesForAccount(accountId) {
  if (!accountId) { showToast('게시 계정을 먼저 선택하세요.'); return; }

  const statusEl = document.getElementById('ms-crawl-status');
  statusEl.textContent = '카페 목록 불러오는 중...';

  const result = await window.api.fetchJoinedCafes(accountId);
  if (result.success) {
    _cafeCache[accountId] = result.cafes;
    statusEl.textContent = `${result.cafes.length}개 카페 발견`;
    if (selectedMsIndex >= 0) {
      renderCafeSelect(manuscripts[selectedMsIndex]);
    }
  } else {
    statusEl.textContent = `실패: ${result.error}`;
  }
}

async function saveAllManuscripts() {
  await window.api.saveManuscripts({ manuscripts, presets });
}

function setupManuscriptsTab() {
  // 원고 추가
  document.getElementById('btn-add-ms').addEventListener('click', () => {
    const ms = {
      id: 'ms-' + Date.now().toString(36),
      accountId: '',
      cafeId: '',
      cafeName: '',
      boards: [],
      boardMenuId: '',
      boardName: '',
      post: { title: '새 게시글', bodySegments: [{ type: 'text', content: '' }] },
      comments: [],
      enabled: true,
    };
    manuscripts.push(ms);
    renderMsList();
    selectMs(manuscripts.length - 1);
  });

  // 원고 저장
  const saveMs = async () => {
    if (selectedMsIndex < 0) return;
    collectMsData();
    await saveAllManuscripts();
    renderMsList();
    showToast('원고 저장됨');
  };
  document.getElementById('btn-save-ms').addEventListener('click', saveMs);
  document.getElementById('btn-save-ms-top').addEventListener('click', saveMs);

  // 원고 삭제
  const deleteMs = async () => {
    if (selectedMsIndex < 0) return;
    if (!confirm('이 원고를 삭제하시겠습니까?')) return;
    manuscripts.splice(selectedMsIndex, 1);
    selectedMsIndex = -1;
    document.getElementById('ms-editor').style.display = 'none';
    await saveAllManuscripts();
    renderMsList();
  };
  document.getElementById('btn-delete-ms').addEventListener('click', deleteMs);
  document.getElementById('btn-delete-ms-top').addEventListener('click', deleteMs);

  // 카페 드롭다운 변경 → 게시판 자동 로드
  document.getElementById('ms-cafe-select').addEventListener('change', (e) => {
    const val = e.target.value;
    if (val) {
      const [cafeName, cafeId] = val.split('||');
      document.getElementById('ms-cafe-name').value = cafeName || '';
      document.getElementById('ms-cafe-id').value = cafeId || '';
      const accountId = document.getElementById('ms-account').value;
      const cacheKey = `${accountId}||${cafeId || cafeName}`;
      if (_boardCache[cacheKey]) {
        applyBoardList(_boardCache[cacheKey]);
      } else {
        fetchBoardsForCafe(cafeId || cafeName, accountId);
      }
    } else {
      document.getElementById('ms-cafe-name').value = '';
      document.getElementById('ms-cafe-id').value = '';
    }
  });

  // 게시 계정 변경 시 카페 목록 자동 로드 + 색상 갱신
  document.getElementById('ms-account').addEventListener('change', (e) => {
    const accountId = e.target.value;
    if (accountId) {
      getCommentAccountColor(accountId); // 색상 등록
      applySelectColor(e.target); // 게시 계정 드롭다운 색상
      refreshAllCommentColors(); // 댓글 드롭다운에도 반영
    }
    if (!accountId) return;
    if (_cafeCache[accountId]) {
      if (selectedMsIndex >= 0) renderCafeSelect(manuscripts[selectedMsIndex]);
    } else {
      fetchCafesForAccount(accountId);
    }
  });

  // 가입 카페 새로고침 (강제)
  document.getElementById('btn-ms-fetch-cafes').addEventListener('click', () => {
    const accountId = document.getElementById('ms-account').value;
    fetchCafesForAccount(accountId);
  });

  // 게시판 크롤링 (강제 새로고침)
  document.getElementById('btn-ms-crawl').addEventListener('click', () => {
    const cafeId = document.getElementById('ms-cafe-id').value.trim();
    const cafeName = document.getElementById('ms-cafe-name').value.trim();
    const accountId = document.getElementById('ms-account').value;
    if (!cafeName && !cafeId) return showToast('카페를 선택하세요.');
    if (!accountId) return showToast('게시 계정을 선택하세요.');
    fetchBoardsForCafe(cafeId || cafeName, accountId);
  });

  // 세그먼트
  document.getElementById('btn-add-text-seg').addEventListener('click', () => {
    if (selectedMsIndex < 0) return;
    MsHelpers.renderTextSegment(document.getElementById('ms-segments'), '');
  });

  document.getElementById('btn-add-img-seg').addEventListener('click', () => {
    if (selectedMsIndex < 0) return;
    MsHelpers.renderImageSegment(document.getElementById('ms-segments'), '');
  });

  // 댓글 추가
  document.getElementById('btn-add-ms-comment').addEventListener('click', () => {
    if (selectedMsIndex < 0) return;
    MsHelpers.renderCommentItem(
      document.getElementById('ms-comments-list'),
      { accountId: '', text: '', imagePath: null, replies: [] },
      accounts
    );
  });

  // 프리셋
  setupPresets();
}

function renderPresetSelect() {
  const select = document.getElementById('preset-select');
  select.innerHTML = '<option value="">프리셋 선택...</option>';
  presets.forEach((p, i) => {
    const date = p.savedAt ? new Date(p.savedAt).toLocaleDateString('ko-KR') : '';
    const msCount = (p.manuscripts || []).length;
    // 프리셋에 사용된 게시 계정만 수집
    const accountIds = new Set();
    (p.manuscripts || []).forEach(ms => {
      if (ms.accountId) accountIds.add(ms.accountId);
    });
    const accountsStr = accountIds.size > 0 ? Array.from(accountIds).join(', ') : '계정 없음';
    select.innerHTML += `<option value="${i}">${p.name} (${msCount}개 원고, ${accountsStr}, ${date})</option>`;
  });
}

function setupPresets() {
  renderPresetSelect();

  document.getElementById('btn-preset-save').addEventListener('click', async () => {
    const nameInput = document.getElementById('preset-name-input');
    let name = nameInput.value.trim();
    // 이름 미입력 시 오늘 날짜로 자동 생성
    if (!name) {
      const today = new Date();
      name = `${today.getMonth() + 1}/${today.getDate()} 작업`;
    }

    if (selectedMsIndex >= 0) collectMsData();

    const snapshot = JSON.parse(JSON.stringify(manuscripts));
    const existing = presets.findIndex(p => p.name === name);
    if (existing >= 0) {
      if (!confirm(`"${name}" 프리셋을 덮어쓰시겠습니까?`)) return;
      presets[existing].manuscripts = snapshot;
      presets[existing].savedAt = new Date().toISOString();
    } else {
      presets.push({ name, manuscripts: snapshot, savedAt: new Date().toISOString() });
    }

    await saveAllManuscripts();
    renderPresetSelect();
    nameInput.value = '';
    showToast(`프리셋 "${name}" 저장됨 (${snapshot.length}개 원고)`);
  });

  document.getElementById('btn-preset-load').addEventListener('click', async () => {
    const select = document.getElementById('preset-select');
    const idx = parseInt(select.value);
    if (isNaN(idx)) return showToast('프리셋을 선택하세요.');

    const preset = presets[idx];
    if (!preset) return;

    // 현재 원고 데이터 수집
    if (selectedMsIndex >= 0) collectMsData();

    const presetMs = JSON.parse(JSON.stringify(preset.manuscripts));
    // ID 충돌 방지
    presetMs.forEach(ms => {
      ms.id = 'ms-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    });

    manuscripts = manuscripts.concat(presetMs);
    showToast(`프리셋 "${preset.name}" 추가됨 (${presetMs.length}개 원고)`);

    selectedMsIndex = -1;
    document.getElementById('ms-editor').style.display = 'none';
    await saveAllManuscripts();
    renderMsList();
  });

  document.getElementById('btn-preset-delete').addEventListener('click', async () => {
    const select = document.getElementById('preset-select');
    const idx = parseInt(select.value);
    if (isNaN(idx)) return showToast('프리셋을 선택하세요.');

    const preset = presets[idx];
    if (!preset) return;
    if (!confirm(`"${preset.name}" 프리셋을 삭제하시겠습니까?`)) return;

    presets.splice(idx, 1);
    await saveAllManuscripts();
    renderPresetSelect();
  });
}

// =============================================
// 실행 탭
// =============================================

function setupExecutionTab() {
  document.getElementById('btn-exec-start').addEventListener('click', async () => {
    if (selectedMsIndex >= 0) collectMsData();
    await saveAllManuscripts();

    document.getElementById('exec-log').innerHTML = '';
    appendLog('실행을 시작합니다...');
    setExecButtons('running');

    const result = await window.api.executionStart();
    if (!result.success) {
      appendLog(`시작 실패: ${result.error}`, 'error');
      setExecButtons('idle');
    }
  });

  document.getElementById('btn-exec-pause').addEventListener('click', async () => {
    await window.api.executionPause();
    setExecButtons('paused');
  });

  document.getElementById('btn-exec-resume').addEventListener('click', async () => {
    await window.api.executionResume();
    setExecButtons('running');
  });

  document.getElementById('btn-exec-stop').addEventListener('click', async () => {
    await window.api.executionStop();
    setExecButtons('idle');
    appendLog('실행이 중지되었습니다.', 'error');
  });

  // 결과
  document.getElementById('result-select').addEventListener('change', async (e) => {
    const fileName = e.target.value;
    if (!fileName) { renderResults([]); return; }
    const log = await window.api.loadResultDetail(fileName);
    if (log && log.results) renderResults(log.results);
  });

  document.getElementById('btn-export-csv').addEventListener('click', async () => {
    const select = document.getElementById('result-select');
    if (!select.value) return showToast('실행 이력을 선택하세요.');
    const result = await window.api.exportCsv(select.value);
    if (result.success) showToast(`CSV 저장 완료: ${result.filePath}`);
    else if (!result.cancelled) showToast('CSV 저장 실패');
  });
}

function appendLog(msg, type) {
  const logArea = document.getElementById('exec-log');
  const div = document.createElement('div');
  div.className = 'log-entry' + (type ? ' ' + type : '');
  const time = new Date().toLocaleTimeString('ko-KR');
  div.textContent = `[${time}] ${msg}`;
  logArea.appendChild(div);
  logArea.scrollTop = logArea.scrollHeight;
}

function setExecButtons(state) {
  const s = document.getElementById('btn-exec-start');
  const p = document.getElementById('btn-exec-pause');
  const r = document.getElementById('btn-exec-resume');
  const t = document.getElementById('btn-exec-stop');
  if (state === 'running') {
    s.disabled = true; p.disabled = false; r.disabled = true; t.disabled = false;
  } else if (state === 'paused') {
    s.disabled = true; p.disabled = true; r.disabled = false; t.disabled = false;
  } else {
    s.disabled = false; p.disabled = true; r.disabled = true; t.disabled = true;
  }
}

function renderResults(results) {
  const tbody = document.getElementById('results-tbody');
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
      <td>${r.accountId || ''}</td>
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
}

async function loadResultsList() {
  const logs = await window.api.loadResultsList();
  const select = document.getElementById('result-select');
  select.innerHTML = '<option value="">실행 이력 선택...</option>';
  for (const log of logs) {
    const opt = document.createElement('option');
    opt.value = log.fileName;
    opt.textContent = `${log.executionId} (${log.resultCount}건)`;
    select.appendChild(opt);
  }
}

// =============================================
// 이벤트 리스너
// =============================================

function setupEventListeners() {
  if (_removeLogListener) _removeLogListener();
  if (_removeProgressListener) _removeProgressListener();
  if (_removeCompleteListener) _removeCompleteListener();

  _removeLogListener = window.api.onExecutionLog((data) => {
    appendLog(data.msg);
  });

  _removeProgressListener = window.api.onExecutionProgress((data) => {
    const bar = document.getElementById('exec-progress-bar');
    const text = document.getElementById('exec-progress-text');
    const percent = data.total > 0 ? Math.round((data.current / data.total) * 100) : 0;
    bar.style.width = percent + '%';
    text.textContent = `${data.current} / ${data.total} (${percent}%) - ${data.detail || ''}`;
  });

  _removeCompleteListener = window.api.onExecutionComplete((data) => {
    setExecButtons('idle');
    const log = data.log || {};
    const successCount = (log.results || []).filter(r => r.status === 'success').length;
    const failCount = (log.results || []).filter(r => r.status === 'failed').length;
    appendLog(`실행 완료! 성공: ${successCount}, 실패: ${failCount}`, 'success');
    document.getElementById('exec-progress-bar').style.width = '100%';
    loadResultsList();
  });
}

// =============================================
// 좋아요 탭
// =============================================

let _likeArticles = [];
const _likeCafeCache = {};
const _likeArticleCache = {}; // 키: accountId||cafeId → 게시글 캐시

function renderLikeAccountList() {
  const authorId = document.getElementById('like-author-account').value;
  const container = document.getElementById('like-account-list');
  const mode = document.querySelector('input[name="like-account-mode"]:checked').value;
  container.innerHTML = '';

  const filtered = accounts.filter(a => a.id !== authorId);

  if (filtered.length === 0) {
    container.innerHTML = '<div style="color:#8892b0; font-size:12px;">작성자를 제외한 계정이 없습니다.</div>';
    return;
  }

  // 그리드 스타일 초기화
  container.style.display = '';
  container.style.gridTemplateColumns = '';
  container.style.gap = '';

  if (mode === 'random') {
    // 랜덤 모드: 목록 숨기고 요약만 표시
    container.innerHTML = `<div style="color:#64ffda; font-size:13px; padding:8px 0;">전체 ${filtered.length}개 계정에서 랜덤 선택</div>`;
    // 숨겨진 체크박스로 전체 계정 등록
    filtered.forEach(acc => {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.className = 'like-account-check';
      input.value = acc.id;
      input.checked = true;
      input.style.display = 'none';
      container.appendChild(input);
    });
    return;
  }

  // 직접 선택 모드: 4열 그리드
  container.style.display = 'grid';
  container.style.gridTemplateColumns = 'repeat(4, 1fr)';
  container.style.gap = '2px 12px';

  filtered.forEach(acc => {
    const label = document.createElement('label');
    label.style.cssText = 'display:flex; align-items:center; gap:4px; padding:3px 0; cursor:pointer; font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
    label.innerHTML = `<input type="checkbox" class="like-account-check" value="${acc.id}" checked> ${acc.id}`;
    container.appendChild(label);
  });
}

function renderLikeArticleList() {
  const container = document.getElementById('like-article-list');
  container.innerHTML = '';

  if (_likeArticles.length === 0) {
    container.innerHTML = '<div style="color:#8892b0; font-size:12px;">게시글이 없습니다.</div>';
    return;
  }

  _likeArticles.forEach((art, i) => {
    const div = document.createElement('label');
    div.style.cssText = 'display:flex; align-items:center; gap:8px; padding:6px 4px; cursor:pointer; font-size:13px; border-bottom:1px solid #1b2838;';
    const date = art.writeDateTimestamp ? new Date(art.writeDateTimestamp).toLocaleDateString('ko-KR') : '';
    const articleUrl = art.cafeName && art.articleId ? `https://cafe.naver.com/${art.cafeName}/${art.articleId}` : '';
    div.innerHTML = `
      <input type="checkbox" class="like-article-check" data-index="${i}" checked>
      ${articleUrl
        ? `<a href="${articleUrl}" target="_blank" style="font-size:11px; color:#64ffda; flex-shrink:0; text-decoration:underline; cursor:pointer;">링크</a>`
        : ''
      }
      <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${art.subject}</span>
      <span style="font-size:11px; color:#8892b0; flex-shrink:0;">${date}</span>
    `;
    container.appendChild(div);
  });
}

function setupLikeTab() {
  // 작성자 계정 드롭다운
  const authorSelect = document.getElementById('like-author-account');
  authorSelect.innerHTML = '<option value="">계정 선택...</option>';
  accounts.forEach(a => {
    authorSelect.innerHTML += `<option value="${a.id}">${a.id}</option>`;
  });

  // 작성자 변경 시 계정 목록 갱신 + 카페 자동 불러오기
  authorSelect.addEventListener('change', async () => {
    renderLikeAccountList();
    const accountId = authorSelect.value;
    if (accountId) {
      if (_likeCafeCache[accountId]) {
        renderLikeCafeSelect();
      } else {
        // 카페 목록 자동 로드 (원고탭과 동일한 패턴)
        const statusEl = document.getElementById('like-fetch-status');
        statusEl.textContent = '카페 불러오는 중...';
        const result = await window.api.fetchJoinedCafes(accountId);
        if (result.success) {
          _likeCafeCache[accountId] = result.cafes;
          statusEl.textContent = `${result.cafes.length}개 카페`;
          renderLikeCafeSelect();
        } else {
          statusEl.textContent = `실패: ${result.error}`;
          renderLikeCafeSelect();
        }
      }
    } else {
      renderLikeCafeSelect();
    }
  });

  // 전체 선택 / 전체 해제
  document.getElementById('btn-like-select-all').addEventListener('click', () => {
    document.querySelectorAll('.like-article-check').forEach(cb => cb.checked = true);
  });
  document.getElementById('btn-like-deselect-all').addEventListener('click', () => {
    document.querySelectorAll('.like-article-check').forEach(cb => cb.checked = false);
  });

  // 카페 새로고침
  document.getElementById('btn-like-fetch-cafes').addEventListener('click', async () => {
    const accountId = authorSelect.value;
    if (!accountId) return showToast('작성자 계정을 선택하세요.');
    const statusEl = document.getElementById('like-fetch-status');
    statusEl.textContent = '카페 불러오는 중...';

    const result = await window.api.fetchJoinedCafes(accountId);
    if (result.success) {
      _likeCafeCache[accountId] = result.cafes;
      statusEl.textContent = `${result.cafes.length}개 카페`;
      renderLikeCafeSelect();
    } else {
      statusEl.textContent = `실패: ${result.error}`;
    }
  });

  // 카페 선택 시 자동으로 게시글 불러오기 (캐시 사용)
  document.getElementById('like-cafe-select').addEventListener('change', async (e) => {
    const cafeVal = e.target.value;
    if (!cafeVal) return;
    const accountId = authorSelect.value;
    if (!accountId) return;
    const [cafeName, cafeId] = cafeVal.split('||');
    const cacheKey = `${accountId}||${cafeId}`;

    if (_likeArticleCache[cacheKey]) {
      // 캐시 사용
      _likeArticles = _likeArticleCache[cacheKey];
      document.getElementById('like-fetch-status').textContent = `${_likeArticles.length}개 게시글 (캐시)`;
      renderLikeArticleList();
    } else {
      await fetchLikeArticles(accountId, cafeName, cafeId);
    }
  });

  // 게시글 불러오기 버튼 (강제 새로고침)
  document.getElementById('btn-like-fetch-articles').addEventListener('click', async () => {
    const accountId = authorSelect.value;
    const cafeVal = document.getElementById('like-cafe-select').value;
    if (!accountId) return showToast('작성자 계정을 선택하세요.');
    if (!cafeVal) return showToast('카페를 선택하세요.');

    const [cafeName, cafeId] = cafeVal.split('||');
    await fetchLikeArticles(accountId, cafeName, cafeId);
  });

  // 모드 변경 시 계정 목록 다시 렌더링
  document.querySelectorAll('input[name="like-account-mode"]').forEach(radio => {
    radio.addEventListener('change', () => {
      renderLikeAccountList();
    });
  });

  // 전체 선택 (직접 선택 모드에서만 유효)
  document.getElementById('like-select-all-accounts').addEventListener('change', (e) => {
    document.querySelectorAll('.like-account-check').forEach(cb => {
      cb.checked = e.target.checked;
    });
  });

  // 좋아요 시작
  document.getElementById('btn-like-start').addEventListener('click', async () => {
    const selectedArticles = [];
    document.querySelectorAll('.like-article-check:checked').forEach(cb => {
      const idx = parseInt(cb.dataset.index);
      if (_likeArticles[idx]) selectedArticles.push(_likeArticles[idx]);
    });

    if (selectedArticles.length === 0) return showToast('좋아요할 게시글을 선택하세요.');

    const likerIds = [];
    document.querySelectorAll('.like-account-check:checked').forEach(cb => {
      likerIds.push(cb.value);
    });

    if (likerIds.length === 0) return showToast('좋아요 누를 계정을 선택하세요.');

    const likeCount = parseInt(document.getElementById('like-count').value) || 1;
    const mode = document.querySelector('input[name="like-account-mode"]:checked').value;

    document.getElementById('like-log').innerHTML = '';
    document.getElementById('like-progress-bar').style.width = '0%';
    document.getElementById('like-progress-text').textContent = '시작 중...';
    document.getElementById('btn-like-start').disabled = true;
    document.getElementById('btn-like-stop').disabled = false;

    await window.api.executeLikes({
      targetArticles: selectedArticles,
      likerAccountIds: likerIds,
      randomMode: mode === 'random',
      likeCount,
    });
  });

  // 중지
  document.getElementById('btn-like-stop').addEventListener('click', async () => {
    await window.api.stopLikes();
    document.getElementById('btn-like-start').disabled = false;
    document.getElementById('btn-like-stop').disabled = true;
    appendLikeLog('중지됨', 'error');
  });

  // 이벤트 리스너
  if (_removeLikeLogListener) _removeLikeLogListener();
  if (_removeLikeProgressListener) _removeLikeProgressListener();
  if (_removeLikeCompleteListener) _removeLikeCompleteListener();

  _removeLikeLogListener = window.api.onLikeLog((data) => {
    appendLikeLog(data.msg);
  });

  _removeLikeProgressListener = window.api.onLikeProgress((data) => {
    const percent = data.total > 0 ? Math.round((data.current / data.total) * 100) : 0;
    document.getElementById('like-progress-bar').style.width = percent + '%';
    document.getElementById('like-progress-text').textContent = `${data.current} / ${data.total} (${percent}%)`;
  });

  _removeLikeCompleteListener = window.api.onLikeComplete(() => {
    document.getElementById('btn-like-start').disabled = false;
    document.getElementById('btn-like-stop').disabled = true;
    appendLikeLog('완료', 'success');
    document.getElementById('like-progress-bar').style.width = '100%';
  });

  renderLikeAccountList();

  // 탭 전환 시 계정 목록 갱신
  document.querySelector('.tab-btn[data-tab="like"]').addEventListener('click', () => {
    // 계정 목록 최신화
    const authorSelect = document.getElementById('like-author-account');
    const currentVal = authorSelect.value;
    authorSelect.innerHTML = '<option value="">계정 선택...</option>';
    accounts.forEach(a => {
      authorSelect.innerHTML += `<option value="${a.id}" ${a.id === currentVal ? 'selected' : ''}>${a.id}</option>`;
    });
    renderLikeAccountList();
  });
}

async function fetchLikeArticles(accountId, cafeName, cafeId) {
  const statusEl = document.getElementById('like-fetch-status');
  statusEl.textContent = '게시글 불러오는 중...';

  const result = await window.api.fetchMemberArticles(accountId, cafeId);
  if (result.success) {
    _likeArticles = result.articles.map(a => ({ ...a, cafeName, cafeId }));
    const cacheKey = `${accountId}||${cafeId}`;
    _likeArticleCache[cacheKey] = _likeArticles;
    statusEl.textContent = `${result.articles.length}개 게시글 (총 ${result.totalCount}개)`;
    renderLikeArticleList();
  } else {
    statusEl.textContent = `실패: ${result.error}`;
    _likeArticles = [];
    renderLikeArticleList();
  }
}

function renderLikeCafeSelect() {
  const accountId = document.getElementById('like-author-account').value;
  const select = document.getElementById('like-cafe-select');
  select.innerHTML = '<option value="">카페 선택...</option>';

  const cafes = _likeCafeCache[accountId] || [];
  cafes.forEach(cafe => {
    const opt = document.createElement('option');
    opt.value = `${cafe.cafeName}||${cafe.cafeId}`;
    opt.textContent = `${cafe.cafeTitle} (${cafe.cafeName})`;
    select.appendChild(opt);
  });
}

function appendLikeLog(msg, type) {
  const logArea = document.getElementById('like-log');
  const div = document.createElement('div');
  div.className = 'log-entry' + (type ? ' ' + type : '');
  const time = new Date().toLocaleTimeString('ko-KR');
  div.textContent = `[${time}] ${msg}`;
  logArea.appendChild(div);
  logArea.scrollTop = logArea.scrollHeight;
}

// =============================================
// 초기화
// =============================================

async function setupVersionAndUpdate() {
  const version = await window.api.getAppVersion();
  document.getElementById('app-version').textContent = `v${version}`;

  const btn = document.getElementById('btn-check-update');

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = '확인 중...';
    await window.api.checkForUpdate();
  });

  window.api.onUpdateAvailable((data) => {
    btn.textContent = `v${data.version} 다운로드 중...`;
  });

  window.api.onUpdateProgress((data) => {
    btn.textContent = `다운로드 ${data.percent}%`;
  });

  window.api.onUpdateDownloaded((data) => {
    btn.textContent = `v${data.version} 설치`;
    btn.disabled = false;
    btn.onclick = () => window.api.installUpdate();
  });

  window.api.onUpdateNotAvailable(() => {
    showToast('최신 버전입니다.');
    btn.disabled = false;
    btn.textContent = '업데이트 확인';
  });

  window.api.onUpdateError(() => {
    showToast('최신 버전입니다.');
    btn.disabled = false;
    btn.textContent = '업데이트 확인';
  });
}

async function initApp() {
  setupTabs();
  setupVersionAndUpdate();

  // 데이터 로드
  accounts = await window.api.loadAccounts();
  settings = await window.api.loadSettings();
  const msData = await window.api.loadManuscripts();
  manuscripts = msData.manuscripts || [];
  presets = msData.presets || [];

  // 설정 탭
  renderAccountsTable();
  setupAddAccount();
  setupSettingsToggles();
  setupShortcuts();

  // 원고 탭
  renderMsList();
  setupManuscriptsTab();

  // 실행 탭
  setupExecutionTab();
  setupEventListeners();
  loadResultsList();

  // 삭제 탭
  setupDeleteTab();

  // 좋아요 탭
  setupLikeTab();

}

// =============================================
// 삭제 탭
// =============================================

async function renderDeleteTable() {
  const schedule = await window.api.loadDeleteSchedule();
  const tbody = document.getElementById('delete-tbody');
  tbody.innerHTML = '';

  // 최신순 정렬
  schedule.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  for (const entry of schedule) {
    const tr = document.createElement('tr');
    const statusClass = entry.status === 'deleted' ? 'status-deleted' : entry.status === 'failed' ? 'status-failed' : 'status-posted';
    const date = entry.createdAt ? new Date(entry.createdAt).toLocaleString('ko-KR') : '';

    tr.innerHTML = `
      <td><input type="checkbox" class="delete-check" data-url="${entry.postUrl}" ${entry.status === 'deleted' ? 'disabled' : ''}></td>
      <td>${entry.accountId || ''}</td>
      <td>${entry.postTitle || ''}</td>
      <td>${entry.postUrl ? `<a href="#" class="result-link" data-url="${entry.postUrl}" style="font-size:11px;">${entry.postUrl.substring(0, 45)}...</a>` : '-'}</td>
      <td style="font-size:11px;">${date}</td>
      <td class="${statusClass}">${entry.status || 'posted'}</td>
    `;
    tbody.appendChild(tr);
  }

  // 링크 클릭
  tbody.querySelectorAll('.result-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      window.api.openExternal(link.dataset.url);
    });
  });
}

function getSelectedDeleteUrls() {
  return Array.from(document.querySelectorAll('.delete-check:checked'))
    .map(cb => cb.dataset.url);
}

function setupDeleteTab() {
  // 전체 선택
  document.getElementById('delete-select-all').addEventListener('change', (e) => {
    document.querySelectorAll('.delete-check:not(:disabled)').forEach(cb => {
      cb.checked = e.target.checked;
    });
  });

  // 선택 삭제 (실제 네이버에서 삭제)
  document.getElementById('btn-delete-selected').addEventListener('click', async () => {
    const urls = getSelectedDeleteUrls();
    if (urls.length === 0) return showToast('삭제할 게시글을 선택하세요.');
    if (!confirm(`선택한 ${urls.length}개 게시글을 네이버에서 삭제하시겠습니까?`)) return;

    const statusEl = document.getElementById('delete-status');
    statusEl.textContent = `${urls.length}개 삭제 중...`;

    const result = await window.api.deletePosts(urls);
    if (result.success) {
      const deleted = result.results.filter(r => r.status === 'deleted').length;
      const failed = result.results.filter(r => r.status === 'failed').length;
      statusEl.textContent = `삭제 완료: 성공 ${deleted}, 실패 ${failed}`;
    } else {
      statusEl.textContent = `오류: ${result.error}`;
    }

    await renderDeleteTable();
    setTimeout(() => { statusEl.textContent = ''; }, 5000);
  });

  // 목록에서 제거 (삭제 기록만 제거)
  document.getElementById('btn-delete-remove-selected').addEventListener('click', async () => {
    const urls = getSelectedDeleteUrls();
    if (urls.length === 0) return showToast('제거할 항목을 선택하세요.');
    if (!confirm(`선택한 ${urls.length}개 항목을 목록에서 제거하시겠습니까?\n(네이버 게시글은 삭제되지 않습니다)`)) return;

    await window.api.removeDeleteEntries(urls);
    await renderDeleteTable();
    showToast(`${urls.length}개 항목 제거됨`);
  });

  // 탭 전환 시 자동 로드
  document.querySelector('.tab-btn[data-tab="delete-manage"]').addEventListener('click', () => {
    renderDeleteTable();
  });

  renderDeleteTable();
}

initApp();
