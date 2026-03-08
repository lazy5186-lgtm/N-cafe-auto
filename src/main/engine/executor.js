const { EventEmitter } = require('events');
const browserManager = require('../core/browser-manager');
const auth = require('../core/auth');
const postWriter = require('../core/post-writer');
const commentWriter = require('../core/comment-writer');
const nicknameChanger = require('../core/nickname-changer');
const ipChecker = require('../core/ip-checker');
const ipChanger = require('../core/ip-changer');
const store = require('../data/store');
const ResultLogger = require('./result-logger');

class Executor extends EventEmitter {
  constructor(accountId) {
    super();
    this.accountId = accountId;
    this.state = 'idle'; // idle, running, paused, stopped
    this.logger = new ResultLogger();
    this._pauseResolve = null;
    this._currentBrowser = null;
  }

  log(msg) {
    this.emit('log', { accountId: this.accountId, msg });
  }

  progress(current, total, detail) {
    this.emit('progress', { accountId: this.accountId, current, total, detail });
  }

  pause() {
    if (this.state === 'running') {
      this.state = 'paused';
      this.log('일시정지됨');
    }
  }

  resume() {
    if (this.state === 'paused') {
      this.state = 'running';
      if (this._pauseResolve) {
        this._pauseResolve();
        this._pauseResolve = null;
      }
      this.log('재개됨');
    }
  }

  stop() {
    this.state = 'stopped';
    if (this._pauseResolve) {
      this._pauseResolve();
      this._pauseResolve = null;
    }
    if (this._currentBrowser) {
      this._currentBrowser.close().catch(() => {});
      this._currentBrowser = null;
    }
    this.log('중지됨');
  }

  async waitIfPaused() {
    if (this.state === 'paused') {
      await new Promise(resolve => { this._pauseResolve = resolve; });
    }
    return this.state !== 'stopped';
  }

