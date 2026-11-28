'use strict';
/* ==========================================================================
   从 AI 生成的参考图里提取可用的走路帧（纯 JS 版）。

   问题：这些图不是规则网格，帧距不等、比例不一、朝向也混排，直接按比例切会错位。
   做法：
     1. 连通域分割出每个小人（自动跳过标题条、分隔线）
     2. 用「头发团块质心 vs 面部肤色质心」判断朝向（马尾在脑后，脸在前）
     3. 统一身高、脚底基线、躯干中心，得到可比较的规范图
     4. 量出每帧的步态量：前后脚掌偏移、抬脚高度、小腿遮挡厚度
     5. 用光流做姿态插值，把 3 个真实姿势补成 8 帧循环（同图内插值，画风一致）
   ========================================================================== */

const fs = require('node:fs');
const path = require('node:path');
const { Image, readImage, writeImage, rgb2hsv, rgb2ycbcr, rgb2gray, connectedComponents, close, grayOf, calcOpticalFlowFarneback, remap, warpAffine, pyRound } = require('./lib');

const { TOOLS, resolveInput, resolveFromRoot } = require('./lib/paths');

const DEFAULT_SOURCE = path.join('roles', 'SJY', 'img (8).png');
const BODY_H = 408;
const CELL_W = 240;
const CELL_H = 460;
const PAD_BOTTOM = 8;

