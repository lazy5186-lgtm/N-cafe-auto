// 예약 발행 스케줄러 — 원고의 scheduledAt 시간이 되면 자동으로 실행
// 30초 간격으로 폴링. 수동 실행 중이면 스킵. 단일 원고만 실행.

const store = require('../data/store');
const Executor = require('./executor');

let intervalId = null;
let running = false;
let safeSend = () => {};
let isManualRunning = () => false;
let onCompleteCb = () => {};

const POLL_INTERVAL_MS = 30 * 1000;

function start(options = {}) {
  if (intervalId) return;
  safeSend = options.safeSend || safeSend;
  isManualRunning = options.isManualRunning || isManualRunning;
  onCompleteCb = options.onComplete || onCompleteCb;

  console.log('[스케줄러] 시작 (30초 간격 폴링)');
  intervalId = setInterval(() => { tick().catch(() => {}); }, POLL_INTERVAL_MS);
  // 시작 즉시 1회 실행 (미실행 과거 원고 처리)
  setTimeout(() => tick().catch(() => {}), 3000);
}

function stop() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('[스케줄러] 중지');
  }
}

function listScheduled() {
  const { manuscripts } = store.loadGlobalManuscripts();
  return (manuscripts || [])
    .filter(m => m.scheduledAt)
    .map(m => ({
      id: m.id,
      title: (m.post || {}).title || '',
      scheduledAt: m.scheduledAt,
      scheduledStatus: m.scheduledStatus || 'pending',
      lastRunAt: m.lastRunAt || null,
      lastError: m.lastError || null,
    }));
}

function setScheduled(manuscriptId, scheduledAt) {
  const data = store.loadGlobalManuscripts();
  const idx = (data.manuscripts || []).findIndex(m => m.id === manuscriptId);
  if (idx < 0) return false;
  if (scheduledAt) {
    data.manuscripts[idx].scheduledAt = scheduledAt;
    data.manuscripts[idx].scheduledStatus = 'pending';
    data.manuscripts[idx].lastError = null;
  } else {
    delete data.manuscripts[idx].scheduledAt;
    delete data.manuscripts[idx].scheduledStatus;
    delete data.manuscripts[idx].lastError;
  }
  store.saveGlobalManuscripts(data);
  return true;
}

function resetStatus(manuscriptId) {
  const data = store.loadGlobalManuscripts();
  const idx = (data.manuscripts || []).findIndex(m => m.id === manuscriptId);
  if (idx < 0) return false;
  data.manuscripts[idx].scheduledStatus = 'pending';
  data.manuscripts[idx].lastError = null;
  store.saveGlobalManuscripts(data);
  return true;
}

function updateStatus(manuscriptId, updates) {
  const data = store.loadGlobalManuscripts();
  const idx = (data.manuscripts || []).findIndex(m => m.id === manuscriptId);
  if (idx < 0) return;
  data.manuscripts[idx] = { ...data.manuscripts[idx], ...updates };
  store.saveGlobalManuscripts(data);
}

async function tick() {
  if (running) return; // 이미 스케줄 실행 중
  if (isManualRunning()) return; // 수동 실행 중이면 스킵

  const data = store.loadGlobalManuscripts();
  const manuscripts = data.manuscripts;
  if (!manuscripts) return;

  const now = Date.now();
  // 폴링 간격(30초) + 약간의 여유 = 2분 이내만 "실행 가능"으로 간주
  // 2분 이상 지난 예약은 PC/앱이 꺼져 있던 기간으로 보고 "만료(expired)" 처리 (실행 안 함)
  const GRACE_MS = 2 * 60 * 1000;

  // 지나간 예약 만료 처리 — 한 번에 저장
  let changed = false;
  for (const m of manuscripts) {
    if (!m.scheduledAt) continue;
    if (m.scheduledStatus && m.scheduledStatus !== 'pending') continue;
    const t = new Date(m.scheduledAt).getTime();
    if (isNaN(t)) continue;
    if (t < now - GRACE_MS) {
      m.scheduledStatus = 'expired';
      m.lastError = '예약 시간 경과 (PC/앱이 꺼져있었거나 너무 늦게 감지)';
      changed = true;
      safeSend('scheduler:log', {
        msg: `[예약] "${(m.post || {}).title || m.id}" 만료 — 예약 시간(${new Date(m.scheduledAt).toLocaleString()})이 지났습니다`,
        scheduled: true,
      });
    }
  }
  if (changed) {
    store.saveGlobalManuscripts(data);
    onCompleteCb();
  }

  // 실행 대상: 유예 시간 이내 + 아직 pending 인 것만
  const due = manuscripts.filter(m => {
    if (!m.scheduledAt) return false;
    if (m.scheduledStatus && m.scheduledStatus !== 'pending') return false;
    const t = new Date(m.scheduledAt).getTime();
    return !isNaN(t) && t <= now && t >= now - GRACE_MS;
  });

  if (due.length === 0) return;

  running = true;
  try {
    for (const ms of due) {
      if (isManualRunning()) break;
      await runSingle(ms);
    }
  } finally {
    running = false;
  }
}

async function runSingle(ms) {
  safeSend('scheduler:log', { msg: `[예약] "${(ms.post || {}).title || ms.id}" 실행 시작` });

  updateStatus(ms.id, { scheduledStatus: 'running', lastRunAt: new Date().toISOString() });

  const accounts = store.loadAccounts();
  const settings = store.loadSettings();

  const executor = new Executor();
  executor.on('log', (d) => safeSend('scheduler:log', { msg: d.msg, scheduled: true }));
  executor.on('progress', (d) => safeSend('scheduler:progress', { ...d, manuscriptId: ms.id }));

  try {
    // enabled 여부와 무관하게 예약된 원고는 실행 (예약 자체가 "활성화 의지")
    const msRun = { ...ms, enabled: true };
    const savedLog = await executor.execute([msRun], settings, accounts);
    const firstResult = (savedLog && savedLog.results && savedLog.results[0]) || {};
    if (firstResult.status === 'success') {
      updateStatus(ms.id, { scheduledStatus: 'executed', lastError: null });
      safeSend('scheduler:log', { msg: `[예약] "${(ms.post || {}).title || ms.id}" 실행 완료 (성공)`, scheduled: true });
    } else {
      updateStatus(ms.id, { scheduledStatus: 'failed', lastError: firstResult.error || '실행 실패' });
      safeSend('scheduler:log', { msg: `[예약] "${(ms.post || {}).title || ms.id}" 실행 실패: ${firstResult.error || '알 수 없음'}`, scheduled: true });
    }
    onCompleteCb();
  } catch (e) {
    updateStatus(ms.id, { scheduledStatus: 'failed', lastError: e.message });
    safeSend('scheduler:log', { msg: `[예약] 실행 오류: ${e.message}`, scheduled: true });
  }
}

function isRunning() { return running; }

module.exports = { start, stop, listScheduled, setScheduled, resetStatus, tick, runSingle, isRunning };
