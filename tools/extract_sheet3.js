'use strict';
/* ==========================================================================
   从 3.png（绿幕拆件图）抠出各部件，输出透明 PNG + 部件清单。
   ========================================================================== */

const fs = require('node:fs');
const path = require('node:path');
const { Image, readImage, writeImage, connectedComponents, dilate } = require('./lib');

const { ROOT } = require('./lib/paths');
const SRC = path.join(ROOT, '3.png');
const OUT = path.join(ROOT, 'tools', 'ref', 'rig', 'sheet3');

function main() {
  if (!fs.existsSync(SRC)) throw new Error('missing ' + SRC);
  fs.mkdirSync(OUT, { recursive: true });
  const img = readImage(SRC);
  const w = img.width;
  const h = img.height;

  const green = new Uint8Array(w * h);
  for (let i = 0, o = 0; i < green.length; i++, o += 4) {
    const r = img.data[o];
    const g = img.data[o + 1];
    const b = img.data[o + 2];
    green[i] = g > 150 && g > r + 40 && g > b + 40 ? 1 : 0;
  }
  const greenD = dilate(green, w, h, 3);
  const alpha = new Uint8Array(w * h);
  for (let i = 0; i < alpha.length; i++) alpha[i] = greenD[i] ? 0 : 255;

  const rgba = img.clone();
  for (let i = 0, o = 0; i < alpha.length; i++, o += 4) rgba.data[o + 3] = alpha[i];

  const { count, labels, stats, centroids } = connectedComponents(alpha, w, h, 8);
  const items = [];
  for (let i = 1; i <= count; i++) {
    const s = stats[i - 1];
    if (s.area < 800) continue;
    items.push({
      i,
      bbox: [s.x, s.y, s.x + s.w - 1, s.y + s.h - 1],
      area: s.area,
      cx: centroids[i - 1].x,
      cy: centroids[i - 1].y,
    });
  }
  items.sort((a, b) => ((a.bbox[1] / 300) | 0) - ((b.bbox[1] / 300) | 0) || a.bbox[0] - b.bbox[0]);

  console.log('parts:', items.length);
  items.forEach((it, k) => {
    const [x0, y0, x1, y1] = it.bbox;
    const part = new Image(w, h);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const idx = y * w + x;
        if (labels[idx] !== it.i) continue;
        const so = idx * 4;
        const o = (y * w + x) * 4;
        part.data[o] = rgba.data[so];
        part.data[o + 1] = rgba.data[so + 1];
        part.data[o + 2] = rgba.data[so + 2];
        part.data[o + 3] = rgba.data[so + 3];
      }
    }
    const crop = part.crop(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    const name = `p${String(k).padStart(2, '0')}_x${x0}_y${y0}`;
    writeImage(path.join(OUT, name + '.png'), crop);
    console.log(
      `${name.padEnd(22)} bbox=(${x0},${y0},${x1},${y1}) w=${String(x1 - x0 + 1).padStart(3)} ` +
        `h=${String(y1 - y0 + 1).padStart(3)} area=${it.area}`
    );
  });

  writeImage(path.join(OUT, 'keyed_full.png'), rgba);
  console.log('wrote', OUT);
}

if (require.main === module) main();