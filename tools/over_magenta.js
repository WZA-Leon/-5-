'use strict';
/* 把带 alpha 的图叠到洋红底上，方便肉眼检查抠图边缘。
   用法: node tools/over_magenta.js <src> <dst> */

const { Image, readImage, writeImage } = require('./lib');
const { resolveInput } = require('./lib/paths');

function main() {
  if (!process.argv[2] || !process.argv[3]) {
    console.error('usage: node tools/over_magenta.js <src> <dst>');
    process.exit(1);
  }
  const src = resolveInput(process.argv[2]);
  const dst = resolveInput(process.argv[3]);
  const im = readImage(src);
  const bg = new Image(im.width, im.height);
  for (let o = 0; o < bg.data.length; o += 4) {
    bg.data[o] = 255;
    bg.data[o + 1] = 0;
    bg.data[o + 2] = 255;
    bg.data[o + 3] = 255;
  }
  writeImage(dst, bg.over(im));
  console.log('ok', im.width + 'x' + im.height, '->', dst);
}

if (require.main === module) main();

module.exports = { main };
