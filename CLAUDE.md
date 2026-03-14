# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

N Cafe Auto is an Electron desktop application for automating Naver Cafe post and comment management. The UI is entirely in Korean. It uses Puppeteer-core for browser automation against Naver Cafe's web interface.

## Commands

```bash
npm start        # Launch the Electron app in dev mode
npm run build    # Build Windows installer (NSIS) via electron-builder → output in dist/
```

There are no tests or linting configured.

## Repository

- **GitHub**: https://github.com/lazy5186-lgtm/N-cafe-auto (private)
- **Auto-update**: `electron-updater` + GitHub Releases

## Architecture

**Electron two-process model** with strict context isolation (`contextIsolation: true`, `nodeIntegration: false`).

### Main Process (`src/main/`)
- `index.js` — App entry point, creates BrowserWindow, auto-updater setup, data migration (V1 + V2), loads custom nickname words on startup
- `preload.js` — Context bridge exposing `window.api` to renderer via IPC
- `ipc-handlers.js` — Registers all `ipcMain.handle()` routes, global execution (single Executor), delete management with IP change, results export (CSV)

**Core modules** (`src/main/core/`):
- `browser-manager.js` — Puppeteer launch config, page creation, Chrome path detection
- `auth.js` — Naver login (cookie-first, then direct), cookie save/restore
- `crawl.js` — Board list via `SideMenuList` API (page.evaluate+fetch, API-first with DOM fallback), joined cafes via `cafe-home/v1/cafes/join` API
- `post-writer.js` — Post creation with text/image segments, board selection (name→menuId→fallback), visibility setting (public/member), **returns postUrl**
- `comment-writer.js` — Comment automation (writeComment, writeReply with text-match targeting), comment crawling
- `post-deleter.js` — Post deletion (searches all frames for delete button, handles browser confirm() dialog)
- `nickname-changer.js` — Cafe nickname changes (popup or direct URL), supports random mode with duplicate retry (5 attempts)
- `nickname-generator.js` — Random nickname generation (customizable adjectives × nouns), `setCustomWords()` for user overrides
- `ip-changer.js` — IP change via network interface disable/enable (netsh), admin privileges required
- `ip-checker.js` — Public IP detection via external APIs
- `post-liker.js` — Post like automation (`likePost`), member article list (`fetchMemberArticles` via `CafeMemberNetworkArticleListV3` API), memberKey extraction (`fetchMemberKey` with multi-strategy: `cafe-cafeinfo-api/members` API → SPA `__NEXT_DATA__` → DOM → "내 활동" click → board list fallback)
- `view-counter.js` — View count automation: isolated incognito context per visit (`createIsolatedPage`), randomized User-Agent (14 variants), canvas fingerprint randomization, context destroy after each visit (`destroyContext`), no login required

**Engine** (`src/main/engine/`):
- `executor.js` — Global orchestration: iterates all enabled manuscripts, switches accounts as needed, handles cross-account comments/replies recursively, IP change on every account switch, comment abort on failure (`commentAborted` flag), per-manuscript random nickname, pause/resume/stop via EventEmitter, 60-100s random delay between tasks
- `result-logger.js` — Timestamped execution log tracking

**Data layer** (`src/main/data/store.js`):
- All persistence is JSON files in `data/` directory (no database)
- In dev: `data/` at project root. In production: `process.resourcesPath/data/`
- Files: `accounts.json`, `settings.json`, `global-manuscripts.json`, `delete-schedule.json`, `nickname-words.json`, `view-count.json`
- Subdirectories: `cookies/`, `crawl-cache/`, `logs/`

### Renderer Process (`src/renderer/`)
- `index.html` — Single-page UI with 6 global tabs (설정/원고/실행/삭제/좋아요/조회수)
- `app.js` — Global tab controller: settings (accounts, IP, nickname words), manuscript list/editor, execution controls with results/CSV export, delete management, like tab, view count tab, cafe/board caching
- `components/account-tab.js` — `MsHelpers` object: DOM rendering helpers for segments, comments, recursive replies
- `styles/main.css` — Dark theme styling
- All renderer code is vanilla JS (no framework), communicates with main process via `window.api`

## Key Patterns

- **CommonJS modules** throughout (`require`/`module.exports`)
- **IPC naming convention**: `domain:action` (e.g., `accounts:load`, `execution:start`, `settings:save`)
- **Renderer calls main** via `ipcRenderer.invoke()` / `ipcMain.handle()` (request-response)
- **Main pushes to renderer** via `webContents.send()` / `ipcRenderer.on()` (events: `execution:log`, `execution:progress`, `execution:complete`)
- **Browser automation** uses puppeteer-core with local Chrome installation (not bundled Chromium)
- **API-first crawling**: Board list via `SideMenuList` API, cafe list via `cafe-home/v1/cafes/join` API, both using `page.evaluate(() => fetch())` inside Puppeteer browser context
- **Renderer caching**: `_cafeCache` (per account), `_boardCache` (per account+cafe), `_likeCafeCache` (per account), `_likeArticleCache` (per account+cafe) avoid redundant API calls
- **Global execution**: Single Executor iterates all enabled manuscripts, switching accounts/IP as needed
- **Comment abort**: Any comment/reply failure aborts remaining comments for that manuscript, moves to next
- **Preset system**: Save/load manuscript configurations as named presets (append mode, stored in `global-manuscripts.json`)
- **Random delay**: 60-100 second random delay between tasks in executor (anti-detection)

