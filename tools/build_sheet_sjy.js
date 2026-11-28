'use strict';
/* ==========================================================================
   重抠 SJY 精灵表：只去掉与画布边缘连通的白底，保留白衬衫/白鞋。

   用法:
     node tools/build_sheet_sjy.js [源图路径] [输出目录]
   输出: [输出目录]/hero.png + hero.webp（4 列 × 2 行，列 0 站立，1..3 走路）
   默认输出 tools/ref/rig/sjy/，不会覆盖游戏生产用的 assets/hero.*（生产表由 build_rig_sheet.js 生成）。
   ========================================================================== */

const fs = require('node:fs');
const path = require('node:path');
const { Image, readImage, writeImage, connectedComponents, open, pyRound } = require('./lib');
const { backgroundMask } = require('./sprite_extract');

const { ROOT, resolveInput, resolveFromRoot } = require('./lib/paths');
const DEFAULT_OUT = path.join(ROOT, 'tools', 'ref', 'rig', 'sjy');
const CELL_W = 240;
const CELL_H = 460;
const BODY_H = 408;
const FEET_Y = 452;

function splitSprites(input, minArea = 6000) {
  const img = typeof input === 'string' ? readImage(input) : input;
  const w = img.width;
  const h = img.height;
  const bg = backgroundMask(img);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = bg[i] ? 0 : 1;
  const opened = open(mask, w, h, 2);

  const { count, labels, stats } = connectedComponents(opened, w, h, 8);
  const out = [];
  for (let i = 1; i <= count; i++) {
    const s = stats[i - 1];
    if (s.area < minArea || s.h < 150 || s.w < 40 || s.h / Math.max(s.w, 1) < 1.2) continue;
    const rgba = new Image(s.w, s.h);
    for (let y = 0; y < s.h; y++) {
      for (let x = 0; x < s.w; x++) {
        if (labels[(s.y + y) * w + (s.x + x)] !== i) continue;
        const o = (y * s.w + x) * 4;
        const so = ((s.y + y) * w + (s.x + x)) * 4;
        rgba.data[o] = img.data[so];
        rgba.data[o + 1] = img.data[so + 1];
        rgba.data[o + 2] = img.data[so + 2];
        rgba.data[o + 3] = 255;
      }
    }
    out.push({ bbox: [s.x, s.y, s.x + s.w - 1, s.y + s.h - 1], rgba });
  }
  out.sort((a, b) => ((a.bbox[1] / 200) | 0) - ((b.bbox[1] / 200) | 0) || a.bbox[0] - b.bbox[0]);
  return out;
}

function measure(img) {
  const w = img.width;
  const h = img.height;
  let top = h, bottom = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (img.data[(y * w + x) * 4 + 3] > 128) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  const height = bottom - top + 1;
  let minX = Infinity, maxX = -Infinity;
  for (let y = top; y < top + Math.max(1, Math.floor(height * 0.32)); y++) {
    for (let x = 0; x < w; x++) {
      if (img.data[(y * w + x) * 4 + 3] > 128) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
  }
  const cx = maxX >= minX ? (minX + maxX) / 2 : 0;
  let lmin = Infinity, lmax = -Infinity;
  for (let y = bottom - Math.floor(height * 0.08); y <= bottom; y++) {
    for (let x = 0; x < w; x++) {
      if (img.data[(y * w + x) * 4 + 3] > 128) {
        if (x < lmin) lmin = x;
        if (x > lmax) lmax = x;
      }
    }
  }
  return { top, bottom, h: height, cx, spread: lmax >= lmin ? lmax - lmin : 0 };
}

function normalize(img, m) {
  const s = BODY_H / m.h;
  const w = Math.max(1, pyRound(img.width * s));
  const h = Math.max(1, pyRound(img.height * s));
  const resized = img.resize(w, h, s < 1 ? 'area' : 'lanczos4');
  const canvas = new Image(CELL_W, CELL_H);
  const px = pyRound(CELL_W / 2 - m.cx * s);
  const py = pyRound(FEET_Y - m.bottom * s);
  const x0 = Math.max(0, px);
  const y0 = Math.max(0, py);
  const x1 = Math.min(CELL_W, px + w);
  const y1 = Math.min(CELL_H, py + h);
  if (x1 > x0 && y1 > y0) {
    canvas.copyInto(resized.crop(x0 - px, y0 - py, x1 - x0, y1 - y0), x0, y0);
  }
  return canvas;
}

function classify(frames) {
  if (frames.length >= 5) {
    const stand = frames[0].spread <= frames[frames.length - 1].spread ? frames[0] : frames[frames.length - 1];
    return { stand, contact: frames[2], passing: frames[3], swing: frames[1] };
  }
  const ordered = [...frames].sort((a, b) => a.spread - b.spread);
  const stand = ordered[0];
  const rest = ordered.slice(1);
  const contact = rest.reduce((a, b) => (b.spread > a.spread ? b : a));
  const others = rest.filter((f) => f !== contact);
  return {
    stand,
    contact,
    passing: others.reduce((a, b) => (b.spread > a.spread ? b : a)),
    swing: others.reduce((a, b) => (b.spread < a.spread ? b : a)),
  };
}

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : 0;
}

function main() {
  const src = process.argv[2]
    ? resolveInput(process.argv[2])
    : resolveFromRoot(path.join('tools', 'ref', 'src', 'img1_1024.png'));
  const outDir = process.argv[3] ? resolveInput(process.argv[3]) : DEFAULT_OUT;
  if (!fs.existsSync(src)) throw new Error('missing ' + src);
  const img = readImage(src);
  const sprites = splitSprites(img);
  if (sprites.length < 8) throw new Error(`split only ${sprites.length} sprites`);

  const mid = median(sprites.map((s) => s.bbox[1]));
  const groups = { top: [], bottom: [] };
  for (const s of sprites) {
    const m = measure(s.rgba);
    const item = { norm: normalize(s.rgba, m), bbox: s.bbox, ...m };
    (s.bbox[1] < mid ? groups.top : groups.bottom).push(item);
  }
  groups.top.sort((a, b) => a.bbox[0] - b.bbox[0]);
  groups.bottom.sort((a, b) => a.bbox[0] - b.bbox[0]);

  if (groups.top.length < 5) throw new Error('unexpected frame layout');
  const right = classify(groups.top);
  const left = classify(groups.bottom);
  const order = (g) => [g.contact, g.passing, g.swing];
  const cols = 4;
  const sheet = new Image(CELL_W * cols, CELL_H * 2);
  [right.stand, ...order(right)].forEach((f, col) => sheet.copyInto(f.norm, col * CELL_W, 0));
  [left.stand, ...order(left)].forEach((f, col) => sheet.copyInto(f.norm, col * CELL_W, CELL_H));

  const png = path.join(outDir, 'hero.png');
  const webp = path.join(outDir, 'hero.webp');
  writeImage(webp, sheet, { quality: 92 });
  writeImage(png, sheet, { level: 6 });
  console.log(`sheet ${sheet.width}x${sheet.height} -> ${png}`);

  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = sheet.crop(c * CELL_W, r * CELL_H, CELL_W, CELL_H);
      const b = cell.bbox(0);
      console.log(
        `row${r} col${c} bbox=(${b.x0},${b.y0},${b.x1},${b.y1})`,
        b.x0 === 0 || b.x1 === CELL_W - 1 ? 'CLIP!' : ''
      );
    }
  }
}

if (require.main === module) main();

module.exports = { splitSprites, measure, normalize, classify };