# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

N Cafe Auto is an Electron desktop application for automating Naver Cafe post and comment management. The UI is entirely in Korean. It uses Puppeteer-core for browser automation against Naver Cafe's web interface.

## Commands

```bash
npm start        # Launch the Electron app in dev mode
npm run build    # Build protected + Windows installer (NSIS) via electron-builder → output in dist/
```

- `npm run build:protect` — Code obfuscation/bytenode compilation → `dist-src/`
- `npm run build` runs `build:protect` then `electron-builder --project dist-src`

There are no tests or linting configured.

## Repository

- **GitHub**: https://github.com/lazy5186-lgtm/N-cafe-auto (public — required for auto-update)
- **Auto-update**: `electron-updater` + GitHub Releases (event-based, auto-download)
- **Current version**: 1.8.15

## Architecture

**Electron two-process model** with strict context isolation (`contextIsolation: true`, `nodeIntegration: false`).

### Main Process (`src/main/`)
- `index.js` — **Thin bootstrap** (v1.8.6): picks which code to run (bundled vs code-swap update) and requires `app-main.js`. Plain JS, NOT bytenode-compiled (always-loadable fallback anchor). `package.json` `main` points here. Adds bundled `node_modules` to the module search path so code-swapped versions (which ship without `node_modules`) can resolve `bytenode`/`puppeteer-core`/`electron-updater`. See Code-Swap Auto-Update section.
- `app-main.js` — **Real app entry** (was `index.js` pre-1.8.6): creates BrowserWindow, electron-updater setup (event-based), code-swap check (`setupCodeUpdater`), data migration (V1 + V2), loads custom nickname words on startup
- `preload.js` — Context bridge exposing `window.api` to renderer via IPC (incl. `api.upd.*` code-swap channels)
- `ipc-handlers.js` — Registers all `ipcMain.handle()` routes, `safeSend()` helper for destroyed window safety, `changeIPWithStatus()` helper, global execution (single Executor), delete management with IP change, results export (CSV with BOM)

**Core modules** (`src/main/core/`):
- `browser-manager.js` — Chrome launch (`puppeteer.launch` with `ignoreDefaultArgs: true` + curated `CHROME_ARGS`, self-picked debugging port), **per-account persistent profile** (`launchBrowser(null, { log, accountId })`), hidden-window mode for `settings.headless`, page creation, Chrome path detection. **No fingerprint spoofing** (see Key Patterns)
- `auth.js` — Naver login: profile session → stored cookies → typed ID/PW (human-paced), captcha wait for a human (headed only), cookie save for www/nid/cafe domains, `restoreSession()` for login-less flows
- `crawl.js` — Board list via `SideMenuList` API (API-first with 3 fallback strategies: SPA, old frames, write page dropdown), board deduplication + numeric filtering, joined cafes via `cafe-home/v1/cafes/join` API
- `post-writer.js` — Post creation: **board select first** → template detection via `waitForFunction` → `execCommand('insertText')` for body → title → visibility → submit with retry, **returns postUrl**
- `comment-writer.js` — Comment automation (writeComment, writeReply with text-match targeting), image upload via `page.waitForFileChooser()` + `frame.evaluate(label.click())` for headless compatibility, comment crawling
- `post-deleter.js` — Post deletion (searches all frames for delete button, handles browser confirm() dialog)
- `nickname-changer.js` — Cafe nickname changes (popup or direct URL), supports random mode with duplicate retry (5 attempts)
- `nickname-generator.js` — Random nickname generation (customizable adjectives × nouns), `setCustomWords()` for user overrides
- `ip-changer.js` — IP change dispatcher: ADB (default) or netsh, polling-based IP check (~2-3s), skips old IP check for speed
- `ip-checker.js` — Public IP detection via external APIs
- `adb-helper.js` — ADB device detection, mobile data toggle (`svc data disable/enable`), bundled ADB binaries
- `post-liker.js` — Post like automation (`likePost` with verification), member article list (`fetchMemberArticles` via `CafeMemberNetworkArticleListV3` API), memberKey extraction (5-stage strategy), author skip via edit/delete button detection

