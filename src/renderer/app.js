// N Cafe Auto — Sidebar + Subtab Controller

let accounts = [];
let activeAccountId = null;
let _removeLogListener = null;
let _removeProgressListener = null;
let _removeCompleteListener = null;

// --- 전체 실행 상태 ---
let globalRunning = false;
let globalQueue = [];
let globalCurrentIdx = 0;

// --- 사이드바 계정 버튼 ---

function createSidebarButton(account) {
  const btn = document.createElement('button');
  btn.className = 'sidebar-account-btn';
  btn.dataset.accountId = account.id;
  btn.innerHTML = `
    <span class="sidebar-dot"></span>
    <span class="sidebar-label">${account.id}</span>
  `;
  btn.addEventListener('click', () => switchTab(account.id));
  return btn;
}

function switchTab(accountId) {
  activeAccountId = accountId;

  // 사이드바 버튼 활성화
  document.querySelectorAll('#sidebar-accounts .sidebar-account-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.accountId === accountId);
  });

  // 패널 활성화
  document.querySelectorAll('#tab-content .tab-panel').forEach(p => {
    p.classList.toggle('active', p.dataset.accountId === accountId);
  });

  // empty state 숨김
  const empty = document.getElementById('empty-state');
  if (empty) empty.style.display = 'none';

  // subtab-nav 표시
  const subtabNav = document.getElementById('subtab-nav');
  if (subtabNav) subtabNav.style.display = 'flex';

  // 서브탭 복원
  const panel = document.querySelector(`#tab-panel-${CSS.escape(accountId)}`);
  if (panel) {
    const subtab = panel._activeSubtab || 'settings';
    switchSubtab(subtab);
    AccountTab.loadResultsList(panel, accountId);
  }
}

// --- 서브탭 전환 ---

function switchSubtab(subtabName) {
  const panel = document.querySelector(`#tab-panel-${CSS.escape(activeAccountId)}`);
  if (!panel) return;

  // 서브탭 네비 버튼 활성화
  document.querySelectorAll('#subtab-nav .subtab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.subtab === subtabName);
  });

  // 서브탭 콘텐츠 전환
  panel.querySelectorAll('.subtab-content').forEach(content => {
    content.classList.toggle('active', content.dataset.subtab === subtabName);
  });

  // 패널에 현재 서브탭 저장
  panel._activeSubtab = subtabName;
}

function setupSubtabNav() {
  document.querySelectorAll('#subtab-nav .subtab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      switchSubtab(btn.dataset.subtab);
    });
  });
}

// --- 탭 추가/삭제 ---

function addAccountTab(account) {
  const sidebarAccounts = document.getElementById('sidebar-accounts');
  const tabContent = document.getElementById('tab-content');

  // 사이드바 버튼
  const btn = createSidebarButton(account);
  sidebarAccounts.appendChild(btn);

  // 패널
  const panel = AccountTab.createPanel(account, accounts);
  tabContent.appendChild(panel);
}

function removeAccountTab(accountId) {
  // 사이드바 버튼 제거
  const btn = document.querySelector(`#sidebar-accounts .sidebar-account-btn[data-account-id="${CSS.escape(accountId)}"]`);
  if (btn) btn.remove();

  // 패널 제거
  const panel = document.querySelector(`#tab-panel-${CSS.escape(accountId)}`);
  if (panel) panel.remove();

  // 계정 목록에서 제거
  accounts = accounts.filter(a => a.id !== accountId);

  // 다른 탭으로 전환
  if (accounts.length > 0) {
    switchTab(accounts[0].id);
  } else {
    activeAccountId = null;
    const empty = document.getElementById('empty-state');
    if (empty) empty.style.display = 'block';
    // subtab-nav 숨김
    const subtabNav = document.getElementById('subtab-nav');
    if (subtabNav) subtabNav.style.display = 'none';
  }
}

// --- 계정 추가 모달 ---

function setupAddAccountModal() {
  const modal = document.getElementById('add-account-modal');
  const btnAdd = document.getElementById('btn-add-tab');
  const btnCancel = document.getElementById('modal-cancel');
  const btnConfirm = document.getElementById('modal-confirm');

  btnAdd.addEventListener('click', () => {
    modal.style.display = 'flex';
    document.getElementById('modal-account-id').value = '';
    document.getElementById('modal-account-pw').value = '';
    document.getElementById('modal-account-id').focus();
  });

  btnCancel.addEventListener('click', () => {
    modal.style.display = 'none';
  });

  btnConfirm.addEventListener('click', async () => {
    const id = document.getElementById('modal-account-id').value.trim();
    const pw = document.getElementById('modal-account-pw').value.trim();

    if (!id || !pw) return alert('아이디와 비밀번호를 입력하세요.');
    if (accounts.find(a => a.id === id)) return alert('이미 등록된 아이디입니다.');

    const result = await window.api.addAccount({ id, password: pw });
    if (!result.success) return alert('계정 추가 실패');

    modal.style.display = 'none';

    // 새로고침
    await loadAllAccounts();
  });

  // Enter 키로 추가
  document.getElementById('modal-account-pw').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnConfirm.click();
  });
}

// --- 이벤트 라우팅 ---

