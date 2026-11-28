'use strict';
/* ==========================================================================
   把不同来源的走路姿势归一化后排在一起，检查能否拼成交替迈步的循环。
   ========================================================================== */

const fs = require('node:fs');
const path = require('node:path');
const { Image, readImage, writeImage, putText } = require('./lib');
const { splitSprites, measure, normalize } = require('./build_sheet_sjy');

const { ROOT } = require('./lib/paths');
const REF = path.join(ROOT, 'tools', 'ref', 'rig', 'cycle');

function framesOf(file) {
  const img = readImage(file);
  const sp = splitSprites(img);
  const ys = sp.map((s) => s.bbox[1]).sort((a, b) => a - b);
  const mid = ys[ys.length >> 1];
  const top = sp.filter((s) => s.bbox[1] < mid).sort((a, b) => a.bbox[0] - b.bbox[0]);
  const bot = sp.filter((s) => s.bbox[1] >= mid).sort((a, b) => a.bbox[0] - b.bbox[0]);
  const out = {};
  for (const [band, items] of [['top', top], ['bottom', bot]]) {
    out[band] = items.map((s) => {
      const m = measure(s.rgba);
      return { norm: normalize(s.rgba, m), bbox: s.bbox, m };
    });
  }
  return out;
}

function label(img, text) {
  const out = img.clone();
  putText(out, text, 6, 22, 0.6, [0, 0, 255], 1);
  return out;
}

function hstackAll(images) {
  const width = images.reduce((s, im) => s + im.width, 0);
  const out = new Image(width, images[0].height);
  let x = 0;
  for (const im of images) {
    out.copyInto(im, x, 0);
    x += im.width;
  }
  return out;
}

function main() {
  fs.mkdirSync(REF, { recursive: true });
  const src1 = path.join(ROOT, 'tools', 'ref', 'src', 'img1_1024.png');
  const src6 = path.join(ROOT, 'roles', 'SJY', 'img (6).png');
  const f1 = framesOf(src1);
  const f6 = framesOf(src6);
  console.log('img1 top', f1.top.length, 'img6 top', f6.top.length);
  console.log('img1 bottom', f1.bottom.length, 'img6 bottom', f6.bottom.length);

  for (const band of ['top', 'bottom']) {
    const a = f6[band];
    const b = f1[band];
    const combo = [];
    a.forEach((fr, i) => combo.push([fr.norm, `6#${i}`]));
    b.forEach((fr, i) => combo.push([fr.norm, `1#${i}`]));
    writeImage(path.join(REF, `all_${band}.png`), hstackAll(combo.map(([n, t]) => label(n, t))));

    // 候选循环：6#1,6#2,6#3,1#3
    if (a.length >= 4 && b.length >= 4) {
      const cand = [a[1], a[2], a[3], b[3]];
      writeImage(path.join(REF, `cand_${band}.png`), hstackAll(cand.map((c, i) => label(c.norm, `c${i}`))));
    }
    console.log('wrote', band);
  }
}

if (require.main === module) main();