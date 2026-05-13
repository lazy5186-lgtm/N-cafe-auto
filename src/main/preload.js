const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 계정
  loadAccounts: () => ipcRenderer.invoke('accounts:load'),
  addAccount: (account) => ipcRenderer.invoke('account:add', account),
  updateAccount: (accountId, updates) => ipcRenderer.invoke('account:update', accountId, updates),
  deleteAccount: (accountId) => ipcRenderer.invoke('account:delete', accountId),
  hasCookies: (accountId) => ipcRenderer.invoke('accounts:has-cookies', accountId),
  loginTest: (accountId) => ipcRenderer.invoke('accounts:login-test', accountId),
  getCookieExpiry: () => ipcRenderer.invoke('cookies:get-expiry'),
  exportRedactedCookies: () => ipcRenderer.invoke('cookies:export-redacted'),

  // 설정 (글로벌)
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),

  // 원고 (글로벌)
  loadManuscripts: () => ipcRenderer.invoke('manuscripts:load'),
  saveManuscripts: (data) => ipcRenderer.invoke('manuscripts:save', data),

  // 닉네임 단어
  loadNicknameWords: () => ipcRenderer.invoke('nickname-words:load'),
  saveNicknameWords: (data) => ipcRenderer.invoke('nickname-words:save', data),

  // 카페/크롤링
  fetchJoinedCafes: (accountId) => ipcRenderer.invoke('cafes:joined', accountId),
  crawlBoards: (cafeName, accountId) => ipcRenderer.invoke('crawl:boards', cafeName, accountId),

  // IP
  checkInterface: (interfaceName) => ipcRenderer.invoke('ip:check-interface', interfaceName),
  changeIP: (interfaceName) => ipcRenderer.invoke('ip:change', interfaceName),

  // ADB
  checkAdbDevice: (deviceId) => ipcRenderer.invoke('adb:check-device', deviceId),
  onIpStatus: (cb) => { ipcRenderer.on('ip:status', (_e, d) => cb(d)); },

  // 삭제 관리
  loadDeleteSchedule: () => ipcRenderer.invoke('delete-schedule:load'),
  deletePosts: (postUrls) => ipcRenderer.invoke('delete-schedule:delete-posts', postUrls),
  removeDeleteEntries: (postUrls) => ipcRenderer.invoke('delete-schedule:remove', postUrls),

  // 실행 (글로벌)
  executionStart: () => ipcRenderer.invoke('execution:start'),
  executionPause: () => ipcRenderer.invoke('execution:pause'),
  executionResume: () => ipcRenderer.invoke('execution:resume'),
  executionStop: () => ipcRenderer.invoke('execution:stop'),

  // 예약 발행 스케줄러
  schedulerList: () => ipcRenderer.invoke('scheduler:list'),
  schedulerSet: (manuscriptId, scheduledAt) => ipcRenderer.invoke('scheduler:set', manuscriptId, scheduledAt),
  schedulerReset: (manuscriptId) => ipcRenderer.invoke('scheduler:reset', manuscriptId),
  schedulerRunNow: (manuscriptId) => ipcRenderer.invoke('scheduler:run-now', manuscriptId),
  onSchedulerLog: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('scheduler:log', listener);
    return () => ipcRenderer.removeListener('scheduler:log', listener);
  },
  onSchedulerProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('scheduler:progress', listener);
    return () => ipcRenderer.removeListener('scheduler:progress', listener);
  },
  onSchedulerUpdated: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('scheduler:manuscripts-updated', listener);
    return () => ipcRenderer.removeListener('scheduler:manuscripts-updated', listener);
  },

  // 결과
  loadResultsList: () => ipcRenderer.invoke('results:load-list'),
  loadResultDetail: (fileName) => ipcRenderer.invoke('results:load-detail', fileName),
  exportCsv: (fileName) => ipcRenderer.invoke('results:export-csv', fileName),

  // 좋아요
  fetchMemberArticles: (accountId, cafeId) => ipcRenderer.invoke('like:fetch-articles', accountId, cafeId),
  executeLikes: (config) => ipcRenderer.invoke('like:execute', config),
  stopLikes: () => ipcRenderer.invoke('like:stop'),

  onLikeLog: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('like:log', listener);
    return () => ipcRenderer.removeListener('like:log', listener);
  },
  onLikeProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('like:progress', listener);
    return () => ipcRenderer.removeListener('like:progress', listener);
  },
  onLikeComplete: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('like:complete', listener);
    return () => ipcRenderer.removeListener('like:complete', listener);
  },

  // 업데이트
  getAppVersion: () => ipcRenderer.invoke('app:version'),
  checkForUpdate: () => ipcRenderer.invoke('app:check-update'),
  installUpdate: () => ipcRenderer.invoke('app:install-update'),
  onUpdateAvailable: (cb) => { ipcRenderer.on('update:available', (_e, d) => cb(d)); },
  onUpdateProgress: (cb) => { ipcRenderer.on('update:progress', (_e, d) => cb(d)); },
  onUpdateDownloaded: (cb) => { ipcRenderer.on('update:downloaded', (_e, d) => cb(d)); },
  onUpdateNotAvailable: (cb) => { ipcRenderer.on('update:notAvailable', () => cb()); },
  onUpdateError: (cb) => { ipcRenderer.on('update:error', (_e, d) => cb(d)); },

  // 데이터 내보내기/가져오기
  exportData: () => ipcRenderer.invoke('data:export'),
  importData: () => ipcRenderer.invoke('data:import'),
  exportManuscriptsTxt: () => ipcRenderer.invoke('data:export-manuscripts-txt'),
  exportManuscriptSingle: (data) => ipcRenderer.invoke('data:export-manuscript-single', data),
  exportPresetJson: (data) => ipcRenderer.invoke('data:export-preset-json', data),
  importPresetJson: () => ipcRenderer.invoke('data:import-preset-json'),
  deleteAllAccounts: () => ipcRenderer.invoke('accounts:delete-all'),

  // 유틸
  selectImage: () => ipcRenderer.invoke('util:select-image'),
  openExternal: (url) => ipcRenderer.invoke('util:open-external', url),
  getChromePath: () => ipcRenderer.invoke('util:get-chrome-path'),
  // 드래그앤드롭 된 File 객체의 로컬 경로 추출
  // contextBridge를 통해 전달된 File 객체는 프록시일 수 있으므로 여러 방법 시도
  getFilePath: (file) => {
    try {
      // 1차: 내부 File 객체면 path 직접 접근 (Electron 31 이하)
      if (file && typeof file === 'object' && file.path) return file.path;
      // 2차: webUtils.getPathForFile (Electron 32+ 권장 방식)
      const p = webUtils.getPathForFile(file);
      return p || '';
    } catch (e) {
      return '';
    }
  },

  // 이벤트 수신
  onExecutionLog: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('execution:log', listener);
    return () => ipcRenderer.removeListener('execution:log', listener);
  },
  onExecutionProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('execution:progress', listener);
    return () => ipcRenderer.removeListener('execution:progress', listener);
  },
  onExecutionComplete: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('execution:complete', listener);
    return () => ipcRenderer.removeListener('execution:complete', listener);
  },
});