**Engine** (`src/main/engine/`):
- `executor.js` — Global orchestration: iterates all enabled manuscripts, switches accounts as needed (browser restart + IP change per account switch), handles cross-account comments/replies recursively, comment abort on failure (`commentAborted` flag), per-manuscript random nickname, **random account selection** (`ms.randomAccount` for poster, `item.randomAccount` for each comment/reply — excludes post author), pause/resume/stop via EventEmitter, configurable random delay between comments/replies via `settings.commentDelay`. **원고의 댓글 처리가 끝나도 게시자 계정으로 되돌리지 않는다** (2026-09-17): 예전엔 복귀 전용으로 브라우저 재시작 + 재로그인을 했는데 그 경로에만 IP 변경이 빠져 있어 **마지막 댓글 계정과 게시자가 같은 IP를 공유**했다(계정끼리 묶이는 신호). 복귀 블록은 뒤에 page 를 쓰는 코드가 없어 애초에 불필요했고, 제거하면 다음 원고 시작에서 계정 불일치가 감지돼 IP 변경 → 재시작 → 로그인이 정상 경로로 한 번에 처리된다
- `scheduler.js` — Scheduled publishing: 30s polling, runs manuscripts whose `scheduledAt` is due. **Past-due grace window: 2 min** — anything older marked `expired` (PC/app was off). Skips when manual execution is running. Status flow: `pending` → `running` → `executed`/`failed`/`expired`. Scheduled manuscripts run regardless of `enabled` flag.
- `task-queue.js` — Generic task queue with state management (idle/running/paused/stopped), EventEmitter-based progress tracking, `waitIfPaused()` for cooperative pause/resume
- `result-logger.js` — Timestamped execution log tracking

**Shared** (`src/shared/`):
- `constants.js` — Centralized IPC channel name constants (`IPC` object)

