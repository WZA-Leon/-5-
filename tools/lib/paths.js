'use strict';
/* ==========================================================================
   跨平台路径工具（纯 Node，无第三方依赖）。

   规则：
   - ROOT 由本文件所在位置推导，不依赖启动时的 cwd，也没有盘符/用户名。
   - 命令行传入的路径：绝对路径原样使用；相对路径按“当前工作目录”解析。
   - 代码内部拼路径一律使用 path.join / path.resolve，不手写 / 或 \。
   - 浏览器运行时不引用本文件；Tauri/PWA 只使用相对 URL（assets/...）。
   ========================================================================== */

const path = require('node:path');
const os = require('node:os');

/** 仓库根目录（tools/lib 往上两级） */
const ROOT = path.resolve(__dirname, '..', '..');
const TOOLS = path.join(ROOT, 'tools');
const ASSETS = path.join(ROOT, 'assets');
const REF = path.join(TOOLS, 'ref');

/** 从项目根目录拼路径，例如 fromRoot('assets', 'hero.png') */
function fromRoot(...parts) {
  return path.join(ROOT, ...parts);
}

/** 从 tools 目录拼路径 */
function fromTools(...parts) {
  return path.join(TOOLS, ...parts);
}

/**
 * 解析命令行路径：
 *   resolveInput('roles/SJY/img (1).png')  // 相对 cwd
 *   resolveInput('/absolute/path/a.png')   // 原样
 *   resolveInput(undefined, 'assets/hero.png') // 用 fallback（相对 cwd）
 */
function resolveInput(value, fallback) {
  let p = value == null || value === '' ? fallback : value;
  if (p == null) return null;
  if (typeof p !== 'string') throw new TypeError('path must be a string');
  if (p === '~') p = os.homedir();
  else if (p.startsWith('~/') || p.startsWith('~\\')) p = path.join(os.homedir(), p.slice(2));
  return path.resolve(process.cwd(), p);
}

/** 项目内路径：绝对路径保留；相对路径相对 ROOT（不是 cwd） */
function resolveFromRoot(value) {
  if (value == null) return null;
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(ROOT, value);
}

/** target 是否在 root 内（用于静态服务器防止目录穿越） */
function isInside(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}

/** 转成 URL 路径（始终使用 /，用于 manifest / 日志 / 诊断） */
function toUrlPath(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

module.exports = {
  ROOT,
  TOOLS,
  ASSETS,
  REF,
  fromRoot,
  fromTools,
  resolveInput,
  resolveFromRoot,
  isInside,
  toUrlPath,
};
