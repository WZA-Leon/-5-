'use strict';
/* ==========================================================================
   零依赖项目自检：路径、资源、Python 残留、JS 语法、精灵表尺寸。
   用法: node tools/check_project.js
   ========================================================================== */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ROOT } = require('./lib/paths');
const { readImage } = require('./lib');

const failures = [];
const warnings = [];

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function requireFile(rel) {
  if (!exists(rel)) fail(`missing required file: ${rel}`);
}

function textFiles(dir = ROOT) {
  const out = [];
  const skip = new Set(['.git', '.dsh-progress', 'node_modules', 'tools\\ref', 'tools/ref', 'assets', 'dist', 'src-tauri']);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(ROOT, full);
    if (entry.isDirectory()) out.push(...textFiles(full));
    else if (/\.(js|json|html|css|webmanifest)$/i.test(entry.name)) out.push({ full, rel });
  }
  return out;
}

/* ------------------------------------------------------------ 1. 文件 --- */
for (const rel of [
  'index.html',
  'css/style.css',
  'js/game.js',
  'package.json',
  'assets/hero.png',
  'tools/lib/paths.js',
  'tools/build_rig_sheet.js',
  'tools/serve.js',
  'roles/SJY/img (8).png',
  'tools/ref/src/img1_1024.png',
]) {
  requireFile(rel);
}
for (let i = 0; i < 16; i++) {
  const tag = String(i).padStart(2, '0');
  for (const layer of ['body', 'armfar', 'armnear']) {
    requireFile(path.join('tools', 'ref', 'rig', 'rig3', `walk_${tag}_${layer}.png`));
  }
}
for (const dir of [path.join('tools', '__pycache__')]) {
  if (fs.existsSync(path.join(ROOT, dir))) fail(`legacy Python directory still exists: ${dir}`);
}

/* ------------------------------------------------------- 2. Python 残留 --- */
const pyFiles = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === '.dsh-progress' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__pycache__') fail(`Python cache directory remains: ${path.relative(ROOT, full)}`);
      walk(full);
    } else if (/\.(py|pyc|pyo)$/i.test(entry.name)) pyFiles.push(path.relative(ROOT, full));
  }
})(ROOT);
if (pyFiles.length) fail(`Python artifacts remain: ${pyFiles.join(', ')}`);

/* ------------------------------------------------ 3. 路径 / 代码扫描 --- */
const badPatterns = [
  [/E:\\mad/i, 'hardcoded drive path'],
  [/E:\/[Mm]ad/i, 'hardcoded drive path'],
  [/C:\\Users\\/i, 'hardcoded Windows user path'],
  [/\/Users\//, 'hardcoded macOS user path'],
  [/file:\/\/\//i, 'hardcoded file URL'],
];
for (const { full, rel } of textFiles()) {
  let text;
  try {
    text = fs.readFileSync(full, 'utf8');
  } catch {
    continue;
  }
  for (const [re, why] of badPatterns) {
    if (re.test(text)) fail(`${rel}: ${why}`);
  }
  if (/\bpython(3(\.\d+)?)?\s+tools[\\/]/i.test(text)) fail(`${rel}: Python command reference`);
  if (/from\s+['"][^'"]+\.py['"]/.test(text)) fail(`${rel}: Python import`);
}

/* ------------------------------------------------------ 4. 包依赖为零 --- */
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  for (const key of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    if (pkg[key] && Object.keys(pkg[key]).length) fail(`package.json has ${key}`);
  }
} catch (err) {
  fail(`package.json unreadable: ${err.message}`);
}

/* ---------------------------------------------------------- 5. JS 语法 --- */
for (const { full, rel } of textFiles()) {
  if (!rel.endsWith('.js')) continue;
  const r = spawnSync(process.execPath, ['--check', full], { encoding: 'utf8' });
  if (r.status !== 0) fail(`${rel}: syntax error\n${(r.stderr || '').trim()}`);
}

/* ------------------------------------------------------ 6. 运行时断言 --- */
const app = fs.readFileSync(path.join(ROOT, 'js', 'game.js'), 'utf8');
if (!/const\s+FRAME_COLS\s*=\s*17\b/.test(app)) fail('game.js FRAME_COLS is not 17');
if (!/const\s+FRAME_ROWS\s*=\s*2\b/.test(app)) fail('game.js FRAME_ROWS is not 2');
if (!/assets\/hero\.webp/.test(app) || !/assets\/hero\.png/.test(app)) {
  fail('game.js does not reference relative hero assets');
}

try {
  const hero = readImage(path.join(ROOT, 'assets', 'hero.png'));
  if (hero.width !== 17 * 320 || hero.height !== 2 * 460) {
    fail(`assets/hero.png is ${hero.width}x${hero.height}, expected 5440x920`);
  }
} catch (err) {
  fail(`assets/hero.png unreadable: ${err.message}`);
}

const webpPath = path.join(ROOT, 'assets', 'hero.webp');
const pngPath = path.join(ROOT, 'assets', 'hero.png');
if (!exists('assets/hero.webp')) {
  warn('assets/hero.webp missing: game falls back to PNG (normal without ffmpeg)');
} else if (fs.statSync(webpPath).mtimeMs < fs.statSync(pngPath).mtimeMs) {
  // 游戏优先加载 webp；webp 比 png 旧就说明它会盖掉新构建的图
  fail('assets/hero.webp is older than assets/hero.png: rebuild or delete it, otherwise the page shows stale art');
}

/* ------------------------------------------------------------- 输出 --- */
for (const w of warnings) console.log('WARN', w);
if (failures.length) {
  for (const f of failures) console.error('FAIL', f);
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log('OK: zero-dep JS project, relative paths, 16 walk frames, 5440x920 hero sheet.');
