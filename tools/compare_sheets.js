'use strict';
/* ==========================================================================
   对比旧精灵表与当前精灵表：叠深底、并排、放大两倍，便于检查像素。
   ========================================================================== */

const path = require('node:path');
const { Image, readImage, writeImage, hstack, putText } = require('./lib');
const { ROOT } = require('./lib/paths');

function over(im, color = [40, 40, 40]) {
  const bg = new Image(im.width, im.height);
  for (let o = 0; o < bg.data.length; o += 4) {
    bg.data[o] = color[0];
    bg.data[o + 1] = color[1];
    bg.data[o + 2] = color[2];
    bg.data[o + 3] = 255;
  }
  return bg.over(im);
}

function separator(h, w = 10) {
  const im = new Image(w, h);
  for (let o = 0; o < im.data.length; o += 4) {
    im.data[o] = 255;
    im.data[o + 1] = 255;
    im.data[o + 2] = 255;
    im.data[o + 3] = 255;
  }
  return im;
}

function main() {
  const oldImg = readImage(path.join(ROOT, 'tools', 'ref', 'hero_old.png'));
  const newImg = readImage(path.join(ROOT, 'assets', 'hero.png'));

  // idle cell 0 top row（旧版 4 列 × 240，生产版 17 列 × 320；按实际宽度取第一格）
  const OLD_COLS = 4;
  const NEW_COLS = 17;
  const oldCellW = Math.round(oldImg.width / OLD_COLS);
  const newCellW = Math.round(newImg.width / NEW_COLS);
  const cellH = Math.min(460, oldImg.height, newImg.height);
  if (oldImg.height !== newImg.height) {
    throw new Error(`sheet heights differ: old=${oldImg.height}, new=${newImg.height}`);
  }
  const o = over(oldImg.crop(0, 0, oldCellW, cellH));
  const n = over(newImg.crop(0, 0, newCellW, cellH));
  let pair = hstack([o, separator(cellH), n]);
  putText(pair, 'OLD', 8, 30, 0.8, [255, 0, 0], 2);
  putText(pair, 'NEW', oldCellW + 18, 30, 0.8, [0, 255, 0], 2);
  pair = pair.resize(pair.width * 2, pair.height * 2, 'nearest');
  writeImage(path.join(ROOT, 'tools', 'ref', 'rig', 'idle_old_vs_new.png'), pair);

  // 整张表叠加深色底
  const full = hstack([over(oldImg), separator(oldImg.height), over(newImg)]);
  writeImage(path.join(ROOT, 'tools', 'ref', 'rig', 'sheet_old_vs_new.png'), full);
  console.log(
    'ok',
    pair.width + 'x' + pair.height,
    full.width + 'x' + full.height,
    `(cells old=${oldCellW} new=${newCellW})`
  );
}

if (require.main === module) main();

module.exports = { main };
