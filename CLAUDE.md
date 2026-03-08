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

## Architecture

**Electron two-process model** with strict context isolation (`contextIsolation: true`, `nodeIntegration: false`).

### Main Process (`src/main/`)
- `index.js` — App entry point, creates BrowserWindow
- `preload.js` — Context bridge exposing `window.api` to renderer via IPC
- `ipc-handlers.js` — Registers all `ipcMain.handle()` routes, wires up Executor events to renderer

**Core modules** (`src/main/core/`):
- `browser-manager.js` — Puppeteer launch config, page creation, Chrome path detection
- `auth.js` — Naver login (cookie-first, then direct), cookie save/restore
- `crawl.js` — Board list crawling with multiple fallback strategies (SPA, frame-based, write-page dropdown)
- `post-writer.js` — Post creation with text/image segments
- `comment-writer.js` — Comment automation (same-account and cross-account)
- `nickname-changer.js` — Cafe nickname changes (multiple page structure attempts)
- `ip-checker.js` — Public IP detection via external APIs

**Engine** (`src/main/engine/`):
- `executor.js` — Main orchestration: groups manuscripts by account, handles IP change flow between accounts, manages pause/resume/stop state via EventEmitter
- `result-logger.js` — Timestamped execution log tracking

**Data layer** (`src/main/data/store.js`):
- All persistence is JSON files in `data/` directory (no database)
- In dev: `data/` at project root. In production: `process.resourcesPath/data/`
- Subdirectories: `cookies/`, `crawl-cache/`, `logs/`

### Renderer Process (`src/renderer/`)
- `index.html` — Single-page UI with tab navigation
- `app.js` — Tab switching controller
- `components/` — Tab modules: `tab-accounts.js`, `tab-manuscripts.js`, `tab-execution.js`, `tab-results.js`
- `styles/main.css` — Dark theme styling
- All renderer code is vanilla JS (no framework), communicates with main process via `window.api`

## Key Patterns

- **CommonJS modules** throughout (`require`/`module.exports`)
- **IPC naming convention**: `domain:action` (e.g., `accounts:load`, `execution:start`, `crawl:boards`)
- **Renderer calls main** via `ipcRenderer.invoke()` / `ipcMain.handle()` (request-response)
- **Main pushes to renderer** via `webContents.send()` / `ipcRenderer.on()` (events: `execution:log`, `execution:progress`, `execution:ip-change-request`, `execution:complete`)
- **Browser automation** uses puppeteer-core with local Chrome installation (not bundled Chromium)
- **Execution flow**: manuscripts grouped by account → IP change between account groups → login → optional nickname change → post to boards → optional comments (supports cross-account)

## Data Structures

**accounts.json**: Array of `{ id, password }` (Naver credentials)

**manuscripts.json**: `{ cafeId, cafeName, manuscripts[] }` where each manuscript has:
- `id`, `accountId`, `boardMenuId`, `boardName`, `nickname`, `enabled`
- `post: { title, bodySegments[] }` — segments are `{ type: 'text'|'image', content }`
- `comments[]` — each has `{ accountId, text, imagePath }`