/* ------------------------------------------------------------- 分割 --- */
function splitSprites(file) {
  if (!fs.existsSync(file)) return [];
  const img = readImage(file);
  const w = img.width;
  const h = img.height;
  const nearWhite = new Uint8Array(w * h);
  for (let i = 0, o = 0; i < nearWhite.length; i++, o += 4) {
    const hsv = rgb2hsv(img.data[o], img.data[o + 1], img.data[o + 2]);
    nearWhite[i] = hsv[1] < 26 && hsv[2] > 196 ? 1 : 0;
  }
  const inverted = new Uint8Array(w * h);
  for (let i = 0; i < inverted.length; i++) inverted[i] = nearWhite[i] ? 0 : 1;
  const mask = close(inverted, w, h, 5);

  const { count, labels, stats } = connectedComponents(mask, w, h, 8);
  const out = [];
  for (let i = 1; i <= count; i++) {
    const s = stats[i - 1];
    if (s.area < 6000 || s.h < 150 || s.w < 40 || s.h / Math.max(s.w, 1) < 1.2) continue;
    const local = new Uint8Array(s.w * s.h);
    for (let y = 0; y < s.h; y++) {
      for (let x = 0; x < s.w; x++) {
        local[y * s.w + x] = labels[(s.y + y) * w + (s.x + x)] === i ? 1 : 0;
      }
    }
    const m = close(local, s.w, s.h, 3);
    const rgba = new Image(s.w, s.h);
    for (let y = 0; y < s.h; y++) {
      for (let x = 0; x < s.w; x++) {
        const o = (y * s.w + x) * 4;
        if (!m[y * s.w + x]) continue;
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

/* ---------------------------------------------------------- 朝向 --- */
function facing(img) {
  const w = img.width;
  const h = img.height;
  const top = (() => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (img.data[(y * w + x) * 4 + 3] > 128) return y;
    return 0;
  })();
  let bottom = top;
  for (let y = h - 1; y >= 0; y--) {
    let found = false;
    for (let x = 0; x < w; x++) if (img.data[(y * w + x) * 4 + 3] > 128) { found = true; break; }
    if (found) { bottom = y; break; }
  }
  const headH = Math.floor((bottom - top + 1) * 0.34);
  let skinSum = 0, skinCx = 0, hairSum = 0, hairCx = 0;
  for (let y = top; y < top + headH; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (img.data[o + 3] <= 128) continue;
      const [yy, cr, cb] = rgb2ycbcr(img.data[o], img.data[o + 1], img.data[o + 2]);
      if (yy >= 0 && cr >= 140 && cr <= 178 && cb >= 90 && cb <= 135) {
        skinSum++;
        skinCx += x;
      }
      if (rgb2gray(img.data[o], img.data[o + 1], img.data[o + 2]) < 70) {
        hairSum++;
        hairCx += x;
      }
    }
  }
  if (skinSum < 40 || hairSum < 40) return 1;
  return skinCx / skinSum > hairCx / hairSum ? 1 : -1;
}

/* -------------------------------------------------------- 归一化 --- */
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

  // 躯干中心：腰部高度带里最长的一段（排除马尾、手臂）
  const y0 = top + Math.floor(height * 0.46);
  const y1 = top + Math.floor(height * 0.54);
  const cols = [];
  for (let x = 0; x < w; x++) {
    let any = false;
    for (let y = y0; y < y1 && !any; y++) {
      if (img.data[(y * w + x) * 4 + 3] > 128) any = true;
    }
    if (any) cols.push(x);
  }
  let torsoCx;
  if (cols.length) {
    let best = [];
    let start = 0;
    for (let i = 1; i <= cols.length; i++) {
      if (i === cols.length || cols[i] - cols[i - 1] > 6) {
        const seg = cols.slice(start, i);
        if (seg.length > best.length) best = seg;
        start = i;
      }
    }
    torsoCx = (best[0] + best[best.length - 1]) / 2;
  } else {
    torsoCx = 0;
  }

  // 左右脚掌：最低 8% 内的像素，按躯干中心分左右
  const low0 = bottom - Math.floor(height * 0.08);
  const foot = { l: { sx: 0, sy: 0, n: 0, minx: Infinity, maxx: -Infinity, miny: Infinity }, r: { sx: 0, sy: 0, n: 0, minx: Infinity, maxx: -Infinity, miny: Infinity } };
  for (let y = low0; y <= bottom; y++) {
    for (let x = 0; x < w; x++) {
      if (img.data[(y * w + x) * 4 + 3] <= 128) continue;
      const f = x < torsoCx ? foot.l : foot.r;
      f.sx += x;
      f.sy += y;
      f.n++;
      if (x < f.minx) f.minx = x;
      if (x > f.maxx) f.maxx = x;
      if (y < f.miny) f.miny = y;
    }
  }
  const footOf = (f) =>
    f.n < 20 ? null : { x: f.sx / f.n, y: f.miny, w: f.maxx - f.minx };

  const shinThick = (x0, x1) => {
    let best = 0;
    for (let y = top + Math.floor(height * 0.8); y < top + Math.floor(height * 0.96); y++) {
      let run = 0;
      for (let x = x0; x < x1; x++) {
        if (img.data[(y * w + x) * 4 + 3] > 128) {
          run++;
          if (run > best) best = run;
        } else {
          run = 0;
        }
      }
    }
    return best;
  };

  return {
    height,
    torso_cx: torsoCx,
    foot_l: footOf(foot.l),
    foot_r: footOf(foot.r),
    shin_l: shinThick(0, Math.floor(torsoCx)),
    shin_r: shinThick(Math.floor(torsoCx), w),
    top,
    bottom,
  };
}

function normalize(img, lm) {
  const s = BODY_H / lm.height;
  const newW = Math.max(1, pyRound(img.width * s));
  const newH = Math.max(1, pyRound(img.height * s));
  const r = img.resize(newW, newH, s < 1 ? 'area' : 'lanczos4');
  const canvas = new Image(CELL_W, CELL_H);
  const px = pyRound(CELL_W / 2 - lm.torso_cx * s);
  const py = pyRound(CELL_H - PAD_BOTTOM - lm.height * s);
  const x0 = Math.max(0, px);
  const y0 = Math.max(0, py);
  const x1 = Math.min(CELL_W, px + r.width);
  const y1 = Math.min(CELL_H, py + r.height);
  if (x1 > x0 && y1 > y0) {
    canvas.copyInto(r.crop(x0 - px, y0 - py, x1 - x0, y1 - y0), x0, y0);
  }
  return canvas;
}

/* ------------------------------------------------- 光流插值（未在流程中使用） --- */
function clip8(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

function flowMorph(fa, fb, t = 0.5) {
  const w = fa.width;
  const h = fa.height;
  const ga = grayOf(fa);
  const gb = grayOf(fb);
  const ff = calcOpticalFlowFarneback(ga, gb, w, h, { levels: 4, window: 5, search: 3, iterations: 2 });
  const fbb = calcOpticalFlowFarneback(gb, ga, w, h, { levels: 4, window: 5, search: 3, iterations: 2 });

  const mx = new Float32Array(w * h);
  const my = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      mx[i] = x + ff.u[i] * t;
      my[i] = y + ff.v[i] * t;
    }
  }
  const wa = remap(fa, mx, my);
  const mx2 = new Float32Array(w * h);
  const my2 = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      mx2[i] = x - fbb.u[i] * t;
      my2[i] = y - fbb.v[i] * t;
    }
  }
  const wb = remap(fb, mx2, my2);

  const out = new Image(w, h);
  for (let i = 0, o = 0; i < w * h; i++, o += 4) {
    const aw = wa.data[o + 3] / 255;
    const bw = wb.data[o + 3] / 255;
    const denom = Math.max(aw * (1 - t) + bw * t, 1e-4);
    for (let k = 0; k < 3; k++) {
      out.data[o + k] = clip8((wa.data[o + k] * aw * (1 - t) + wb.data[o + k] * bw * t) / denom);
    }
    out.data[o + 3] = clip8(wa.data[o + 3] * (1 - t) + wb.data[o + 3] * t);
  }
  return snapBaseline(out, fa, fb, t);
}

