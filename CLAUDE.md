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
- **Current version**: 1.5.2

## Architecture

**Electron two-process model** with strict context isolation (`contextIsolation: true`, `nodeIntegration: false`).

### Main Process (`src/main/`)
- `index.js` — App entry point, creates BrowserWindow, auto-updater setup (event-based), data migration (V1 + V2), loads custom nickname words on startup
- `preload.js` — Context bridge exposing `window.api` to renderer via IPC
- `ipc-handlers.js` — Registers all `ipcMain.handle()` routes, `safeSend()` helper for destroyed window safety, `changeIPWithStatus()` helper, global execution (single Executor), delete management with IP change, results export (CSV with BOM)

**Core modules** (`src/main/core/`):
- `browser-manager.js` — Puppeteer launch config (reads `settings.headless` internally), page creation, Chrome path detection, random UA/viewport fingerprint pool, `setupPage()` with anti-detection
- `auth.js` — Naver login (cookie-first, then direct), cookie save/restore
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
- `executor.js` — Global orchestration: iterates all enabled manuscripts, switches accounts as needed (browser restart + IP change per account switch), handles cross-account comments/replies recursively, comment abort on failure (`commentAborted` flag), per-manuscript random nickname, pause/resume/stop via EventEmitter, 60-100s random delay between tasks
- `task-queue.js` — Generic task queue with state management (idle/running/paused/stopped), EventEmitter-based progress tracking, `waitIfPaused()` for cooperative pause/resume
- `result-logger.js` — Timestamped execution log tracking

**Shared** (`src/shared/`):
- `constants.js` — Centralized IPC channel name constants (`IPC` object)

