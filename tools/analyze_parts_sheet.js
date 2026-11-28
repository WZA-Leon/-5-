'use strict';
/* ==========================================================================
   分析用户提供的「肢解参考图」：按列/行切出各个身体部件。
   ========================================================================== */

const fs = require('node:fs');
const path = require('node:path');
const { Image, readImage, writeImage, connectedComponents } = require('./lib');

const { ROOT } = require('./lib/paths');
const SRC = path.join(ROOT, 'playground-1795268747-1.png');
const OUT = path.join(ROOT, 'tools', 'ref', 'rig', 'parts_sheet');

function main() {
  if (!fs.existsSync(SRC)) throw new Error('missing ' + SRC);
  fs.mkdirSync(OUT, { recursive: true });
  const img = readImage(SRC);
  const w = img.width;
  const h = img.height;

  const mask = new Uint8Array(w * h);
  for (let i = 0, o = 3; i < mask.length; i++, o += 4) mask[i] = img.data[o] > 0 ? 1 : 0;

  const { count, labels, stats, centroids } = connectedComponents(mask, w, h, 8);
  const items = [];
  for (let i = 1; i <= count; i++) {
    const s = stats[i - 1];
    if (s.area < 400) continue;
    items.push({
      i,
      bbox: [s.x, s.y, s.x + s.w - 1, s.y + s.h - 1],
      area: s.area,
      cx: centroids[i - 1].x,
      cy: centroids[i - 1].y,
    });
  }

  const cols = { 0: [], 1: [], 2: [], 3: [] };
  for (const it of items) cols[Math.min(3, Math.floor(it.cx / 256))].push(it);

  for (const c of [0, 1, 2, 3]) {
    cols[c].sort((a, b) => a.bbox[1] - b.bbox[1]);
    console.log(`== col ${c}: ${cols[c].length} parts`);
    for (const it of cols[c]) {
      const [x0, y0, x1, y1] = it.bbox;
      console.log(`   bbox=(${x0},${y0},${x1},${y1}) w=${x1 - x0 + 1} h=${y1 - y0 + 1} area=${it.area}`);
    }
    cols[c].forEach((it, k) => {
      const part = new Image(w, h);
      for (let y = it.bbox[1]; y <= it.bbox[3]; y++) {
        for (let x = it.bbox[0]; x <= it.bbox[2]; x++) {
          const idx = y * w + x;
          if (labels[idx] !== it.i) continue;
          const so = idx * 4;
          const o = (y * w + x) * 4;
          part.data[o] = img.data[so];
          part.data[o + 1] = img.data[so + 1];
          part.data[o + 2] = img.data[so + 2];
          part.data[o + 3] = img.data[so + 3];
        }
      }
      const [x0, y0, x1, y1] = it.bbox;
      writeImage(path.join(OUT, `c${c}_p${k}.png`), part.crop(x0, y0, x1 - x0 + 1, y1 - y0 + 1));
    });
  }
  console.log('items', items.length);
}

if (require.main === module) main();