function snapBaseline(img, fa, fb, t) {
  const anchor = (f) => {
    let sx = 0, n = 0, maxY = 0;
    for (let y = 0; y < f.height; y++) {
      for (let x = 0; x < f.width; x++) {
        if (f.data[(y * f.width + x) * 4 + 3] > 128) {
          sx += x;
          n++;
          if (y > maxY) maxY = y;
        }
      }
    }
    return n ? { x: sx / n, y: maxY } : { x: 0, y: 0 };
  };
  const a = anchor(fa);
  const b = anchor(fb);
  const c = anchor(img);
  const dx = pyRound(a.x * (1 - t) + b.x * t - c.x);
  const dy = pyRound(a.y * (1 - t) + b.y * t - c.y);
  if (!dx && !dy) return img;
  return warpAffine(img, [1, 0, dx, 0, 1, dy], img.width, img.height);
}

/* ------------------------------------------------------------ 主流程 --- */
function buildSheet(source = DEFAULT_SOURCE) {
  const file = resolveFromRoot(source);
  const sprites = splitSprites(file);
  const rows = sprites.map((s) => ({
    rgba: s.rgba,
    lm: measure(s.rgba),
    face: facing(s.rgba),
    bbox: s.bbox,
  }));
  const ys = rows.map((r) => r.bbox[1]).sort((a, b) => a - b);
  const mid = ys.length ? ys[ys.length >> 1] : 0;
  const info = rows.map((r) => ({
    bbox: r.bbox,
    band: r.bbox[1] < mid ? 'top' : 'bottom',
    face: r.face,
    torso_cx: pyRound(r.lm.torso_cx * 10) / 10,
    foot_l_x: r.lm.foot_l ? pyRound((r.lm.foot_l.x - r.lm.torso_cx) * 10) / 10 : null,
    foot_r_x: r.lm.foot_r ? pyRound((r.lm.foot_r.x - r.lm.torso_cx) * 10) / 10 : null,
    foot_l_y: r.lm.foot_l ? pyRound((r.lm.foot_l.y - r.lm.bottom) * 10) / 10 : null,
    foot_r_y: r.lm.foot_r ? pyRound((r.lm.foot_r.y - r.lm.bottom) * 10) / 10 : null,
    shin_l: r.lm.shin_l,
    shin_r: r.lm.shin_r,
  }));
  return { rows, info };
}

function main() {
  const file = process.argv[2] ? resolveInput(process.argv[2]) : resolveFromRoot(DEFAULT_SOURCE);
  if (!fs.existsSync(file)) {
    console.error('missing', file);
    console.error('usage: node tools/extract_frames.js [image]');
    process.exit(1);
  }
  const { info } = buildSheet(file);
  info.forEach((r, i) => {
    console.log(
      `${String(i).padStart(2)} ${r.band.padEnd(6)} face=${r.face > 0 ? 'R' : 'L'} ` +
        `footL=${r.foot_l_x}@${r.foot_l_y} footR=${r.foot_r_x}@${r.foot_r_y} ` +
        `shinL=${r.shin_l} shinR=${r.shin_r}`
    );
  });
  fs.writeFileSync(path.join(TOOLS, 'sheet_info.json'), JSON.stringify(info, null, 1));
}

if (require.main === module) main();

module.exports = { splitSprites, facing, measure, normalize, flowMorph, buildSheet };