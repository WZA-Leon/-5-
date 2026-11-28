'use strict';
/* ==========================================================================
   在局部区域上叠加坐标网格，便于手工标定骨架切分坐标。
   用法: node tools/zoom_grid.js <src> <x0> <y0> <x1> <y1> [scale] [out]
   ========================================================================== */

const path = require('node:path');
const { readImage, writeImage, line, putText } = require('./lib');
const { ROOT, resolveInput } = require('./lib/paths');

function main() {
  const src = process.argv[2];
  const x0 = Number(process.argv[3]);
  const y0 = Number(process.argv[4]);
  const x1 = Number(process.argv[5]);
  const y1 = Number(process.argv[6]);
  const scale = Number(process.argv[7] || 4);
  if (!src || ![x0, y0, x1, y1].every(Number.isInteger) || x1 <= x0 || y1 <= y0) {
    console.error('usage: node tools/zoom_grid.js <src> <x0> <y0> <x1> <y1> [scale] [out]');
    process.exit(1);
  }
  if (!Number.isFinite(scale) || scale <= 0) {
    console.error('scale must be a positive number');
    process.exit(1);
  }

  const inFile = resolveInput(src);
  const out = process.argv[8]
    ? resolveInput(process.argv[8])
    : path.join(ROOT, 'tools', 'ref', 'rig', 'zoom_grid.png');
  const img = readImage(inFile);
  const crop = img.crop(x0, y0, x1 - x0, y1 - y0);
  const big = crop.resize(crop.width * scale, crop.height * scale, 'nearest');
  const w = big.width;
  const h = big.height;

  for (let x = x0 - (x0 % 10); x <= x1; x += 10) {
    const px = (x - x0) * scale;
    if (px < 0 || px >= w) continue;
    const red = x % 50 === 0;
    line(big, px, 0, px, h, red ? [255, 0, 0] : [170, 170, 170], 1);
    if (red) putText(big, String(x), px + 2, 20, 0.45, [255, 0, 0], 1);
  }
  for (let y = y0 - (y0 % 10); y <= y1; y += 10) {
    const py = (y - y0) * scale;
    if (py < 0 || py >= h) continue;
    const red = y % 50 === 0;
    line(big, 0, py, w, py, red ? [255, 0, 0] : [170, 170, 170], 1);
    if (red) putText(big, String(y), 2, py + 16, 0.45, [255, 0, 0], 1);
  }

  writeImage(out, big);
  console.log('saved', out, big.width + 'x' + big.height);
}

if (require.main === module) main();

module.exports = { main };