**Data layer** (`src/main/data/store.js`):
- All persistence is JSON files in `data/` directory (no database)
- In dev: `data/` at project root. In production: `app.getPath('userData')/data` (user's AppData folder)
- Files: `accounts.json`, `settings.json`, `global-manuscripts.json`, `delete-schedule.json`, `nickname-words.json`
- Subdirectories: `cookies/`, `crawl-cache/`, `logs/`, `preset-images/`
- **Chrome profiles are NOT in `data/`**: `%LOCALAPPDATA%/n-cafe-auto/profiles/<accountId>` (browser state; kept out of Roaming/OneDrive). Shared by dev and installed app. Removed on `account:delete` / `accounts:delete-all` (`removeProfile`).
- **Image portability** (v1.8.2): manuscript/preset images referenced external paths (Downloads/KakaoTalk), which Windows Storage Sense deletes after ~30 days → presets lost images. Now images are made self-contained:
  - `localizeImages(payload, stamp)` — copies external image files into `preset-images/` and rewrites paths (idempotent: skips paths already in app folder or missing). Called on every `manuscripts:save` (returns `{oldPath: newPath}` map so renderer + editor DOM stay in sync).
  - `migrateLocalizeImages()` — startup rescue: localizes existing data while originals still exist (run in `index.js` after V1/V2 migrations).
  - `embedImages(manuscripts)` / `materializeImages(manuscripts, images, stamp)` — for cross-PC sharing: export embeds image bytes as base64 in `_images`; import writes them to `preset-images/` and rewrites paths. Used by `data:export`/`data:import` and `data:export-preset-json`/`data:import-preset-json`.
  - `forEachImageRef(manuscripts, fn)` — walks all image refs (`post.bodySegments[].filePath` + `comments/replies[].imagePath` recursively).
  - **Limitation**: if the original was already deleted before v1.8.2 ran, the image is unrecoverable (must re-add once).

### Renderer Process (`src/renderer/`)
- `index.html` — Single-page UI with 5 global tabs (설정/원고/실행/삭제/좋아요) + 단축키. Manuscript editor includes per-manuscript `예약 발행` datetime input. Searchable dropdowns are **not** in the markup — `SearchCombo` builds them at runtime next to the plain `<select>` (see below).
- `app.js` — Global tab controller: settings (accounts with persistent login `testStatus` + filter buttons "미테스트만 테스트" / "실패만 재테스트" / "전체 로그인 테스트", **per-row checkbox + header select-all for "진단용 쿠키 내보내기" (selected accounts only)**, IP, headless, nickname words, comment delay), manuscript list/editor with scheduled publish + random account, execution controls with results/CSV export, delete management, like tab, shortcut system, version display + update check, toast notifications (replaces `alert()`)
- `components/search-combo.js` — **`SearchCombo`**: searchable dropdown shared by every long list (v1.8.9; generalized from the v1.8.7 cafe-only combobox). `SearchCombo.attach(selectEl, {placeholder, searchPlaceholder, emptyText, actionValues, rootStyle, wide, sort})` hides the `<select>` (`display:none`) and inserts a `.combo` widget after it; the select stays the **single source of value/`change` events**, so existing readers (`collectMsData`), `change` listeners and `innerHTML` option rebuilds keep working untouched. A `MutationObserver` on the select (childList + `disabled`/`style`) re-syncs the label automatically, so a re-render only needs `SearchCombo.attach()` again (idempotent) or `SearchCombo.refresh(select)`. Applied to: 카페(`#ms-cafe-select`), 프리셋(`#preset-select`, with `actionValues: ['__browse__']` pinning 찾아보기 to the bottom), 게시 계정(`#ms-account`), 댓글/대댓글 계정(`.ms-cmt-account`/`.ms-reply-account`). Option colors set by `applySelectColor()` (계정별 색상) are mirrored onto the combo items and label. Only one combo is open at a time; keyboard: ↑↓/Enter/Esc/Tab. **Sorting** (v1.8.10): the rendered list is ascending by label (`Intl.Collator('ko', {numeric:true})` — so `3/9` < `3/11`), while the underlying `<select>` option order is left untouched (option indexes are the values); pass `sort:false` to keep source order. **`wide: true`** (v1.8.10) lets the open panel size to its content (`width:max-content`, capped at `min(680px,70vw)`) instead of the button width — used by 프리셋/계정 combos, which used to ellipsize long labels that the old native `<select>` popup showed in full.
- `components/account-tab.js` — `MsHelpers` object: DOM rendering helpers for segments, comments (with `randomNickname` + `randomAccount` checkboxes), recursive replies. **Drag-and-drop**: `setupDropZone()` attaches dragover/drop handlers to image segment areas; `getDroppedImagePaths()` reads `e.dataTransfer.files`. Global `dropZoneGuard` prevents Electron from navigating away when files dropped outside drop zones.
- `styles/main.css` — Dark theme styling, `.drag-over` highlight class
- All renderer code is vanilla JS (no framework), communicates with main process via `window.api`

## Code Protection (Build)

Dual obfuscation strategy via `scripts/build-protected.js`:

1. **Main process (non-Puppeteer files)**: bytenode (.jsc) compilation + obfuscation — prevents reverse engineering
2. **Puppeteer files**: Obfuscation only (NO `stringArray`) — because `page.evaluate()` callbacks are serialized to browser context and bytenode's `[native code]` toString breaks serialization
3. **Renderer files**: Obfuscation with stringArray encryption
4. **Preload**: Obfuscation with stringArray, `target: 'node'`

**Files excluded from bytenode** (use `page.evaluate`): `auth.js`, `browser-manager.js`, `comment-writer.js`, `crawl.js`, `nickname-changer.js`, `post-deleter.js`, `post-liker.js`, `post-writer.js`, `preload.js`

Dependencies: `bytenode` (compilation), `javascript-obfuscator` (obfuscation)

## Key Patterns

- **CommonJS modules** throughout (`require`/`module.exports`)
- **IPC naming convention**: `domain:action` (e.g., `accounts:load`, `execution:start`, `settings:save`), constants in `src/shared/constants.js`
- **Renderer calls main** via `ipcRenderer.invoke()` / `ipcMain.handle()` (request-response)
- **Main pushes to renderer** via `safeSend()` wrapper (checks `mainWindow && !mainWindow.isDestroyed()`) for events: `execution:log`, `execution:progress`, `execution:complete`, `ip:status`, `update:*`, `scheduler:log`, `scheduler:progress`, `scheduler:manuscripts-updated`
- **Browser automation** uses puppeteer-core with local Chrome installation (not bundled Chromium)
- **Browser isolation = one browser per account, each on its own persistent profile** (2026-09-21). Every `launchBrowser()` caller passes `accountId` (executor `openNewBrowser(accId)`, login test, delete, like, crawl, joined cafes). The profile keeps the Naver session, device cookies and localStorage, so Naver sees *the same device coming back with a new IP* instead of *the same session cookie appearing on a brand-new device every run* (= cookie-theft pattern → session revoked → receipt captcha on re-login — the real cause of "삭제가 안 됨": the delete flow was failing at login, not at the delete button). If the profile is locked by another Chrome (same account running concurrently — detected via undeletable `lockfile`) or fails to launch, it falls back to a temp profile with a log line.
- **No fingerprint spoofing** (2026-09-21, measured on Chrome 153 against the old code): the old `setupPage()` did `setUserAgent(random)` (→ `sec-ch-ua` headers and `navigator.userAgentData` vanish; the pool even included **Firefox** UAs on a Chrome engine), random `setViewport` (→ 1366 viewport inside a 1920 window — impossible geometry), and a `navigator.webdriver` getter override (→ own-property trace). All removed; `setupPage()` now only auto-accepts dialogs. Signals now match a real Chrome exactly.
  - **puppeteer default args are dropped** (`ignoreDefaultArgs: true`): they add `--enable-automation` and `--disable-features=…AcceptCHFrame…`. Kept only non-observable stability flags (`CHROME_ARGS`: background-throttling off, popup blocking off, `--hide-crash-restore-bubble`, `--disk-cache-size=50MB` since profiles accumulate per account).
  - ⚠️ **`--remote-debugging-port=0` makes Chrome report `navigator.webdriver === true`** (Chrome 153, measured; a fixed port → false). `launchBrowser()` therefore picks a free port itself (`getFreePort()`) — never let puppeteer choose port 0.
- **Headless setting = hidden headed window, NOT real headless** (2026-09-21). Real headless puts `HeadlessChrome` in the UA (a bot signal the old code hid via the UA spoof above). Now `settings.headless` launches a normal Chrome with `--window-position=-32000,-32000 --window-size=1920,1080`; `hideBrowserWindows()` moves every page/popup target off-screen via CDP `Browser.setWindowBounds` on `targetcreated` (popups opened by `window.open` don't inherit `--window-position`) and logs popup URLs (`[브라우저] 새 창/팝업: <url>`).
  - **Do NOT hide it with Win32 `ShowWindow(SW_HIDE)`** (the v1.8.5 forced-hide path, now removed): a hidden window makes pages `visibilityState=hidden`, stops `requestAnimationFrame`, and reports `outerWidth=0` (measured). Off-screen keeps everything normal; the only cost is a Chrome button on the taskbar.
  - Captcha cannot be solved by a human in this mode → `performLogin` fails fast with a log telling the user to turn headless off and pass [로그인 테스트] once; the session then persists in the profile.
  - Launch log line: `[브라우저] Chrome <ver> · 프로필=<accountId|임시> · 숨김 창(헤드리스 설정)|일반 창`. Store read failure logs a warning instead of silently going headed.
  - ⚠️ **Hidden page ⇒ `ElementHandle.click()` hangs 180s** (v1.8.13, measured Chrome 155): when the work tab is behind another tab or the window is minimized (e.g. Win+D), the page goes `visibilityState=hidden` and stops rendering. puppeteer's `click()` first awaits an `IntersectionObserver` callback (`scrollIntoViewIfNeeded`), which never fires → `Runtime.callFunctionOn timed out` after `protocolTimeout`. `page.evaluate` / `goto` keep working, so only click steps die. Fix: `ensureForeground(page, log)` (browser-manager) calls `bringToFront()` only when hidden (window stays off-screen, state back to normal) — called in `navigateToArticle` and after the write-page editor loads. **Every** comment/reply/post-writer click goes through `clickWithFallback(handle, log)` / `clickSelector(page, sel, log)` (browser-manager, v1.8.14): `ensureForeground` first, then a 10s race → DOM `focus()+click()`. Measured in the hidden state: only clicks hang — `keyboard.type`, `evaluate`, `waitForSelector`, `scrollIntoView` work. Do not add raw `handle.click()` / `page.click()` in automation code.
- **Login flow** (`auth.loginAccount(page, id, pw, { log })`): (1) profile already has `NID_AUT` → `checkLoginStatus` → `method: 'profile'`; (2) inject stored cookies → `'cookie'`; (3) typed login (`typeHuman`: per-char 100–300ms, clears a pre-filled `#id`) → `'direct'`. Every success re-saves cookies for www/nid/cafe/m.cafe (`page.cookies()` without URLs only returned the current page's cookies). On the login form after submit: bad credentials → fail fast; captcha/unknown + headed → log `⚠️ 로그인 추가 확인 필요 … (최대 3분 대기)`, **re-type the password once per reloaded page** (the captcha page clears it, so the operator only answers the captcha), wait until the URL leaves `nidlogin.login`; hidden mode → fail fast with guidance. `waitLeaveLoginForm` stops as soon as the server returns the form again (marker `window.__ncaSubmitted` disappears) instead of waiting the full 10s.
  - The delete flow now logs login attempt / success method / failure to the execution log (it used to fail silently with `'로그인 실패'` only in `delete-schedule.json`) and re-saves cookies after deleting.
- **API-first crawling**: Board list via `SideMenuList` API with 3 fallbacks (SPA, old frames, write page dropdown), cafe list via `cafe-home/v1/cafes/join` API
- **Board filtering**: Exclude separator (type=S), folder (type=F), non-numeric menuId, and menuId ≤ 0; deduplicate by menuId
- **IP change on all operations**: login test, cafe/board crawling, like fetch, execution, delete — all respect IP change setting
- **ADB IP change**: `svc data disable/enable` + polling (~2-3s), old IP check skipped
- **Comment image upload**: `page.waitForFileChooser()` + `frame.evaluate(label.click())` — required for iframe + headless compatibility. `uploadFile()` does NOT work on iframe elements in headless mode.
- **Text insertion**: `execCommand('insertText')` line-by-line with `keyboard.type()` fallback — no CDP keyboard events
- **Board template**: Board selected first (not via URL menuId) → `waitForFunction` for `.se-module-text:not(.se-is-empty)` (max 10s) → if template: Enter×2 (SmartEditor auto-positions cursor); if no template: click editor to focus
- **Comment continue-on-fail** (`settings.commentContinueOnFail`, default `true`): Main comment fail → skip its reply chain, continue to next main comment. Reply fail → skip that reply's descendants, continue to next sibling reply. Set to `false` to revert to legacy abort-all behavior (any comment/reply failure aborts the manuscript's remaining comments).
- **Comment delay**: Configurable random delay between comments/replies via `settings.commentDelay` (default 60-100s, can be disabled). Applied to BOTH comments and replies (must use the same delay branch in both loops — v1.7.3 fix).
- **Random account selection**: `manuscript.randomAccount` picks any registered account as poster; `comment.randomAccount` / `reply.randomAccount` pick random commenter excluding the post author.
- **Scheduled publishing**: Per-manuscript `scheduledAt` (ISO string). Polled every 30s; manuscripts past their time by >2 min get marked `expired` (no auto-execute) — see Scheduled Publishing section.
- **Drag-and-drop image upload** (renderer): Image body segments accept dropped files. Global guard prevents stray drops from navigating away in packaged app. HTML entities in dropped paths are decoded (v1.7.1 fix for packaged builds).
- **Toast notifications**: Non-blocking toast messages replace `alert()` in renderer (prevents focus loss)
- **Searchable dropdowns**: any long `<select>` gets `SearchCombo.attach()` (카페/프리셋/게시 계정/댓글·대댓글 계정). The select itself is never replaced — it stays hidden as the value/event source, so no calling code changes when a dropdown becomes searchable.

## Data Structures

**settings.json**: Global settings:
```js
{
  headless: false,  // true = browser hidden
  ipChange: { enabled, method: 'adb', adb: {} },
  commentDelay: { enabled: true, minSeconds: 60, maxSeconds: 100 },
  commentContinueOnFail: true,  // false = legacy abort-all on first comment failure
  shortcuts: { ... }
}
```

**global-manuscripts.json**: Global manuscripts and presets:
```js
{
  manuscripts: [
    {
      id, accountId, cafeId, cafeName,
      boards: [{ menuId, menuName }],
      boardMenuId, boardName, enabled,
      randomNickname, randomAccount,           // randomAccount: pick poster from all accounts
      visibility,                              // 'public' | 'member'
      scheduledAt,                             // ISO datetime — empty = manual run only
      scheduledStatus,                         // 'pending'|'running'|'executed'|'failed'|'expired'
      lastRunAt, lastError,
      post: { title, bodySegments: [{ type: 'text'|'image', content|filePath }] },
      comments: [
        {
          accountId, randomNickname, randomAccount, text, imagePath,
          replies: [
            { accountId, randomNickname, randomAccount, text, imagePath, replies: [...] }
          ]
        }
      ]
    }
  ],
  presets: [{ name, manuscripts, savedAt }]
}
```

## Post Writing Flow

1. Navigate to write page (without menuId in URL), retry up to 3 times — readiness = editor selector appears, NOT `networkidle0` (v1.8.5)
2. **Select board** via dropdown (`selectBoard()`) — name match → data-value match → first board fallback
3. **Detect template** via `waitForFunction`: `.se-module.se-module-text:not(.se-is-empty)` (timeout 10s)
4. If template exists: **Enter×2** (SmartEditor auto-positions cursor at end of guidance)
5. If no template: click `.se-text-paragraph` or `.se-component-content` to focus
6. Write body segments (text via `execCommand('insertText')` line-by-line, image via `uploadFile` with `fileChooser` fallback)
7. Enter title (`.textarea_input`, `keyboard.type`)
8. Set visibility (public/member) via `.btn_open_set` dropdown
9. Click submit (`.BaseButton--skinGreen`), then **`acceptConfirmLayer()`** (2026-09): Naver now shows an in-page Vue modal for public posts — `div.ModalLayer.header_basic` "이 글은 전체공개로 설정되어 있어요… 계속할까요?" with `.layer_footer button.BaseButton--green` (확인). It is NOT a native `confirm()` (dialog handler can't catch it) and the post does not submit until 확인 is clicked. Polled up to 4s, clicked via `page.mouse.click` at the button center (DOM `click()` fallback). Note the modal's 확인 is `.BaseButton--green`, the 등록 button is `.BaseButton--skinGreen`. Then wait for navigation (max 30s), retry once if still on write page. The `.alert_text` "등록 중" check only counts *visible* elements — a hidden "등록 중입니다." loading modal is always in the DOM.

## Comment/Reply Image Upload

The comment area is inside iframe `#cafe_main`. File input is `.button_file input.blind` (accept="image/*, image/heic").

**Working approach** (headless + iframe compatible):
```js
const [fileChooser] = await Promise.all([
  page.waitForFileChooser({ timeout: 5000 }),
  frame.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) el.click();
  }, labelSelector),
]);
await fileChooser.accept([path.resolve(filePath)]);
```

**Does NOT work in headless + iframe**: `elementHandle.uploadFile()`, CDP `DOM.setFileInputFiles`

## Board Crawling

Three fallback strategies with deduplication:
1. **tryNewSPA()**: SPA page `cafe.naver.com/f-e/` → menu role links
2. **tryOldFrames()**: Frame-based crawl with `#cafe-menu a[id^="menuLink"]`
3. **tryWritePageDropdown()**: Write page dropdown selector (dropdownIndex + menuName)

**Filtering**: Exclude non-numeric menuId, menuId ≤ 0; `deduplicateBoards()` by menuId

## Like Feature

- **Like verification**: After click, verify state changed (button class `.on` / `aria-pressed=true` / `.is_liked`, count increased)
- **Author skip**: Detect edit/delete buttons in iframe → skip own posts
- **MemberKey extraction** (5-stage strategy): Members API regex → CafeMemberInfo API → SPA `__NEXT_DATA__` + DOM → "내 활동" redirect URL → board article list nickname matching (10 pages)

## IP Change

- **ADB method** (default): `adb shell svc data disable` → 0.5s wait → `adb shell svc data enable` → polling until new IP (~2-3s total)
- **netsh method** (fallback): `netsh interface set interface disable/enable` — works for ethernet, NOT for USB tethering
- ADB binaries bundled in `resources/adb/` (adb.exe, AdbWinApi.dll, AdbWinUsbApi.dll)
- IP change applied to: executor (every account switch), login test, cafe crawling, like fetch, delete
- `changeIPWithStatus()` helper sends `ip:status` event to renderer for real-time display

## Scheduled Publishing

- **Polling**: 30-second `setInterval` in `scheduler.js`. Initial tick fires 3s after start to catch missed schedules from previous app shutdown.
- **Grace window**: 2 minutes. A manuscript whose `scheduledAt` is older than `now - 2min` is marked `expired` (PC/app was off, or detection too late) — **NOT auto-executed** (v1.7.4 design choice to avoid surprise posts).
- **Concurrency**: Skips tick if manual execution is running (`isManualRunning()`) or another scheduler tick is in progress.
- **Execution**: Each due manuscript runs through a fresh `Executor.execute([msRun], settings, accounts)` with `enabled: true` forced (the schedule itself signals intent).
- **Status**: `pending` (waiting) → `running` → `executed` (success) | `failed` (error) | `expired` (missed). Renderer shows status next to manuscript title; reset via `scheduler:reset` IPC.
- **IPC**: `scheduler:set` / `scheduler:list` / `scheduler:reset` / `scheduler:run-now` (handle), `scheduler:log` / `scheduler:progress` / `scheduler:manuscripts-updated` (push events).

## Auto-Update (electron-updater)

- **Repo must be public** — private repo returns 404 (GH_TOKEN doesn't help)
- `artifactName: "NCafeAuto-Setup-${version}.${ext}"` — no spaces (GitHub converts spaces to dots, causing filename mismatch with latest.yml)
- Event-based: `update:available` → `update:progress` → `update:downloaded` → user clicks install
- `autoDownload: true`, `autoInstallOnAppQuit: true`
- Header shows version + "업데이트 확인" button
- `checkForUpdatesAndNotify()` on app start

## Code-Swap Auto-Update (self-hosted, v1.8.6)

A second, independent update channel that swaps **JS only** without reinstalling the installer — for fast patches (the `.exe` is never rebuilt/redistributed). Coexists with electron-updater. Chosen model: **self-hosted on dev's own PC** (port-forward/DDNS), **no license gate** (무인증 — anyone with the app updates).

- **`src/updater.js`** — client. Downloads a new version's JS tree into `userData/app/<version>/` (mirrors the project root), verifies per-file md5, atomically confirms, writes `app/current.json` pointer. `resolveCodeRoot(bundledRoot)` (called by the bootstrap) uses the code-swap version **only if it is strictly newer than the bundled/installed version** (`cmpVersion`) — so an electron-updater installer that raises the asar version automatically supersedes and cleans up a stale code-swap. No license/keys.
- **Bootstrap** (`src/main/index.js`) selects code-swap-vs-bundled and adds bundled `node_modules` to the search path (version dirs ship without `node_modules`). Entry = `src/main/app-main.js`.
- **`update-server/`** — Node HTTP server (port **9250**) serving `dist-src/` via a whitelist (`INCLUDE = [/^src\//, /^package\.json$/]` — NOT `node_modules`/`resources`). Routes: `/api/ping`, `/api/check` (version compare, no auth), `/api/manifest` (md5s), `/api/file`. `version.json` drives the compare. `deploy.bat`/`deploy.ps1` (local build+restart), `run-server.bat` (Task Scheduler), `Windows-setup.md` (port-forward/DDNS/Tunnel setup).
- **Client trigger**: `app-main.js` `setupCodeUpdater()` checks ~4s after launch; if a newer version exists it downloads+applies in the background, then sends `upd:ready` → renderer shows a restart banner. Server URL from `settings.updateServerUrl` || `updater.DEFAULT_SERVER_URL`.
- **Rollout rule**: the code-swap client only exists in apps that already shipped the bootstrap, so the **first release carrying it (1.8.6) must go out via GitHub/electron-updater** to seed it; code-swap can deliver 1.8.7+. **One version → one channel** (don't publish the same version to both GitHub and code-swap). Electron/native/binary (adb) changes CANNOT code-swap — GitHub installer only. `DEFAULT_SERVER_URL` baked into a release is the lifeline for all future code-swap from that release; plain HTTP over the public internet executes downloaded code — prefer HTTPS (Cloudflare Tunnel) before enabling for real customers.
- **Build**: `src/main/index.js` (bootstrap) is excluded from `MAIN_FILES`/`NO_EXPORT_FILES` (stays plain); `src/main/app-main.js` takes its place (bytenode). `npm run update-server` starts the server.

## Naver Cafe Technical Notes

- Delete button is inside iframe — must search `[page, ...page.frames()]`
- **Comment 삭제 vs article 삭제** (v1.8.4): an article page has a '삭제' button per comment too, so a naive "click first element with text 삭제" can hit a comment's delete on posts that have comments (typically OLDER posts) → article survives while comment-less (newer) posts delete fine — the classic "same account/board, only the older post isn't deleted" symptom. `clickDeleteButton` now: (1) tries explicit article-bottom selectors (`.ArticleBottomBtns` etc.), (2) a 수정+삭제-pair action-bar heuristic, (3) first non-comment 삭제 — all **excluding comment containers** (`.CommentItem`,`[class*="Comment"]`,`.u_cbox`…). Returns `{frame, how}`; `how==='first-non-comment'` recurring ⇒ article-bottom selector broke (Naver markup change) and needs updating.
  - ⚠️ **위 오클릭 시나리오는 실측으로 반증됨 (2026-09-17, 카페 2곳 · 신형 레이아웃).** 댓글의 수정·삭제는 `button.comment_tool_button` (⋮) 을 눌러야 그때 생성되는 메뉴 안에 있어서, **본인 댓글이 3개 달린 글에서도 댓글 영역의 '삭제' 텍스트 요소는 0개**였다. 앱은 그 ⋮ 버튼을 누르지 않으므로 오클릭이 성립하지 않는다. `.ArticleBottomBtns` 도 멀쩡히 존재해 전략1이 정확히 1개(게시글 하단)를 집는다.
  - 전략3 주석의 "게시글 본문이 댓글보다 DOM 앞" 이라는 근거도 **사실과 반대**다. 실제 순서는 `ArticleTopBtns → 본문 → CommentBox → ArticleBottomBtns` 로 **댓글이 하단 버튼보다 앞**에 있다. 결과적으로는 상단 삭제를 먼저 만나 안전하지만, 진짜 방어선은 `inComment()` 하나뿐이다.
  - **삭제 버튼은 글쓴이 본인 또는 카페 매니저에게만 렌더링된다** (실측: 매니저 2개 / 일반회원+타인글 0개. `.ArticleBottomBtns` 컨테이너는 누구에게나 있고 안의 삭제 버튼만 없다). ⇒ **`삭제 버튼을 찾을 수 없습니다` 에러 = 마크업 문제가 아니라 권한/인증 문제** (쿠키 로그인 거짓 성공, 계정 전환 실패, 세션 만료 캐스케이드).
- Delete confirm was browser native `confirm()`; Naver has been migrating some flows to an in-page **layer popup (modal)**. `deletePost` (v1.8.4) clicks the delete button (with 1 retry for late iframe load), auto-accepts native `confirm()` via the `dialog` handler, AND clicks a layer-popup 삭제/확인 button as fallback, then **verifies actual deletion** via `checkPostState()` (re-opens the URL) returning `deleted`/`exists`/`login`. Verification signals, in priority order: (1) captured native-alert message matches `GONE_RE` (visiting a deleted post fires `alert("삭제되었거나 없는 게시글입니다")` which the dialog handler swallows — so messages are captured, not just accepted); (2) login-page/`#id#pw` form ⇒ `login` (session expired mid-batch → must NOT be read as deleted); (3) DOM: gone-message / 삭제-button / body-container. Previously `deletePost` returned `true` on button-click alone → undeleted posts (and session-expiry) were mis-logged as "삭제 완료". Now throws `삭제 확인 실패 …` (still present) or `세션 만료로 삭제 확인 불가 …`.
- Puppeteer uses `page.off()` not `page.removeListener()`
- Wrap `dialog.accept()` in try-catch (already-handled error possible)
- Electron `prompt()` always returns null — use `confirm()` or avoid
- Visibility: `.btn_open_set` opens settings, `input#all[name="public"]` / `input#member`
- writeReply: reverse-searches `.CommentItem` by text match (latest match wins, supports reply-to-reply)
- Comment "더보기" buttons must be clicked before searching for target comments
- Like button is inside iframe (`#cafe_main`) — must access `contentFrame()` first
- `CafeMemberInfo` API returns masked `memberId`, NOT the base64url `memberKey` needed for article list API
- `CafeMemberNetworkArticleListV3` response uses `articleid` (lowercase), not `articleId` (camelCase)
- Board article list API has TWO response structures: nested and flat
- Board template loads after board **dropdown selection**, NOT from URL menuId parameter
- **`networkidle0` is no longer a gate** (v1.8.5). Naver pages keep firing background requests (ads/trackers), and on a slow link — the app runs over ADB mobile-data tethering — network idle may never arrive inside the 30s timeout. Waiting on it meant a blank page on screen and 30s of dead air per attempt, then a *false* failure even though the page was perfectly usable:
  - `auth.js` (`checkLoginStatus`, `performLogin`) now uses `domcontentloaded` (measured: 0.2s vs 2.6s on a fast link, and it cannot hang) + `waitForSelector('#id')` on the login page. Worst case before: 4 × 30s of silent hang per account switch (= per manuscript), each ending in "로그인 실패".
  - `post-writer.js` (`navigateToWritePage`) still *tries* `networkidle0`, but a timeout no longer fails the attempt — readiness is decided by `waitForSelector('.se-component-content')`. Retries only if the editor never appears.
- **Long steps must log to the execution log, not `console.log`** — the renderer only shows what goes through the `log` callback. `navigateToWritePage`/`writePost` previously used `console.log`, so a stuck navigation looked like the app had frozen ("아무 반응 없음"). Page-entry, board select, title, submit, and "등록 중" waits now emit `log()` lines.
- Comment file input: `.button_file input.blind` (accept="image/*, image/heic")
- Image extensions supported: jpg, jpeg, jpe, jfif, pjpeg, png, apng, gif, webp, bmp, tif, tiff, ico, svg, svgz, heic, heif, avif, jxl, xbm, pip

## Keyboard Shortcuts

- F1~F5: 탭 이동 (설정/원고/실행/삭제/좋아요), F6: 단축키
- Ctrl+F (설정 탭): 계정 아이디 검색창 포커스
- Ctrl+Enter/Escape/P/R: 실행 시작/중지/일시정지/재개
- Ctrl+L / Ctrl+Shift+L: 좋아요 시작/중지
- Ctrl+S: 설정 저장
- Ctrl+Shift+P: IP 변경 ON/OFF
- Ctrl+I: IP 변경 테스트
- Ctrl+Shift+I: 인터페이스 확인
- Ctrl+Shift+A: 기기 확인
- Ctrl+H: 헤드리스 모드 ON/OFF
