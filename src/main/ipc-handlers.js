const { ipcMain, dialog, shell } = require('electron');
const store = require('./data/store');
const browserManager = require('./core/browser-manager');
const auth = require('./core/auth');
const crawl = require('./core/crawl');
const ipChecker = require('./core/ip-checker');
const ipChanger = require('./core/ip-changer');
const postDeleter = require('./core/post-deleter');
const commentWriter = require('./core/comment-writer');
const Executor = require('./engine/executor');

const executors = new Map(); // accountId -> Executor
let deleteCheckInterval = null;

function registerHandlers(mainWindow) {
  // === 계정 CRUD ===
  ipcMain.handle('accounts:load', () => store.loadAccounts());

  ipcMain.handle('account:add', (_e, account) => {
    const newAccount = {
      id: account.id,
      password: account.password,
      cafeId: account.cafeId || '',
      cafeName: account.cafeName || '',
      features: {
        posting: true,
        comment: true,
        ipChange: false,
        nicknameChange: false,
        autoDelete: false,
      },
      nickname: '',
      ipChangeConfig: { interfaceName: '' },
      boards: [],
      manuscripts: [],
      standaloneComments: [],
    };
    const ok = store.addAccount(newAccount);
    return { success: ok };
  });

  ipcMain.handle('account:update', (_e, accountId, updates) => {
    const ok = store.updateAccount(accountId, updates);
    return { success: ok };
  });

  ipcMain.handle('account:delete', (_e, accountId) => {
    // 실행 중이면 중지
    if (executors.has(accountId)) {
      executors.get(accountId).stop();
      executors.delete(accountId);
    }
    const ok = store.deleteAccount(accountId);
    return { success: ok };
  });

  ipcMain.handle('accounts:login-test', async (_e, accountId) => {
    const account = store.getAccount(accountId);
    if (!account) return { success: false, error: '계정을 찾을 수 없습니다' };

    let browser = null;
    try {
      browser = await browserManager.launchBrowser();
      const page = await browserManager.createPage(browser);
      const result = await auth.loginAccount(page, account.id, account.password);

      if (result.success) {
        const cookies = await page.cookies();
        store.saveCookies(account.id, cookies);
      }

      await browser.close();
      return { success: result.success, method: result.method };
    } catch (e) {
      if (browser) await browser.close().catch(() => {});
      return { success: false, error: e.message };
    }
  });

  // === 크롤링 ===
  ipcMain.handle('crawl:boards', async (_e, cafeName, accountId) => {
    let browser = null;
    try {
      // accountId가 지정되면 해당 계정 쿠키 사용, 아니면 첫 번째 계정
      let targetAccountId = accountId;
      if (!targetAccountId) {
        const accounts = store.loadAccounts();
        if (accounts.length === 0) return { success: false, error: '계정이 없습니다.' };
        targetAccountId = accounts[0].id;
      }

      const cookies = store.loadCookies(targetAccountId);
      if (!cookies) return { success: false, error: `${targetAccountId} 계정의 쿠키가 없습니다. 먼저 로그인 테스트를 실행하세요.` };

      browser = await browserManager.launchBrowser();
      const page = await browserManager.createPage(browser);
      await page.setCookie(...cookies);

      // cafeName이 슬러그면 숫자 ID를 자동 추출
      const existingAccount = accountId ? store.getAccount(accountId) : null;
      const existingCafeId = existingAccount ? existingAccount.cafeId : '';
      const result = await crawl.crawlBoards(page, existingCafeId || cafeName, cafeName);
      await browser.close();

      // 추출된 숫자 ID를 계정에 저장
      if (result.cafeId && accountId) {
        store.updateAccount(accountId, { cafeId: result.cafeId });
      }

      store.saveCrawlCache(cafeName, result);

      return { success: true, ...result };
    } catch (e) {
      if (browser) await browser.close().catch(() => {});
      return { success: false, error: e.message };
    }
  });

  // === 댓글 크롤링 ===
  ipcMain.handle('crawl:comments', async (_e, postUrl, accountId) => {
    let browser = null;
    try {
      let targetAccountId = accountId;
      if (!targetAccountId) {
        const accounts = store.loadAccounts();
        if (accounts.length === 0) return { success: false, error: '계정이 없습니다.' };
        targetAccountId = accounts[0].id;
      }

      const cookies = store.loadCookies(targetAccountId);
      if (!cookies) return { success: false, error: `${targetAccountId} 계정의 쿠키가 없습니다. 먼저 로그인 테스트를 실행하세요.` };

      browser = await browserManager.launchBrowser();
      const page = await browserManager.createPage(browser);
      await page.setCookie(...cookies);

      const frame = await commentWriter.navigateToArticle(page, postUrl);
      const comments = await commentWriter.crawlComments(frame);

      await browser.close();
      return { success: true, comments };
    } catch (e) {
      if (browser) await browser.close().catch(() => {});
      return { success: false, error: e.message };
    }
  });

  // === IP ===
  ipcMain.handle('ip:check-interface', (_e, interfaceName) => {
    return ipChanger.checkInterface(interfaceName);
  });

  ipcMain.handle('ip:change', async (_e, interfaceName) => {
    try {
      const newIp = await ipChanger.changeIP(interfaceName || null);
      return { success: true, ip: newIp };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // === 자동삭제 ===
  ipcMain.handle('delete-schedule:load', () => store.loadDeleteSchedule());

  ipcMain.handle('delete-schedule:process', async () => {
    try {
      const results = await postDeleter.processDueDeletes(browserManager, auth, (msg) => {
        mainWindow.webContents.send('execution:log', { accountId: '__system__', msg });
      });
      return { success: true, results };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // 60초마다 자동삭제 체크
  deleteCheckInterval = setInterval(async () => {
    const due = store.getDueDeletes();
    if (due.length > 0) {
      try {
        await postDeleter.processDueDeletes(browserManager, auth, (msg) => {
          mainWindow.webContents.send('execution:log', { accountId: '__system__', msg });
        });
      } catch (e) {
        console.error('자동삭제 체크 오류:', e.message);
      }
    }
  }, 60000);

  // === 실행 (계정별) ===
  ipcMain.handle('execution:start', async (_e, accountId) => {
    if (executors.has(accountId) && executors.get(accountId).state === 'running') {
      return { success: false, error: '이미 실행 중입니다' };
    }

    const account = store.getAccount(accountId);
    if (!account) return { success: false, error: '계정을 찾을 수 없습니다' };

    const allAccounts = store.loadAccounts();
    const executor = new Executor(accountId);

    executor.on('log', (data) => {
      mainWindow.webContents.send('execution:log', data);
    });

    executor.on('progress', (data) => {
      mainWindow.webContents.send('execution:progress', data);
    });

    executor.on('complete', (data) => {
      mainWindow.webContents.send('execution:complete', data);
      executors.delete(accountId);
    });

    executors.set(accountId, executor);

    executor.execute(account, allAccounts).catch(e => {
      mainWindow.webContents.send('execution:log', { accountId, msg: `실행 오류: ${e.message}` });
      executors.delete(accountId);
    });

    return { success: true };
  });

  ipcMain.handle('execution:pause', (_e, accountId) => {
    const ex = executors.get(accountId);
    if (ex) { ex.pause(); return { success: true }; }
    return { success: false };
  });

  ipcMain.handle('execution:resume', (_e, accountId) => {
    const ex = executors.get(accountId);
    if (ex) { ex.resume(); return { success: true }; }
    return { success: false };
  });

  ipcMain.handle('execution:stop', (_e, accountId) => {
    const ex = executors.get(accountId);
    if (ex) { ex.stop(); executors.delete(accountId); return { success: true }; }
    return { success: false };
  });

  // === 결과 ===
  ipcMain.handle('results:load-list', () => store.listExecutionLogs());

  ipcMain.handle('results:load-detail', (_e, fileName) => store.loadExecutionLog(fileName));

  ipcMain.handle('results:export-csv', async (_e, fileName) => {
    const log = store.loadExecutionLog(fileName);
    if (!log || !log.results) return { success: false };

    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `${log.executionId}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });

    if (!filePath) return { success: false, cancelled: true };

    const fs = require('fs');
    const header = '계정,게시판,제목,URL,상태,시간,IP\n';
    const rows = log.results.map(r =>
      `"${r.accountId}","${r.boardName}","${r.postTitle}","${r.postUrl || ''}","${r.status}","${r.timestamp}","${r.ipAtExecution || ''}"`
    ).join('\n');

    fs.writeFileSync(filePath, '\uFEFF' + header + rows, 'utf8');
    return { success: true, filePath };
  });

  // === 유틸 ===
  ipcMain.handle('util:select-image', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('util:open-external', (_e, url) => {
    shell.openExternal(url);
    return { success: true };
  });

  ipcMain.handle('util:get-chrome-path', () => {
    return browserManager.findChromePath();
  });
}

function cleanup() {
  if (deleteCheckInterval) {
    clearInterval(deleteCheckInterval);
    deleteCheckInterval = null;
  }
  for (const [, ex] of executors) {
    ex.stop();
  }
  executors.clear();
}

module.exports = { registerHandlers, cleanup };
