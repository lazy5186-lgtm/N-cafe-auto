const IPC = {
  // 계정 관리
  ACCOUNTS_LOAD: 'accounts:load',
  ACCOUNT_ADD: 'account:add',
  ACCOUNT_UPDATE: 'account:update',
  ACCOUNT_DELETE: 'account:delete',
  ACCOUNTS_LOGIN_TEST: 'accounts:login-test',

  // 크롤링
  CRAWL_BOARDS: 'crawl:boards',

  // IP
  IP_CHECK_INTERFACE: 'ip:check-interface',
  IP_CHANGE: 'ip:change',

  // 자동삭제
  DELETE_SCHEDULE_LOAD: 'delete-schedule:load',
  DELETE_SCHEDULE_PROCESS: 'delete-schedule:process',

  // 실행
  EXECUTION_START: 'execution:start',
  EXECUTION_PAUSE: 'execution:pause',
  EXECUTION_RESUME: 'execution:resume',
  EXECUTION_STOP: 'execution:stop',
  EXECUTION_LOG: 'execution:log',
  EXECUTION_PROGRESS: 'execution:progress',
  EXECUTION_COMPLETE: 'execution:complete',

  // 결과
  RESULTS_LOAD_LIST: 'results:load-list',
  RESULTS_LOAD_DETAIL: 'results:load-detail',
  RESULTS_EXPORT_CSV: 'results:export-csv',

  // 유틸
  SELECT_FILE: 'util:select-file',
  SELECT_IMAGE: 'util:select-image',
  OPEN_EXTERNAL: 'util:open-external',
  GET_CHROME_PATH: 'util:get-chrome-path',
};

module.exports = { IPC };
