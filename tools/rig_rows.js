'use strict';
/* ==========================================================================
   打印归一化帧在关键高度上的像素段分类，用于确定骨架切分边界。
   ========================================================================== */

const path = require('node:path');
const { readImage } = require('./lib');

const { ROOT, resolveInput } = require('./lib/paths');

function classify(r, g, b, a) {
  if (a < 128) return '.';
  if (r > 110 && r > g * 1.5 && r > b * 1.3) return 'R'; // 红色条纹
  if (r < 75 && g < 75 && b < 95) {
    if (r < 45 && g < 45) return 'H'; // 头发/最深
    return 'P'; // 藏青/裤子
  }
  if (r > 200 && g > 200 && b > 195) return 'W'; // 白衬衫/鞋
  if (r > 150 && g > 100 && b > 70) return 'S'; // 皮肤
  if (r > 90 && g > 90 && b > 90) return 'L'; // 浅灰鞋
  return '?';
}

function main() {
  const IMG = process.argv[2]
    ? resolveInput(process.argv[2])
    : path.join(ROOT, 'tools', 'ref', 'rig', 'contact_320.png');
  const img = readImage(IMG);
  const w = img.width;
  const rows = [190, 200, 210, 220, 230, 240, 250, 260, 280, 300, 310, 320, 330, 340, 350, 360, 380, 400, 420, 440, 448];
  for (const y of rows) {
    if (y >= img.height) continue;
    const runs = [];
    let start = -1;
    let prev = null;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const c = classify(img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3]);
      if (c === '.') {
        if (start >= 0) {
          runs.push([start, x - 1, prev]);
          start = -1;
        }
        continue;
      }
      if (start < 0) {
        start = x;
        prev = c;
      } else if (c !== prev) {
        runs.push([start, x - 1, prev]);
        start = x;
        prev = c;
      }
    }
    if (start >= 0) runs.push([start, w - 1, prev]);
    if (!runs.length) continue;
    console.log(`y=${String(y).padStart(3)}: ` + runs.map(([a, b, c]) => `${a}-${b}:${c}`).join('  '));
  }
}

if (require.main === module) main();