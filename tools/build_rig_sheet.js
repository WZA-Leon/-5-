'use strict';
/* ==========================================================================
   兼容入口：把分层帧打包成 17 列 × 2 行精灵表。
   真正的实现在 tools/lib/rig.js（通用引擎），参数在 tools/characters/<id>.json。

   行顺序、镜像、叠放层级全部由配置里的 rows 声明，不再写死。
   ========================================================================== */

const { loadConfig, buildAllFrames, buildSheet, writeSheet, writeFrames } = require('./lib/rig');

const CHAR_ID = process.env.CHAR || 'hero';

function main() {
  const cfg = loadConfig(CHAR_ID);
  const built = buildAllFrames(cfg);
  writeFrames(cfg, built.walk);
  const sheet = buildSheet(cfg, built.frames);
  writeSheet(cfg, sheet);
  console.log(`[表] ${cfg.sheet.png}  ${sheet.width}×${sheet.height}`);
  return sheet;
}

if (require.main === module) main();

module.exports = { main, CHAR_ID };
