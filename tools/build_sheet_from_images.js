'use strict';
/* ==========================================================================
   用 img (1).png 里的真实帧拼走路动画（不做任何程序化生成）。

   img (1) 每排 5 帧，实测：
     #0 / #4  站立（两脚张开 34~40px，脚都在地上）
     #2       跨步最大（两脚张开 118px）—— 接触帧
     #3       双腿交叉、两脚都在地上 —— 经过帧
     #1       一条腿抬起、只有一只脚着地 —— 摆动帧（抬脚最高的那帧）

   输出：4 列 × 2 行，列 0 站立，列 1..3 走路循环；行 0 朝右，行 1 朝左
   默认输出 tools/ref/rig/from_images/，不会覆盖游戏生产用的 assets/hero.*
   （生产表由 build_rig_sheet.js 生成）。
   ========================================================================== */

const path = require('node:path');
const { Image, writeImage, pyRound } = require('./lib');
const { splitSprites } = require('./extract_frames');

const { ROOT, resolveFromRoot } = require('./lib/paths');
const CELL_W = 240;
const CELL_H = 460;
const BODY_H = 408;
const FEET_Y = 452;
const SOURCE = 'img (1).png';

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

  // 头肩中心：最上面 32% 的水平范围中点
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

  // 两脚张开宽度：最低 8% 的像素 x 范围
  let lmin = Infinity, lmax = -Infinity;
  for (let y = bottom - Math.floor(height * 0.08); y <= bottom; y++) {
    for (let x = 0; x < w; x++) {
      if (img.data[(y * w + x) * 4 + 3] > 128) {
        if (x < lmin) lmin = x;
        if (x > lmax) lmax = x;
      }
    }
  }
  const spread = lmax >= lmin ? lmax - lmin : 0;

  // 抬脚程度：最低 3% 里的像素数越少，说明有一只脚离地
  let groundPx = 0;
  for (let y = bottom - Math.max(1, Math.floor(height * 0.03)); y <= bottom; y++) {
    for (let x = 0; x < w; x++) if (img.data[(y * w + x) * 4 + 3] > 128) groundPx++;
  }

  return { top, bottom, h: height, cx, spread, ground_px: groundPx };
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
  const others = rest.filter((f) => f !== contact).sort((a, b) => a.ground_px - b.ground_px);
  return { stand, contact, passing: others[others.length - 1], swing: others[0] };
}

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : 0;
}

function main() {
  const sprites = splitSprites(resolveFromRoot(SOURCE));
  if (sprites.length < 8) throw new Error(`${SOURCE} 只切出 ${sprites.length} 帧`);

  const mid = median(sprites.map((s) => s.bbox[1]));
  const groups = { top: [], bottom: [] };
  for (const s of sprites) {
    const m = measure(s.rgba);
    const item = { norm: normalize(s.rgba, m), bbox: s.bbox, ...m };
    (s.bbox[1] < mid ? groups.top : groups.bottom).push(item);
  }
  groups.top.sort((a, b) => a.bbox[0] - b.bbox[0]);
  groups.bottom.sort((a, b) => a.bbox[0] - b.bbox[0]);

  const right = classify(groups.top); // 上排朝右（马尾在左，脸朝右）
  const left = classify(groups.bottom); // 下排朝左（马尾在右，脸朝左）

  const order = (g) => [g.contact, g.passing, g.swing];
  const cols = 4;
  const sheet = new Image(CELL_W * cols, CELL_H * 2);
  [right.stand, ...order(right)].forEach((f, col) => sheet.copyInto(f.norm, col * CELL_W, 0));
  [left.stand, ...order(left)].forEach((f, col) => sheet.copyInto(f.norm, col * CELL_W, CELL_H));

  const outDir = path.join(ROOT, 'tools', 'ref', 'rig', 'from_images');
  const png = path.join(outDir, 'hero.png');
  const webp = path.join(outDir, 'hero.webp');
  writeImage(webp, sheet, { quality: 92 });
  writeImage(png, sheet, { level: 6 });
  console.log(`输出 ${png}`);

  const show = (tag, g) =>
    console.log(
      `${tag}: 站立=${JSON.stringify(g.stand.bbox)} ` +
        `接触=${JSON.stringify(g.contact.bbox)}(张开${pyRound(g.contact.spread)}) ` +
        `经过=${JSON.stringify(g.passing.bbox)}(张开${pyRound(g.passing.spread)}, 着地${g.passing.ground_px}) ` +
        `摆动=${JSON.stringify(g.swing.bbox)}(张开${pyRound(g.swing.spread)}, 着地${g.swing.ground_px})`
    );
  show('朝右(下排)', right);
  show('朝左(上排)', left);
  console.log(`精灵表 ${sheet.width}x${sheet.height}  ${cols} 列 × 2 行（列 0 站立，1..${cols - 1} 走路）`);
}

if (require.main === module) main();

module.exports = { measure, normalize, classify };