'use strict';
/* ==========================================================================
   生成干净的 Web 运行目录（Tauri / PWA 的 web root）。
   只复制运行时需要的 index.html、css/、js/、assets/，不会把 tools/ 或原始
   参考图打进安装包。纯 Node，无第三方依赖。
   用法:
     node tools/stage_web.js [输出目录]    # 默认 dist/
   ========================================================================== */

const fs = require('node:fs');
const path = require('node:path');
const { ROOT, resolveInput, isInside } = require('./lib/paths');

const ENTRIES = ['index.html', 'css', 'js', 'assets'];

// 手动递归复制：不依赖 fs.cpSync。部分 Node/Windows 组合在非 ASCII 路径下
// 调用 fs.cpSync 会异常退出，而 copyFileSync/readdirSync 正常。
function copyTree(src, dst) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const name of fs.readdirSync(src)) copyTree(path.join(src, name), path.join(dst, name));
  } else {
    fs.copyFileSync(src, dst);
  }
}

function main() {
  const out = process.argv[2] ? resolveInput(process.argv[2]) : path.join(ROOT, 'dist');
  if (out === ROOT || !isInside(ROOT, out)) {
    console.error('refusing to stage outside the project:', out);
    process.exit(1);
  }
  for (const rel of ['index.html', 'js/game.js', 'css/style.css', 'assets/hero.png']) {
    if (!fs.existsSync(path.join(ROOT, rel))) {
      console.error('missing runtime file:', rel);
      process.exit(1);
    }
  }

  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  for (const rel of ENTRIES) {
    copyTree(path.join(ROOT, rel), path.join(out, rel));
  }

  const bytes = (function size(dir) {
    let n = 0;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      n += e.isDirectory() ? size(p) : fs.statSync(p).size;
    }
    return n;
  })(out);
  console.log(`staged ${bytes} bytes -> ${path.relative(ROOT, out)}`);
  console.log('Tauri frontendDist / PWA web root:', out);
}

if (require.main === module) main();

module.exports = { main, ENTRIES };