  async execute(accountData, allAccounts) {
    this.state = 'running';
    this.logger.start(this.accountId);
    this.emit('started', { accountId: this.accountId });

    const {
      id: accountId, password, cafeId, cafeName, features, nickname,
      ipChangeConfig, manuscripts,
    } = accountData;

    this._allAccounts = allAccounts || [];
    const enabledMs = (manuscripts || []).filter(m => m.enabled);

    // 실행할 작업이 하나도 없으면 조기 종료
    const hasWork = enabledMs.length > 0 ||
                    features.nicknameChange ||
                    features.ipChange ||
                    features.autoDelete;

    if (!hasWork) {
      this.log('실행할 작업이 없습니다. 기능 토글을 확인하세요.');
      const savedLog = this.logger.save();
      this.state = 'idle';
      this.emit('complete', { accountId: this.accountId, log: savedLog });
      return savedLog;
    }

    const totalTasks = enabledMs.length || 1;
    let totalDone = 0;

    // 1. IP 변경 (토글 ON 시)
    if (features.ipChange) {
      this.log('IP 변경 시작...');
      try {
        const iface = ipChangeConfig && ipChangeConfig.interfaceName
          ? ipChangeConfig.interfaceName : null;
        const newIp = await ipChanger.changeIP(iface, (msg) => this.log(msg));
        this.log(`IP 변경 완료: ${newIp || '확인 불가'}`);
      } catch (e) {
        this.log(`IP 변경 실패: ${e.message}`);
      }
    }

    const currentIp = await ipChecker.getPublicIP();
    this.log(`=== ${accountId} 계정 처리 시작 (IP: ${currentIp}) ===`);

    let browser = null;
    try {
      browser = await browserManager.launchBrowser();
      this._currentBrowser = browser;
      const page = await browserManager.createPage(browser);

      // 2. 로그인
      this.log(`${accountId} 로그인 시도...`);
      const loginResult = await auth.loginAccount(page, accountId, password);

      if (!loginResult.success) {
        this.log(`${accountId} 로그인 실패`);
        for (const ms of enabledMs) {
          this.logger.addResult({
            manuscriptId: ms.id, accountId, boardName: ms.boardName,
            postTitle: ms.post.title, postUrl: null, status: 'failed',
            error: '로그인 실패', ipAtExecution: currentIp, comments: [],
          });
          totalDone++;
          this.progress(totalDone, totalTasks, `${accountId} - 로그인 실패`);
        }
        await browser.close();
        this._currentBrowser = null;

        const savedLog = this.logger.save();
        this.state = 'idle';
        this.emit('complete', { accountId: this.accountId, log: savedLog });
        return savedLog;
      }

      this.log(`${accountId} 로그인 성공 (${loginResult.method})`);

      // 3. 닉네임 변경 (토글 ON 시) — cafeName(슬러그)으로 카페 접속
      if (features.nicknameChange && nickname) {
        this.log(`닉네임 변경: "${nickname}"`);
        const nickResult = await nicknameChanger.changeNickname(page, browser, cafeName || cafeId, nickname);
        if (nickResult.success) {
          this.log(`닉네임 변경 완료: ${nickname}`);
        } else {
          this.log(`닉네임 변경 실패: ${nickResult.error || '알 수 없는 오류'}`);
        }
      }

      // 4. 포스팅
      if (enabledMs.length > 0) {
        for (const ms of enabledMs) {
          if (this.state === 'stopped') break;
          const canCont = await this.waitIfPaused();
          if (!canCont) break;

          this.log(`게시글 작성: "${ms.post.title}" → ${ms.boardName}`);
          const resultEntry = {
            manuscriptId: ms.id, accountId, boardName: ms.boardName,
            postTitle: ms.post.title, postUrl: null, status: 'pending',
            ipAtExecution: currentIp, comments: [],
          };

          try {
            const postUrl = await postWriter.writePost(
              page, cafeId, ms.boardMenuId, ms.post.title, ms.post.bodySegments, ms.boardName
            );
            resultEntry.postUrl = postUrl;
            resultEntry.status = 'success';
            this.log(`게시글 등록 완료: ${postUrl}`);

            // 5. 댓글 (토글 ON 시, 입력 순서대로 실행 + 크로스 계정 지원)
            const isValidPostUrl = postUrl && postUrl.includes('cafe.naver.com') && !postUrl.includes('articles/write');
            if (ms.comments && ms.comments.length > 0 && isValidPostUrl) {
              let currentLoggedInAccount = accountId;

              // 계정 전환 헬퍼 (IP 변경 포함)
              const switchAccount = async (targetAccId) => {
                if (targetAccId === currentLoggedInAccount) return true;
                const targetAcc = this._allAccounts.find(a => a.id === targetAccId);
                if (!targetAcc) {
                  this.log(`계정 "${targetAccId}" 없음. 건너뜁니다.`);
                  return false;
                }

                // IP 변경
                if (features.ipChange) {
                  this.log('댓글 계정 전환 전 IP 변경...');
                  try {
                    const iface = ipChangeConfig && ipChangeConfig.interfaceName
                      ? ipChangeConfig.interfaceName : null;
                    const newIp = await ipChanger.changeIP(iface, (msg) => this.log(msg));
                    this.log(`IP 변경 완료: ${newIp || '확인 불가'}`);
                  } catch (e) {
                    this.log(`IP 변경 실패: ${e.message}`);
                  }
                }

                this.log(`계정 전환: ${targetAccId}`);
                await auth.saveCookiesAfterAction(page, currentLoggedInAccount);
                const result = await auth.loginAccount(page, targetAcc.id, targetAcc.password);
                if (!result.success) {
                  this.log(`${targetAccId} 로그인 실패`);
                  return false;
                }
                currentLoggedInAccount = targetAccId;
                this.log(`${targetAccId} 로그인 성공`);
                return true;
              };

              // 입력 순서대로 댓글 → 대댓글 순차 처리
              for (const cmt of ms.comments) {
                if (this.state === 'stopped') break;
                const cmtAccId = cmt.accountId || accountId;
                const cmtResult = { accountId: cmtAccId, status: 'pending', replies: [] };

                // 댓글 계정 전환
                const cmtLoginOk = await switchAccount(cmtAccId);
                if (!cmtLoginOk) {
                  cmtResult.status = 'failed';
                  cmtResult.error = '계정 전환 실패';
                  resultEntry.comments.push(cmtResult);
                  continue;
                }

                try {
                  const frame = await commentWriter.navigateToArticle(page, postUrl);
                  await commentWriter.writeComment(page, frame, cmt.text, cmt.imagePath);
                  cmtResult.status = 'success';
                  this.log(`댓글 작성 완료 (${cmtAccId})`);
                } catch (cmtErr) {
                  cmtResult.status = 'failed';
                  cmtResult.error = cmtErr.message;
                  this.log(`댓글 작성 실패: ${cmtErr.message}`);
                  resultEntry.comments.push(cmtResult);
                  await browserManager.delay(2000);
                  continue;
                }

                await browserManager.delay(2000);

                // 대댓글 순차 처리
                if (cmt.replies && cmt.replies.length > 0) {
                  for (const reply of cmt.replies) {
                    if (this.state === 'stopped') break;
                    const replyAccId = reply.accountId || cmtAccId;
                    const replyResult = { accountId: replyAccId, status: 'pending' };

                    const replyLoginOk = await switchAccount(replyAccId);
                    if (!replyLoginOk) {
                      replyResult.status = 'failed';
                      replyResult.error = '계정 전환 실패';
                      cmtResult.replies.push(replyResult);
                      continue;
                    }

                    try {
                      const replyFrame = await commentWriter.navigateToArticle(page, postUrl);
                      await commentWriter.writeReply(page, replyFrame, cmt.text, reply.text, reply.imagePath);
                      replyResult.status = 'success';
                      this.log(`대댓글 작성 완료 (${replyAccId})`);
                    } catch (replyErr) {
                      replyResult.status = 'failed';
                      replyResult.error = replyErr.message;
                      this.log(`대댓글 작성 실패: ${replyErr.message}`);
                    }

                    cmtResult.replies.push(replyResult);
                    await browserManager.delay(2000);
                  }
                }

                resultEntry.comments.push(cmtResult);
              }

              // 원래 계정으로 복귀 (다음 원고를 위해)
              if (currentLoggedInAccount !== accountId) {
                this.log(`원래 계정으로 복귀: ${accountId}`);
                await auth.saveCookiesAfterAction(page, currentLoggedInAccount);
                await auth.loginAccount(page, accountId, password);
              }
            }

            // 6. 자동삭제 스케줄 등록 (토글 ON 시)
            if (features.autoDelete && ms.autoDeleteDate && isValidPostUrl) {
              store.addDeleteEntry({
                accountId,
                postUrl,
                postTitle: ms.post.title,
                deleteDate: ms.autoDeleteDate,
              });
              this.log(`자동삭제 예약: ${ms.autoDeleteDate} - "${ms.post.title}"`);
            }

          } catch (postErr) {
            resultEntry.status = 'failed';
            resultEntry.error = postErr.message;
            this.log(`게시글 작성 실패: ${postErr.message}`);
          }

          this.logger.addResult(resultEntry);
          totalDone++;
          this.progress(totalDone, totalTasks, `${accountId} - ${ms.post.title}`);
          await browserManager.delay(3000);
        }
      }

      await auth.saveCookiesAfterAction(page, accountId);
      await browser.close();
      this._currentBrowser = null;
    } catch (e) {
      this.log(`${accountId} 처리 오류: ${e.message}`);
      if (browser) {
        await browser.close().catch(() => {});
        this._currentBrowser = null;
      }
    }

    const savedLog = this.logger.save();
    this.state = 'idle';
    this.emit('complete', { accountId: this.accountId, log: savedLog });
    this.log('=== 실행 완료 ===');
    return savedLog;
  }
}

module.exports = Executor;
