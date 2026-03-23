const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 계정
  loadAccounts: () => ipcRenderer.invoke('accounts:load'),
  addAccount: (account) => ipcRenderer.invoke('account:add', account),
  updateAccount: (accountId, updates) => ipcRenderer.invoke('account:update', accountId, updates),
  deleteAccount: (accountId) => ipcRenderer.invoke('account:delete', accountId),
  hasCookies: (accountId) => ipcRenderer.invoke('accounts:has-cookies', accountId),
  loginTest: (accountId) => ipcRenderer.invoke('accounts:login-test', accountId),

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

  // 유틸
  selectImage: () => ipcRenderer.invoke('util:select-image'),
  openExternal: (url) => ipcRenderer.invoke('util:open-external', url),
  getChromePath: () => ipcRenderer.invoke('util:get-chrome-path'),

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
