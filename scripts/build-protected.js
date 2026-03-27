const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const JavaScriptObfuscator = require('javascript-obfuscator');

const ROOT = path.resolve(__dirname, '..');
const DIST_SRC = path.join(ROOT, 'dist-src');
const electronPath = path.join(ROOT, 'node_modules', '.bin', 'electron.cmd');

// Main process JS files to compile with bytenode
// NOTE: Files using page.evaluate()/frame.evaluate() CANNOT be bytenode-compiled
//       because bytenode functions return [native code] on .toString(),
//       which Puppeteer cannot serialize to the browser context.
const MAIN_FILES = [
  'src/main/index.js',
  'src/main/ipc-handlers.js',
  'src/main/core/adb-helper.js',
  'src/main/core/ip-changer.js',
  'src/main/core/ip-checker.js',
  'src/main/core/nickname-generator.js',
  'src/main/data/store.js',
  'src/main/engine/executor.js',
  'src/main/engine/result-logger.js',
  'src/main/engine/task-queue.js',
  'src/shared/constants.js',
];

// Entry points that don't export (just run)
const NO_EXPORT_FILES = [
  'src/main/index.js',
];

// Preload scripts — obfuscated with target: 'node'
const PRELOAD_FILES = [
  'src/main/preload.js',
];

// Main process files that use Puppeteer page.evaluate() — obfuscate only (not bytenode)
const PUPPETEER_FILES = [
  'src/main/core/auth.js',
  'src/main/core/browser-manager.js',
  'src/main/core/comment-writer.js',
  'src/main/core/crawl.js',
  'src/main/core/nickname-changer.js',
  'src/main/core/post-deleter.js',
  'src/main/core/post-liker.js',
  'src/main/core/post-writer.js',
];

// Renderer JS files to obfuscate
const RENDERER_FILES = [
  'src/renderer/app.js',
  'src/renderer/components/account-tab.js',
];

// ── Helpers ──────────────────────────────────────────────

function cleanDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
}

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// ── Step 1: Clean dist-src ──────────────────────────────

console.log('[1/6] Cleaning dist-src/ ...');
cleanDir(DIST_SRC);

// ── Step 2: Copy source structure ───────────────────────

console.log('[2/6] Copying source files ...');
copyDirSync(path.join(ROOT, 'src'), path.join(DIST_SRC, 'src'));
copyDirSync(path.join(ROOT, 'resources'), path.join(DIST_SRC, 'resources'));

// ── Step 3: Compile main process with bytenode ──────────

console.log('[3/6] Compiling main process with bytenode ...');

// Create a helper script that bytenode will run inside Electron
const compileHelperPath = path.join(DIST_SRC, '_compile-helper.js');

