'use strict';
/**
 * 부트스트랩 (setup-updater — 코드스왑 자동업데이트).
 *
 * ★ 이 파일은 **설치본(asar)에 박혀 있고 코드스왑으로 바뀌지 않는다.** 그래서 최대한 얇게,
 *   평문(bytenode 컴파일 X)으로 둔다 — 항상 로드 가능해야 폴백 앵커 역할을 한다.
 *   (scripts/build-protected.js 의 MAIN_FILES 에서 index.js 를 뺐다. app-main.js 가 대신 들어간다.)
 *
 * package.json 의 "main" 이 이 파일(src/main/index.js)을 가리킨다.
 *
 * 하는 일: 실행할 코드가 어디인지 고른 뒤 그쪽 app-main.js 를 로드한다.
 *   코드스왑으로 받아둔 게 있고 **설치본보다 최신이면**  userData/app/<버전>/src/main/app-main.js
 *   없거나 망가졌거나 설치본이 더 최신이면                설치본 내장 <root>/src/main/app-main.js
 *
 * ⚠ 여기서 예외가 새면 앱이 아예 안 뜬다. 업데이트본 로드가 실패하면 **반드시 내장으로 폴백**한다.
 */

const path = require('node:path');
const Module = require('node:module');

// 진입점(app-main.js)의 루트 기준 상대 경로. 코드스왑 버전 폴더도 이 트리를 그대로 미러링한다.
const ENTRY_REL = path.join('src', 'main', 'app-main.js');

/**
 * 코드스왑 버전 폴더는 node_modules 를 포함하지 않는다 (용량·네이티브 모듈 때문에 스왑 대상이 아님 —
 * server.js 의 INCLUDE 가 src/ 와 package.json 만 넘긴다). 그래서 그 폴더에서 로드되는 코드가
 * third-party 의존성(bytenode·puppeteer-core·electron-updater)을 자기 위치 기준으로는 못 찾는다.
 * 설치본에선 버전 폴더가 asar 의 node_modules 에서 멀리(AppData) 떨어져 있어 require 가 실패하고,
 * 부트스트랩이 조용히 내장으로 되돌려 코드스왑이 **영영 적용되지 않는다.**
 * → 설치본(asar) 의 node_modules 를 모든 모듈 탐색 경로의 **폴백**으로 추가한다(로컬 우선, 그다음 여기).
 */
function addBundledNodeModules(bundledRoot) {
  const nm = path.join(bundledRoot, 'node_modules');
  const orig = Module._nodeModulePaths;
  Module._nodeModulePaths = function (from) {
    const paths = orig.call(this, from);
    if (!paths.includes(nm)) paths.push(nm);
    return paths;
  };
}

function boot() {
  // 이 파일: <root>/src/main/index.js  →  <root> = ../../
  const bundledRoot = path.join(__dirname, '..', '..');

  // 코드스왑본이 설치본 node_modules 를 찾을 수 있게 (내장 폴백 경로에도 무해).
  try { addBundledNodeModules(bundledRoot); } catch (e) { console.error('[bootstrap] node_modules 경로 확장 실패:', e.message); }

  let root = bundledRoot;
  try {
    const { resolveCodeRoot } = require('../updater');
    root = resolveCodeRoot(bundledRoot);
  } catch (e) {
    console.error('[bootstrap] 코드 루트 결정 실패 — 내장 코드로 진행:', e.message);
  }

  if (root !== bundledRoot) {
    try {
      require(path.join(root, ENTRY_REL));
      console.log('[bootstrap] 코드스왑 업데이트본 로드:', root);
      return;
    } catch (e) {
      // 받아둔 코드가 깨졌다. 버리고 내장으로 — 다음 실행부터는 이 단계도 안 탄다.
      console.error('[bootstrap] 업데이트본 로드 실패 — 내장으로 되돌림:', e.message);
      try { require('../updater').revertToBundled(); } catch { /* noop */ }
    }
  }

  require(path.join(bundledRoot, ENTRY_REL));
}

boot();
