'use strict';
/* ==========================================================================
   从参考图切出小人：只移除与画布边缘连通的白底，保留衣服/鞋子的白色。
   （纯 JS 版，零依赖）
   用法: node tools/sprite_extract.js [源图] [输出目录]
   ========================================================================== */

const fs = require('node:fs');
const path = require('node:path');
const {
  Image, readImage, writeImage, rgb2hsv, connectedComponents, dilate, open,
} = require('./lib');

const { ROOT, resolveInput, resolveFromRoot } = require('./lib/paths');

/** 边缘连通的白底掩码（1 = 背景） */
function backgroundMask(img, satMax = 30, valMin = 190, trim = 2) {
  const w = img.width;
  const h = img.height;
  const n = w * h;
  const nearWhite = new Uint8Array(n);
  for (let i = 0, o = 0; i < n; i++, o += 4) {
    const hsv = rgb2hsv(img.data[o], img.data[o + 1], img.data[o + 2]);
    nearWhite[i] = hsv[1] < satMax && hsv[2] > valMin ? 1 : 0;
  }

  const { labels } = connectedComponents(nearWhite, w, h, 4);
  const border = new Set();
  for (let x = 0; x < w; x++) {
    border.add(labels[x]);
    border.add(labels[(h - 1) * w + x]);
  }
  for (let y = 0; y < h; y++) {
    border.add(labels[y * w]);
    border.add(labels[y * w + w - 1]);
  }
  border.delete(0);

  const bg = new Uint8Array(n);
  for (let i = 0; i < n; i++) bg[i] = border.has(labels[i]) ? 1 : 0;

  for (let t = 0; t < trim; t++) {
    const nearBg = dilate(bg, w, h, 3);
    for (let i = 0, o = 0; i < n; i++, o += 4) {
      if (bg[i] || !nearBg[i]) continue;
      const hsv = rgb2hsv(img.data[o], img.data[o + 1], img.data[o + 2]);
      if (hsv[1] < 45 && hsv[2] > 140) bg[i] = 1;
    }
  }
  return bg;
}

function splitSprites(file, minArea = 6000) {
  if (!fs.existsSync(file)) return [];
  const img = readImage(file);
  return splitImage(img, minArea);
}

function splitImage(img, minArea = 6000) {
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
        const src = (s.y + y) * w + (s.x + x);
        const o = (y * s.w + x) * 4;
        if (labels[src] !== i) continue;
        const so = src * 4;
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

function demo() {
  const src = process.argv[2]
    ? resolveInput(process.argv[2])
    : resolveFromRoot(path.join('tools', 'ref', 'src', 'img1_1024.png'));
  const sprites = splitSprites(src);
  console.log('sprites', sprites.length);
  const outDir = process.argv[3]
    ? resolveInput(process.argv[3])
    : path.join(ROOT, 'tools', 'ref', 'rig');
  sprites.forEach((s, i) => {
    const im = s.rgba;
    const bg = new Image(im.width, im.height, new Uint8Array(im.width * im.height * 4));
    for (let o = 0; o < bg.data.length; o += 4) {
      bg.data[o] = 255;
      bg.data[o + 1] = 0;
      bg.data[o + 2] = 255;
      bg.data[o + 3] = 255;
    }
    const out = bg.over(im);
    // 预览图统一输出 PNG（纯 JS 编码，不依赖外部工具）
    writeImage(path.join(outDir, `split_${i}_magenta.png`), out);
  });
  console.log('->', outDir);
}

if (require.main === module) demo();

module.exports = { backgroundMask, splitSprites, splitImage };