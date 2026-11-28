'use strict';
/* ==========================================================================
   准备 SJY 骨架素材：从 1024 原图取站立/接触帧，用「只删边缘白底」的抠图，
   归一化到 320x460。
   ========================================================================== */

const fs = require('node:fs');
const path = require('node:path');
const { Image, readImage, writeImage, pyRound } = require('./lib');
const { splitSprites } = require('./sprite_extract');
const { measure } = require('./extract_frames');

const { ROOT } = require('./lib/paths');
const OUT = path.join(ROOT, 'tools', 'ref', 'rig');
const CELL_W = 320;
const CELL_H = 460;
const BODY_H = 408;
const FEET_Y = 452;

function normalize(img, m) {
  const s = BODY_H / m.height;
  const w = Math.max(1, pyRound(img.width * s));
  const h = Math.max(1, pyRound(img.height * s));
  const r = img.resize(w, h, s < 1 ? 'area' : 'lanczos4');
  const canvas = new Image(CELL_W, CELL_H);
  const px = pyRound(CELL_W / 2 - m.torso_cx * s);
  const py = pyRound(FEET_Y - m.bottom * s);
  const x0 = Math.max(0, px);
  const y0 = Math.max(0, py);
  const x1 = Math.min(CELL_W, px + r.width);
  const y1 = Math.min(CELL_H, py + r.height);
  if (x1 > x0 && y1 > y0) {
    canvas.copyInto(r.crop(x0 - px, y0 - py, x1 - x0, y1 - y0), x0, y0);
  }
  return canvas;
}

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : 0;
}

function main() {
  const src = path.join(ROOT, 'tools', 'ref', 'src', 'img1_1024.png');
  if (!fs.existsSync(src)) throw new Error('missing ' + src);
  const sprites = splitSprites(src);
  const mid = median(sprites.map((s) => s.bbox[1]));
  const top = sprites.filter((s) => s.bbox[1] < mid).sort((a, b) => a.bbox[0] - b.bbox[0]);
  console.log('top frames', top.length);

  for (const [idx, tag] of [[0, 'idle'], [2, 'contact']]) {
    const s = top[idx];
    if (!s) throw new Error(`缺少第 ${idx} 帧`);
    const m = measure(s.rgba);
    const cell = normalize(s.rgba, m);
    writeImage(path.join(OUT, `${tag}_320.png`), cell);
    const b = cell.bbox(0);
    console.log(tag, 'bbox', [b.x0, b.y0, b.x1, b.y1], 'size', [b.x1 - b.x0 + 1, b.y1 - b.y0 + 1]);
  }
}

if (require.main === module) main();