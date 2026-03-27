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
  constructor() {
    super();
    this.runId = 'run-' + Date.now().toString(36);
    this.state = 'idle';
    this.logger = new ResultLogger();
    this._pauseResolve = null;
    this._currentBrowser = null;
  }

  /** 60~100초 랜덤 대기 (작업 간 텀) */
  async randomDelay() {
    const seconds = Math.floor(Math.random() * 41) + 60; // 60~100
    this.log(`다음 작업까지 ${seconds}초 대기...`);
    for (let elapsed = 0; elapsed < seconds; elapsed += 5) {
      if (this.state === 'stopped') return;
      const canCont = await this.waitIfPaused();
      if (!canCont) return;
      const remaining = seconds - elapsed;
      if (remaining > 5) {
        this.log(`대기 중... ${remaining}초 남음`);
      }
      await browserManager.delay(Math.min(5000, remaining * 1000));
    }
    this.log('대기 완료, 다음 작업 진행');
  }

  log(msg) {
    const now = new Date();
    const time = now.toTimeString().slice(0, 8);
    store.appendDailyLog([`[${time}] ${msg}`]);
    this.emit('log', { msg });
  }

  progress(current, total, detail) {
    this.emit('progress', { current, total, detail });
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

  async execute(manuscripts, settings, allAccounts) {
    this.state = 'running';
    this.logger.start(this.runId);

    const enabledMs = manuscripts.filter(m => m.enabled);

    if (enabledMs.length === 0) {
      this.log('실행할 원고가 없습니다.');
      const savedLog = this.logger.save();
      this.state = 'idle';
      this.emit('complete', { log: savedLog });
      return savedLog;
    }

    const totalTasks = enabledMs.length;
    let totalDone = 0;
    let currentLoggedInAccount = null;
    let browser = null;
    let page = null;

    try {
      browser = await browserManager.launchBrowser();
      this._currentBrowser = browser;
      page = await browserManager.createPage(browser);

      for (const ms of enabledMs) {
        if (this.state === 'stopped') break;
        const canCont = await this.waitIfPaused();
        if (!canCont) break;

        const posterAccId = ms.accountId;
        const posterAcc = allAccounts.find(a => a.id === posterAccId);

        if (!posterAcc) {
          this.log(`계정 "${posterAccId}" 없음. 건너뜁니다.`);
          this.logger.addResult({
            manuscriptId: ms.id, accountId: posterAccId, boardName: ms.boardName,
            postTitle: (ms.post || {}).title, postUrl: null, status: 'failed',
            error: '계정 없음', ipAtExecution: null, comments: [],
          });
          totalDone++;
          this.progress(totalDone, totalTasks, `${posterAccId} - 계정 없음`);
          continue;
        }

        // 계정 전환 필요 시
        if (currentLoggedInAccount !== posterAccId) {
          if (settings.ipChange && settings.ipChange.enabled) {
            this.log('IP 변경 시작...');
            try {
              const iface = settings.ipChange.interfaceName || null;
              const newIp = await ipChanger.changeIP(iface, (msg) => this.log(msg));
              this.log(`IP 변경 완료: ${newIp || '확인 불가'}`);
            } catch (e) {
              this.log(`IP 변경 실패: ${e.message}`);
            }
          }

          if (currentLoggedInAccount) {
            await auth.saveCookiesAfterAction(page, currentLoggedInAccount);
          }

          this.log(`${posterAccId} 로그인 시도...`);
          const loginResult = await auth.loginAccount(page, posterAcc.id, posterAcc.password);

          if (!loginResult.success) {
            this.log(`${posterAccId} 로그인 실패`);
            this.logger.addResult({
              manuscriptId: ms.id, accountId: posterAccId, boardName: ms.boardName,
              postTitle: (ms.post || {}).title, postUrl: null, status: 'failed',
              error: '로그인 실패', ipAtExecution: null, comments: [],
            });
            totalDone++;
            this.progress(totalDone, totalTasks, `${posterAccId} - 로그인 실패`);
            continue;
          }

          currentLoggedInAccount = posterAccId;
          this.log(`${posterAccId} 로그인 성공 (${loginResult.method})`);

          // 닉네임 변경 (랜덤 닉네임 > 커스텀 닉네임 > 계정 닉네임)
          const useNickname = ms.randomNickname ? 'random' : (ms.nickname || posterAcc.nickname || null);
          if (useNickname && ms.cafeName) {
            this.log(`닉네임 변경: ${useNickname === 'random' ? '랜덤' : `"${useNickname}"`}`);
            const nickResult = await nicknameChanger.changeNickname(
              page, browser, ms.cafeName || ms.cafeId, useNickname
            );
            if (nickResult.success) {
              this.log(`닉네임 변경 완료: "${nickResult.nickname}"`);
            } else {
              this.log(`닉네임 변경 실패: ${nickResult.error || '알 수 없음'}`);
            }
          }
        }

        const currentIp = await ipChecker.getPublicIP();
        this.log(`게시글 작성: "${(ms.post || {}).title}" → ${ms.boardName}`);

        const resultEntry = {
          manuscriptId: ms.id, accountId: posterAccId, boardName: ms.boardName,
          postTitle: (ms.post || {}).title, postUrl: null, status: 'pending',
          ipAtExecution: currentIp, comments: [],
        };

        try {
          const postUrl = await postWriter.writePost(
            page, ms.cafeId, ms.boardMenuId, (ms.post || {}).title, (ms.post || {}).bodySegments, ms.boardName, ms.visibility
          );
          resultEntry.postUrl = postUrl;
          resultEntry.status = 'success';
          this.log(`게시글 등록 완료: ${postUrl}`);

          // === 댓글 처리 ===
          const isValidPostUrl = postUrl && postUrl.includes('cafe.naver.com') && !postUrl.includes('articles/write');

          if (ms.comments && ms.comments.length > 0 && isValidPostUrl) {
            // 계정 전환 헬퍼
            const switchAccount = async (targetAccId, randomNickname, customNickname) => {
              const hasNicknameChange = randomNickname || (customNickname && customNickname.trim());
              if (targetAccId === currentLoggedInAccount && !hasNicknameChange) return true;
              const targetAcc = allAccounts.find(a => a.id === targetAccId);
              if (!targetAcc) {
                this.log(`계정 "${targetAccId}" 없음. 건너뜁니다.`);
                return false;
              }

              if (targetAccId !== currentLoggedInAccount) {
                if (settings.ipChange && settings.ipChange.enabled) {
                  this.log('댓글 계정 전환 전 IP 변경...');
                  try {
                    const iface = settings.ipChange.interfaceName || null;
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
              }

              // 닉네임 변경 (랜덤 > 커스텀)
              const nickToUse = randomNickname ? 'random' : (customNickname && customNickname.trim() ? customNickname.trim() : null);
              if (nickToUse && ms.cafeName) {
                this.log(`댓글 계정 닉네임 변경: ${nickToUse === 'random' ? '랜덤' : `"${nickToUse}"`}`);
                const nickResult = await nicknameChanger.changeNickname(
                  page, browser, ms.cafeName || ms.cafeId, nickToUse
                );
                if (nickResult.success) {
                  this.log(`닉네임 변경 완료: "${nickResult.nickname}"`);
                } else {
                  this.log(`닉네임 변경 실패: ${nickResult.error || '알 수 없음'}`);
                }
              }

              return true;
            };

            // 댓글 작업 중 실패 시 원고 전체 댓글 중단 플래그
            let commentAborted = false;

            // 대댓글 재귀 처리
            const processReplies = async (replies, parentText, parentResult) => {
              for (const reply of replies) {
                if (this.state === 'stopped' || commentAborted) break;
                const canCont = await this.waitIfPaused();
                if (!canCont) break;

                const replyAccId = reply.accountId || posterAccId;
                const replyResult = { accountId: replyAccId, status: 'pending', replies: [] };

                let replyLoginOk = false;
                try {
                  replyLoginOk = await switchAccount(replyAccId, reply.randomNickname, reply.nickname);
                } catch (switchErr) {
                  this.log(`계정 전환 오류 (${replyAccId}): ${switchErr.message}`);
                }
                if (!replyLoginOk) {
                  replyResult.status = 'failed';
                  replyResult.error = '계정 전환 실패';
                  parentResult.replies.push(replyResult);
                  commentAborted = true;
                  this.log(`댓글 작업 중단 → 다음 원고로 이동`);
                  break;
                }

                try {
                  const replyFrame = await commentWriter.navigateToArticle(page, postUrl);
                  await commentWriter.writeReply(page, replyFrame, parentText, reply.text, reply.imagePath);
                  replyResult.status = 'success';
                  this.log(`대댓글 작성 완료 (${replyAccId}): "${(reply.text || '').substring(0, 20)}"`);
                } catch (replyErr) {
                  replyResult.status = 'failed';
                  replyResult.error = replyErr.message;
                  this.log(`대댓글 작성 실패: ${replyErr.message}`);
                  parentResult.replies.push(replyResult);
                  commentAborted = true;
                  this.log(`댓글 작업 중단 → 다음 원고로 이동`);
                  break;
                }

                await this.randomDelay();

                if (reply.replies && reply.replies.length > 0) {
                  this.log(`하위 대댓글 ${reply.replies.length}개 처리 시작 (parentText: "${(reply.text || '').substring(0, 20)}")`);
                  await processReplies(reply.replies, reply.text, replyResult);
                }

                parentResult.replies.push(replyResult);
              }
            };

            // 댓글 순차 처리
            for (const cmt of ms.comments) {
              if (this.state === 'stopped' || commentAborted) break;
              const cmtAccId = cmt.accountId || posterAccId;
              const cmtResult = { accountId: cmtAccId, status: 'pending', replies: [] };

              const cmtLoginOk = await switchAccount(cmtAccId, cmt.randomNickname, cmt.nickname);
              if (!cmtLoginOk) {
                cmtResult.status = 'failed';
                cmtResult.error = '계정 전환 실패';
                resultEntry.comments.push(cmtResult);
                commentAborted = true;
                this.log(`댓글 작업 중단 → 다음 원고로 이동`);
                break;
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
                commentAborted = true;
                this.log(`댓글 작업 중단 → 다음 원고로 이동`);
                break;
              }

              await this.randomDelay();

              if (cmt.replies && cmt.replies.length > 0) {
                await processReplies(cmt.replies, cmt.text, cmtResult);
              }

              resultEntry.comments.push(cmtResult);
            }

            // 포스팅 계정으로 복귀
            if (currentLoggedInAccount !== posterAccId) {
              this.log(`원래 계정으로 복귀: ${posterAccId}`);
              await auth.saveCookiesAfterAction(page, currentLoggedInAccount);
              await auth.loginAccount(page, posterAcc.id, posterAcc.password);
              currentLoggedInAccount = posterAccId;
            }
          }

          // 게시글 삭제 관리용 저장
          if (resultEntry.postUrl) {
            store.addDeleteEntry({
              accountId: posterAccId,
              postUrl: resultEntry.postUrl,
              postTitle: (ms.post || {}).title,
              boardName: ms.boardName,
            });
          }

        } catch (postErr) {
          resultEntry.status = 'failed';
          resultEntry.error = postErr.message;
          this.log(`게시글 작성 실패: ${postErr.message}`);
        }

        this.logger.addResult(resultEntry);
        totalDone++;
        this.progress(totalDone, totalTasks, `${posterAccId} - ${(ms.post || {}).title}`);
        await browserManager.delay(3000);
      }

      if (currentLoggedInAccount) {
        await auth.saveCookiesAfterAction(page, currentLoggedInAccount);
      }
      await browser.close();
      this._currentBrowser = null;
    } catch (e) {
      this.log(`처리 오류: ${e.message}`);
      if (browser) {
        await browser.close().catch(() => {});
        this._currentBrowser = null;
      }
    }

    const savedLog = this.logger.save();
    this.state = 'idle';
    this.emit('complete', { log: savedLog });
    this.log('=== 실행 완료 ===\n');
    return savedLog;
  }
}

module.exports = Executor;