for (const relFile of MAIN_FILES) {
  const absFile = path.join(DIST_SRC, relFile);
  if (!fs.existsSync(absFile)) {
    console.warn(`  SKIP (not found): ${relFile}`);
    continue;
  }

  const dir = path.dirname(absFile);
  const basename = path.basename(absFile, '.js');
  const jscFile = path.join(dir, `${basename}.jsc`);

  // Write a temporary compile script
  const compileScript = `
    require('bytenode');
    const bytenode = require('bytenode');
    const path = require('path');
    bytenode.compileFile({
      filename: ${JSON.stringify(absFile)},
      output: ${JSON.stringify(jscFile)},
      electron: true
    }).then(() => {
      process.exit(0);
    }).catch(err => {
      console.error(err);
      process.exit(1);
    });
  `;

  fs.writeFileSync(compileHelperPath, compileScript, 'utf-8');

  try {
    execSync(`"${electronPath}" "${compileHelperPath}"`, {
      cwd: ROOT,
      stdio: 'pipe',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
  } catch (err) {
    console.error(`  FAIL: ${relFile}`);
    console.error(err.stderr?.toString() || err.message);
    process.exit(1);
  }

  // Replace .js with loader stub
  const isNoExport = NO_EXPORT_FILES.includes(relFile);
  const loaderContent = isNoExport
    ? `require('bytenode');\nrequire('./${basename}.jsc');\n`
    : `require('bytenode');\nmodule.exports = require('./${basename}.jsc');\n`;

  fs.writeFileSync(absFile, loaderContent, 'utf-8');
  console.log(`  OK: ${relFile}`);
}

// Clean up helper
if (fs.existsSync(compileHelperPath)) {
  fs.unlinkSync(compileHelperPath);
}

// ── Step 4: Obfuscate renderer JS ───────────────────────

console.log('[4/6] Obfuscating renderer JS ...');

// Renderer obfuscation: safe options (variable rename + string encryption)
// deadCodeInjection/controlFlowFlattening cause _0x... undefined errors
const obfuscatorOptions = {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayThreshold: 0.75,
  splitStrings: false,
  renameGlobals: false,
  selfDefending: false,
  target: 'browser',
};

for (const relFile of RENDERER_FILES) {
  const absFile = path.join(DIST_SRC, relFile);
  if (!fs.existsSync(absFile)) {
    console.warn(`  SKIP (not found): ${relFile}`);
    continue;
  }

  const source = fs.readFileSync(absFile, 'utf-8');
  const result = JavaScriptObfuscator.obfuscate(source, obfuscatorOptions);
  fs.writeFileSync(absFile, result.getObfuscatedCode(), 'utf-8');
  console.log(`  OK: ${relFile}`);
}

// Puppeteer files: NO stringArray — page.evaluate() callbacks are serialized to browser,
// where module-scoped string decoder functions don't exist
const puppeteerObfuscatorOptions = {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  stringArray: false,
  selfDefending: false,
  target: 'node',
};

// Preload/other node files: stringArray is safe (no cross-context serialization)
const nodeObfuscatorOptions = {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayThreshold: 0.75,
  splitStrings: false,
  renameGlobals: false,
  selfDefending: false,
  target: 'node',
};

// Obfuscate Puppeteer files (variable rename only — no stringArray)
for (const relFile of PUPPETEER_FILES) {
  const absFile = path.join(DIST_SRC, relFile);
  if (!fs.existsSync(absFile)) {
    console.warn(`  SKIP (not found): ${relFile}`);
    continue;
  }

  const source = fs.readFileSync(absFile, 'utf-8');
  const result = JavaScriptObfuscator.obfuscate(source, puppeteerObfuscatorOptions);
  fs.writeFileSync(absFile, result.getObfuscatedCode(), 'utf-8');
  console.log(`  OK (puppeteer): ${relFile}`);
}

// Obfuscate preload scripts (target: 'node', with stringArray)
for (const relFile of PRELOAD_FILES) {
  const absFile = path.join(DIST_SRC, relFile);
  if (!fs.existsSync(absFile)) {
    console.warn(`  SKIP (not found): ${relFile}`);
    continue;
  }

  const source = fs.readFileSync(absFile, 'utf-8');
  const result = JavaScriptObfuscator.obfuscate(source, nodeObfuscatorOptions);
  fs.writeFileSync(absFile, result.getObfuscatedCode(), 'utf-8');
  console.log(`  OK (preload): ${relFile}`);
}

// ── Step 5: Prepare package.json for dist-src ───────────

console.log('[5/6] Preparing package.json ...');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));

// Detect installed electron version for electron-builder
const electronPkgPath = path.join(ROOT, 'node_modules', 'electron', 'package.json');
const electronVersion = JSON.parse(fs.readFileSync(electronPkgPath, 'utf-8')).version;
console.log(`  Detected electron version: ${electronVersion}`);

// dist-src package.json: only production info
const distPkg = {
  name: pkg.name,
  version: pkg.version,
  description: pkg.description,
  main: pkg.main,
  author: pkg.author || 'N Cafe Auto',
  dependencies: pkg.dependencies,
  build: {
    ...pkg.build,
    electronVersion: electronVersion,
    asarUnpack: ['**/*.jsc'],
    directories: { output: '../dist' },
    extraResources: [
      ...pkg.build.extraResources,
    ],
  },
};

fs.writeFileSync(
  path.join(DIST_SRC, 'package.json'),
  JSON.stringify(distPkg, null, 2),
  'utf-8'
);

// Copy package-lock.json if exists
const lockFile = path.join(ROOT, 'package-lock.json');
if (fs.existsSync(lockFile)) {
  fs.copyFileSync(lockFile, path.join(DIST_SRC, 'package-lock.json'));
}

// ── Step 6: Install production dependencies ─────────────

console.log('[6/6] Installing production dependencies in dist-src/ ...');

execSync('npm install --omit=dev', {
  cwd: DIST_SRC,
  stdio: 'inherit',
});

console.log('\n✓ Build protection complete! dist-src/ is ready for packaging.');