**Data layer** (`src/main/data/store.js`):
- All persistence is JSON files in `data/` directory (no database)
- In dev: `data/` at project root. In production: `app.getPath('userData')/data` (user's AppData folder)
- Files: `accounts.json`, `settings.json`, `global-manuscripts.json`, `delete-schedule.json`, `nickname-words.json`
- Subdirectories: `cookies/`, `crawl-cache/`, `logs/`

### Renderer Process (`src/renderer/`)
- `index.html` — Single-page UI with 5 global tabs (설정/원고/실행/삭제/좋아요) + 단축키
- `app.js` — Global tab controller: settings (accounts, IP, headless, nickname words), manuscript list/editor, execution controls with results/CSV export, delete management, like tab, shortcut system, version display + update check, toast notifications (replaces `alert()`)
- `components/account-tab.js` — `MsHelpers` object: DOM rendering helpers for segments, comments (with randomNickname checkbox), recursive replies
- `styles/main.css` — Dark theme styling
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
- **Main pushes to renderer** via `safeSend()` wrapper (checks `mainWindow && !mainWindow.isDestroyed()`) for events: `execution:log`, `execution:progress`, `execution:complete`, `ip:status`, `update:*`
- **Browser automation** uses puppeteer-core with local Chrome installation (not bundled Chromium)
- **Browser isolation**: New browser launched on every account switch — fresh cookie/cache state per account
- **Random fingerprint**: 6 User-Agents (Chrome/Firefox/Edge) × 6 viewports — selected randomly per session via `setupPage({ randomFingerprint: true })`
- **Headless mode**: `browser-manager.js` reads `settings.headless` internally — all `launchBrowser()` callers auto-apply
- **API-first crawling**: Board list via `SideMenuList` API with 3 fallbacks (SPA, old frames, write page dropdown), cafe list via `cafe-home/v1/cafes/join` API
- **Board filtering**: Exclude separator (type=S), folder (type=F), non-numeric menuId, and menuId ≤ 0; deduplicate by menuId
- **IP change on all operations**: login test, cafe/board crawling, like fetch, execution, delete — all respect IP change setting
- **ADB IP change**: `svc data disable/enable` + polling (~2-3s), old IP check skipped
- **Comment image upload**: `page.waitForFileChooser()` + `frame.evaluate(label.click())` — required for iframe + headless compatibility. `uploadFile()` does NOT work on iframe elements in headless mode.
- **Text insertion**: `execCommand('insertText')` line-by-line with `keyboard.type()` fallback — no CDP keyboard events
- **Board template**: Board selected first (not via URL menuId) → `waitForFunction` for `.se-module-text:not(.se-is-empty)` (max 10s) → if template: Enter×2 (SmartEditor auto-positions cursor); if no template: click editor to focus
- **Comment abort**: Any comment/reply failure aborts remaining comments for that manuscript, moves to next
- **Random delay**: 60-100 second random delay between tasks in executor (anti-detection)
- **Toast notifications**: Non-blocking toast messages replace `alert()` in renderer (prevents focus loss)

## Data Structures

**settings.json**: Global settings:
```js
{
  headless: false,  // true = browser hidden
  ipChange: { enabled, method: 'adb', adb: {} },
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
      randomNickname, visibility,  // 'public' | 'member'
      post: { title, bodySegments: [{ type: 'text'|'image', content|filePath }] },
      comments: [
        {
          accountId, randomNickname, text, imagePath,
          replies: [
            { accountId, randomNickname, text, imagePath, replies: [...] }
          ]
        }
      ]
    }
  ],
  presets: [{ name, manuscripts, savedAt }]
}
```

## Post Writing Flow

1. Navigate to write page (without menuId in URL), retry up to 3 times
2. **Select board** via dropdown (`selectBoard()`) — name match → data-value match → first board fallback
3. **Detect template** via `waitForFunction`: `.se-module.se-module-text:not(.se-is-empty)` (timeout 10s)
4. If template exists: **Enter×2** (SmartEditor auto-positions cursor at end of guidance)
5. If no template: click `.se-text-paragraph` or `.se-component-content` to focus
6. Write body segments (text via `execCommand('insertText')` line-by-line, image via `uploadFile` with `fileChooser` fallback)
7. Enter title (`.textarea_input`, `keyboard.type`)
8. Set visibility (public/member) via `.btn_open_set` dropdown
9. Click submit (`.BaseButton--skinGreen`), wait for navigation (max 10s), retry once if still on write page

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

## Auto-Update (electron-updater)

- **Repo must be public** — private repo returns 404 (GH_TOKEN doesn't help)
- `artifactName: "NCafeAuto-Setup-${version}.${ext}"` — no spaces (GitHub converts spaces to dots, causing filename mismatch with latest.yml)
- Event-based: `update:available` → `update:progress` → `update:downloaded` → user clicks install
- `autoDownload: true`, `autoInstallOnAppQuit: true`
- Header shows version + "업데이트 확인" button
- `checkForUpdatesAndNotify()` on app start

## Naver Cafe Technical Notes

- Delete button is inside iframe — must search `[page, ...page.frames()]`
- Delete confirm is browser native `confirm()`, not HTML popup
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
- `networkidle0` can cause "응답없음" on Naver (many background requests) — but still used for editor stability
- Comment file input: `.button_file input.blind` (accept="image/*, image/heic")
- Image extensions supported: jpg, jpeg, jpe, jfif, pjpeg, png, apng, gif, webp, bmp, tif, tiff, ico, svg, svgz, heic, heif, avif, jxl, xbm, pip

## Keyboard Shortcuts

- F1~F5: 탭 이동 (설정/원고/실행/삭제/좋아요), F6: 단축키
- Ctrl+Enter/Escape/P/R: 실행 시작/중지/일시정지/재개
- Ctrl+L / Ctrl+Shift+L: 좋아요 시작/중지
- Ctrl+S: 설정 저장
- Ctrl+Shift+P: IP 변경 ON/OFF
- Ctrl+I: IP 변경 테스트
- Ctrl+Shift+I: 인터페이스 확인
- Ctrl+Shift+A: 기기 확인
- Ctrl+H: 헤드리스 모드 ON/OFF