## Data Structures

**accounts.json**: Simplified account array:
```js
{ id, password, nickname }
```

**settings.json**: Global settings:
```js
{
  ipChange: { enabled, interfaceName },
  nicknameChange: { enabled }
}
```

**nickname-words.json**: Custom nickname word lists:
```js
{
  adjectives: ['아련한', '나른한', ...],  // empty = use defaults
  nouns: ['느티나무', '자작나무', ...]     // empty = use defaults
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
          accountId, text, imagePath,
          replies: [
            { accountId, text, imagePath, replies: [...] }  // recursive nesting
          ]
        }
      ]
    }
  ],
  presets: [
    { name, manuscripts, savedAt }
  ]
}
```

**delete-schedule.json**: Posted articles for deletion:
```js
[{ accountId, postUrl, postTitle, boardName, status, createdAt, deletedAt? }]
```

**view-count.json**: View count configuration:
```js
{
  links: ['https://cafe.naver.com/...', ...]  // URLs to visit
}
```

## Execution Flow Detail

1. For each enabled manuscript:
   a. If different account from current: IP change (if ON) → login → nickname change (random or fixed)
   b. Write post → get postUrl → set visibility (public/member)
   c. For each comment (in input order):
      - If different account: IP change → login switch
      - Write comment
      - For each reply (recursive):
        - If different account: IP change → login switch
        - writeReply (targets parent text by text match, reverse search for latest match)
      - **On any comment/reply failure**: abort remaining comments, move to next manuscript
   d. Restore poster account login
   e. Save post to delete schedule
   f. Random delay (60-100s) before next manuscript
2. Save cookies

## Like (좋아요) Tab

- 5th tab for automated post liking
- Select author account → auto-load joined cafes → select cafe → auto-load articles (with cache)
- Article list shows: checkbox, "링크" link (opens `https://cafe.naver.com/{cafeName}/{articleId}`), subject, date
- Like count setting, account mode (random/manual)
- Random mode: hides account list, selects N random accounts from all (excluding author)
- Manual mode: 4-column grid layout for 100+ accounts
- Execution: IP change per liker account → login → navigate to article → click like button (iframe-aware)
- Like button selectors: `.like_article .u_likeit_list_btn`, `.ReactionLikeIt .u_likeit_list_btn`, `a[title*="좋아요"]`, etc.
- Checks if already liked (`.on` class or `aria-pressed="true"`)
- IPC: `like:fetch-articles`, `like:execute`, `like:stop`
- Events: `like:log`, `like:progress`, `like:complete`

### memberKey Extraction (for CafeMemberNetworkArticleListV3)

The article list API requires a base64url `memberKey` (e.g., `aRWbLK6sj1AdgxUr3tE9xOChW-_c...`), not the masked `memberId` from `CafeMemberInfo`.

Extraction priority order in `fetchMemberKey()`:
1. **`cafe-cafeinfo-api/v1.0/cafes/{cafeId}/members`** — Direct API, returns current user's memberKey
2. **SPA `__NEXT_DATA__`** — Parse JSON from cafe SPA page, match by nickname proximity
3. **DOM links** — Find `/members/{memberKey}` pattern in `<a>` tags
4. **"내 활동" click** — Triggers URL redirect containing memberKey
5. **Board article list fallback** — Match nickname across up to 10 pages (500 articles)

## Delete Management

- Separate "삭제" tab manages posted articles
- IP change per account before deletion
- Post deleter searches all frames (iframe support) for delete button
- Handles browser native `confirm()` dialog via `page.on('dialog')`

## Results & Export

- Execution logs saved to `data/logs/` as JSON files
- Results table shows: account, board, title, URL, status, time, comments
- CSV export with BOM (UTF-8) for Excel compatibility

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
- Board article list API (`cafe-boardlist-api`) has TWO response structures: nested (`art.item.writerInfo.memberKey`) and flat (`art.writerMemberKey`)
- `cafe-cafeinfo-api/v1.0/cafes/{cafeId}/members` API returns current logged-in user's memberKey directly

## View Count (조회수) Tab

- 6th tab for automated view count boosting
- **No login required** — non-member views count per Naver's official policy
- **Isolated incognito context** per visit: `browser.createBrowserContext()` creates fresh session (equivalent to Chrome incognito window)
- Each visit gets: new incognito context + random User-Agent (14 variants) + canvas fingerprint randomization
- Context fully destroyed after each visit (cookies, cache, storage all cleared)
- **IP change per visit** (uses global IP change setting from 설정 tab)
- Links registered and persisted in `view-count.json`
- Flow per visit: IP change → new incognito context → visit link (2~4s load wait) → destroy context → 5~10s delay
- IPC: `viewcount:load-config`, `viewcount:save-config`, `viewcount:execute`, `viewcount:stop`
- Events: `viewcount:log`, `viewcount:progress`, `viewcount:complete`

### Naver View Count Rules
- Views counted per page load (cafe home, article list, posts all count)
- Same user re-viewing within 1 minute is excluded
- Non-member views are counted
- "Same user" determined by IP + session; different IP + different session = different user

## Auto-Update (electron-updater)

- On app start: checks GitHub Releases for new version
- Update found → prompt user to download
- Download complete → prompt user to restart and install
- Release workflow: bump `package.json` version → `npm run build` → upload `dist/*.exe` + `latest.yml` to GitHub Release