function setupEventListeners() {
  if (_removeLogListener) _removeLogListener();
  if (_removeProgressListener) _removeProgressListener();
  if (_removeCompleteListener) _removeCompleteListener();

  _removeLogListener = window.api.onExecutionLog((data) => {
    const panel = document.querySelector(`#tab-panel-${CSS.escape(data.accountId)}`);
    if (panel) {
      AccountTab._appendLog(panel, data.msg);
    }
  });

  _removeProgressListener = window.api.onExecutionProgress((data) => {
    const panel = document.querySelector(`#tab-panel-${CSS.escape(data.accountId)}`);
    if (panel) {
      AccountTab.updateProgress(panel, data);
    }
  });

  _removeCompleteListener = window.api.onExecutionComplete((data) => {
    const panel = document.querySelector(`#tab-panel-${CSS.escape(data.accountId)}`);
    if (panel) {
      AccountTab.onComplete(panel, data.log);
      AccountTab.loadResultsList(panel, data.accountId);
    }

    // 전체 실행 중이면 다음 계정 진행
    if (globalRunning) {
      globalRunNextAccount();
    }
  });
}

// --- 계정 삭제 이벤트 ---

document.addEventListener('account-deleted', (e) => {
  const { accountId } = e.detail;
  removeAccountTab(accountId);
});

// --- 전체 실행 ---

function setupGlobalExecution() {
  const startBtn = document.getElementById('btn-global-start');
  const stopBtn = document.getElementById('btn-global-stop');

  startBtn.addEventListener('click', () => globalStartAll());
  stopBtn.addEventListener('click', () => globalStopAll());
}

async function globalStartAll() {
  if (accounts.length === 0) return alert('등록된 계정이 없습니다.');
  if (globalRunning) return;

  globalRunning = true;
  globalQueue = accounts.map(a => a.id);
  globalCurrentIdx = 0;

  const bar = document.getElementById('global-exec-bar');
  bar.classList.add('running');
  document.getElementById('btn-global-start').disabled = true;
  document.getElementById('btn-global-stop').disabled = false;

  // 개별 시작 버튼 비활성화
  setIndividualStartButtons(true);

  globalUpdateText();
  await globalRunAccount(globalQueue[0]);
}

function globalStopAll() {
  if (!globalRunning) return;

  const currentAccountId = globalQueue[globalCurrentIdx];
  if (currentAccountId) {
    window.api.executionStop(currentAccountId);
    const panel = document.querySelector(`#tab-panel-${CSS.escape(currentAccountId)}`);
    if (panel) {
      AccountTab._setExecButtons(panel, 'idle');
      AccountTab._appendLog(panel, '전체 실행 중지됨', 'error');
    }
  }

  globalFinish();
}

function globalFinish() {
  globalRunning = false;
  globalQueue = [];
  globalCurrentIdx = 0;

  const bar = document.getElementById('global-exec-bar');
  bar.classList.remove('running');
  document.getElementById('btn-global-start').disabled = false;
  document.getElementById('btn-global-stop').disabled = true;
  document.getElementById('global-exec-text').textContent = '완료';

  setIndividualStartButtons(false);
}

async function globalRunAccount(accountId) {
  globalUpdateText();

  // 해당 탭으로 전환 + 실행 서브탭으로 이동
  switchTab(accountId);
  switchSubtab('execution');

  const panel = document.querySelector(`#tab-panel-${CSS.escape(accountId)}`);
  if (panel) {
    if (panel._selectedMsIndex >= 0) AccountTab._collectMsData(panel);
    const account = accounts.find(a => a.id === accountId);
    if (account) await AccountTab._saveAccountData(panel, account);

    const logArea = panel.querySelector('.exec-log');
    logArea.innerHTML = '';
    AccountTab._appendLog(panel, '[전체 실행] 실행을 시작합니다...');
    AccountTab._setExecButtons(panel, 'running');
  }

  const result = await window.api.executionStart(accountId);
  if (!result.success) {
    if (panel) {
      AccountTab._appendLog(panel, `시작 실패: ${result.error}`, 'error');
      AccountTab._setExecButtons(panel, 'idle');
    }
    globalRunNextAccount();
  }
}

async function globalRunNextAccount() {
  globalCurrentIdx++;

  if (globalCurrentIdx >= globalQueue.length) {
    globalFinish();
    return;
  }

  globalUpdateText();
  await globalRunAccount(globalQueue[globalCurrentIdx]);
}

function globalUpdateText() {
  const textEl = document.getElementById('global-exec-text');
  const current = globalCurrentIdx + 1;
  const total = globalQueue.length;
  const currentId = globalQueue[globalCurrentIdx] || '';
  textEl.textContent = `${current}/${total} 계정 처리 중 (${currentId})`;
}

function setIndividualStartButtons(disabled) {
  document.querySelectorAll('.tab-panel .btn-exec-start').forEach(btn => {
    btn.disabled = disabled;
  });
}

// --- 초기화 ---

async function loadAllAccounts() {
  accounts = await window.api.loadAccounts();
  AccountTab._accounts = accounts;

  const sidebarAccounts = document.getElementById('sidebar-accounts');
  const tabContent = document.getElementById('tab-content');
  const subtabNav = document.getElementById('subtab-nav');

  // 기존 버튼/패널 정리
  sidebarAccounts.innerHTML = '';
  tabContent.querySelectorAll('.tab-panel').forEach(p => p.remove());

  if (accounts.length === 0) {
    const empty = document.getElementById('empty-state');
    if (empty) empty.style.display = 'block';
    if (subtabNav) subtabNav.style.display = 'none';
    activeAccountId = null;
    return;
  }

  const empty = document.getElementById('empty-state');
  if (empty) empty.style.display = 'none';
  if (subtabNav) subtabNav.style.display = 'flex';

  for (const account of accounts) {
    addAccountTab(account);
  }

  // 첫 번째 탭 활성화
  switchTab(accounts[0].id);
}

async function initApp() {
  setupAddAccountModal();
  setupEventListeners();
  setupGlobalExecution();
  setupSubtabNav();
  await loadAllAccounts();
}

initApp();
