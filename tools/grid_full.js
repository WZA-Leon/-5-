'use strict';
/* 在整图上叠加坐标网格，便于手工标定。
   用法: node tools/grid_full.js <src> <dst> [scale] */

const { readImage, writeImage, line, putText } = require('./lib');
const { resolveInput } = require('./lib/paths');

function main() {
  if (!process.argv[2] || !process.argv[3]) {
    console.error('usage: node tools/grid_full.js <src> <dst> [scale]');
    process.exit(1);
  }
  const src = resolveInput(process.argv[2]);
  const dst = resolveInput(process.argv[3]);
  const scale = Number(process.argv[4] || 2);
  if (!Number.isFinite(scale) || scale <= 0) {
    console.error('scale must be a positive number');
    process.exit(1);
  }

  const img = readImage(src);
  const big = img.resize(img.width * scale, img.height * scale, 'nearest');
  const w = img.width;
  const h = img.height;

  for (let x = 0; x < w; x += 10) {
    const px = x * scale;
    const red = x % 50 === 0;
    line(big, px, 0, px, h * scale, red ? [255, 0, 0] : [170, 170, 170], 1);
    if (red) putText(big, String(x), px + 2, 14, 0.4, [255, 0, 0], 1);
  }
  for (let y = 0; y < h; y += 10) {
    const py = y * scale;
    const red = y % 50 === 0;
    line(big, 0, py, w * scale, py, red ? [255, 0, 0] : [170, 170, 170], 1);
    if (red) putText(big, String(y), 2, py + 12, 0.4, [255, 0, 0], 1);
  }

  writeImage(dst, big);
  console.log('saved', dst, big.width + 'x' + big.height);
}

if (require.main === module) main();

module.exports = { main };
