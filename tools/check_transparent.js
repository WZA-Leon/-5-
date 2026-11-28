'use strict';
/* ==========================================================================
   检查 roles/ 下几张参考图是否真的带 alpha，并输出洋红底对照图。
   ========================================================================== */

const fs = require('node:fs');
const path = require('node:path');
const { Image, readImage, writeImage, pngInfo } = require('./lib');
const { ROOT } = require('./lib/paths');

const OUT_DIR = path.join(ROOT, 'tools', 'ref', 'rig');

const files = [
  path.join(ROOT, 'roles', 'SJY', 'img(1).png'),
  path.join(ROOT, 'roles', 'SJY', 'img(6).png'),
  path.join(ROOT, 'roles', 'SJY', 'img (6).png'),
];

function main() {
  for (const p of files) {
    if (!fs.existsSync(p)) {
      console.log(p, 'MISSING');
      continue;
    }
    const info = pngInfo(fs.readFileSync(p));
    const im = readImage(p);
    let alpha0 = 'no alpha';
    if (info.channels === 4) {
      let n = 0;
      for (let o = 3; o < im.data.length; o += 4) if (im.data[o] === 0) n++;
      alpha0 = (n / (im.width * im.height)).toFixed(3);
    }
    console.log(p, `(${im.height}, ${im.width}, ${info.channels})`, 'alpha0', alpha0);

    if (info.channels === 4) {
      const bg = new Image(im.width, im.height);
      for (let o = 0; o < bg.data.length; o += 4) {
        bg.data[o] = 255;
        bg.data[o + 1] = 0;
        bg.data[o + 2] = 255;
        bg.data[o + 3] = 255;
      }
      const out = bg.over(im);
      const name = path.basename(p).replace(/ /g, '_').replace(/\(/g, '').replace(/\)/g, '');
      writeImage(path.join(OUT_DIR, name + '_magenta.png'), out);
      const b = im.bbox(0);
      console.log('   bbox', [b.x0, b.y0, b.x1, b.y1]);
    }
  }
}

if (require.main === module) main();

module.exports = { main, files };
