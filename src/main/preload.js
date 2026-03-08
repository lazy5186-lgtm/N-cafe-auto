const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 계정 CRUD
  loadAccounts: () => ipcRenderer.invoke('accounts:load'),
  addAccount: (account) => ipcRenderer.invoke('account:add', account),
  updateAccount: (accountId, updates) => ipcRenderer.invoke('account:update', accountId, updates),
  deleteAccount: (accountId) => ipcRenderer.invoke('account:delete', accountId),
  loginTest: (accountId) => ipcRenderer.invoke('accounts:login-test', accountId),

  // 크롤링
  crawlBoards: (cafeId, accountId) => ipcRenderer.invoke('crawl:boards', cafeId, accountId),
  crawlComments: (postUrl, accountId) => ipcRenderer.invoke('crawl:comments', postUrl, accountId),

  // IP
  checkInterface: (interfaceName) => ipcRenderer.invoke('ip:check-interface', interfaceName),
  changeIP: (interfaceName) => ipcRenderer.invoke('ip:change', interfaceName),

  // 자동삭제
  loadDeleteSchedule: () => ipcRenderer.invoke('delete-schedule:load'),
  processDeletes: () => ipcRenderer.invoke('delete-schedule:process'),

  // 실행 (계정별)
  executionStart: (accountId) => ipcRenderer.invoke('execution:start', accountId),
  executionPause: (accountId) => ipcRenderer.invoke('execution:pause', accountId),
  executionResume: (accountId) => ipcRenderer.invoke('execution:resume', accountId),
  executionStop: (accountId) => ipcRenderer.invoke('execution:stop', accountId),

  // 결과
  loadResultsList: () => ipcRenderer.invoke('results:load-list'),
  loadResultDetail: (fileName) => ipcRenderer.invoke('results:load-detail', fileName),
  exportCsv: (fileName) => ipcRenderer.invoke('results:export-csv', fileName),

  // 유틸
  selectImage: () => ipcRenderer.invoke('util:select-image'),
  openExternal: (url) => ipcRenderer.invoke('util:open-external', url),
  getChromePath: () => ipcRenderer.invoke('util:get-chrome-path'),

  // 이벤트 수신 (accountId 포함)
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
