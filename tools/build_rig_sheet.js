'use strict';
/* ==========================================================================
   把 rig3 的 16 帧走路 + 1 帧站立打包成 17 列 × 2 行的精灵表（v16 状态）。

   v16：身体（腿+鞋+躯干+头）为一层，手臂为远/近两层；
   右向行 = 身体镜像 + 另一方向的手臂；左向行 = 身体原样 + 另一方向的手臂。
   ========================================================================== */

const fs = require('node:fs');
const path = require('node:path');
const { Image, readImage, writeImage } = require('./lib');

const { ROOT } = require('./lib/paths');
const FRAMES = path.join(ROOT, 'tools', 'ref', 'rig', 'rig3');
const OUT_PNG = path.join(ROOT, 'assets', 'hero.png');
const OUT_WEBP = path.join(ROOT, 'assets', 'hero.webp');

const CELL_W = 320;
const CELL_H = 460;
const N = 16;

function over(bg, fg) {
  return bg.over(fg);
}

function main() {
  const frames = [];
  for (let i = 0; i < N; i++) {
    const tag = String(i).padStart(2, '0');
    const files = [
      path.join(FRAMES, `walk_${tag}_legsonly.png`),
      path.join(FRAMES, `walk_${tag}_shoes.png`),
      path.join(FRAMES, `walk_${tag}_shoesswap.png`),
      path.join(FRAMES, `walk_${tag}_torso.png`),
      path.join(FRAMES, `walk_${tag}_armfar.png`),
      path.join(FRAMES, `walk_${tag}_armnear.png`),
    ];
    for (const f of files) if (!fs.existsSync(f)) throw new Error('missing parts for frame ' + i + ': ' + f);
    frames.push(files.map(readImage));
  }

  // 列 0 站立（用第 0 帧），列 1..16 走路
  const cols = [frames[0], ...frames];
  // 静止帧专用：前面那只鞋已镜像
  const idleShoesSrc = readImage(path.join(FRAMES, 'walk_00_shoesidle.png'));
  const sheet = new Image(CELL_W * cols.length, CELL_H * 2);
  cols.forEach(([legsonly, shoes, shoesSwap, torso, far, near], c) => {
    const isIdle = c === 0;
    // 静止帧：用镜像过的鞋；裤子画在鞋下面（鞋压在上面）
    const idleShoes = idleShoesSrc;
    const topShoes = isIdle ? idleShoes.flipH() : shoes;
    const bottomShoes = isIdle ? idleShoes : shoes.flipH();
    // 左键（上面那行）：身体镜像，腿用另一方向的腿
    const top = over(over(far, over(over(legsonly, topShoes), torso.flipH())), near);
    // 按右键：右手移到左手位置、左手移到右手位置；身体不动；裤腿在鞋下方
    const bottom = over(over(far.flipH(), over(over(legsonly.flipH(), bottomShoes), torso)), near.flipH());
    sheet.copyInto(top, c * CELL_W, 0);
    sheet.copyInto(bottom, c * CELL_W, CELL_H);
  });

  writeImage(OUT_PNG, sheet, { level: 6 });
  writeImage(OUT_WEBP, sheet, { quality: 92 });
  console.log(`sheet ${sheet.width}x${sheet.height}`);
}

if (require.main === module) main();