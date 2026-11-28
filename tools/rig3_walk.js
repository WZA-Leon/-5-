'use strict';
/* ==========================================================================
   兼容入口：渲染 hero 的 16 帧走路分层素材。
   真正的实现在 tools/lib/rig.js（通用引擎），参数在 tools/characters/hero.json。

   要改角色比例/锚点/鞋口对齐，改配置，不要改这里。
   ========================================================================== */

const { loadConfig, buildAllFrames, writeFrames } = require('./lib/rig');

const CHAR_ID = process.env.CHAR || 'hero';

function main() {
  const cfg = loadConfig(CHAR_ID);
  const built = buildAllFrames(cfg);
  writeFrames(cfg, built.walk);
  console.log(`[帧] ${cfg.id}：1 静止 + ${cfg.sheet.frames} 走路 → tools/ref/rig/${cfg.id}`);
  return built;
}

if (require.main === module) main();

module.exports = { main, CHAR_ID };
