const { ipcMain, dialog, shell, app } = require('electron');
const { autoUpdater } = require('electron-updater');
const store = require('./data/store');
const browserManager = require('./core/browser-manager');
const auth = require('./core/auth');
const crawl = require('./core/crawl');
const ipChanger = require('./core/ip-changer');
const adbHelper = require('./core/adb-helper');
const postDeleter = require('./core/post-deleter');
const commentWriter = require('./core/comment-writer');
const postLiker = require('./core/post-liker');
const Executor = require('./engine/executor');
const nicknameGenerator = require('./core/nickname-generator');

let globalExecutor = null;
let deleteCheckInterval = null;
let likeAbortFlag = false;

function registerHandlers(mainWindow) {
  // === 계정 CRUD ===
  ipcMain.handle('accounts:load', () => store.loadAccounts());

  ipcMain.handle('account:add', (_e, account) => {
    const ok = store.addAccount({
      id: account.id,
      password: account.password,
      nickname: '',
    });
    return { success: ok };
  });

  ipcMain.handle('account:update', (_e, accountId, updates) => {
    const ok = store.updateAccount(accountId, updates);
    return { success: ok };
  });

  ipcMain.handle('account:delete', (_e, accountId) => {
    const ok = store.deleteAccount(accountId);
    return { success: ok };
  });

  ipcMain.handle('accounts:has-cookies', (_e, accountId) => {
    const cookies = store.loadCookies(accountId);
    return !!(cookies && cookies.length > 0);
  });

  // IP 변경 헬퍼 (상태를 renderer로 전송)
  async function changeIPWithStatus(label) {
    const s = store.loadSettings();
    if (!(s.ipChange && s.ipChange.enabled)) return null;
    mainWindow.webContents.send('ip:status', { msg: `${label} — IP 변경 중...` });
    try {
      const newIp = await ipChanger.changeIP(null);
      mainWindow.webContents.send('ip:status', { msg: `${label} — IP: ${newIp || '확인 불가'}` });
      return newIp;
    } catch (e) {
      mainWindow.webContents.send('ip:status', { msg: `${label} — IP 변경 실패` });
      return null;
    }
  }

  ipcMain.handle('accounts:login-test', async (_e, accountId) => {
    const account = store.getAccount(accountId);
    if (!account) return { success: false, error: '계정을 찾을 수 없습니다' };

    let browser = null;
    try {
      await changeIPWithStatus(`로그인 테스트 (${accountId})`);

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

  // === 설정 (글로벌) ===
  ipcMain.handle('settings:load', () => store.loadSettings());
  ipcMain.handle('settings:save', (_e, settings) => {
    store.saveSettings(settings);
    return { success: true };
  });

  // === 닉네임 단어 ===
  ipcMain.handle('nickname-words:load', () => {
    const custom = store.loadNicknameWords();
    return {
      adjectives: custom.adjectives && custom.adjectives.length > 0 ? custom.adjectives : [],
      nouns: custom.nouns && custom.nouns.length > 0 ? custom.nouns : [],
      defaultAdjectives: nicknameGenerator.defaultAdjectives,
      defaultNouns: nicknameGenerator.defaultNouns,
    };
  });

  ipcMain.handle('nickname-words:save', (_e, data) => {
    store.saveNicknameWords({ adjectives: data.adjectives || [], nouns: data.nouns || [] });
    nicknameGenerator.setCustomWords(data.adjectives, data.nouns);
    return { success: true };
  });

  // === 원고 (글로벌) ===
  ipcMain.handle('manuscripts:load', () => store.loadGlobalManuscripts());
  ipcMain.handle('manuscripts:save', (_e, data) => {
    store.saveGlobalManuscripts(data);
    return { success: true };
  });

  // === 가입 카페 목록 ===
  ipcMain.handle('cafes:joined', async (_e, accountId) => {
    try {
      await changeIPWithStatus(`카페 목록 (${accountId})`);
      const cafes = await crawl.fetchJoinedCafes(accountId);
      return { success: true, cafes };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // === 크롤링 ===
  ipcMain.handle('crawl:boards', async (_e, cafeName, accountId) => {
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

      const result = await crawl.crawlBoards(page, cafeName, cafeName);
      await browser.close();

      store.saveCrawlCache(cafeName, result);
      return { success: true, ...result };
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

  // === ADB ===
  ipcMain.handle('adb:check-device', async (_e, deviceId) => {
    try {
      const status = await adbHelper.checkDeviceStatus(deviceId || null);
      return { success: true, ...status };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // === 삭제 관리 ===
  ipcMain.handle('delete-schedule:load', () => store.loadDeleteSchedule());

  ipcMain.handle('delete-schedule:remove', (_e, postUrls) => {
    store.removeDeleteEntries(postUrls);
    return { success: true };
  });

  ipcMain.handle('delete-schedule:delete-posts', async (_e, postUrls) => {
    let browser = null;
    const results = [];
    try {
      // 삭제할 항목을 계정별로 그룹핑
      const schedule = store.loadDeleteSchedule();
      const targets = schedule.filter(e => postUrls.includes(e.postUrl));
      const grouped = {};
      for (const entry of targets) {
        if (!grouped[entry.accountId]) grouped[entry.accountId] = [];
        grouped[entry.accountId].push(entry);
      }

      browser = await browserManager.launchBrowser();
      const page = await browserManager.createPage(browser);

      const settings = store.loadSettings();

      for (const [accountId, entries] of Object.entries(grouped)) {
        const account = store.getAccount(accountId);
        if (!account) {
          for (const entry of entries) {
            store.updateDeleteEntry(entry.postUrl, { status: 'failed', error: '계정 없음' });
            results.push({ postUrl: entry.postUrl, status: 'failed', error: '계정 없음' });
          }
          continue;
        }

        // IP 변경
        if (settings.ipChange && settings.ipChange.enabled) {
          try {
            const iface = settings.ipChange.interfaceName || null;
            const newIp = await ipChanger.changeIP(iface);
            mainWindow.webContents.send('execution:log', { msg: `IP 변경 완료: ${newIp || '확인 불가'}` });
          } catch (e) {
            mainWindow.webContents.send('execution:log', { msg: `IP 변경 실패: ${e.message}` });
          }
        }

        const loginResult = await auth.loginAccount(page, account.id, account.password);
        if (!loginResult.success) {
          for (const entry of entries) {
            store.updateDeleteEntry(entry.postUrl, { status: 'failed', error: '로그인 실패' });
            results.push({ postUrl: entry.postUrl, status: 'failed', error: '로그인 실패' });
          }
          continue;
        }

        for (const entry of entries) {
          try {
            await postDeleter.deletePost(page, entry.postUrl);
            store.updateDeleteEntry(entry.postUrl, { status: 'deleted', deletedAt: new Date().toISOString() });
            results.push({ postUrl: entry.postUrl, status: 'deleted' });
            mainWindow.webContents.send('execution:log', { msg: `삭제 완료: ${entry.postTitle || entry.postUrl}` });
          } catch (e) {
            store.updateDeleteEntry(entry.postUrl, { status: 'failed', error: e.message });
            results.push({ postUrl: entry.postUrl, status: 'failed', error: e.message });
            mainWindow.webContents.send('execution:log', { msg: `삭제 실패: ${entry.postTitle || entry.postUrl} - ${e.message}` });
          }
        }
      }

      await browser.close();
      return { success: true, results };
    } catch (e) {
      if (browser) await browser.close().catch(() => {});
      return { success: false, error: e.message };
    }
  });

  // === 실행 (글로벌) ===
  ipcMain.handle('execution:start', async () => {
    if (globalExecutor && globalExecutor.state === 'running') {
      return { success: false, error: '이미 실행 중입니다' };
    }

    const accounts = store.loadAccounts();
    const settings = store.loadSettings();
    const { manuscripts } = store.loadGlobalManuscripts();

    globalExecutor = new Executor();

    globalExecutor.on('log', (data) => {
      mainWindow.webContents.send('execution:log', data);
    });
    globalExecutor.on('progress', (data) => {
      mainWindow.webContents.send('execution:progress', data);
    });
    globalExecutor.on('complete', (data) => {
      mainWindow.webContents.send('execution:complete', data);
      globalExecutor = null;
    });

    globalExecutor.execute(manuscripts, settings, accounts).catch(e => {
      mainWindow.webContents.send('execution:log', { msg: `실행 오류: ${e.message}` });
      globalExecutor = null;
    });

    return { success: true };
  });

  ipcMain.handle('execution:pause', () => {
    if (globalExecutor) { globalExecutor.pause(); return { success: true }; }
    return { success: false };
  });

  ipcMain.handle('execution:resume', () => {
    if (globalExecutor) { globalExecutor.resume(); return { success: true }; }
    return { success: false };
  });

  ipcMain.handle('execution:stop', () => {
    if (globalExecutor) { globalExecutor.stop(); globalExecutor = null; return { success: true }; }
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

  // === 좋아요 ===
  ipcMain.handle('like:fetch-articles', async (_e, accountId, cafeId) => {
    await changeIPWithStatus(`게시글 불러오기 (${accountId})`);

    const cookies = store.loadCookies(accountId);
    if (!cookies || cookies.length === 0) {
      // 쿠키 없으면 바로 로그인 시도
      const account = store.getAccount(accountId);
      if (!account) return { success: false, error: '계정 정보가 없습니다. 계정을 등록하세요.' };

      let browser = null;
      try {
        browser = await browserManager.launchBrowser();
        const page = await browserManager.createPage(browser);
        console.log(`${accountId} 쿠키 없음, 직접 로그인 시도...`);
        const loginResult = await auth.loginAccount(page, account.id, account.password);
        if (!loginResult.success) {
          await browser.close();
          return { success: false, error: '로그인 실패. 계정 정보를 확인하세요.' };
        }
        console.log(`${accountId} 로그인 성공`);
        await page.goto('https://cafe.naver.com', { waitUntil: 'domcontentloaded', timeout: 15000 });
        await browserManager.delay(1000);

        const keyResult = await postLiker.fetchMemberKey(page, cafeId);
        if (keyResult.error || !keyResult.memberKey) {
          await browser.close();
          return { success: false, error: `memberKey 조회 실패: ${keyResult.error || '찾을 수 없음'}` };
        }
        console.log('memberKey:', keyResult.memberKey);

        const artResult = await postLiker.fetchMemberArticles(page, cafeId, keyResult.memberKey, 1, 50);
        await browser.close();

        if (artResult.error) {
          return { success: false, error: artResult.error };
        }
        return { success: true, articles: artResult.articles, totalCount: artResult.totalCount, memberKey: keyResult.memberKey };
      } catch (e) {
        if (browser) await browser.close().catch(() => {});
        return { success: false, error: e.message };
      }
    }

    let browser = null;
    try {
      browser = await browserManager.launchBrowser();
      const page = await browserManager.createPage(browser);
      await page.setCookie(...cookies);

      // 네이버 도메인 진입
      await page.goto('https://cafe.naver.com', { waitUntil: 'domcontentloaded', timeout: 15000 });
      await browserManager.delay(1000);

      // memberKey 조회
      let keyResult = await postLiker.fetchMemberKey(page, cafeId);

      // memberKey 실패 시 (쿠키 만료) → 재로그인 후 재시도
      if (keyResult.error || !keyResult.memberKey) {
        console.log(`${accountId} memberKey 조회 실패, 재로그인 시도...`);
        const account = store.getAccount(accountId);
        if (account) {
          const loginResult = await auth.loginAccount(page, account.id, account.password);
          if (loginResult.success) {
            console.log(`${accountId} 재로그인 성공 (${loginResult.method})`);
            await page.goto('https://cafe.naver.com', { waitUntil: 'domcontentloaded', timeout: 15000 });
            await browserManager.delay(1000);
            keyResult = await postLiker.fetchMemberKey(page, cafeId);
          }
        }
      }

      if (keyResult.error || !keyResult.memberKey) {
        await browser.close();
        let errMsg = `memberKey 조회 실패: ${keyResult.error || '찾을 수 없음'}`;
        if (keyResult.debug) errMsg += '\n응답: ' + keyResult.debug;
        console.log(errMsg);
        return { success: false, error: errMsg };
      }
      console.log('memberKey:', keyResult.memberKey);

      // 게시글 목록 조회 (최대 50개)
      const artResult = await postLiker.fetchMemberArticles(page, cafeId, keyResult.memberKey, 1, 50);
      await browser.close();

      if (artResult.error) {
        let errMsg = artResult.error;
        if (artResult.sample) errMsg += '\n응답: ' + artResult.sample;
        if (artResult.deepKeys) errMsg += '\n키: ' + artResult.deepKeys;
        console.log('게시글 조회 실패:', errMsg);
        return { success: false, error: errMsg };
      }

      return { success: true, articles: artResult.articles, totalCount: artResult.totalCount, memberKey: keyResult.memberKey };
    } catch (e) {
      if (browser) await browser.close().catch(() => {});
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('like:execute', async (_e, config) => {
    // config: { targetArticles: [{articleId, subject, cafeName, cafeId}], likerAccountIds: [], randomMode: boolean, likeCount: number, settings }
    likeAbortFlag = false;
    let browser = null;

    try {
      const allSettings = store.loadSettings();
      browser = await browserManager.launchBrowser();
      const page = await browserManager.createPage(browser);

      const { targetArticles, likerAccountIds, randomMode, likeCount } = config;

      // 좋아요 누를 계정 목록 생성
      let likerQueue = [];
      if (randomMode) {
        // 랜덤 모드: likerAccountIds에서 likeCount만큼 랜덤 선택 (중복 허용하지 않음)
        const shuffled = [...likerAccountIds].sort(() => Math.random() - 0.5);
        likerQueue = shuffled.slice(0, Math.min(likeCount, shuffled.length));
      } else {
        likerQueue = likerAccountIds.slice(0, likeCount);
      }

      const totalWork = targetArticles.length * likerQueue.length;
      let done = 0;

      mainWindow.webContents.send('like:log', { msg: `좋아요 시작: ${targetArticles.length}개 게시글 × ${likerQueue.length}개 계정` });

      for (const article of targetArticles) {
        if (likeAbortFlag) break;

        const articleUrl = `https://cafe.naver.com/${article.cafeName}/${article.articleId}`;
        mainWindow.webContents.send('like:log', { msg: `게시글: "${article.subject}"` });

        for (const likerId of likerQueue) {
          if (likeAbortFlag) break;

          const account = store.getAccount(likerId);
          if (!account) {
            mainWindow.webContents.send('like:log', { msg: `계정 "${likerId}" 없음, 건너뜀` });
            done++;
            mainWindow.webContents.send('like:progress', { current: done, total: totalWork });
            continue;
          }

          // IP 변경
          if (allSettings.ipChange && allSettings.ipChange.enabled) {
            try {
              const iface = allSettings.ipChange.interfaceName || null;
              const newIp = await ipChanger.changeIP(iface);
              mainWindow.webContents.send('like:log', { msg: `IP 변경: ${newIp || '확인 불가'}` });
            } catch (e) {
              mainWindow.webContents.send('like:log', { msg: `IP 변경 실패: ${e.message}` });
            }
          }

          // 로그인
          mainWindow.webContents.send('like:log', { msg: `${likerId} 로그인...` });
          const loginResult = await auth.loginAccount(page, account.id, account.password);
          if (!loginResult.success) {
            mainWindow.webContents.send('like:log', { msg: `${likerId} 로그인 실패` });
            done++;
            mainWindow.webContents.send('like:progress', { current: done, total: totalWork });
            continue;
          }

          // 좋아요 클릭
          try {
            const likeResult = await postLiker.likePost(page, articleUrl);
            if (likeResult.alreadyLiked) {
              mainWindow.webContents.send('like:log', { msg: `${likerId}: 이미 좋아요 누름` });
            } else {
              mainWindow.webContents.send('like:log', { msg: `${likerId}: 좋아요 완료` });
            }
          } catch (e) {
            mainWindow.webContents.send('like:log', { msg: `${likerId}: 좋아요 실패 - ${e.message}` });
          }

          done++;
          mainWindow.webContents.send('like:progress', { current: done, total: totalWork });

          // 계정 간 대기
          if (!likeAbortFlag) {
            await browserManager.delay(2000 + Math.random() * 3000);
          }
        }
      }

      await browser.close();
      mainWindow.webContents.send('like:complete', { success: true });
      return { success: true };
    } catch (e) {
      if (browser) await browser.close().catch(() => {});
      mainWindow.webContents.send('like:complete', { success: false, error: e.message });
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('like:stop', () => {
    likeAbortFlag = true;
    return { success: true };
  });

  // === 업데이트 ===
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('app:check-update', async () => {
    try {
      await autoUpdater.checkForUpdates();
      return { checking: true };
    } catch (e) {
      return { error: e.message };
    }
  });
  ipcMain.handle('app:install-update', () => {
    autoUpdater.quitAndInstall();
  });

  // === 유틸 ===
  ipcMain.handle('util:select-image', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'jpe', 'jfif', 'pjpeg', 'png', 'apng', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'ico', 'svg', 'svgz', 'heic', 'heif', 'avif', 'jxl', 'xbm', 'pip'] }],
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
  if (globalExecutor) {
    globalExecutor.stop();
    globalExecutor = null;
  }
}

module.exports = { registerHandlers, cleanup };
